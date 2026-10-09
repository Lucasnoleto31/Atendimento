"use client";

import { createContext, useContext, useEffect, useMemo, useState } from "react";

/*
 * Se a seleção em massa da lista está ligada, para as peças do topo da
 * página (o Exportar, a busca, o funil). Na seleção elas saem de cena pelo
 * CSS (group-has-[[data-selecionando]]), mas continuam montadas: sem este
 * aviso, os comandos delas ficavam na paleta, e o "Exportar CSV desta
 * lista" aparecia ao lado do "Exportar seleção em CSV" levando a lista
 * inteira. Quem liga e desliga é a ListaSelecionavel; o provedor fica na
 * página, em volta das duas.
 */

type Valor = { ativa: boolean; avisar: (ativa: boolean) => void };

const Contexto = createContext<Valor | null>(null);

export function ProvedorSelecao({ children }: { children: React.ReactNode }) {
  const [ativa, setAtiva] = useState(false);
  const valor = useMemo(() => ({ ativa, avisar: setAtiva }), [ativa]);
  return <Contexto.Provider value={valor}>{children}</Contexto.Provider>;
}

/** A seleção está ligada (fora do provedor, nunca). */
export function useSelecaoLigada(): boolean {
  return useContext(Contexto)?.ativa ?? false;
}

/** A lista diz se a seleção está ligada; ao sair da tela, desliga. */
export function useAvisarSelecao(ativa: boolean) {
  const avisar = useContext(Contexto)?.avisar;
  useEffect(() => {
    if (!avisar) return;
    avisar(ativa);
    return () => avisar(false);
  }, [avisar, ativa]);
}
