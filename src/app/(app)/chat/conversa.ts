"use server";

import { createClient } from "@/lib/supabase/server";
import { idDaSessao } from "@/lib/auth";
import { registrarAcesso } from "@/lib/auditoria";
import {
  donoOculto,
  donosOcultosParaMim,
  podeVerLead,
} from "@/lib/privacidade";
import {
  CHAVE_HORARIO,
  lerHorario,
  tipoAutomaticaDaVia,
} from "@/lib/automaticas";
import {
  listarTemplatesMeta,
  metaConfigurada,
  type TemplateWhatsapp,
} from "@/lib/whatsapp";
import {
  canalDaResposta,
  paraMensagem,
  recebidaPeloDirect,
  restanteJanela24h,
  TIPOS_MENSAGEM,
  type CatalogosChat,
  type ConversaDoPainel,
  type EtiquetaCatalogo,
  type LinhaBrutaInteracao,
  type MembroEquipe,
  type Mensagem,
  type MensagemPadrao,
} from "./mensagem";
import { pendentesDoLead } from "./recontato-dados";

/**
 * A conversa abre com as 200 últimas mensagens — o que cobre quase tudo;
 * em contato antigo, o começo da história vem aos lotes, sob pedido.
 */
const LOTE_ABERTURA = 200;
const LOTE_ANTERIORES = 100;

// O autor_id vai junto do nome: é por ele que a bolha acha a foto de quem
// da equipe escreveu (as fotos vêm do mapa que a página leu, não daqui).
const CAMPOS_INTERACAO =
  "id, tipo, conteudo, criado_em, metadados, autor_id, autor:profiles(nome)";

/** A Graph API sem resposta não pode segurar a abertura do chat. */
const PRAZO_TEMPLATES_MS = 6_000;

const SESSAO_EXPIRADA = "Sessão expirada.";

/** A mesma resposta do contato que não existe: quem não pode ver a
 *  conversa não fica sabendo que ela existe. */
const NAO_ENCONTRADO = "Contato não encontrado.";

/** Envio que saiu de robô, não da mão de alguém da equipe. */
const VIAS_AUTOMACAO = new Set(["campanha", "cadencia", "disparo", "sync"]);

/**
 * Marca as recebidas que ninguém da equipe viu: as que chegaram depois da
 * última leitura (chat_lido_em) e depois da última resposta ou nota feita à
 * mão (quem respondeu viu o que veio antes). É lida ANTES de a abertura
 * gravar a leitura nova; a Janela abre na primeira delas.
 */
function marcarNaoLidas(mensagens: Mensagem[], lidoEm: string | null): Mensagem[] {
  let corte = lidoEm ? Date.parse(lidoEm) : Number.NEGATIVE_INFINITY;
  if (Number.isNaN(corte)) corte = Number.NEGATIVE_INFINITY;
  for (let i = mensagens.length - 1; i >= 0; i--) {
    const m = mensagens[i];
    if (m.tipo === "mensagem_recebida") continue;
    const via = m.metadados?.via ?? null;
    if (tipoAutomaticaDaVia(via) || VIAS_AUTOMACAO.has(via ?? "")) continue;
    if (m.tipo === "nota" && m.metadados?.sistema) continue;
    corte = Math.max(corte, Date.parse(m.criado_em));
    break;
  }
  return mensagens.map((m) =>
    m.tipo === "mensagem_recebida" && Date.parse(m.criado_em) > corte
      ? { ...m, naoLida: true }
      : m,
  );
}

/**
 * Abre a conversa: o contato, as mensagens mais recentes e as etiquetas
 * dele — só o que muda de um contato para outro. Prontas, templates, equipe
 * e o catálogo de etiquetas vêm de carregarCatalogos, uma vez por página.
 *
 * As leituras saem em paralelo com a checagem da sessão: quem decide o que
 * a pessoa enxerga é o RLS, e sem sessão o resultado é descartado.
 */
export async function carregarConversa(
  leadId: string,
  opcoes: { registrarAcesso?: boolean } = {},
): Promise<ConversaDoPainel | { erro: string }> {
  if (!leadId) return { erro: "Conversa não informada." };

  const supabase = await createClient();
  const [quem, ocultosR, leadR, interacoesR, vinculosR, recontatos] = await Promise.all([
    idDaSessao(),
    // A privacidade entre pessoas da equipe: leitura que falha é erro, não
    // "sem regra" (mostraria o que a regra esconde).
    donosOcultosParaMim().then(
      (ocultos) => ({ ocultos }),
      () => null,
    ),
    supabase
      .from("leads")
      .select(
        "id, nome, telefone_e164, instagram_id, ultima_interacao_em, marketing_bloqueado_em, responsavel_id, chat_resolvido_em, chat_lido_em, status, responsavel:profiles(nome)",
      )
      .eq("id", leadId)
      .maybeSingle(),
    supabase
      .from("lead_interactions")
      .select(CAMPOS_INTERACAO)
      .eq("lead_id", leadId)
      .in("tipo", [...TIPOS_MENSAGEM])
      .order("criado_em", { ascending: false })
      .limit(LOTE_ABERTURA),
    supabase.from("lead_tags").select("tag_id").eq("lead_id", leadId),
    // Os recontatos pendentes (a faixa no topo da conversa). Falha não
    // segura a abertura: a conversa abre sem a faixa.
    pendentesDoLead(supabase, leadId).catch(() => null),
  ]);
  if (!quem) return { erro: SESSAO_EXPIRADA };
  // Histórico que não veio não pode virar conversa vazia na tela: o
  // atendente leria "nunca falamos com ele" e mandaria a apresentação.
  if (leadR.error || interacoesR.error || !ocultosR) {
    return { erro: "Não deu para abrir a conversa. Tente de novo." };
  }

  const lead = leadR.data as unknown as {
    id: string;
    nome: string;
    telefone_e164: string | null;
    instagram_id: string | null;
    ultima_interacao_em: string | null;
    marketing_bloqueado_em: string | null;
    responsavel_id: string | null;
    chat_resolvido_em: string | null;
    chat_lido_em: string | null;
    status: string | null;
    responsavel: { nome: string } | null;
  } | null;
  if (!lead) return { erro: NAO_ENCONTRADO };
  // Dono oculto para quem pede: a mesma resposta do contato que não existe,
  // antes do log de acesso (ninguém "abriu" o que não viu) e sem nada que
  // a tela possa marcar como lido.
  if (donoOculto(lead.responsavel_id, ocultosR.ocultos)) {
    return { erro: NAO_ENCONTRADO };
  }

  // Só a ABERTURA da conversa entra no log — recarga periódica e volta de
  // aba não são "alguém olhou". E só depois de o RLS confirmar que a
  // pessoa enxerga o contato: tentativa fora do alcance não vira "abriu".
  if (opcoes.registrarAcesso) {
    registrarAcesso(quem, "abriu_conversa", {
      lead_id: leadId,
      nome: lead.nome,
    });
  }

  const linhas = (interacoesR.data ?? []) as unknown as LinhaBrutaInteracao[];
  const mensagens = marcarNaoLidas(
    linhas.map((m) => paraMensagem(m)).reverse(),
    lead.chat_lido_em,
  );

  // O canal sai da última mensagem recebida entre as carregadas (a mesma
  // regra do envio). Sem nenhuma recebida nas 200, vale o telefone.
  const ultimaRecebida = linhas.find((m) => m.tipo === "mensagem_recebida");
  const temTelefone = Boolean(lead.telefone_e164);
  const temDirect = Boolean(lead.instagram_id);
  const canal =
    canalDaResposta(
      { temTelefone, temDirect },
      ultimaRecebida ? recebidaPeloDirect(ultimaRecebida.metadados) : null,
    ) ?? "whatsapp";

  const formatoDia = new Intl.DateTimeFormat("pt-BR", {
    timeZone: "America/Sao_Paulo",
  });

  return {
    leadId: lead.id,
    nome: lead.nome,
    temConversa: mensagens.length > 0 || lead.ultima_interacao_em !== null,
    mensagens,
    temMaisAntigas: linhas.length === LOTE_ABERTURA,
    restanteJanela: restanteJanela24h(mensagens),
    canal,
    aceitaTemplate: temTelefone,
    temDirect,
    marketingBloqueado: lead.marketing_bloqueado_em !== null,
    hojeChave: formatoDia.format(new Date()),
    ontemChave: formatoDia.format(new Date(Date.now() - 86_400_000)),
    ferramentas: {
      responsavelId: lead.responsavel_id,
      responsavelNome: lead.responsavel?.nome ?? null,
      etiquetasLead: vinculosR.error
        ? null
        : ((vinculosR.data ?? []) as { tag_id: string }[]).map(
            (v) => v.tag_id,
          ),
      // Contato marcado como perdido no banco conta, na tela, como
      // conversa resolvida: fora da Caixa, com o reabrir à mão.
      conversaResolvida:
        Boolean(lead.chat_resolvido_em) || lead.status === "perdido",
    },
    recontatos,
  };
}

/**
 * As mensagens ANTERIORES às que já estão na tela. A conversa abre com as
 * 200 últimas (o que cobre quase tudo); em contato antigo, é por aqui que
 * o atendente alcança o começo da história.
 */
export async function carregarMensagensAnteriores(
  leadId: string,
  antesDeIso: string,
): Promise<{ mensagens: Mensagem[]; temMais: boolean } | { erro: string }> {
  if (!leadId || !antesDeIso) return { erro: "Conversa não informada." };

  const supabase = await createClient();
  const [quem, pode, { data, error }] = await Promise.all([
    idDaSessao(),
    // A regra de privacidade vale também para o histórico antigo.
    podeVerLead(leadId).catch(() => false),
    supabase
      .from("lead_interactions")
      .select(CAMPOS_INTERACAO)
      .eq("lead_id", leadId)
      .in("tipo", [...TIPOS_MENSAGEM])
      .lt("criado_em", antesDeIso)
      .order("criado_em", { ascending: false })
      .limit(LOTE_ANTERIORES),
  ]);
  if (!quem) return { erro: SESSAO_EXPIRADA };
  if (!pode) return { erro: NAO_ENCONTRADO };
  if (error) return { erro: "Não deu para carregar o histórico." };

  const linhas = (data ?? []) as unknown as LinhaBrutaInteracao[];
  return {
    mensagens: linhas.map((m) => paraMensagem(m)).reverse(),
    temMais: linhas.length === LOTE_ANTERIORES,
  };
}

/**
 * Templates aprovados, com prazo. Fora do prazo ou com erro, null: a tela
 * avisa que não carregou em vez de dizer que não há template. A lista da
 * Meta tem cache por instância (lib/whatsapp), então a busca que passou do
 * prazo ainda aquece a próxima.
 */
async function templatesComPrazo(): Promise<TemplateWhatsapp[] | null> {
  if (!metaConfigurada()) return [];
  let relogio: ReturnType<typeof setTimeout> | undefined;
  const prazo = new Promise<null>((resolve) => {
    relogio = setTimeout(() => resolve(null), PRAZO_TEMPLATES_MS);
  });
  try {
    return await Promise.race([listarTemplatesMeta(), prazo]);
  } catch {
    return null;
  } finally {
    clearTimeout(relogio);
  }
}

/**
 * O que não muda de uma conversa para outra — mensagens padrão, templates
 * da Meta, equipe e etiquetas —, carregado UMA vez por página, não a cada
 * conversa aberta nem a cada recarga dela.
 */
export async function carregarCatalogos(): Promise<
  CatalogosChat | { erro: string }
> {
  const supabase = await createClient();
  const [quem, prontasR, templates, equipeR, etiquetasR, horarioR] = await Promise.all([
    idDaSessao(),
    supabase
      .from("quick_replies")
      .select("id, titulo, corpo, anexos")
      .eq("ativo", true)
      .order("titulo"),
    templatesComPrazo(),
    supabase.from("profiles").select("id, nome").eq("ativo", true).order("nome"),
    supabase.from("tags").select("id, nome, cor, ativo").order("nome"),
    // O início do horário de atendimento é a hora padrão do recontato.
    supabase
      .from("settings")
      .select("valor")
      .eq("chave", CHAVE_HORARIO)
      .maybeSingle(),
  ]);
  if (!quem) return { erro: SESSAO_EXPIRADA };

  return {
    mensagensPadrao: prontasR.error
      ? null
      : ((prontasR.data ?? []) as MensagemPadrao[]),
    templates,
    equipe: equipeR.error ? null : ((equipeR.data ?? []) as MembroEquipe[]),
    etiquetas: etiquetasR.error
      ? null
      : ((etiquetasR.data ?? []) as EtiquetaCatalogo[]),
    // Sem linha, ou com erro, vale o padrão (lerHorario): 9h.
    horaRecontato: lerHorario(
      horarioR.error ? null : (horarioR.data as { valor: unknown } | null)?.valor,
    ).inicio,
  };
}
