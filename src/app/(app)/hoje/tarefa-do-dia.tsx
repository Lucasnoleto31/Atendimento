"use client";

import { useState, useTransition } from "react";
import Link from "next/link";
import { Check } from "lucide-react";
import { cn } from "@/lib/utils";
import { concluirTarefaHoje } from "./actions";

export type TarefaDia = {
  id: string;
  titulo: string;
  /** Hora se vence hoje, data curta se venceu em outro dia — vem pronto do servidor. */
  quandoRotulo: string;
  vencida: boolean;
  leadId: string;
  leadNome: string;
};

/**
 * Uma linha da fila de tarefas: concluir sem sair da tela, ou abrir a ficha
 * do lead para retomar o que foi combinado.
 */
export function TarefaDoDia({ tarefa }: { tarefa: TarefaDia }) {
  const [pendente, iniciar] = useTransition();
  const [erro, setErro] = useState<string | null>(null);

  const concluir = () => {
    setErro(null);
    iniciar(async () => {
      const resultado = await concluirTarefaHoje(tarefa.id, tarefa.leadId);
      if (resultado.erro) setErro(resultado.erro);
    });
  };

  return (
    <li
      className={cn(
        "flex items-start gap-1 rounded-md border px-1.5 py-1 transition-colors duration-[120ms]",
        tarefa.vencida
          ? "border-danger bg-danger-bg"
          : "border-neutral-200 bg-neutral-0 hover:border-neutral-300",
      )}
    >
      <button
        type="button"
        aria-label={`Concluir: ${tarefa.titulo}`}
        disabled={pendente}
        onClick={concluir}
        className="mt-0.5 inline-flex h-[24px] w-[24px] shrink-0 items-center justify-center rounded-sm border border-neutral-300 bg-neutral-0 text-neutral-0 transition-colors duration-[120ms] hover:border-success hover:bg-success-bg hover:text-success focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-primary-500 disabled:cursor-not-allowed"
      >
        <Check size={14} strokeWidth={2} aria-hidden />
      </button>

      <span className="min-w-0 flex-1">
        <span className="flex flex-wrap items-baseline gap-1">
          <span
            className={cn(
              "font-mono text-xs tabular-nums",
              tarefa.vencida ? "font-medium text-danger" : "text-neutral-600",
            )}
          >
            {tarefa.quandoRotulo}
          </span>
          <span className="text-sm text-neutral-800">{tarefa.titulo}</span>
          {tarefa.vencida ? (
            <span className="inline-flex h-[20px] items-center rounded-sm bg-danger-bg px-1 text-xs font-medium text-danger">
              vencida
            </span>
          ) : null}
        </span>
        <Link
          href={`/leads/${tarefa.leadId}`}
          className="mt-0.5 inline-block max-w-full truncate rounded-sm text-xs font-medium text-neutral-800 underline-offset-2 hover:text-primary-600 hover:underline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-primary-500"
        >
          {tarefa.leadNome}
        </Link>
        {erro ? (
          <span role="alert" className="mt-0.5 block text-xs text-danger">
            {erro}
          </span>
        ) : null}
      </span>
    </li>
  );
}
