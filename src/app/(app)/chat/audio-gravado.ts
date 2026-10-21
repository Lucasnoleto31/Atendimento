/**
 * A gravação do microfone no formato que cada canal entrega. O gravador
 * carrega este módulo só quando alguém começa a gravar.
 *
 * - WhatsApp: a mensagem de voz pede ogg com Opus, mono (doc da Meta,
 *   "Audio messages"; o envio leva voice: true). O Firefox já grava ogg. O
 *   Chrome grava webm/Opus, e aqui o webm vira ogg sem recodificar: os
 *   mesmos pacotes Opus, só a caixa muda. O Safari grava mp4/aac, que vai
 *   como áudio comum (chega como arquivo de áudio, não como voz).
 * - Direct: a API aceita aac, m4a, wav e mp4, e não ogg. A gravação vira
 *   wav mono de 16 kHz.
 *
 * Se o webm vier fora do esperado (ou estéreo), o áudio vira mp3 e chega
 * como áudio comum, em vez de não sair.
 */

import type { CanalConversa } from "./mensagem";
import { NOME_DO_PRODUTO } from "@/lib/marca";

export async function prepararGravacao(
  gravacao: Blob,
  canal: CanalConversa,
): Promise<File> {
  const tipo = (gravacao.type || "").toLowerCase();
  const nome = `voz-${Date.now()}`;
  if (canal === "instagram") return paraWav(gravacao, nome);
  if (tipo.startsWith("audio/mp4") || tipo.startsWith("video/mp4")) {
    return new File([gravacao], `${nome}.m4a`, { type: "audio/mp4" });
  }
  if (tipo.startsWith("audio/ogg") || tipo.startsWith("audio/webm")) {
    try {
      const bytes = new Uint8Array(await gravacao.arrayBuffer());
      const ogg = tipo.startsWith("audio/ogg") ? oggMono(bytes) : webmParaOgg(bytes);
      return new File([ogg as BlobPart], `${nome}.ogg`, { type: "audio/ogg" });
    } catch {
      // cai no mp3 abaixo
    }
  }
  return paraMp3(gravacao, nome);
}

/* ── webm para ogg ──────────────────────────────────────────────────────── */

// Os elementos do Matroska que interessam. Os de fora (cabeçalho, Info,
// Cues, Tags) são pulados pelo tamanho.
const SEGMENTO = 0x18538067;
const TRILHAS = 0x1654ae6b;
const TRILHA = 0xae;
const AUDIO = 0xe1;
const CLUSTER = 0x1f43b675;
const GRUPO_DE_BLOCO = 0xa0;
const NUMERO_DA_TRILHA = 0xd7;
const CODEC = 0x86;
const CODEC_PRIVADO = 0x63a2;
const BLOCO_SIMPLES = 0xa3;
const BLOCO = 0xa1;
// Contêineres: lidos por dentro, sem pular. O Chrome grava Segmento e
// Cluster com tamanho desconhecido (gravação ao vivo), e por isso o leitor
// anda elemento a elemento em vez de confiar no tamanho deles.
const CONTEINERES = new Set([SEGMENTO, TRILHAS, TRILHA, AUDIO, CLUSTER, GRUPO_DE_BLOCO]);

/** Número de tamanho variável do EBML: o id (com a marca) ou o tamanho. */
function lerVint(b: Uint8Array, pos: number, comMarca: boolean) {
  const primeiro = b[pos];
  if (!primeiro) throw new Error("vint inválido");
  let tamanho = 1;
  let marca = 0x80;
  while (!(primeiro & marca)) {
    marca >>= 1;
    tamanho++;
  }
  if (pos + tamanho > b.length) throw new Error("vint cortado");
  let valor = comMarca ? primeiro : primeiro & (marca - 1);
  let tudoUm = (primeiro & (marca - 1)) === marca - 1;
  for (let i = 1; i < tamanho; i++) {
    valor = valor * 256 + b[pos + i];
    if (b[pos + i] !== 0xff) tudoUm = false;
  }
  return { valor, tamanho, desconhecido: !comMarca && tudoUm };
}

function lerUint(b: Uint8Array): number {
  let valor = 0;
  for (const byte of b) valor = valor * 256 + byte;
  return valor;
}

type Trilha = { numero?: number; codec?: string; privado?: Uint8Array };

/**
 * Tira os pacotes Opus do webm do MediaRecorder e monta o ogg (RFC 7845):
 * a página do OpusHead, a do OpusTags e as de áudio, cada uma com a
 * posição em amostras de 48 kHz contada pelos próprios pacotes.
 */
export function webmParaOgg(webm: Uint8Array): Uint8Array {
  const trilhas: Trilha[] = [];
  const blocos: { trilha: number; dados: Uint8Array }[] = [];
  let pos = 0;
  while (pos < webm.length) {
    const id = lerVint(webm, pos, true);
    if (id.tamanho > 4) throw new Error("id inválido");
    const tam = lerVint(webm, pos + id.tamanho, false);
    const inicio = pos + id.tamanho + tam.tamanho;
    if (CONTEINERES.has(id.valor)) {
      if (id.valor === TRILHA) trilhas.push({});
      pos = inicio;
      continue;
    }
    if (tam.desconhecido) throw new Error("elemento sem tamanho");
    const fim = inicio + tam.valor;
    // O último pedaço cortado (gravação parada no meio da escrita) fica de
    // fora.
    if (fim > webm.length) break;
    const dados = webm.subarray(inicio, fim);
    const atual = trilhas[trilhas.length - 1];
    if (id.valor === NUMERO_DA_TRILHA && atual) atual.numero = lerUint(dados);
    else if (id.valor === CODEC && atual) {
      atual.codec = new TextDecoder().decode(dados);
    } else if (id.valor === CODEC_PRIVADO && atual) atual.privado = dados;
    else if (id.valor === BLOCO_SIMPLES || id.valor === BLOCO) {
      const trilha = lerVint(dados, 0, false);
      const flags = dados[trilha.tamanho + 2];
      if (flags === undefined) throw new Error("bloco cortado");
      // O MediaRecorder põe um pacote por bloco; lacing não é esperado.
      if (flags & 0x06) throw new Error("bloco com lacing");
      blocos.push({ trilha: trilha.valor, dados: dados.subarray(trilha.tamanho + 3) });
    }
    pos = fim;
  }

  const opus = trilhas.find((t) => t.codec === "A_OPUS");
  if (!opus || opus.numero === undefined || !opus.privado) {
    throw new Error("sem trilha Opus");
  }
  // O CodecPrivate do Opus no Matroska é o próprio OpusHead.
  const cabecalho = Uint8Array.from(opus.privado);
  if (
    cabecalho.length < 19 ||
    new TextDecoder().decode(cabecalho.subarray(0, 8)) !== "OpusHead"
  ) {
    throw new Error("OpusHead inválido");
  }
  // A mensagem de voz do WhatsApp só aceita mono.
  if (cabecalho[9] !== 1) throw new Error("gravação estéreo");
  const pacotes = blocos
    .filter((b) => b.trilha === opus.numero && b.dados.length > 0)
    .map((b) => b.dados);
  if (pacotes.length === 0) throw new Error("gravação vazia");
  return montarOgg(cabecalho, pacotes);
}

/** O ogg que o Firefox grava já serve; só confere se é mono. */
function oggMono(ogg: Uint8Array): Uint8Array {
  const segmentos = ogg[26];
  const inicio = 27 + (segmentos ?? 0);
  const cabecalho = ogg.subarray(inicio, inicio + 19);
  if (
    new TextDecoder().decode(ogg.subarray(0, 4)) !== "OggS" ||
    new TextDecoder().decode(cabecalho.subarray(0, 8)) !== "OpusHead" ||
    cabecalho[9] !== 1
  ) {
    throw new Error("ogg fora do esperado");
  }
  return ogg;
}

/** Quantas amostras de 48 kHz um pacote Opus decodifica (RFC 6716, 3.1). */
function amostrasDoPacote(p: Uint8Array): number {
  const toc = p[0];
  const config = toc >> 3;
  const quadro =
    config < 12
      ? [480, 960, 1920, 2880][config & 3] // SILK: 10, 20, 40 e 60 ms
      : config < 16
        ? config & 1
          ? 960
          : 480 // híbrido: 10 e 20 ms
        : [120, 240, 480, 960][config & 3]; // CELT: 2,5, 5, 10 e 20 ms
  const contagem = toc & 3;
  const quadros =
    contagem === 0 ? 1 : contagem === 3 ? (p[1] ?? 0) & 0x3f : 2;
  return quadro * quadros;
}

let tabelaCrc: Uint32Array | null = null;

/** O CRC da página Ogg: polinômio 0x04C11DB7, sem reflexão, começa em 0. */
function crcOgg(b: Uint8Array): number {
  if (!tabelaCrc) {
    tabelaCrc = new Uint32Array(256);
    for (let i = 0; i < 256; i++) {
      let r = i << 24;
      for (let k = 0; k < 8; k++) {
        r = r & 0x80000000 ? (r << 1) ^ 0x04c11db7 : r << 1;
      }
      tabelaCrc[i] = r >>> 0;
    }
  }
  let crc = 0;
  for (const byte of b) {
    crc = ((crc << 8) ^ tabelaCrc[((crc >>> 24) ^ byte) & 0xff]) >>> 0;
  }
  return crc;
}

function paginaOgg(
  pacotes: Uint8Array[],
  granulo: number,
  serie: number,
  sequencia: number,
  marca: number,
): Uint8Array {
  const segmentos: number[] = [];
  let corpo = 0;
  for (const p of pacotes) {
    let resto = p.length;
    while (resto >= 255) {
      segmentos.push(255);
      resto -= 255;
    }
    segmentos.push(resto);
    corpo += p.length;
  }
  const pagina = new Uint8Array(27 + segmentos.length + corpo);
  const dv = new DataView(pagina.buffer);
  pagina.set([0x4f, 0x67, 0x67, 0x53], 0); // "OggS"
  pagina[5] = marca;
  dv.setUint32(6, granulo % 0x1_0000_0000, true);
  dv.setUint32(10, Math.floor(granulo / 0x1_0000_0000), true);
  dv.setUint32(14, serie, true);
  dv.setUint32(18, sequencia, true);
  pagina[26] = segmentos.length;
  pagina.set(segmentos, 27);
  let pos = 27 + segmentos.length;
  for (const p of pacotes) {
    pagina.set(p, pos);
    pos += p.length;
  }
  dv.setUint32(22, crcOgg(pagina), true);
  return pagina;
}

function montarOgg(cabecalho: Uint8Array, pacotes: Uint8Array[]): Uint8Array {
  const serie = crypto.getRandomValues(new Uint32Array(1))[0];
  const fornecedor = new TextEncoder().encode(NOME_DO_PRODUTO);
  const tags = new Uint8Array(8 + 4 + fornecedor.length + 4);
  tags.set(new TextEncoder().encode("OpusTags"), 0);
  new DataView(tags.buffer).setUint32(8, fornecedor.length, true);
  tags.set(fornecedor, 12);

  const paginas = [
    paginaOgg([cabecalho], 0, serie, 0, 0x02), // primeira página do fluxo
    paginaOgg([tags], 0, serie, 1, 0),
  ];
  let sequencia = 2;
  let atual: Uint8Array[] = [];
  let segmentos = 0;
  let granulo = 0;
  for (const p of pacotes) {
    const usa = Math.floor(p.length / 255) + 1;
    if (usa > 255) throw new Error("pacote grande demais");
    if (segmentos + usa > 255) {
      paginas.push(paginaOgg(atual, granulo, serie, sequencia++, 0));
      atual = [];
      segmentos = 0;
    }
    atual.push(p);
    segmentos += usa;
    granulo += amostrasDoPacote(p);
  }
  paginas.push(paginaOgg(atual, granulo, serie, sequencia, 0x04)); // fim do fluxo

  const total = paginas.reduce((soma, p) => soma + p.length, 0);
  const ogg = new Uint8Array(total);
  let pos = 0;
  for (const p of paginas) {
    ogg.set(p, pos);
    pos += p.length;
  }
  return ogg;
}

/* ── wav (Direct) e mp3 (reserva) ──────────────────────────────────────── */

const TAXA_WAV = 16_000;

/**
 * Decodifica já na taxa pedida: o decodeAudioData de um contexto offline
 * reamostra para a taxa dele. O contexto offline não ocupa o áudio do
 * aparelho (o iOS limita os AudioContext por página).
 */
async function decodificar(gravacao: Blob, taxa: number): Promise<Float32Array> {
  const contexto = new OfflineAudioContext(1, 1, taxa);
  const audio = await contexto.decodeAudioData(await gravacao.arrayBuffer());
  const canais = Array.from({ length: audio.numberOfChannels }, (_, c) =>
    audio.getChannelData(c),
  );
  if (canais.length === 1) return canais[0];
  // Mono: a média dos canais.
  const mono = new Float32Array(audio.length);
  for (let i = 0; i < mono.length; i++) {
    let soma = 0;
    for (const canal of canais) soma += canal[i];
    mono[i] = soma / canais.length;
  }
  return mono;
}

function paraInt16(amostra: number): number {
  const s = Math.max(-1, Math.min(1, amostra));
  return s < 0 ? s * 0x8000 : s * 0x7fff;
}

async function paraWav(gravacao: Blob, nome: string): Promise<File> {
  const amostras = await decodificar(gravacao, TAXA_WAV);
  const bytes = amostras.length * 2;
  const dv = new DataView(new ArrayBuffer(44 + bytes));
  const texto = (pos: number, s: string) => {
    for (let i = 0; i < s.length; i++) dv.setUint8(pos + i, s.charCodeAt(i));
  };
  texto(0, "RIFF");
  dv.setUint32(4, 36 + bytes, true);
  texto(8, "WAVE");
  texto(12, "fmt ");
  dv.setUint32(16, 16, true);
  dv.setUint16(20, 1, true); // PCM
  dv.setUint16(22, 1, true); // mono
  dv.setUint32(24, TAXA_WAV, true);
  dv.setUint32(28, TAXA_WAV * 2, true);
  dv.setUint16(32, 2, true);
  dv.setUint16(34, 16, true);
  texto(36, "data");
  dv.setUint32(40, bytes, true);
  for (let i = 0; i < amostras.length; i++) {
    dv.setInt16(44 + i * 2, paraInt16(amostras[i]), true);
  }
  return new File([dv.buffer], `${nome}.wav`, { type: "audio/wav" });
}

const TAXA_MP3 = 44_100;
const KBPS_MP3 = 64;
const BLOCO_MP3 = 1152; // tamanho de quadro do MP3

async function paraMp3(gravacao: Blob, nome: string): Promise<File> {
  // Fork do lamejs com o módulo MPEGMode corrigido: o original (1.2.1) lança
  // "MPEGMode is not defined" em qualquer bundler.
  const { Mp3Encoder } = await import("@breezystack/lamejs");
  const canal = await decodificar(gravacao, TAXA_MP3);
  const amostras = new Int16Array(canal.length);
  for (let i = 0; i < canal.length; i++) amostras[i] = paraInt16(canal[i]);
  const codificador = new Mp3Encoder(1, TAXA_MP3, KBPS_MP3);
  const pedacos: Uint8Array[] = [];
  for (let i = 0; i < amostras.length; i += BLOCO_MP3) {
    const pedaco = codificador.encodeBuffer(amostras.subarray(i, i + BLOCO_MP3));
    if (pedaco.length > 0) pedacos.push(pedaco);
  }
  const final = codificador.flush();
  if (final.length > 0) pedacos.push(final);
  return new File(pedacos as BlobPart[], `${nome}.mp3`, { type: "audio/mpeg" });
}
