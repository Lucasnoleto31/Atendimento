"use client";

import { useSyncExternalStore } from "react";
import { createClient } from "@/lib/supabase/client";
import { contarNaoLidas } from "@/app/(app)/chat/actions";

const INTERVALO_MS = 30_000;
const RESPIRO_TEMPO_REAL_MS = 5_000;

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
// e menu hambúrguer no mobile ficam ambos montados): um único ciclo de
// consulta + assinatura realtime por página, qualquer número de leitores.
type Pendencias = { naoLidas: number; tarefasVencidas: number };
let pendencias: Pendencias = { naoLidas: 0, tarefasVencidas: 0 };
const ouvintes = new Set<() => void>();
let pararCiclo: (() => void) | null = null;

function iniciarCiclo() {
  let ativo = true;
  let anterior = 0;
  let respiro: number | null = null;

  const atualizar = async () => {
    try {
      const novas = await contarNaoLidas();
      if (!ativo) return;
      if (novas.naoLidas > anterior) bipar();
      anterior = novas.naoLidas;
      pendencias = novas;
      for (const avisar of ouvintes) avisar();

      const totalTitulo = novas.naoLidas + novas.tarefasVencidas;
      const base = document.title.replace(/^\(\d+\)\s/, "");
      document.title = totalTitulo > 0 ? `(${totalTitulo}) ${base}` : base;
    } catch {
      // sem rede/sessão: tenta de novo no próximo ciclo
    }
  };

  void atualizar();
  const intervalo = setInterval(atualizar, INTERVALO_MS);
  const aoVoltar = () => {
    if (document.visibilityState === "visible") void atualizar();
  };
  document.addEventListener("visibilitychange", aoVoltar);

  // Tempo real (migração 0014): mensagem nova acende o badge — com respiro,
  // para rajada da equipe inteira não virar uma consulta por evento.
  const supabase = createClient();
  const canal = supabase
    .channel("badge-tempo-real")
    .on(
      "postgres_changes",
      { event: "INSERT", schema: "public", table: "lead_interactions" },
      () => {
        if (respiro !== null) return;
        respiro = window.setTimeout(() => {
          respiro = null;
          if (document.visibilityState === "visible") void atualizar();
        }, RESPIRO_TEMPO_REAL_MS);
      },
    )
    .subscribe();

  return () => {
    ativo = false;
    clearInterval(intervalo);
    if (respiro !== null) clearTimeout(respiro);
    document.removeEventListener("visibilitychange", aoVoltar);
    void supabase.removeChannel(canal);
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

function lerPendencias(): Pendencias {
  return pendencias;
}

/**
 * Badge de conversas não lidas no menu. Consulta a cada 30s (e ao voltar
 * para a aba); aumento do total toca o bip e prefixa (n) no título da aba.
 */
export function ContadorNaoLidas() {
  const { naoLidas, tarefasVencidas } = useSyncExternalStore(
    assinar,
    lerPendencias,
    lerPendencias,
  );

  if (naoLidas === 0 && tarefasVencidas === 0) return null;

  return (
    <span className="ml-auto inline-flex items-center gap-0.5">
      {tarefasVencidas > 0 ? (
        <span
          aria-label={`${tarefasVencidas} tarefa(s) vencida(s)`}
          title={`${tarefasVencidas} tarefa(s) vencida(s)`}
          className="inline-flex h-[20px] min-w-[20px] items-center justify-center rounded-full bg-warning-bg px-0.5 font-mono text-xs font-medium text-warning tabular-nums"
        >
          {tarefasVencidas > 99 ? "99+" : tarefasVencidas}
        </span>
      ) : null}
      {naoLidas > 0 ? (
        <span
          aria-label={`${naoLidas} conversa(s) não lida(s)`}
          className="inline-flex h-[20px] min-w-[20px] items-center justify-center rounded-full bg-primary-600 px-0.5 font-mono text-xs font-medium text-neutral-0 tabular-nums"
        >
          {naoLidas > 99 ? "99+" : naoLidas}
        </span>
      ) : null}
    </span>
  );
}
