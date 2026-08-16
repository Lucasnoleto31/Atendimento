"use client";

import { useActionState } from "react";
import { useFormStatus } from "react-dom";
import { History } from "lucide-react";
import {
  importarHistoricoChatwoot,
  type ResultadoHistorico,
} from "./chatwoot-actions";

const ESTADO: ResultadoHistorico = {};

function Botao({ continuando }: { continuando: boolean }) {
  const { pending } = useFormStatus();
  return (
    <button
      type="submit"
      disabled={pending}
      className="inline-flex h-[40px] items-center gap-0.5 rounded-md border border-neutral-300 bg-neutral-0 px-2 text-sm font-medium text-neutral-800 transition-colors duration-[120ms] hover:bg-neutral-100 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-primary-500 disabled:cursor-not-allowed disabled:opacity-60"
    >
      <History size={18} strokeWidth={1.5} aria-hidden />
      {pending
        ? "Importando histórico… (pode levar uns minutos)"
        : continuando
          ? "Continuar histórico"
          : "Importar histórico de mensagens"}
    </button>
  );
}

/**
 * Backfill do histórico de mensagens das conversas já vinculadas. Roda em
 * levas; reexecutar continua de onde parou e nunca duplica mensagem.
 */
export function HistoricoImport() {
  const [estado, formAction] = useActionState(importarHistoricoChatwoot, ESTADO);
  const continuando = typeof estado.proximoOffset === "number";

  return (
    <div className="flex flex-col gap-1">
      <form action={formAction}>
        <input type="hidden" name="offset" value={estado.proximoOffset ?? 0} />
        <Botao continuando={continuando} />
      </form>

      {estado.erro ? (
        <p role="alert" className="text-sm text-danger">
          {estado.erro}
          {continuando ? " Clique de novo para retomar." : ""}
        </p>
      ) : null}

      {estado.ok ? (
        <p role="status" className="text-sm text-neutral-800">
          <span className="font-medium text-success">
            {estado.mensagens} mensagem(ns) importadas
          </span>
          {" · "}
          {estado.conversas} conversa(s) lidas · {estado.puladas} já existiam
          {continuando ? (
            <>
              {" — "}
              <span className="text-warning">
                parcial ({estado.proximoOffset}/{estado.totalLeads} leads):
                clique em Continuar para a próxima leva.
              </span>
            </>
          ) : (
            " — histórico completo."
          )}
        </p>
      ) : null}
    </div>
  );
}
