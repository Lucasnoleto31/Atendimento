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
