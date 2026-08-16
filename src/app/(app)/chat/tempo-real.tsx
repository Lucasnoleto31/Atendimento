"use client";

import { useEffect, useRef } from "react";
import { useRouter } from "next/navigation";
import { createClient } from "@/lib/supabase/client";

/**
 * Assina INSERTs de lead_interactions no Supabase Realtime e atualiza a
 * tela na hora (com um respiro de 800ms para rajadas). Exige a publication
 * da migração 0014; sem ela, simplesmente não chega evento e o polling
 * continua cobrindo.
 */
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
            router.refresh();
          }, 800);
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
