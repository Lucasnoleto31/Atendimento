"use client";

import { useEffect, useRef, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import {
  Check,
  ChevronDown,
  Clock,
  Inbox,
  Mail,
  RotateCcw,
  Tag,
  X,
} from "lucide-react";
import { cn } from "@/lib/utils";
import { estiloEtiqueta } from "@/lib/etiquetas";
import type { StatusConversa } from "@/lib/chatwoot";
import {
  adiarConversa,
  alterarEtapaChat,
  alterarStatusConversaChat,
  alternarEtiquetaChat,
  definirResponsavelChat,
  marcarChatNaoLido,
  reativarConversa,
} from "./actions";

export type PessoaEquipe = { id: string; nome: string };
export type Etiqueta = { id: string; nome: string; cor?: string | null };
export type EtapaFunil = { id: string; nome: string };

const ROTULO_STATUS: Record<StatusConversa, { texto: string; classe: string }> =
  {
    open: { texto: "Aberta", classe: "bg-info-bg text-info" },
    pending: { texto: "Pendente", classe: "bg-warning-bg text-warning" },
    snoozed: { texto: "Adiada", classe: "bg-warning-bg text-warning" },
    resolved: { texto: "Resolvida", classe: "bg-success-bg text-success" },
  };

/**
 * Barra de ferramentas da conversa aberta: atendente, etiquetas e status.
 * Tudo grava no CRM e espelha no Chatwoot pelas actions.
 */
export function FerramentasConversa({
  leadId,
  temConversa,
  statusConversa,
  responsavelId,
  equipe,
  etiquetas,
  etiquetasLead,
  etapas,
  etapaId,
  adiada,
}: {
  leadId: string;
  temConversa: boolean;
  statusConversa: StatusConversa | null;
  responsavelId: string | null;
  equipe: PessoaEquipe[];
  etiquetas: Etiqueta[];
  etiquetasLead: string[];
  etapas: EtapaFunil[];
  etapaId: string | null;
  adiada: boolean;
}) {
  const [pendente, iniciar] = useTransition();
  const [erro, setErro] = useState<string | null>(null);
  const [listaAberta, setListaAberta] = useState(false);
  const [maisAberto, setMaisAberto] = useState(false);
  const popoverRef = useRef<HTMLDivElement>(null);
  const gatilhoRef = useRef<HTMLButtonElement>(null);
  const router = useRouter();

  // Devolve a conversa à fila e volta à lista — reabrir marcaria como lida.
  const marcarNaoLida = () => {
    setErro(null);
    iniciar(async () => {
      const resultado = await marcarChatNaoLido(leadId);
      if (resultado.erro) setErro(resultado.erro);
      else router.push("/chat");
    });
  };

  // Adiar tira da caixa de entrada; sai da conversa para a lista seguinte.
  const adiar = () => {
    setErro(null);
    iniciar(async () => {
      const resultado = await adiarConversa(leadId);
      if (resultado.erro) setErro(resultado.erro);
      else router.push("/chat");
    });
  };

  const reativar = () => {
    setErro(null);
    iniciar(async () => {
      const resultado = await reativarConversa(leadId);
      if (resultado.erro) setErro(resultado.erro);
    });
  };

  // Esc fecha o popover e devolve o foco ao gatilho.
  useEffect(() => {
    if (!listaAberta) return;
    const aoTeclar = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        setListaAberta(false);
        gatilhoRef.current?.focus();
      }
    };
    document.addEventListener("keydown", aoTeclar);
    return () => document.removeEventListener("keydown", aoTeclar);
  }, [listaAberta]);

  const executar = (acao: () => Promise<{ ok?: boolean; erro?: string }>) => {
    setErro(null);
    iniciar(async () => {
      const resultado = await acao();
      if (resultado.erro) setErro(resultado.erro);
    });
  };

  const marcadas = new Set(etiquetasLead);
  const chips = etiquetas.filter((e) => marcadas.has(e.id));
  const status = statusConversa ? ROTULO_STATUS[statusConversa] : null;
  const resolvida = statusConversa === "resolved";

  return (
    <div className="border-b border-neutral-200 bg-neutral-0 px-1.5 py-1">
      {/* No celular a barra colapsa para não roubar espaço da conversa. */}
      <div className="flex items-center justify-between gap-1 lg:hidden">
        {status ? (
          <span
            className={cn(
              "inline-flex h-[20px] items-center rounded-sm px-1 text-xs font-medium",
              status.classe,
            )}
          >
            {status.texto}
          </span>
        ) : (
          <span />
        )}
        <button
          type="button"
          aria-expanded={maisAberto}
          onClick={() => setMaisAberto((v) => !v)}
          className="inline-flex h-[32px] items-center gap-0.5 rounded-md px-1 text-sm text-neutral-600 transition-colors duration-[120ms] hover:bg-neutral-100 hover:text-neutral-800 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-primary-500"
        >
          Ferramentas
          <ChevronDown
            size={14}
            strokeWidth={1.5}
            aria-hidden
            className={cn(
              "transition-transform duration-[120ms]",
              maisAberto ? "rotate-180" : "",
            )}
          />
        </button>
      </div>

      <div
        className={cn(
          "flex-wrap items-center gap-1",
          maisAberto ? "mt-1 flex" : "hidden lg:flex",
        )}
      >
        {etapas.length > 0 ? (
          <>
            <label htmlFor="etapa-conversa" className="sr-only">
              Etapa do funil
            </label>
            <select
              id="etapa-conversa"
              value={etapaId ?? ""}
              disabled={pendente}
              onChange={(e) => {
                if (e.target.value) {
                  executar(() => alterarEtapaChat(leadId, e.target.value));
                }
              }}
              className="h-[32px] w-[144px] rounded-md border border-neutral-300 bg-neutral-0 px-1 text-sm text-neutral-800 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-primary-500 disabled:cursor-not-allowed disabled:text-neutral-400"
            >
              <option value="" disabled>
                Etapa…
              </option>
              {etapas.map((etapa) => (
                <option key={etapa.id} value={etapa.id}>
                  {etapa.nome}
                </option>
              ))}
            </select>
          </>
        ) : null}

        <label htmlFor="atendente-conversa" className="sr-only">
          Atendente da conversa
        </label>
        <select
          id="atendente-conversa"
          value={responsavelId ?? ""}
          disabled={pendente}
          onChange={(e) =>
            executar(() =>
              definirResponsavelChat(leadId, e.target.value || null),
            )
          }
          className="h-[32px] w-[176px] rounded-md border border-neutral-300 bg-neutral-0 px-1 text-sm text-neutral-800 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-primary-500 disabled:cursor-not-allowed disabled:text-neutral-400"
        >
          <option value="">Sem atendente</option>
          {equipe.map((pessoa) => (
            <option key={pessoa.id} value={pessoa.id}>
              {pessoa.nome}
            </option>
          ))}
        </select>

        {chips.map((etiqueta) => (
          <span
            key={etiqueta.id}
            className={cn(
              "inline-flex h-[20px] items-center gap-0.5 rounded-sm px-1 text-xs font-medium",
              estiloEtiqueta(etiqueta.cor).chip,
            )}
          >
            {etiqueta.nome}
            <button
              type="button"
              aria-label={`Remover etiqueta ${etiqueta.nome}`}
              disabled={pendente}
              onClick={() =>
                executar(() => alternarEtiquetaChat(leadId, etiqueta.id, false))
              }
              className="inline-flex h-[16px] w-[16px] items-center justify-center rounded-sm opacity-70 transition-opacity duration-[120ms] hover:opacity-100 focus-visible:outline-2 focus-visible:outline-primary-500 disabled:cursor-not-allowed"
            >
              <X size={12} strokeWidth={1.5} aria-hidden />
            </button>
          </span>
        ))}

        <div className="relative" ref={popoverRef}>
          <button
            ref={gatilhoRef}
            type="button"
            aria-expanded={listaAberta}
            aria-haspopup="true"
            onClick={() => setListaAberta((v) => !v)}
            className="inline-flex h-[32px] items-center gap-0.5 rounded-md px-1 text-sm text-neutral-600 transition-colors duration-[120ms] hover:bg-neutral-100 hover:text-neutral-800 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-primary-500"
          >
            <Tag size={14} strokeWidth={1.5} aria-hidden />
            Etiquetas
          </button>

          {listaAberta ? (
            <>
              <button
                type="button"
                aria-label="Fechar lista de etiquetas"
                tabIndex={-1}
                onClick={() => setListaAberta(false)}
                className="fixed inset-0 z-10 cursor-default"
              />
              <div
                role="group"
                aria-label="Etiquetas do lead"
                className="absolute left-0 top-[calc(100%+4px)] z-20 w-[240px] rounded-[10px] border border-neutral-200 bg-neutral-0 py-0.5 shadow-lg"
              >
                {etiquetas.length === 0 ? (
                  <p className="px-1.5 py-1 text-sm text-neutral-600">
                    Nenhuma etiqueta cadastrada — crie na Administração.
                  </p>
                ) : (
                  <ul className="max-h-[240px] overflow-y-auto">
                    {etiquetas.map((etiqueta) => (
                      <li key={etiqueta.id}>
                        <label className="flex h-[32px] cursor-pointer items-center gap-1 px-1.5 text-sm text-neutral-800 hover:bg-neutral-50">
                          <input
                            type="checkbox"
                            checked={marcadas.has(etiqueta.id)}
                            disabled={pendente}
                            onChange={(e) =>
                              executar(() =>
                                alternarEtiquetaChat(
                                  leadId,
                                  etiqueta.id,
                                  e.target.checked,
                                ),
                              )
                            }
                            className="h-[16px] w-[16px] accent-primary-600"
                          />
                          <span
                            aria-hidden
                            className={cn(
                              "h-1 w-1 shrink-0 rounded-full",
                              estiloEtiqueta(etiqueta.cor).ponto,
                            )}
                          />
                          {etiqueta.nome}
                        </label>
                      </li>
                    ))}
                  </ul>
                )}
              </div>
            </>
          ) : null}
        </div>

        <span className="ml-auto inline-flex items-center gap-1">
          {temConversa && status ? (
            <span
              className={cn(
                "hidden h-[20px] items-center rounded-sm px-1 text-xs font-medium lg:inline-flex",
                status.classe,
              )}
            >
              {status.texto}
            </span>
          ) : null}
          <button
            type="button"
            disabled={pendente}
            onClick={marcarNaoLida}
            title="Marcar como não lida e voltar para a fila"
            className="inline-flex h-[32px] items-center gap-0.5 rounded-md px-1 text-sm text-neutral-600 transition-colors duration-[120ms] hover:bg-neutral-100 hover:text-neutral-800 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-primary-500 disabled:cursor-not-allowed disabled:text-neutral-400"
          >
            <Mail size={14} strokeWidth={1.5} aria-hidden />
            Não lida
          </button>

          {adiada ? (
            <button
              type="button"
              disabled={pendente}
              onClick={reativar}
              title="Trazer de volta para a caixa de entrada agora"
              className="inline-flex h-[32px] items-center gap-0.5 rounded-md bg-accent-100 px-1.5 text-sm font-medium text-accent-700 transition-colors duration-[120ms] hover:bg-accent-100/70 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-primary-500 disabled:cursor-not-allowed"
            >
              <Inbox size={14} strokeWidth={1.5} aria-hidden />
              Adiada · trazer de volta
            </button>
          ) : (
            <button
              type="button"
              disabled={pendente}
              onClick={adiar}
              title="Some da caixa de entrada e volta quando o lead responder"
              className="inline-flex h-[32px] items-center gap-0.5 rounded-md px-1 text-sm text-neutral-600 transition-colors duration-[120ms] hover:bg-neutral-100 hover:text-neutral-800 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-primary-500 disabled:cursor-not-allowed disabled:text-neutral-400"
            >
              <Clock size={14} strokeWidth={1.5} aria-hidden />
              Adiar
            </button>
          )}
          {temConversa ? (
            <button
              type="button"
              disabled={pendente}
              onClick={() =>
                executar(() =>
                  alterarStatusConversaChat(
                    leadId,
                    resolvida ? "open" : "resolved",
                  ),
                )
              }
              className="inline-flex h-[32px] items-center gap-0.5 rounded-md border border-neutral-300 bg-neutral-0 px-1.5 text-sm font-medium text-neutral-800 transition-colors duration-[120ms] hover:bg-neutral-100 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-primary-500 disabled:cursor-not-allowed disabled:text-neutral-400"
            >
              {resolvida ? (
                <RotateCcw size={14} strokeWidth={1.5} aria-hidden />
              ) : (
                <Check size={14} strokeWidth={1.5} aria-hidden />
              )}
              {resolvida ? "Reabrir" : "Resolver"}
            </button>
          ) : null}
        </span>
      </div>

      {erro ? (
        <p role="alert" className="mt-0.5 text-xs text-danger">
          {erro}
        </p>
      ) : null}
    </div>
  );
}
