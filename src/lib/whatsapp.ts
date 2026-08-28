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

export type StatusConversa = "open" | "resolved" | "pending" | "snoozed";

/**
 * Cliente da WhatsApp Cloud API (Meta), usado quando META_WHATSAPP_TOKEN
 * está configurado — o canal direto, sem Chatwoot no meio. O destino é o
 * telefone do lead (dígitos com DDI); o id devolvido é o wamid, que os
 * recibos de status do webhook referenciam.
 */

const GRAPH = "https://graph.facebook.com/v23.0";
const TTL_CACHE_MS = 5 * 60_000;

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

async function graph<T>(caminho: string, init?: RequestInit): Promise<T> {
  const corpoJson = typeof init?.body === "string";
  const resposta = await fetch(`${GRAPH}${caminho}`, {
    ...init,
    headers: {
      Authorization: `Bearer ${token()}`,
      ...(corpoJson ? { "Content-Type": "application/json" } : {}),
      ...init?.headers,
    },
    cache: "no-store",
  });

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
          .join(" — ")
      : `HTTP ${resposta.status}`;
    throw new Error(`Meta: ${detalhe}`);
  }
  return json as T;
}

type RespostaEnvio = { messages?: { id: string }[] };

export async function enviarTextoMeta(
  para: string,
  texto: string,
): Promise<string | null> {
  const pid = await phoneNumberId();
  const r = await graph<RespostaEnvio>(`/${pid}/messages`, {
    method: "POST",
    body: JSON.stringify({
      messaging_product: "whatsapp",
      to: para,
      type: "text",
      text: { body: texto, preview_url: true },
    }),
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
  });
  return r.messages?.[0]?.id ?? null;
}

function tipoMidia(mime: string): "image" | "audio" | "video" | "document" {
  const prefixo = mime.split("/")[0];
  return prefixo === "image" || prefixo === "audio" || prefixo === "video"
    ? prefixo
    : "document";
}

/** Sobe o arquivo para a Meta e envia. Legenda vale para imagem/vídeo/doc. */
export async function enviarMidiaMeta(
  para: string,
  arquivo: File,
  legenda?: string,
): Promise<string | null> {
  const pid = await phoneNumberId();

  const form = new FormData();
  form.append("messaging_product", "whatsapp");
  form.append("file", arquivo, arquivo.name);
  const upload = await graph<{ id: string }>(`/${pid}/media`, {
    method: "POST",
    body: form,
  });

  const tipo = tipoMidia(arquivo.type);
  const r = await graph<RespostaEnvio>(`/${pid}/messages`, {
    method: "POST",
    body: JSON.stringify({
      messaging_product: "whatsapp",
      to: para,
      type: tipo,
      [tipo]: {
        id: upload.id,
        ...(tipo === "document" ? { filename: arquivo.name } : {}),
        ...(legenda && tipo !== "audio" ? { caption: legenda } : {}),
      },
    }),
  });
  return r.messages?.[0]?.id ?? null;
}

/**
 * Cria o template resumo_diario direto na WABA (Fase 7.2): o gestor não
 * conseguiu pelo WhatsApp Manager, e o token com whatsapp_business_management
 * — o mesmo que LISTA os templates — também pode criá-los. Depois de criado,
 * a Meta ainda precisa APROVAR (o motor só envia template aprovado).
 * Devolve o status que a Meta respondeu (ex.: PENDING) ou lança com a
 * mensagem dela (nome duplicado, permissão faltando…).
 */
export async function criarTemplateResumoMeta(): Promise<string> {
  const waba = process.env.META_WABA_ID;
  if (!waba) throw new Error("META_WABA_ID não configurado.");
  const corpo =
    "Resumo Zeve de hoje: {{1}} conta(s) aberta(s), {{2}} ativação(ões) registrada(s), {{3}} venda(s) confirmada(s), {{4}} conversa(s) aguardando 24h+ e {{5}} cliente(s) com giro em risco.";
  const r = await graph<{ id?: string; status?: string }>(
    `/${waba}/message_templates`,
    {
      method: "POST",
      body: JSON.stringify({
        name: "resumo_diario",
        language: "pt_BR",
        category: "UTILITY",
        // Se o classificador da Meta discordar da categoria, recategoriza
        // em vez de recusar a criação inteira.
        allow_category_change: true,
        components: [
          {
            type: "BODY",
            text: corpo,
            // A Meta exige exemplo para cada variável antes de avaliar.
            example: { body_text: [["3", "2", "5", "4", "7"]] },
          },
        ],
      }),
    },
  );
  cacheTemplatesMeta = null; // a lista muda; o cache de 5 min não pode esconder
  return r.status ?? "PENDING";
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
 * Baixa uma mídia recebida (a URL da Meta expira em minutos) e hospeda no
 * bucket público midia-whatsapp do Supabase. Devolve a URL definitiva.
 */
export async function hospedarMidiaMeta(
  mediaId: string,
): Promise<{ url: string; mime: string } | null> {
  const meta = await graph<{ url?: string; mime_type?: string }>(`/${mediaId}`);
  if (!meta.url) return null;

  const resposta = await fetch(meta.url, {
    headers: { Authorization: `Bearer ${token()}` },
    cache: "no-store",
  });
  if (!resposta.ok) return null;

  const mime =
    meta.mime_type ??
    resposta.headers.get("content-type") ??
    "application/octet-stream";
  const extensao = (mime.split("/")[1] ?? "bin").split(";")[0];
  const caminho = `${mediaId}.${extensao}`;

  const service = createServiceClient();
  const { error } = await service.storage
    .from("midia-whatsapp")
    .upload(caminho, await resposta.arrayBuffer(), {
      contentType: mime,
      upsert: true,
    });
  if (error) return null;

  const { data } = service.storage.from("midia-whatsapp").getPublicUrl(caminho);
  return { url: data.publicUrl, mime };
}
