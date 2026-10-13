"use server";

import { createClient } from "@/lib/supabase/server";
import { idDaSessao, perfilAtual, type PerfilSessao } from "@/lib/auth";
import { cargaDaEquipe } from "@/lib/distribuicao";
import { veioPeloDirect } from "@/lib/avatar";
import { ehGestao } from "@/lib/papeis";
import { donosOcultosParaMim } from "@/lib/privacidade";
import { semDonosOcultos } from "@/app/(app)/contatos/consulta";
import {
  cortarIdsFila,
  ehDataFila,
  ehUuid,
  intervaloDoPeriodo,
  SEM_DONO,
  termosDaBusca,
  type CanalFila,
  type ModoEtiquetas,
  type TermosBusca,
} from "@/app/(app)/chat/mensagem";
import { hojeEmBrasilia } from "@/app/(app)/chat/quando";
import {
  paraLinha,
  recontatoDoDia,
  type Recontato,
  type RecontatoDaLinha,
} from "@/app/(app)/chat/recontato";
import {
  pendentesDosLeads,
  pendentesVisiveis,
  primeiroDeCada,
} from "@/app/(app)/chat/recontato-dados";

/**
 * A fila do chat. A lista vive no navegador e cada gesto busca só o que
 * mudou: trocar de visão é UMA chamada, abrir uma conversa é outra
 * (carregarConversa, em chat/conversa.ts).
 *
 * As visões vêm do uso medido (9 dias úteis):
 *   caixa      — o dia real: conversas em aberto + adiadas VENCIDAS + as de
 *                recontato de hoje ou atrasado, qualquer que seja o estado
 *                delas (o adiamento que o recontato gravou pode ter sido
 *                trocado por outro gesto; resolvida e perdida também
 *                voltam). Quem espera mais, primeiro.
 *   aguardando — só quem espera resposta, em fila de verdade (FIFO).
 *   adiadas    — dormindo com hora para acordar (as no prazo).
 *   recontatos — as conversas com recontato pendente (chat/recontato.ts),
 *                do mais cedo para o mais tarde; a tela agrupa em
 *                Atrasados, Hoje e Próximos. O contador é o dos de hoje e
 *                atrasados.
 *   resolvidas — fechadas, mais recente primeiro. Contato marcado como
 *                perdido no banco também mora aqui: a view da Caixa o
 *                esconde, e sem isto ele sumiria de todas as filas.
 *   tudo       — o acervo, com busca e filtros finos.
 *
 * O escopo separa minhas, todas e sem dono (ninguém responsável). Escopo,
 * busca e os filtros finos (atendentes, etiquetas, campanha, canal, período
 * da última mensagem e "só não lidas") valem igual para a lista e para os
 * contadores do trilho: o contador conta exatamente o que a lista mostra.
 * A exceção é o semDono, que conta a Caixa sem dono qualquer que seja o
 * escopo ou o atendente, para a gestão ver o número antes de clicar (com
 * "só não lidas", pelas não lidas sem dono, que montarRecorte conta à parte
 * quando o recorte tem dono).
 *
 * Toda consulta da fila nasce em consultaDaFila, e cada visão é montada em
 * consultaDaVisao em cima dela: um recorte novo entra num lugar só e vale
 * para a lista, as fatias da Caixa e as contagens. É por ali que entra a
 * privacidade entre pessoas da equipe (Administração > Privacidade): a
 * conversa de um dono oculto para quem pede não aparece em visão nenhuma,
 * não conta em contador nenhum e não entra no "só não lidas".
 *
 * A busca acha por nome, telefone (pelos dígitos, a partir de 4), e-mail e
 * @ do Instagram, com a normalização de termosDaBusca (a mesma de
 * Contatos). A view não expõe e-mail nem @: esses dois saem de uma
 * consulta em leads que devolve os ids, e os ids entram no filtro da view.
 */

export type VisaoConversas =
  | "caixa"
  | "aguardando"
  | "adiadas"
  | "recontatos"
  | "resolvidas"
  | "tudo";

export type EscopoConversas = "minhas" | "todas" | "semDono";

/** Etiqueta da linha; a cor vem do catálogo (CatalogosChat), pelo id. */
export type EtiquetaDaLinha = { id: string; nome: string };

export type LinhaConversa = {
  leadId: string;
  nome: string;
  telefone: string | null;
  /** O @, para a prévia. Pode faltar em quem veio pelo Direct. */
  instagram: string | null;
  /** Veio pelo Direct (tem IGSID), com @ ou sem: só ele tem foto guardada.
   *  Alimenta o avatar da linha e o do cabeçalho da conversa. */
  direct: boolean;
  /** Prévia da última mensagem + de quem foi a vez. A apagada vem com o
   *  texto da bolha ("Mensagem apagada", "Apagada por Ana"), nunca o dela. */
  previa: string | null;
  vez: "eles" | "nos" | null;
  ultimaEm: string | null;
  esperaHoras: number | null;
  janelaAberta: boolean;
  /** O contato escreveu depois da última leitura (ou a conversa foi
   *  marcada não lida). Mensagem nossa, template e disparo não acendem. */
  naoLida: boolean;
  adiadaAte: string | null;
  adiadaVencida: boolean;
  /** Resolvida, ou contato marcado como perdido no banco. */
  resolvida: boolean;
  responsavelId: string | null;
  /** Quem está no atendimento — aparece acima do nome do contato na fila. */
  responsavelNome: string | null;
  /** Todas as etiquetas do contato, em ordem de nome. */
  etiquetas: EtiquetaDaLinha[];
  sub: string | null;
  /** O recontato pendente mais cedo do contato. Do dia (ou atrasado), a
   *  linha mostra "Recontato: motivo" no lugar da prévia. */
  recontato: RecontatoDaLinha | null;
};

export type Contagens = {
  caixa: number;
  aguardando: number;
  adiadas: number;
  resolvidas: number;
  /** Conversas da Caixa sem dono, com a busca, a etiqueta e o "só não
   *  lidas" em uso mas QUALQUER que seja o escopo ou o atendente: o "Sem
   *  dono 7" do seletor de escopo. O servidor sempre manda; é opcional só para a conta
   *  otimista da tela, que monta o objeto à mão. Para o papel atendente o
   *  RLS só mostra as dele, e o número é sempre 0. */
  semDono?: number;
  /** Conversas com recontato de hoje ou atrasado, no mesmo recorte. Opcional
   *  pelo mesmo motivo do semDono. */
  recontatos?: number;
};

export type CargaConversas = {
  linhas: LinhaConversa[];
  /** null quando não foram contadas (página seguinte, comContagens: false
   *  ou uma das contagens falhou): a tela mantém as que já tem. */
  contagens: Contagens | null;
  temMais: boolean;
  /** Só na Caixa, que não pagina: ficou conversa em aberto fora da lista
   *  (a lista tem menos linhas que a contagem da Caixa; quem espera
   *  resposta vem antes, até 150). A tela mostra "N de M" com o contador,
   *  em vez de passar a lista por fila inteira. */
  cortada: boolean;
  /** "Só não lidas" achou mais do que cabe no filtro: o teto (a lista traz
   *  as N mais recentes, e a tela diz quantas). 0 ou ausente: coube tudo. */
  naoLidasNoTeto?: number;
  /** "Só não lidas" procura entre as N conversas do recorte que receberam
   *  mensagem por último, e a janela encheu: não lida mais antiga que elas
   *  pode ter ficado de fora (a tela diz o N). 0 ou ausente: coube tudo. */
  naoLidasJanela?: number;
  /** O próximo instante em que alguma conversa volta sozinha (o fim de um
   *  adiamento com hora, um recontato): a tela relê a fila nessa hora, e o
   *  "Por 1 hora" volta à Caixa sem ninguém recarregar. null = nada
   *  marcado; ausente = não foi contado (página seguinte). */
  proximaVolta?: string | null;
};

/** Uma campanha para o filtro da fila. */
export type CampanhaDaFila = {
  id: string;
  nome: string;
  status: "ativa" | "pausada" | "concluida";
};

/** Carga de uma pessoa da equipe, para a gestão distribuir vendo o número. */
export type CargaAtendente = {
  id: string;
  nome: string;
  /** Conversas abertas no nome dela, pela conta do rodízio: não resolvida,
   *  com alguma mensagem trocada, contato não perdido. Adiada conta. */
  abertas: number;
  /** Entra no rodízio da distribuição automática (profiles.recebe_leads). */
  noRodizio: boolean;
};

/**
 * Os filtros da lista. O formato é o de FiltrosFila (chat/mensagem.ts), e a
 * tela passa os dela direto. Tudo chega do navegador: o servidor confere
 * cada valor (uuid, data) antes de pôr num filtro do PostgREST.
 */
export type OpcoesLista = {
  escopo: EscopoConversas;
  busca?: string;
  /** ids dos atendentes; SEM_DONO entra para "sem dono". */
  atendentes?: string[];
  /** ids das etiquetas, somadas como diz `etiquetasModo`. */
  etiquetas?: string[];
  /** "todas": o contato precisa ter cada etiqueta escolhida. Ausente ou
   *  "qualquer": basta uma. */
  etiquetasModo?: ModoEtiquetas;
  /** Só contato sem etiqueta nenhuma. Vence `etiquetas`. */
  semEtiqueta?: boolean;
  /** Só quem recebeu esta campanha (campanha_envios sem erro). */
  campanhaId?: string;
  canal?: CanalFila | "";
  /** Período da última mensagem: "hoje", "7d", "30d" ou AAAA-MM-DD. */
  de?: string;
  /** Último dia do período, AAAA-MM-DD. */
  ate?: string;
  naoLidas?: boolean;
  offset?: number;
  /** Quantas linhas trazer de uma vez: a recarga silenciosa relê tudo o que
   *  o atendente já carregou, não só a primeira página. Nunca menos que uma
   *  página nem mais que LIMITE_MAXIMO. A Caixa não pagina e ignora. */
  limite?: number;
  /** Contar as visões do trilho. Só vale na primeira página (offset 0);
   *  padrão true. */
  comContagens?: boolean;
  /** Quem chama já tem o perfil (o server component da página): poupa a
   *  conferência da sessão. Só o id é usado, e só para o escopo "minhas" —
   *  o que a pessoa enxerga quem decide é o RLS, não este parâmetro. */
  perfil?: Pick<PerfilSessao, "id">;
};

const PAGINA = 60;
// Teto da recarga de várias páginas: a prévia e as colunas de leads saem
// por id, e a lista de ids não pode crescer sem fim.
const LIMITE_MAXIMO = 300;

// As quatro fatias da Caixa. Somadas (300) não passam do LIMITE_MAXIMO,
// que vale também para a segunda onda (in("id", ids) e previas_conversas).
const CAIXA_ESPERANDO = 150;
const CAIXA_ABERTAS = 80;
const CAIXA_VENCIDAS = 40;
const CAIXA_RECONTATOS = 30;

// Ids achados por e-mail ou @ entram no .or() da view como lead_id.in.(…):
// cada id ocupa 37 caracteres da URL, e 100 cabem com folga.
const IDS_DA_BUSCA = 100;

// "Só não lidas": o PostgREST não compara coluna com coluna (a leitura com a
// última mensagem recebida), então a conta fecha aqui, sobre as 500
// conversas do recorte que receberam mensagem por último. Os ids das não
// lidas entram no filtro; 100 cabem na URL junto com os 100 da busca.
const CANDIDATAS_NAO_LIDAS = 500;
const IDS_NAO_LIDAS = 100;
// A leitura (chat_lido_em) das candidatas sai de leads por id, em fatias que
// cabem na URL (a segunda onda da fila já lê 300 de uma vez).
const FATIA_LEITURA = 250;

// As campanhas que o filtro oferece, da mais recente para trás.
const MAX_CAMPANHAS = 50;

// Um uuid que não existe: "só não lidas" sem nenhuma não lida vira fila
// vazia pela mesma consulta (in.() vazio é erro no PostgREST).
const NENHUM_ID = "00000000-0000-0000-0000-000000000000";

// Quantas conversas com recontato entram por vez (os ids vão na URL, como
// os da segunda onda). Do mais cedo para o mais tarde: os de hoje e os
// atrasados nunca ficam de fora por causa dos próximos.
const MAX_RECONTATOS = 200;

// A marca de apagada das prévias sai pelos pares (lead_id, criado_em) da
// página: cada par leva o id e a hora na URL (uns 85 caracteres), e 100
// ocupam menos que os 300 ids da segunda onda.
const FATIA_APAGADAS = 100;

// O prazo-sentinela do "até responder" (chat/actions.ts) fica fora da
// próxima volta: ele nunca vence sozinho.
const ANTES_DO_SENTINELA = "9000-01-01T00:00:00.000Z";

const SESSAO_EXPIRADA = "Sessão expirada. Entre de novo.";

type LinhaView = {
  lead_id: string;
  nome: string;
  telefone_e164: string | null;
  status: string | null;
  responsavel_id: string | null;
  responsavel_nome: string | null;
  ultima_mensagem_em: string | null;
  /** A última mensagem que o CONTATO mandou (0062). É ela, e não a última
   *  em qualquer direção, que decide a não lida. */
  ultima_recebida_em: string | null;
  horas_esperando: number | null;
  janela_aberta: boolean | null;
  adiado_vencido: boolean | null;
  etiqueta_ids: string[] | null;
  etiquetas: string[] | null;
};

/** Colunas de leads que a view não expõe. */
type ExtrasLead = {
  id: string;
  instagram_id: string | null;
  instagram_usuario: string | null;
  chat_lido_em: string | null;
  chat_adiado_em: string | null;
  chat_adiado_ate: string | null;
  chat_resolvido_em: string | null;
};

/** A última mensagem de cada conversa, como previas_conversas (0045) dá. */
type PreviaConversa = {
  lead_id: string;
  tipo: string;
  conteudo: string | null;
  criado_em: string;
};

/**
 * O que a prévia mostra no lugar da mensagem apagada: o mesmo texto da
 * bolha (TextoApagada, em chat/bolha.tsx), lido como lerApagada lê a marca
 * (chat/mensagem.ts). null = a marca não é um objeto: não está apagada.
 */
function rotuloApagada(bruto: unknown): string | null {
  if (typeof bruto !== "object" || bruto === null || Array.isArray(bruto)) {
    return null;
  }
  const marca = bruto as { por?: unknown; nome?: unknown };
  if (marca.por !== "equipe") return "Mensagem apagada";
  return typeof marca.nome === "string" && marca.nome.trim()
    ? `Apagada por ${marca.nome}`
    : "Apagada pela equipe";
}

const CAMPOS_VIEW =
  "lead_id, nome, telefone_e164, status, responsavel_id, responsavel_nome, ultima_mensagem_em, ultima_recebida_em, horas_esperando, janela_aberta, adiado_vencido, etiqueta_ids, etiquetas";

const CAMPOS_EXTRAS =
  "id, instagram_id, instagram_usuario, chat_lido_em, chat_adiado_em, chat_adiado_ate, chat_resolvido_em";

/** Uma linha só no PostgREST: em aberto com conversa, ou adiada vencida. */
const FILTRO_CAIXA =
  "and(em_aberto.eq.true,ultima_mensagem_em.not.is.null),adiado_vencido.eq.true";

/** O filtro da Caixa com os contatos de recontato de hoje e atrasado: no
 *  dia, é o recontato que traz a conversa, e não o adiamento (que outro
 *  gesto pode ter trocado: outro recontato, o Adiar comum, o Resolver). */
function filtroDaCaixa(r: RecorteDaFila): string {
  const doDia = r.recontatos.doDia;
  return doDia.length > 0
    ? `${FILTRO_CAIXA},lead_id.in.(${doDia.join(",")})`
    : FILTRO_CAIXA;
}

/* ── o recorte e o ponto único das consultas ─────────────────────────── */

type Cliente = Awaited<ReturnType<typeof createClient>>;

/** De onde a consulta lê: a view das listas ou a tabela de leads. */
type Fonte = "view" | "leads";

/**
 * O recorte da fila pronto para o PostgREST: o que a tela pediu, conferido
 * (uuid, data) e resolvido em ids e instantes.
 */
type RecorteDaFila = {
  escopo: EscopoConversas;
  /** Quem está logado; só o escopo "minhas" usa. */
  meuId: string | null;
  /** ids dos atendentes escolhidos, sem o "sem dono". */
  atendentes: string[];
  /** "Sem dono" marcado entre os atendentes. */
  comSemDono: boolean;
  /** Vazia com semEtiqueta (um exclui o outro). */
  etiquetas: string[];
  /** As etiquetas valem todas juntas (e não qualquer uma). */
  etiquetasTodas: boolean;
  /** Só contato sem nenhuma etiqueta. */
  semEtiqueta: boolean;
  campanhaId: string | null;
  canal: CanalFila | null;
  /** A última mensagem a partir deste instante (inclusive)... */
  desde: string | null;
  /** ...e antes deste (exclusivo). */
  ateAntes: string | null;
  /** null = sem "só não lidas"; senão os ids, nunca vazio. */
  idsNaoLidas: string[] | null;
  /** As não lidas sem dono, para a contagem semDono, que ignora escopo e
   *  atendentes: as de idsNaoLidas já passaram pelo dono. null fora do
   *  "só não lidas" ou sem as contagens; nunca vazio. */
  idsNaoLidasSemDono: string[] | null;
  termos: TermosBusca | null;
  /** Achados por e-mail ou @, que a view não expõe. */
  idsDaBusca: string[];
  /** Os responsáveis cujas conversas quem pede não vê
   *  (donosOcultosParaMim); vazio para o admin e sem regra. */
  donosOcultos: string[];
  /** Os contatos com recontato pendente (todos) e os de hoje e atrasados
   *  (doDia), do mais cedo para o mais tarde. A visão Recontatos, o
   *  contador dela e a Caixa (doDia) partem daqui. */
  recontatos: { todos: string[]; doDia: string[] };
};

type OpcoesConsulta = {
  /** Só a contagem (head), sem linhas. */
  contada?: boolean;
  /** false deixa escopo e atendentes de fora (a contagem semDono). */
  comDono?: boolean;
};

/**
 * O PONTO ÚNICO DA FILA. Toda consulta da lista, das fatias da Caixa e das
 * contagens nasce aqui, na view (v_leads_listas) ou na tabela (leads), com o
 * recorte inteiro: busca, dono, etiquetas, campanha, canal, período, "só
 * não lidas" e os donos ocultos. Recorte novo entra aqui e vale para todas
 * as visões e contagens.
 *
 * Os filtros por relação usam o vínculo embutido com !inner (e o "sem
 * etiqueta", o vínculo vazio), cada um com apelido próprio (f_*): o mesmo
 * vínculo pode vir embutido de novo, sem filtro, em quem chama.
 */
function consultaDaFila(
  supabase: Cliente,
  fonte: Fonte,
  campos: string,
  r: RecorteDaFila,
  { contada = false, comDono = true }: OpcoesConsulta = {},
  // eslint-disable-next-line @typescript-eslint/no-explicit-any -- corta a recursão de tipos do builder
): any {
  const naView = fonte === "view";
  const id = naView ? "lead_id" : "id";
  // A última mensagem: na view, a calculada (a mesma que a linha mostra);
  // na tabela, a última interação, que o envio e o webhook carimbam.
  const ultima = naView ? "ultima_mensagem_em" : "ultima_interacao_em";

  // Na tabela as etiquetas filtram pelo vínculo (na view, pelo array).
  // Sem etiqueta: o vínculo embutido sem !inner e vazio (is.null), o
  // anti-join do PostgREST. Todas: um vínculo !inner por etiqueta, cada um
  // com a sua. Qualquer uma: um vínculo !inner só, com o in.
  const embutidos: string[] = [];
  if (!naView) {
    if (r.semEtiqueta) {
      embutidos.push("f_sem_etiqueta:lead_tags()");
    } else if (r.etiquetas.length > 0 && r.etiquetasTodas) {
      r.etiquetas.forEach((_, i) =>
        embutidos.push(`f_etiqueta_${i}:lead_tags!inner()`),
      );
    } else if (r.etiquetas.length > 0) {
      embutidos.push("f_etiquetas:lead_tags!inner(tag_id)");
    }
  }
  if (r.campanhaId) {
    embutidos.push("f_campanha:campanha_envios!inner(campanha_id)");
  }
  if (r.canal === "direct") {
    embutidos.push("f_direct:lead_interactions!inner(id)");
  }

  let q = supabase
    .from(naView ? "v_leads_listas" : "leads")
    .select(
      [campos, ...embutidos].join(", "),
      contada ? { count: "exact" as const, head: true } : undefined,
    );

  // Busca. Na tabela, e-mail e @ entram direto pela coluna; na view, pelos
  // ids achados antes (lista vazia não entra: in.() vazio é erro).
  if (r.termos) {
    const t = r.termos;
    const alvos = [`nome.ilike.%${t.termo}%`];
    if (t.digitos) alvos.push(`telefone_e164.ilike.%${t.digitos}%`);
    if (!naView) {
      alvos.push(`email.ilike.%${t.termo}%`);
      if (t.usuario) alvos.push(`instagram_usuario.ilike.%${t.usuario}%`);
    } else if (r.idsDaBusca.length > 0) {
      alvos.push(`lead_id.in.(${r.idsDaBusca.join(",")})`);
    }
    q = q.or(alvos.join(","));
  }

  // Dono: escopo e atendentes (as colunas têm o mesmo nome nas duas fontes).
  if (comDono) {
    if (r.escopo === "minhas") q = q.eq("responsavel_id", r.meuId);
    if (r.escopo === "semDono") q = q.is("responsavel_id", null);
    if (r.atendentes.length > 0 && r.comSemDono) {
      q = q.or(
        `responsavel_id.in.(${r.atendentes.join(",")}),responsavel_id.is.null`,
      );
    } else if (r.atendentes.length > 0) {
      q = q.in("responsavel_id", r.atendentes);
    } else if (r.comSemDono) {
      q = q.is("responsavel_id", null);
    }
  }

  // Privacidade: fora do bloco do dono, porque vale também onde ele é
  // pulado (a contagem semDono). Sem dono continua; dono oculto, não.
  q = semDonosOcultos(q, r.donosOcultos);

  // Etiquetas. A view traz o array (coalesce para '{}' sem nenhuma): sem
  // etiqueta é o array vazio, todas é o contains e qualquer uma, o
  // overlap. A tabela filtra pelos vínculos embutidos lá em cima.
  if (r.semEtiqueta) {
    q = naView
      ? q.eq("etiqueta_ids", "{}")
      : q.is("f_sem_etiqueta", null);
  } else if (r.etiquetas.length > 0) {
    if (naView) {
      q = r.etiquetasTodas
        ? q.contains("etiqueta_ids", r.etiquetas)
        : q.overlaps("etiqueta_ids", r.etiquetas);
    } else if (r.etiquetasTodas) {
      r.etiquetas.forEach((tagId, i) => {
        q = q.eq(`f_etiqueta_${i}.tag_id`, tagId);
      });
    } else {
      q = q.in("f_etiquetas.tag_id", r.etiquetas);
    }
  }

  // Campanha: quem recebeu. O envio que falhou (na hora ou avisado depois
  // pela Meta) grava o erro e não conta.
  if (r.campanhaId) {
    q = q
      .eq("f_campanha.campanha_id", r.campanhaId)
      .is("f_campanha.erro", null);
  }

  // Canal. WhatsApp: tem telefone. Direct: já escreveu pelo Direct (a regra
  // de recebidaPeloDirect); uma mensagem basta.
  if (r.canal === "whatsapp") q = q.not("telefone_e164", "is", null);
  if (r.canal === "direct") {
    q = q
      .eq("f_direct.tipo", "mensagem_recebida")
      .or("metadados->>canal.eq.instagram,metadados->>igsid.not.is.null", {
        referencedTable: "f_direct",
      })
      .limit(1, { referencedTable: "f_direct" });
  }

  if (r.desde) q = q.gte(ultima, r.desde);
  if (r.ateAntes) q = q.lt(ultima, r.ateAntes);

  // "Só não lidas". Sem o dono (a contagem semDono), valem as sem dono da
  // conta à parte: as do recorte saíram só do dono escolhido.
  const naoLidas = comDono
    ? r.idsNaoLidas
    : (r.idsNaoLidasSemDono ?? r.idsNaoLidas);
  if (naoLidas) q = q.in(id, naoLidas);

  return q;
}

/**
 * Cada visão em cima de consultaDaFila. Adiada e resolvida são estado de
 * LEADS (a view não separa uma da outra): a fonte é a tabela. A Caixa lista
 * em quatro fatias (em carregarListaConversas), mas conta por aqui.
 */
function consultaDaVisao(
  supabase: Cliente,
  visao: VisaoConversas,
  campos: string,
  r: RecorteDaFila,
  opcoes: OpcoesConsulta = {},
  // eslint-disable-next-line @typescript-eslint/no-explicit-any -- corta a recursão de tipos do builder
): any {
  switch (visao) {
    case "caixa":
      return consultaDaFila(supabase, "view", campos, r, opcoes).or(
        filtroDaCaixa(r),
      );
    case "aguardando":
      return consultaDaFila(supabase, "view", campos, r, opcoes).eq(
        "aguardando_resposta",
        true,
      );
    case "adiadas": {
      // No prazo pela hora marcada OU, para o que foi adiado sem prazo
      // gravado, pela heurística de 3 dias — a mesma regra da view.
      // Vencida mora na Caixa, não aqui. Perdido não é adiado: é resolvido.
      const agoraIso = new Date().toISOString();
      const tresDias = new Date(Date.now() - 3 * 86_400_000).toISOString();
      return consultaDaFila(supabase, "leads", campos, r, opcoes)
        .not("chat_adiado_em", "is", null)
        .is("chat_resolvido_em", null)
        .neq("status", "perdido")
        .or(
          `chat_adiado_ate.gte.${agoraIso},and(chat_adiado_ate.is.null,chat_adiado_em.gte.${tresDias})`,
        );
    }
    case "recontatos":
      // Com ou sem conversa, aberta ou resolvida: o recontato é que manda.
      return consultaDaFila(supabase, "view", campos, r, opcoes).in(
        "lead_id",
        r.recontatos.todos.length > 0 ? r.recontatos.todos : [NENHUM_ID],
      );
    case "resolvidas":
      // Resolvida à mão, ou perdida no banco com conversa de verdade
      // (contato importado que nunca trocou mensagem não é conversa
      // resolvida).
      return consultaDaFila(supabase, "leads", campos, r, opcoes).or(
        "chat_resolvido_em.not.is.null,and(status.eq.perdido,ultima_interacao_em.not.is.null)",
      );
    case "tudo":
      return consultaDaFila(supabase, "view", campos, r, opcoes).not(
        "ultima_mensagem_em",
        "is",
        null,
      );
  }
}

/** Uma lista que veio do navegador, só com texto, sem repetir. */
function textos(valor: unknown): string[] {
  return Array.isArray(valor)
    ? [...new Set(valor.filter((v): v is string => typeof v === "string"))]
    : [];
}

/** Uma não lida achada: o dono (para a conta sem dono) e o instante que
 *  ordena (a última mensagem recebida ou, sem leitura nenhuma, a última
 *  interação). */
type NaoLidaAchada = { id: string; dono: string | null; em: string };

type NaoLidasAchadas = {
  /** Da mais recente para trás, sem repetir e sem teto. */
  achadas: NaoLidaAchada[];
  /** As candidatas encheram a janela: não lida mais antiga que a última
   *  delas pode ter ficado de fora. */
  janelaCheia: boolean;
};

/**
 * Confere os filtros que vieram do navegador e resolve em ids o que a view
 * não filtra sozinha: a busca por e-mail e @ e o "só não lidas". A busca
 * espera os donos ocultos, para não gastar vaga com quem a pessoa não vê; o
 * "só não lidas" espera os dois, porque já filtra pelos ocultos e, com
 * termo, precisa dos ids da busca.
 */
async function montarRecorte(
  supabase: Cliente,
  opts: OpcoesLista,
  meuId: string | null,
  ocultosP: Promise<string[] | { erro: string }>,
  /** As contagens do trilho vêm junto (a conta sem dono depende disso). */
  comContagens: boolean,
): Promise<
  | { recorte: RecorteDaFila; naoLidasNoTeto: number; naoLidasJanela: number }
  | { erro: string }
> {
  const escopo: EscopoConversas =
    opts.escopo === "minhas" || opts.escopo === "semDono"
      ? opts.escopo
      : "todas";
  // No teto e na ordem da URL (cortarIdsFila): o servidor fica com os mesmos
  // 30 que a tela mostra, chegue a lista em que ordem chegar.
  const brutos = cortarIdsFila(
    textos(opts.atendentes).filter((id) => id === SEM_DONO || ehUuid(id)),
  );
  // "Minhas" e "Sem dono" já dizem quem atende: a lista de atendentes só
  // vale em "Todas".
  const atendentes =
    escopo === "todas" ? brutos.filter((id) => id !== SEM_DONO) : [];
  const comSemDono = escopo === "todas" && brutos.includes(SEM_DONO);
  const de = typeof opts.de === "string" ? opts.de : "";
  const ate = ehDataFila(opts.ate) ? opts.ate : "";
  const { desde, ateAntes } = intervaloDoPeriodo(de, ate);
  const termos = termosDaBusca(typeof opts.busca === "string" ? opts.busca : "");

  // "Sem etiqueta" exclui as etiquetas, como na URL (lerFiltrosFila).
  const semEtiqueta = opts.semEtiqueta === true;
  const etiquetas = semEtiqueta
    ? []
    : cortarIdsFila(textos(opts.etiquetas).filter((id) => ehUuid(id)));

  const recortePronto = (donosOcultos: string[]): RecorteDaFila => ({
    escopo,
    meuId,
    atendentes,
    comSemDono,
    etiquetas,
    etiquetasTodas: opts.etiquetasModo === "todas",
    semEtiqueta,
    campanhaId: ehUuid(opts.campanhaId) ? opts.campanhaId : null,
    canal:
      opts.canal === "whatsapp" || opts.canal === "direct" ? opts.canal : null,
    desde,
    ateAntes,
    idsNaoLidas: null,
    idsNaoLidasSemDono: null,
    termos,
    idsDaBusca: [],
    donosOcultos,
    recontatos: { todos: [], doDia: [] },
  });

  // E-mail e @ não estão na view: os ids de quem casa saem de leads antes
  // das consultas da fila (o RLS recorta igual), já sem os donos ocultos. Sem
  // isso, contato de dono oculto ocupava uma das 100 vagas, caía depois no
  // filtro da fila, e quem a pessoa vê e casa pelo e-mail ficava de fora.
  // Falha aqui não derruba a fila: a busca segue por nome e telefone.
  const buscaP: Promise<string[]> = termos
    ? ocultosP.then((ocultos) =>
        "erro" in ocultos
          ? []
          : Promise.resolve(
              semDonosOcultos(
                supabase
                  .from("leads")
                  .select("id")
                  .or(
                    [
                      `email.ilike.%${termos.termo}%`,
                      ...(termos.usuario
                        ? [`instagram_usuario.ilike.%${termos.usuario}%`]
                        : []),
                    ].join(","),
                  ),
                ocultos,
              ).limit(IDS_DA_BUSCA),
            ).then(
              ({ data }) => ((data ?? []) as { id: string }[]).map((l) => l.id),
              () => [],
            ),
      )
    : Promise.resolve([]);

  // "Só não lidas". Não lida é a regra da linha: o contato escreveu depois
  // da leitura, ou a conversa nunca foi aberta (ou foi marcada não lida, o
  // que zera chat_lido_em) e tem alguma mensagem. Duas consultas do recorte
  // (a mesma busca, dono, etiquetas, campanha, canal, período e donos
  // ocultos) correm juntas:
  //   recebidas   — da view, as conversas que RECEBERAM mensagem por último,
  //                 e depois a leitura delas em leads, por id. A ordem é a
  //                 da última recebida, não a da última interação: cada
  //                 envio de campanha carimba ultima_interacao_em e
  //                 chat_lido_em no destinatário (lib/campanhas.ts), e um
  //                 disparo de 500 enchia a janela de conversas já lidas
  //                 enquanto quem escreveu antes sumia do filtro.
  //   sem leitura — de leads, chat_lido_em nulo com alguma conversa: não
  //                 lida sem precisar comparar nada.
  type Recebida = {
    lead_id: string;
    responsavel_id: string | null;
    ultima_recebida_em: string;
  };
  type SemLeitura = {
    id: string;
    responsavel_id: string | null;
    ultima_interacao_em: string;
  };
  type Resposta<T> = { data: T[] | null; error: { message: string } | null };
  const naoLidasDoRecorte = async (
    recorte: RecorteDaFila,
    { soSemDono = false }: { soSemDono?: boolean } = {},
  ): Promise<NaoLidasAchadas | { erro: string }> => {
    // A conta sem dono ignora escopo e atendentes, como a contagem semDono.
    const opcoes: OpcoesConsulta = { comDono: !soSemDono };
    // eslint-disable-next-line @typescript-eslint/no-explicit-any -- builder
    const doDono = (q: any): any =>
      soSemDono ? q.is("responsavel_id", null) : q;
    try {
      const [recebidasR, semLeituraR] = (await Promise.all([
        doDono(
          consultaDaFila(
            supabase,
            "view",
            "lead_id, responsavel_id, ultima_recebida_em",
            recorte,
            opcoes,
          ),
        )
          .not("ultima_recebida_em", "is", null)
          .order("ultima_recebida_em", { ascending: false })
          .limit(CANDIDATAS_NAO_LIDAS),
        doDono(
          consultaDaFila(
            supabase,
            "leads",
            "id, responsavel_id, ultima_interacao_em",
            recorte,
            opcoes,
          ),
        )
          .is("chat_lido_em", null)
          .not("ultima_interacao_em", "is", null)
          .order("ultima_interacao_em", { ascending: false })
          .limit(IDS_NAO_LIDAS + 1),
      ])) as [Resposta<Recebida>, Resposta<SemLeitura>];
      // Sem a conta, a fila mostraria lidas como se fossem não lidas.
      const falha = recebidasR.error ?? semLeituraR.error;
      if (falha) return { erro: falha.message };
      const recebidas = recebidasR.data ?? [];

      const fatias: string[][] = [];
      for (let i = 0; i < recebidas.length; i += FATIA_LEITURA) {
        fatias.push(
          recebidas.slice(i, i + FATIA_LEITURA).map((l) => l.lead_id),
        );
      }
      const leituras = (await Promise.all(
        fatias.map((ids) =>
          supabase.from("leads").select("id, chat_lido_em").in("id", ids),
        ),
      )) as Resposta<{ id: string; chat_lido_em: string | null }>[];
      const falhaLeitura = leituras.find((r) => r.error)?.error;
      if (falhaLeitura) return { erro: falhaLeitura.message };
      const lidaEm = new Map<string, string | null>();
      for (const r of leituras) {
        for (const l of r.data ?? []) lidaEm.set(l.id, l.chat_lido_em);
      }

      const achadas = new Map<string, NaoLidaAchada>();
      for (const l of recebidas) {
        // Sem a leitura (o RLS não devolveu o lead), não há o que comparar.
        if (!lidaEm.has(l.lead_id)) continue;
        const lida = lidaEm.get(l.lead_id);
        if (lida && l.ultima_recebida_em <= lida) continue;
        achadas.set(l.lead_id, {
          id: l.lead_id,
          dono: l.responsavel_id,
          em: l.ultima_recebida_em,
        });
      }
      for (const l of semLeituraR.data ?? []) {
        const ja = achadas.get(l.id);
        if (!ja || l.ultima_interacao_em > ja.em) {
          achadas.set(l.id, {
            id: l.id,
            dono: l.responsavel_id,
            em: l.ultima_interacao_em,
          });
        }
      }
      return {
        achadas: [...achadas.values()].sort((a, b) =>
          b.em.localeCompare(a.em),
        ),
        janelaCheia: recebidas.length === CANDIDATAS_NAO_LIDAS,
      };
    } catch {
      return { erro: "A conexão não respondeu. Tente de novo." };
    }
  };

  // A contagem "Sem dono" do escopo conta a Caixa sem dono QUALQUER que seja
  // o escopo ou o atendente (Contagens.semDono). Em "Minhas" ou com
  // atendentes escolhidos, as não lidas do recorte são só deles: as sem dono
  // saem de uma conta à parte. Em "Todas" sem atendente e em "Sem dono",
  // elas já estão no conjunto do recorte.
  const contaSemDonoAParte =
    comContagens && (escopo === "minhas" || atendentes.length > 0);
  const naoLidasP: Promise<
    | { doRecorte: NaoLidasAchadas; semDono: NaoLidasAchadas | null }
    | { erro: string }
    | null
  > =
    opts.naoLidas === true
      ? // A consulta das recebidas é na view, que só acha e-mail e @ pelos
        // ids da busca: com termo, ela espera a busca.
        Promise.all([ocultosP, buscaP]).then(async ([ocultos, idsDaBusca]) => {
          if ("erro" in ocultos) return ocultos;
          const base = { ...recortePronto(ocultos), idsDaBusca };
          const [doRecorte, semDono] = await Promise.all([
            naoLidasDoRecorte(base),
            contaSemDonoAParte
              ? naoLidasDoRecorte(base, { soSemDono: true })
              : Promise.resolve(null),
          ]);
          if ("erro" in doRecorte) return doRecorte;
          if (semDono && "erro" in semDono) return semDono;
          return { doRecorte, semDono };
        })
      : Promise.resolve(null);

  const [idsDaBusca, naoLidas, ocultos] = await Promise.all([
    buscaP,
    naoLidasP,
    ocultosP,
  ]);
  if ("erro" in ocultos) return { erro: ocultos.erro };
  if (naoLidas && "erro" in naoLidas) return { erro: naoLidas.erro };
  if (!naoLidas) {
    return {
      recorte: { ...recortePronto(ocultos), idsDaBusca },
      naoLidasNoTeto: 0,
      naoLidasJanela: 0,
    };
  }

  // Nenhuma não lida vira fila vazia pela mesma consulta (in.() vazio é
  // erro no PostgREST).
  const ids = (achadas: NaoLidaAchada[]): string[] => {
    const lista = achadas.slice(0, IDS_NAO_LIDAS).map((a) => a.id);
    return lista.length > 0 ? lista : [NENHUM_ID];
  };
  const { doRecorte, semDono } = naoLidas;
  return {
    recorte: {
      ...recortePronto(ocultos),
      idsDaBusca,
      idsNaoLidas: ids(doRecorte.achadas),
      idsNaoLidasSemDono: comContagens
        ? ids((semDono ?? doRecorte).achadas.filter((a) => a.dono === null))
        : null,
    },
    naoLidasNoTeto: doRecorte.achadas.length > IDS_NAO_LIDAS ? IDS_NAO_LIDAS : 0,
    naoLidasJanela: doRecorte.janelaCheia ? CANDIDATAS_NAO_LIDAS : 0,
  };
}

/**
 * Os recontatos pendentes no formato da fila: o mais cedo de cada contato
 * (o que a linha mostra) e os ids que o recorte usa, todos (até
 * MAX_RECONTATOS) e os de hoje e atrasados. Do mais cedo para o mais tarde:
 * os do dia nunca ficam de fora por causa dos próximos.
 */
function recontatosDaFila(
  pendentes: Recontato[],
  hoje: string,
): {
  porLead: Map<string, RecontatoDaLinha>;
  ids: RecorteDaFila["recontatos"];
} {
  const porLead = new Map<string, RecontatoDaLinha>();
  for (const [leadId, r] of primeiroDeCada(pendentes)) {
    porLead.set(leadId, paraLinha(r));
  }
  const todos = [...porLead.keys()].slice(0, MAX_RECONTATOS);
  return {
    porLead,
    ids: {
      todos,
      doDia: todos.filter((id) => {
        const r = porLead.get(id);
        return r ? recontatoDoDia(r, hoje) : false;
      }),
    },
  };
}

export async function carregarListaConversas(
  visao: VisaoConversas,
  opts: OpcoesLista,
): Promise<CargaConversas | { erro: string }> {
  // O id só é pré-requisito do escopo "minhas"; nos outros, a checagem da
  // sessão corre em paralelo com as consultas.
  const quemP: Promise<string | null> = opts.perfil
    ? Promise.resolve(opts.perfil.id)
    : idDaSessao();
  // Os donos que esta pessoa não vê (Administração > Privacidade), lidos
  // desde já, em paralelo com o resto. Erro de leitura é erro da fila, não
  // "sem regra": a lista mostraria o que a regra esconde.
  const ocultosP: Promise<string[] | { erro: string }> =
    donosOcultosParaMim().catch(() => ({
      erro: "As regras de privacidade não carregaram. Tente de novo.",
    }));
  let meuId: string | null = null;
  if (opts.escopo === "minhas") {
    meuId = await quemP;
    if (!meuId) return { erro: SESSAO_EXPIRADA };
  }

  const supabase = await createClient();
  const offset = Math.max(0, opts.offset ?? 0);
  const tamanho =
    typeof opts.limite === "number" && Number.isFinite(opts.limite)
      ? Math.min(Math.max(PAGINA, Math.trunc(opts.limite)), LIMITE_MAXIMO)
      : PAGINA;
  const contar = offset === 0 && opts.comContagens !== false;
  // Os recontatos pendentes que a pessoa vê (o RLS decide). A fila inteira
  // é uma varredura de um ano de notas: só sai quando os contadores (o de
  // Recontatos, o da Caixa e a próxima volta), a Caixa ou a visão
  // Recontatos precisam dela, junto com o recorte, que não depende deles.
  // Nas outras cargas (a página seguinte, a carga sem contador), o
  // "Recontato: motivo" das linhas sai na segunda onda, só dos contatos da
  // página (undefined aqui).
  const daFilaInteira = contar || visao === "caixa" || visao === "recontatos";
  const pendentesP: Promise<Recontato[] | null | undefined> = daFilaInteira
    ? pendentesVisiveis(supabase).catch(() => null)
    : Promise.resolve(undefined);

  // Os filtros conferidos e resolvidos (a busca por e-mail e @ e o "só não
  // lidas" viram ids) antes das consultas da fila.
  const montado = await montarRecorte(supabase, opts, meuId, ocultosP, contar);
  if ("erro" in montado) return { erro: montado.erro };
  const { recorte, naoLidasNoTeto, naoLidasJanela } = montado;

  const pendentes = await pendentesP;
  if (visao === "recontatos" && !pendentes) {
    return { erro: "Os recontatos não carregaram. Tente de novo." };
  }
  const hoje = hojeEmBrasilia();
  // O mais cedo de cada contato, já na ordem do quando. Sem a fila inteira,
  // a segunda onda preenche com os da página.
  const daFila = recontatosDaFila(pendentes ?? [], hoje);
  let recontatoDe = daFila.porLead;
  recorte.recontatos = daFila.ids;
  /** A leitura dos recontatos só dos contatos da página, quando a fila
   *  inteira não foi lida. Falha não derruba a fila: as linhas saem sem o
   *  "Recontato: motivo", como quando a leitura inteira falha. */
  const recontatosDaPagina = (ids: string[]): Promise<Recontato[] | null> =>
    pendentes === undefined && ids.length > 0
      ? pendentesDosLeads(supabase, ids).catch(() => null)
      : Promise.resolve(null);
  /** A prévia de cada conversa da página. previas_conversas (0045) devolve
   *  o texto cru, e a mensagem apagada (para a equipe, ou pelo contato)
   *  seguia inteira na fila enquanto a bolha a escondia. A marca sai logo
   *  depois, só das mensagens da prévia, pelos pares (lead_id, criado_em)
   *  do índice da 0001 e só das que a têm: quase sempre volta vazia. Corre
   *  junto com o resto da segunda onda. Falha da prévia em si segue como
   *  antes: linhas sem prévia, fila de pé. */
  const previasDaPagina = async (ids: string[]): Promise<PreviaConversa[]> => {
    const { data, error } = await supabase.rpc("previas_conversas", {
      p_lead_ids: ids,
    });
    if (error || !data) return [];
    const previas = data as PreviaConversa[];
    const fatias: PreviaConversa[][] = [];
    for (let i = 0; i < previas.length; i += FATIA_APAGADAS) {
      fatias.push(previas.slice(i, i + FATIA_APAGADAS));
    }
    const marcas = await Promise.all(
      fatias.map((fatia) =>
        supabase
          .from("lead_interactions")
          .select("lead_id, criado_em, apagada:metadados->apagada")
          .in("lead_id", fatia.map((p) => p.lead_id))
          .in("criado_em", fatia.map((p) => p.criado_em))
          .in("tipo", ["mensagem_recebida", "mensagem_enviada"])
          .not("metadados->>apagada", "is", null),
      ),
    ).catch(() => null);
    // Sem a marca, a prévia segue como era antes desta conferência: um
    // defeito aqui não pode apagar a prévia da fila inteira.
    if (!marcas || marcas.some((r) => r.error)) {
      console.error("[fila] marca de apagada das prévias não lida");
      return previas;
    }
    // O par casa pela hora em milissegundos: o texto da hora pode não sair
    // igual da função e da tabela. Os dois `in` cruzam ids e horas de leads
    // diferentes; o par descarta o que não é a última mensagem do lead.
    const chave = (leadId: string, quando: string) =>
      `${leadId} ${Date.parse(quando)}`;
    const rotulos = new Map<string, string>();
    for (const r of marcas) {
      for (const m of (r.data ?? []) as unknown as {
        lead_id: string;
        criado_em: string;
        apagada: unknown;
      }[]) {
        const rotulo = rotuloApagada(m.apagada);
        if (rotulo) rotulos.set(chave(m.lead_id, m.criado_em), rotulo);
      }
    }
    if (rotulos.size === 0) return previas;
    return previas.map((p) => {
      const rotulo = rotulos.get(chave(p.lead_id, p.criado_em));
      return rotulo ? { ...p, conteudo: rotulo } : p;
    });
  };
  // eslint-disable-next-line @typescript-eslint/no-explicit-any -- builder
  const daVisao = (v: VisaoConversas, campos: string, o?: OpcoesConsulta): any =>
    consultaDaVisao(supabase, v, campos, recorte, o);
  // As fatias da Caixa saem da view com o recorte e a condição de cada uma.
  // eslint-disable-next-line @typescript-eslint/no-explicit-any -- builder
  const daView = (campos: string): any =>
    consultaDaFila(supabase, "view", campos, recorte);

  const contarVisoes = async (): Promise<Contagens | null> => {
    const doDia = recorte.recontatos.doDia;
    const [caixa, aguardando, adiadasN, resolvidasN, semDono, recontatosN] =
      await Promise.all([
        daVisao("caixa", "lead_id", { contada: true }),
        daVisao("aguardando", "lead_id", { contada: true }),
        daVisao("adiadas", "id", { contada: true }),
        daVisao("resolvidas", "id", { contada: true }),
        daVisao("caixa", "lead_id", { contada: true, comDono: false }).is(
          "responsavel_id",
          null,
        ),
        // Os de hoje e os atrasados, no mesmo recorte da lista. Sem nenhum,
        // nem vai ao banco.
        doDia.length > 0
          ? consultaDaFila(supabase, "view", "lead_id", recorte, {
              contada: true,
            }).in("lead_id", doDia)
          : Promise.resolve({ count: 0, error: null }),
      ]);
    if (
      caixa.error ||
      aguardando.error ||
      adiadasN.error ||
      resolvidasN.error ||
      semDono.error
    ) {
      return null;
    }
    return {
      caixa: caixa.count ?? 0,
      aguardando: aguardando.count ?? 0,
      adiadas: adiadasN.count ?? 0,
      resolvidas: resolvidasN.count ?? 0,
      semDono: semDono.count ?? 0,
      // Sem a leitura dos recontatos (ou com a contagem em erro), sem
      // número: zero diria que não há nenhum.
      ...(pendentes && !recontatosN.error
        ? { recontatos: recontatosN.count ?? 0 }
        : {}),
    };
  };

  // Primeira onda: a lista e os contadores do trilho, juntos.
  const contagensP = contar ? contarVisoes() : Promise.resolve(null);

  // A próxima volta sozinha: o fim de adiamento com hora mais cedo (no
  // recorte) ou o próximo recontato. Junto com as contagens.
  const agoraMs = Date.now();
  const proximoRecontato =
    (pendentes ?? []).find((r) => Date.parse(r.quando) > agoraMs)?.quando ??
    null;
  const proximaVoltaP: Promise<string | null | undefined> = contar
    ? Promise.resolve(
        daVisao("adiadas", "chat_adiado_ate")
          .not("chat_adiado_ate", "is", null)
          .lt("chat_adiado_ate", ANTES_DO_SENTINELA)
          .order("chat_adiado_ate", { ascending: true })
          .limit(1),
      ).then(
        (r: { data: { chat_adiado_ate: string }[] | null; error: unknown }) => {
          const adiada = r.error ? null : (r.data?.[0]?.chat_adiado_ate ?? null);
          const candidatas = [adiada, proximoRecontato].filter(
            (v): v is string => Boolean(v),
          );
          return candidatas.length === 0
            ? null
            : candidatas.reduce((a, b) => (Date.parse(a) <= Date.parse(b) ? a : b));
        },
        () => proximoRecontato,
      )
    : Promise.resolve(undefined);
  // A Caixa cortada se decide pela contagem dela: sem os contadores do
  // trilho, ela sai sozinha, em paralelo com as fatias.
  const totalCaixaP: Promise<number | null> =
    visao !== "caixa"
      ? Promise.resolve(null)
      : contar
        ? contagensP.then((c) => c?.caixa ?? null)
        : daVisao("caixa", "lead_id", { contada: true }).then(
            (r: { count: number | null; error: unknown }) =>
              r.error ? null : (r.count ?? 0),
            () => null,
          );

  let linhasView: LinhaView[] = [];
  let extras = new Map<string, ExtrasLead>();
  let previasLidas: PreviaConversa[] = [];
  let temMais = false;
  // O que a Caixa trouxe (sem repetir) e se a linha além de algum teto
  // ficou de fora: a reserva para quando a contagem falha.
  let linhasDaCaixa = 0;
  let sobrouFora = false;

  if (visao === "adiadas" || visao === "resolvidas") {
    const consulta =
      visao === "adiadas"
        ? daVisao("adiadas", CAMPOS_EXTRAS).order("chat_adiado_ate", {
            ascending: true,
            nullsFirst: false,
          })
        : // Resolvida mais recente primeiro; perdido sem data de resolução
          // vem depois, pela última conversa.
          daVisao("resolvidas", CAMPOS_EXTRAS)
            .order("chat_resolvido_em", {
              ascending: false,
              nullsFirst: false,
            })
            .order("ultima_interacao_em", {
              ascending: false,
              nullsFirst: false,
            });
    const [quem, { data, error }] = await Promise.all([
      quemP,
      consulta.range(offset, offset + tamanho - 1),
    ]);
    if (!quem) return { erro: SESSAO_EXPIRADA };
    if (error) return { erro: error.message };

    const brutas = (data ?? []) as ExtrasLead[];
    temMais = brutas.length === tamanho;
    extras = new Map(brutas.map((e) => [e.id, e]));
    const ids = brutas.map((e) => e.id);

    // Segunda onda: o que só a view sabe (última mensagem, espera, janela)
    // e a prévia, para a página — na ordem que a tabela deu.
    if (ids.length > 0) {
      const [viewR, previas, daPagina] = await Promise.all([
        supabase.from("v_leads_listas").select(CAMPOS_VIEW).in("lead_id", ids),
        previasDaPagina(ids),
        recontatosDaPagina(ids),
      ]);
      if (viewR.error) return { erro: viewR.error.message };
      previasLidas = previas;
      if (daPagina) recontatoDe = recontatosDaFila(daPagina, hoje).porLead;
      const porId = new Map(
        ((viewR.data ?? []) as LinhaView[]).map((l) => [l.lead_id, l]),
      );
      linhasView = ids
        .map((id) => porId.get(id))
        .filter((l): l is LinhaView => Boolean(l));
    }
  } else {
    let principal: Promise<{
      data: unknown;
      error: { message: string } | null;
    }>;
    if (visao === "caixa") {
      // O dia: conversas em aberto (com conversa de verdade) + adiadas cujo
      // prazo venceu + as de recontato do dia, em quatro fatias, e a ordem
      // final (quem espera mais, primeiro) fecha aqui, porque mistura campos
      // que o PostgREST não ordena junto.
      //   esperando — quem mandou a última mensagem, pela espera. Sem esta
      //               fatia, a Caixa trazia só as 80 de mensagem mais
      //               recente: cada lote de disparo empurrava para fora
      //               quem escreveu anteontem e ainda espera, e J/K e
      //               "Próxima" nunca chegavam nele. aguardando_resposta já
      //               implica em_aberto: a fatia é um pedaço exato da Caixa.
      //   abertas   — as de mensagem mais recente, inclusive as de vez nossa.
      //   vencidas  — a vencida antiga não fica de fora por ser antiga.
      //   recontato — hoje e atrasados, do mais cedo para o mais tarde, em
      //               qualquer estado: adiada por outro gesto, resolvida,
      //               perdida ou sem conversa nenhuma ainda.
      // Cada fatia pede uma linha a mais que o teto: sem a contagem da
      // Caixa, é a reserva para saber se ficou conversa de fora. A de
      // recontato vem inteira (são no máximo MAX_RECONTATOS) e o teto corta
      // aqui, na ordem do recontato, que o PostgREST não sabe.
      const doDia = recorte.recontatos.doDia;
      const posicaoDoDia = new Map(doDia.map((id, i) => [id, i] as const));
      principal = Promise.all([
        daVisao("aguardando", CAMPOS_VIEW)
          .order("horas_esperando", { ascending: false, nullsFirst: false })
          .limit(CAIXA_ESPERANDO + 1),
        daView(CAMPOS_VIEW)
          .eq("em_aberto", true)
          .not("ultima_mensagem_em", "is", null)
          .order("ultima_mensagem_em", { ascending: false })
          .limit(CAIXA_ABERTAS + 1),
        daView(CAMPOS_VIEW)
          .eq("adiado_vencido", true)
          .order("ultima_mensagem_em", { ascending: false })
          .limit(CAIXA_VENCIDAS + 1),
        doDia.length > 0
          ? daView(CAMPOS_VIEW).in("lead_id", doDia).limit(MAX_RECONTATOS)
          : Promise.resolve({ data: [], error: null }),
      ]).then(([esperando, abertas, vencidas, comRecontato]) => {
        // Fatia que falhou não some calada: uma Caixa sem quem espera
        // pareceria em dia.
        const falha =
          esperando.error ??
          abertas.error ??
          vencidas.error ??
          comRecontato.error;
        if (falha) return { data: null, error: falha };
        const fatias: [LinhaView[], number][] = [
          [(esperando.data ?? []) as LinhaView[], CAIXA_ESPERANDO],
          [(abertas.data ?? []) as LinhaView[], CAIXA_ABERTAS],
          [(vencidas.data ?? []) as LinhaView[], CAIXA_VENCIDAS],
          [
            [...((comRecontato.data ?? []) as LinhaView[])].sort(
              (a, b) =>
                (posicaoDoDia.get(a.lead_id) ?? 0) -
                (posicaoDoDia.get(b.lead_id) ?? 0),
            ),
            CAIXA_RECONTATOS,
          ],
        ];
        const mapa = new Map<string, LinhaView>();
        for (const [linhas, teto] of fatias) {
          for (const l of linhas.slice(0, teto)) mapa.set(l.lead_id, l);
        }
        // A fatia que bateu no teto não diz, sozinha, que algo ficou de
        // fora: as abertas de vez deles já vieram na fatia de quem espera.
        linhasDaCaixa = mapa.size;
        sobrouFora = fatias.some(([linhas, teto]) =>
          linhas.slice(teto).some((l) => !mapa.has(l.lead_id)),
        );
        const ordenadas = [...mapa.values()].sort((a, b) => {
          const ea = a.horas_esperando ?? -1;
          const eb = b.horas_esperando ?? -1;
          if (ea !== eb) return eb - ea;
          return (b.ultima_mensagem_em ?? "").localeCompare(
            a.ultima_mensagem_em ?? "",
          );
        });
        return { data: ordenadas, error: null };
      });
    } else if (visao === "aguardando") {
      principal = daVisao("aguardando", CAMPOS_VIEW)
        .order("horas_esperando", { ascending: false, nullsFirst: false })
        .range(offset, offset + tamanho - 1);
    } else if (visao === "recontatos") {
      // Não pagina: vêm todas (até MAX_RECONTATOS), na ordem do recontato.
      const posicao = new Map(
        recorte.recontatos.todos.map((id, i) => [id, i] as const),
      );
      principal =
        offset > 0 || recorte.recontatos.todos.length === 0
          ? Promise.resolve({ data: [], error: null })
          : Promise.resolve(
              daVisao("recontatos", CAMPOS_VIEW).limit(MAX_RECONTATOS),
            ).then(
              (r: { data: LinhaView[] | null; error: { message: string } | null }) =>
                r.error
                  ? { data: null, error: r.error }
                  : {
                      data: [...(r.data ?? [])].sort(
                        (a, b) =>
                          (posicao.get(a.lead_id) ?? 0) -
                          (posicao.get(b.lead_id) ?? 0),
                      ),
                      error: null,
                    },
            );
    } else {
      principal = daVisao("tudo", CAMPOS_VIEW)
        .order("ultima_mensagem_em", { ascending: false })
        .range(offset, offset + tamanho - 1);
    }

    const [quem, { data, error }] = await Promise.all([quemP, principal]);
    if (!quem) return { erro: SESSAO_EXPIRADA };
    if (error) return { erro: error.message };
    linhasView = (data ?? []) as LinhaView[];
    // A Caixa não pagina: o que ficou fora das fatias aparece como
    // `cortada`, e a tela diz quantas de quantas. Recontatos também não.
    temMais =
      visao !== "caixa" &&
      visao !== "recontatos" &&
      linhasView.length === tamanho;

    // Segunda onda: colunas de leads que a view não expõe e a prévia.
    const ids = linhasView.map((l) => l.lead_id);
    if (ids.length > 0) {
      const [extrasR, previas, daPagina] = await Promise.all([
        supabase.from("leads").select(CAMPOS_EXTRAS).in("id", ids),
        previasDaPagina(ids),
        recontatosDaPagina(ids),
      ]);
      // Sem estas colunas toda linha sairia "não lida" e nenhuma resolvida:
      // melhor o aviso de erro do que uma fila que mente.
      if (extrasR.error) return { erro: extrasR.error.message };
      extras = new Map(
        ((extrasR.data ?? []) as ExtrasLead[]).map((e) => [e.id, e]),
      );
      previasLidas = previas;
      if (daPagina) recontatoDe = recontatosDaFila(daPagina, hoje).porLead;
    }
  }

  const previas = new Map(previasLidas.map((p) => [p.lead_id, p]));

  const linhas: LinhaConversa[] = linhasView.map((l) => {
    const ex = extras.get(l.lead_id);
    const pv = previas.get(l.lead_id);
    const resolvida = Boolean(ex?.chat_resolvido_em) || l.status === "perdido";
    // Não lida é "o contato mandou algo que ninguém viu". Comparar com a
    // última mensagem em qualquer direção acendia a linha 12 s depois de
    // responder: o envio grava chat_lido_em com a hora do Node, antes do
    // insert, e o criado_em do banco sai milissegundos depois. O disparo
    // em massa fazia o mesmo com cada destinatário. Sem leitura nenhuma
    // (nunca aberta, ou "marcar não lida", que zera chat_lido_em), vale
    // qualquer mensagem, como no contador do menu.
    const naoLida = !ex?.chat_lido_em
      ? l.ultima_mensagem_em !== null
      : l.ultima_recebida_em !== null &&
        l.ultima_recebida_em > ex.chat_lido_em;
    const adiadaAte = ex?.chat_adiado_ate ?? null;
    const adiada = Boolean(ex?.chat_adiado_em) && !resolvida;
    const adiadaVencida =
      Boolean(l.adiado_vencido) ||
      (adiada && adiadaAte !== null && Date.parse(adiadaAte) < agoraMs);
    // Ids e nomes saem da view na mesma ordem (por nome): casam por posição.
    const idsEtiquetas = l.etiqueta_ids ?? [];
    return {
      leadId: l.lead_id,
      nome: l.nome,
      telefone: l.telefone_e164,
      instagram: ex?.instagram_usuario ?? null,
      direct: veioPeloDirect({
        instagramId: ex?.instagram_id,
        instagramUsuario: ex?.instagram_usuario,
      }),
      previa: pv?.conteudo ?? null,
      vez: pv ? (pv.tipo === "mensagem_recebida" ? "eles" : "nos") : null,
      ultimaEm: l.ultima_mensagem_em,
      esperaHoras: l.horas_esperando,
      janelaAberta: Boolean(l.janela_aberta),
      naoLida,
      adiadaAte,
      adiadaVencida,
      resolvida,
      responsavelId: l.responsavel_id,
      responsavelNome: l.responsavel_nome,
      etiquetas: (l.etiquetas ?? []).flatMap((nome, i) =>
        idsEtiquetas[i] ? [{ id: idsEtiquetas[i], nome }] : [],
      ),
      sub: adiadaVencida ? "adiada · prazo venceu" : null,
      recontato: recontatoDe.get(l.lead_id) ?? null,
    };
  });

  // Cortada é o que de fato ficou de fora: a Caixa tem mais conversas do
  // que a lista trouxe. Sem a contagem, vale a linha além do teto.
  const [contagens, totalCaixa, proximaVolta] = await Promise.all([
    contagensP,
    totalCaixaP,
    proximaVoltaP,
  ]);
  const cortada =
    visao === "caixa" &&
    (totalCaixa !== null ? linhasDaCaixa < totalCaixa : sobrouFora);

  return {
    linhas,
    contagens,
    temMais,
    cortada,
    naoLidasNoTeto,
    naoLidasJanela,
    ...(proximaVolta !== undefined ? { proximaVolta } : {}),
  };
}

/** O teto de "Marcar todas" da seleção em massa: uma leitura do PostgREST
 *  (o max_rows padrão do Supabase também é 1.000). */
const TETO_IDS_DA_FILA = 1000;

const VISOES_DA_FILA: readonly VisaoConversas[] = [
  "caixa",
  "aguardando",
  "adiadas",
  "recontatos",
  "resolvidas",
  "tudo",
];

/**
 * Só os ids de todas as conversas do recorte, para a seleção em massa marcar
 * as que a tela ainda não carregou ("Marcar as 212 de Tudo"). É a mesma
 * consulta da lista (consultaDaVisao, com os mesmos filtros conferidos e a
 * privacidade), sem prévia, sem contagem e sem ordem: só leitura. A Caixa
 * aqui é inteira, sem as fatias da lista. `cortada`: o recorte passou do
 * teto e vieram os primeiros TETO_IDS_DA_FILA.
 */
export async function carregarIdsDaFila(
  visao: VisaoConversas,
  opts: Omit<OpcoesLista, "offset" | "limite" | "comContagens" | "perfil">,
): Promise<{ ids: string[]; cortada: boolean; teto: number } | { erro: string }> {
  if (!VISOES_DA_FILA.includes(visao)) return { erro: "Visão desconhecida." };
  const meuId = await idDaSessao();
  if (!meuId) return { erro: SESSAO_EXPIRADA };
  const ocultosP: Promise<string[] | { erro: string }> =
    donosOcultosParaMim().catch(() => ({
      erro: "As regras de privacidade não carregaram. Tente de novo.",
    }));
  const supabase = await createClient();
  // A visão Recontatos parte deles; a Caixa soma os de hoje e atrasados.
  const comRecontatos = visao === "recontatos" || visao === "caixa";
  const [montado, pendentes] = await Promise.all([
    montarRecorte(supabase, opts, meuId, ocultosP, false),
    comRecontatos
      ? pendentesVisiveis(supabase).catch(() => null)
      : Promise.resolve([] as Recontato[]),
  ]);
  if ("erro" in montado) return { erro: montado.erro };
  // Sem a leitura, a Caixa segue sem os de recontato, como a lista dela.
  if (!pendentes && visao === "recontatos") {
    return { erro: "Os recontatos não carregaram. Tente de novo." };
  }
  if (comRecontatos) {
    montado.recorte.recontatos = recontatosDaFila(
      pendentes ?? [],
      hojeEmBrasilia(),
    ).ids;
  }
  // Adiadas e resolvidas leem da tabela (id); as outras, da view (lead_id).
  const daTabela = visao === "adiadas" || visao === "resolvidas";
  const campo = daTabela ? "id" : "lead_id";
  try {
    const { data, error } = await consultaDaVisao(
      supabase,
      visao,
      campo,
      montado.recorte,
    ).range(0, TETO_IDS_DA_FILA - 1);
    if (error) return { erro: (error as { message: string }).message };
    const ids = [
      ...new Set(
        ((data ?? []) as Record<string, string>[])
          .map((l) => l[campo])
          .filter((id): id is string => typeof id === "string"),
      ),
    ];
    return {
      ids,
      cortada: ids.length >= TETO_IDS_DA_FILA,
      teto: TETO_IDS_DA_FILA,
    };
  } catch {
    return { erro: "A conexão não respondeu. Tente de novo." };
  }
}

/**
 * As campanhas para o filtro da fila, da mais recente para trás. Toda a
 * equipe lê (policy leitura_equipe, 0021). null = não carregou: a tela
 * esconde a seção em vez de oferecer uma lista vazia.
 */
export async function carregarCampanhasDaFila(): Promise<
  CampanhaDaFila[] | null
> {
  const supabase = await createClient();
  const { data, error } = await supabase
    .from("campanhas")
    .select("id, nome, status")
    .order("criado_em", { ascending: false })
    .limit(MAX_CAMPANHAS);
  if (error) return null;
  return (
    (data ?? []) as { id: string; nome: string; status: string }[]
  ).map((c) => ({
    id: c.id,
    nome: c.nome,
    status:
      c.status === "ativa" || c.status === "pausada" ? c.status : "concluida",
  }));
}

/**
 * Quem da equipe ativa só lê (o compliance). Não atende conversa: passada
 * para essa pessoa, a conversa ficaria sem ninguém que responda e sairia da
 * Caixa de quem filtra por dono. A tela tira esses ids dos destinos de
 * Transferir (no ⋯ da conversa e na seleção). Toda a equipe lê os perfis
 * (policy leitura_equipe, 0001). null = não leu: a tela tenta de novo ao
 * abrir o Transferir.
 */
export async function carregarQuemSoLe(): Promise<string[] | null> {
  const supabase = await createClient();
  const { data, error } = await supabase
    .from("profiles")
    .select("id")
    .eq("ativo", true)
    .eq("papel", "compliance");
  if (error) return null;
  return ((data ?? []) as { id: string }[]).map((p) => p.id);
}

/**
 * Quantas conversas abertas cada pessoa da equipe tem agora, para a gestão
 * distribuir vendo o número (faixa "Equipe" da Caixa e o "Atribuir a…").
 *
 * A conta é cargaDaEquipe (lib/distribuicao.ts), a mesma que escolherVendedor
 * usa para decidir o rodízio: não resolvida, com alguma mensagem trocada,
 * contato não perdido; adiada conta. Uma função só, para a tela nunca
 * mostrar uma carga enquanto o rodízio usa outra.
 *
 * Só para gestão; o RLS dela enxerga a base inteira. Quem chama decide a
 * cadência (ao abrir a faixa, no máximo a cada 60 s): a conta não entra no
 * respiro de 12 s da fila.
 */
export async function carregarCargaEquipe(): Promise<
  { equipe: CargaAtendente[] } | { erro: string }
> {
  const perfil = await perfilAtual();
  if (!perfil) return { erro: SESSAO_EXPIRADA };
  if (!ehGestao(perfil.papel)) {
    return { erro: "A carga da equipe é só para gestão." };
  }

  const supabase = await createClient();
  const { data, error } = await supabase
    .from("profiles")
    .select("id, nome, recebe_leads, papel")
    .eq("ativo", true)
    .order("nome");
  if (error) return { erro: "A equipe não carregou. Tente de novo." };

  // Compliance só lê: não atende conversa nem entra no rodízio.
  const pessoas = (
    (data ?? []) as {
      id: string;
      nome: string;
      recebe_leads: boolean | null;
      papel: string;
    }[]
  ).filter((p) => p.papel !== "compliance");

  const carga = await cargaDaEquipe(
    supabase,
    pessoas.map((p) => p.id),
  );
  if ([...carga.values()].some((n) => n === null)) {
    return { erro: "A carga da equipe não carregou. Tente de novo." };
  }

  return {
    equipe: pessoas.map((p) => ({
      id: p.id,
      nome: p.nome,
      abertas: carga.get(p.id) ?? 0,
      noRodizio: p.recebe_leads === true,
    })),
  };
}
