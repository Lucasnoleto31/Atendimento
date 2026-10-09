"use client";

import { useEffect, useRef, type MouseEvent } from "react";
import { useRouter } from "next/navigation";

/*
 * O "← Contatos" que volta pelo histórico. Quando a entrada anterior do
 * histórico é o mesmo endereço do link (a lista que abriu a ficha), o clique
 * vira router.back(): o App Router reaproveita a página do cache, com a
 * rolagem de antes, e não empilha mais uma entrada (o voltar do sistema sai
 * da lista num gesto só). Nos outros casos, o Link segue como sempre.
 *
 * Quem diz qual é a entrada anterior: a Navigation API, onde existe (exata,
 * inclusive depois de recarregar ou de passar pelo chat); senão, um rastro
 * pequeno no sessionStorage, gravado pelas telas de contato ao montar. Na
 * dúvida, o rastro diz "não sei" e vale o Link.
 *
 * A página do cache traz os dados de quando a lista saiu de cena: a ficha
 * que muda o contato marca (marcarContatoMudou) e a lista relê ao voltar.
 */

const CHAVE = "zeve:rastro-contatos";

type Rastro = { anterior: string | null; atual: string };

function urlAtual(): string {
  return `${window.location.pathname}${window.location.search}`;
}

function lerRastro(): Rastro | null {
  try {
    const bruto = window.sessionStorage.getItem(CHAVE);
    if (!bruto) return null;
    const r = JSON.parse(bruto) as Partial<Rastro>;
    return typeof r.atual === "string"
      ? { anterior: typeof r.anterior === "string" ? r.anterior : null, atual: r.atual }
      : null;
  } catch {
    return null;
  }
}

function gravarRastro(r: Rastro) {
  try {
    window.sessionStorage.setItem(CHAVE, JSON.stringify(r));
  } catch {
    // Sem armazenamento (aba privada, cota): o Link de sempre vale.
  }
}

/** Dois endereços do site são o mesmo: caminho igual e os mesmos
 *  parâmetros, em qualquer ordem e codificação. */
export function mesmoEndereco(a: string, b: string): boolean {
  try {
    const x = new URL(a, "https://x.invalid");
    const y = new URL(b, "https://x.invalid");
    x.searchParams.sort();
    y.searchParams.sort();
    return (
      x.pathname === y.pathname &&
      x.searchParams.toString() === y.searchParams.toString()
    );
  } catch {
    return false;
  }
}

type EntradaNavegacao = { url: string | null; index: number };
type Navegacao = {
  currentEntry: EntradaNavegacao | null;
  entries: () => EntradaNavegacao[];
};

/** O endereço da entrada anterior do histórico, quando se sabe. */
function anteriorNoHistorico(): string | null {
  const nav = (window as unknown as { navigation?: Navegacao }).navigation;
  if (nav && typeof nav.entries === "function" && nav.currentEntry) {
    const i = nav.currentEntry.index;
    if (i <= 0) return null;
    const anterior = nav.entries()[i - 1];
    if (!anterior?.url) return null;
    const url = new URL(anterior.url);
    if (url.origin !== window.location.origin) return null;
    return `${url.pathname}${url.search}`;
  }
  // Sem a API: o rastro, e só se houver para onde voltar nesta aba.
  if (window.history.length <= 1) return null;
  const r = lerRastro();
  return r && mesmoEndereco(r.atual, urlAtual()) ? r.anterior : null;
}

/**
 * Grava a passagem por esta tela no rastro. `chave` muda quando o endereço
 * muda sem a tela desmontar (a lista trocando de filtro ou de página).
 *
 * Chegar de novo ao endereço que o rastro já tinha como atual quer dizer
 * que algo fora do rastro aconteceu no meio (recarregar, ir ao chat e
 * voltar): a anterior vira "não sei". O ref segura o efeito dobrado do modo
 * estrito, que leria a própria gravação como essa volta.
 */
export function useRastro(chave?: string) {
  const vista = useRef<string | null>(null);
  useEffect(() => {
    const atual = urlAtual();
    if (vista.current === atual) return;
    const primeira = vista.current === null;
    vista.current = atual;
    const r = lerRastro();
    if (!r) {
      gravarRastro({ anterior: null, atual });
    } else if (mesmoEndereco(r.atual, atual)) {
      if (primeira) gravarRastro({ anterior: null, atual });
    } else {
      gravarRastro({ anterior: r.atual, atual });
    }
  }, [chave]);
}

/*
 * A lista que volta pelo histórico vem do cache do App Router, com os dados
 * de quando a ficha abriu. Se a ficha mudou o contato por uma action que não
 * pede a lista de novo (a etiqueta, com a action do chat), ela marca aqui; a
 * lista, ao montar, relê uma vez e mantém a rolagem. Vale para o "← Contatos"
 * e para o voltar do sistema. Sem armazenamento, a lista fica como veio.
 */
const CHAVE_MUDOU = "zeve:contatos-mudou";

/** A ficha mudou o contato: a próxima lista que montar relê os dados. */
export function marcarContatoMudou() {
  try {
    window.sessionStorage.setItem(CHAVE_MUDOU, "1");
  } catch {
    // Sem armazenamento: a lista do cache segue até a próxima leitura.
  }
}

/** Na lista: relê os dados se a ficha marcou mudança. A marca sai na hora,
 *  e o efeito dobrado do modo estrito não relê duas vezes. */
export function useRelerSeMudou() {
  const router = useRouter();
  useEffect(() => {
    let mudou = false;
    try {
      mudou = window.sessionStorage.getItem(CHAVE_MUDOU) !== null;
      if (mudou) window.sessionStorage.removeItem(CHAVE_MUDOU);
    } catch {
      return;
    }
    if (mudou) router.refresh();
  }, [router]);
}

/**
 * O clique do "← …" (e do Cancelar que leva ao mesmo lugar): volta pelo
 * histórico quando a entrada anterior é o destino; senão, deixa o Link
 * seguir. Clique que abre outra aba não é interceptado.
 */
export function useVoltarPeloHistorico(href: string) {
  const router = useRouter();
  return (e: MouseEvent<HTMLElement>) => {
    if (
      e.defaultPrevented ||
      e.button !== 0 ||
      e.metaKey ||
      e.ctrlKey ||
      e.shiftKey ||
      e.altKey
    ) {
      return;
    }
    const anterior = anteriorNoHistorico();
    if (anterior && mesmoEndereco(anterior, href)) {
      e.preventDefault();
      router.back();
    }
  };
}
