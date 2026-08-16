/**
 * Cliente mínimo da API do Chatwoot. Usado só no servidor — o token nunca
 * chega ao navegador.
 */

export type ConversaChatwoot = {
  id: number;
  status: string;
  labels: string[];
  created_at: number; // unix
  last_activity_at?: number;
  meta: {
    sender?: {
      id: number;
      name?: string;
      phone_number?: string | null;
      email?: string | null;
    };
    assignee?: {
      email?: string | null;
      name?: string | null;
    } | null;
  };
};

type RespostaConversas = {
  data: {
    meta: { all_count: number };
    payload: ConversaChatwoot[];
  };
};

export type TemplateWhatsapp = {
  nome: string;
  idioma: string;
  categoria: string;
  corpo: string;
  /** Tokens de variável na ordem em que aparecem no corpo ("1", "2"…). */
  parametros: string[];
};

export type StatusConversa = "open" | "resolved" | "pending" | "snoozed";

function config() {
  const base = process.env.CHATWOOT_BASE_URL?.replace(/\/+$/, "");
  const conta = process.env.CHATWOOT_ACCOUNT_ID;
  const token = process.env.CHATWOOT_API_TOKEN;

  if (!base || !conta || !token) {
    throw new Error(
      "Chatwoot não configurado: preencha CHATWOOT_BASE_URL, CHATWOOT_ACCOUNT_ID e CHATWOOT_API_TOKEN no .env.local.",
    );
  }

  return { base, conta, token };
}

async function chamar<T>(caminho: string, init?: RequestInit): Promise<T> {
  const { base, conta, token } = config();

  const resposta = await fetch(`${base}/api/v1/accounts/${conta}${caminho}`, {
    ...init,
    headers: {
      api_access_token: token,
      "Content-Type": "application/json",
      ...init?.headers,
    },
    cache: "no-store",
  });

  if (!resposta.ok) {
    throw new Error(`Chatwoot ${resposta.status} em ${caminho}`);
  }

  return (await resposta.json()) as T;
}

export async function listarConversas(pagina: number) {
  const resposta = await chamar<RespostaConversas>(
    `/conversations?status=all&sort_by=last_activity_at_desc&page=${pagina}`,
  );
  return {
    total: resposta.data.meta.all_count,
    conversas: resposta.data.payload ?? [],
  };
}

/** Envia texto numa conversa existente. Devolve o id da mensagem criada. */
export async function enviarMensagem(conversaId: number, conteudo: string) {
  return chamar<{ id: number }>(`/conversations/${conversaId}/messages`, {
    method: "POST",
    body: JSON.stringify({ content: conteudo, message_type: "outgoing" }),
  });
}

/** Nota privada: aparece no Chatwoot para a equipe, nunca chega ao lead. */
export async function enviarNotaPrivada(conversaId: number, conteudo: string) {
  return chamar<{ id: number }>(`/conversations/${conversaId}/messages`, {
    method: "POST",
    body: JSON.stringify({
      content: conteudo,
      message_type: "outgoing",
      private: true,
    }),
  });
}

export type MensagemChatwoot = {
  id: number;
  content?: string | null;
  message_type?: number; // 0 recebida, 1 enviada, 2 atividade, 3 template
  private?: boolean;
  created_at?: number; // unix
  sender?: { email?: string | null; type?: string | null } | null;
  attachments?: { file_type?: string | null; data_url?: string | null }[];
};

/**
 * Uma página de mensagens da conversa (20 por vez, das mais novas para as
 * mais antigas ao paginar com `before`). Usada no backfill do histórico.
 */
export async function listarMensagensConversa(
  conversaId: number,
  before?: number,
) {
  const sufixo = before ? `?before=${before}` : "";
  const resposta = await chamar<{ payload: MensagemChatwoot[] }>(
    `/conversations/${conversaId}/messages${sufixo}`,
  );
  return resposta.payload ?? [];
}

/**
 * Envia mensagem com anexos (multipart — o Content-Type fica por conta do
 * fetch, que define o boundary). Devolve também os anexos processados, com
 * a URL final que o Chatwoot hospedou.
 */
export async function enviarMensagemComAnexos(
  conversaId: number,
  conteudo: string,
  arquivos: File[],
) {
  const { base, conta, token } = config();

  const corpo = new FormData();
  if (conteudo) corpo.append("content", conteudo);
  corpo.append("message_type", "outgoing");
  for (const arquivo of arquivos) {
    corpo.append("attachments[]", arquivo, arquivo.name);
  }

  const resposta = await fetch(
    `${base}/api/v1/accounts/${conta}/conversations/${conversaId}/messages`,
    {
      method: "POST",
      headers: { api_access_token: token },
      body: corpo,
      cache: "no-store",
    },
  );

  if (!resposta.ok) {
    throw new Error(`Chatwoot ${resposta.status} ao enviar anexos`);
  }

  return (await resposta.json()) as {
    id: number;
    attachments?: { file_type?: string | null; data_url?: string | null }[];
  };
}

// ---------------------------------------------------------------------------
// Templates do WhatsApp
// ---------------------------------------------------------------------------

type InboxChatwoot = {
  id: number;
  name: string;
  channel_type: string;
  message_templates?: {
    name: string;
    status?: string;
    category?: string;
    language?: string;
    components?: { type?: string; format?: string; text?: string }[];
  }[];
};

// A lista de templates muda raramente; a página do chat se atualiza a cada
// 5s, então um cache curto evita marretar a API do Chatwoot.
const TTL_CACHE_MS = 5 * 60_000;
let cacheTemplates: { dados: TemplateWhatsapp[]; expira: number } | null = null;

function extrairParametros(corpo: string): string[] {
  const tokens: string[] = [];
  for (const m of corpo.matchAll(/\{\{\s*([^{}]+?)\s*\}\}/g)) {
    if (!tokens.includes(m[1])) tokens.push(m[1]);
  }
  return tokens;
}

/**
 * Templates aprovados dos inboxes de WhatsApp. Só entram os de corpo em
 * texto (cabeçalho de mídia exige upload, fora do escopo do CRM).
 */
export async function listarTemplates(): Promise<TemplateWhatsapp[]> {
  if (cacheTemplates && Date.now() < cacheTemplates.expira) {
    return cacheTemplates.dados;
  }

  const resposta = await chamar<{ payload: InboxChatwoot[] }>("/inboxes");
  const dados: TemplateWhatsapp[] = [];

  for (const inbox of resposta.payload ?? []) {
    if (inbox.channel_type !== "Channel::Whatsapp") continue;

    for (const tpl of inbox.message_templates ?? []) {
      if ((tpl.status ?? "").toUpperCase() !== "APPROVED") continue;

      const cabecalho = tpl.components?.find((c) => c.type === "HEADER");
      if (cabecalho && cabecalho.format && cabecalho.format !== "TEXT") {
        continue; // cabeçalho de imagem/vídeo/documento
      }

      const corpo = tpl.components?.find((c) => c.type === "BODY")?.text ?? "";
      if (!corpo) continue;

      dados.push({
        nome: tpl.name,
        idioma: tpl.language ?? "pt_BR",
        categoria: tpl.category ?? "UTILITY",
        corpo,
        parametros: extrairParametros(corpo),
      });
    }
  }

  cacheTemplates = { dados, expira: Date.now() + TTL_CACHE_MS };
  return dados;
}

/**
 * Dispara um template numa conversa. É o único jeito de falar com o lead
 * fora da janela de 24h do WhatsApp. `valores` é indexado pelo token da
 * variável ({{1}} -> "1").
 */
export async function enviarTemplate(
  conversaId: number,
  template: TemplateWhatsapp,
  valores: Record<string, string>,
) {
  const conteudo = template.corpo.replace(
    /\{\{\s*([^{}]+?)\s*\}\}/g,
    (bloco, token: string) => valores[token] ?? bloco,
  );

  return chamar<{ id: number }>(`/conversations/${conversaId}/messages`, {
    method: "POST",
    body: JSON.stringify({
      content: conteudo,
      message_type: "outgoing",
      template_params: {
        name: template.nome,
        category: template.categoria,
        language: template.idioma,
        processed_params: valores,
      },
    }),
  });
}

// ---------------------------------------------------------------------------
// Início de conversa pelo CRM
// ---------------------------------------------------------------------------

type ContatoChatwoot = {
  id: number;
  contact_inboxes?: {
    source_id?: string | null;
    inbox?: { id?: number };
  }[];
};

let cacheInboxWhatsapp: { id: number | null; expira: number } | null = null;

/** Id do primeiro inbox de WhatsApp da conta (com cache curto). */
async function inboxWhatsappId(): Promise<number | null> {
  if (cacheInboxWhatsapp && Date.now() < cacheInboxWhatsapp.expira) {
    return cacheInboxWhatsapp.id;
  }
  const resposta = await chamar<{ payload: InboxChatwoot[] }>("/inboxes");
  const inbox = (resposta.payload ?? []).find(
    (i) => i.channel_type === "Channel::Whatsapp",
  );
  cacheInboxWhatsapp = {
    id: inbox?.id ?? null,
    expira: Date.now() + TTL_CACHE_MS,
  };
  return inbox?.id ?? null;
}

/**
 * Garante contato e conversa no Chatwoot para o CRM puxar assunto.
 * Devolve os ids para vincular ao lead. O envio em si fica com quem chamou —
 * e o primeiro contato SEMPRE precisa ser template, regra do WhatsApp.
 */
export async function iniciarConversaWhatsapp(opcoes: {
  nome: string;
  telefone: string; // dígitos com DDI, ex.: 5511988421170
  contatoId?: number | null;
}): Promise<{ contatoId: number; conversaId: number }> {
  const inboxId = await inboxWhatsappId();
  if (!inboxId) throw new Error("Nenhum inbox de WhatsApp no Chatwoot.");

  // 1. Contato: usa o vínculo do lead, acha pelo telefone ou cria.
  let contatoId = opcoes.contatoId ?? null;
  if (!contatoId) {
    const busca = await chamar<{ payload: { id: number }[] }>(
      `/contacts/search?q=${encodeURIComponent(opcoes.telefone)}`,
    );
    contatoId = busca.payload?.[0]?.id ?? null;
  }
  if (!contatoId) {
    const criado = await chamar<{ payload: { contact: { id: number } } }>(
      "/contacts",
      {
        method: "POST",
        body: JSON.stringify({
          name: opcoes.nome,
          phone_number: `+${opcoes.telefone}`,
        }),
      },
    );
    contatoId = criado.payload?.contact?.id ?? null;
    if (!contatoId) throw new Error("O Chatwoot não devolveu o contato criado.");
  }

  // 2. source_id do contato neste inbox (cria o vínculo se não houver).
  const detalhe = await chamar<{ payload?: ContatoChatwoot } & ContatoChatwoot>(
    `/contacts/${contatoId}`,
  );
  const contato = detalhe.payload ?? detalhe;
  let sourceId =
    (contato.contact_inboxes ?? []).find((ci) => ci.inbox?.id === inboxId)
      ?.source_id ?? null;
  if (!sourceId) {
    const vinculo = await chamar<{ source_id?: string }>(
      `/contacts/${contatoId}/contact_inboxes`,
      {
        method: "POST",
        body: JSON.stringify({ inbox_id: inboxId, source_id: opcoes.telefone }),
      },
    );
    sourceId = vinculo.source_id ?? opcoes.telefone;
  }

  // 3. Conversa nova, já aberta.
  const conversa = await chamar<{ id: number }>("/conversations", {
    method: "POST",
    body: JSON.stringify({
      inbox_id: inboxId,
      contact_id: contatoId,
      source_id: sourceId,
      status: "open",
    }),
  });

  return { contatoId, conversaId: conversa.id };
}

// ---------------------------------------------------------------------------
// Estado da conversa: status, etiquetas, atendente
// ---------------------------------------------------------------------------

export async function obterStatusConversa(
  conversaId: number,
): Promise<StatusConversa | null> {
  const resposta = await chamar<
    { status?: StatusConversa } & { payload?: { status?: StatusConversa } }
  >(`/conversations/${conversaId}`);
  return resposta.status ?? resposta.payload?.status ?? null;
}

export async function alterarStatusConversa(
  conversaId: number,
  status: "open" | "resolved",
) {
  await chamar(`/conversations/${conversaId}/toggle_status`, {
    method: "POST",
    body: JSON.stringify({ status }),
  });
}

/** Substitui o conjunto de etiquetas da conversa. */
export async function definirEtiquetasConversa(
  conversaId: number,
  etiquetas: string[],
) {
  await chamar(`/conversations/${conversaId}/labels`, {
    method: "POST",
    body: JSON.stringify({ labels: etiquetas }),
  });
}

let cacheAgentes: {
  dados: { id: number; email: string }[];
  expira: number;
} | null = null;

async function listarAgentes() {
  if (cacheAgentes && Date.now() < cacheAgentes.expira) {
    return cacheAgentes.dados;
  }
  const resposta = await chamar<{ id: number; email?: string }[]>("/agents");
  const dados = (Array.isArray(resposta) ? resposta : []).map((a) => ({
    id: a.id,
    email: (a.email ?? "").toLowerCase(),
  }));
  cacheAgentes = { dados, expira: Date.now() + TTL_CACHE_MS };
  return dados;
}

/**
 * Atribui a conversa ao agente do Chatwoot com este e-mail (o vínculo entre
 * CRM e Chatwoot é o e-mail). `null` remove a atribuição. Devolve false se
 * não houver agente correspondente.
 */
export async function atribuirConversaPorEmail(
  conversaId: number,
  email: string | null,
) {
  let assigneeId = 0;
  if (email) {
    const agente = (await listarAgentes()).find(
      (a) => a.email === email.toLowerCase(),
    );
    if (!agente) return false;
    assigneeId = agente.id;
  }

  await chamar(`/conversations/${conversaId}/assignments`, {
    method: "POST",
    body: JSON.stringify({ assignee_id: assigneeId }),
  });
  return true;
}
