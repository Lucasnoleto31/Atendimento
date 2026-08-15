"use client";

import { ChevronLeft, ChevronRight } from "lucide-react";
import type { LeadCard as Lead } from "@/lib/types";
import { formatarTelefone, tempoDesde } from "@/lib/format";
import { cn } from "@/lib/utils";

export function LeadCardItem({
  lead,
  podeVoltar,
  podeAvancar,
  rotuloAnterior,
  rotuloProxima,
  onMover,
  arrastando,
  onDragStart,
  onDragEnd,
}: {
  lead: Lead;
  podeVoltar: boolean;
  podeAvancar: boolean;
  rotuloAnterior?: string;
  rotuloProxima?: string;
  onMover: (direcao: -1 | 1) => void;
  arrastando: boolean;
  onDragStart: () => void;
  onDragEnd: () => void;
}) {
  const ehCliente = lead.customer_id !== null;
  const naColuna = tempoDesde(lead.entrou_na_etapa_em);

  return (
    <li
      draggable
      onDragStart={(e) => {
        e.dataTransfer.setData("text/plain", lead.id);
        e.dataTransfer.effectAllowed = "move";
        onDragStart();
      }}
      onDragEnd={onDragEnd}
      className={cn(
        "rounded-md border bg-neutral-0 p-1.5 shadow-sm transition-colors duration-[120ms]",
        arrastando
          ? "border-primary-300 opacity-60"
          : "border-neutral-200 hover:border-neutral-300",
      )}
    >
      <div className="flex items-start justify-between gap-1">
        <p className="min-w-0 truncate text-sm font-medium text-neutral-800">
          {lead.nome}
        </p>
        <span
          className={cn(
            "inline-flex h-[20px] shrink-0 items-center rounded-sm px-1 text-xs",
            ehCliente
              ? "bg-success-bg text-success"
              : "bg-neutral-100 text-neutral-600",
          )}
        >
          {ehCliente ? "Cliente" : "Não cliente"}
        </span>
      </div>

      {lead.telefone_e164 ? (
        <p className="mt-0.5 font-mono text-xs text-neutral-600 tabular-nums">
          {formatarTelefone(lead.telefone_e164)}
        </p>
      ) : (
        <p className="mt-0.5 text-xs text-neutral-400">sem telefone na base</p>
      )}

      <p className="mt-1 truncate text-xs text-neutral-600">
        {lead.canal ?? "Sem canal"}
        {lead.campanha ? ` · ${lead.campanha}` : ""}
      </p>

      <div className="mt-1 flex items-center justify-between gap-1">
        <span className="truncate text-xs text-neutral-400">
          {naColuna ? `nesta etapa ${naColuna}` : ""}
          {lead.primeira_resposta_em === null ? " · nunca respondeu" : ""}
        </span>

        <span className="flex shrink-0 items-center gap-0.5">
          <button
            type="button"
            disabled={!podeVoltar}
            onClick={() => onMover(-1)}
            aria-label={
              rotuloAnterior
                ? `Mover ${lead.nome} para ${rotuloAnterior}`
                : "Sem etapa anterior"
            }
            className="inline-flex h-[40px] w-[40px] items-center justify-center rounded-md text-neutral-600 transition-colors duration-[120ms] hover:bg-neutral-100 hover:text-neutral-800 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-primary-500 disabled:cursor-not-allowed disabled:text-neutral-300 disabled:hover:bg-transparent"
          >
            <ChevronLeft size={18} strokeWidth={1.5} aria-hidden />
          </button>
          <button
            type="button"
            disabled={!podeAvancar}
            onClick={() => onMover(1)}
            aria-label={
              rotuloProxima
                ? `Mover ${lead.nome} para ${rotuloProxima}`
                : "Sem próxima etapa"
            }
            className="inline-flex h-[40px] w-[40px] items-center justify-center rounded-md text-neutral-600 transition-colors duration-[120ms] hover:bg-neutral-100 hover:text-neutral-800 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-primary-500 disabled:cursor-not-allowed disabled:text-neutral-300 disabled:hover:bg-transparent"
          >
            <ChevronRight size={18} strokeWidth={1.5} aria-hidden />
          </button>
        </span>
      </div>
    </li>
  );
}
