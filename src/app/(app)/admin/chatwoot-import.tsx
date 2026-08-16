"use client";

import { useActionState } from "react";
import { useFormStatus } from "react-dom";
import { CloudDownload } from "lucide-react";
import { importarChatwoot, type ResultadoChatwoot } from "./chatwoot-actions";

const ESTADO: ResultadoChatwoot = {};

function Botao({ continuando }: { continuando: boolean }) {
  const { pending } = useFormStatus();
  return (
    <button
      type="submit"
      disabled={pending}
      className="inline-flex h-[40px] items-center gap-0.5 rounded-md bg-primary-600 px-2 text-sm font-medium text-neutral-0 transition-colors duration-[120ms] hover:bg-primary-700 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-primary-500 disabled:cursor-not-allowed disabled:opacity-60"
    >
      <CloudDownload size={18} strokeWidth={1.5} aria-hidden />
      {pending
        ? "Importando… (pode levar uns minutos)"
        : continuando
          ? "Continuar importação"
          : "Importar conversas do Chatwoot"}
    </button>
  );
}

export function ChatwootImport({ configurado }: { configurado: boolean }) {
  const [estado, formAction] = useActionState(importarChatwoot, ESTADO);

  if (!configurado) {
    return (
      <p className="text-sm text-neutral-600">
        Preencha CHATWOOT_BASE_URL, CHATWOOT_ACCOUNT_ID e CHATWOOT_API_TOKEN no
        ambiente para habilitar a importação.
      </p>
    );
  }

  const continuando = typeof estado.proximaPagina === "number";

  return (
    <div className="flex flex-col gap-1">
      <form action={formAction}>
        <input
          type="hidden"
          name="pagina"
          value={estado.proximaPagina ?? 1}
        />
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
            {estado.criados} lead(s) criados
          </span>
          {" · "}
          {estado.atualizados} vinculados · {estado.pulados} pulados (sem
          telefone BR válido ou já importados)
          {continuando ? (
            <>
              {" — "}
              <span className="text-warning">
                parcial: clique em Continuar para a próxima leva.
              </span>
            </>
          ) : (
            " — importação concluída."
          )}
        </p>
      ) : null}
    </div>
  );
}
