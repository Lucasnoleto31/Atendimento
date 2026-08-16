import { createServiceClient } from "@/lib/supabase/server";
import {
  enviarTemplate,
  iniciarConversaWhatsapp,
  type TemplateWhatsapp,
} from "@/lib/chatwoot";
import { enviarTemplateMeta } from "@/lib/whatsapp";
import { canalAtivo, listarTemplatesCanal } from "@/lib/canal";

/**
 * Cadência de follow-up com duas famílias de regras (followup_rules.ancora):
 *
 * - lead_criado: N dias após criar lead que NUNCA respondeu (aquisição).
 *   Episódio fixo — um disparo por regra por lead, para sempre.
 * - conta_aberta: conta aberta há N dias sem o PRIMEIRO giro (onboarding).
 *   Episódio fixo — cobra o primeiro giro uma única vez por regra.
 * - sem_giro / queda_lotes: cliente esfriando (retenção). Episódio mensal —
 *   pode repetir em meses seguintes se o cliente continuar parado.
 *
 * Dedup pela PK de followup_envios (lead, regra, episódio); sem regra
 * cadastrada (ou sem as migrações 0013/0015), o motor é inerte.
 */

const INTERVALO_HEARTBEAT_MS = 5 * 60_000;
const LOTE_POR_REGRA = 10;
const VARREDURA_MAXIMA = 300;
const EPISODIO_UNICO = "2000-01-01";

let ultimaExecucao = 0;

type Regra = {
  id: string;
  dias: number;
  template_nome: string;
  template_idioma: string;
  ancora?: "lead_criado" | "conta_aberta" | "sem_giro" | "queda_lotes";
};

type Alvo = {
  leadId: string;
  nome: string;
  telefone: string;
  chatwootContatoId: number | null;
  chatwootConversaId: number | null;
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

  // Sem a migração 0015 (coluna ancora), cai no modo legado da 0013:
  // todas as regras são lead_criado e o dedup usa a PK antiga.
  let regras: Regra[] = [];
  let legado = false;
  {
    const { data, error } = await service
      .from("followup_rules")
      .select("id, dias, template_nome, template_idioma, ancora")
      .eq("ativo", true)
      .order("dias");
    if (error) {
      const alternativa = await service
        .from("followup_rules")
        .select("id, dias, template_nome, template_idioma")
        .eq("ativo", true)
        .order("dias");
      if (alternativa.error || !alternativa.data) {
        return { enviados: 0, pulados: 0, regras: 0 };
      }
      regras = alternativa.data as Regra[];
      legado = true;
    } else {
      regras = (data ?? []) as Regra[];
    }
  }
  if (regras.length === 0) {
    return { enviados: 0, pulados: 0, regras: 0 };
  }

  const templates = await listarTemplatesCanal();
  const canal = canalAtivo();
  let enviados = 0;
  let pulados = 0;

  for (const regra of regras as Regra[]) {
    const template = templates.find(
      (t) =>
        t.nome === regra.template_nome && t.idioma === regra.template_idioma,
    );
    // Só automatizamos template sem variável ou com uma (recebe o nome).
    if (!template || template.parametros.length > 1) continue;

    const ancora = legado ? "lead_criado" : (regra.ancora ?? "lead_criado");
    // Episódio: fixo (uma vez por vida) ou mensal (repete se seguir parado).
    const episodio =
      ancora === "lead_criado" || ancora === "conta_aberta"
        ? EPISODIO_UNICO
        : new Date().toISOString().slice(0, 8) + "01";
    const alvos =
      ancora === "lead_criado"
        ? await alvosLeadNovo(service, regra)
        : await alvosCliente(service, regra, ancora, episodio);

    let enviadosRegra = 0;
    for (const alvo of alvos) {
      if (enviadosRegra >= LOTE_POR_REGRA) break;

      // Âncora mensal: virada de mês não zera o espaço mínimo de 30 dias
      // desde o último envio desta regra para este lead.
      if (episodio !== EPISODIO_UNICO) {
        const { data: ultimoEnvio } = await service
          .from("followup_envios")
          .select("enviado_em")
          .eq("lead_id", alvo.leadId)
          .eq("rule_id", regra.id)
          .order("enviado_em", { ascending: false })
          .limit(1)
          .maybeSingle();
        if (
          ultimoEnvio &&
          Date.now() - Date.parse(ultimoEnvio.enviado_em) < 30 * 86_400_000
        ) {
          continue;
        }
      }

      // Dedup: a PK (lead, regra[, episódio]) barra o segundo disparo.
      const registroEnvio: Record<string, unknown> = {
        lead_id: alvo.leadId,
        rule_id: regra.id,
      };
      if (!legado) registroEnvio.episodio = episodio;
      const { error: dupErro } = await service
        .from("followup_envios")
        .insert(registroEnvio);
      if (dupErro) continue;

      try {
        const valores: Record<string, string> =
          template.parametros.length === 1
            ? { [template.parametros[0]]: alvo.nome }
            : {};

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

        await service.from("lead_interactions").insert({
          lead_id: alvo.leadId,
          tipo: "mensagem_enviada",
          conteudo,
          metadados: {
            ...(canal === "meta"
              ? { message_id: idMensagem }
              : { chatwoot_message_id: idMensagem }),
            via: "cadencia",
            ancora,
            template: template.nome,
            regra_dias: regra.dias,
          },
        });

        await service
          .from("leads")
          .update({ ultima_interacao_em: agora, chat_lido_em: agora })
          .eq("id", alvo.leadId);

        enviados++;
        enviadosRegra++;
      } catch {
        // Falhou (canal fora): libera o episódio para nova tentativa.
        let remocao = service
          .from("followup_envios")
          .delete()
          .eq("lead_id", alvo.leadId)
          .eq("rule_id", regra.id);
        if (!legado) remocao = remocao.eq("episodio", episodio);
        await remocao;
        pulados++;
      }
    }
  }

  return { enviados, pulados, regras: regras.length };
}

/** Aquisição: leads que nunca responderam, criados há N+ dias. */
async function alvosLeadNovo(
  service: ReturnType<typeof createServiceClient>,
  regra: Regra,
): Promise<Alvo[]> {
  const corte = new Date(Date.now() - regra.dias * 86_400_000).toISOString();

  const { data } = await service
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

  return ((data ?? []) as {
    id: string;
    nome: string;
    telefone_e164: string;
    chatwoot_contact_id: number | null;
    chatwoot_conversation_id: number | null;
  }[]).map((l) => ({
    leadId: l.id,
    nome: l.nome,
    telefone: l.telefone_e164,
    chatwootContatoId: l.chatwoot_contact_id,
    chatwootConversaId: l.chatwoot_conversation_id,
  }));
}

/** Retenção: clientes da carteira conforme a âncora (migração 0015). */
async function alvosCliente(
  service: ReturnType<typeof createServiceClient>,
  regra: Regra,
  ancora: "conta_aberta" | "sem_giro" | "queda_lotes",
  episodio: string,
): Promise<Alvo[]> {
  const corte = new Date(Date.now() - regra.dias * 86_400_000)
    .toISOString()
    .slice(0, 10);

  // Já contemplados neste episódio saem da varredura — a janela avança.
  const { data: jaEnviados } = await service
    .from("followup_envios")
    .select("lead_id")
    .eq("rule_id", regra.id)
    .eq("episodio", episodio)
    .limit(1000);
  const excluidos = ((jaEnviados ?? []) as { lead_id: string }[]).map(
    (e) => e.lead_id,
  );

  // eslint-disable-next-line @typescript-eslint/no-explicit-any -- corta a recursão de tipos do builder ao reatribuir a cadeia longa
  let q: any = service
    .from("v_carteira")
    .select(
      "customer_id, nome_completo, lead_id, telefone_e164, conta_aberta_em, ultimo_giro_em, lotes_30d, lotes_30d_anterior, status",
    )
    .not("lead_id", "is", null)
    .not("telefone_e164", "is", null)
    .limit(VARREDURA_MAXIMA);

  if (excluidos.length > 0) {
    q = q.not("lead_id", "in", `(${excluidos.join(",")})`);
  }

  if (ancora === "conta_aberta") {
    // Abriu conta há N+ dias e nunca girou (janela de 45d para não spammar antigos).
    const janela = new Date(
      Date.now() - (regra.dias + 45) * 86_400_000,
    )
      .toISOString()
      .slice(0, 10);
    q = q
      .is("ultimo_giro_em", null)
      .lte("conta_aberta_em", corte)
      .gte("conta_aberta_em", janela)
      .order("conta_aberta_em", { ascending: true });
  } else if (ancora === "sem_giro") {
    // Churn é caso de resgate humano (motor de reativação), não de template.
    q = q
      .lt("ultimo_giro_em", corte)
      .neq("status", "churn")
      .order("ultimo_giro_em", { ascending: true });
  } else {
    // queda_lotes: filtro fino é coluna×coluna, então refina em memória.
    // Maior volume anterior primeiro — mais receita em risco.
    q = q
      .gte("lotes_30d_anterior", 1)
      .neq("status", "churn")
      .order("lotes_30d_anterior", { ascending: false });
  }

  const { data, error } = await q;
  if (error) return []; // migração 0015 ainda não rodou

  let linhas = (data ?? []) as {
    customer_id: string;
    nome_completo: string;
    lead_id: string;
    telefone_e164: string;
    lotes_30d: number | null;
    lotes_30d_anterior: number | null;
  }[];

  if (ancora === "queda_lotes") {
    const { data: cfg } = await service
      .from("settings")
      .select("valor")
      .eq("chave", "queda_lotes_percentual")
      .maybeSingle();
    const limite = Number(cfg?.valor ?? 25);
    linhas = linhas.filter(
      (l) =>
        (l.lotes_30d_anterior ?? 0) > 0 &&
        (l.lotes_30d ?? 0) <
          (l.lotes_30d_anterior ?? 0) * (1 - limite / 100),
    );
  }

  if (linhas.length === 0) return [];

  // Ids do Chatwoot para o canal de reserva + status do lead (perdido sai).
  const { data: leadsInfo } = await service
    .from("leads")
    .select("id, status, chatwoot_contact_id, chatwoot_conversation_id")
    .in(
      "id",
      linhas.map((l) => l.lead_id),
    );
  const porLead = new Map(
    ((leadsInfo ?? []) as {
      id: string;
      status: string;
      chatwoot_contact_id: number | null;
      chatwoot_conversation_id: number | null;
    }[]).map((l) => [l.id, l]),
  );

  return linhas
    .filter((l) => porLead.get(l.lead_id)?.status !== "perdido")
    .map((l) => ({
      leadId: l.lead_id,
      nome: l.nome_completo,
      telefone: l.telefone_e164,
      chatwootContatoId: porLead.get(l.lead_id)?.chatwoot_contact_id ?? null,
      chatwootConversaId:
        porLead.get(l.lead_id)?.chatwoot_conversation_id ?? null,
    }));
}

async function dispararTemplate(
  service: ReturnType<typeof createServiceClient>,
  canal: "meta" | "chatwoot",
  alvo: Alvo,
  template: TemplateWhatsapp,
  valores: Record<string, string>,
): Promise<string | number | null> {
  if (canal === "meta") {
    return enviarTemplateMeta(alvo.telefone, template, valores);
  }

  let conversaId = alvo.chatwootConversaId;
  if (!conversaId) {
    const inicio = await iniciarConversaWhatsapp({
      nome: alvo.nome,
      telefone: alvo.telefone,
      contatoId: alvo.chatwootContatoId,
    });
    conversaId = inicio.conversaId;
    await service
      .from("leads")
      .update({
        chatwoot_contact_id: inicio.contatoId,
        chatwoot_conversation_id: conversaId,
      })
      .eq("id", alvo.leadId);
  }

  const resposta = await enviarTemplate(conversaId, template, valores);
  const idMensagem = resposta?.id ?? null;

  if (typeof idMensagem === "number") {
    await service.from("webhook_events").insert({
      origem: "chatwoot",
      evento_id: `cw-msg-${idMensagem}`,
      payload: { via: "cadencia", lead_id: alvo.leadId },
      processado: true,
    });
  }

  return idMensagem;
}
