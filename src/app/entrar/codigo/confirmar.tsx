"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { createClient } from "@/lib/supabase/client";
import { Button } from "@/components/ui/button";
import { sair } from "../actions";

export function Confirmar2fa({ proximo }: { proximo: string }) {
  const router = useRouter();
  const [codigo, setCodigo] = useState("");
  const [erro, setErro] = useState<string | null>(null);
  const [enviando, setEnviando] = useState(false);

  const confirmar = async (e: React.FormEvent) => {
    e.preventDefault();
    if (enviando) return;
    setEnviando(true);
    setErro(null);
    const supabase = createClient();
    const { data: lista } = await supabase.auth.mfa.listFactors();
    const fator = lista?.totp.find((f) => f.status === "verified") ?? null;
    if (!fator) {
      setEnviando(false);
      router.replace(`/entrar/2fa?proximo=${encodeURIComponent(proximo)}`);
      return;
    }
    const { error } = await supabase.auth.mfa.challengeAndVerify({
      factorId: fator.id,
      code: codigo.replace(/\D/g, ""),
    });
    setEnviando(false);
    if (error) {
      setErro("Código não confere. Espere o próximo e tente de novo.");
      return;
    }
    router.replace(proximo);
    router.refresh();
  };

  return (
    <form onSubmit={confirmar} className="flex flex-col gap-2">
      <label
        htmlFor="codigo-2fa"
        className="text-sm font-medium text-neutral-800"
      >
        Código do autenticador
      </label>
      <input
        id="codigo-2fa"
        inputMode="numeric"
        autoComplete="one-time-code"
        pattern="[0-9]{6}"
        maxLength={6}
        required
        autoFocus
        value={codigo}
        onChange={(e) => setCodigo(e.target.value)}
        className="h-[48px] rounded-md border border-neutral-300 bg-neutral-0 px-1.5 text-center font-mono text-h3 tracking-[0.3em] text-neutral-900 tabular-nums focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-primary-500"
      />
      {erro ? (
        <p
          role="alert"
          className="rounded-md border border-danger bg-danger-bg px-1.5 py-1 text-sm text-danger"
        >
          {erro}
        </p>
      ) : null}
      <Button type="submit" size="lg" disabled={enviando} className="w-full">
        {enviando ? "Confirmando…" : "Entrar"}
      </Button>
      <button
        type="button"
        onClick={() => void sair()}
        className="self-start text-sm text-neutral-600 underline-offset-2 hover:underline"
      >
        Sair e voltar ao login
      </button>
    </form>
  );
}
