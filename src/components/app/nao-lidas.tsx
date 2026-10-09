"use client";

import { useSyncExternalStore } from "react";
import { cn } from "@/lib/utils";
import { contarNaoLidas } from "@/app/(app)/chat/actions";
import {
  assinarConexao,
  assinarMensagens,
  canalConectado,
} from "@/app/(app)/chat/tempo-real";

// Polling só de reserva (e só com a aba à vista): com o canal do tempo real
// de pé, quem acorda o badge é a mensagem que chega.
const INTERVALO_RESERVA_MS = 30_000;
const RESPIRO_MS = 5_000;

/**
 * Bip curto e discreto — sem arquivo de áudio, direto no WebAudio.
 * Um único AudioContext por página: no iOS, contexto criado sem gesto do
 * usuário nasce suspenso e nunca toca — criar um por bip vazava contextos
 * até o Safari recusar (limite de ~4 por página).
 */
let ctxBip: AudioContext | null = null;
function bipar() {
  try {
    ctxBip ??= new AudioContext();
    if (ctxBip.state === "suspended") void ctxBip.resume().catch(() => {});
    if (ctxBip.state !== "running") return; // sem gesto ainda — silêncio
    const osc = ctxBip.createOscillator();
    const ganho = ctxBip.createGain();
    osc.frequency.value = 880;
    ganho.gain.value = 0.04;
    osc.connect(ganho);
    ganho.connect(ctxBip.destination);
    osc.start();
    osc.stop(ctxBip.currentTime + 0.15);
  } catch {
    // navegador pode bloquear áudio sem interação — segue em silêncio
  }
}

// Estado compartilhado entre as instâncias do badge (menu lateral no desktop
// e barra de abas no celular ficam as duas montadas): um único ciclo por
// página, qualquer número de leitores.
let naoLidas = 0;
const ouvintes = new Set<() => void>();
let pararCiclo: (() => void) | null = null;
let agendarRecontagem: (() => void) | null = null;
// A conversa que o chat tem na tela: mensagem dela não acende o badge — o
// atendente está olhando, e o chat marca lida.
let conversaEmCena: string | null = null;

function publicar(n: number) {
  naoLidas = Math.max(0, n);
  for (const avisar of ouvintes) avisar();
  // Só as conversas não lidas entram no título da aba — é o alerta de
  // "mensagem nova".
  const base = document.title.replace(/^\(\d+\)\s/, "");
  document.title = naoLidas > 0 ? `(${naoLidas}) ${base}` : base;
}

function iniciarCiclo() {
  let ativo = true;
  let respiro: number | null = null;
  // O bip compara contagem do servidor com contagem do servidor: o ajuste
  // local que o chat faz ao abrir uma conversa não pode soar como novidade.
  let ultimaDoServidor: number | null = null;

  const atualizar = async () => {
    try {
      const novas = await contarNaoLidas();
      if (!ativo) return;
      if (ultimaDoServidor !== null && novas.naoLidas > ultimaDoServidor) {
        bipar();
      }
      ultimaDoServidor = novas.naoLidas;
      publicar(novas.naoLidas);
    } catch {
      // sem rede/sessão: tenta de novo no próximo sinal
    }
  };

  // Rajada da equipe inteira vira UMA consulta por respiro, com a aba à
  // vista ou não: escondida é justamente quando o "(N)" do título e o bip
  // avisam de alguma coisa. Sem mensagem chegando, nada é consultado.
  agendarRecontagem = () => {
    if (respiro !== null) return;
    respiro = window.setTimeout(() => {
      respiro = null;
      void atualizar();
    }, RESPIRO_MS);
  };

  void atualizar();

  const intervalo = setInterval(() => {
    if (document.visibilityState !== "visible") return;
    if (canalConectado()) return;
    void atualizar();
  }, INTERVALO_RESERVA_MS);

  const aoVoltar = () => {
    if (document.visibilityState !== "visible") return;
    // Escondida, a aba pode ter perdido eventos (o navegador congela o
    // socket): volta sempre recontando.
    void atualizar();
  };
  document.addEventListener("visibilitychange", aoVoltar);

  // O evento traz só o lead_id, sem o dono. O de uma conversa de dono oculto
  // (Administração > Privacidade) também pede a recontagem, mas a conta do
  // servidor (contarNaoLidas) não a inclui: o número, o "(N)" do título e o
  // bip ficam como estavam.
  const pararMensagens = assinarMensagens((linha) => {
    if (
      linha.lead_id === conversaEmCena &&
      document.visibilityState === "visible"
    ) {
      return;
    }
    agendarRecontagem?.();
  });
  const pararConexao = assinarConexao((_conectado, voltou) => {
    if (voltou && document.visibilityState === "visible") void atualizar();
  });

  return () => {
    ativo = false;
    agendarRecontagem = null;
    clearInterval(intervalo);
    if (respiro !== null) clearTimeout(respiro);
    document.removeEventListener("visibilitychange", aoVoltar);
    pararMensagens();
    pararConexao();
  };
}

function assinar(avisar: () => void) {
  ouvintes.add(avisar);
  if (ouvintes.size === 1) pararCiclo = iniciarCiclo();
  return () => {
    ouvintes.delete(avisar);
    if (ouvintes.size === 0) {
      pararCiclo?.();
      pararCiclo = null;
    }
  };
}

function lerNaoLidas(): number {
  return naoLidas;
}

/**
 * O chat avisa qual conversa está na tela (null ao fechar). Mensagem que
 * chega nela não reconta o badge nem bipa.
 */
export function definirConversaEmCena(leadId: string | null) {
  conversaEmCena = leadId;
}

/** Reflexo imediato de um gesto do chat (abrir uma não lida: -1). */
export function ajustarNaoLidas(delta: number) {
  if (delta === 0 || ouvintes.size === 0) return;
  publicar(naoLidas + delta);
}

/** Pede ao badge que reconte, com o mesmo respiro dos eventos. */
export function recontarNaoLidas() {
  agendarRecontagem?.();
}

/**
 * Badge do item Chat no menu: conversas com mensagem não lida. Reconta
 * quando chega mensagem (pelo canal único de tempo real), quando a aba
 * volta a aparecer e quando o chat pede; o polling de 30s só liga com o
 * canal fora do ar. Mensagem nova toca o bip.
 *
 * Na tinta, o único destaque do item. O número é só visual; quem lê a tela
 * ouve o texto escondido, dentro do nome do link ("Chat, 3 conversas não
 * lidas"): aria-label num <span> sem papel nem todo leitor anuncia. Onde
 * ele fica (fim da linha, canto do ícone) é de quem usa, pelo className.
 *
 * O texto escondido vale onde o badge vem depois do rótulo (o menu
 * lateral). Onde ele vem antes (a barra de abas, no canto do ícone), o
 * badge vai com soVisual e o texto, no <NaoLidasParaLeitor /> depois do
 * rótulo: senão o nome do link sairia ", 3 conversas não lidas Chat".
 */
export function ContadorNaoLidas({
  className,
  soVisual = false,
}: {
  className?: string;
  soVisual?: boolean;
}) {
  const n = useSyncExternalStore(assinar, lerNaoLidas, lerNaoLidas);

  if (n === 0) return null;
  return (
    <span
      aria-hidden={soVisual || undefined}
      className={cn(
        "inline-flex h-[20px] min-w-[20px] shrink-0 items-center justify-center rounded-full bg-tinta px-0.5 text-xs leading-none font-semibold text-fundo tabular-nums",
        className,
      )}
    >
      <span aria-hidden>{n > 99 ? "99+" : n.toLocaleString("pt-BR")}</span>
      {soVisual ? null : <span className="sr-only">, {textoNaoLidas(n)}</span>}
    </span>
  );
}

/** Só a contagem falada (", 3 conversas não lidas"), para pôr depois do
 *  rótulo quando o badge está antes dele (ContadorNaoLidas soVisual). */
export function NaoLidasParaLeitor() {
  const n = useSyncExternalStore(assinar, lerNaoLidas, lerNaoLidas);

  if (n === 0) return null;
  return <span className="sr-only">, {textoNaoLidas(n)}</span>;
}

function textoNaoLidas(n: number): string {
  return n === 1
    ? "1 conversa não lida"
    : `${n.toLocaleString("pt-BR")} conversas não lidas`;
}
