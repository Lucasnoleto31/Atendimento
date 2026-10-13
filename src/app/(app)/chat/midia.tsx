"use client";

import { useEffect, useRef, useState, type RefObject } from "react";
import {
  Check,
  Copy,
  Download,
  ExternalLink,
  File,
  FileArchive,
  FileImage,
  FileMusic,
  FileSpreadsheet,
  FileText,
  FileVideoCamera,
  MapPin,
  Presentation,
} from "lucide-react";
import { cn } from "@/lib/utils";
import { formatarTelefone } from "@/lib/format";
import type {
  Anexo,
  ContatoCompartilhado,
  LocalizacaoMensagem,
} from "./mensagem";

/*
 * A mídia dentro da bolha, no jeito do WhatsApp: imagens seguidas em grade
 * (o álbum), vídeo que toca ali mesmo, documento com ícone pelo tipo, nome,
 * tamanho e baixar, figurinha sem bolha, localização com o link do mapa e o
 * contato compartilhado como cartão. O áudio mora em player-audio.tsx e o
 * visualizador de imagem em tela cheia, em visualizador.tsx.
 *
 * `sobreTinta`: a peça está na bolha enviada (fundo na tinta). Lá o anel de
 * foco e o que é cinza trocam de cor, senão sumiriam no fundo.
 */

/** Anel de foco que aparece nos dois fundos da bolha. */
export function anelDeFoco(sobreTinta: boolean) {
  return sobreTinta
    ? "focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-fundo"
    : "focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-tinta";
}

/**
 * true quando o elemento chega perto da área visível (e fica true). Com 200
 * mensagens na tela, vídeo e áudio só pedem os metadados de quem a pessoa
 * vai ver.
 */
export function useQuaseVisivel(
  ref: RefObject<HTMLElement | null>,
  margem = "400px",
): boolean {
  const [visivel, setVisivel] = useState(false);
  useEffect(() => {
    const el = ref.current;
    if (!el || visivel) return;
    if (typeof IntersectionObserver === "undefined") {
      // Navegador sem o observador: carrega na hora.
      const t = window.setTimeout(() => setVisivel(true), 0);
      return () => window.clearTimeout(t);
    }
    const observador = new IntersectionObserver(
      (entradas) => {
        if (entradas.some((e) => e.isIntersecting)) {
          setVisivel(true);
          observador.disconnect();
        }
      },
      { rootMargin: margem },
    );
    observador.observe(el);
    return () => observador.disconnect();
  }, [ref, margem, visivel]);
  return visivel;
}

/** "1,2 MB" ou "340 KB". */
export function tamanhoLegivel(bytes: number): string {
  return bytes >= 1024 * 1024
    ? `${(bytes / 1024 / 1024).toLocaleString("pt-BR", { maximumFractionDigits: 1 })} MB`
    : `${Math.max(1, Math.round(bytes / 1024)).toLocaleString("pt-BR")} KB`;
}

/**
 * O link que baixa em vez de abrir. O atributo download não vale entre
 * domínios; o Storage do Supabase aceita ?download= e responde como
 * anexo, com o nome certo.
 */
export function urlParaBaixar(url: string, nome?: string | null): string {
  if (!url.includes("/storage/v1/object/public/")) return url;
  const separador = url.includes("?") ? "&" : "?";
  return `${url}${separador}download=${encodeURIComponent(nome?.trim() || "")}`;
}

/** A extensão pelo nome, pelo tipo ou pelo endereço ("pdf"), ou "". */
function extensaoDe(anexo: Anexo): string {
  const doNome = /\.([a-z0-9]{1,5})$/i.exec(anexo.nome?.trim() ?? "")?.[1];
  if (doNome) return doNome.toLowerCase();
  const doMime = anexo.mime?.split(";")[0].split("/")[1];
  if (doMime && doMime.length <= 5) return doMime.toLowerCase();
  let caminho = anexo.url;
  try {
    caminho = new URL(anexo.url).pathname;
  } catch {
    // endereço torto: lê como veio
  }
  return (/\.([a-z0-9]{1,5})$/i.exec(caminho)?.[1] ?? "").toLowerCase();
}

type TipoDocumento = {
  rotulo: string;
  Icone: typeof File;
};

const PLANILHA = new Set(["xls", "xlsx", "csv", "ods", "numbers"]);
const APRESENTACAO = new Set(["ppt", "pptx", "odp", "key"]);
const TEXTO = new Set(["doc", "docx", "odt", "txt", "rtf", "pages", "md"]);
const COMPACTADO = new Set(["zip", "rar", "7z", "gz", "tar"]);
const IMAGEM = new Set(["jpg", "jpeg", "png", "gif", "webp", "heic", "bmp"]);
const AUDIO = new Set(["mp3", "ogg", "opus", "m4a", "aac", "wav", "amr"]);
const VIDEO = new Set(["mp4", "mov", "3gp", "webm", "avi", "mkv"]);

function tipoDoDocumento(extensao: string): TipoDocumento {
  if (extensao === "pdf") return { rotulo: "PDF", Icone: FileText };
  if (PLANILHA.has(extensao)) return { rotulo: "Planilha", Icone: FileSpreadsheet };
  if (APRESENTACAO.has(extensao)) {
    return { rotulo: "Apresentação", Icone: Presentation };
  }
  if (TEXTO.has(extensao)) return { rotulo: "Documento", Icone: FileText };
  if (COMPACTADO.has(extensao)) return { rotulo: "Compactado", Icone: FileArchive };
  if (IMAGEM.has(extensao)) return { rotulo: "Imagem", Icone: FileImage };
  if (AUDIO.has(extensao)) return { rotulo: "Áudio", Icone: FileMusic };
  if (VIDEO.has(extensao)) return { rotulo: "Vídeo", Icone: FileVideoCamera };
  return { rotulo: "Arquivo", Icone: File };
}

/** O nome que aparece: o do arquivo, ou o fim do endereço. */
function nomeDoArquivo(anexo: Anexo): string {
  if (anexo.nome?.trim()) return anexo.nome.trim();
  try {
    const fim = new URL(anexo.url).pathname.split("/").pop();
    if (fim) return decodeURIComponent(fim);
  } catch {
    // endereço torto
  }
  return "Documento";
}

/* ── Imagens ─────────────────────────────────────────────────────────── */

export type ImagemDaBolha = { url: string; nome: string | null };

/**
 * Uma imagem ocupa a bolha; duas ou mais viram grade de duas colunas, com
 * até quatro à vista e "+N" na quarta. Tocar abre o visualizador naquela.
 */
export function GradeImagens({
  imagens,
  aoAbrir,
  sobreTinta,
  rotuloLado,
}: {
  imagens: ImagemDaBolha[];
  aoAbrir: (indice: number) => void;
  sobreTinta: boolean;
  /** "do contato" ou "enviada": completa o nome acessível. */
  rotuloLado: string;
}) {
  const anel = anelDeFoco(sobreTinta);
  if (imagens.length === 1) {
    const img = imagens[0];
    return (
      <button
        type="button"
        onClick={() => aoAbrir(0)}
        aria-label={`Abrir imagem ${rotuloLado}${img.nome ? `: ${img.nome}` : ""}`}
        className={cn("block max-w-full overflow-hidden rounded-controle", anel)}
      >
        {/* eslint-disable-next-line @next/next/no-img-element -- mídia do Storage, sem otimização do Next */}
        <img
          src={img.url}
          alt=""
          loading="lazy"
          decoding="async"
          className="block max-h-[320px] min-h-[96px] w-auto max-w-full min-w-[96px] bg-realce object-contain"
        />
      </button>
    );
  }
  const visiveis = imagens.slice(0, 4);
  const resto = imagens.length - visiveis.length;
  const tres = imagens.length === 3;
  return (
    <div
      role="group"
      aria-label={`${imagens.length.toLocaleString("pt-BR")} imagens ${rotuloLado}`}
      className="grid w-[256px] max-w-full grid-cols-2 gap-0.5"
    >
      {visiveis.map((img, i) => (
        <button
          key={`${img.url}-${i}`}
          type="button"
          onClick={() => aoAbrir(i)}
          aria-label={
            i === 3 && resto > 0
              ? `Abrir imagem 4 de ${imagens.length.toLocaleString("pt-BR")} (mais ${resto.toLocaleString("pt-BR")})`
              : `Abrir imagem ${(i + 1).toLocaleString("pt-BR")} de ${imagens.length.toLocaleString("pt-BR")}`
          }
          className={cn(
            "relative block overflow-hidden rounded-celula bg-realce",
            tres && i === 0 ? "col-span-2 aspect-[2/1]" : "aspect-square",
            anel,
          )}
        >
          {/* eslint-disable-next-line @next/next/no-img-element -- mídia do Storage, sem otimização do Next */}
          <img
            src={img.url}
            alt=""
            loading="lazy"
            decoding="async"
            className="h-full w-full object-cover"
          />
          {i === 3 && resto > 0 ? (
            <span
              aria-hidden
              className="tipo-titulo-2 absolute inset-0 flex items-center justify-center bg-fundo/70 text-tinta tabular-nums"
            >
              +{resto.toLocaleString("pt-BR")}
            </span>
          ) : null}
        </button>
      ))}
    </div>
  );
}

/* ── Vídeo ───────────────────────────────────────────────────────────── */

/** O vídeo toca na bolha, com os controles do navegador. Só pede os
 *  metadados (a primeira imagem e a duração) quando chega perto da tela. */
export function VideoNaBolha({
  anexo,
  sobreTinta,
}: {
  anexo: Anexo;
  sobreTinta: boolean;
}) {
  const ref = useRef<HTMLVideoElement>(null);
  const visivel = useQuaseVisivel(ref);
  return (
    <video
      ref={ref}
      controls
      playsInline
      preload={visivel ? "metadata" : "none"}
      src={anexo.url}
      aria-label={anexo.nome ? `Vídeo: ${anexo.nome}` : "Vídeo"}
      className={cn(
        "block max-h-[320px] w-[280px] max-w-full rounded-controle bg-overlay",
        anelDeFoco(sobreTinta),
      )}
    />
  );
}

/* ── Documento ───────────────────────────────────────────────────────── */

/**
 * Cartão do documento: ícone pelo tipo, nome, tipo e tamanho; tocar abre
 * numa aba nova, o botão ao lado baixa.
 */
export function DocumentoNaBolha({
  anexo,
  sobreTinta,
}: {
  anexo: Anexo;
  sobreTinta: boolean;
}) {
  const nome = nomeDoArquivo(anexo);
  const extensao = extensaoDe(anexo);
  const { rotulo, Icone } = tipoDoDocumento(extensao);
  const detalhe = [
    extensao && rotulo !== extensao.toUpperCase()
      ? `${rotulo} · ${extensao.toUpperCase()}`
      : rotulo,
    anexo.tamanho ? tamanhoLegivel(anexo.tamanho) : null,
  ]
    .filter(Boolean)
    .join(" · ");
  const anel = anelDeFoco(sobreTinta);
  return (
    <div
      className={cn(
        "flex w-[280px] max-w-full items-center gap-0.5 rounded-controle p-0.5",
        sobreTinta ? "bg-tinta-hover text-fundo" : "bg-fundo text-tinta",
      )}
    >
      <a
        href={anexo.url}
        target="_blank"
        rel="noreferrer"
        className={cn(
          "flex min-h-[48px] min-w-0 flex-1 items-center gap-1 rounded-celula px-0.5 transition-colors duration-[120ms]",
          sobreTinta ? "hover:bg-fundo/10" : "hover:bg-realce",
          anel,
        )}
      >
        <Icone
          size={28}
          strokeWidth={1.5}
          aria-hidden
          className={cn("shrink-0", sobreTinta ? "text-primary-100" : "text-texto-2")}
        />
        <span className="min-w-0 py-0.5">
          <span className="tipo-corpo line-clamp-2 break-words">{nome}</span>
          <span
            className={cn(
              "tipo-legenda block tabular-nums",
              sobreTinta ? "text-primary-100" : "text-texto-2",
            )}
          >
            {detalhe}
          </span>
        </span>
      </a>
      <a
        href={urlParaBaixar(anexo.url, nome)}
        download={nome}
        // Link de fora do Storage abre em outra aba em vez de tirar a
        // pessoa do chat (o download não vale entre domínios).
        target="_blank"
        rel="noreferrer"
        aria-label={`Baixar ${nome}`}
        title="Baixar"
        className={cn(
          "inline-flex h-[40px] w-[40px] shrink-0 items-center justify-center rounded-controle transition-colors duration-[120ms] pointer-coarse:h-[44px] pointer-coarse:w-[44px]",
          sobreTinta
            ? "text-fundo hover:bg-fundo/10"
            : "text-texto-2 hover:bg-realce hover:text-tinta",
          anel,
        )}
      >
        <Download size={20} strokeWidth={1.75} aria-hidden />
      </a>
    </div>
  );
}

/** Publicação, reel ou story do Instagram: fica no link. */
export function LinkNaBolha({
  anexo,
  sobreTinta,
}: {
  anexo: Anexo;
  sobreTinta: boolean;
}) {
  return (
    <a
      href={anexo.url}
      target="_blank"
      rel="noreferrer"
      className={cn(
        "tipo-corpo flex min-h-[48px] w-[280px] max-w-full items-center gap-1 rounded-controle px-1 transition-colors duration-[120ms]",
        sobreTinta
          ? "bg-tinta-hover text-fundo hover:bg-fundo/10"
          : "bg-fundo text-tinta hover:bg-realce",
        anelDeFoco(sobreTinta),
      )}
    >
      <ExternalLink size={20} strokeWidth={1.75} aria-hidden className="shrink-0" />
      <span className="min-w-0 truncate">{anexo.nome || "Abrir no Instagram"}</span>
    </a>
  );
}

/* ── Figurinha ───────────────────────────────────────────────────────── */

/** A figurinha vai sem bolha, do tamanho de figurinha. */
export function Figurinha({ anexo }: { anexo: Anexo }) {
  return (
    // eslint-disable-next-line @next/next/no-img-element -- mídia do Storage, sem otimização do Next
    <img
      src={anexo.url}
      alt="Figurinha"
      loading="lazy"
      decoding="async"
      className="block h-[128px] w-[128px] object-contain md:h-[144px] md:w-[144px]"
    />
  );
}

/* ── Localização ─────────────────────────────────────────────────────── */

function coordenada(n: number) {
  return n.toLocaleString("pt-BR", { maximumFractionDigits: 5 });
}

/** O lugar que o contato mandou, com o link para o mapa. */
export function CartaoLocalizacao({
  local,
  sobreTinta,
}: {
  local: LocalizacaoMensagem;
  sobreTinta: boolean;
}) {
  const mapa = `https://www.google.com/maps/search/?api=1&query=${local.latitude},${local.longitude}`;
  const titulo = local.nome ?? (local.endereco ? null : "Localização");
  return (
    <a
      href={mapa}
      target="_blank"
      rel="noreferrer"
      className={cn(
        "flex w-[280px] max-w-full items-start gap-1 rounded-controle p-1 transition-colors duration-[120ms]",
        sobreTinta
          ? "bg-tinta-hover text-fundo hover:bg-fundo/10"
          : "bg-fundo text-tinta hover:bg-realce",
        anelDeFoco(sobreTinta),
      )}
    >
      <MapPin
        size={24}
        strokeWidth={1.75}
        aria-hidden
        className={cn("mt-[2px] shrink-0", sobreTinta ? "text-primary-100" : "text-texto-2")}
      />
      <span className="min-w-0">
        {titulo ? (
          <span className="tipo-destaque block break-words">{titulo}</span>
        ) : null}
        {local.endereco ? (
          <span className="tipo-nota block break-words">{local.endereco}</span>
        ) : null}
        {!local.nome && !local.endereco ? (
          <span
            className={cn(
              "tipo-nota block tabular-nums",
              sobreTinta ? "text-primary-100" : "text-texto-2",
            )}
          >
            {coordenada(local.latitude)}; {coordenada(local.longitude)}
          </span>
        ) : null}
        <span className="tipo-nota mt-0.5 inline-flex items-center gap-0.5 font-semibold underline underline-offset-2">
          Abrir no mapa
          <ExternalLink size={14} strokeWidth={1.75} aria-hidden />
        </span>
      </span>
    </a>
  );
}

/* ── Contato compartilhado ───────────────────────────────────────────── */

function iniciais(nome: string): string {
  const partes = nome.trim().split(/\s+/).filter(Boolean);
  const letras =
    partes.length > 1
      ? `${partes[0][0]}${partes[partes.length - 1][0]}`
      : (partes[0] ?? "?").slice(0, 2);
  return letras.toLocaleUpperCase("pt-BR");
}

/** Copia para a área de transferência e diz que copiou. */
function BotaoCopiar({
  valor,
  rotulo,
  sobreTinta,
}: {
  valor: string;
  rotulo: string;
  sobreTinta: boolean;
}) {
  const [copiou, setCopiou] = useState(false);
  useEffect(() => {
    if (!copiou) return;
    const t = window.setTimeout(() => setCopiou(false), 2000);
    return () => window.clearTimeout(t);
  }, [copiou]);
  return (
    <button
      type="button"
      onClick={() => {
        void navigator.clipboard
          ?.writeText(valor)
          .then(() => setCopiou(true))
          .catch(() => {});
      }}
      aria-label={copiou ? `${rotulo}: copiado` : `Copiar ${rotulo}`}
      title={copiou ? "Copiado" : "Copiar"}
      className={cn(
        "relative inline-flex h-[32px] w-[32px] shrink-0 items-center justify-center rounded-controle transition-colors duration-[120ms] pointer-coarse:after:absolute pointer-coarse:after:-inset-[6px]",
        sobreTinta
          ? "text-fundo hover:bg-fundo/10"
          : "text-texto-2 hover:bg-realce hover:text-tinta",
        anelDeFoco(sobreTinta),
      )}
    >
      {copiou ? (
        <Check size={16} strokeWidth={2} aria-hidden />
      ) : (
        <Copy size={16} strokeWidth={1.75} aria-hidden />
      )}
    </button>
  );
}

/** O contato que a pessoa compartilhou: nome, empresa, telefones e e-mails,
 *  cada um com o copiar ao lado. */
export function CartaoContato({
  contato,
  sobreTinta,
}: {
  contato: ContatoCompartilhado;
  sobreTinta: boolean;
}) {
  const apoio = sobreTinta ? "text-primary-100" : "text-texto-2";
  return (
    <div
      className={cn(
        "w-[280px] max-w-full rounded-controle p-1",
        sobreTinta ? "bg-tinta-hover text-fundo" : "bg-fundo text-tinta",
      )}
    >
      <div className="flex items-center gap-1">
        <span
          aria-hidden
          className="tipo-nota inline-flex h-[40px] w-[40px] shrink-0 items-center justify-center rounded-full bg-avatar-2 font-semibold text-tinta"
        >
          {iniciais(contato.nome)}
        </span>
        <span className="min-w-0">
          <span className="tipo-destaque block truncate">{contato.nome}</span>
          {contato.empresa ? (
            <span className={cn("tipo-nota block truncate", apoio)}>
              {contato.empresa}
            </span>
          ) : null}
        </span>
      </div>
      {contato.telefones.length > 0 || contato.emails.length > 0 ? (
        <ul className="mt-1 flex flex-col gap-0.5">
          {contato.telefones.map((t, i) => {
            const digitos = (t.waId ?? t.numero).replace(/\D/g, "");
            const exibido = digitos ? formatarTelefone(digitos) : t.numero;
            return (
              <li key={`t-${i}`} className="flex items-center gap-0.5">
                <span className="tipo-nota min-w-0 flex-1 truncate tabular-nums select-all">
                  {exibido}
                </span>
                <BotaoCopiar
                  valor={digitos ? `+${digitos}` : t.numero}
                  rotulo={`o telefone ${exibido}`}
                  sobreTinta={sobreTinta}
                />
              </li>
            );
          })}
          {contato.emails.map((email) => (
            <li key={`e-${email}`} className="flex items-center gap-0.5">
              <span className="tipo-nota min-w-0 flex-1 truncate select-all">
                {email}
              </span>
              <BotaoCopiar
                valor={email}
                rotulo={`o e-mail ${email}`}
                sobreTinta={sobreTinta}
              />
            </li>
          ))}
        </ul>
      ) : null}
    </div>
  );
}
