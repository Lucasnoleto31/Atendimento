"use client";

import { useEffect, useRef, type MouseEvent } from "react";
import Link from "next/link";
import { ChevronLeft, ChevronRight } from "lucide-react";
import { Button, classesDoBotao } from "@/components/ui/button";
import { cn } from "@/lib/utils";

/*
 * Os botões da lista que somem depois do clique: o Anterior e o Próximo que
 * chegam à ponta da lista, o "Limpar filtros" da lista vazia e o "Ir para a
 * primeira página" da página vazia. Sem cuidar do foco, ele cai no body e
 * quem navega pelo teclado recomeça do topo.
 */

/**
 * Anterior e Próxima. Na última página o Próxima vira texto apagado (e o
 * Anterior, na primeira): se o foco estava nele, passa para o outro botão,
 * que é o que ainda leva a algum lugar.
 */
export function Paginador({
  anterior,
  proxima,
}: {
  anterior: string | null;
  proxima: string | null;
}) {
  const caixa = useRef<HTMLDivElement>(null);
  const clicou = useRef(false);

  useEffect(() => {
    if (!clicou.current) return;
    clicou.current = false;
    const ativo = document.activeElement;
    if (ativo && ativo !== document.body) return;
    // Sem rolar: a página nova abre no topo, como nas páginas do meio, em
    // que o botão clicado continua com o foco lá embaixo.
    caixa.current
      ?.querySelector<HTMLElement>("a[href]")
      ?.focus({ preventScroll: true });
  }, [anterior, proxima]);

  return (
    <div
      ref={caixa}
      className="flex gap-1.5"
      onClickCapture={(e) => {
        // Clique que abre outra aba não troca esta página.
        if (e.button === 0 && !e.metaKey && !e.ctrlKey && !e.shiftKey) {
          clicou.current = true;
        }
      }}
    >
      <PaginaLink rotulo="Anterior" direcao="anterior" href={anterior} />
      <PaginaLink rotulo="Próxima" direcao="proxima" href={proxima} />
    </div>
  );
}

function PaginaLink({
  rotulo,
  href,
  direcao,
}: {
  rotulo: string;
  href: string | null;
  direcao: "anterior" | "proxima";
}) {
  const icone =
    direcao === "anterior" ? (
      <ChevronLeft size={18} strokeWidth={1.75} aria-hidden />
    ) : null;
  const iconeDepois =
    direcao === "proxima" ? (
      <ChevronRight size={18} strokeWidth={1.75} aria-hidden />
    ) : null;
  const classes = classesDoBotao({
    variant: "secondary",
    size: "md",
    className: cn(
      "gap-0.5 pointer-coarse:h-[44px]",
      direcao === "anterior" ? "pl-1.5" : "pr-1.5",
    ),
  });

  if (!href) {
    return (
      <span
        aria-disabled="true"
        className={cn(classes, "pointer-events-none border-fio text-texto-3")}
      >
        {icone}
        {rotulo}
        {iconeDepois}
      </span>
    );
  }
  return (
    <Link href={href} className={classes}>
      {icone}
      {rotulo}
      {iconeDepois}
    </Link>
  );
}

/**
 * O "Limpar filtros" da lista vazia. A lista cheia volta no lugar do cartão
 * e o botão some junto: o foco vai antes para o campo de busca, que continua
 * na tela depois da navegação.
 */
export function LimparFiltros() {
  return (
    <Button
      href="/contatos"
      variant="secondary"
      size="sm"
      className="mt-1.5"
      onClick={focarBusca}
    >
      Limpar filtros
    </Button>
  );
}

/**
 * O "Ir para a primeira página" da página vazia (um ?pagina= além do fim da
 * lista). Mesmo caso do "Limpar filtros": o cartão some com a lista que
 * volta, e o foco vai antes para o campo de busca.
 */
export function IrParaPrimeira({ href }: { href: string }) {
  return (
    <Button
      href={href}
      variant="secondary"
      size="sm"
      className="mt-1.5"
      onClick={focarBusca}
    >
      Ir para a primeira página
    </Button>
  );
}

/** Clique que abre outra aba (botão do meio, Ctrl, ⌘ ou Shift) não troca
 *  esta página: o foco fica onde estava. */
function focarBusca(e: MouseEvent) {
  if (e.button !== 0 || e.metaKey || e.ctrlKey || e.shiftKey) return;
  document.getElementById("busca")?.focus();
}
