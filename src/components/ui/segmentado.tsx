"use client";

import { useRef } from "react";
import Link from "next/link";
import { cn } from "@/lib/utils";

export type OpcaoSegmentada<T extends string> = {
  valor: T;
  rotulo: React.ReactNode;
  /** Com href, a opção é um link (filtro pela URL, tela do servidor). */
  href?: string;
  /** Número ao lado do rótulo, em algarismo tabular ("Caixa 12"). */
  contagem?: number;
  desativada?: boolean;
};

/*
 * Controle segmentado do iOS na ficha padrão: trilho na tinta a 6% (vale
 * sobre qualquer superfície) e o segmento ativo numa superfície que sobe
 * (branca no claro, #2A2A2A no escuro), com o rótulo na tinta. Raio de
 * controle no trilho e de célula no segmento, concêntricos (10 − 4 = 6).
 *
 * Duas formas, conforme as opções:
 * - com href: links, para filtro que mora na URL (aria-current no ativo);
 * - sem href: grupo de rádio (role="radiogroup"), com as setas trocando de
 *   opção como o teclado espera de um rádio. Pede `onMudar`.
 */
export function Segmentado<T extends string>({
  rotulo,
  opcoes,
  valor,
  onMudar,
  tamanho = "md",
  larguraTotal = false,
  className,
}: {
  /** Nome do grupo para o leitor de tela ("Visão", "Período"). */
  rotulo: string;
  opcoes: OpcaoSegmentada<T>[];
  valor: T;
  onMudar?: (valor: T) => void;
  tamanho?: "sm" | "md";
  /** Ocupa a largura toda, com os segmentos divididos por igual. */
  larguraTotal?: boolean;
  className?: string;
}) {
  const grupo = useRef<HTMLDivElement>(null);
  const comoLinks = opcoes.some((o) => o.href !== undefined);

  const trilho = cn(
    "items-center gap-0.5 rounded-controle bg-realce p-0.5",
    larguraTotal ? "flex w-full" : "inline-flex max-w-full",
    className,
  );
  const segmento = (ativo: boolean, desativada?: boolean) =>
    cn(
      "relative inline-flex min-w-0 items-center justify-center gap-0.5 rounded-celula px-1.5 font-semibold whitespace-nowrap transition-[background-color,color] duration-[120ms] focus-visible:outline-2 focus-visible:outline-offset-1 focus-visible:outline-tinta",
      // No toque, a área de acerto cresce por cima e por baixo até 44px
      // (kit, bloco 7), sem mudar o desenho do trilho.
      "pointer-coarse:after:absolute pointer-coarse:after:inset-x-0",
      tamanho === "sm"
        ? "h-[28px] text-xs pointer-coarse:after:-inset-y-[8px]"
        : "h-[36px] text-sm pointer-coarse:after:-inset-y-[4px]",
      larguraTotal && "flex-1",
      ativo
        ? "bg-elevado text-tinta ring-1 ring-fio"
        : "text-texto-2 hover:text-tinta",
      desativada && "pointer-events-none opacity-50",
    );
  const conteudo = (o: OpcaoSegmentada<T>) => (
    <>
      <span className="truncate">{o.rotulo}</span>
      {o.contagem !== undefined ? (
        <span className="font-normal tabular-nums text-texto-2">
          {o.contagem.toLocaleString("pt-BR")}
        </span>
      ) : null}
    </>
  );

  if (comoLinks) {
    return (
      <nav aria-label={rotulo} className={trilho}>
        {opcoes.map((o) => {
          const ativo = o.valor === valor;
          return (
            <Link
              key={o.valor}
              href={o.href ?? "#"}
              aria-current={ativo ? "page" : undefined}
              aria-disabled={o.desativada || undefined}
              tabIndex={o.desativada ? -1 : undefined}
              className={segmento(ativo, o.desativada)}
            >
              {conteudo(o)}
            </Link>
          );
        })}
      </nav>
    );
  }

  const habilitadas = opcoes.filter((o) => !o.desativada);
  // O que entra na ordem do Tab: o ativo, ou a primeira habilitada quando o
  // valor não bate com nenhuma (senão o grupo ficaria fora do teclado).
  const naOrdem = habilitadas.some((o) => o.valor === valor)
    ? valor
    : habilitadas[0]?.valor;
  // Seta para os lados (e para cima/baixo) anda entre as opções habilitadas,
  // com volta no fim, e já seleciona: é o comportamento do rádio nativo.
  const aoTeclar = (e: React.KeyboardEvent<HTMLButtonElement>) => {
    const passo =
      e.key === "ArrowRight" || e.key === "ArrowDown"
        ? 1
        : e.key === "ArrowLeft" || e.key === "ArrowUp"
          ? -1
          : 0;
    if (passo === 0 || habilitadas.length === 0) return;
    e.preventDefault();
    const atual = habilitadas.findIndex((o) => o.valor === valor);
    const n = habilitadas.length;
    const proxima =
      atual === -1
        ? habilitadas[passo > 0 ? 0 : n - 1]
        : habilitadas[(atual + passo + n) % n];
    onMudar?.(proxima.valor);
    const botao = grupo.current?.querySelector<HTMLButtonElement>(
      `[data-valor="${CSS.escape(proxima.valor)}"]`,
    );
    botao?.focus();
  };

  return (
    <div ref={grupo} role="radiogroup" aria-label={rotulo} className={trilho}>
      {opcoes.map((o) => {
        const ativo = o.valor === valor;
        return (
          <button
            key={o.valor}
            type="button"
            role="radio"
            aria-checked={ativo}
            data-valor={o.valor}
            disabled={o.desativada}
            // Só um entra na ordem do Tab; as setas fazem o resto.
            tabIndex={o.valor === naOrdem ? 0 : -1}
            onClick={() => onMudar?.(o.valor)}
            onKeyDown={aoTeclar}
            className={segmento(ativo, o.desativada)}
          >
            {conteudo(o)}
          </button>
        );
      })}
    </div>
  );
}
