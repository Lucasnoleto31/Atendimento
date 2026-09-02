"use client";

import { useActionState, useEffect, useRef, useState } from "react";
import { useFormStatus } from "react-dom";
import { Trash2 } from "lucide-react";
import { excluirImportacao, type ResultadoExclusao } from "./actions";

const ESTADO_INICIAL: ResultadoExclusao = {};

function BotaoConfirmar() {
  const { pending } = useFormStatus();
  return (
    <button
      type="submit"
      disabled={pending}
      className="inline-flex h-[32px] items-center rounded-md bg-danger px-1.5 text-xs font-medium text-neutral-0 transition-colors duration-[120ms] hover:opacity-90 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-primary-500 disabled:cursor-not-allowed disabled:opacity-60"
    >
      {pending ? "Excluindo…" : "Confirmar"}
    </button>
  );
}

export function ExcluirImportacao({
  importId,
  tipo,
  arquivo,
}: {
  importId: string;
  tipo: "clientes" | "lotes" | "leads";
  arquivo: string;
}) {
  const [confirmando, setConfirmando] = useState(false);
  const [estado, formAction] = useActionState(
    excluirImportacao,
    ESTADO_INICIAL,
  );
  const regiao = useRef<HTMLDivElement>(null);

  // Fecha a confirmação ao clicar fora ou apertar Esc.
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

  if (!confirmando) {
    return (
      <button
        type="button"
        onClick={() => setConfirmando(true)}
        aria-label={`Excluir importação ${arquivo}`}
        className="inline-flex h-[40px] w-[40px] items-center justify-center rounded-md text-neutral-400 transition-colors duration-[120ms] hover:bg-danger-bg hover:text-danger focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-primary-500"
      >
        <Trash2 size={18} strokeWidth={1.5} aria-hidden />
      </button>
    );
  }

  return (
    <div ref={regiao} className="flex flex-col items-end gap-1 py-1">
      <p className="max-w-[240px] text-right text-xs text-neutral-600">
        {tipo === "lotes"
          ? "Remove o histórico e os lotes que este upload gravou."
          : tipo === "leads"
            ? "Remove só o histórico — os leads importados permanecem."
            : "Remove só o histórico — os clientes importados permanecem."}
      </p>
      <form action={formAction} className="flex items-center gap-1">
        <input type="hidden" name="import_id" value={importId} />
        <button
          type="button"
          onClick={() => setConfirmando(false)}
          className="inline-flex h-[32px] items-center rounded-md border border-neutral-300 bg-neutral-0 px-1.5 text-xs font-medium text-neutral-800 transition-colors duration-[120ms] hover:bg-neutral-100 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-primary-500"
        >
          Cancelar
        </button>
        <BotaoConfirmar />
      </form>
      {estado.erro ? (
        <p role="alert" className="text-right text-xs text-danger">
          {estado.erro}
        </p>
      ) : null}
    </div>
  );
}
