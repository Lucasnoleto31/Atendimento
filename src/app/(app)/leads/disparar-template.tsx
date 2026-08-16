"use client";

import { useActionState, useEffect, useRef, useState } from "react";
import { createPortal, useFormStatus } from "react-dom";
import { Megaphone, X } from "lucide-react";
import { cn } from "@/lib/utils";
import type { TemplateWhatsapp } from "@/lib/chatwoot";
import { dispararTemplateLista, type ResultadoDisparo } from "./actions";

const ESTADO: ResultadoDisparo = {};

function BotaoDisparar({ restantes }: { restantes: number | null }) {
  const { pending } = useFormStatus();
  return (
    <button
      type="submit"
      disabled={pending}
      className="inline-flex h-[40px] items-center rounded-md bg-primary-600 px-2 text-sm font-medium text-neutral-0 transition-colors duration-[120ms] hover:bg-primary-700 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-primary-500 disabled:cursor-not-allowed disabled:opacity-60"
    >
      {pending
        ? "Enviando leva…"
        : restantes !== null
          ? `Enviar próxima leva (${restantes} restantes)`
          : "Enviar em levas de 30"}
    </button>
  );
}

/**
 * Disparo de template para a fila filtrada. Envia em levas de até 30 por
 * clique — o gestor controla o ritmo e acompanha o restante ao vivo.
 */
export function DispararTemplate({
  lista,
  rotuloLista,
  total,
  templates,
}: {
  lista: string;
  rotuloLista: string;
  total: number;
  templates: TemplateWhatsapp[];
}) {
  const [aberto, setAberto] = useState(false);
  const [indice, setIndice] = useState<number | null>(null);
  const [valores, setValores] = useState<Record<string, string>>({});
  const [estado, formAction] = useActionState(dispararTemplateLista, ESTADO);
  const dialogoRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!aberto) return;
    dialogoRef.current?.focus();
    const aoTeclar = (e: KeyboardEvent) => {
      if (e.key === "Escape") setAberto(false);
    };
    document.addEventListener("keydown", aoTeclar);
    return () => document.removeEventListener("keydown", aoTeclar);
  }, [aberto]);

  if (templates.length === 0) return null;

  const escolhido = indice !== null ? templates[indice] : null;
  const restantes = estado.ok ? (estado.restantes ?? 0) : null;
  const concluido = restantes === 0 && estado.ok;

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
        aria-labelledby="titulo-disparo"
        tabIndex={-1}
        className="flex max-h-[85dvh] w-full max-w-[560px] flex-col gap-2 overflow-y-auto rounded-[10px] bg-neutral-0 p-3 shadow-lg"
      >
        <div className="flex items-start justify-between gap-1">
          <div>
            <h2 id="titulo-disparo" className="text-h3 text-neutral-900">
              Disparar para a fila
            </h2>
            <p className="mt-0.5 text-sm text-neutral-600">
              Fila <span className="font-medium">{rotuloLista}</span> ·{" "}
              <span className="font-mono tabular-nums">{total}</span> lead(s).
              Levas de 30 por clique, para respeitar o ritmo do WhatsApp.
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

        <form action={formAction} className="flex flex-col gap-2">
          <input type="hidden" name="lista" value={lista} />
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
          <input
            type="hidden"
            name="iniciado_em"
            value={estado.iniciadoEm ?? ""}
          />

          <fieldset className="flex flex-col gap-1">
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
                  <span className="block text-sm font-medium text-neutral-800">
                    {template.nome}{" "}
                    <span className="font-mono text-xs text-neutral-400">
                      {template.idioma}
                    </span>
                  </span>
                  <span className="mt-0.5 block truncate text-xs text-neutral-600">
                    {template.corpo}
                  </span>
                </span>
              </label>
            ))}
          </fieldset>

          {escolhido && escolhido.parametros.length > 0 ? (
            <div className="flex flex-col gap-1">
              {escolhido.parametros.map((token) => (
                <div key={token} className="flex flex-col gap-0.5">
                  <label
                    htmlFor={`disparo-param-${token}`}
                    className="text-sm font-medium text-neutral-800"
                  >
                    Variável {`{{${token}}}`}{" "}
                    <span className="font-normal text-neutral-600">
                      — use {"{nome}"} para o nome de cada lead
                    </span>
                  </label>
                  <input
                    id={`disparo-param-${token}`}
                    name={`param_${token}`}
                    required
                    value={valores[token] ?? ""}
                    onChange={(e) =>
                      setValores((v) => ({ ...v, [token]: e.target.value }))
                    }
                    className="h-[40px] rounded-md border border-neutral-300 bg-neutral-0 px-1.5 text-sm text-neutral-800 placeholder:text-neutral-400 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-primary-500"
                  />
                </div>
              ))}
            </div>
          ) : null}

          {estado.erro ? (
            <p role="alert" className="text-sm text-danger">
              {estado.erro}
            </p>
          ) : null}

          {estado.ok ? (
            <p role="status" className="text-sm text-neutral-800">
              <span className="font-medium text-success">
                {estado.enviados} enviado(s)
              </span>
              {estado.pulados ? ` · ${estado.pulados} com falha` : ""} ·{" "}
              <span className="font-mono tabular-nums">{restantes}</span>{" "}
              restante(s)
              {concluido ? " — fila concluída. 🎯" : ""}
            </p>
          ) : null}

          <div className="flex justify-end gap-1">
            <button
              type="button"
              onClick={() => setAberto(false)}
              className="inline-flex h-[40px] items-center rounded-md border border-neutral-300 bg-neutral-0 px-2 text-sm font-medium text-neutral-800 transition-colors duration-[120ms] hover:bg-neutral-100 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-primary-500"
            >
              {concluido ? "Fechar" : "Cancelar"}
            </button>
            {!concluido ? <BotaoDisparar restantes={restantes} /> : null}
          </div>
        </form>
      </div>
    </div>
  );

  return (
    <>
      <button
        type="button"
        onClick={() => setAberto(true)}
        className="inline-flex h-[40px] items-center gap-0.5 rounded-md border border-neutral-300 bg-neutral-0 px-2 text-sm font-medium text-neutral-800 transition-colors duration-[120ms] hover:bg-neutral-100 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-primary-500"
      >
        <Megaphone size={18} strokeWidth={1.5} aria-hidden />
        Disparar template
      </button>

      {aberto ? createPortal(dialogo, document.body) : null}
    </>
  );
}
