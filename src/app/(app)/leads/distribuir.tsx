"use client";

import { useEffect, useRef, useState } from "react";
import { useFormStatus } from "react-dom";
import { Shuffle } from "lucide-react";
import { Button } from "@/components/ui/button";
import { distribuirLeads } from "./actions";

function BotaoConfirmar() {
  const { pending } = useFormStatus();
  return (
    <button
      type="submit"
      disabled={pending}
      className="inline-flex h-[32px] items-center rounded-md bg-primary-600 px-1.5 text-xs font-medium text-neutral-0 transition-colors duration-[120ms] hover:bg-primary-700 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-primary-500 disabled:cursor-not-allowed disabled:opacity-60"
    >
      {pending ? "Distribuindo…" : "Confirmar"}
    </button>
  );
}

export function DistribuirLeads({
  semResponsavel,
  equipe,
}: {
  semResponsavel: number;
  equipe: number;
}) {
  const [confirmando, setConfirmando] = useState(false);
  const regiao = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!confirmando) return;
    const aoClicar = (e: MouseEvent) => {
      if (!regiao.current?.contains(e.target as Node)) setConfirmando(false);
    };
    const aoTeclar = (e: KeyboardEvent) => {
      if (e.key === "Escape") setConfirmando(false);
    };
    document.addEventListener("mousedown", aoClicar);
    document.addEventListener("keydown", aoTeclar);
    return () => {
      document.removeEventListener("mousedown", aoClicar);
      document.removeEventListener("keydown", aoTeclar);
    };
  }, [confirmando]);

  if (semResponsavel === 0) return null;

  if (!confirmando) {
    return (
      <Button variant="secondary" size="md" onClick={() => setConfirmando(true)}>
        <Shuffle size={18} strokeWidth={1.5} aria-hidden />
        Distribuir {semResponsavel.toLocaleString("pt-BR")}
      </Button>
    );
  }

  return (
    <div
      ref={regiao}
      className="flex flex-col items-end gap-1 rounded-md border border-neutral-200 bg-neutral-0 p-1.5 shadow-md"
    >
      <p className="max-w-[280px] text-right text-xs text-neutral-600">
        {semResponsavel.toLocaleString("pt-BR")} lead(s) sem responsável serão
        divididos aleatoriamente entre {equipe} pessoa(s) ativa(s). Leads já
        atribuídos não mudam.
      </p>
      <div className="flex items-center gap-1">
        <button
          type="button"
          onClick={() => setConfirmando(false)}
          className="inline-flex h-[32px] items-center rounded-md border border-neutral-300 bg-neutral-0 px-1.5 text-xs font-medium text-neutral-800 transition-colors duration-[120ms] hover:bg-neutral-100 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-primary-500"
        >
          Cancelar
        </button>
        <form action={distribuirLeads}>
          <BotaoConfirmar />
        </form>
      </div>
    </div>
  );
}
