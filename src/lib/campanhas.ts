import { createServiceClient } from "@/lib/supabase/server";
import { canalAtivo, listarTemplatesCanal } from "@/lib/canal";
import { dispararTemplate, type Alvo } from "@/lib/cadencia";
import { agoraEmBrasilia } from "@/lib/format";
import { orcamentoEnviosRestante } from "@/lib/envios";
import { avancarAposDisparo } from "@/lib/kanban";

/**
 * Campanha com ritmo diário.
 *
 * Uma lista grande não pode sair de uma vez: a Meta limita conversas
 * iniciadas por dia e bloqueio em massa derruba a qualidade do número —
 * que é o canal de todo o atendimento. A campanha guarda o público
 * (uma etiqueta), o template e a cota diária; este motor manda até
 * `por_dia` por dia útil e encerra sozinho quando a lista acaba.
 *
 * Roda no heartbeat do chat e no cron. Sem a migração 0021 é inerte.
 */

const INTERVALO_HEARTBEAT_MS = 5 * 60_000;
/** Por rodada, para os envios se espalharem ao longo do expediente. */
const LOTE_POR_RODADA = 10;
const VARREDURA_MAXIMA = 5_000;
const PAGINA = 200;

let ultimaExecucao = 0;

type Campanha = {
  id: string;
  nome: string;
  template_nome: string;
  template_idioma: string;
  parametros: Record<string, string>;
  etiqueta_id: string | null;
  por_dia: number;
  dias_uteis: boolean;
  hora_inicio: number;
  hora_fim: number;
};

export type ResultadoCampanhas = {
  enviados: number;
  falhas: number;
  campanhas: number;
};

/** Começo do dia em Brasília, para a tela contar no mesmo relógio do motor. */
export function inicioDoDiaSaoPaulo(): string {
  return agoraEmBrasilia().inicioDoDia;
}

/** Primeiro nome, que é como a equipe chama o lead na mensagem. */
function primeiroNome(nome: string) {
  return nome.trim().split(/\s+/)[0] ?? nome;
}

export async function processarCampanhas(): Promise<void> {
  if (Date.now() - ultimaExecucao < INTERVALO_HEARTBEAT_MS) return;
  ultimaExecucao = Date.now();
  await executarCampanhas();
}

export async function executarCampanhas(): Promise<ResultadoCampanhas> {
  const service = createServiceClient();
  const vazio = { enviados: 0, falhas: 0, campanhas: 0 };

  const { data, error } = await service
    .from("campanhas")
    .select(
      "id, nome, template_nome, template_idioma, parametros, etiqueta_id, por_dia, dias_uteis, hora_inicio, hora_fim",
    )
    .eq("status", "ativa")
    .order("criado_em");

  // Migração 0021 ainda não rodou, ou nada ativo.
  if (error || !data || data.length === 0) return vazio;

  const relogio = agoraEmBrasilia();
  const templates = await listarTemplatesCanal();
  const canal = canalAtivo();

  let enviados = 0;
  let falhas = 0;
  let campanhasTocadas = 0;

  for (const campanha of data as Campanha[]) {
    if (!campanha.etiqueta_id) continue;
    if (campanha.dias_uteis && relogio.fimDeSemana) continue;
    if (relogio.hora < campanha.hora_inicio) continue;
    if (relogio.hora >= campanha.hora_fim) continue;

    const template = templates.find(
      (t) =>
        t.nome === campanha.template_nome &&
        t.idioma === campanha.template_idioma,
    );
    if (!template) continue;

    // Cota do dia: toda tentativa conta, inclusive a que falhou — a Meta
    // pode ter aberto a conversa mesmo devolvendo erro.
    const { count: jaHoje } = await service
      .from("campanha_envios")
      .select("lead_id", { count: "exact", head: true })
      .eq("campanha_id", campanha.id)
      .gte("enviado_em", relogio.inicioDoDia);

    const restaHoje = campanha.por_dia - (jaHoje ?? 0);
    if (restaHoje <= 0) continue;

    // Orçamento único do número: campanha não passa por cima do que a
    // cadência e o disparo manual já gastaram hoje (lib/envios).
    const orcamento = await orcamentoEnviosRestante(service);
    if (orcamento <= 0) break;

    const quantos = Math.min(restaHoje, LOTE_POR_RODADA, orcamento);
    const { alvos, publicoAcabou } = await proximosAlvos(
      service,
      campanha,
      quantos,
    );

    if (alvos.length === 0) {
      if (publicoAcabou) {
        await service
          .from("campanhas")
          .update({
            status: "concluida",
            concluida_em: new Date().toISOString(),
          })
          .eq("id", campanha.id)
          .eq("status", "ativa");
      }
      continue;
    }

    campanhasTocadas++;

    for (const alvo of alvos) {
      // Reserva pela PK (campanha, lead): duas rodadas simultâneas não
      // mandam a mesma mensagem duas vezes.
      const { error: ocupado } = await service
        .from("campanha_envios")
        .insert({ campanha_id: campanha.id, lead_id: alvo.leadId });
      if (ocupado) continue;

      const valores: Record<string, string> = {};
      for (const token of template.parametros) {
        const bruto =
          campanha.parametros?.[token] ??
          (template.parametros.length === 1 ? "{nome}" : "");
        valores[token] = bruto.replace(/\{nome\}/gi, primeiroNome(alvo.nome));
      }

      try {
        const idMensagem = await dispararTemplate(
          service,
          canal,
          alvo,
          template,
          valores,
        );

        const conteudo = template.corpo.replace(
          /\{\{\s*([^{}]+?)\s*\}\}/g,
          (bloco, token: string) => valores[token] ?? bloco,
        );
        const agora = new Date().toISOString();

        await service
          .from("campanha_envios")
          .update({ message_id: idMensagem ? String(idMensagem) : null })
          .eq("campanha_id", campanha.id)
          .eq("lead_id", alvo.leadId);

        await service.from("lead_interactions").insert({
          lead_id: alvo.leadId,
          tipo: "mensagem_enviada",
          conteudo,
          metadados: {
            ...(canal === "meta"
              ? { message_id: idMensagem }
              : { chatwoot_message_id: idMensagem }),
            via: "campanha",
            campanha: campanha.nome,
            campanha_id: campanha.id,
            template: template.nome,
          },
        });

        await service
          .from("leads")
          .update({ ultima_interacao_em: agora, chat_lido_em: agora })
          .eq("id", alvo.leadId);

        // Saiu a mensagem, o lead sai de "Novos" para "Em contato".
        await avancarAposDisparo(service, [alvo.leadId]);

        enviados++;
      } catch (e) {
        // A linha fica com o erro: a campanha não insiste sozinha num
        // número que a Meta recusou, e a falha aparece na tela.
        await service
          .from("campanha_envios")
          .update({ erro: e instanceof Error ? e.message : String(e) })
          .eq("campanha_id", campanha.id)
          .eq("lead_id", alvo.leadId);
        falhas++;
      }
    }
  }

  return { enviados, falhas, campanhas: campanhasTocadas };
}

type LinhaPublico = {
  lead_id: string;
  lead: {
    id: string;
    nome: string;
    telefone_e164: string | null;
    chatwoot_contact_id: number | null;
    chatwoot_conversation_id: number | null;
  } | null;
};

/**
 * Próximos da fila: quem tem a etiqueta, ainda não recebeu esta campanha e
 * pode receber marketing. `publicoAcabou` distingue "a cota do lote encheu"
 * de "não sobrou mais ninguém" — só o segundo encerra a campanha.
 */
async function proximosAlvos(
  service: ReturnType<typeof createServiceClient>,
  campanha: Campanha,
  quantos: number,
): Promise<{ alvos: Alvo[]; publicoAcabou: boolean }> {
  // Quem já recebeu (sucesso ou falha) sai da fila para sempre.
  const jaRecebeu = new Set<string>();
  for (let de = 0; de < VARREDURA_MAXIMA; de += 1000) {
    const { data } = await service
      .from("campanha_envios")
      .select("lead_id")
      .eq("campanha_id", campanha.id)
      .range(de, de + 999);
    if (!data || data.length === 0) break;
    data.forEach((r: { lead_id: string }) => jaRecebeu.add(r.lead_id));
    if (data.length < 1000) break;
  }

  const alvos: Alvo[] = [];
  let fim = false;

  const COLUNAS =
    "lead_id, lead:leads!inner(id, nome, telefone_e164, chatwoot_contact_id, chatwoot_conversation_id)";

  for (let de = 0; de < VARREDURA_MAXIMA; de += PAGINA) {
    // Sem a migração 0019 a coluna de bloqueio não existe: repete sem ela.
    const comBloqueio = await service
      .from("lead_tags")
      .select(COLUNAS)
      .eq("tag_id", campanha.etiqueta_id!)
      .neq("lead.status", "perdido")
      .not("lead.telefone_e164", "is", null)
      .is("lead.marketing_bloqueado_em", null)
      .order("criado_em")
      .range(de, de + PAGINA - 1);

    const pagina = comBloqueio.error
      ? await service
          .from("lead_tags")
          .select(COLUNAS)
          .eq("tag_id", campanha.etiqueta_id!)
          .neq("lead.status", "perdido")
          .not("lead.telefone_e164", "is", null)
          .order("criado_em")
          .range(de, de + PAGINA - 1)
      : comBloqueio;

    // Erro de página (timeout, hiccup do PostgREST) NÃO é fim de lista: sair
    // com publicoAcabou=true encerraria a campanha ativa para sempre por um
    // soluço momentâneo. Aborta a rodada sem concluir; tenta de novo depois.
    if (pagina.error) {
      return { alvos, publicoAcabou: false };
    }

    const linhas = (pagina.data ?? []) as unknown as LinhaPublico[];
    if (linhas.length === 0) {
      fim = true;
      break;
    }

    for (const linha of linhas) {
      if (!linha.lead?.telefone_e164) continue;
      if (jaRecebeu.has(linha.lead_id)) continue;
      alvos.push({
        leadId: linha.lead_id,
        nome: linha.lead.nome,
        telefone: linha.lead.telefone_e164,
        chatwootContatoId: linha.lead.chatwoot_contact_id,
        chatwootConversaId: linha.lead.chatwoot_conversation_id,
      });
      if (alvos.length >= quantos) return { alvos, publicoAcabou: false };
    }

    if (linhas.length < PAGINA) {
      fim = true;
      break;
    }
  }

  // Varreu o público inteiro e não sobrou ninguém elegível.
  return { alvos, publicoAcabou: fim && alvos.length === 0 };
}
