/**
 * Direct do Instagram pela API da Meta.
 *
 * Diferenças que importam em relação ao WhatsApp:
 *
 * - O destinatário é o IGSID (Instagram-scoped ID), não um telefone. Ele só
 *   existe depois que a pessoa manda a primeira mensagem — não dá para
 *   "puxar assunto" com quem nunca escreveu.
 * - NÃO EXISTE TEMPLATE. Fora da janela de 24h o WhatsApp deixa mandar
 *   template aprovado; no Instagram não há equivalente. A única extensão é a
 *   marca de atendimento humano, que estende para 7 dias e exige permissão
 *   aprovada pela Meta.
 * - O envio sai pelo perfil do negócio (o do Fabricio). Quem respondeu de
 *   verdade fica registrado no CRM, em autor_id da interação.
 */

const GRAPH = "https://graph.instagram.com/v25.0";

/** Janela padrão de resposta; com a marca de atendimento humano vai a 7 dias. */
export const JANELA_DIRECT_HORAS = 24;

export function instagramConfigurado(): boolean {
  return Boolean(
    process.env.INSTAGRAM_TOKEN && process.env.INSTAGRAM_ACCOUNT_ID,
  );
}

function token(): string {
  const t = process.env.INSTAGRAM_TOKEN;
  if (!t) throw new Error("INSTAGRAM_TOKEN não configurado.");
  return t;
}

function contaId(): string {
  const id = process.env.INSTAGRAM_ACCOUNT_ID;
  if (!id) throw new Error("INSTAGRAM_ACCOUNT_ID não configurado.");
  return id;
}

type RespostaEnvio = { message_id?: string; recipient_id?: string };

async function graph<T>(caminho: string, init?: RequestInit): Promise<T> {
  const resposta = await fetch(`${GRAPH}${caminho}`, {
    ...init,
    headers: {
      Authorization: `Bearer ${token()}`,
      "Content-Type": "application/json",
      ...init?.headers,
    },
    cache: "no-store",
  });

  const json = (await resposta.json().catch(() => null)) as
    | (T & { error?: { message?: string; code?: number } })
    | null;

  if (!resposta.ok) {
    const erro = json?.error;
    // O código vem junto: a tradução na tela depende dele (janela fechada,
    // token expirado, usuário que bloqueou o perfil…).
    throw new Error(
      `Instagram${erro?.code ? ` ${erro.code}` : ""}: ${
        erro?.message ?? `HTTP ${resposta.status}`
      }`,
    );
  }
  return json as T;
}

/** Manda texto no Direct. `humano` estende a janela para 7 dias. */
export async function enviarTextoInstagram(
  igsid: string,
  texto: string,
  humano = false,
): Promise<string | null> {
  const r = await graph<RespostaEnvio>(`/${contaId()}/messages`, {
    method: "POST",
    body: JSON.stringify({
      recipient: { id: igsid },
      message: { text: texto },
      ...(humano
        ? { messaging_type: "MESSAGE_TAG", tag: "HUMAN_AGENT" }
        : {}),
    }),
  });
  return r.message_id ?? null;
}

/**
 * Manda mídia por URL pública. O Instagram baixa o arquivo da URL — por isso
 * o anexo precisa estar no Storage público antes, como já acontece no chat.
 */
export async function enviarMidiaInstagram(
  igsid: string,
  url: string,
  tipo: "image" | "video" | "audio",
  humano = false,
): Promise<string | null> {
  const r = await graph<RespostaEnvio>(`/${contaId()}/messages`, {
    method: "POST",
    body: JSON.stringify({
      recipient: { id: igsid },
      message: { attachment: { type: tipo, payload: { url } } },
      ...(humano
        ? { messaging_type: "MESSAGE_TAG", tag: "HUMAN_AGENT" }
        : {}),
    }),
  });
  return r.message_id ?? null;
}

/** Nome e @ de quem escreveu, para o lead não nascer como um número. */
export async function perfilInstagram(
  igsid: string,
): Promise<{ nome: string | null; usuario: string | null }> {
  try {
    const r = await graph<{ name?: string; username?: string }>(
      `/${igsid}?fields=name,username`,
    );
    return { nome: r.name ?? null, usuario: r.username ?? null };
  } catch {
    // Perfil sem permissão de leitura não impede a conversa de existir.
    return { nome: null, usuario: null };
  }
}

/** Tradução dos erros que a equipe vai ver no chat. */
export function descreverErroInstagram(msg: string): string {
  if (/\b10\b|permission/i.test(msg)) {
    return "A Meta recusou por permissão — confira se o app tem instagram_manage_messages aprovado.";
  }
  if (/\b190\b|token/i.test(msg)) {
    return "Token do Instagram inválido ou expirado — gere outro no painel da Meta.";
  }
  if (/outside.*window|24 ?h|2534037/i.test(msg)) {
    return "Passou da janela de 24h do Direct. O Instagram não tem template: só dá para responder se a pessoa escrever de novo.";
  }
  return msg;
}
