"use client";

import { useOptimistic, useState, useTransition } from "react";
import { moverLead } from "@/app/(app)/atendimento/actions";
import type { LeadCard as Lead, Stage } from "@/lib/types";
import { LeadCardItem } from "./lead-card";
import { cn } from "@/lib/utils";

type Movimento = { leadId: string; stageId: string };

export function KanbanBoard({
  stages,
  leads,
}: {
  stages: Stage[];
  leads: Lead[];
}) {
  const [erro, setErro] = useState<string | null>(null);
  const [arrastando, setArrastando] = useState<string | null>(null);
  const [colunaAlvo, setColunaAlvo] = useState<string | null>(null);
  const [, startTransition] = useTransition();

  const [leadsVisiveis, aplicarMovimento] = useOptimistic(
    leads,
    (estado: Lead[], mov: Movimento) =>
      estado.map((l) =>
        l.id === mov.leadId
          ? { ...l, stage_id: mov.stageId, entrou_na_etapa_em: new Date().toISOString() }
          : l,
      ),
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
    const atual = stages.findIndex((s) => s.id === lead.stage_id);
    const destino = stages[atual + direcao];
    if (destino) mover(lead.id, destino.id);
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
        {stages.map((stage) => {
          const daColuna = leadsVisiveis.filter((l) => l.stage_id === stage.id);
          const indice = stages.findIndex((s) => s.id === stage.id);

          return (
            <section
              key={stage.id}
              aria-label={`${stage.nome}, ${daColuna.length} leads`}
              onDragOver={(e) => {
                e.preventDefault();
                setColunaAlvo(stage.id);
              }}
              onDragLeave={() => setColunaAlvo((c) => (c === stage.id ? null : c))}
              onDrop={(e) => {
                e.preventDefault();
                const leadId = e.dataTransfer.getData("text/plain");
                setColunaAlvo(null);
                setArrastando(null);
                const lead = leadsVisiveis.find((l) => l.id === leadId);
                if (lead && lead.stage_id !== stage.id) mover(leadId, stage.id);
              }}
              className={cn(
                "flex w-[280px] shrink-0 flex-col rounded-lg border bg-neutral-100 transition-colors duration-[120ms]",
                colunaAlvo === stage.id
                  ? "border-primary-300 bg-primary-50"
                  : "border-neutral-200",
              )}
            >
              <header className="flex items-center justify-between gap-1 border-b border-neutral-200 px-1.5 py-1">
                <h2 className="text-xs tracking-[0.06em] text-neutral-600 uppercase">
                  {stage.nome}
                </h2>
                <span className="font-mono text-xs text-neutral-600 tabular-nums">
                  {daColuna.length}
                </span>
              </header>

              {daColuna.length === 0 ? (
                <p className="px-1.5 py-2 text-sm text-neutral-400">
                  Nenhum lead nesta etapa.
                </p>
              ) : (
                <ul className="flex flex-col gap-1 p-1">
                  {daColuna.map((lead) => (
                    <LeadCardItem
                      key={lead.id}
                      lead={lead}
                      arrastando={arrastando === lead.id}
                      onDragStart={() => setArrastando(lead.id)}
                      onDragEnd={() => setArrastando(null)}
                      podeVoltar={indice > 0}
                      podeAvancar={indice < stages.length - 1}
                      rotuloAnterior={stages[indice - 1]?.nome}
                      rotuloProxima={stages[indice + 1]?.nome}
                      onMover={(direcao) => moverPorDirecao(lead, direcao)}
                    />
                  ))}
                </ul>
              )}
            </section>
          );
        })}
      </div>
    </div>
  );
}
