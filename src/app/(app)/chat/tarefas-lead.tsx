"use client";

import { useActionState, useState, useTransition } from "react";
import { useFormStatus } from "react-dom";
import { Check, Plus } from "lucide-react";
import { cn } from "@/lib/utils";
import {
  concluirTarefaLead,
  criarTarefaLead,
  type ResultadoEnvio,
} from "./actions";

const ESTADO: ResultadoEnvio = {};

export type TarefaLead = {
  id: string;
  titulo: string;
  vence_em: string;
  vencida: boolean;
};

function BotaoCriar() {
  const { pending } = useFormStatus();
  return (
    <button
      type="submit"
      disabled={pending}
      aria-label="Criar tarefa"
      className="inline-flex h-[32px] w-[32px] shrink-0 items-center justify-center rounded-md border border-neutral-300 bg-neutral-0 text-neutral-600 transition-colors duration-[120ms] hover:bg-neutral-100 hover:text-neutral-800 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-primary-500 disabled:cursor-not-allowed disabled:opacity-60"
    >
      <Plus size={16} strokeWidth={1.5} aria-hidden />
    </button>
  );
}

/** Lembretes do lead: "ligar amanhã às 10h" sem depender de memória. */
export function TarefasLead({
  leadId,
  tarefas,
  disponivel,
}: {
  leadId: string;
  tarefas: TarefaLead[];
  disponivel: boolean;
}) {
  const [estado, formAction] = useActionState(criarTarefaLead, ESTADO);
  const [titulo, setTitulo] = useState("");
  const [venceLocal, setVenceLocal] = useState("");
  const [pendente, iniciar] = useTransition();
  const [erroConcluir, setErroConcluir] = useState<string | null>(null);

  // Limpa o formulário após criar (ajuste durante o render).
  const [estadoAnterior, setEstadoAnterior] = useState(estado);
  if (estado !== estadoAnterior) {
    setEstadoAnterior(estado);
    if (estado.ok) {
      setTitulo("");
      setVenceLocal("");
    }
  }

  if (!disponivel) {
    return (
      <p className="mt-0.5 text-sm text-neutral-600">
        Habilite rodando a migração 0013 no SQL Editor do Supabase.
      </p>
    );
  }

  const dataCurta = (iso: string) =>
    new Date(iso).toLocaleString("pt-BR", {
      day: "2-digit",
      month: "2-digit",
      hour: "2-digit",
      minute: "2-digit",
    });

  const concluir = (tarefaId: string) => {
    setErroConcluir(null);
    iniciar(async () => {
      const resultado = await concluirTarefaLead(tarefaId, leadId);
      if (resultado.erro) setErroConcluir(resultado.erro);
    });
  };

  return (
    <div className="mt-0.5 flex flex-col gap-0.5">
      {tarefas.length === 0 ? (
        <p className="text-sm text-neutral-600">Nenhuma tarefa pendente.</p>
      ) : (
        <ul className="flex flex-col gap-0.5">
          {tarefas.map((tarefa) => (
            <li key={tarefa.id} className="flex items-start gap-0.5">
              <button
                type="button"
                aria-label={`Concluir tarefa: ${tarefa.titulo}`}
                disabled={pendente}
                onClick={() => concluir(tarefa.id)}
                className="mt-0.5 inline-flex h-[20px] w-[20px] shrink-0 items-center justify-center rounded-sm border border-neutral-300 text-neutral-0 transition-colors duration-[120ms] hover:border-success hover:bg-success-bg hover:text-success focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-primary-500 disabled:cursor-not-allowed"
              >
                <Check size={12} strokeWidth={2} aria-hidden />
              </button>
              <span className="min-w-0">
                <span className="block text-sm text-neutral-800">
                  {tarefa.titulo}
                </span>
                <span
                  className={cn(
                    "block font-mono text-xs tabular-nums",
                    tarefa.vencida
                      ? "font-medium text-danger"
                      : "text-neutral-600",
                  )}
                >
                  {tarefa.vencida ? "venceu " : ""}
                  {dataCurta(tarefa.vence_em)}
                </span>
              </span>
            </li>
          ))}
        </ul>
      )}

      <form action={formAction} className="mt-0.5 flex flex-col gap-0.5">
        <input type="hidden" name="lead_id" value={leadId} />
        <input
          type="hidden"
          name="vence_iso"
          value={venceLocal ? new Date(venceLocal).toISOString() : ""}
        />
        <label htmlFor="tarefa-titulo" className="sr-only">
          Nova tarefa
        </label>
        <input
          id="tarefa-titulo"
          name="titulo"
          value={titulo}
          onChange={(e) => setTitulo(e.target.value)}
          placeholder="Ligar de novo, cobrar doc…"
          className="h-[32px] rounded-md border border-neutral-300 bg-neutral-0 px-1 text-sm text-neutral-800 placeholder:text-neutral-400 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-primary-500"
        />
        <div className="flex gap-0.5">
          <label htmlFor="tarefa-vence" className="sr-only">
            Vencimento
          </label>
          <input
            id="tarefa-vence"
            type="datetime-local"
            required
            value={venceLocal}
            onChange={(e) => setVenceLocal(e.target.value)}
            className="h-[32px] min-w-0 flex-1 rounded-md border border-neutral-300 bg-neutral-0 px-1 font-mono text-xs text-neutral-800 tabular-nums focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-primary-500"
          />
          <BotaoCriar />
        </div>
      </form>

      {estado.erro ? (
        <p role="alert" className="text-xs text-danger">
          {estado.erro}
        </p>
      ) : null}
      {erroConcluir ? (
        <p role="alert" className="text-xs text-danger">
          {erroConcluir}
        </p>
      ) : null}
    </div>
  );
}
