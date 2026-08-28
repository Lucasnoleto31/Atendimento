"use client";

import { useOptimistic, useState, useTransition } from "react";
import Link from "next/link";
import { marcarPerdido, moverLead } from "@/app/(app)/atendimento/actions";
import { MOTIVOS_PERDA, type MotivoPerda } from "@/lib/perda";
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
  // Perder exige motivo: a soltura na coluna final abre este diálogo e o
  // movimento só acontece na confirmação.
  const [perda, setPerda] = useState<{
    leadId: string;
    nome: string;
    stageId: string;
  } | null>(null);
  const [motivo, setMotivo] = useState<MotivoPerda>("sumiu");
  const [detalhe, setDetalhe] = useState("");
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
    const destino = colunasVisiveis.find((c) => c.stage.id === stageId);
    if (destino?.stage.is_final) {
      const lead = colunasVisiveis
        .flatMap((c) => c.leads)
        .find((l) => l.id === leadId);
      setMotivo("sumiu");
      setDetalhe("");
      setPerda({ leadId, nome: lead?.nome ?? "este lead", stageId });
      return;
    }
    setErro(null);
    startTransition(async () => {
      aplicarMovimento({ leadId, stageId });
      const resultado = await moverLead(leadId, stageId);
      if (resultado.erro) setErro(resultado.erro);
    });
  }

  function confirmarPerda() {
    if (!perda) return;
    const { leadId, stageId } = perda;
    const detalheAtual = detalhe;
    const motivoAtual = motivo;
    setPerda(null);
    setErro(null);
    startTransition(async () => {
      aplicarMovimento({ leadId, stageId });
      const resultado = await marcarPerdido(
        leadId,
        stageId,
        motivoAtual,
        detalheAtual,
      );
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

      {perda ? (
        <div
          role="dialog"
          aria-modal="true"
          aria-labelledby="perda-titulo"
          className="fixed inset-0 z-50 flex items-center justify-center bg-neutral-900/40 p-2"
          onClick={(e) => {
            if (e.target === e.currentTarget) setPerda(null);
          }}
        >
          <div className="w-full max-w-[420px] rounded-lg border border-neutral-200 bg-neutral-0 p-3 shadow-lg">
            <h2 id="perda-titulo" className="text-h3 text-neutral-900">
              Por que perdemos {perda.nome}?
            </h2>
            <p className="mt-1 text-sm text-neutral-600">
              O motivo alimenta o relatório de perdas — é ele que separa
              concorrente, lead que sumiu e quem nunca quis abrir conta.
            </p>

            <fieldset className="mt-2 flex flex-col gap-0.5">
              <legend className="sr-only">Motivo da perda</legend>
              {(
                Object.entries(MOTIVOS_PERDA) as [MotivoPerda, string][]
              ).map(([valor, rotulo]) => (
                <label
                  key={valor}
                  className="flex min-h-[36px] cursor-pointer items-center gap-1 rounded-md px-1 text-sm text-neutral-800 hover:bg-neutral-100"
                >
                  <input
                    type="radio"
                    name="motivo-perda"
                    value={valor}
                    checked={motivo === valor}
                    onChange={() => setMotivo(valor)}
                    className="h-[16px] w-[16px] accent-primary-600"
                  />
                  {rotulo}
                </label>
              ))}
            </fieldset>

            <label className="mt-2 block">
              <span className="text-sm font-medium text-neutral-800">
                Detalhe <span className="font-normal text-neutral-400">(opcional)</span>
              </span>
              <input
                type="text"
                value={detalhe}
                onChange={(e) => setDetalhe(e.target.value)}
                maxLength={280}
                placeholder="Ex.: foi para a XP com o primo"
                className="mt-0.5 h-[40px] w-full rounded-md border border-neutral-300 bg-neutral-0 px-1.5 text-sm text-neutral-800 placeholder:text-neutral-400 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-primary-500"
              />
            </label>

            <div className="mt-2 flex justify-end gap-1">
              <button
                type="button"
                onClick={() => setPerda(null)}
                className="inline-flex h-[40px] items-center rounded-md border border-neutral-300 bg-neutral-0 px-2 text-sm font-medium text-neutral-800 transition-colors duration-[120ms] hover:bg-neutral-100 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-primary-500"
              >
                Cancelar
              </button>
              <button
                type="button"
                onClick={confirmarPerda}
                className="inline-flex h-[40px] items-center rounded-md bg-danger px-2 text-sm font-medium text-neutral-0 transition-colors duration-[120ms] hover:brightness-95 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-primary-500"
              >
                Marcar como perdido
              </button>
            </div>
          </div>
        </div>
      ) : null}
    </div>
  );
}
