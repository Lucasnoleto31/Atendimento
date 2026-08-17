"use client";

import { useState, useTransition } from "react";
import Link from "next/link";
import { Check, MessageSquare } from "lucide-react";
import { cn } from "@/lib/utils";
import { concluirTarefaLead } from "../chat/actions";

export type ItemAgenda = {
  id: string;
  titulo: string;
  quando: string;
  leadId: string;
  leadNome: string;
  responsavelNome: string | null;
  concluida: boolean;
  atrasada: boolean;
};

/**
 * Uma linha da agenda: concluir sem sair da tela, ou abrir a conversa com o
 * cliente — que é o motivo de a pessoa estar olhando a agenda.
 */
export function TarefaItem({ item }: { item: ItemAgenda }) {
  const [pendente, iniciar] = useTransition();
  const [erro, setErro] = useState<string | null>(null);

  const concluir = () => {
    setErro(null);
    iniciar(async () => {
      const resultado = await concluirTarefaLead(item.id, item.leadId);
      if (resultado.erro) setErro(resultado.erro);
    });
  };

  const hora = new Date(item.quando).toLocaleTimeString("pt-BR", {
    hour: "2-digit",
    minute: "2-digit",
  });

  return (
    <li
      className={cn(
        "flex items-start gap-1 rounded-md border px-1.5 py-1 transition-colors duration-[120ms]",
        item.concluida
          ? "border-neutral-200 bg-neutral-50 opacity-70"
          : item.atrasada
            ? "border-danger bg-danger-bg"
            : "border-neutral-200 bg-neutral-0 hover:border-neutral-300",
      )}
    >
      <button
        type="button"
        aria-label={
          item.concluida ? "Tarefa concluída" : `Concluir: ${item.titulo}`
        }
        disabled={pendente || item.concluida}
        onClick={concluir}
        className={cn(
          "mt-0.5 inline-flex h-[24px] w-[24px] shrink-0 items-center justify-center rounded-sm border transition-colors duration-[120ms] focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-primary-500 disabled:cursor-not-allowed",
          item.concluida
            ? "border-success bg-success-bg text-success"
            : "border-neutral-300 text-neutral-0 hover:border-success hover:bg-success-bg hover:text-success",
        )}
      >
        <Check size={14} strokeWidth={2} aria-hidden />
      </button>

      <span className="min-w-0 flex-1">
        <span className="flex flex-wrap items-baseline gap-1">
          <span
            className={cn(
              "font-mono text-xs tabular-nums",
              item.atrasada && !item.concluida
                ? "font-medium text-danger"
                : "text-neutral-600",
            )}
          >
            {hora}
          </span>
          <span
            className={cn(
              "text-sm text-neutral-800",
              item.concluida ? "line-through" : "",
            )}
          >
            {item.titulo}
          </span>
        </span>
        <span className="mt-0.5 flex flex-wrap items-center gap-1">
          <span className="text-xs font-medium text-neutral-800">
            {item.leadNome}
          </span>
          {item.responsavelNome ? (
            <span className="text-xs text-neutral-400">
              · {item.responsavelNome}
            </span>
          ) : null}
          {item.atrasada && !item.concluida ? (
            <span className="inline-flex h-[20px] items-center rounded-sm bg-danger-bg px-1 text-xs font-medium text-danger">
              atrasada
            </span>
          ) : null}
        </span>
        {erro ? (
          <span role="alert" className="mt-0.5 block text-xs text-danger">
            {erro}
          </span>
        ) : null}
      </span>

      <Link
        href={`/chat?lead=${item.leadId}`}
        aria-label={`Abrir conversa com ${item.leadNome}`}
        title="Abrir no chat"
        className="inline-flex h-[40px] w-[40px] shrink-0 items-center justify-center rounded-md text-neutral-600 transition-colors duration-[120ms] hover:bg-neutral-100 hover:text-primary-600 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-primary-500"
      >
        <MessageSquare size={18} strokeWidth={1.5} aria-hidden />
      </Link>
    </li>
  );
}
