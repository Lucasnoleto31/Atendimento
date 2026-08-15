"use client";

import { useActionState, useId } from "react";
import { useFormStatus } from "react-dom";
import { Button } from "@/components/ui/button";
import type { ResultadoImport } from "./actions";

const ESTADO_INICIAL: ResultadoImport = {};

function BotaoEnviar({ rotulo }: { rotulo: string }) {
  const { pending } = useFormStatus();
  return (
    <Button type="submit" size="md" disabled={pending}>
      {pending ? "Importando…" : rotulo}
    </Button>
  );
}

export function ImportForm({
  titulo,
  descricao,
  colunas,
  acao,
  comData = false,
  rotulo,
}: {
  titulo: string;
  descricao: string;
  colunas: string;
  acao: (
    estado: ResultadoImport,
    formData: FormData,
  ) => Promise<ResultadoImport>;
  comData?: boolean;
  rotulo: string;
}) {
  const [estado, formAction] = useActionState(acao, ESTADO_INICIAL);
  const inputId = useId();
  const dataId = useId();

  return (
    <section className="rounded-lg border border-neutral-200 bg-neutral-0 p-3 shadow-sm">
      <h2 className="text-h3 text-neutral-900">{titulo}</h2>
      <p className="mt-1 text-sm text-neutral-600">{descricao}</p>
      <p className="mt-1 font-mono text-xs text-neutral-400">{colunas}</p>

      <form action={formAction} className="mt-2 flex flex-col gap-2">
        <div className="flex flex-col gap-1">
          <label
            htmlFor={inputId}
            className="text-sm font-medium text-neutral-800"
          >
            Arquivo CSV
          </label>
          <input
            id={inputId}
            name="arquivo"
            type="file"
            accept=".csv,text/csv"
            required
            className="h-[40px] w-full rounded-md border border-neutral-300 bg-neutral-0 px-1.5 py-1 text-sm text-neutral-800 file:mr-1.5 file:h-[32px] file:rounded-sm file:border-0 file:bg-neutral-100 file:px-1.5 file:text-sm file:font-medium file:text-neutral-800 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-primary-500"
          />
        </div>

        {comData ? (
          <div className="flex flex-col gap-1">
            <label
              htmlFor={dataId}
              className="text-sm font-medium text-neutral-800"
            >
              Data de referência
            </label>
            <input
              id={dataId}
              name="referencia_data"
              type="date"
              defaultValue={new Date().toISOString().slice(0, 10)}
              className="h-[40px] w-full max-w-[240px] rounded-md border border-neutral-300 bg-neutral-0 px-1.5 text-base text-neutral-800 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-primary-500"
            />
            <p className="text-xs text-neutral-600">
              Usada quando o arquivo não tem coluna de data.
            </p>
          </div>
        ) : null}

        <div>
          <BotaoEnviar rotulo={rotulo} />
        </div>
      </form>

      {estado.erro ? (
        <p
          role="alert"
          className="mt-2 rounded-md border border-danger bg-danger-bg px-1.5 py-1 text-sm text-danger"
        >
          {estado.erro}
        </p>
      ) : null}

      {estado.ok ? (
        <div
          role="status"
          className="mt-2 rounded-md border border-neutral-200 bg-neutral-50 p-2"
        >
          <p className="text-sm text-neutral-800">
            <span className="font-medium text-success">
              {estado.linhasOk} de {estado.totalLinhas}
            </span>{" "}
            linhas importadas
            {estado.linhasErro ? (
              <> · {estado.linhasErro} com problema</>
            ) : null}
          </p>

          {estado.reativacao &&
          (estado.reativacao.queda > 0 || estado.reativacao.semGiro > 0) ? (
            <p className="mt-1 text-sm text-neutral-600">
              Reativação: {estado.reativacao.queda} por queda de lotes,{" "}
              {estado.reativacao.semGiro} por falta de giro — já estão na coluna
              Novos do Atendimento.
            </p>
          ) : null}

          {estado.exemplosErro?.length ? (
            <ul className="mt-1 flex flex-col gap-0.5">
              {estado.exemplosErro.map((e) => (
                <li key={e} className="font-mono text-xs text-neutral-600">
                  {e}
                </li>
              ))}
            </ul>
          ) : null}
        </div>
      ) : null}
    </section>
  );
}
