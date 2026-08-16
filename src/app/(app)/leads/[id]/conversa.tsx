"use client";

import { useActionState, useEffect, useRef, useState } from "react";
import { useFormStatus } from "react-dom";
import { useRouter } from "next/navigation";
import { RefreshCw, Send } from "lucide-react";
import { CAMPO } from "@/components/app/form-styles";
import { cn } from "@/lib/utils";
import { enviarMensagemLead, type ResultadoEnvio } from "./conversa-actions";

const ESTADO: ResultadoEnvio = {};
const INTERVALO_ATUALIZACAO = 15_000;

export type Mensagem = {
  id: string;
  tipo: "mensagem_recebida" | "mensagem_enviada";
  conteudo: string | null;
  criado_em: string;
  autor: string | null;
};

export type MensagemPadrao = { id: string; titulo: string; corpo: string };

function BotaoEnviar() {
  const { pending } = useFormStatus();
  return (
    <button
      type="submit"
      disabled={pending}
      aria-label="Enviar mensagem"
      className="inline-flex h-[40px] items-center gap-0.5 rounded-md bg-primary-600 px-2 text-sm font-medium text-neutral-0 transition-colors duration-[120ms] hover:bg-primary-700 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-primary-500 disabled:cursor-not-allowed disabled:opacity-60"
    >
      <Send size={16} strokeWidth={1.5} aria-hidden />
      {pending ? "Enviando…" : "Enviar"}
    </button>
  );
}

export function Conversa({
  leadId,
  temConversa,
  mensagens,
  mensagensPadrao,
}: {
  leadId: string;
  temConversa: boolean;
  mensagens: Mensagem[];
  mensagensPadrao: MensagemPadrao[];
}) {
  const [estado, formAction] = useActionState(enviarMensagemLead, ESTADO);
  const [texto, setTexto] = useState("");
  const caixaRef = useRef<HTMLDivElement>(null);
  const formRef = useRef<HTMLFormElement>(null);
  const router = useRouter();

  // Rola para a última mensagem quando o histórico muda.
  useEffect(() => {
    const caixa = caixaRef.current;
    if (caixa) caixa.scrollTop = caixa.scrollHeight;
  }, [mensagens.length]);

  // Busca mensagens novas de tempos em tempos, só com a aba visível.
  useEffect(() => {
    const intervalo = setInterval(() => {
      if (document.visibilityState === "visible") router.refresh();
    }, INTERVALO_ATUALIZACAO);
    return () => clearInterval(intervalo);
  }, [router]);

  // Limpa o campo após envio bem-sucedido (ajuste durante o render,
  // padrão recomendado no lugar de setState em effect).
  const [estadoAnterior, setEstadoAnterior] = useState(estado);
  if (estado !== estadoAnterior) {
    setEstadoAnterior(estado);
    if (estado.ok) setTexto("");
  }

  const horario = (iso: string) =>
    new Date(iso).toLocaleString("pt-BR", {
      day: "2-digit",
      month: "2-digit",
      hour: "2-digit",
      minute: "2-digit",
    });

  return (
    <div className="flex flex-col">
      <div
        ref={caixaRef}
        className="flex max-h-[400px] min-h-[160px] flex-col gap-1 overflow-y-auto rounded-md border border-neutral-200 bg-neutral-50 p-2"
        aria-label="Histórico da conversa"
      >
        {mensagens.length === 0 ? (
          <p className="text-sm text-neutral-600">
            Nenhuma mensagem no histórico ainda.
          </p>
        ) : (
          mensagens.map((mensagem) => {
            const enviada = mensagem.tipo === "mensagem_enviada";
            return (
              <div
                key={mensagem.id}
                className={cn(
                  "max-w-[85%] rounded-md px-1.5 py-1",
                  enviada
                    ? "self-end border border-primary-100 bg-primary-50"
                    : "self-start border border-neutral-200 bg-neutral-0",
                )}
              >
                <p className="text-sm break-words whitespace-pre-wrap text-neutral-800">
                  {mensagem.conteudo}
                </p>
                <p className="mt-0.5 text-right font-mono text-xs text-neutral-400 tabular-nums">
                  {enviada && mensagem.autor ? `${mensagem.autor} · ` : ""}
                  {horario(mensagem.criado_em)}
                </p>
              </div>
            );
          })
        )}
      </div>

      <div className="mt-1 flex items-center justify-between gap-1">
        <p className="text-xs text-neutral-400">
          Atualiza sozinho a cada 15 segundos.
        </p>
        <button
          type="button"
          onClick={() => router.refresh()}
          aria-label="Atualizar conversa agora"
          className="inline-flex h-[32px] w-[32px] items-center justify-center rounded-md text-neutral-400 transition-colors duration-[120ms] hover:bg-neutral-100 hover:text-neutral-800 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-primary-500"
        >
          <RefreshCw size={16} strokeWidth={1.5} aria-hidden />
        </button>
      </div>

      {temConversa ? (
        <form ref={formRef} action={formAction} className="mt-1 flex flex-col gap-1">
          <input type="hidden" name="lead_id" value={leadId} />

          {mensagensPadrao.length > 0 ? (
            <div className="flex items-center gap-1">
              <label htmlFor="mensagem-padrao" className="sr-only">
                Inserir mensagem padrão
              </label>
              <select
                id="mensagem-padrao"
                defaultValue=""
                onChange={(e) => {
                  const padrao = mensagensPadrao.find(
                    (m) => m.id === e.target.value,
                  );
                  if (padrao) setTexto(padrao.corpo);
                  e.target.value = "";
                }}
                className={cn(CAMPO, "max-w-[280px] flex-1")}
              >
                <option value="" disabled>
                  Inserir mensagem padrão…
                </option>
                {mensagensPadrao.map((m) => (
                  <option key={m.id} value={m.id}>
                    {m.titulo}
                  </option>
                ))}
              </select>
            </div>
          ) : null}

          <div className="flex items-end gap-1">
            <label htmlFor="texto-mensagem" className="sr-only">
              Mensagem para o lead
            </label>
            <textarea
              id="texto-mensagem"
              name="texto"
              required
              rows={2}
              value={texto}
              onChange={(e) => setTexto(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Enter" && !e.shiftKey) {
                  e.preventDefault();
                  formRef.current?.requestSubmit();
                }
              }}
              placeholder="Escreva a mensagem… (Enter envia, Shift+Enter quebra linha)"
              className="min-h-[56px] flex-1 rounded-md border border-neutral-300 bg-neutral-0 px-1.5 py-1 text-sm text-neutral-800 placeholder:text-neutral-400 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-primary-500"
            />
            <BotaoEnviar />
          </div>

          {estado.erro ? (
            <p role="alert" className="text-sm text-danger">
              {estado.erro}
            </p>
          ) : null}
        </form>
      ) : (
        <p className="mt-1 rounded-md border border-neutral-200 bg-neutral-50 px-1.5 py-1 text-sm text-neutral-600">
          Sem conversa vinculada no Chatwoot — o envio libera quando o lead
          mandar a primeira mensagem no WhatsApp.
        </p>
      )}
    </div>
  );
}
