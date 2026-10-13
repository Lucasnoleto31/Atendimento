/**
 * Como cada anexo chega ao contato, pelo que a Meta aceita em cada canal.
 * A prévia do compositor mostra isto e o envio (chat/actions.ts) segue a
 * mesma regra: a tela não promete foto quando o servidor vai mandar link.
 *
 * WhatsApp (doc da Meta, "Supported media types"): foto jpeg ou png até
 * 5 MB; vídeo mp4 ou 3gp; áudio aac, amr, mp3, m4a e ogg/opus (o ogg é a
 * mensagem de voz); documento só PDF, Word, Excel, PowerPoint e TXT. Imagem
 * não está na lista de documento, e webp, gif, mov e o resto são recusados
 * na hora (131053 ou #100): esses vão como link do nosso Storage, que o
 * cliente abre e baixa.
 *
 * Direct (Instagram API com login do Instagram, "Media types"): foto png ou
 * jpeg até 8 MB; vídeo mp4, ogg, avi, mov e webm; áudio aac, m4a, wav e
 * mp4. A API também leva PDF como arquivo, mas lib/instagram.ts só manda
 * foto, vídeo e áudio: documento vai como link.
 */

export type CanalDoAnexo = "whatsapp" | "instagram";

export type FormaDeEnvio = "foto" | "video" | "audio" | "documento" | "link";

export type DadosDoAnexo = {
  tipo: string;
  nome: string;
  tamanho: number;
  /** Escolhido em "Documento": vai como arquivo, nunca como foto. */
  documento?: boolean;
};

const MB = 1024 * 1024;

/** Teto de legenda da Meta no WhatsApp: acima disso o texto sai antes, numa
 *  mensagem própria (o envio faz e a prévia avisa). */
export const TETO_LEGENDA_WHATSAPP = 1024;

const TETO_FOTO_WHATSAPP = 5 * MB;
const TETO_FOTO_DIRECT = 8 * MB;

const FOTO = new Set(["image/jpeg", "image/png"]);
const VIDEO_WHATSAPP = new Set(["video/mp4", "video/3gpp"]);
const AUDIO_WHATSAPP = new Set([
  "audio/aac",
  "audio/mp4",
  "audio/mpeg",
  "audio/amr",
  "audio/ogg",
]);
const VIDEO_DIRECT = new Set([
  "video/mp4",
  "video/ogg",
  "video/x-msvideo",
  "video/quicktime",
  "video/webm",
]);
const AUDIO_DIRECT = new Set(["audio/aac", "audio/mp4", "audio/wav"]);

/** Documento do WhatsApp, pela extensão (o navegador nem sempre preenche o
 *  MIME, e o arquivo baixado do Storage pode vir sem ele). */
const DOC_POR_EXTENSAO: Record<string, string> = {
  pdf: "application/pdf",
  doc: "application/msword",
  docx: "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
  xls: "application/vnd.ms-excel",
  xlsx: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
  ppt: "application/vnd.ms-powerpoint",
  pptx: "application/vnd.openxmlformats-officedocument.presentationml.presentation",
  txt: "text/plain",
  csv: "text/csv",
};
const DOC_WHATSAPP = new Set(Object.values(DOC_POR_EXTENSAO));

// Nomes alternativos que os navegadores mandam para os mesmos formatos. O
// arquivo sai com o nome oficial, que é o que a Meta confere no upload.
const APELIDOS_MIME: Record<string, string> = {
  "image/jpg": "image/jpeg",
  "audio/mp3": "audio/mpeg",
  "audio/x-m4a": "audio/mp4",
  "audio/m4a": "audio/mp4",
  "audio/x-aac": "audio/aac",
  "audio/x-wav": "audio/wav",
  "audio/wave": "audio/wav",
  "audio/vnd.wave": "audio/wav",
  "video/avi": "video/x-msvideo",
};

export function extensaoDe(nome: string): string {
  return nome.toLowerCase().match(/\.([a-z0-9]+)$/)?.[1] ?? "";
}

/**
 * O MIME sem parâmetros ("audio/ogg; codecs=opus" vira "audio/ogg"), em
 * minúsculas e com o apelido trocado pelo nome oficial. Sem MIME (ou com o
 * genérico), o documento conhecido ganha o dele pela extensão.
 */
export function tipoOficial(tipo: string, nome: string): string {
  const mime = (tipo || "").toLowerCase().split(";")[0].trim();
  const oficial = APELIDOS_MIME[mime] ?? mime;
  if (oficial && oficial !== "application/octet-stream") return oficial;
  return DOC_POR_EXTENSAO[extensaoDe(nome)] ?? oficial;
}

function ehDocumentoWhatsApp(a: DadosDoAnexo): boolean {
  return (
    DOC_WHATSAPP.has(tipoOficial(a.tipo, a.nome)) ||
    extensaoDe(a.nome) in DOC_POR_EXTENSAO
  );
}

export function formaDeEnvio(
  a: DadosDoAnexo,
  canal: CanalDoAnexo,
): FormaDeEnvio {
  const mime = tipoOficial(a.tipo, a.nome);
  if (canal === "instagram") {
    if (a.documento) return "link";
    if (FOTO.has(mime)) return a.tamanho <= TETO_FOTO_DIRECT ? "foto" : "link";
    if (VIDEO_DIRECT.has(mime)) return "video";
    if (AUDIO_DIRECT.has(mime)) return "audio";
    return "link";
  }
  const documento = ehDocumentoWhatsApp(a);
  if (a.documento) return documento ? "documento" : "link";
  if (FOTO.has(mime)) {
    return a.tamanho <= TETO_FOTO_WHATSAPP ? "foto" : "link";
  }
  if (VIDEO_WHATSAPP.has(mime)) return "video";
  if (AUDIO_WHATSAPP.has(mime)) return "audio";
  return documento ? "documento" : "link";
}

/** Por que o anexo vai como link, numa frase curta (a prévia mostra). */
export function porQueVaiLink(a: DadosDoAnexo, canal: CanalDoAnexo): string {
  const mime = tipoOficial(a.tipo, a.nome);
  const ext = extensaoDe(a.nome);
  const formato = ext ? `.${ext}` : "este formato";
  if (canal === "instagram") {
    if (a.documento) return "o Direct só recebe foto, vídeo e áudio por aqui.";
    if (FOTO.has(mime)) return "passa de 8 MB, o teto de foto do Direct.";
    return `o Direct não aceita ${formato}.`;
  }
  if (a.documento) {
    return "o WhatsApp só aceita PDF, Word, Excel, PowerPoint e TXT como documento.";
  }
  if (FOTO.has(mime)) return "passa de 5 MB, o teto de foto do WhatsApp.";
  return `o WhatsApp não aceita ${formato}.`;
}

/**
 * Qual anexo leva a legenda no WhatsApp: a primeira foto ou vídeo, senão o
 * primeiro documento. -1 quando não há nenhum (só áudio e link): aí o texto
 * sai numa mensagem própria, ou junto do link. O compositor manda esse
 * anexo na frente, e o servidor põe o texto no primeiro.
 */
export function indiceDaLegenda(formas: FormaDeEnvio[]): number {
  const midia = formas.findIndex((f) => f === "foto" || f === "video");
  return midia !== -1 ? midia : formas.indexOf("documento");
}
