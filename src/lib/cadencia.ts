import { createServiceClient } from "@/lib/supabase/server";
import {
  enviarTemplateMeta,
  listarTemplatesMeta,
  metaConfigurada,
  type TemplateWhatsapp,
} from "@/lib/whatsapp";
import { avancarAposDisparo } from "@/lib/kanban";
import { agoraEmBrasilia } from "@/lib/format";
import { orcamentoEnviosRestante } from "@/lib/envios";
import { marcarRoteiroEnviado } from "@/lib/ativacao";
import { podeNutrirPerdido } from "@/lib/perda";
import { lerReguasConversao } from "@/lib/conversao";

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
/**
 * Teto DIÁRIO, somando todas as regras. O LOTE_POR_REGRA acima limita a
 * rodada, não o dia — e o throttle de 5 min vive numa variável de módulo, que
 * na Vercel morre a cada instância fria. Ou seja: o número de rodadas por dia
 * era ilimitado, e o único teto real não existia.
 *
 * Em 24/08/2026 isso mandou 740 templates numa tacada, quando os 879 leads de
 * reativação criados no mesmo dia (17/08) cruzaram juntos o limiar de 6 dias
 * da regra `lead_criado`. A qualidade do número caiu de GREEN para YELLOW.
 * Ajustável em settings.cadencia_por_dia.
 */
const PADRAO_POR_DIA = 60;
/** Mesma janela das campanhas: template de madrugada também derruba nota. */
const HORA_INICIO = 9;
const HORA_FIM = 18;
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

export type Alvo = {
  leadId: string;
  nome: string;
  telefone: string;
};

export type ResultadoCadencia = {
  enviados: number;
  pulados: number;
  regras: number;
};

/** Versão com throttle, para o batimento do layout. */
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

  // Janela de expediente, em Brasília.
  const relogio = agoraEmBrasilia();
  if (
    relogio.fimDeSemana ||
    relogio.hora < HORA_INICIO ||
    relogio.hora >= HORA_FIM
  ) {
    return { enviados: 0, pulados: 0, regras: 0 };
  }

  // Cota do dia contada NO BANCO, nunca em memória. Toda tentativa conta,
  // inclusive a que falhou — a Meta pode ter aberto a conversa mesmo
  // devolvendo erro, e é a conversa aberta que pesa na reputação.
  const { data: cfgDia } = await service
    .from("settings")
    .select("valor")
    .eq("chave", "cadencia_por_dia")
    .maybeSingle();
  const porDia = Number(cfgDia?.valor ?? PADRAO_POR_DIA) || PADRAO_POR_DIA;

  const { count: jaHoje } = await service
    .from("followup_envios")
    .select("lead_id", { count: "exact", head: true })
    .gte("enviado_em", relogio.inicioDoDia);

  // Dois tetos: o da cadência E o orçamento único do número (lib/envios).
  // O que for menor manda — cadência nunca esgota o dia das campanhas.
  const orcamento = await orcamentoEnviosRestante(service);
  let restaHoje = Math.min(porDia - (jaHoje ?? 0), orcamento);
  if (restaHoje <= 0) {
    return { enviados: 0, pulados: 0, regras: regras.length };
  }

  // Canal único é a Meta: sem token configurado a lista vem vazia e o motor
  // fica inerte nesta rodada — nenhum template casa com as regras.
  const templates = await (metaConfigurada()
    ? listarTemplatesMeta()
    : Promise.resolve([]));
  let enviados = 0;
  let pulados = 0;

  for (const regra of regras as Regra[]) {
    if (restaHoje <= 0) break;
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
      if (restaHoje <= 0) break;

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
      restaHoje--;

      try {
        const valores: Record<string, string> =
          template.parametros.length === 1
            ? { [template.parametros[0]]: alvo.nome }
            : {};

        const idMensagem = await dispararTemplate(
          service,
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
            message_id: idMensagem,
            via: "cadencia",
            ancora,
            template: template.nome,
            regra_dias: regra.dias,
          },
        });

        await service
          .from("leads")
          // Robô não "lê" a conversa (ver agendadas.ts) — só o timestamp.
          .update({ ultima_interacao_em: agora })
          .eq("id", alvo.leadId);

        await avancarAposDisparo(service, [alvo.leadId]);

        enviados++;
        enviadosRegra++;
      } catch (e) {
        const msg = e instanceof Error ? e.message : String(e);
        pulados++;

        if (falhaPermanente(msg)) {
          // Falha do destinatário/template (número inválido, template
          // pausado, opt-out): tentar de novo dá o mesmo erro para sempre.
          // MANTÉM a reserva (some da fila) e guarda o motivo. Sem a coluna
          // erro (migração 0028) o update falha em silêncio, o que só
          // significa que o motivo não fica registrado — a reserva fica.
          let marca = service
            .from("followup_envios")
            .update({ erro: msg })
            .eq("lead_id", alvo.leadId)
            .eq("rule_id", regra.id);
          if (!legado) marca = marca.eq("episodio", episodio);
          await marca;
        } else {
          // Falha transitória (canal fora, timeout, throttle): libera para
          // nova tentativa na próxima rodada.
          let remocao = service
            .from("followup_envios")
            .delete()
            .eq("lead_id", alvo.leadId)
            .eq("rule_id", regra.id);
          if (!legado) remocao = remocao.eq("episodio", episodio);
          await remocao;
        }
      }
    }
  }

  return { enviados, pulados, regras: regras.length };
}

/**
 * Distingue falha PERMANENTE (mesmo erro para sempre para este destinatário
 * ou template) de falha transitória (canal fora, timeout, throttle). Só a
 * permanente segura a reserva; a transitória libera para nova tentativa.
 */
function falhaPermanente(msg: string): boolean {
  const m = msg.toLowerCase();
  return (
    /13105\d/.test(m) || // opt-out de marketing
    /130472/.test(m) || // número no grupo de teste da Meta
    /131047|131026/.test(m) || // fora de janela / não entregável
    /132\d{3}/.test(m) || // erros de template (pausado, inexistente, formato)
    m.includes("invalid") ||
    m.includes("not exist") ||
    m.includes("does not exist") ||
    m.includes("template") ||
    m.includes("marketing")
  );
}

/** Aquisição: leads que nunca responderam, criados há N+ dias. */
async function alvosLeadNovo(
  service: ReturnType<typeof createServiceClient>,
  regra: Regra,
): Promise<Alvo[]> {
  const corte = new Date(Date.now() - regra.dias * 86_400_000).toISOString();
  const { nutrirPerdidoAposDias: diasNutrir } =
    await lerReguasConversao(service);

  // Quem já recebeu esta regra sai da fila PARA SEMPRE (episódio único).
  // Sem esta exclusão a janela ordenada por criado_em trava nos leads mais
  // antigos — todos já contemplados — e nunca alcança os leads novos: o
  // motor de aquisição para em silêncio. Coleto o conjunto já enviado (em
  // páginas, pode passar de 1000) e filtro em memória enquanto pagino os
  // candidatos, sem despejar um `not.in` gigante na query string.
  const jaEnviados = new Set<string>();
  for (let de = 0; de < 100_000; de += 1000) {
    const { data, error } = await service
      .from("followup_envios")
      .select("lead_id")
      .eq("rule_id", regra.id)
      .range(de, de + 999);
    if (error || !data || data.length === 0) break;
    data.forEach((r: { lead_id: string }) => jaEnviados.add(r.lead_id));
    if (data.length < 1000) break;
  }

  type LinhaLead = {
    id: string;
    nome: string;
    telefone_e164: string;
    status?: string | null;
    perdido_em?: string | null;
    perda_motivo?: string | null;
  };

  const alvos: Alvo[] = [];
  for (
    let de = 0;
    de < 100_000 && alvos.length < VARREDURA_MAXIMA;
    de += 1000
  ) {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any -- corta a recursão de tipos do builder
    const base = (): any =>
      service
        .from("leads")
        .select("id, nome, telefone_e164, status, perdido_em, perda_motivo")
        .is("primeira_resposta_em", null)
        .neq("status", "ganho")
        .not("telefone_e164", "is", null)
        .lte("criado_em", corte)
        .order("criado_em", { ascending: true })
        .range(de, de + 999);

    // Quem desligou marketing não recebe template. Sem a migração 0019 a
    // coluna não existe e o filtro cai fora.
    const comFiltro = await base().is("marketing_bloqueado_em", null);
    const { data, error } = comFiltro.error ? await base() : comFiltro;
    if (error || !data || data.length === 0) break;

    for (const l of data as LinhaLead[]) {
      if (jaEnviados.has(l.id)) continue;
      // Perdido volta para a nutrição depois do prazo da régua (0069) —
      // exceto quem foi perdido por número errado.
      if (
        !podeNutrirPerdido(l.status, l.perdido_em, l.perda_motivo, diasNutrir)
      ) {
        continue;
      }
      alvos.push({
        leadId: l.id,
        nome: l.nome,
        telefone: l.telefone_e164,
      });
      if (alvos.length >= VARREDURA_MAXIMA) break;
    }
    if (data.length < 1000) break;
  }

  return alvos;
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
    const janela = new Date(Date.now() - (regra.dias + 45) * 86_400_000)
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
        (l.lotes_30d ?? 0) < (l.lotes_30d_anterior ?? 0) * (1 - limite / 100),
    );
  }

  if (linhas.length === 0) return [];

  // Status do lead (perdido volta só depois da régua) e opt-out.
  const { nutrirPerdidoAposDias: diasNutrir } =
    await lerReguasConversao(service);
  type InfoLead = {
    id: string;
    status: string;
    perdido_em?: string | null;
    perda_motivo?: string | null;
    marketing_bloqueado_em?: string | null;
  };

  const ids = linhas.map((l) => l.lead_id);
  // Sem a migração 0019 a coluna não existe: repete a consulta sem ela.
  const comColuna = await service
    .from("leads")
    .select("id, status, perdido_em, perda_motivo, marketing_bloqueado_em")
    .in("id", ids);
  const semColuna = comColuna.error
    ? await service
        .from("leads")
        .select("id, status, perdido_em, perda_motivo")
        .in("id", ids)
    : null;
  const leadsInfo = (semColuna?.data ??
    comColuna.data ??
    []) as unknown as InfoLead[];
  const porLead = new Map(leadsInfo.map((l) => [l.id, l]));

  return linhas
    .filter((l) => {
      const info = porLead.get(l.lead_id);
      // Perdido volta depois do prazo da régua (0069); quem recusou
      // marketing não volta nunca.
      return (
        podeNutrirPerdido(
          info?.status,
          info?.perdido_em,
          info?.perda_motivo,
          diasNutrir,
        ) && !info?.marketing_bloqueado_em
      );
    })
    .map((l) => ({
      leadId: l.lead_id,
      nome: l.nome_completo,
      telefone: l.telefone_e164,
    }));
}

export async function dispararTemplate(
  service: ReturnType<typeof createServiceClient>,
  alvo: Alvo,
  template: TemplateWhatsapp,
  valores: Record<string, string>,
): Promise<string | null> {
  // Canal único: sem a Meta configurada não existe por onde enviar. O erro
  // aqui é a mensagem que chega ao usuário (massa) ou fica na linha (motores),
  // em vez do estouro críptico do token interno.
  if (!metaConfigurada()) {
    throw new Error("WhatsApp (Meta) não configurado.");
  }

  const id = await enviarTemplateMeta(alvo.telefone, template, valores);
  // Lead na fila de Ativação recebendo template = roteiro enviado.
  await marcarRoteiroEnviado(service, [alvo.leadId]);
  return id;
}
