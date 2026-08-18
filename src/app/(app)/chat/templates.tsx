"use client";

import { useActionState, useEffect, useRef, useState } from "react";
import { createPortal, useFormStatus } from "react-dom";
import { FileText, X } from "lucide-react";
import { cn } from "@/lib/utils";
import type { TemplateWhatsapp } from "@/lib/chatwoot";
import { enviarTemplateLead, type ResultadoEnvio } from "./actions";

const ESTADO: ResultadoEnvio = {};

function BotaoEnviarTemplate() {
  const { pending } = useFormStatus();
  return (
    <button
      type="submit"
      disabled={pending}
      className="inline-flex h-[40px] items-center rounded-md bg-primary-600 px-2 text-sm font-medium text-neutral-0 transition-colors duration-[120ms] hover:bg-primary-700 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-primary-500 disabled:cursor-not-allowed disabled:opacity-60"
    >
      {pending ? "Enviando…" : "Enviar template"}
    </button>
  );
}

/**
 * Botão + diálogo de envio de template aprovado do WhatsApp. É o caminho
 * para falar com o lead fora da janela de 24h. O diálogo sai por portal:
 * o gatilho vive dentro do form do compositor e form aninhado é inválido.
 */
export function BotaoTemplates({
  leadId,
  templates,
}: {
  leadId: string;
  templates: TemplateWhatsapp[];
}) {
  const [aberto, setAberto] = useState(false);
  const [indice, setIndice] = useState<number | null>(null);
  const [valores, setValores] = useState<Record<string, string>>({});
  const [estado, formAction] = useActionState(enviarTemplateLead, ESTADO);
  const dialogoRef = useRef<HTMLDivElement>(null);
  const gatilhoRef = useRef<HTMLButtonElement>(null);

  // Fecha ao concluir o envio (ajuste durante o render).
  const [estadoAnterior, setEstadoAnterior] = useState(estado);
  if (estado !== estadoAnterior) {
    setEstadoAnterior(estado);
    if (estado.ok) {
      setAberto(false);
      setIndice(null);
      setValores({});
    }
  }

  useEffect(() => {
    if (!aberto) return;
    dialogoRef.current?.focus();
    const aoTeclar = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        setAberto(false);
        gatilhoRef.current?.focus();
      }
    };
    document.addEventListener("keydown", aoTeclar);
    return () => document.removeEventListener("keydown", aoTeclar);
  }, [aberto]);

  if (templates.length === 0) return null;

  const escolhido = indice !== null ? templates[indice] : null;
  const previa = escolhido
    ? escolhido.corpo.replace(
        /\{\{\s*([^{}]+?)\s*\}\}/g,
        (bloco, token: string) => valores[token]?.trim() || bloco,
      )
    : "";

  const dialogo = (
    <div
      className="fixed inset-0 z-40 flex items-center justify-center bg-[rgba(26,25,23,0.4)] p-2"
      onMouseDown={(e) => {
        if (e.target === e.currentTarget) setAberto(false);
      }}
    >
      <div
        ref={dialogoRef}
        role="dialog"
        aria-modal="true"
        aria-labelledby="titulo-dialogo-template"
        tabIndex={-1}
        className="flex max-h-[85dvh] w-full max-w-[560px] flex-col rounded-[10px] bg-neutral-0 shadow-lg"
      >
        <div className="flex shrink-0 items-start justify-between gap-1 p-3 pb-2">
          <div className="min-w-0">
            <h2
              id="titulo-dialogo-template"
              className="text-h3 text-neutral-900"
            >
              Enviar template
            </h2>
            <p className="mt-0.5 text-sm text-neutral-600">
              É o caminho para puxar assunto com lead novo e para falar fora da
              janela de 24h — o WhatsApp só entrega template aprovado.
            </p>
          </div>
          <button
            type="button"
            aria-label="Fechar"
            onClick={() => setAberto(false)}
            className="inline-flex h-[32px] w-[32px] shrink-0 items-center justify-center rounded-md text-neutral-600 transition-colors duration-[120ms] hover:bg-neutral-100 hover:text-neutral-800 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-primary-500"
          >
            <X size={16} strokeWidth={1.5} aria-hidden />
          </button>
        </div>

        <form
          action={formAction}
          className="flex min-h-0 min-w-0 flex-1 flex-col"
        >
          <input type="hidden" name="lead_id" value={leadId} />
          <input
            type="hidden"
            name="template_nome"
            value={escolhido?.nome ?? ""}
          />
          <input
            type="hidden"
            name="template_idioma"
            value={escolhido?.idioma ?? ""}
          />

          {/* Só o miolo rola: o título fica visível em cima e os botões
              embaixo, sem o conteúdo vazar pela borda do diálogo. */}
          <div className="flex min-h-0 flex-1 flex-col gap-2 overflow-y-auto px-3 pb-2">
            <fieldset className="flex min-w-0 flex-col gap-1">
              <legend className="mb-1 text-sm font-medium text-neutral-800">
                Template
              </legend>
              {templates.map((template, i) => (
                <label
                  key={`${template.nome}-${template.idioma}`}
                  className={cn(
                    "flex cursor-pointer items-start gap-1 rounded-md border px-1.5 py-1 transition-colors duration-[120ms]",
                    indice === i
                      ? "border-primary-600 bg-primary-50"
                      : "border-neutral-200 hover:border-neutral-300",
                  )}
                >
                  <input
                    type="radio"
                    name="escolha_template"
                    checked={indice === i}
                    onChange={() => {
                      setIndice(i);
                      setValores({});
                    }}
                    className="mt-0.5 h-[16px] w-[16px] accent-primary-600"
                  />
                  <span className="min-w-0 flex-1">
                    <span className="flex items-baseline justify-between gap-1">
                      <span className="truncate text-sm font-medium text-neutral-800">
                        {template.nome}
                      </span>
                      <span className="shrink-0 font-mono text-xs text-neutral-400">
                        {template.idioma}
                      </span>
                    </span>
                    <span className="mt-0.5 line-clamp-2 text-xs break-words text-neutral-600">
                      {template.corpo}
                    </span>
                  </span>
                </label>
              ))}
            </fieldset>

            {escolhido && escolhido.parametros.length > 0 ? (
              <div className="flex flex-col gap-1">
                {escolhido.parametros.map((token) => (
                  <div key={token} className="flex min-w-0 flex-col gap-0.5">
                    <label
                      htmlFor={`param-${token}`}
                      className="text-sm font-medium text-neutral-800"
                    >
                      Variável {`{{${token}}}`}
                    </label>
                    <input
                      id={`param-${token}`}
                      name={`param_${token}`}
                      required
                      value={valores[token] ?? ""}
                      onChange={(e) =>
                        setValores((v) => ({
                          ...v,
                          [token]: e.target.value,
                        }))
                      }
                      className="h-[40px] rounded-md border border-neutral-300 bg-neutral-0 px-1.5 text-sm text-neutral-800 placeholder:text-neutral-400 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-primary-500"
                    />
                  </div>
                ))}
              </div>
            ) : null}

            {escolhido ? (
              <div>
                <p className="mb-0.5 text-xs font-medium tracking-[0.06em] text-neutral-600 uppercase">
                  Prévia
                </p>
                <p className="rounded-md border border-neutral-200 bg-neutral-50 px-1.5 py-1 text-sm break-words whitespace-pre-wrap text-neutral-800">
                  {previa}
                </p>
              </div>
            ) : null}

            {estado.erro ? (
              <p role="alert" className="text-sm text-danger">
                {estado.erro}
              </p>
            ) : null}
          </div>

          <div className="flex shrink-0 justify-end gap-1 border-t border-neutral-200 p-3">
            <button
              type="button"
              onClick={() => setAberto(false)}
              className="inline-flex h-[40px] items-center rounded-md border border-neutral-300 bg-neutral-0 px-2 text-sm font-medium text-neutral-800 transition-colors duration-[120ms] hover:bg-neutral-100 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-primary-500"
            >
              Cancelar
            </button>
            <BotaoEnviarTemplate />
          </div>
        </form>
      </div>
    </div>
  );

  return (
    <>
      <button
        ref={gatilhoRef}
        type="button"
        onClick={() => setAberto(true)}
        className="inline-flex h-[40px] shrink-0 items-center gap-0.5 rounded-md border border-neutral-300 bg-neutral-0 px-1.5 text-sm font-medium text-neutral-800 transition-colors duration-[120ms] hover:bg-neutral-100 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-primary-500"
        title="Enviar template do WhatsApp (vale fora da janela de 24h)"
      >
        <FileText size={16} strokeWidth={1.5} aria-hidden />
        <span className="hidden sm:inline">Template</span>
      </button>

      {aberto ? createPortal(dialogo, document.body) : null}
    </>
  );
}
