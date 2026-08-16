import { createServiceClient } from "@/lib/supabase/server";
import {
  enviarTemplate,
  iniciarConversaWhatsapp,
  listarTemplates,
} from "@/lib/chatwoot";

/**
 * Cadência de follow-up: cada regra diz "N dias depois de criado, lead que
 * NUNCA respondeu recebe o template X". Roda pela rota de cron e pega carona
 * no heartbeat do chat; o dedup por followup_envios (PK lead+regra) garante
 * no máximo um disparo por regra por lead, não importa quem execute.
 *
 * Sem regra cadastrada (ou sem a migração 0013), o motor é inerte.
 */

const INTERVALO_HEARTBEAT_MS = 5 * 60_000;
const LOTE_POR_REGRA = 10;
const VARREDURA_MAXIMA = 200;

let ultimaExecucao = 0;

type Regra = {
  id: string;
  dias: number;
  template_nome: string;
  template_idioma: string;
};

export type ResultadoCadencia = {
  enviados: number;
  pulados: number;
  regras: number;
};

/** Versão com throttle, para o heartbeat do chat. */
export async function processarCadencia(): Promise<void> {
  if (Date.now() - ultimaExecucao < INTERVALO_HEARTBEAT_MS) return;
  ultimaExecucao = Date.now();
  await executarCadencia();
}

export async function executarCadencia(): Promise<ResultadoCadencia> {
  const service = createServiceClient();

  const { data: regras, error } = await service
    .from("followup_rules")
    .select("id, dias, template_nome, template_idioma")
    .eq("ativo", true)
    .order("dias");

  // Tabela ausente (migração 0013 não rodou) ou sem regras: nada a fazer.
  if (error || !regras || regras.length === 0) {
    return { enviados: 0, pulados: 0, regras: 0 };
  }

  const templates = await listarTemplates();
  let enviados = 0;
  let pulados = 0;

  for (const regra of regras as Regra[]) {
    const template = templates.find(
      (t) =>
        t.nome === regra.template_nome && t.idioma === regra.template_idioma,
    );
    // Só automatizamos template sem variável ou com uma (preenchida com o nome).
    if (!template || template.parametros.length > 1) continue;

    const corte = new Date(
      Date.now() - regra.dias * 86_400_000,
    ).toISOString();

    // Candidatos: nunca responderam, ainda no jogo, criados há N+ dias.
    const { data: candidatos } = await service
      .from("leads")
      .select(
        "id, nome, telefone_e164, chatwoot_contact_id, chatwoot_conversation_id",
      )
      .is("primeira_resposta_em", null)
      .not("status", "in", "(ganho,perdido)")
      .not("telefone_e164", "is", null)
      .lte("criado_em", corte)
      .order("criado_em", { ascending: true })
      .limit(VARREDURA_MAXIMA);

    let enviadosRegra = 0;
    for (const lead of (candidatos ?? []) as {
      id: string;
      nome: string;
      telefone_e164: string;
      chatwoot_contact_id: number | null;
      chatwoot_conversation_id: number | null;
    }[]) {
      if (enviadosRegra >= LOTE_POR_REGRA) break;

      // Dedup: a PK (lead, regra) barra o segundo disparo.
      const { error: dupErro } = await service.from("followup_envios").insert({
        lead_id: lead.id,
        rule_id: regra.id,
      });
      if (dupErro) continue;

      try {
        let conversaId = lead.chatwoot_conversation_id;
        if (!conversaId) {
          const inicio = await iniciarConversaWhatsapp({
            nome: lead.nome,
            telefone: lead.telefone_e164,
            contatoId: lead.chatwoot_contact_id,
          });
          conversaId = inicio.conversaId;
          await service
            .from("leads")
            .update({
              chatwoot_contact_id: inicio.contatoId,
              chatwoot_conversation_id: conversaId,
            })
            .eq("id", lead.id);
        }

        const valores: Record<string, string> =
          template.parametros.length === 1
            ? { [template.parametros[0]]: lead.nome }
            : {};

        const resposta = await enviarTemplate(conversaId, template, valores);

        if (resposta?.id) {
          await service.from("webhook_events").insert({
            origem: "chatwoot",
            evento_id: `cw-msg-${resposta.id}`,
            payload: { via: "cadencia", lead_id: lead.id },
            processado: true,
          });
        }

        const conteudo = template.corpo.replace(
          /\{\{\s*([^{}]+?)\s*\}\}/g,
          (bloco, token: string) => valores[token] ?? bloco,
        );
        const agora = new Date().toISOString();

        await service.from("lead_interactions").insert({
          lead_id: lead.id,
          tipo: "mensagem_enviada",
          conteudo,
          metadados: {
            chatwoot_message_id: resposta?.id ?? null,
            via: "cadencia",
            template: template.nome,
            regra_dias: regra.dias,
          },
        });

        await service
          .from("leads")
          .update({ ultima_interacao_em: agora, chat_lido_em: agora })
          .eq("id", lead.id);

        enviados++;
        enviadosRegra++;
      } catch {
        // Falhou (ex.: Chatwoot fora): libera para nova tentativa futura.
        await service
          .from("followup_envios")
          .delete()
          .eq("lead_id", lead.id)
          .eq("rule_id", regra.id);
        pulados++;
      }
    }
  }

  return { enviados, pulados, regras: regras.length };
}
