"use client";

import { useEffect, useRef, useState } from "react";
import { contarNaoLidas } from "@/app/(app)/chat/actions";

const INTERVALO_MS = 30_000;

/** Bip curto e discreto — sem arquivo de áudio, direto no WebAudio. */
function bipar() {
  try {
    const ctx = new AudioContext();
    const osc = ctx.createOscillator();
    const ganho = ctx.createGain();
    osc.frequency.value = 880;
    ganho.gain.value = 0.04;
    osc.connect(ganho);
    ganho.connect(ctx.destination);
    osc.start();
    osc.stop(ctx.currentTime + 0.15);
    osc.onended = () => void ctx.close();
  } catch {
    // navegador pode bloquear áudio sem interação — segue em silêncio
  }
}

/**
 * Badge de conversas não lidas no menu. Consulta a cada 30s (e ao voltar
 * para a aba); aumento do total toca o bip e prefixa (n) no título da aba.
 */
export function ContadorNaoLidas() {
  const [naoLidas, setNaoLidas] = useState(0);
  const [tarefasVencidas, setTarefasVencidas] = useState(0);
  const anteriorRef = useRef(0);

  useEffect(() => {
    let ativo = true;

    const atualizar = async () => {
      try {
        const pendencias = await contarNaoLidas();
        if (!ativo) return;
        if (pendencias.naoLidas > anteriorRef.current) bipar();
        anteriorRef.current = pendencias.naoLidas;
        setNaoLidas(pendencias.naoLidas);
        setTarefasVencidas(pendencias.tarefasVencidas);

        const totalTitulo = pendencias.naoLidas + pendencias.tarefasVencidas;
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
    return () => {
      ativo = false;
      clearInterval(intervalo);
      document.removeEventListener("visibilitychange", aoVoltar);
    };
  }, []);

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
