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
 *   verdade fica registrado no sistema, em autor_id da interação.
 */

const GRAPH = "https://graph.instagram.com/v25.0";

// Sem teto, uma Meta travada segura a função até o limite da Vercel. Mídia
// tem prazo maior: o Instagram baixa o arquivo da nossa URL antes de responder.
const TEMPO_GRAPH_MS = 15_000;
const TEMPO_MIDIA_MS = 30_000;
const TEMPO_PERFIL_MS = 5_000;
const TEMPO_FOTO_MS = 10_000;
const TEMPO_ANEXO_MS = 30_000;

const MB = 1024 * 1024;

/** A foto de perfil do Instagram tem poucos KB; acima disso não é avatar. */
const FOTO_MAX_BYTES = 2 * MB;

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
  let resposta: Response;
  try {
    resposta = await fetch(`${GRAPH}${caminho}`, {
      ...init,
      headers: {
        Authorization: `Bearer ${token()}`,
        "Content-Type": "application/json",
        ...init?.headers,
      },
      cache: "no-store",
      signal: init?.signal ?? AbortSignal.timeout(TEMPO_GRAPH_MS),
    });
  } catch (e) {
    // Sem resposta não dá para saber se o Direct chegou a sair: quem tentou
    // mandar precisa conferir a conversa antes de repetir.
    const nome = (e as { name?: string } | null)?.name;
    if (nome === "TimeoutError" || nome === "AbortError") {
      throw new Error(
        "Instagram: sem resposta a tempo. Se era um envio, confira a conversa antes de repetir.",
      );
    }
    throw e;
  }

  const json = (await resposta.json().catch(() => null)) as
    | (T & {
        error?: { message?: string; code?: number; error_subcode?: number };
      })
    | null;

  if (!resposta.ok) {
    const erro = json?.error;
    // Código e subcódigo vêm junto ("Instagram 10/2534022: ..."): a tradução
    // na tela depende deles (janela fechada, token expirado, usuário que
    // bloqueou o perfil…).
    const codigo = erro?.code
      ? ` ${erro.code}${erro.error_subcode ? `/${erro.error_subcode}` : ""}`
      : "";
    throw new Error(
      `Instagram${codigo}: ${erro?.message ?? `HTTP ${resposta.status}`}`,
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
    signal: AbortSignal.timeout(TEMPO_MIDIA_MS),
  });
  return r.message_id ?? null;
}

/*
 * Responder citando (reply_to) não sai pelo Direct: a Meta documenta o campo
 * só no caminho do Facebook (token de Página), não no login pelo Instagram
 * que este arquivo usa. Até alguém testar, a citação do Direct fica só no
 * Atendimento.
 */

export type PerfilInstagram = {
  nome: string | null;
  usuario: string | null;
  /** Link da foto no CDN da Meta. Expira: serve só para copiar na hora. */
  foto: string | null;
};

/**
 * Nome, @ e foto de quem escreveu, para o contato não nascer como um número.
 *
 * A foto não derruba o nome: um campo que a Graph recusa derruba a chamada
 * inteira, e o profile_pic depende de permissão e da conta expor a foto.
 * Se o pedido com a foto falha ou estoura o prazo, sai um segundo só com
 * nome e @, como a versão anterior pedia, e a foto volta nula. No pior caso
 * o webhook espera os dois prazos.
 */
export async function perfilInstagram(igsid: string): Promise<PerfilInstagram> {
  // Prazo curto: sem perfil o contato só nasce com nome genérico; não vale
  // segurar o webhook por isso.
  const pedir = (campos: string) =>
    graph<{ name?: string; username?: string; profile_pic?: string }>(
      `/${igsid}?fields=${campos}`,
      { signal: AbortSignal.timeout(TEMPO_PERFIL_MS) },
    );
  try {
    const r = await pedir("name,username,profile_pic");
    return {
      nome: r.name ?? null,
      usuario: r.username ?? null,
      foto: r.profile_pic ?? null,
    };
  } catch {
    // Segue para o pedido sem a foto.
  }
  try {
    const r = await pedir("name,username");
    return { nome: r.name ?? null, usuario: r.username ?? null, foto: null };
  } catch {
    // Perfil sem permissão de leitura não impede a conversa de existir.
    return { nome: null, usuario: null, foto: null };
  }
}

/** O que um download do CDN da Meta aceita. */
export type RegraDownload = {
  /** Decide pelo content-type, já sem parâmetros e em minúsculas. */
  aceita: (tipo: string) => boolean;
  tetoBytes: number;
  /** Vale para a conexão e para a leitura do corpo. */
  prazoMs: number;
};

/**
 * Baixa um arquivo do CDN da Meta (foto de perfil, anexo do Direct). O link
 * expira, por isso quem chama guarda a cópia no Storage. Exige https, aceita
 * só o tipo e o tamanho da regra e corta pelo prazo; o resto vira erro com o
 * motivo, para o log.
 */
export async function baixarMidiaInstagram(
  url: string,
  regra: RegraDownload,
): Promise<{ conteudo: Uint8Array; tipo: string }> {
  if (!url.startsWith("https://")) {
    throw new Error("link fora de https");
  }
  const teto = `acima de ${Math.round(regra.tetoBytes / MB)} MB`;
  // O prazo vale também para a leitura do corpo: CDN lento aborta no meio em
  // vez de prender a função.
  const resposta = await fetch(url, {
    cache: "no-store",
    signal: AbortSignal.timeout(regra.prazoMs),
  });
  if (!resposta.ok) {
    throw new Error(`download: HTTP ${resposta.status}`);
  }

  const tipo = (resposta.headers.get("content-type") ?? "")
    .split(";")[0]
    .trim()
    .toLowerCase();
  if (!regra.aceita(tipo)) {
    await resposta.body?.cancel();
    throw new Error(`tipo não aceito (${tipo || "sem tipo"})`);
  }
  const declarado = Number(resposta.headers.get("content-length"));
  if (declarado > regra.tetoBytes) {
    await resposta.body?.cancel();
    throw new Error(teto);
  }

  // Sem content-length confiável, o teto é contado enquanto lê.
  const leitor = resposta.body?.getReader();
  if (!leitor) throw new Error("download sem corpo");
  const partes: Uint8Array[] = [];
  let total = 0;
  for (;;) {
    const { done, value } = await leitor.read();
    if (done) break;
    total += value.byteLength;
    if (total > regra.tetoBytes) {
      await leitor.cancel();
      throw new Error(teto);
    }
    partes.push(value);
  }
  if (total === 0) throw new Error("arquivo vazio");

  const conteudo = new Uint8Array(total);
  let pos = 0;
  for (const parte of partes) {
    conteudo.set(parte, pos);
    pos += parte.byteLength;
  }
  return { conteudo, tipo };
}

/** Foto do perfil: só imagem, até 2 MB e 10 s. */
export async function baixarFotoInstagram(
  url: string,
): Promise<{ conteudo: Uint8Array; tipo: string }> {
  return baixarMidiaInstagram(url, {
    aceita: (tipo) => tipo.startsWith("image/"),
    tetoBytes: FOTO_MAX_BYTES,
    prazoMs: TEMPO_FOTO_MS,
  });
}

/**
 * O que se copia de um anexo recebido no Direct, pelo tipo que a Meta
 * manda. Tetos dos limites do próprio Direct: imagem até 8 MB, áudio, vídeo
 * e arquivo até 25 MB. Publicação compartilhada, reel e menção em story
 * apontam para conteúdo do Instagram, não para um arquivo da pessoa: null,
 * ficam com o link.
 */
export function regraAnexoDirect(
  tipo: string | undefined,
): RegraDownload | null {
  switch (tipo) {
    case "image":
      return {
        aceita: (t) => t.startsWith("image/"),
        tetoBytes: 8 * MB,
        prazoMs: TEMPO_ANEXO_MS,
      };
    case "video":
      return {
        aceita: (t) => t.startsWith("video/"),
        tetoBytes: 25 * MB,
        prazoMs: TEMPO_ANEXO_MS,
      };
    case "audio":
      // Áudio do Direct às vezes vem num contêiner mp4 rotulado como vídeo.
      return {
        aceita: (t) => t.startsWith("audio/") || t === "video/mp4",
        tetoBytes: 25 * MB,
        prazoMs: TEMPO_ANEXO_MS,
      };
    case "file":
      // Página HTML no lugar do arquivo é o CDN dizendo que o link morreu.
      return {
        aceita: (t) => t !== "" && t !== "text/html",
        tetoBytes: 25 * MB,
        prazoMs: TEMPO_ANEXO_MS,
      };
    default:
      return null;
  }
}

/**
 * Tradução dos erros que a equipe vai ver no chat. A janela vem primeiro: a
 * Graph responde a janela vencida com o código 10 ("(#10) This message is
 * sent outside of allowed window"), que o teste de permissão também casaria
 * e mandaria a equipe atrás de uma configuração que está certa.
 */
export function descreverErroInstagram(msg: string): string {
  if (/outside.*window|allowed window|2534022|2534037|24 ?h/i.test(msg)) {
    return "Passou da janela de 24h do Direct. O Instagram não tem template: só dá para responder se a pessoa escrever de novo.";
  }
  if (/\b190\b|token/i.test(msg)) {
    return "Token do Instagram inválido ou expirado. Gere outro no painel da Meta.";
  }
  if (/\b10\b|permission/i.test(msg)) {
    return "A Meta recusou por permissão. Confira se o app tem instagram_manage_messages aprovado.";
  }
  return msg;
}
