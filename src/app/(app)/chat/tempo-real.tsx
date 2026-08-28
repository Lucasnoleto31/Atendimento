"use client";

import { useEffect, useRef } from "react";
import { useRouter } from "next/navigation";
import { createClient } from "@/lib/supabase/client";

/**
 * Assina INSERTs de lead_interactions no Supabase Realtime e atualiza a
 * tela. A assinatura filtra SÓ mensagens (recebida/enviada): os outros tipos
 * — mudanca_etapa das automações era 64% dos inserts — nem chegam ao
 * navegador, então rajada de automação não custa mais render nenhum.
 *
 * Cada refresh refaz o RSC da página inteira (~18-28 consultas), por isso:
 * - mensagem do lead ABERTO atualiza na hora (é o que o atendente está
 *   olhando);
 * - o resto acumula num respiro de 12s — a lista aguenta esperar;
 * - o eco da mensagem que o PRÓPRIO CRM enviou é ignorado (a janela já
 *   reconciliou no estado local; ver ignorarEcoRealtime).
 *
 * Exige a publication da migração 0014; sem ela, simplesmente não chega
 * evento e o polling continua cobrindo.
 */
const RESPIRO_MS = 12_000;

// Ids de interações criadas pela própria aba (envio de mensagem/nota): o eco
// do realtime delas não deve custar um refresh. Módulo, não estado: a Janela
// registra aqui no instante em que a action responde, sem re-render.
const ecosIgnorados = new Set<string>();

/** A Janela chama ao receber a interação criada pela action de envio. */
export function ignorarEcoRealtime(id: string) {
  ecosIgnorados.add(id);
  // Higiene: o eco consome o id ao chegar; se nunca chegar (canal caído),
  // o conjunto não pode crescer para sempre.
  if (ecosIgnorados.size > 50) {
    const primeiro = ecosIgnorados.values().next().value;
    if (primeiro !== undefined) ecosIgnorados.delete(primeiro);
  }
}

type LinhaInteracao = {
  id?: string;
  lead_id?: string;
  tipo?: string;
};

export function AtualizadorTempoReal({
  leadAbertoId,
}: {
  leadAbertoId: string | null;
}) {
  const router = useRouter();
  const timerRef = useRef<number | null>(null);
  // Enviadas acumuladas no respiro: podem ser eco do próprio envio (a action
  // ainda não respondeu quando o realtime chega) — a triagem fica para a
  // hora de disparar, quando o id retornado já foi registrado.
  const enviadasPendentesRef = useRef<string[]>([]);
  // Alguma recebida (de outra conversa) chegou no respiro: refresh certo.
  const temEventoCertoRef = useRef(false);

  useEffect(() => {
    const supabase = createClient();

    const atualizarAgora = () => {
      if (timerRef.current !== null) {
        clearTimeout(timerRef.current);
        timerRef.current = null;
      }
      enviadasPendentesRef.current = [];
      temEventoCertoRef.current = false;
      router.refresh();
    };

    const agendar = () => {
      if (timerRef.current !== null) return;
      timerRef.current = window.setTimeout(() => {
        timerRef.current = null;
        const enviadas = enviadasPendentesRef.current;
        enviadasPendentesRef.current = [];
        const certo = temEventoCertoRef.current;
        temEventoCertoRef.current = false;
        // Aba oculta não paga o custo; o polling cobre quando voltar.
        if (document.visibilityState !== "visible") return;
        // Enviada cujo id a action devolveu é a própria mensagem: já está na
        // tela via estado local. Só o que sobrar (colega enviando) atualiza.
        const alheias = enviadas.filter((id) => !ecosIgnorados.delete(id));
        if (certo || alheias.length > 0) router.refresh();
      }, RESPIRO_MS);
    };

    const aoInserir = (payload: { new: LinhaInteracao }) => {
      const nova = payload.new;
      // Eco do envio desta aba: a Janela já mostrou a mensagem.
      if (nova.id && ecosIgnorados.delete(nova.id)) return;

      // Mensagem DO lead aberto: o atendente está olhando — sem respiro.
      if (
        nova.tipo === "mensagem_recebida" &&
        nova.lead_id !== undefined &&
        nova.lead_id === leadAbertoId &&
        document.visibilityState === "visible"
      ) {
        atualizarAgora();
        return;
      }

      if (nova.tipo === "mensagem_enviada" && nova.id) {
        enviadasPendentesRef.current.push(nova.id);
      } else {
        temEventoCertoRef.current = true;
      }
      agendar();
    };

    // Dois canais de filtro no mesmo socket: só mensagem atravessa a rede.
    const canal = supabase
      .channel("chat-tempo-real")
      .on(
        "postgres_changes",
        {
          event: "INSERT",
          schema: "public",
          table: "lead_interactions",
          filter: "tipo=eq.mensagem_recebida",
        },
        aoInserir,
      )
      .on(
        "postgres_changes",
        {
          event: "INSERT",
          schema: "public",
          table: "lead_interactions",
          filter: "tipo=eq.mensagem_enviada",
        },
        aoInserir,
      )
      .subscribe();

    return () => {
      if (timerRef.current !== null) {
        clearTimeout(timerRef.current);
        timerRef.current = null;
      }
      enviadasPendentesRef.current = [];
      temEventoCertoRef.current = false;
      void supabase.removeChannel(canal);
    };
  }, [router, leadAbertoId]);

  return null;
}
