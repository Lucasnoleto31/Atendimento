"use client";

import { useOptimistic, useState, useTransition } from "react";
import Link from "next/link";
import { moverLead } from "@/app/(app)/atendimento/actions";
import type { LeadCard as Lead, Stage } from "@/lib/types";
import { LeadCardItem } from "./lead-card";
import { cn } from "@/lib/utils";

export type Coluna = {
  stage: Stage;
  total: number;
  naoLidas?: number;
  leads: Lead[];
};

type Movimento = { leadId: string; stageId: string };

export function KanbanBoard({
  colunas,
  limitePorColuna,
}: {
  colunas: Coluna[];
  limitePorColuna: number;
}) {
  const [erro, setErro] = useState<string | null>(null);
  const [arrastando, setArrastando] = useState<string | null>(null);
  const [colunaAlvo, setColunaAlvo] = useState<string | null>(null);
  const [, startTransition] = useTransition();

  const [colunasVisiveis, aplicarMovimento] = useOptimistic(
    colunas,
    (estado: Coluna[], mov: Movimento) => {
      const lead = estado
        .flatMap((c) => c.leads)
        .find((l) => l.id === mov.leadId);
      if (!lead) return estado;

      return estado.map((coluna) => {
        const tinha = coluna.leads.some((l) => l.id === mov.leadId);
        const recebe = coluna.stage.id === mov.stageId;

        if (tinha && !recebe) {
          return {
            ...coluna,
            total: Math.max(0, coluna.total - 1),
            leads: coluna.leads.filter((l) => l.id !== mov.leadId),
          };
        }
        if (recebe && !tinha) {
          return {
            ...coluna,
            total: coluna.total + 1,
            leads: [
              {
                ...lead,
                stage_id: mov.stageId,
                entrou_na_etapa_em: new Date().toISOString(),
              },
              ...coluna.leads,
            ],
          };
        }
        return coluna;
      });
    },
  );

  function mover(leadId: string, stageId: string) {
    setErro(null);
    startTransition(async () => {
      aplicarMovimento({ leadId, stageId });
      const resultado = await moverLead(leadId, stageId);
      if (resultado.erro) setErro(resultado.erro);
    });
  }

  function moverPorDirecao(lead: Lead, direcao: -1 | 1) {
    const atual = colunasVisiveis.findIndex((c) => c.stage.id === lead.stage_id);
    const destino = colunasVisiveis[atual + direcao];
    if (destino) mover(lead.id, destino.stage.id);
  }

  return (
    <div className="flex min-h-0 flex-1 flex-col">
      {erro ? (
        <p
          role="alert"
          className="mx-2 mb-2 rounded-md border border-danger bg-danger-bg px-1.5 py-1 text-sm text-danger md:mx-3"
        >
          {erro}
        </p>
      ) : null}

      <div className="flex flex-1 gap-2 overflow-x-auto px-2 pb-3 md:px-3">
        {colunasVisiveis.map((coluna, indice) => (
          <section
            key={coluna.stage.id}
            aria-label={`${coluna.stage.nome}, ${coluna.total} leads`}
            onDragOver={(e) => {
              e.preventDefault();
              setColunaAlvo(coluna.stage.id);
            }}
            onDragLeave={() =>
              setColunaAlvo((c) => (c === coluna.stage.id ? null : c))
            }
            onDrop={(e) => {
              e.preventDefault();
              const leadId = e.dataTransfer.getData("text/plain");
              setColunaAlvo(null);
              setArrastando(null);
              const lead = colunasVisiveis
                .flatMap((c) => c.leads)
                .find((l) => l.id === leadId);
              if (lead && lead.stage_id !== coluna.stage.id) {
                mover(leadId, coluna.stage.id);
              }
            }}
            className={cn(
              "flex w-[280px] shrink-0 flex-col rounded-lg border bg-neutral-100 transition-colors duration-[120ms]",
              colunaAlvo === coluna.stage.id
                ? "border-primary-300 bg-primary-50"
                : "border-neutral-200",
            )}
          >
            <header className="flex items-center justify-between gap-1 border-b border-neutral-200 px-1.5 py-1">
              <h2 className="text-xs tracking-[0.06em] text-neutral-600 uppercase">
                {coluna.stage.nome}
              </h2>
              <span className="inline-flex items-center gap-0.5">
                {coluna.naoLidas ? (
                  <span
                    title={`${coluna.naoLidas} conversa(s) não lida(s)`}
                    className="inline-flex h-[20px] min-w-[20px] items-center justify-center rounded-full bg-primary-600 px-0.5 font-mono text-xs font-medium text-neutral-0 tabular-nums"
                  >
                    {coluna.naoLidas}
                  </span>
                ) : null}
                <span className="font-mono text-xs text-neutral-600 tabular-nums">
                  {coluna.total}
                </span>
              </span>
            </header>

            {coluna.leads.length === 0 ? (
              <p className="px-1.5 py-2 text-sm text-neutral-400">
                Nenhum lead nesta etapa.
              </p>
            ) : (
              <>
                <ul className="flex flex-col gap-1 overflow-y-auto p-1">
                  {coluna.leads.map((lead) => (
                    <LeadCardItem
                      key={lead.id}
                      lead={lead}
                      arrastando={arrastando === lead.id}
                      onDragStart={() => setArrastando(lead.id)}
                      onDragEnd={() => setArrastando(null)}
                      podeVoltar={indice > 0}
                      podeAvancar={indice < colunasVisiveis.length - 1}
                      rotuloAnterior={colunasVisiveis[indice - 1]?.stage.nome}
                      rotuloProxima={colunasVisiveis[indice + 1]?.stage.nome}
                      onMover={(direcao) => moverPorDirecao(lead, direcao)}
                    />
                  ))}
                </ul>
                {coluna.total > limitePorColuna ? (
                  <p className="border-t border-neutral-200 px-1.5 py-1 text-xs text-neutral-600">
                    Mostrando {Math.min(coluna.leads.length, limitePorColuna)} de{" "}
                    <span className="font-mono tabular-nums">{coluna.total}</span>{" "}
                    —{" "}
                    <Link
                      href="/leads"
                      className="text-primary-600 underline-offset-2 hover:underline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-primary-500"
                    >
                      ver todos em Leads
                    </Link>
                  </p>
                ) : null}
              </>
            )}
          </section>
        ))}
      </div>
    </div>
  );
}
