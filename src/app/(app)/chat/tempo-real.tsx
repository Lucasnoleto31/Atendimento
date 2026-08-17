"use client";

import { useEffect, useRef } from "react";
import { useRouter } from "next/navigation";
import { createClient } from "@/lib/supabase/client";

/**
 * Assina INSERTs de lead_interactions no Supabase Realtime e atualiza a
 * tela (com um respiro de 3s para rajadas — cada refresh refaz o RSC da
 * página inteira, e no iPhone o excesso derrubava a aba por memória).
 * Exige a publication da migração 0014; sem ela, simplesmente não chega
 * evento e o polling continua cobrindo.
 */
const RESPIRO_MS = 3_000;

export function AtualizadorTempoReal() {
  const router = useRouter();
  const timerRef = useRef<number | null>(null);

  useEffect(() => {
    const supabase = createClient();
    const canal = supabase
      .channel("chat-tempo-real")
      .on(
        "postgres_changes",
        { event: "INSERT", schema: "public", table: "lead_interactions" },
        () => {
          if (timerRef.current !== null) return;
          timerRef.current = window.setTimeout(() => {
            timerRef.current = null;
            // Aba oculta não paga o custo; o polling cobre quando voltar.
            if (document.visibilityState === "visible") router.refresh();
          }, RESPIRO_MS);
        },
      )
      .subscribe();

    return () => {
      if (timerRef.current !== null) clearTimeout(timerRef.current);
      void supabase.removeChannel(canal);
    };
  }, [router]);

  return null;
}
