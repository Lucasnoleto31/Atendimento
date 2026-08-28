"use client";

import Link from "next/link";
import { ChevronLeft, ChevronRight, MessageSquare } from "lucide-react";
import type { LeadCard as Lead } from "@/lib/types";
import { formatarTelefone, tempoDesde } from "@/lib/format";
import { estiloEtiqueta } from "@/lib/etiquetas";
import { cn } from "@/lib/utils";
import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { criarTarefaRapida } from "@/app/(app)/atendimento/actions";

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
  const etiquetas = lead.etiquetas ?? [];

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
        // A primeira etiqueta pinta a lateral do cartão.
        etiquetas.length > 0
          ? cn("border-l-4", estiloEtiqueta(etiquetas[0].cor).faixaLateral)
          : "",
      )}
    >
      <div className="flex items-start justify-between gap-1">
        <Link
          href={`/leads/${lead.id}`}
          className="min-w-0 truncate rounded-sm text-sm font-medium text-neutral-800 underline-offset-2 hover:text-primary-600 hover:underline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-primary-500"
        >
          {lead.nome}
        </Link>
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

      {etiquetas.length > 0 ? (
        <div className="mt-1 flex flex-wrap items-center gap-0.5">
          {etiquetas.slice(0, 3).map((etiqueta) => (
            <span
              key={etiqueta.id}
              className={cn(
                "inline-flex h-[20px] items-center rounded-sm px-1 text-xs font-medium",
                estiloEtiqueta(etiqueta.cor).chip,
              )}
            >
              {etiqueta.nome}
            </span>
          ))}
          {etiquetas.length > 3 ? (
            <span className="text-xs text-neutral-400">
              +{etiquetas.length - 3}
            </span>
          ) : null}
        </div>
      ) : null}

      <ProximaAcao lead={lead} />

      <div className="mt-1 flex items-center justify-between gap-1">
        <span
          className={cn(
            "truncate text-xs",
            lead.semaforo === "vermelho"
              ? "font-medium text-danger"
              : lead.semaforo === "laranja"
                ? "font-medium text-warning"
                : "text-neutral-400",
          )}
          title={
            lead.semaforo === "vermelho"
              ? "Estourou o dobro do prazo desta etapa"
              : lead.semaforo === "laranja"
                ? "Estourou o prazo desta etapa"
                : undefined
          }
        >
          {lead.naoLida ? "● " : ""}
          {naColuna ? `nesta etapa ${naColuna}` : ""}
          {lead.primeira_resposta_em === null ? " · nunca respondeu" : ""}
        </span>

        <span className="flex shrink-0 items-center gap-0.5">
          <Link
            href={`/chat?lead=${lead.id}`}
            aria-label={`Abrir conversa com ${lead.nome} no chat`}
            title="Abrir no chat"
            className="inline-flex h-[40px] w-[40px] items-center justify-center rounded-md text-neutral-600 transition-colors duration-[120ms] hover:bg-neutral-100 hover:text-primary-600 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-primary-500"
          >
            <MessageSquare size={18} strokeWidth={1.5} aria-hidden />
          </Link>
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


/**
 * "Próx: amanhã 10h" (ou a falta dela) — e o atalho de criar tarefa sem
 * sair do kanban: clicar abre título + prazo, salvar recarrega o quadro.
 */
function ProximaAcao({ lead }: { lead: Lead }) {
  const [aberto, setAberto] = useState(false);
  const [titulo, setTitulo] = useState("");
  const [prazo, setPrazo] = useState("amanha10");
  const [erro, setErro] = useState<string | null>(null);
  const [pendente, iniciar] = useTransition();
  const router = useRouter();

  const opcoes: { chave: string; rotulo: string; quando: () => Date }[] = [
    {
      chave: "hoje18",
      rotulo: "hoje 18h",
      quando: () => {
        const d = new Date();
        d.setHours(18, 0, 0, 0);
        return d;
      },
    },
    {
      chave: "amanha10",
      rotulo: "amanhã 10h",
      quando: () => {
        const d = new Date();
        d.setDate(d.getDate() + 1);
        d.setHours(10, 0, 0, 0);
        return d;
      },
    },
    {
      chave: "tresdias",
      rotulo: "em 3 dias",
      quando: () => {
        const d = new Date();
        d.setDate(d.getDate() + 3);
        d.setHours(10, 0, 0, 0);
        return d;
      },
    },
  ];

  const salvar = () => {
    const escolha = opcoes.find((o) => o.chave === prazo) ?? opcoes[1];
    setErro(null);
    iniciar(async () => {
      const r = await criarTarefaRapida(
        lead.id,
        titulo,
        escolha.quando().toISOString(),
      );
      if (r.erro) setErro(r.erro);
      else {
        setAberto(false);
        setTitulo("");
        router.refresh();
      }
    });
  };

  if (!aberto) {
    return (
      <button
        type="button"
        onClick={() => setAberto(true)}
        className="mt-1 block w-full truncate rounded-sm text-left text-xs underline-offset-2 hover:underline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-primary-500"
        title="Criar tarefa rápida"
      >
        {lead.proximaAcao ? (
          <span
            className={cn(
              lead.proximaAcao.vencida
                ? "font-medium text-danger"
                : "text-neutral-600",
            )}
          >
            Próx: {lead.proximaAcao.titulo} · {lead.proximaAcao.quando}
            {lead.proximaAcao.vencida ? " · vencida" : ""}
          </span>
        ) : (
          <span className="text-neutral-400">sem próxima ação — criar</span>
        )}
      </button>
    );
  }

  return (
    <div className="mt-1 flex flex-col gap-0.5 rounded-md border border-neutral-200 bg-neutral-50 p-1">
      <input
        autoFocus
        value={titulo}
        onChange={(e) => setTitulo(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === "Enter") salvar();
          if (e.key === "Escape") setAberto(false);
        }}
        placeholder="O que fazer? (Enter salva)"
        className="h-[32px] rounded-md border border-neutral-300 bg-neutral-0 px-1 text-xs text-neutral-800 placeholder:text-neutral-400 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-primary-500"
      />
      <div className="flex flex-wrap items-center gap-0.5">
        {opcoes.map((o) => (
          <button
            key={o.chave}
            type="button"
            onClick={() => setPrazo(o.chave)}
            className={cn(
              "inline-flex h-[20px] items-center rounded-sm px-1 text-xs",
              prazo === o.chave
                ? "bg-primary-50 font-medium text-primary-900"
                : "text-neutral-600 hover:bg-neutral-100",
            )}
          >
            {o.rotulo}
          </button>
        ))}
        <button
          type="button"
          disabled={pendente || titulo.trim() === ""}
          onClick={salvar}
          className="ml-auto inline-flex h-[20px] items-center rounded-sm bg-primary-600 px-1 text-xs font-medium text-neutral-0 disabled:opacity-50"
        >
          {pendente ? "…" : "Criar"}
        </button>
        <button
          type="button"
          onClick={() => setAberto(false)}
          className="inline-flex h-[20px] items-center rounded-sm px-1 text-xs text-neutral-600 hover:bg-neutral-100"
        >
          Cancelar
        </button>
      </div>
      {erro ? <p className="text-xs text-danger">{erro}</p> : null}
    </div>
  );
}
