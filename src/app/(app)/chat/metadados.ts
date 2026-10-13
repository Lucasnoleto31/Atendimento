import type { SupabaseClient } from "@supabase/supabase-js";

/**
 * O que a conversa guarda em lead_interactions.metadados além do texto: a
 * resposta citada, as reações, a marca de apagada e de editada, a
 * localização e o contato compartilhado. Tudo cabe no jsonb que já existe;
 * nenhuma coluna nova.
 *
 * Módulo puro, sem nada que só rode no servidor: o webhook (com o cliente de
 * service role) e as actions do chat (etapa 2) gravam pelas mesmas funções,
 * e a tela lê os mesmos tipos (paraMensagem, em mensagem.ts).
 *
 * As chaves no jsonb, em snake_case como as que já existiam (message_id,
 * status_envio, erro_envio):
 *   resposta_a   RespostaAGravada   a mensagem citada (o "responder" do app)
 *   encaminhada  "uma" | "muitas"   o selo "Encaminhada" do WhatsApp
 *   reacoes      ReacaoGravada[]    uma por pessoa; emoji "" = tirou
 *   apagada      ApagadaGravada     quem apagou e quando
 *   editada      EdicaoGravada      quando e o texto de antes
 *   localizacao  LocalizacaoGravada
 *   contatos     ContatoGravado[]
 *   rev          number             sobe a cada gravação por aqui (a trava)
 */

/** Reação a uma mensagem. Uma por pessoa: a nova troca a anterior. */
export type ReacaoGravada = {
  /** "contato" = o cliente; senão o id (profiles) de quem reagiu na equipe. */
  de: string;
  /** "" = a pessoa tirou a reação. Fica gravado para uma reação atrasada
   *  (a Meta não garante a ordem) não voltar por cima da remoção. */
  emoji: string;
  /** Quando reagiu (ISO). A mais nova vence. */
  em: string;
  /** Nome de quem da equipe reagiu, gravado junto. */
  nome?: string | null;
};

export type ApagadaGravada = {
  /** "contato": o cliente apagou para todos. "equipe": escondida no
   *  Atendimento (a Meta não deixa a empresa apagar no aparelho do
   *  contato). */
  por: "contato" | "equipe";
  em: string;
  autor_id?: string | null;
  nome?: string | null;
};

export type EdicaoGravada = {
  em: string;
  /** O texto de antes da PRIMEIRA edição (o registro do que chegou). */
  original: string | null;
  /** Quantas vezes foi editada, quando a Meta conta (Instagram). */
  vezes?: number | null;
  /** A Meta avisou da edição sem mandar o texto novo. */
  sem_texto?: boolean;
};

/** A mensagem citada, como estava quando a resposta chegou. */
export type RespostaAGravada = {
  /** O id da Meta da citada (wamid no WhatsApp, mid no Direct). */
  id?: string | null;
  /** A nossa linha em lead_interactions, quando foi achada. */
  interacao_id?: string | null;
  /** criado_em da citada: é por ele que a tela busca o histórico antigo. */
  em?: string | null;
  de?: "contato" | "equipe" | null;
  /** Quem escreveu a citada: o nome do contato ou de quem da equipe. */
  autor?: string | null;
  /** Começo do texto (até 200 caracteres), sem o rótulo de mídia. */
  trecho?: string | null;
  /** O tipo do primeiro anexo da citada ("image", "audio"...). */
  midia?: string | null;
  /** Resposta a um story do Instagram, em vez de a uma mensagem. */
  story?: { id?: string | null; url?: string | null } | null;
};

export type LocalizacaoGravada = {
  latitude: number;
  longitude: number;
  nome?: string | null;
  endereco?: string | null;
  url?: string | null;
};

export type ContatoGravado = {
  nome: string;
  telefones: { numero: string; wa_id?: string | null; tipo?: string | null }[];
  emails: string[];
  empresa?: string | null;
};

export type EncaminhadaGravada = "uma" | "muitas";

/** Teto do trecho guardado da mensagem citada. */
export const TETO_TRECHO = 200;

/** O jsonb como ele chega: qualquer coisa. */
export type MetadadosBrutos = Record<string, unknown>;

function ehObjeto(v: unknown): v is Record<string, unknown> {
  return typeof v === "object" && v !== null && !Array.isArray(v);
}

/** As reações gravadas, tolerando lixo (sai o item quebrado). */
export function lerReacoes(bruto: unknown): ReacaoGravada[] {
  if (!Array.isArray(bruto)) return [];
  const lidas: ReacaoGravada[] = [];
  for (const item of bruto) {
    if (!ehObjeto(item)) continue;
    const de = typeof item.de === "string" ? item.de : "";
    const em = typeof item.em === "string" ? item.em : "";
    if (!de || !em) continue;
    lidas.push({
      de,
      emoji: typeof item.emoji === "string" ? item.emoji : "",
      em,
      nome: typeof item.nome === "string" ? item.nome : null,
    });
  }
  return lidas;
}

/**
 * A lista com a reação nova no lugar da anterior da mesma pessoa. null =
 * nada muda (a gravada é mais nova, ou é igual): quem chama não grava.
 */
export function comReacao(
  bruto: unknown,
  nova: ReacaoGravada,
): ReacaoGravada[] | null {
  const atuais = lerReacoes(bruto);
  const i = atuais.findIndex((r) => r.de === nova.de);
  if (i === -1) {
    // Tirar uma reação que nunca chegou: nada a gravar.
    return nova.emoji ? [...atuais, nova] : null;
  }
  const atual = atuais[i];
  if (Date.parse(atual.em) > Date.parse(nova.em)) return null;
  if (atual.emoji === nova.emoji && atual.nome === (nova.nome ?? null)) {
    return null;
  }
  const lista = atuais.slice();
  lista[i] = nova;
  return lista;
}

/** A linha de lead_interactions que esta função lê e regrava. */
export type LinhaParaGravar = {
  metadados: MetadadosBrutos;
  conteudo: string | null;
};

/** O que gravar: os metadados novos e, se mudou, o texto. */
export type Gravacao = { metadados: MetadadosBrutos; conteudo?: string | null };

/** Cliente do Supabase: o de service role no webhook, o da sessão (ou o de
 *  service role, depois de conferir o acesso) nas actions. */
export type ClienteSupabase = Pick<SupabaseClient, "from">;

/**
 * Regrava os metadados (e o texto, se mudar) de uma interação sem atropelar
 * outra gravação no meio: recibo, reação, apagada e edição chegam em POSTs
 * simultâneos, e o update troca o jsonb inteiro. Cada gravação sobe o `rev`
 * e só vale se o `rev` ainda for o lido; se outra entrou no meio, relê e
 * decide de novo em cima do valor novo.
 *
 * `mudar` devolve null quando não há nada a gravar. `lida` evita a primeira
 * leitura quando quem chama já tem a linha.
 *
 * Com o cliente de service role, a policy de UPDATE (só gestão) não vale.
 * Por isso, nas actions o `mudar` só troca a chave apagada e nunca devolve
 * `conteudo`: o texto só muda pelo webhook (a edição do contato), e o
 * registro que o compliance lê fica inteiro. Reação só chega pelo webhook
 * (a do contato): a equipe não reage pelo Atendimento.
 */
export async function regravarInteracao(
  cliente: ClienteSupabase,
  id: string,
  mudar: (atual: LinhaParaGravar) => Gravacao | null,
  lida?: LinhaParaGravar | null,
): Promise<{ ok: true; gravou: boolean } | { ok: false; erro: string }> {
  let atual: LinhaParaGravar | null = lida ?? null;
  for (let tentativa = 0; tentativa < 4; tentativa++) {
    if (!atual) {
      const { data, error } = await cliente
        .from("lead_interactions")
        .select("metadados, conteudo")
        .eq("id", id)
        .maybeSingle();
      if (error) return { ok: false, erro: error.message };
      if (!data) return { ok: false, erro: "Mensagem não encontrada." };
      const linha = data as { metadados: unknown; conteudo: string | null };
      atual = {
        metadados: ehObjeto(linha.metadados) ? linha.metadados : {},
        conteudo: linha.conteudo,
      };
    }

    const proxima = mudar(atual);
    if (!proxima) return { ok: true, gravou: false };

    const revLido =
      typeof atual.metadados.rev === "number" ? atual.metadados.rev : null;
    const update = cliente
      .from("lead_interactions")
      .update({
        metadados: { ...proxima.metadados, rev: (revLido ?? 0) + 1 },
        ...(proxima.conteudo !== undefined ? { conteudo: proxima.conteudo } : {}),
      })
      .eq("id", id);
    const { data, error } = await (
      revLido === null
        ? update.is("metadados->>rev", null)
        : update.eq("metadados->>rev", String(revLido))
    ).select("id");
    if (error) return { ok: false, erro: error.message };
    if (data?.length) return { ok: true, gravou: true };
    // Outra gravação entrou no meio: relê e decide de novo.
    atual = null;
  }
  return { ok: false, erro: "Outra gravação ficou entrando no meio." };
}

/** A interação achada pelo id da Meta, com o que a citação precisa. */
export type InteracaoPorIdMeta = {
  id: string;
  tipo: string;
  conteudo: string | null;
  criado_em: string;
  metadados: MetadadosBrutos;
  autor: { nome: string } | null;
};

/**
 * A mensagem deste contato com este id da Meta (wamid ou mid), de qualquer
 * lado da conversa. O envio com vários anexos guarda um id por arquivo em
 * message_ids: a segunda busca só sai se a primeira não achar. A busca anda
 * pelo índice (lead_id, criado_em) do contato.
 */
export async function acharInteracaoPorIdMeta(
  cliente: ClienteSupabase,
  leadId: string,
  idMeta: string,
): Promise<InteracaoPorIdMeta | null> {
  const campos = "id, tipo, conteudo, criado_em, metadados, autor:profiles(nome)";
  const { data, error } = await cliente
    .from("lead_interactions")
    .select(campos)
    .eq("lead_id", leadId)
    .in("tipo", ["mensagem_recebida", "mensagem_enviada", "nota"])
    .eq("metadados->>message_id", idMeta)
    .order("criado_em", { ascending: false })
    .limit(1)
    .maybeSingle();
  if (error) throw new Error(`Falha ao achar a mensagem ${idMeta}: ${error.message}`);
  if (data) return normalizarInteracao(data);

  const { data: porLista, error: erroLista } = await cliente
    .from("lead_interactions")
    .select(campos)
    .eq("lead_id", leadId)
    .eq("tipo", "mensagem_enviada")
    .contains("metadados", { message_ids: [idMeta] })
    .order("criado_em", { ascending: false })
    .limit(1)
    .maybeSingle();
  if (erroLista) {
    throw new Error(`Falha ao achar a mensagem ${idMeta}: ${erroLista.message}`);
  }
  return porLista ? normalizarInteracao(porLista) : null;
}

function normalizarInteracao(bruta: unknown): InteracaoPorIdMeta {
  const l = bruta as {
    id: string;
    tipo: string;
    conteudo: string | null;
    criado_em: string;
    metadados: unknown;
    autor: { nome: string } | { nome: string }[] | null;
  };
  const autor = Array.isArray(l.autor) ? (l.autor[0] ?? null) : l.autor;
  return {
    id: l.id,
    tipo: l.tipo,
    conteudo: l.conteudo,
    criado_em: l.criado_em,
    metadados: ehObjeto(l.metadados) ? l.metadados : {},
    autor: autor ?? null,
  };
}

/** O texto é só o rótulo de mídia ("[imagem]") ou o nome do arquivo? */
export function textoEhRotulo(
  conteudo: string | null | undefined,
  anexos: { nome?: string | null }[] = [],
): boolean {
  const texto = (conteudo ?? "").trim();
  if (!texto) return true;
  if (/^\[[^\]\n]+\]$/.test(texto)) return true;
  const nome = anexos[0]?.nome;
  return Boolean(nome) && (texto === nome || texto.startsWith(`${nome} (`));
}

/**
 * O retrato da mensagem citada que vai junto da resposta: a tela mostra o
 * trecho mesmo quando a citada é antiga demais para estar carregada.
 * `nomeContato` é o nome do contato, para a citada que veio dele.
 */
export function retratoDaCitada(
  citada: InteracaoPorIdMeta,
  idMeta: string,
  nomeContato: string | null,
): RespostaAGravada {
  const deContato = citada.tipo === "mensagem_recebida";
  const anexos = Array.isArray(citada.metadados.anexos)
    ? (citada.metadados.anexos as { tipo?: unknown; nome?: unknown }[])
    : [];
  const nomes = anexos.map((a) => ({
    nome: typeof a?.nome === "string" ? a.nome : null,
  }));
  const via = typeof citada.metadados.via === "string" ? citada.metadados.via : "";
  const automatica = Boolean(citada.metadados.automatica) || via !== "crm";
  const texto = textoEhRotulo(citada.conteudo, nomes)
    ? null
    : (citada.conteudo ?? "").trim().slice(0, TETO_TRECHO);
  const primeiro = anexos[0];
  return {
    id: idMeta,
    interacao_id: citada.id,
    em: citada.criado_em,
    de: deContato ? "contato" : "equipe",
    autor: deContato
      ? nomeContato
      : (citada.autor?.nome ?? (automatica ? "Automático" : null)),
    trecho: texto,
    midia:
      primeiro && typeof primeiro.tipo === "string" ? primeiro.tipo : null,
  };
}
