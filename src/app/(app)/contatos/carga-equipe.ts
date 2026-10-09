"use client";

import { useCallback, useRef, useState } from "react";
import { carregarCargaEquipe } from "../conversas/lista";

/*
 * O que a escolha de responsável precisa sem desenhar o menu: o tipo, se a
 * lista pede busca e a carga da equipe. Fica à parte para a ficha do
 * contato não levar o JavaScript dos menus de filtro junto (o painel do
 * "Trocar" carrega só quando abre).
 */

/** Com mais itens que isto, o menu ganha busca (o mesmo número da fila). */
const ITENS_SEM_BUSCA = 8;

/** Uma pessoa que pode receber o contato. */
export type Destino = { id: string; nome: string };

/** "Sem dono" mais a equipe: com mais itens que isto, o menu ganha busca. */
export function precisaBusca(destinos: Destino[]): boolean {
  return destinos.length + 1 > ITENS_SEM_BUSCA;
}

/**
 * A carga da equipe (as conversas abertas de cada pessoa, a mesma conta do
 * rodízio), lida quando o menu abre. Só para a gestão, como no chat; para os
 * outros fica null e a lista sai sem número. A falha não trava nada: a
 * lista segue sem o número.
 */
export function useCargaEquipe(gestao: boolean) {
  const [carga, setCarga] = useState<Map<string, number> | null>(null);
  const lendo = useRef(false);
  const ler = useCallback(async () => {
    if (!gestao || lendo.current) return;
    lendo.current = true;
    try {
      const r = await carregarCargaEquipe();
      if ("equipe" in r) {
        setCarga(new Map(r.equipe.map((p) => [p.id, p.abertas])));
      }
    } catch {
      // Sem a carga, a lista continua valendo.
    } finally {
      lendo.current = false;
    }
  }, [gestao]);
  return { carga, ler };
}
