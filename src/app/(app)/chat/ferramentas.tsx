"use client";

import { useEffect, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import {
  Check,
  ChevronDown,
  Clock,
  Ellipsis,
  Inbox,
  Mail,
  RotateCcw,
  Tag,
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
  type PrazoAdiar,
} from "./actions";

export type PessoaEquipe = { id: string; nome: string };
export type Etiqueta = { id: string; nome: string; cor?: string | null };
export type EtapaFunil = { id: string; nome: string };

/** Opções rápidas de prazo ao adiar — o servidor calcula a data-limite. */
export const OPCOES_ADIAR: { prazo: PrazoAdiar; rotulo: string }[] = [
  { prazo: "amanha", rotulo: "Amanhã" },
  { prazo: "3dias", rotulo: "3 dias" },
  { prazo: "1semana", rotulo: "1 semana" },
];

const CAMPO =
  "h-[32px] min-w-0 rounded-md border border-neutral-300 bg-neutral-0 px-1 text-sm text-neutral-800 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-primary-500 disabled:cursor-not-allowed disabled:text-neutral-400";

const ITEM_MENU =
  "flex h-[40px] w-full items-center gap-1 px-1.5 text-left text-sm text-neutral-800 transition-colors duration-[120ms] hover:bg-neutral-50 focus-visible:outline-2 focus-visible:-outline-offset-2 focus-visible:outline-primary-500 disabled:cursor-not-allowed disabled:text-neutral-400";

/**
 * Barra da conversa aberta, numa linha: etapa, atendente e etiquetas à
 * esquerda; a ação do momento à direita. O que é raro (não lida, adiar,
 * reabrir) fica no menu — antes eram três blocos empilhados competindo
 * pela atenção de quem só queria responder.
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
  adiadaAte,
  resolvida,
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
  /** Até quando está adiada, já formatado — null sem prazo (pré-0042). */
  adiadaAte: string | null;
  resolvida: boolean;
}) {
  const [pendente, iniciar] = useTransition();
  const [erro, setErro] = useState<string | null>(null);
  const [aberto, setAberto] = useState<"etiquetas" | "mais" | null>(null);
  const [expandidoMobile, setExpandidoMobile] = useState(false);
  const router = useRouter();

  // Esc fecha o que estiver aberto.
  useEffect(() => {
    if (!aberto) return;
    const aoTeclar = (e: KeyboardEvent) => {
      if (e.key === "Escape") setAberto(null);
    };
    document.addEventListener("keydown", aoTeclar);
    return () => document.removeEventListener("keydown", aoTeclar);
  }, [aberto]);

  const executar = (
    acao: () => Promise<{ ok?: boolean; erro?: string }>,
    aoConcluir?: () => void,
  ) => {
    setErro(null);
    setAberto(null);
    iniciar(async () => {
      const resultado = await acao();
      if (resultado.erro) setErro(resultado.erro);
      else aoConcluir?.();
    });
  };

  const voltarParaLista = () => router.push("/chat");

  const marcadas = new Set(etiquetasLead);
  const chips = etiquetas.filter((e) => marcadas.has(e.id));
  const estaResolvida = resolvida || statusConversa === "resolved";

  const situacao = estaResolvida
    ? { texto: "Resolvida", classe: "bg-success-bg text-success" }
    : adiada
      ? {
          texto: adiadaAte ? `Adiada até ${adiadaAte}` : "Adiada",
          classe: "bg-accent-100 text-accent-700",
        }
      : null;

  return (
    <div className="border-b border-neutral-200 bg-neutral-0 px-1.5 py-1">
      {/* No celular a barra colapsa: sobra o essencial e o resto abre. */}
      <div className="flex items-center justify-between gap-1 lg:hidden">
        {situacao ? (
          <span
            className={cn(
              "inline-flex h-[20px] items-center rounded-sm px-1 text-xs font-medium",
              situacao.classe,
            )}
          >
            {situacao.texto}
          </span>
        ) : (
          <span className="truncate text-xs text-neutral-400">
            {etapas.find((e) => e.id === etapaId)?.nome ?? "Sem etapa"}
            {responsavelId
              ? ` · ${equipe.find((p) => p.id === responsavelId)?.nome ?? ""}`
              : " · sem atendente"}
          </span>
        )}
        <button
          type="button"
          aria-expanded={expandidoMobile}
          onClick={() => setExpandidoMobile((v) => !v)}
          className="inline-flex h-[32px] shrink-0 items-center gap-0.5 rounded-md px-1 text-sm text-neutral-600 transition-colors duration-[120ms] hover:bg-neutral-100 hover:text-neutral-800 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-primary-500"
        >
          Ferramentas
          <ChevronDown
            size={14}
            strokeWidth={1.5}
            aria-hidden
            className={cn(
              "transition-transform duration-[120ms]",
              expandidoMobile ? "rotate-180" : "",
            )}
          />
        </button>
      </div>

      <div
        className={cn(
          "items-center gap-1",
          expandidoMobile ? "mt-1 flex flex-wrap" : "hidden lg:flex",
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
              className={cn(CAMPO, "w-[136px]")}
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
            executar(() => definirResponsavelChat(leadId, e.target.value || null))
          }
          className={cn(CAMPO, "w-[144px]")}
        >
          <option value="">Sem atendente</option>
          {equipe.map((pessoa) => (
            <option key={pessoa.id} value={pessoa.id}>
              {pessoa.nome}
            </option>
          ))}
        </select>

        {/* Etiquetas: os chips já dizem quais são; o botão só adiciona. */}
        {chips.map((etiqueta) => (
          <span
            key={etiqueta.id}
            className={cn(
              "inline-flex h-[24px] items-center rounded-sm px-1 text-xs font-medium",
              estiloEtiqueta(etiqueta.cor).chip,
            )}
          >
            {etiqueta.nome}
          </span>
        ))}

        <div className="relative">
          <button
            type="button"
            aria-label="Etiquetas do lead"
            aria-expanded={aberto === "etiquetas"}
            title="Etiquetas"
            onClick={() => setAberto(aberto === "etiquetas" ? null : "etiquetas")}
            className="inline-flex h-[32px] w-[32px] items-center justify-center rounded-md text-neutral-600 transition-colors duration-[120ms] hover:bg-neutral-100 hover:text-neutral-800 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-primary-500"
          >
            <Tag size={16} strokeWidth={1.5} aria-hidden />
          </button>

          {aberto === "etiquetas" ? (
            <>
              <button
                type="button"
                aria-label="Fechar etiquetas"
                tabIndex={-1}
                onClick={() => setAberto(null)}
                className="fixed inset-0 z-10 cursor-default"
              />
              <div
                role="group"
                aria-label="Etiquetas do lead"
                className="absolute left-0 top-[calc(100%+4px)] z-20 w-[240px] rounded-[10px] border border-neutral-200 bg-neutral-0 py-0.5 shadow-lg"
              >
                {etiquetas.length === 0 ? (
                  <p className="px-1.5 py-1 text-sm text-neutral-600">
                    Nenhuma etiqueta cadastrada — crie em Configurações.
                  </p>
                ) : (
                  <ul className="max-h-[240px] overflow-y-auto">
                    {etiquetas.map((etiqueta) => (
                      <li key={etiqueta.id}>
                        <label className="flex h-[40px] cursor-pointer items-center gap-1 px-1.5 text-sm text-neutral-800 hover:bg-neutral-50">
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

        {/* Ação do momento + o resto no menu. */}
        <span className="ml-auto inline-flex items-center gap-0.5">
          {situacao ? (
            <span
              className={cn(
                "hidden h-[20px] items-center rounded-sm px-1 text-xs font-medium lg:inline-flex",
                situacao.classe,
              )}
            >
              {situacao.texto}
            </span>
          ) : null}

          {temConversa ? (
            <button
              type="button"
              disabled={pendente}
              onClick={() =>
                executar(
                  () =>
                    alterarStatusConversaChat(
                      leadId,
                      estaResolvida ? "open" : "resolved",
                    ),
                  // Resolvida sai da caixa: volta para a lista. Reabrir fica.
                  estaResolvida ? undefined : voltarParaLista,
                )
              }
              className={cn(
                "inline-flex h-[32px] items-center gap-0.5 rounded-md px-1.5 text-sm font-medium transition-colors duration-[120ms] focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-primary-500 disabled:cursor-not-allowed disabled:opacity-60",
                estaResolvida
                  ? "border border-neutral-300 bg-neutral-0 text-neutral-800 hover:bg-neutral-100"
                  : "bg-primary-600 text-neutral-0 hover:bg-primary-700",
              )}
            >
              {estaResolvida ? (
                <RotateCcw size={14} strokeWidth={1.5} aria-hidden />
              ) : (
                <Check size={14} strokeWidth={1.5} aria-hidden />
              )}
              {estaResolvida ? "Reabrir" : "Resolver"}
            </button>
          ) : null}

          <div className="relative">
            <button
              type="button"
              aria-label="Mais ações da conversa"
              aria-expanded={aberto === "mais"}
              onClick={() => setAberto(aberto === "mais" ? null : "mais")}
              className="inline-flex h-[32px] w-[32px] items-center justify-center rounded-md text-neutral-600 transition-colors duration-[120ms] hover:bg-neutral-100 hover:text-neutral-800 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-primary-500"
            >
              <Ellipsis size={16} strokeWidth={1.5} aria-hidden />
            </button>

            {aberto === "mais" ? (
              <>
                <button
                  type="button"
                  aria-label="Fechar menu"
                  tabIndex={-1}
                  onClick={() => setAberto(null)}
                  className="fixed inset-0 z-10 cursor-default"
                />
                <div
                  role="menu"
                  className="absolute right-0 top-[calc(100%+4px)] z-20 w-[248px] overflow-hidden rounded-[10px] border border-neutral-200 bg-neutral-0 py-0.5 shadow-lg"
                >
                  <button
                    type="button"
                    role="menuitem"
                    disabled={pendente}
                    onClick={() =>
                      executar(() => marcarChatNaoLido(leadId), voltarParaLista)
                    }
                    className={ITEM_MENU}
                  >
                    <Mail
                      size={16}
                      strokeWidth={1.5}
                      aria-hidden
                      className="text-neutral-400"
                    />
                    Marcar como não lida
                  </button>

                  {adiada ? (
                    <button
                      type="button"
                      role="menuitem"
                      disabled={pendente}
                      onClick={() => executar(() => reativarConversa(leadId))}
                      className={ITEM_MENU}
                    >
                      <Inbox
                        size={16}
                        strokeWidth={1.5}
                        aria-hidden
                        className="text-accent-700"
                      />
                      Trazer de volta agora
                    </button>
                  ) : (
                    <>
                      {/* Some da caixa e volta quando o prazo vencer — ou
                          antes, se o lead responder. */}
                      <p className="px-1.5 pb-0.5 pt-1 text-xs uppercase tracking-[0.06em] text-neutral-600">
                        Adiar até
                      </p>
                      {OPCOES_ADIAR.map((opcao) => (
                        <button
                          key={opcao.prazo}
                          type="button"
                          role="menuitem"
                          disabled={pendente}
                          title="Some da caixa e volta quando o prazo vencer (ou o lead responder)"
                          onClick={() =>
                            executar(
                              () => adiarConversa(leadId, opcao.prazo),
                              voltarParaLista,
                            )
                          }
                          className={ITEM_MENU}
                        >
                          <Clock
                            size={16}
                            strokeWidth={1.5}
                            aria-hidden
                            className="text-neutral-400"
                          />
                          {opcao.rotulo}
                        </button>
                      ))}
                    </>
                  )}
                </div>
              </>
            ) : null}
          </div>
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
