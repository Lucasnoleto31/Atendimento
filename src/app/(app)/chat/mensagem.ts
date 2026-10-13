import type { TemplateWhatsapp } from "@/lib/whatsapp";
import type {
  EscopoConversas,
  VisaoConversas,
} from "@/app/(app)/conversas/lista";
import {
  lerFimRecontato,
  lerRecontato,
  type DadosRecontato,
  type FimRecontato,
  type Recontato,
} from "./recontato";

/**
 * O formato da conversa que o servidor e a tela compartilham. Módulo puro —
 * sem "use server" e sem nada que só rode no servidor — para a tela montar
 * a bolha direto do payload do Realtime (paraMensagem), sem uma ida ao
 * servidor a cada mensagem que chega na conversa aberta. Também moram aqui
 * as regras que servidor e tela precisam aplicar igual: o canal da resposta,
 * a busca da fila e os filtros da fila na URL.
 */

export type Anexo = {
  /** "image", "audio", "video", "file", "sticker" (figurinha do WhatsApp) ou
   *  "link" (publicação, reel ou story do Instagram, que fica no link). */
  tipo: string;
  url: string;
  nome?: string | null;
  /** Bytes, quando o webhook mediu ao hospedar (as antigas não têm). */
  tamanho?: number | null;
  mime?: string | null;
  /** Áudio gravado na hora no app (a mensagem de voz), não um arquivo. */
  voz?: boolean;
};

/** Reação na bolha, de quem tem emoji agora (a removida não chega aqui). */
export type ReacaoMensagem = {
  /** "contato" ou o id (profiles) de quem reagiu na equipe. */
  de: string;
  emoji: string;
  em: string;
  nome: string | null;
};

export type ApagadaMensagem = {
  /** "contato": o cliente apagou para todos. "equipe": escondida no
   *  Atendimento; o contato continua vendo. */
  por: "contato" | "equipe";
  em: string;
  autorId: string | null;
  nome: string | null;
};

export type EdicaoMensagem = {
  em: string;
  /** O texto de antes da primeira edição. */
  original: string | null;
  /** A Meta avisou que editou sem mandar o texto novo. */
  semTexto: boolean;
};

/** A mensagem citada pela resposta, como estava quando a resposta chegou. */
export type RespostaCitada = {
  /** wamid (WhatsApp) ou mid (Direct) da citada. */
  idMeta: string | null;
  /** A linha da citada em lead_interactions, quando foi achada. */
  interacaoId: string | null;
  em: string | null;
  de: "contato" | "equipe" | null;
  autor: string | null;
  trecho: string | null;
  midia: string | null;
  /** Resposta a um story do Instagram. */
  story: { id: string | null; url: string | null } | null;
};

export type LocalizacaoMensagem = {
  latitude: number;
  longitude: number;
  nome: string | null;
  endereco: string | null;
  url: string | null;
};

export type ContatoCompartilhado = {
  nome: string;
  telefones: { numero: string; waId: string | null; tipo: string | null }[];
  emails: string[];
  empresa: string | null;
};

/** O que a conversa precisa dos metadados da interação. */
export type MetadadosMensagem = {
  /** Nota gerada por ação (adiar/resolver/atribuir) — vira linha de sistema. */
  sistema?: boolean;
  /** Por onde a mensagem saiu: "crm" (manual), "campanha", "disparo"… */
  via?: string | null;
  /** Nome da campanha, quando o envio veio de um disparo em massa. */
  campanha?: string | null;
  /** Mensagem recebida que chegou pelo Direct do Instagram. Com ela, a
   *  resposta livre passa a sair pelo Direct (canalDaResposta). */
  direct?: boolean;
};

/**
 * Os tipos de interação que são conversa. lead_interactions também guarda
 * atribuição e eventos que o banco ainda grava por gatilho — esses não
 * viram bolha, nem na carga nem no Realtime.
 */
export const TIPOS_MENSAGEM = [
  "mensagem_recebida",
  "mensagem_enviada",
  "nota",
] as const;

export type TipoMensagem = (typeof TIPOS_MENSAGEM)[number];

/** O payload do Realtime traz qualquer tipo: só estes entram na conversa. */
export function ehTipoMensagem(tipo: unknown): tipo is TipoMensagem {
  return (TIPOS_MENSAGEM as readonly unknown[]).includes(tipo);
}

export type Mensagem = {
  id: string;
  tipo: TipoMensagem;
  conteudo: string | null;
  criado_em: string;
  autor: string | null;
  /** O perfil de quem da equipe escreveu (autor_id): é por ele que a bolha
   *  acha a foto. Sem ele (a recebida, a otimista), só o nome. */
  autorId?: string | null;
  anexos?: Anexo[];
  statusEnvio?: string | null;
  erroEnvio?: string | null;
  pendente?: boolean;
  metadados?: MetadadosMensagem | null;
  /** O id da Meta (wamid ou mid): é por ele que resposta e reação acham a
   *  bolha. Envio com vários anexos tem um por arquivo, em idsMeta. */
  idMeta?: string | null;
  idsMeta?: string[];
  /** O tipo que a Meta mandou na recebida ("sticker", "location",
   *  "reaction", "unsupported"...), quando o webhook gravou. */
  tipoMeta?: string | null;
  respostaA?: RespostaCitada | null;
  encaminhada?: "uma" | "muitas" | null;
  /** Nota de agendamento de recontato (chat/recontato.ts): vira a linha
   *  "Ana agendou recontato para 12/10 às 9h: motivo". */
  recontato?: DadosRecontato | null;
  /** Nota de fim de recontato (feito, cancelado, template). */
  recontatoFim?: FimRecontato | null;
  /** Só as que estão de pé, na ordem em que chegaram. */
  reacoes?: ReacaoMensagem[];
  apagada?: ApagadaMensagem | null;
  editada?: EdicaoMensagem | null;
  localizacao?: LocalizacaoMensagem | null;
  contatos?: ContatoCompartilhado[];
  /** Recebida depois da última leitura de alguém da equipe, na abertura da
   *  conversa (carregarConversa). A Janela abre na primeira delas. */
  naoLida?: boolean;
  /** Sobe a cada regravação dos metadados (chat/metadados.ts): entre duas
   *  versões da mesma linha, vale a de rev maior. */
  rev?: number;
};

export type MensagemPadrao = {
  id: string;
  titulo: string;
  corpo: string;
  /** Arquivos da mensagem padrão — entram na fila de anexos ao usar. */
  anexos?: Anexo[] | null;
};

/**
 * A linha crua de lead_interactions: como o PostgREST devolve no select com
 * `autor:profiles(nome)`, ou como o Realtime entrega (só `autor_id`).
 */
export type LinhaBrutaInteracao = {
  id: string;
  tipo: TipoMensagem;
  conteudo: string | null;
  criado_em: string;
  metadados: {
    anexos?: {
      tipo?: string | null;
      nome?: string | null;
      url?: string | null;
      tamanho?: unknown;
      mime?: unknown;
      voz?: unknown;
    }[];
    status_envio?: string | null;
    erro_envio?: string | null;
    sistema?: boolean | null;
    via?: string | null;
    campanha?: string | null;
    /** O webhook do Instagram grava canal "instagram" e o igsid; o do
     *  WhatsApp não grava nenhum dos dois. */
    canal?: string | null;
    igsid?: string | null;
    message_id?: unknown;
    message_ids?: unknown;
    /** O tipo da Meta, que o webhook do WhatsApp grava na recebida. */
    tipo?: unknown;
    // Os formatos gravados estão em chat/metadados.ts; aqui chegam crus.
    resposta_a?: unknown;
    encaminhada?: unknown;
    reacoes?: unknown;
    apagada?: unknown;
    editada?: unknown;
    localizacao?: unknown;
    contatos?: unknown;
    rev?: unknown;
    /** Agendamento e fim de recontato (chat/recontato.ts). */
    recontato?: unknown;
    recontato_fim?: unknown;
  } | null;
  autor?: { nome: string } | null;
  autor_id?: string | null;
};

/** A mensagem recebida veio pelo Direct do Instagram? */
export function recebidaPeloDirect(
  metadados: { canal?: string | null; igsid?: string | null } | null | undefined,
): boolean {
  return metadados?.canal === "instagram" || Boolean(metadados?.igsid);
}

export type CanalConversa = "whatsapp" | "instagram";

/**
 * Por onde sai a resposta livre (texto e anexos). A pessoa é respondida no
 * canal em que escreveu por último: quem fala pelo Direct recebe pelo
 * Direct, mesmo que o número dela já esteja na ficha (antes, ganhar
 * telefone mandava a resposta para um WhatsApp onde a pessoa nunca
 * escreveu, e a Meta devolvia 131047). Sem mensagem recebida, vale o
 * telefone; só Direct, o Direct. null = o contato não tem canal nenhum.
 *
 * Regra única do envio (chat/actions.ts), da conversa (chat/conversa.ts) e
 * do painel (conversas/contato.ts). Template não passa por aqui: só existe
 * no WhatsApp e sai sempre pelo telefone.
 *
 * `ultimaRecebidaPeloDirect`: null quando o contato nunca escreveu (ou a
 * leitura falhou), que cai na regra do telefone.
 */
export function canalDaResposta(
  contato: { temTelefone: boolean; temDirect: boolean },
  ultimaRecebidaPeloDirect: boolean | null,
): CanalConversa | null {
  if (
    contato.temDirect &&
    (ultimaRecebidaPeloDirect === true || !contato.temTelefone)
  ) {
    return "instagram";
  }
  return contato.temTelefone ? "whatsapp" : null;
}

/**
 * Linha do banco → bolha da Janela. Do Realtime não vem o nome do autor:
 * quem chama passa `autorNome` (a equipe do catálogo resolve o autor_id).
 */
export function paraMensagem(
  m: LinhaBrutaInteracao,
  autorNome?: string | null,
): Mensagem {
  // O payload do Realtime não passa pelo tipo do select: o que vier fora do
  // formato vira "sem aquilo" em vez de derrubar a conversa.
  const md = m.metadados;
  const brutos = md?.anexos;
  const tipoMeta = texto(md?.tipo);
  // A figurinha do WhatsApp foi gravada como imagem antes de ter tipo próprio.
  const figurinha = tipoMeta === "sticker";
  const anexos: Anexo[] = (Array.isArray(brutos) ? brutos : []).flatMap((a) => {
    if (typeof a?.url !== "string" || !a.url) return [];
    const tipo = a.tipo ?? "file";
    return [
      {
        tipo: figurinha && tipo === "image" ? "sticker" : tipo,
        nome: a.nome ?? null,
        url: a.url,
        tamanho: numero(a.tamanho),
        mime: texto(a.mime),
        ...(a.voz === true ? { voz: true } : {}),
      },
    ];
  });
  const idsMeta = Array.isArray(md?.message_ids)
    ? md.message_ids.filter((id): id is string => typeof id === "string")
    : [];
  const encaminhada = md?.encaminhada;
  return {
    id: m.id,
    tipo: m.tipo,
    conteudo: m.conteudo,
    criado_em: m.criado_em,
    autor: autorNome !== undefined ? autorNome : (m.autor?.nome ?? null),
    autorId: texto(m.autor_id),
    anexos,
    statusEnvio: md?.status_envio ?? null,
    erroEnvio: md?.erro_envio ?? null,
    metadados: md
      ? {
          sistema: md.sistema === true,
          via: md.via ?? null,
          campanha: md.campanha ?? null,
          direct: m.tipo === "mensagem_recebida" && recebidaPeloDirect(md),
        }
      : null,
    idMeta: texto(md?.message_id),
    ...(idsMeta.length > 0 ? { idsMeta } : {}),
    tipoMeta,
    respostaA: lerRespostaA(md?.resposta_a),
    encaminhada:
      encaminhada === "uma" || encaminhada === "muitas" ? encaminhada : null,
    reacoes: lerReacoesDaBolha(md?.reacoes),
    apagada: lerApagada(md?.apagada),
    editada: lerEdicao(md?.editada),
    localizacao: lerLocalizacao(md?.localizacao),
    contatos: lerContatos(md?.contatos),
    ...(m.tipo === "nota" && md?.recontato
      ? { recontato: lerRecontato(md.recontato) }
      : {}),
    ...(m.tipo === "nota" && md?.recontato_fim
      ? { recontatoFim: lerFimRecontato(md.recontato_fim) }
      : {}),
    rev: numero(md?.rev) ?? 0,
  };
}

// ─────────────── leitura tolerante dos metadados da bolha ───────────────

function objeto(v: unknown): Record<string, unknown> | null {
  return typeof v === "object" && v !== null && !Array.isArray(v)
    ? (v as Record<string, unknown>)
    : null;
}

function texto(v: unknown): string | null {
  return typeof v === "string" && v.trim() ? v : null;
}

function numero(v: unknown): number | null {
  const n = typeof v === "string" && v.trim() ? Number(v) : v;
  return typeof n === "number" && Number.isFinite(n) ? n : null;
}

function lerReacoesDaBolha(bruto: unknown): ReacaoMensagem[] {
  if (!Array.isArray(bruto)) return [];
  return bruto.flatMap((item) => {
    const r = objeto(item);
    const de = texto(r?.de);
    const emoji = texto(r?.emoji);
    const em = texto(r?.em);
    return r && de && emoji && em
      ? [{ de, emoji: emoji.trim(), em, nome: texto(r.nome) }]
      : [];
  });
}

function lerApagada(bruto: unknown): ApagadaMensagem | null {
  const a = objeto(bruto);
  if (!a) return null;
  return {
    por: a.por === "equipe" ? "equipe" : "contato",
    em: texto(a.em) ?? "",
    autorId: texto(a.autor_id),
    nome: texto(a.nome),
  };
}

function lerEdicao(bruto: unknown): EdicaoMensagem | null {
  const e = objeto(bruto);
  if (!e) return null;
  return {
    em: texto(e.em) ?? "",
    original: typeof e.original === "string" ? e.original : null,
    semTexto: e.sem_texto === true,
  };
}

function lerRespostaA(bruto: unknown): RespostaCitada | null {
  const r = objeto(bruto);
  if (!r) return null;
  const story = objeto(r.story);
  const resposta: RespostaCitada = {
    idMeta: texto(r.id),
    interacaoId: texto(r.interacao_id),
    em: texto(r.em),
    de: r.de === "contato" || r.de === "equipe" ? r.de : null,
    autor: texto(r.autor),
    trecho: texto(r.trecho),
    midia: texto(r.midia),
    story: story ? { id: texto(story.id), url: texto(story.url) } : null,
  };
  return resposta.idMeta || resposta.interacaoId || resposta.story
    ? resposta
    : null;
}

function lerLocalizacao(bruto: unknown): LocalizacaoMensagem | null {
  const l = objeto(bruto);
  const latitude = numero(l?.latitude);
  const longitude = numero(l?.longitude);
  if (!l || latitude === null || longitude === null) return null;
  return {
    latitude,
    longitude,
    nome: texto(l.nome),
    endereco: texto(l.endereco),
    url: texto(l.url),
  };
}

function lerContatos(bruto: unknown): ContatoCompartilhado[] {
  if (!Array.isArray(bruto)) return [];
  return bruto.flatMap((item) => {
    const c = objeto(item);
    const nome = texto(c?.nome);
    if (!c || !nome) return [];
    const telefones = Array.isArray(c.telefones)
      ? c.telefones.flatMap((t) => {
          const tel = objeto(t);
          const numeroTel = texto(tel?.numero);
          return tel && numeroTel
            ? [
                {
                  numero: numeroTel,
                  waId: texto(tel.wa_id),
                  tipo: texto(tel.tipo),
                },
              ]
            : [];
        })
      : [];
    const emails = Array.isArray(c.emails)
      ? c.emails.filter((e): e is string => typeof e === "string" && e !== "")
      : [];
    return [{ nome, telefones, emails, empresa: texto(c.empresa) }];
  });
}

const JANELA_MS = 24 * 3600 * 1000;

/**
 * Quanto falta da janela de 24h da Meta (ms), contada da última mensagem
 * RECEBIDA; null quando o contato nunca escreveu. Negativo = fechada: fora
 * dela só template aprovado chega. `mensagens` em ordem cronológica.
 */
export function restanteJanela24h(
  mensagens: Pick<Mensagem, "tipo" | "criado_em">[],
  agoraMs: number = Date.now(),
): number | null {
  for (let i = mensagens.length - 1; i >= 0; i--) {
    if (mensagens[i].tipo === "mensagem_recebida") {
      return new Date(mensagens[i].criado_em).getTime() + JANELA_MS - agoraMs;
    }
  }
  return null;
}

// ─────────────────────────── conversa aberta ───────────────────────────

/**
 * O que o menu "⋯" do palco precisa saber DESTE contato. As listas que ele
 * oferece (equipe, etiquetas) não mudam de uma conversa para outra e vêm
 * uma vez por página, em CatalogosChat.
 */
export type FerramentasDaConversa = {
  responsavelId: string | null;
  /** Nome de quem atende, mesmo que já não esteja na equipe ativa. */
  responsavelNome: string | null;
  /** Ids das etiquetas do contato. null = a leitura falhou: a tela esconde
   *  a seção em vez de mostrar tudo desmarcado (o atendente marcaria de
   *  novo o que já está lá). */
  etiquetasLead: string[] | null;
  /** Resolvida, ou contato marcado como perdido no banco — os dois saem da
   *  Caixa e o palco oferece reabrir. */
  conversaResolvida: boolean;
};

export type ConversaDoPainel = {
  leadId: string;
  nome: string;
  temConversa: boolean;
  /** As mais recentes, em ordem cronológica. */
  mensagens: Mensagem[];
  /** Há mensagens anteriores às carregadas (carregarMensagensAnteriores). */
  temMaisAntigas: boolean;
  restanteJanela: number | null;
  /** Por onde sai a resposta livre (canalDaResposta). Contato sem canal
   *  nenhum vem como "whatsapp": o envio avisa que falta o telefone. */
  canal: CanalConversa;
  /** Tem telefone: template (só existe no WhatsApp) alcança o contato.
   *  Falso no contato só do Direct: a tela não oferece template, que o
   *  servidor recusaria. */
  aceitaTemplate: boolean;
  /** Tem IGSID. Uma mensagem nova pelo Direct (metadados.direct) muda o
   *  canal: a tela recalcula com canalDaResposta, sem ir ao servidor. */
  temDirect: boolean;
  marketingBloqueado: boolean;
  hojeChave: string;
  ontemChave: string;
  ferramentas: FerramentasDaConversa;
  /** Os recontatos pendentes do contato, do mais cedo para o mais tarde: o
   *  primeiro vira a faixa no topo da conversa. null = a leitura falhou
   *  (sem faixa, em vez de dizer que não há nenhum). */
  recontatos: Recontato[] | null;
};

export type MembroEquipe = { id: string; nome: string };

export type EtiquetaCatalogo = {
  id: string;
  nome: string;
  cor: string | null;
  /** Arquivada some da escolha, mas segue à vista no contato que a tem —
   *  senão não haveria como tirá-la. */
  ativo: boolean;
};

/**
 * O que não muda de uma conversa para outra: carregado uma vez por página.
 * Em cada campo, null = a consulta falhou (a tela esconde o controle ou
 * avisa); lista vazia = de fato não há nenhum.
 */
export type CatalogosChat = {
  mensagensPadrao: MensagemPadrao[] | null;
  /** Templates aprovados na Meta; [] quando a Meta não está configurada. */
  templates: TemplateWhatsapp[] | null;
  /** Atendentes ativos, para atribuir e para dar nome ao autor no Realtime. */
  equipe: MembroEquipe[] | null;
  /** Todas as etiquetas, ativas e arquivadas, em ordem de nome. */
  etiquetas: EtiquetaCatalogo[] | null;
  /** A hora padrão do recontato ("09:00"): o início do horário de
   *  atendimento (settings.horario_atendimento), ou 9h. */
  horaRecontato: string;
};

// ─────────────────────────── busca da fila ───────────────────────────

/** O termo da busca já desmontado nos três alvos. */
export type TermosBusca = {
  /** Para o nome (e o e-mail), sem vírgula, parêntese nem aspas, que
   *  quebram a sintaxe do .or() do PostgREST. */
  termo: string;
  /** Só os dígitos, quando são 4 ou mais; senão "". Com menos, "11"
   *  casaria meia base pelo DDD. */
  digitos: string;
  /** O @ do Instagram, que fica guardado sem a arroba. */
  usuario: string;
};

/**
 * A mesma normalização da busca de Contatos (contatos/filtros.ts): telefone
 * colado do WhatsApp, "(11) 98765-4321", acha pelos dígitos; "@joao" acha
 * pelo usuário. null = busca vazia. O servidor (conversas/lista.ts) e o
 * filtro local da fila usam esta função, para os dois acharem o mesmo.
 */
export function termosDaBusca(busca: string): TermosBusca | null {
  const termo = busca
    .replace(/[,()"]/g, " ")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, 100);
  if (!termo) return null;
  const digitos = termo.replace(/\D/g, "");
  return {
    termo,
    digitos: digitos.length >= 4 ? digitos : "",
    usuario: termo.replace(/^@/, "").trim(),
  };
}

/**
 * Filtro local da fila enquanto a busca viaja até o servidor: nome, telefone
 * pelos dígitos e @. E-mail não está na linha; a resposta do servidor, que
 * acha também por e-mail, substitui este filtro.
 */
export function casaComBusca(
  linha: { nome: string; telefone: string | null; instagram: string | null },
  t: TermosBusca,
): boolean {
  const termo = t.termo.toLocaleLowerCase("pt-BR");
  const usuario = t.usuario.toLocaleLowerCase("pt-BR");
  return (
    linha.nome.toLocaleLowerCase("pt-BR").includes(termo) ||
    (t.digitos !== "" &&
      (linha.telefone ?? "").replace(/\D/g, "").includes(t.digitos)) ||
    (usuario !== "" &&
      (linha.instagram ?? "").toLocaleLowerCase("pt-BR").includes(usuario))
  );
}

// ─────────────────────── filtros da fila na URL ───────────────────────

/** Canal do filtro: WhatsApp é quem tem telefone; Direct, quem já escreveu
 *  pelo Direct do Instagram (a regra de recebidaPeloDirect). */
export type CanalFila = "whatsapp" | "direct";

/** Os atalhos do período; o resto é data (AAAA-MM-DD). */
export const ATALHOS_PERIODO = ["hoje", "7d", "30d"] as const;
export type AtalhoPeriodo = (typeof ATALHOS_PERIODO)[number];

/** O valor de `atendentes` que quer dizer "sem dono". */
export const SEM_DONO = "sem-dono";

/**
 * Como as etiquetas marcadas se somam: "qualquer" (a conversa entra com
 * qualquer uma delas, o padrão) ou "todas" (o contato precisa ter cada
 * uma). É o mesmo contrato do filtro de Contatos: na URL,
 * etiquetasModo=todas; ausente, qualquer uma.
 */
export type ModoEtiquetas = "qualquer" | "todas";

/** Visão, escopo, busca e os filtros finos da fila. */
export type FiltrosFila = {
  visao: VisaoConversas;
  escopo: EscopoConversas;
  busca: string;
  /** ids dos atendentes e, para quem está sem dono, SEM_DONO. [] = qualquer
   *  um. A conversa entra com qualquer um deles. */
  atendentes: string[];
  /** ids das etiquetas, somadas como diz `etiquetasModo`. [] = sem filtro
   *  de etiqueta. */
  etiquetas: string[];
  /** Qualquer uma das marcadas ou todas elas. Só pesa com etiqueta marcada;
   *  a URL só o leva nesse caso. */
  etiquetasModo: ModoEtiquetas;
  /** Só contato sem etiqueta nenhuma (nenhuma linha em lead_tags). Exclui
   *  as etiquetas: ligado, `etiquetas` vai vazia. Na URL, semEtiqueta=1. */
  semEtiqueta: boolean;
  /** Quem recebeu esta campanha (campanha_envios sem erro), ou "". */
  campanhaId: string;
  canal: CanalFila | "";
  /** Começo do período da última mensagem: "hoje", "7d", "30d" ou uma data
   *  AAAA-MM-DD; "" sem período. */
  de: string;
  /** Último dia do período (inclusive), AAAA-MM-DD, ou "". Com `de` num
   *  atalho, não vale: o atalho já vai até agora. */
  ate: string;
  naoLidas: boolean;
  /** Legado, só na ida: o link de um atendente só, como o Relatório ainda
   *  monta. hrefConversa o junta a `atendentes`; lerFiltrosFila nunca o
   *  devolve. */
  atendenteId?: string;
  /** Legado, só na ida, como o atendenteId. */
  etiquetaId?: string;
};

export const FILTROS_FILA_PADRAO: FiltrosFila = {
  visao: "caixa",
  escopo: "todas",
  busca: "",
  atendentes: [],
  etiquetas: [],
  etiquetasModo: "qualquer",
  semEtiqueta: false,
  campanhaId: "",
  canal: "",
  de: "",
  ate: "",
  naoLidas: false,
};

/**
 * Os nomes da URL que são filtro da fila, novos e antigos. Quem leva a fila
 * junto para outro endereço do chat (a paleta, ao abrir uma pessoa) copia
 * estes.
 */
export const PARAMETROS_FILA = [
  "visao",
  "escopo",
  "busca",
  "atendentes",
  "etiquetas",
  "etiquetasModo",
  "semEtiqueta",
  "campanha",
  "canal",
  "de",
  "ate",
  "naoLidas",
  // Os de antes da escolha múltipla: link velho continua valendo.
  "atendente",
  "etiqueta",
] as const;

/** Teto de ids por lista do filtro (atendentes, etiquetas): cada um ocupa
 *  37 caracteres da URL. O painel não deixa marcar mais que isso, e a URL e
 *  o servidor cortam no mesmo ponto (cortarIdsFila). */
export const MAX_IDS_FILTRO_FILA = 30;

const VISOES: readonly VisaoConversas[] = [
  "caixa",
  "aguardando",
  "adiadas",
  "recontatos",
  "resolvidas",
  "tudo",
];

const ESCOPOS: readonly EscopoConversas[] = ["minhas", "todas", "semDono"];

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** O id tem o formato de uuid? (o que entra num filtro do PostgREST) */
export function ehUuid(valor: unknown): valor is string {
  return typeof valor === "string" && UUID.test(valor);
}

const DATA = /^\d{4}-\d{2}-\d{2}$/;
const DIA_MS = 86_400_000;

/** "AAAA-MM-DD" que existe no calendário (2026-02-30 não passa). */
export function ehDataFila(valor: unknown): valor is string {
  if (typeof valor !== "string" || !DATA.test(valor)) return false;
  const t = Date.parse(`${valor}T00:00:00Z`);
  return !Number.isNaN(t) && new Date(t).toISOString().slice(0, 10) === valor;
}

function ehAtalhoPeriodo(valor: string): valor is AtalhoPeriodo {
  return (ATALHOS_PERIODO as readonly string[]).includes(valor);
}

function primeiro(valor: string | string[] | undefined): string {
  const bruto = Array.isArray(valor) ? valor[0] : valor;
  return typeof bruto === "string" ? bruto.trim() : "";
}

/** "a,b,c" (ou o parâmetro repetido) em lista, sem vazio nem repetido. */
function varios(valor: string | string[] | undefined): string[] {
  const brutos = Array.isArray(valor) ? valor : valor ? [valor] : [];
  return [
    ...new Set(
      brutos
        .flatMap((v) => v.split(","))
        .map((v) => v.trim())
        .filter(Boolean),
    ),
  ];
}

/** Ordem fixa: a mesma escolha feita em outra ordem dá a mesma URL. */
function ordenados(ids: string[]): string[] {
  return [...new Set(ids)].sort();
}

/** Uma lista do filtro no teto, sempre na mesma ordem: a URL (lerFiltrosFila)
 *  e o servidor (a fila) ficam com os mesmos 30, seja qual for a ordem em
 *  que chegaram. */
export function cortarIdsFila(ids: string[]): string[] {
  return ordenados(ids).slice(0, MAX_IDS_FILTRO_FILA);
}

/** "AAAA-MM-DD" de hoje no fuso de Brasília. */
export function hojeEmBrasilia(agora: Date = new Date()): string {
  return new Intl.DateTimeFormat("en-CA", {
    timeZone: "America/Sao_Paulo",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(agora);
}

/** O dia `n` dias depois (ou antes, negativo) de "AAAA-MM-DD". */
export function somarDiasFila(dia: string, n: number): string {
  return new Date(Date.parse(`${dia}T00:00:00Z`) + n * DIA_MS)
    .toISOString()
    .slice(0, 10);
}

// A meia-noite de Brasília em ISO. O Brasil não tem horário de verão desde
// 2019: o -03:00 é fixo.
function meiaNoite(dia: string): string {
  return new Date(`${dia}T00:00:00-03:00`).toISOString();
}

/**
 * O período do filtro em instantes, para o servidor comparar com a última
 * mensagem: `desde` inclusive, `ateAntes` exclusivo (a meia-noite do dia
 * seguinte ao `ate`). "7 dias" é hoje e os seis anteriores; "30 dias", hoje
 * e os 29 anteriores. null = sem aquela ponta.
 */
export function intervaloDoPeriodo(
  de: string,
  ate: string,
  agora: Date = new Date(),
): { desde: string | null; ateAntes: string | null } {
  const hoje = hojeEmBrasilia(agora);
  if (de === "hoje") return { desde: meiaNoite(hoje), ateAntes: null };
  if (de === "7d") {
    return { desde: meiaNoite(somarDiasFila(hoje, -6)), ateAntes: null };
  }
  if (de === "30d") {
    return { desde: meiaNoite(somarDiasFila(hoje, -29)), ateAntes: null };
  }
  return {
    desde: ehDataFila(de) ? meiaNoite(de) : null,
    ateAntes: ehDataFila(ate) ? meiaNoite(somarDiasFila(ate, 1)) : null,
  };
}

/** "07/10", com o ano só quando não é o de hoje ("07/10/2025"). */
function diaCurto(dia: string, hoje: string): string {
  const [a, m, d] = dia.split("-");
  return a === hoje.slice(0, 4) ? `${d}/${m}` : `${d}/${m}/${a}`;
}

/** O nome do período no chip: "Hoje", "7 dias", "01/10 a 07/10". "" sem
 *  período. */
export function rotuloDoPeriodo(
  de: string,
  ate: string,
  agora: Date = new Date(),
): string {
  if (de === "hoje") return "Hoje";
  if (de === "7d") return "7 dias";
  if (de === "30d") return "30 dias";
  const hoje = hojeEmBrasilia(agora);
  const temDe = ehDataFila(de);
  const temAte = ehDataFila(ate);
  if (temDe && temAte) {
    return de === ate
      ? diaCurto(de, hoje)
      : `${diaCurto(de, hoje)} a ${diaCurto(ate, hoje)}`;
  }
  if (temDe) return `Desde ${diaCurto(de, hoje)}`;
  if (temAte) return `Até ${diaCurto(ate, hoje)}`;
  return "";
}

/**
 * Lê os filtros da fila da URL (os nomes que hrefConversa escreve; os
 * antigos ?atendente= e ?etiqueta= de link velho entram nas listas). Valor
 * torto cai no padrão: visão e escopo fora da lista, id que não é uuid,
 * data que não existe e, com os catálogos à mão, id que não está na equipe,
 * nas etiquetas ou nas campanhas. Catálogo que não carregou (null) não barra
 * o id: o filtro só devolveria fila vazia.
 *
 * "Minhas" e "Sem dono" já dizem quem atende: com um deles, a lista de
 * atendentes sai (a tela faz o mesmo ao trocar o escopo).
 */
export function lerFiltrosFila(
  params: Record<string, string | string[] | undefined>,
  catalogos?: Pick<CatalogosChat, "equipe" | "etiquetas"> & {
    campanhas?: { id: string }[] | null;
  },
): FiltrosFila {
  const visao = primeiro(params.visao);
  const escopoBruto = primeiro(params.escopo);
  const escopo = (ESCOPOS as readonly string[]).includes(escopoBruto)
    ? (escopoBruto as EscopoConversas)
    : FILTROS_FILA_PADRAO.escopo;
  const equipe = catalogos?.equipe;
  const catalogoEtiquetas = catalogos?.etiquetas;
  const campanhas = catalogos?.campanhas;

  const atendentes =
    escopo !== "todas"
      ? []
      : cortarIdsFila(
          [...varios(params.atendentes), ...varios(params.atendente)].filter(
            (id) =>
              id === SEM_DONO ||
              (ehUuid(id) && (!equipe || equipe.some((p) => p.id === id))),
          ),
        );
  // "Sem etiqueta" exclui as etiquetas: com ele, a lista sai vazia.
  const { semEtiqueta, etiquetasModo } = lerEtiquetasDaUrl(params);
  const etiquetas = semEtiqueta
    ? []
    : cortarIdsFila(
        [...varios(params.etiquetas), ...varios(params.etiqueta)].filter(
          (id) =>
            ehUuid(id) &&
            (!catalogoEtiquetas || catalogoEtiquetas.some((t) => t.id === id)),
        ),
      );

  const campanha = primeiro(params.campanha);
  const canal = primeiro(params.canal);

  // O período: atalho ou data; a data final só com data (o atalho já vai
  // até agora). Invertidas, as duas trocam de lugar.
  const deBruto = primeiro(params.de);
  const ateBruto = primeiro(params.ate);
  let de = ehAtalhoPeriodo(deBruto) || ehDataFila(deBruto) ? deBruto : "";
  let ate = !ehAtalhoPeriodo(de) && ehDataFila(ateBruto) ? ateBruto : "";
  if (ehDataFila(de) && ate && de > ate) [de, ate] = [ate, de];

  return {
    visao: (VISOES as readonly string[]).includes(visao)
      ? (visao as VisaoConversas)
      : FILTROS_FILA_PADRAO.visao,
    escopo,
    busca: primeiro(params.busca).slice(0, 100),
    atendentes,
    etiquetas,
    etiquetasModo,
    semEtiqueta,
    campanhaId:
      ehUuid(campanha) && (!campanhas || campanhas.some((c) => c.id === campanha))
        ? campanha
        : "",
    canal: canal === "whatsapp" || canal === "direct" ? canal : "",
    de,
    ate,
    naoLidas: ehLigado(params.naoLidas),
  };
}

/** Uma chave liga-desliga da URL: "1" ou "true". */
function ehLigado(valor: string | string[] | undefined): boolean {
  const v = primeiro(valor);
  return v === "1" || v === "true";
}

// ─────────── etiquetas: o contrato comum da fila e de Contatos ───────────
//
// As duas telas filtram etiquetas do mesmo jeito e com os mesmos nomes na
// URL. As listas de ids cada uma lê com o catálogo dela; o resto sai daqui,
// para um link copiado de uma valer igual na outra.

/** O pedaço do filtro que fala das etiquetas, igual nas duas telas. */
export type FiltroDeEtiquetas = {
  etiquetas: string[];
  etiquetasModo: ModoEtiquetas;
  semEtiqueta: boolean;
};

/**
 * O modo e o "Sem etiqueta" da URL: semEtiqueta=1 (ou true) e
 * etiquetasModo=todas, sem diferença de maiúsculas. Qualquer outro valor é
 * o padrão (desligado, qualquer uma).
 */
export function lerEtiquetasDaUrl(
  params: Record<string, string | string[] | undefined>,
): Pick<FiltroDeEtiquetas, "etiquetasModo" | "semEtiqueta"> {
  return {
    semEtiqueta: ehLigado(params.semEtiqueta),
    etiquetasModo:
      primeiro(params.etiquetasModo).toLowerCase() === "todas"
        ? "todas"
        : "qualquer",
  };
}

/**
 * Escreve as etiquetas na URL. "Sem etiqueta" vence as etiquetas (é um ou
 * outro), e o modo só vai com etiqueta marcada, que é quando ele muda a
 * lista: o mesmo recorte dá sempre o mesmo endereço. `etiquetas` já vem na
 * ordem de quem chama.
 */
export function escreverEtiquetasNaUrl(
  p: URLSearchParams,
  f: FiltroDeEtiquetas,
): void {
  if (f.semEtiqueta) {
    p.set("semEtiqueta", "1");
    return;
  }
  if (f.etiquetas.length === 0) return;
  p.set("etiquetas", f.etiquetas.join(","));
  if (f.etiquetasModo === "todas") p.set("etiquetasModo", "todas");
}

/**
 * O filtro de etiquetas na pílula e na lista do funil (`valor`) e o nome
 * para o leitor de tela (`rotulo`): "Sem etiqueta"; "Todas: VIP + Frio",
 * lido "Com todas as etiquetas: VIP, Frio"; "VIP +2", lido "Etiquetas: VIP
 * +2". null sem filtro. `nomes` vem na ordem das marcadas.
 */
export function valorDoFiltroEtiquetas(
  f: Pick<FiltroDeEtiquetas, "etiquetasModo" | "semEtiqueta">,
  nomes: string[],
): { valor: string; rotulo: string } | null {
  if (f.semEtiqueta) return { valor: "Sem etiqueta", rotulo: "Sem etiqueta" };
  if (nomes.length === 0) return null;
  if (f.etiquetasModo === "todas") {
    return {
      valor: `Todas: ${nomes.join(" + ")}`,
      rotulo: `Com todas as etiquetas: ${nomes.join(", ")}`,
    };
  }
  const valor =
    nomes.length === 1
      ? nomes[0]
      : `${nomes[0]} +${(nomes.length - 1).toLocaleString("pt-BR")}`;
  return { valor, rotulo: `Etiquetas: ${valor}` };
}

/**
 * As etiquetas de um contato passam no filtro da fila? A mesma regra do
 * servidor (consultaDaFila, em conversas/lista.ts): sem etiqueta é nenhuma;
 * em "todas", cada uma das marcadas; em "qualquer", uma delas basta. Sem
 * filtro de etiqueta, passa. A tela usa para tirar da fila a conversa que
 * deixou de casar depois de pôr ou tirar uma etiqueta.
 */
export function casaComEtiquetas(
  idsDoContato: readonly string[],
  f: Pick<FiltrosFila, "etiquetas" | "etiquetasModo" | "semEtiqueta">,
): boolean {
  if (f.semEtiqueta) return idsDoContato.length === 0;
  if (f.etiquetas.length === 0) return true;
  return f.etiquetasModo === "todas"
    ? f.etiquetas.every((id) => idsDoContato.includes(id))
    : f.etiquetas.some((id) => idsDoContato.includes(id));
}

/**
 * O endereço do chat com a conversa e os filtros que estão valendo; o que
 * está no padrão fica fora da URL. É o ?voltar= que o chat manda para a
 * ficha do contato: a volta reabre a mesma fila, não a Caixa crua. As
 * listas saem em ordem fixa, e a mesma fila dá sempre o mesmo endereço (a
 * tela compara filtros por ele).
 */
export function hrefConversa(
  leadId: string | null,
  filtros: FiltrosFila,
): string {
  const p = new URLSearchParams();
  if (leadId) p.set("lead", leadId);
  if (filtros.visao !== FILTROS_FILA_PADRAO.visao) p.set("visao", filtros.visao);
  if (filtros.escopo !== FILTROS_FILA_PADRAO.escopo) {
    p.set("escopo", filtros.escopo);
  }
  const busca = filtros.busca.trim();
  if (busca) p.set("busca", busca);
  const atendentes = ordenados([
    ...(filtros.atendentes ?? []),
    ...(filtros.atendenteId ? [filtros.atendenteId] : []),
  ]);
  if (atendentes.length > 0) p.set("atendentes", atendentes.join(","));
  escreverEtiquetasNaUrl(p, {
    semEtiqueta: filtros.semEtiqueta === true,
    etiquetas: ordenados([
      ...(filtros.etiquetas ?? []),
      ...(filtros.etiquetaId ? [filtros.etiquetaId] : []),
    ]),
    etiquetasModo: filtros.etiquetasModo,
  });
  if (filtros.campanhaId) p.set("campanha", filtros.campanhaId);
  if (filtros.canal) p.set("canal", filtros.canal);
  if (filtros.de) p.set("de", filtros.de);
  if (filtros.ate && !ehAtalhoPeriodo(filtros.de)) p.set("ate", filtros.ate);
  if (filtros.naoLidas) p.set("naoLidas", "1");
  const q = p.toString();
  return q ? `/chat?${q}` : "/chat";
}

/** Os mesmos filtros (a busca inclusa)? Pelo endereço, que é canônico. */
export function mesmosFiltrosFila(a: FiltrosFila, b: FiltrosFila): boolean {
  return hrefConversa(null, a) === hrefConversa(null, b);
}

/**
 * Quantos filtros finos estão ligados: um por atendente, etiqueta e
 * campanha escolhidos, mais "sem etiqueta", período, canal e "só não
 * lidas". É o número do botão Filtros e o de chips removíveis embaixo da
 * busca.
 */
export function contarFiltrosFila(f: FiltrosFila): number {
  return (
    f.atendentes.length +
    f.etiquetas.length +
    (f.semEtiqueta ? 1 : 0) +
    (f.campanhaId ? 1 : 0) +
    (f.canal ? 1 : 0) +
    (f.de || f.ate ? 1 : 0) +
    (f.naoLidas ? 1 : 0)
  );
}

// ─────────────────────── a fila guardada (cookie) ───────────────────────

/**
 * A última fila de cada pessoa neste aparelho: visão, escopo e filtros finos
 * (a busca não entra: pode ter nome ou telefone de cliente). Cookie, e não
 * localStorage, para o servidor montar o primeiro quadro do /chat já com ela,
 * sem mostrar a Caixa crua antes (o mesmo jeito do "menu-chat").
 */
export const COOKIE_FILA = "fila-chat";
export const VALIDADE_COOKIE_FILA_S = 60 * 60 * 24 * 365;

/** "idDaPessoa|visao=adiadas&escopo=minhas". A query do URLSearchParams já
 *  sai sem vírgula, espaço nem ponto e vírgula: cabe no cookie como está. */
export function valorCookieFila(meuId: string, filtros: FiltrosFila): string {
  const href = hrefConversa(null, { ...filtros, busca: "" });
  const i = href.indexOf("?");
  return `${meuId}|${i === -1 ? "" : href.slice(i + 1)}`;
}

/**
 * A fila guardada no cookie, se for de quem está logado (outra pessoa no
 * mesmo navegador não herda a fila de ninguém). Valor torto vale como fila
 * nenhuma; os filtros passam pela mesma leitura da URL (lerFiltrosFila).
 */
export function lerCookieFila(
  valor: string | undefined,
  meuId: string,
): FiltrosFila | null {
  if (!valor) return null;
  let bruto = valor;
  if (bruto.includes("%7C") || bruto.includes("%7c")) {
    try {
      bruto = decodeURIComponent(bruto);
    } catch {
      return null;
    }
  }
  const i = bruto.indexOf("|");
  if (i === -1 || bruto.slice(0, i) !== meuId) return null;
  const params: Record<string, string> = {};
  new URLSearchParams(bruto.slice(i + 1)).forEach((v, k) => {
    params[k] = v;
  });
  return { ...lerFiltrosFila(params), busca: "" };
}

/** A URL já diz qual fila mostrar: algum dos parâmetros da fila. */
export function filaNaUrl(
  params: Record<string, string | string[] | undefined>,
): boolean {
  return PARAMETROS_FILA.some((nome) => {
    const v = params[nome];
    return Array.isArray(v) ? v.some(Boolean) : Boolean(v);
  });
}

/** Os filtros finos todos de fora (visão, escopo e busca ficam). */
export const SEM_FILTROS_FINOS: Pick<
  FiltrosFila,
  | "atendentes"
  | "etiquetas"
  | "etiquetasModo"
  | "semEtiqueta"
  | "campanhaId"
  | "canal"
  | "de"
  | "ate"
  | "naoLidas"
> = {
  atendentes: [],
  etiquetas: [],
  etiquetasModo: "qualquer",
  semEtiqueta: false,
  campanhaId: "",
  canal: "",
  de: "",
  ate: "",
  naoLidas: false,
};
