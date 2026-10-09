"use client";

import { memo, useCallback, useState } from "react";
import { FileIcon, Music, Play, X } from "lucide-react";
import { cn } from "@/lib/utils";
import {
  extensaoDe,
  formaDeEnvio,
  indiceDaLegenda,
  porQueVaiLink,
  TETO_LEGENDA_WHATSAPP,
  type FormaDeEnvio,
} from "@/lib/formato-anexo";
import type { CanalConversa } from "./mensagem";

/** Um anexo na caixa do compositor. `documento`: escolhido em "Documento"
 *  (vai como arquivo, não como foto). */
export type ItemAnexo = { id: string; arquivo: File; documento: boolean };

export function formaDoItem(item: ItemAnexo, canal: CanalConversa): FormaDeEnvio {
  return formaDeEnvio(
    {
      tipo: item.arquivo.type,
      nome: item.arquivo.name,
      tamanho: item.arquivo.size,
      documento: item.documento,
    },
    canal,
  );
}

/**
 * A ordem do envio no WhatsApp: o anexo que leva a legenda vai na frente
 * (a primeira foto ou vídeo, senão o documento), porque o servidor põe o
 * texto no primeiro. Sem texto, ou no Direct (que não tem legenda), a ordem
 * fica como está.
 */
export function ordemDoEnvio(
  itens: ItemAnexo[],
  canal: CanalConversa,
  comTexto: boolean,
): ItemAnexo[] {
  if (canal !== "whatsapp" || !comTexto) return itens;
  const i = indiceDaLegenda(itens.map((item) => formaDoItem(item, canal)));
  return i <= 0 ? itens : [itens[i], ...itens.slice(0, i), ...itens.slice(i + 1)];
}

export function formatarTamanho(bytes: number) {
  return bytes >= 1024 * 1024
    ? `${(bytes / 1024 / 1024).toLocaleString("pt-BR", { maximumFractionDigits: 1 })} MB`
    : `${Math.max(1, Math.round(bytes / 1024)).toLocaleString("pt-BR")} KB`;
}

const ROTULO_FORMA: Record<FormaDeEnvio, string> = {
  foto: "Foto",
  video: "Vídeo",
  audio: "Áudio",
  documento: "Documento",
  link: "Link",
};

/** Onde o texto da caixa vai parar, numa linha curta. Segue o servidor
 *  (chat/actions.ts): acima do teto de legenda, o texto sai antes. */
function ondeVaiALegenda(
  itens: ItemAnexo[],
  formas: FormaDeEnvio[],
  canal: CanalConversa,
  textoLongo: boolean,
): string {
  if (canal === "instagram") return "O texto sai antes, numa mensagem.";
  const i = indiceDaLegenda(formas);
  if (i !== -1) {
    return textoLongo
      ? `O texto passa de ${TETO_LEGENDA_WHATSAPP.toLocaleString("pt-BR")} caracteres e sai antes, numa mensagem.`
      : `A legenda vai em ${itens[i].arquivo.name}.`;
  }
  return formas[0] === "link"
    ? "O texto vai junto do link."
    : "O texto sai antes, numa mensagem.";
}

/**
 * A prévia antes de enviar: miniaturas, o X de cada uma e o "Cancelar" de
 * todas. A legenda é o próprio campo do compositor; a linha de cima diz
 * onde ela vai. O que não sai no formato escolhido avisa embaixo.
 */
export const PreviaAnexos = memo(function PreviaAnexos({
  itens,
  canal,
  textoLongo,
  toque,
  aoTirar,
  aoTirarTodos,
}: {
  itens: ItemAnexo[];
  canal: CanalConversa;
  /** O texto (com a assinatura) passa do teto de legenda da Meta. */
  textoLongo: boolean;
  /** No toque, tirar não leva o foco ao campo (abriria o teclado). */
  toque: boolean;
  aoTirar: (id: string) => void;
  aoTirarTodos: () => void;
}) {
  const formas = itens.map((item) => formaDoItem(item, canal));
  const quantos =
    itens.length === 1
      ? "1 arquivo"
      : `${itens.length.toLocaleString("pt-BR")} arquivos`;
  const avisos = itens.flatMap((item, i) =>
    formas[i] === "link"
      ? [
          {
            id: item.id,
            texto: `${item.arquivo.name} vai como link para baixar: ${porQueVaiLink(
              {
                tipo: item.arquivo.type,
                nome: item.arquivo.name,
                tamanho: item.arquivo.size,
                documento: item.documento,
              },
              canal,
            )}`,
          },
        ]
      : [],
  );

  return (
    <div className="pb-1">
      {/* O nome do arquivo não tem onde quebrar (o print do Android vem
          como Screenshot_20261008-101532_WhatsApp.jpg): quebra em qualquer
          ponto, senão passa por cima do Cancelar nos 375px. */}
      <div className="flex items-center gap-1 pb-0.5">
        <p className="tipo-nota min-w-0 flex-1 text-texto-2 [overflow-wrap:anywhere]">
          <span className="text-tinta tabular-nums">{quantos}</span> ·{" "}
          {ondeVaiALegenda(itens, formas, canal, textoLongo)}
        </p>
        <button
          type="button"
          onClick={aoTirarTodos}
          aria-label="Cancelar os anexos"
          className="tipo-nota inline-flex h-[32px] shrink-0 items-center rounded-controle px-1 font-semibold text-texto-2 transition-colors duration-[120ms] hover:bg-realce hover:text-tinta focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-tinta pointer-coarse:h-[44px]"
        >
          Cancelar
        </button>
      </div>
      {/* A fila de miniaturas rola de lado dentro dela (cinco não cabem nos
          375px do celular), e a página não ganha rolagem lateral. A folga de
          8px em volta é da área de toque do X, que passa da miniatura. */}
      <ul
        aria-label="Anexos"
        className="-mx-1 flex gap-1 overflow-x-auto overscroll-x-contain px-1 pt-1"
      >
        {itens.map((item, i) => (
          <Miniatura
            key={item.id}
            item={item}
            forma={formas[i]}
            toque={toque}
            aoTirar={aoTirar}
          />
        ))}
      </ul>
      {avisos.length > 0 ? (
        <ul className="pt-0.5">
          {avisos.map((aviso) => (
            <li key={aviso.id} className="tipo-nota text-atencao [overflow-wrap:anywhere]">
              {aviso.texto}
            </li>
          ))}
        </ul>
      ) : null}
    </div>
  );
});

/**
 * Uma miniatura. O endereço local do arquivo nasce e morre com o elemento
 * (a limpeza do ref devolve a memória quando o item sai da caixa).
 */
function Miniatura({
  item,
  forma,
  toque,
  aoTirar,
}: {
  item: ItemAnexo;
  forma: FormaDeEnvio;
  toque: boolean;
  aoTirar: (id: string) => void;
}) {
  const { arquivo } = item;
  const [falhou, setFalhou] = useState(false);
  const imagem = arquivo.type.startsWith("image/") && !falhou;
  const video = arquivo.type.startsWith("video/") && !falhou;
  const comEndereco = useCallback(
    (el: HTMLImageElement | HTMLVideoElement | null) => {
      if (!el) return;
      const url = URL.createObjectURL(arquivo);
      // No vídeo, o #t pede o primeiro quadro (o Safari do iPhone não
      // desenha nada sem ele).
      el.src = el instanceof HTMLVideoElement ? `${url}#t=0.1` : url;
      return () => URL.revokeObjectURL(url);
    },
    [arquivo],
  );
  const ext = extensaoDe(arquivo.name);

  return (
    <li className="relative w-[80px] shrink-0">
      <div className="relative flex h-[80px] w-[80px] items-center justify-center overflow-hidden rounded-controle bg-cartao text-texto-2">
        {imagem ? (
          // eslint-disable-next-line @next/next/no-img-element -- arquivo local, sem otimização do Next
          <img
            ref={comEndereco}
            alt=""
            onError={() => setFalhou(true)}
            className="h-full w-full object-cover"
          />
        ) : video ? (
          <>
            <video
              ref={comEndereco}
              muted
              playsInline
              preload="metadata"
              onError={() => setFalhou(true)}
              className="h-full w-full object-cover"
            />
            <span
              aria-hidden
              className="absolute inset-0 m-auto inline-flex h-[32px] w-[32px] items-center justify-center rounded-full bg-fundo/90 text-tinta"
            >
              <Play size={16} strokeWidth={2} />
            </span>
          </>
        ) : (
          <span className="flex flex-col items-center gap-0.5" aria-hidden>
            {forma === "audio" ? (
              <Music size={24} strokeWidth={1.75} />
            ) : (
              <FileIcon size={24} strokeWidth={1.75} />
            )}
            {ext ? (
              <span className="tipo-legenda-2 font-semibold uppercase">{ext}</span>
            ) : null}
          </span>
        )}
      </div>
      <p className="tipo-legenda mt-0.5 truncate text-tinta" title={arquivo.name}>
        {arquivo.name}
      </p>
      <p
        className={cn(
          "tipo-legenda-2 truncate tabular-nums",
          forma === "link" ? "text-atencao" : "text-texto-2",
        )}
      >
        {ROTULO_FORMA[forma]} · {formatarTamanho(arquivo.size)}
      </p>
      <button
        type="button"
        data-tirar=""
        onClick={(e) => {
          // O X some com a miniatura: o foco passa ao X vizinho, ou ao
          // campo quando era o último. Solto no body, a próxima letra
          // viraria atalho do palco (E resolve a conversa).
          const li = e.currentTarget.closest("li");
          const vizinho = (
            li?.nextElementSibling ?? li?.previousElementSibling
          )?.querySelector<HTMLButtonElement>("[data-tirar]");
          const campo = e.currentTarget
            .closest("form")
            ?.querySelector<HTMLTextAreaElement>("textarea");
          aoTirar(item.id);
          if (vizinho) vizinho.focus({ preventScroll: true });
          else if (!toque) campo?.focus({ preventScroll: true });
        }}
        aria-label={`Tirar ${arquivo.name}`}
        title="Tirar"
        className="absolute top-0.5 right-0.5 inline-flex h-[24px] w-[24px] items-center justify-center rounded-celula border border-fio bg-fundo text-tinta transition-colors duration-[120ms] after:absolute after:-inset-[10px] hover:bg-cartao focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-tinta"
      >
        <X size={14} strokeWidth={2} aria-hidden />
      </button>
    </li>
  );
}
