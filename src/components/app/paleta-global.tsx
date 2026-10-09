"use client";

import { useEffect, useId, useSyncExternalStore } from "react";
import dynamic from "next/dynamic";
import type { LucideIcon } from "lucide-react";

/*
 * A paleta global (⌘K no Mac, Ctrl+K no resto), montada uma vez na casca.
 * Acha qualquer pessoa pela busca única (nome, e-mail, @, telefone), leva a
 * qualquer área, roda os comandos que a tela atual registrou e, com algo
 * digitado, abre os editores da Administração e de Minha conta de qualquer
 * tela (os destinos fixos do papel, destinos.ts). Escolher uma
 * pessoa abre a conversa dela no chat (/chat?lead=), com conversa ou sem;
 * Shift+Enter abre a ficha. Fora do chat, o link leva o ?voltar= da tela de
 * onde se veio; dentro dele, os filtros da fila. Com envio no ar no chat,
 * pessoa e área não navegam: a paleta fica aberta e avisa.
 *
 * O padrão de teclado é o do combobox: o foco fica no campo, as setas andam
 * pela lista (aria-activedescendant), Enter escolhe, Esc fecha e devolve o
 * foco a quem abriu. Não abre por cima de outro diálogo.
 */

/** Um comando da tela atual, registrado por useComandosDaTela. */
export type ComandoPaleta = {
  id: string;
  rotulo: string;
  /** Título do grupo na paleta. Sem ele, "Nesta tela". */
  grupo?: string;
  /** Tecla mostrada à direita ("E", "⌘Enter"); só informa, não liga nada. */
  atalho?: string;
  executar: () => void;
};

/** Uma área da casca, para o grupo "Ir para". */
export type AreaPaleta = {
  href: string;
  rotulo: string;
  icone: LucideIcon;
  /** A tecla da área ("Alt+1", "⌘1"), quando tem. */
  atalho?: string;
  /** Outras palavras que acham a área ("configurações" acha a
   *  Administração). */
  sinonimos?: string;
};

/**
 * Um destino fixo de qualquer tela (destinos.ts): abre um editor da
 * Administração ou de Minha conta pelo endereço. Aparece com algo digitado.
 */
export type DestinoPaleta = {
  id: string;
  rotulo: string;
  grupo: "Administração" | "Conta";
  href: string;
  /** A chave do editor que ele abre: a tela que já tem esse editor mostra
   *  o comando dela, e o destino some. */
  editor?: string;
  sinonimos?: string;
};

/* ── Plataforma ────────────────────────────────────────────────────────── */

const semAssinatura = () => () => {};

export function ehMac(): boolean {
  return /Mac|iPhone|iPad|iPod/.test(navigator.platform || navigator.userAgent);
}

/** Mac no cliente; o servidor não sabe e responde false (a dica corrige
 *  depois de hidratar). */
export function useEhMac(): boolean {
  return useSyncExternalStore(semAssinatura, ehMac, () => false);
}

/* ── Envio no ar ───────────────────────────────────────────────────────── */

/**
 * Enquanto alguma conversa tem envio no ar, o chat liga data-envio-em-voo="1"
 * no <html> e desliga quando não sobra nenhum. Os atalhos de área e a paleta
 * conferem antes de navegar: trocar de tela agora desmontaria a conversa no
 * meio do envio, e o erro da Meta e o texto que não saiu se perderiam.
 */
export function haEnvioEmVoo(): boolean {
  return document.documentElement.dataset.envioEmVoo === "1";
}

export const AVISO_ENVIO_EM_VOO = "Esperando o envio terminar.";

/* ── Comandos registrados pelas telas ──────────────────────────────────── */

type Registro = {
  chave: string;
  comandos: ComandoPaleta[];
  assinatura: string;
};

let registros: Registro[] = [];
let listaComandos: ComandoPaleta[] = [];
export const SEM_COMANDOS: ComandoPaleta[] = [];
const ouvintesComandos = new Set<() => void>();

function assinaturaDe(comandos: ComandoPaleta[]): string {
  return JSON.stringify(
    comandos.map((c) => [c.id, c.rotulo, c.grupo ?? "", c.atalho ?? ""]),
  );
}

/** Os comandos de todas as telas montadas, na ordem em que entraram. */
export const lerComandos = () => listaComandos;

function publicarComandos() {
  listaComandos = registros.flatMap((r) => r.comandos);
  for (const avisar of ouvintesComandos) avisar();
}

function registrar(chave: string, comandos: ComandoPaleta[]) {
  const assinatura = assinaturaDe(comandos);
  const atual = registros.find((r) => r.chave === chave);
  if (atual && atual.assinatura === assinatura) {
    // Mesmos comandos com funções novas (a tela renderizou de novo): guarda
    // as funções sem avisar ninguém. Quem executa busca a mais nova pelo id.
    atual.comandos = comandos;
    return;
  }
  registros = atual
    ? registros.map((r) =>
        r.chave === chave ? { chave, comandos, assinatura } : r,
      )
    : [...registros, { chave, comandos, assinatura }];
  publicarComandos();
}

function remover(chave: string) {
  if (!registros.some((r) => r.chave === chave)) return;
  registros = registros.filter((r) => r.chave !== chave);
  publicarComandos();
}

/** A função mais nova de um comando, na hora de executar. */
export function comandoAtual(id: string): ComandoPaleta | undefined {
  for (const r of registros) {
    const c = r.comandos.find((x) => x.id === id);
    if (c) return c;
  }
  return undefined;
}

export function assinarComandos(avisar: () => void) {
  ouvintesComandos.add(avisar);
  return () => {
    ouvintesComandos.delete(avisar);
  };
}

/**
 * A tela põe os comandos dela na paleta enquanto estiver montada e os tira
 * ao desmontar. Pode passar um array novo a cada render: só a mudança de
 * id, rótulo, grupo ou tecla redesenha a paleta, e a execução usa sempre a
 * função mais nova. Para um comando sumir (sem conversa aberta, por exemplo),
 * a tela simplesmente não o passa.
 */
export function useComandosDaTela(comandos: ComandoPaleta[]): void {
  const chave = useId();
  useEffect(() => {
    registrar(chave, comandos);
  }, [chave, comandos]);
  useEffect(() => () => remover(chave), [chave]);
}

/* ── Abrir e fechar ────────────────────────────────────────────────────── */

let aberta = false;
let retornoPedido: HTMLElement | null = null;
/**
 * O que fazer depois de fechar: o foco volta primeiro a quem abriu, e só
 * então a ação roda, para ela poder mover o foco (abrir uma conversa,
 * trocar de tela) sem a devolução desfazer isso.
 */
let depoisDeFechar: (() => void) | null = null;
const ouvintesAberta = new Set<() => void>();

function avisarAberta() {
  for (const avisar of ouvintesAberta) avisar();
}

/**
 * Abre a paleta. `retorno` é para onde o foco volta ao fechar, quando quem
 * abriu vai sumir (a folha do "Mais" fecha junto); sem ele, volta para o
 * elemento que tinha o foco.
 */
export function abrirPaleta(retorno?: HTMLElement | null) {
  if (aberta) return;
  // Guardado aqui, no gesto, e não no efeito de montagem: em
  // desenvolvimento o React monta duas vezes, e na segunda o foco já
  // estaria no campo da paleta.
  retornoPedido =
    retorno ??
    (document.activeElement instanceof HTMLElement
      ? document.activeElement
      : null);
  aberta = true;
  avisarAberta();
}

export function fecharPaleta() {
  if (!aberta) return;
  aberta = false;
  avisarAberta();
}

/** Fecha e deixa a ação para depois da devolução do foco. */
export function fecharPaletaE(acao: () => void) {
  depoisDeFechar = acao;
  fecharPaleta();
}

export function tomarAcaoPendente(): (() => void) | null {
  const acao = depoisDeFechar;
  depoisDeFechar = null;
  return acao;
}

export function lerRetorno(): HTMLElement | null {
  return retornoPedido;
}

function assinarAberta(avisar: () => void) {
  ouvintesAberta.add(avisar);
  return () => {
    ouvintesAberta.delete(avisar);
  };
}

const lerAberta = () => aberta;

/* ── A paleta ──────────────────────────────────────────────────────────── */

export function PaletaGlobal({
  areas,
  destinos = [],
}: {
  areas: AreaPaleta[];
  destinos?: DestinoPaleta[];
}) {
  const estaAberta = useSyncExternalStore(
    assinarAberta,
    lerAberta,
    () => false,
  );

  // ⌘K / Ctrl+K em qualquer tela, inclusive com o foco num campo (é o
  // contrato de toda paleta). Com outro diálogo aberto, o teclado é dele.
  useEffect(() => {
    const aoTeclar = (e: KeyboardEvent) => {
      if (e.defaultPrevented || e.altKey || e.shiftKey) return;
      if (!(e.metaKey || e.ctrlKey) || e.key.toLowerCase() !== "k") return;
      if (aberta) {
        e.preventDefault();
        fecharPaleta();
        return;
      }
      if (document.querySelector('[aria-modal="true"], dialog[open]')) return;
      e.preventDefault();
      abrirPaleta();
    };
    document.addEventListener("keydown", aoTeclar);
    return () => document.removeEventListener("keydown", aoTeclar);
  }, []);

  // O diálogo vem num pedaço de JS à parte, baixado quando o navegador fica
  // ocioso depois da primeira tela: a paleta não pesa no carregamento de
  // nenhuma página e já está pronta quando alguém aperta ⌘K.
  useEffect(() => {
    const ocioso = window.requestIdleCallback ?? ((f: () => void) => window.setTimeout(f, 1500));
    const cancelar = window.cancelIdleCallback ?? window.clearTimeout;
    const id = ocioso(() => void carregarDialogo());
    return () => cancelar(id);
  }, []);

  // Montada só enquanto aberta: cada abertura começa com o campo vazio, e a
  // paleta fechada não deixa role="dialog" nenhum no DOM (o chat lê isso
  // para saber se os atalhos J, E e H valem).
  return estaAberta ? (
    <DialogoPaleta areas={areas} destinos={destinos} />
  ) : null;
}

const carregarDialogo = () => import("./paleta-dialogo");
const DialogoPaleta = dynamic(
  () => carregarDialogo().then((m) => m.DialogoPaleta),
  { ssr: false },
);
