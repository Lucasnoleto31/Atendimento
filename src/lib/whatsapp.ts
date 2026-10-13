import { createServiceClient } from "@/lib/supabase/server";

/** O contrato de template do app inteiro (veio de lib/chatwoot na Fase 8). */
export type TemplateWhatsapp = {
  nome: string;
  idioma: string;
  categoria: string;
  corpo: string;
  /** Tokens de variável na ordem em que aparecem no corpo ("1", "2"…). */
  parametros: string[];
};

/**
 * Cliente da WhatsApp Cloud API (Meta), usado quando META_WHATSAPP_TOKEN
 * está configurado — o canal direto, sem Chatwoot no meio. O destino é o
 * telefone do lead (dígitos com DDI); o id devolvido é o wamid, que os
 * recibos de status do webhook referenciam.
 */

const GRAPH = "https://graph.facebook.com/v23.0";
const TTL_CACHE_MS = 5 * 60_000;

// Sem teto, uma Meta travada segura a função até o limite da Vercel: no
// webhook a mensagem nem chega a ser gravada, e a Meta reenvia em cima.
// Upload de arquivo e download de mídia recebida ganham prazo próprio.
//
// O POST de envio (/messages) tem prazo longo: estourar não quer dizer que a
// Meta recusou. A mensagem pode ter saído sem o wamid voltar, e aí não entra
// no histórico, os recibos dela não acham a quem pertencem e a equipe
// reenvia em cima. O prazo curto fica nas leituras (templates, mídia
// recebida, qualidade do número).
const TEMPO_GRAPH_MS = 15_000;
const TEMPO_ENVIO_MS = 60_000;
const TEMPO_UPLOAD_MS = 60_000;
const TEMPO_DOWNLOAD_MS = 30_000;

/**
 * Prazo estourado sem resposta da Meta. Tem classe própria porque, num
 * envio, não é recusa: o chat precisa distinguir para não mandar o
 * atendente repetir a mensagem nem trocar por template.
 */
export class MetaSemResposta extends Error {
  constructor() {
    super(
      "Meta: sem resposta a tempo. Se era um envio, confira a conversa antes de repetir.",
    );
    this.name = "MetaSemResposta";
  }
}

export function metaConfigurada(): boolean {
  return Boolean(process.env.META_WHATSAPP_TOKEN);
}

function token(): string {
  const t = process.env.META_WHATSAPP_TOKEN;
  if (!t) throw new Error("META_WHATSAPP_TOKEN não configurado.");
  return t;
}

let cachePhoneId: { id: string | null; expira: number } | null = null;

/** phone_number_id: do ambiente ou da primeira instância ativa cadastrada. */
async function phoneNumberId(): Promise<string> {
  if (process.env.META_PHONE_NUMBER_ID) return process.env.META_PHONE_NUMBER_ID;
  if (cachePhoneId && Date.now() < cachePhoneId.expira && cachePhoneId.id) {
    return cachePhoneId.id;
  }

  const service = createServiceClient();
  const { data } = await service
    .from("whatsapp_instances")
    .select("meta_phone_number_id")
    .eq("ativa", true)
    .not("meta_phone_number_id", "is", null)
    .limit(1)
    .maybeSingle();
  const id = (data?.meta_phone_number_id as string | null) ?? null;
  cachePhoneId = { id, expira: Date.now() + TTL_CACHE_MS };

  if (!id) {
    throw new Error(
      "Defina META_PHONE_NUMBER_ID ou cadastre uma instância ativa com o phone_number_id em Configurações.",
    );
  }
  return id;
}

/** Estouro do AbortSignal.timeout: o fetch rejeita com TimeoutError. */
function estourouPrazo(e: unknown): boolean {
  const nome = (e as { name?: string } | null)?.name;
  return nome === "TimeoutError" || nome === "AbortError";
}

async function graph<T>(caminho: string, init?: RequestInit): Promise<T> {
  const corpoJson = typeof init?.body === "string";
  let resposta: Response;
  try {
    resposta = await fetch(`${GRAPH}${caminho}`, {
      ...init,
      headers: {
        Authorization: `Bearer ${token()}`,
        ...(corpoJson ? { "Content-Type": "application/json" } : {}),
        ...init?.headers,
      },
      cache: "no-store",
      signal: init?.signal ?? AbortSignal.timeout(TEMPO_GRAPH_MS),
    });
  } catch (e) {
    // Sem resposta não dá para saber se a Meta chegou a enviar: quem tentou
    // mandar precisa conferir a conversa antes de repetir.
    if (estourouPrazo(e)) throw new MetaSemResposta();
    throw e;
  }

  const json = (await resposta.json().catch(() => null)) as T | null;
  if (!resposta.ok) {
    // error_user_msg e o subcode carregam o motivo REAL — "Invalid
    // parameter" sozinho não diz nada.
    const erro = (
      json as {
        error?: {
          message?: string;
          error_user_msg?: string;
          error_subcode?: number;
        };
      } | null
    )?.error;
    const detalhe = erro
      ? [
          erro.message,
          erro.error_user_msg,
          erro.error_subcode ? `subcode ${erro.error_subcode}` : null,
        ]
          .filter(Boolean)
          .join(" · ")
      : `HTTP ${resposta.status}`;
    throw new Error(`Meta: ${detalhe}`);
  }
  return json as T;
}

type RespostaEnvio = { messages?: { id: string }[] };

/** O wamid tem prefixo próprio; o mid do Direct, não. É por ele que a
 *  resposta citada sabe por qual canal a mensagem passou. */
export function ehIdWhatsApp(id: string | null | undefined): id is string {
  return typeof id === "string" && id.startsWith("wamid.");
}

/** O que vale para qualquer envio de texto ou mídia. */
export type OpcoesEnvioMeta = {
  /** wamid da mensagem citada (o "responder" do app). O cliente vê o
   *  balão da citação; a Meta não mostra se ela foi apagada ou passou do
   *  armazenamento dela (em geral, 30 dias). */
  responderA?: string | null;
};

function contexto(opcoes?: OpcoesEnvioMeta) {
  const citada = opcoes?.responderA;
  return ehIdWhatsApp(citada) ? { context: { message_id: citada } } : {};
}

export async function enviarTextoMeta(
  para: string,
  texto: string,
  opcoes?: OpcoesEnvioMeta,
): Promise<string | null> {
  const pid = await phoneNumberId();
  const r = await graph<RespostaEnvio>(`/${pid}/messages`, {
    method: "POST",
    body: JSON.stringify({
      messaging_product: "whatsapp",
      to: para,
      type: "text",
      text: { body: texto, preview_url: true },
      ...contexto(opcoes),
    }),
    signal: AbortSignal.timeout(TEMPO_ENVIO_MS),
  });
  return r.messages?.[0]?.id ?? null;
}

export async function enviarTemplateMeta(
  para: string,
  template: TemplateWhatsapp,
  valores: Record<string, string>,
): Promise<string | null> {
  const pid = await phoneNumberId();
  const parameters = template.parametros.map((token) => ({
    type: "text" as const,
    text: valores[token] ?? "",
  }));

  const r = await graph<RespostaEnvio>(`/${pid}/messages`, {
    method: "POST",
    body: JSON.stringify({
      messaging_product: "whatsapp",
      to: para,
      type: "template",
      template: {
        name: template.nome,
        language: { code: template.idioma },
        ...(parameters.length > 0
          ? { components: [{ type: "body", parameters }] }
          : {}),
      },
    }),
    signal: AbortSignal.timeout(TEMPO_ENVIO_MS),
  });
  return r.messages?.[0]?.id ?? null;
}

function tipoMidia(mime: string): "image" | "audio" | "video" | "document" {
  const prefixo = mime.split("/")[0];
  return prefixo === "image" || prefixo === "audio" || prefixo === "video"
    ? prefixo
    : "document";
}

/** Sobe o arquivo para a Meta e devolve o id da mídia. */
async function subirMidiaMeta(arquivo: File): Promise<string> {
  const pid = await phoneNumberId();
  const form = new FormData();
  form.append("messaging_product", "whatsapp");
  form.append("file", arquivo, arquivo.name);
  const upload = await graph<{ id: string }>(`/${pid}/media`, {
    method: "POST",
    body: form,
    signal: AbortSignal.timeout(TEMPO_UPLOAD_MS),
  }).catch((e: unknown) => {
    // Upload que estoura o prazo não manda nada ao cliente: é falha comum,
    // não a dúvida de um envio sem resposta.
    if (e instanceof MetaSemResposta) {
      throw new Error("Meta: o arquivo não terminou de subir a tempo.");
    }
    throw e;
  });
  return upload.id;
}

/** Envia uma mídia já subida (subirMidiaMeta). Legenda vale para imagem,
 *  vídeo e documento; no áudio a Meta descarta. */
async function enviarMidiaPorIdMeta(
  para: string,
  midia: { id: string; mime: string; nome: string },
  legenda?: string,
  opcoes?: OpcoesEnvioMeta,
): Promise<string | null> {
  const pid = await phoneNumberId();
  const tipo = tipoMidia(midia.mime);
  // O ogg/opus é a mensagem de voz do WhatsApp: com voice: true chega com o
  // microfone e a transcrição, não como arquivo de áudio (doc da Meta,
  // "Audio messages"). Os outros áudios (mp3, m4a) chegam como áudio comum.
  const voz =
    tipo === "audio" &&
    midia.mime.toLowerCase().split(";")[0].trim() === "audio/ogg";
  const r = await graph<RespostaEnvio>(`/${pid}/messages`, {
    method: "POST",
    body: JSON.stringify({
      messaging_product: "whatsapp",
      to: para,
      type: tipo,
      [tipo]: {
        id: midia.id,
        ...(tipo === "document" ? { filename: midia.nome } : {}),
        ...(legenda && tipo !== "audio" ? { caption: legenda } : {}),
        ...(voz ? { voice: true } : {}),
      },
      ...contexto(opcoes),
    }),
    signal: AbortSignal.timeout(TEMPO_ENVIO_MS),
  });
  return r.messages?.[0]?.id ?? null;
}

/** Sobe o arquivo para a Meta e envia. Legenda vale para imagem/vídeo/doc. */
export async function enviarMidiaMeta(
  para: string,
  arquivo: File,
  legenda?: string,
  opcoes?: OpcoesEnvioMeta,
): Promise<string | null> {
  const id = await subirMidiaMeta(arquivo);
  return enviarMidiaPorIdMeta(
    para,
    { id, mime: arquivo.type, nome: arquivo.name },
    legenda,
    opcoes,
  );
}

let cacheTemplatesMeta: {
  dados: TemplateWhatsapp[];
  expira: number;
} | null = null;

function extrairParametros(corpo: string): string[] {
  const tokens: string[] = [];
  for (const m of corpo.matchAll(/\{\{\s*([^{}]+?)\s*\}\}/g)) {
    if (!tokens.includes(m[1])) tokens.push(m[1]);
  }
  return tokens;
}

/** Templates aprovados direto da WABA (exige META_WABA_ID). */
export async function listarTemplatesMeta(): Promise<TemplateWhatsapp[]> {
  const waba = process.env.META_WABA_ID;
  if (!waba) return [];
  if (cacheTemplatesMeta && Date.now() < cacheTemplatesMeta.expira) {
    return cacheTemplatesMeta.dados;
  }

  const resposta = await graph<{
    data: {
      name: string;
      status?: string;
      category?: string;
      language?: string;
      components?: { type?: string; format?: string; text?: string }[];
    }[];
  }>(`/${waba}/message_templates?limit=100`);

  const dados: TemplateWhatsapp[] = [];
  for (const tpl of resposta.data ?? []) {
    if ((tpl.status ?? "").toUpperCase() !== "APPROVED") continue;
    const cabecalho = tpl.components?.find((c) => c.type === "HEADER");
    if (cabecalho && cabecalho.format && cabecalho.format !== "TEXT") continue;
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

  cacheTemplatesMeta = { dados, expira: Date.now() + TTL_CACHE_MS };
  return dados;
}

/**
 * Bucket público da mídia do chat: a recebida no WhatsApp, a cópia dos
 * anexos do Direct (pasta instagram/) e os anexos das mensagens padrão.
 */
export const BUCKET_MIDIA = "midia-whatsapp";

/**
 * Baixa uma mídia recebida (a URL da Meta expira em minutos) e hospeda no
 * bucket público midia-whatsapp do Supabase. Devolve a URL definitiva, o
 * tipo e o tamanho em bytes (o cartão do documento mostra; a Meta não manda
 * o tamanho no webhook).
 */
export async function hospedarMidiaMeta(
  mediaId: string,
): Promise<{ url: string; mime: string; tamanho: number } | null> {
  const meta = await graph<{ url?: string; mime_type?: string }>(`/${mediaId}`);
  if (!meta.url) return null;

  // O prazo vale também para a leitura do corpo: arquivo grande num CDN lento
  // aborta no meio em vez de prender a função.
  const resposta = await fetch(meta.url, {
    headers: { Authorization: `Bearer ${token()}` },
    cache: "no-store",
    signal: AbortSignal.timeout(TEMPO_DOWNLOAD_MS),
  });
  if (!resposta.ok) return null;

  const mime =
    meta.mime_type ??
    resposta.headers.get("content-type") ??
    "application/octet-stream";
  const extensao = (mime.split("/")[1] ?? "bin").split(";")[0];
  const caminho = `${mediaId}.${extensao}`;
  const conteudo = await resposta.arrayBuffer();

  const service = createServiceClient();
  const { error } = await service.storage
    .from(BUCKET_MIDIA)
    .upload(caminho, conteudo, {
      contentType: mime,
      upsert: true,
    });
  if (error) return null;

  const { data } = service.storage.from(BUCKET_MIDIA).getPublicUrl(caminho);
  return { url: data.publicUrl, mime, tamanho: conteudo.byteLength };
}

/**
 * A qualidade ATUAL do número, direto da Graph API.
 *
 * O webhook phone_number_quality_update só chega quando a qualidade MUDA —
 * número saudável que nunca mudou não gera evento nenhum, e o painel de
 * Campanhas ficava em "sem dado" para sempre. Esta busca ativa cobre esse
 * vazio; o webhook continua valendo para o tempo real entre uma busca e
 * outra.
 */
export type QualidadeAoVivo = {
  rating: "GREEN" | "YELLOW" | "RED" | null;
  limite: string | null;
  telefone: string | null;
};

// Cache negativo incluído: número novo responde UNKNOWN para sempre até
// ganhar volume, e sem cache cada carga do painel viraria um GET na Meta.
let cacheQualidade: { dados: QualidadeAoVivo; expira: number } | null = null;

export async function buscarQualidadeNumero(): Promise<QualidadeAoVivo> {
  if (cacheQualidade && Date.now() < cacheQualidade.expira) {
    return cacheQualidade.dados;
  }
  const pid = await phoneNumberId();
  const r = await graph<{
    quality_rating?: string;
    messaging_limit_tier?: string;
    display_phone_number?: string;
  }>(
    `/${pid}?fields=quality_rating,messaging_limit_tier,display_phone_number`,
    {
      // Sem teto, Meta lenta segura o render do painel inteiro (não há
      // loading.tsx) — melhor ficar sem o dado do que sem a página.
      signal: AbortSignal.timeout(5_000),
    },
  );
  // Número novo vem como UNKNOWN/NA — não é uma nota, é ausência de nota;
  // gravar isso esconderia o painel atrás de um valor que ele não conhece.
  const bruto = r.quality_rating?.trim().toUpperCase() || null;
  const rating =
    bruto === "GREEN" || bruto === "YELLOW" || bruto === "RED" ? bruto : null;
  const dados: QualidadeAoVivo = {
    rating,
    limite: r.messaging_limit_tier ?? null,
    telefone: r.display_phone_number ?? null,
  };
  cacheQualidade = { dados, expira: Date.now() + TTL_CACHE_MS };
  return dados;
}
