"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { Search } from "lucide-react";
import { cn } from "@/lib/utils";

type Comando = {
  rotulo: string;
  tecla: string;
  acao: () => void;
  precisaConversa?: boolean;
};
type Grupo = { grupo: string; itens: Comando[] };

/**
 * A paleta ⌘K do Chat da Mesa: comandos filtráveis pelo teclado. Enter
 * executa o selecionado; setas navegam; Esc fecha (o pai cuida do atalho de
 * abrir). Sem conversa aberta, os comandos "desta conversa" ficam apagados.
 */
export function PaletaComandos({
  aberta,
  aoFechar,
  temConversa,
  comandos,
}: {
  aberta: boolean;
  aoFechar: () => void;
  temConversa: boolean;
  comandos: Grupo[];
}) {
  const [filtro, setFiltro] = useState("");
  const [idx, setIdx] = useState(0);
  const inputRef = useRef<HTMLInputElement>(null);
  const listaRef = useRef<HTMLDivElement>(null);
  // Quem tinha o foco antes de a paleta roubá-lo (quase sempre o compositor).
  const focoAnteriorRef = useRef<HTMLElement | null>(null);

  const planos = useMemo(() => {
    const f = filtro.trim().toLowerCase();
    return comandos.flatMap((g) =>
      g.itens
        .filter((c) => !f || c.rotulo.toLowerCase().includes(f))
        .map((c) => ({ ...c, grupo: g.grupo })),
    );
  }, [comandos, filtro]);

  // Índices que a seta pode alcançar: item sem conversa aberta não executa,
  // e parar nele fazia o Enter morrer em silêncio.
  const navegaveis = useMemo(
    () =>
      planos.flatMap((c, i) => (c.precisaConversa && !temConversa ? [] : [i])),
    [planos, temConversa],
  );

  // Reabrir zera busca e seleção (estado derivado no render).
  const [abertaAntes, setAbertaAntes] = useState(aberta);
  if (aberta !== abertaAntes) {
    setAbertaAntes(aberta);
    if (aberta) {
      setFiltro("");
      setIdx(navegaveis[0] ?? 0);
    }
  }

  useEffect(() => {
    if (!aberta) return;
    focoAnteriorRef.current = document.activeElement as HTMLElement | null;
    inputRef.current?.focus();
    // Ao fechar, o foco VOLTA para quem abriu. Solto no body, a próxima
    // letra digitada viraria atalho do palco (E resolve a conversa).
    // isConnected: um comando pode ter trocado a conversa e levado embora o
    // elemento de origem — aí não há para onde voltar.
    return () => {
      const origem = focoAnteriorRef.current;
      if (origem?.isConnected) origem.focus();
    };
  }, [aberta]);

  // Mantém a linha selecionada à vista: a seleção é só pintura, o navegador
  // não rola nada porque o foco nunca sai do campo de busca.
  useEffect(() => {
    if (!aberta) return;
    listaRef.current
      ?.querySelector('[data-ativo="1"]')
      ?.scrollIntoView({ block: "nearest" });
  }, [aberta, idx, filtro]);

  if (!aberta) return null;

  // -1 quando nada é executável: sem isto o realce caía num item cinza e o
  // Enter morria sem dizer por quê.
  const ativo = navegaveis.includes(idx) ? idx : (navegaveis[0] ?? -1);

  const mover = (passo: 1 | -1) => {
    if (navegaveis.length === 0) return;
    const pos = navegaveis.indexOf(ativo);
    const proximo =
      pos === -1
        ? navegaveis[0]
        : navegaveis[Math.min(Math.max(pos + passo, 0), navegaveis.length - 1)];
    setIdx(proximo);
  };

  const executar = (c: Comando) => {
    if (c.precisaConversa && !temConversa) return;
    aoFechar();
    c.acao();
  };

  let grupoAnterior = "";

  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-label="Paleta de comandos"
      className="fixed inset-0 z-50 flex items-start justify-center bg-overlay pt-[12vh]"
      onClick={(e) => {
        if (e.target === e.currentTarget) aoFechar();
      }}
      onKeyDown={(e) => {
        // Contenção de foco do diálogo: no wrapper, não só no campo — depois
        // de arrastar a barra de rolagem o foco fica no fundo, e daí o Tab
        // levava para a tela DE TRÁS do overlay.
        if (e.key === "Tab") {
          e.preventDefault();
          inputRef.current?.focus();
        }
      }}
    >
      <div className="w-full max-w-[480px] overflow-hidden rounded-lg border border-neutral-300 bg-neutral-0 shadow-lg">
        <label className="flex h-[48px] items-center gap-1 border-b border-neutral-200 px-1.5">
          <Search size={16} strokeWidth={1.7} aria-hidden className="text-neutral-400" />
          <input
            ref={inputRef}
            value={filtro}
            onChange={(e) => {
              setFiltro(e.target.value);
              setIdx(0);
            }}
            onKeyDown={(e) => {
              if (e.key === "ArrowDown") {
                e.preventDefault();
                mover(1);
              }
              if (e.key === "ArrowUp") {
                e.preventDefault();
                mover(-1);
              }
              if (e.key === "Enter") {
                e.preventDefault();
                const c = planos[ativo];
                if (c) executar(c);
              }
            }}
            placeholder="Digite um comando…"
            className="h-full min-w-0 flex-1 bg-transparent text-sm text-neutral-800 placeholder:text-neutral-400 focus:outline-none"
          />
          <kbd className="rounded-sm border border-neutral-200 bg-neutral-50 px-0.5 font-mono text-xs text-neutral-600">
            esc
          </kbd>
        </label>
        <div ref={listaRef} className="max-h-[300px] overflow-y-auto p-0.5">
          {planos.length === 0 ? (
            <p className="px-1.5 py-2 text-sm text-neutral-600">
              Nada encontrado para “{filtro}”.
            </p>
          ) : navegaveis.length === 0 ? (
            <p className="px-1.5 py-2 text-sm text-neutral-600">
              Estes comandos precisam de uma conversa aberta. Escolha uma na
              lista (ou aperte J) e volte aqui.
            </p>
          ) : (
            planos.map((c, i) => {
              const mostraGrupo = c.grupo !== grupoAnterior;
              grupoAnterior = c.grupo;
              const desabilitado = Boolean(c.precisaConversa && !temConversa);
              return (
                <div key={`${c.grupo}-${c.rotulo}`}>
                  {mostraGrupo ? (
                    <p className="px-1.5 pt-1 pb-0.5 text-xs font-semibold tracking-[0.06em] text-neutral-600 uppercase">
                      {c.grupo}
                    </p>
                  ) : null}
                  <button
                    type="button"
                    disabled={desabilitado}
                    data-ativo={i === ativo ? "1" : undefined}
                    onMouseEnter={() => {
                      if (!desabilitado) setIdx(i);
                    }}
                    onClick={() => executar(c)}
                    className={cn(
                      "flex h-[40px] w-full items-center gap-1 rounded-md px-1.5 text-left text-sm focus-visible:outline-2 focus-visible:-outline-offset-2 focus-visible:outline-primary-500",
                      i === ativo && !desabilitado
                        ? "bg-primary-50 text-primary-900"
                        : "text-neutral-800",
                      desabilitado && "cursor-not-allowed text-neutral-400",
                    )}
                  >
                    <span className="min-w-0 flex-1 truncate">{c.rotulo}</span>
                    {c.tecla ? (
                      <kbd className="shrink-0 rounded-sm border border-neutral-200 bg-neutral-50 px-0.5 font-mono text-xs text-neutral-600">
                        {c.tecla}
                      </kbd>
                    ) : null}
                  </button>
                </div>
              );
            })
          )}
        </div>
      </div>
    </div>
  );
}
