"use client";

import { useEffect, useRef } from "react";
import { createClient } from "@/lib/supabase/client";

/**
 * Tempo real do Chat da Mesa — a versão sem router.refresh(): o palco nunca
 * refaz a página, então aqui os eventos viram CALLBACKS pontuais e quem
 * decide o que recarregar é o app (conversa aberta na hora; lista num
 * respiro de 12s).
 *
 * Assina só mensagens (recebida/enviada) — mudanca_etapa e afins, que eram
 * 64% dos inserts, nem chegam ao navegador. Exige a publication da 0014;
 * sem ela não chega evento e o polling de 60s do app cobre.
 */
const RESPIRO_MS = 12_000;

type LinhaInteracao = { id?: string; lead_id?: string; tipo?: string };

export function TempoRealConversas({
  leadAbertoId,
  aoMensagemDoAberto,
  aoMudancaNaLista,
}: {
  leadAbertoId: string | null;
  /** Mensagem (recebida ou enviada por outra aba) na conversa aberta. */
  aoMensagemDoAberto: () => void;
  /** Qualquer movimento que mude a fila — agrupado no respiro. */
  aoMudancaNaLista: () => void;
}) {
  const timerRef = useRef<number | null>(null);
  const abertoRef = useRef(leadAbertoId);
  const cbAbertoRef = useRef(aoMensagemDoAberto);
  const cbListaRef = useRef(aoMudancaNaLista);
  // Espelha as props em refs FORA do render: o canal do Realtime é um só
  // (efeito de deps vazias) e lê sempre o valor mais novo por aqui.
  useEffect(() => {
    abertoRef.current = leadAbertoId;
    cbAbertoRef.current = aoMensagemDoAberto;
    cbListaRef.current = aoMudancaNaLista;
  }, [leadAbertoId, aoMensagemDoAberto, aoMudancaNaLista]);

  useEffect(() => {
    const supabase = createClient();

    const agendarLista = () => {
      if (timerRef.current !== null) return;
      timerRef.current = window.setTimeout(() => {
        timerRef.current = null;
        cbListaRef.current();
      }, RESPIRO_MS);
    };

    const aoEvento = (linha: LinhaInteracao) => {
      if (!linha.lead_id) return;
      if (linha.lead_id === abertoRef.current) {
        // A conversa na tela atualiza já — é o que o atendente está olhando.
        cbAbertoRef.current();
      }
      agendarLista();
    };

    const canal = supabase
      .channel("conversas-tempo-real")
      .on(
        "postgres_changes",
        {
          event: "INSERT",
          schema: "public",
          table: "lead_interactions",
          filter: "tipo=eq.mensagem_recebida",
        },
        (payload) => aoEvento(payload.new as LinhaInteracao),
      )
      .on(
        "postgres_changes",
        {
          event: "INSERT",
          schema: "public",
          table: "lead_interactions",
          filter: "tipo=eq.mensagem_enviada",
        },
        (payload) => aoEvento(payload.new as LinhaInteracao),
      )
      .subscribe();

    return () => {
      if (timerRef.current !== null) window.clearTimeout(timerRef.current);
      void supabase.removeChannel(canal);
    };
  }, []);

  return null;
}
