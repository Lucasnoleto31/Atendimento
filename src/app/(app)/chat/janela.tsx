"use client";

import { useActionState, useEffect, useRef, useState } from "react";
import { useFormStatus } from "react-dom";
import { useRouter } from "next/navigation";
import { Send } from "lucide-react";
import { CAMPO } from "@/components/app/form-styles";
import { cn } from "@/lib/utils";
import { enviarMensagemLead, type ResultadoEnvio } from "./actions";

const ESTADO: ResultadoEnvio = {};
const INTERVALO_ATUALIZACAO = 5_000;

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
      className="inline-flex h-[40px] shrink-0 items-center gap-0.5 rounded-md bg-primary-600 px-2 text-sm font-medium text-neutral-0 transition-colors duration-[120ms] hover:bg-primary-700 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-primary-500 disabled:cursor-not-allowed disabled:opacity-60"
    >
      <Send size={16} strokeWidth={1.5} aria-hidden />
      {pending ? "…" : "Enviar"}
    </button>
  );
}

export function Janela({
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

  // Rola para a última mensagem quando o histórico cresce.
  const totalRef = useRef(mensagens.length);
  useEffect(() => {
    const caixa = caixaRef.current;
    if (caixa && mensagens.length !== totalRef.current) {
      totalRef.current = mensagens.length;
      caixa.scrollTop = caixa.scrollHeight;
    }
  }, [mensagens.length]);

  useEffect(() => {
    const caixa = caixaRef.current;
    if (caixa) caixa.scrollTop = caixa.scrollHeight;
    // roda uma vez, ao montar/trocar de conversa
  }, [leadId]);

  // Mensagens novas aparecem sozinhas (aba visível).
  useEffect(() => {
    const intervalo = setInterval(() => {
      if (document.visibilityState === "visible") router.refresh();
    }, INTERVALO_ATUALIZACAO);
    return () => clearInterval(intervalo);
  }, [router]);

  // Limpa o campo após envio (ajuste durante o render).
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
    <div className="flex min-h-0 flex-1 flex-col">
      <div
        ref={caixaRef}
        aria-label="Histórico da conversa"
        className="flex min-h-0 flex-1 flex-col gap-1 overflow-y-auto bg-neutral-50 p-2"
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
                  "max-w-[75%] rounded-md px-1.5 py-1 shadow-sm",
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

      {temConversa ? (
        <form
          ref={formRef}
          action={formAction}
          className="flex flex-col gap-1 border-t border-neutral-200 bg-neutral-0 p-1.5"
        >
          <input type="hidden" name="lead_id" value={leadId} />

          <div className="flex items-end gap-1">
            {mensagensPadrao.length > 0 ? (
              <>
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
                  aria-label="Inserir mensagem padrão"
                  title="Mensagens padrão"
                  className={cn(CAMPO, "w-[144px] shrink-0")}
                >
                  <option value="" disabled>
                    Padrão…
                  </option>
                  {mensagensPadrao.map((m) => (
                    <option key={m.id} value={m.id}>
                      {m.titulo}
                    </option>
                  ))}
                </select>
              </>
            ) : null}

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
              placeholder="Escreva a mensagem… (Enter envia)"
              className="min-h-[56px] min-w-0 flex-1 rounded-md border border-neutral-300 bg-neutral-0 px-1.5 py-1 text-sm text-neutral-800 placeholder:text-neutral-400 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-primary-500"
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
        <p className="border-t border-neutral-200 bg-neutral-50 px-2 py-1.5 text-sm text-neutral-600">
          Sem conversa vinculada no Chatwoot — o envio libera quando o lead
          mandar a primeira mensagem no WhatsApp.
        </p>
      )}
    </div>
  );
}
