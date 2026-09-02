"use client";

import { useEffect, useRef, useState, useTransition } from "react";
import Link from "next/link";
import {
  Ban,
  Mail,
  MoreHorizontal,
  RotateCcw,
  Undo2,
  UserRound,
} from "lucide-react";
import { cn } from "@/lib/utils";
import { estiloEtiqueta } from "@/lib/etiquetas";
import { MOTIVOS_PERDA, type MotivoPerda } from "@/lib/perda";
import {
  alterarEtapaChat,
  alternarEtiquetaChat,
  definirResponsavelChat,
  marcarChatNaoLido,
  marcarPerdidoChat,
  marcarStandBy,
  alterarStatusConversaChat,
  reabrirLeadChat,
} from "@/app/(app)/chat/actions";
import type { FerramentasDaConversa } from "@/app/(app)/hoje/actions";

/**
 * O "⋯" do palco (Bloco B): etapa, atendente, etiquetas, perdido/stand-by e
 * ficha — os gestos de ~15×/dia, fora do caminho de quem só responde. Cada
 * mudança avisa o pai (aoMudar) para recarregar a conversa em UMA action.
 */
export function FerramentasPalco({
  leadId,
  nome,
  ferramentas,
  aoMudar,
  aoMarcarNaoLida,
  aoSairDaFila,
}: {
  leadId: string;
  nome: string;
  ferramentas: FerramentasDaConversa;
  aoMudar: () => void;
  /** Avisa a lista para pintar a linha de volta como não lida. */
  aoMarcarNaoLida?: () => void;
  /** A conversa DEIXOU a fila (perdida ou em stand-by): a linha tem de sair
   *  na hora, como sai no Resolver — senão fica lá como se nada tivesse
   *  acontecido até a varredura seguinte. */
  aoSairDaFila?: () => void;
}) {
  const [aberto, setAberto] = useState(false);
  const [pendente, iniciar] = useTransition();
  const [erro, setErro] = useState<string | null>(null);
  const [perdaAberta, setPerdaAberta] = useState(false);
  const [motivo, setMotivo] = useState<MotivoPerda | "">("");
  const [detalhe, setDetalhe] = useState("");
  const dialogoRef = useRef<HTMLDivElement>(null);
  const gatilhoRef = useRef<HTMLButtonElement>(null);

  useEffect(() => {
    if (!aberto && !perdaAberta) return;
    const aoTeclar = (e: KeyboardEvent) => {
      // ⌘K abre a paleta por cima: sai da frente em vez de ficar aberto atrás
      // do overlay (e disputar o Esc com ela).
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === "k") {
        if (!perdaAberta) {
          setAberto(false);
          // Foco no gatilho, não no body: é ele que a paleta vai guardar
          // como "de onde vim" para devolver o foco ao fechar.
          gatilhoRef.current?.focus();
        }
        return;
      }
      if (e.key === "Escape") {
        // Se há um diálogo por cima (a paleta, o template), o Esc é dele —
        // este menu não pode consumir o evento nem puxar o foco para trás
        // do overlay. O diálogo de perda é deste componente e conta.
        if (!perdaAberta && document.querySelector('[role="dialog"]')) return;
        // Consome o Esc: sem isto ele seguia para o palco, que o usa para
        // fechar a paleta ⌘K.
        e.preventDefault();
        e.stopPropagation();
        setPerdaAberta(false);
        setAberto(false);
        gatilhoRef.current?.focus();
      }
    };
    document.addEventListener("keydown", aoTeclar);
    return () => document.removeEventListener("keydown", aoTeclar);
  }, [aberto, perdaAberta]);

  useEffect(() => {
    if (perdaAberta) dialogoRef.current?.focus();
  }, [perdaAberta]);

  /**
   * Roda a ação e recarrega a conversa. `recarregar: false` é para o que a
   * recarga desfaria — "marcar como não lida" morre se a Janela recarregar
   * (ela marca lida ao montar).
   */
  const executar = (
    acao: () => Promise<{ ok?: boolean; erro?: string }>,
    {
      recarregar = true,
      aoConcluir,
    }: { recarregar?: boolean; aoConcluir?: () => void } = {},
  ) => {
    setErro(null);
    iniciar(async () => {
      let r: { ok?: boolean; erro?: string };
      try {
        r = await acao();
      } catch {
        r = { erro: "Sem resposta do servidor — tente de novo." };
      }
      // O menu fica ABERTO até saber o desfecho: fechado antes, o erro não
      // tinha onde aparecer e a falha passava por sucesso.
      if (r.erro) {
        setErro(r.erro);
        // O controle que disparou ficou desabilitado durante a ação e o foco
        // caiu no body — devolve, senão a próxima letra vira atalho do palco.
        gatilhoRef.current?.focus();
      } else {
        if (recarregar) aoMudar();
        aoConcluir?.();
        setPerdaAberta(false);
        setAberto(false);
        // O controle que tinha o foco acabou de sumir com o menu: sem
        // devolver o foco ao gatilho ele cai no body, e aí a próxima letra
        // digitada vira atalho do palco (E resolve a conversa).
        gatilhoRef.current?.focus();
      }
    });
  };

  const marcadas = new Set(ferramentas.etiquetasLead);

  return (
    <div className="relative">
      <button
        ref={gatilhoRef}
        type="button"
        aria-label="Etapa, atendente, etiquetas e mais"
        aria-expanded={aberto}
        onClick={() => setAberto((v) => !v)}
        className={cn(
          "inline-flex h-[40px] w-[40px] items-center justify-center rounded-full text-neutral-600 hover:bg-neutral-100 hover:text-neutral-800 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-primary-500",
          aberto && "bg-neutral-100 text-neutral-800",
        )}
      >
        <MoreHorizontal size={17} strokeWidth={1.7} aria-hidden />
      </button>

      {aberto ? (
        <>
          <button
            type="button"
            aria-label="Fechar"
            tabIndex={-1}
            onClick={() => {
              setAberto(false);
              // Devolve o foco ao gatilho: solto no body, a próxima letra
              // digitada viraria atalho do palco (E resolve a conversa).
              gatilhoRef.current?.focus();
            }}
            className="fixed inset-0 z-20 cursor-default"
          />
          {/* data-popover: é assim que o palco sabe que a tecla é do painel
              e não um atalho de conversa (E resolve, H adia). Não usa
              role="menu" porque aqui dentro há select, label e link — filhos
              que o padrão ARIA de menu não admite. */}
          <div
            data-popover="ferramentas"
            aria-label="Ferramentas da conversa"
            className="absolute top-[calc(100%+6px)] right-0 z-30 w-[268px] rounded-lg border border-neutral-200 bg-neutral-0 p-1.5 shadow-lg"
          >
            <label className="block px-0.5 text-xs font-medium text-neutral-600">
              Etapa do funil
              <select
                value={ferramentas.etapaId ?? ""}
                disabled={pendente}
                onChange={(e) =>
                  executar(() => alterarEtapaChat(leadId, e.target.value))
                }
                className="mt-0.5 h-[40px] w-full rounded-md border border-neutral-300 bg-neutral-0 px-1 text-sm text-neutral-800 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-primary-500"
              >
                <option value="" disabled>
                  Sem etapa
                </option>
                {ferramentas.etapas.map((e) => (
                  <option key={e.id} value={e.id}>
                    {e.nome}
                  </option>
                ))}
              </select>
            </label>

            <label className="mt-1.5 block px-0.5 text-xs font-medium text-neutral-600">
              Atendente
              <select
                value={ferramentas.responsavelId ?? ""}
                disabled={pendente}
                onChange={(e) =>
                  executar(() =>
                    definirResponsavelChat(leadId, e.target.value || null),
                  )
                }
                className="mt-0.5 h-[40px] w-full rounded-md border border-neutral-300 bg-neutral-0 px-1 text-sm text-neutral-800 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-primary-500"
              >
                <option value="">Sem dono</option>
                {ferramentas.equipe.map((p) => (
                  <option key={p.id} value={p.id}>
                    {p.nome}
                  </option>
                ))}
              </select>
            </label>

            {ferramentas.etiquetas.length > 0 ? (
              <div className="mt-1.5 px-0.5">
                <p className="text-xs font-medium text-neutral-600">
                  Etiquetas
                </p>
                {/* p-0.5: a caixa rolável recorta nos quatro lados, e sem
                    esta folga o anel de foco do chip saía cortado. */}
                <div className="mt-0.5 flex max-h-[132px] flex-wrap gap-0.5 overflow-y-auto p-0.5">
                  {ferramentas.etiquetas.map((t) => {
                    const ativa = marcadas.has(t.id);
                    return (
                      <button
                        key={t.id}
                        type="button"
                        disabled={pendente}
                        onClick={() =>
                          executar(() =>
                            alternarEtiquetaChat(leadId, t.id, !ativa),
                          )
                        }
                        className={cn(
                          "inline-flex h-[32px] items-center rounded-full px-1 text-xs font-medium transition-colors duration-[120ms] focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-primary-500",
                          ativa
                            ? estiloEtiqueta(t.cor).chip
                            : // neutral-600, não 400: a etiqueta ainda não
                              // aplicada precisa ser LEGÍVEL para ser escolhida.
                              "bg-neutral-100 text-neutral-600 hover:bg-neutral-200 hover:text-neutral-800",
                        )}
                      >
                        {t.nome}
                      </button>
                    );
                  })}
                </div>
              </div>
            ) : null}

            <div className="mt-1.5 border-t border-neutral-200 pt-0.5">
              <Link
                href={`/leads/${leadId}`}
                className="flex h-[40px] items-center gap-1 rounded-md px-1 text-sm text-neutral-800 hover:bg-neutral-50 focus-visible:outline-2 focus-visible:-outline-offset-2 focus-visible:outline-primary-500"
              >
                <UserRound
                  size={15}
                  strokeWidth={1.7}
                  aria-hidden
                  className="text-neutral-400"
                />
                Ficha 360 do lead
              </Link>
              <button
                type="button"
                disabled={pendente}
                onClick={() =>
                  executar(() => marcarChatNaoLido(leadId), {
                    recarregar: false,
                    aoConcluir: aoMarcarNaoLida,
                  })
                }
                className="flex h-[40px] w-full items-center gap-1 rounded-md px-1 text-left text-sm text-neutral-800 hover:bg-neutral-50 focus-visible:outline-2 focus-visible:-outline-offset-2 focus-visible:outline-primary-500"
              >
                <Mail
                  size={15}
                  strokeWidth={1.7}
                  aria-hidden
                  className="text-neutral-400"
                />
                Marcar como não lida
              </button>
              {ferramentas.conversaResolvida ? (
                <button
                  type="button"
                  disabled={pendente}
                  onClick={() =>
                    executar(() => alterarStatusConversaChat(leadId, "open"))
                  }
                  className="flex h-[40px] w-full items-center gap-1 rounded-md px-1 text-left text-sm text-neutral-800 hover:bg-neutral-50 focus-visible:outline-2 focus-visible:-outline-offset-2 focus-visible:outline-primary-500"
                >
                  <Undo2
                    size={15}
                    strokeWidth={1.7}
                    aria-hidden
                    className="text-neutral-400"
                  />
                  Reabrir conversa
                </button>
              ) : null}
              {ferramentas.leadPerdido ? (
                <button
                  type="button"
                  disabled={pendente}
                  onClick={() => executar(() => reabrirLeadChat(leadId))}
                  className="flex h-[40px] w-full items-center gap-1 rounded-md px-1 text-left text-sm text-neutral-800 hover:bg-neutral-50 focus-visible:outline-2 focus-visible:-outline-offset-2 focus-visible:outline-primary-500"
                >
                  <RotateCcw
                    size={15}
                    strokeWidth={1.7}
                    aria-hidden
                    className="text-neutral-400"
                  />
                  Reabrir atendimento
                </button>
              ) : (
                <button
                  type="button"
                  disabled={pendente}
                  onClick={() => {
                    setAberto(false);
                    setMotivo("");
                    setDetalhe("");
                    setErro(null);
                    setPerdaAberta(true);
                  }}
                  className="flex h-[40px] w-full items-center gap-1 rounded-md px-1 text-left text-sm text-danger hover:bg-danger-bg focus-visible:outline-2 focus-visible:-outline-offset-2 focus-visible:outline-primary-500"
                >
                  <Ban size={15} strokeWidth={1.7} aria-hidden />
                  Marcar como perdido…
                </button>
              )}
            </div>
            {erro ? (
              <p role="alert" className="px-1 pb-0.5 text-xs text-danger">
                {erro}
              </p>
            ) : null}
          </div>
        </>
      ) : null}

      {perdaAberta ? (
        <div
          role="dialog"
          aria-modal="true"
          aria-label={`Por que perdemos ${nome}?`}
          className="fixed inset-0 z-50 flex items-center justify-center bg-overlay p-2"
          onClick={(e) => {
            if (e.target === e.currentTarget) {
              setPerdaAberta(false);
              gatilhoRef.current?.focus();
            }
          }}
        >
          <div
            ref={dialogoRef}
            tabIndex={-1}
            className="w-full max-w-[440px] rounded-lg border border-neutral-200 bg-neutral-0 p-3 shadow-lg outline-none"
          >
            <h2 className="text-h3 text-neutral-900">Por que perdemos?</h2>
            <div className="mt-2 flex flex-col gap-0.5">
              {(Object.entries(MOTIVOS_PERDA) as [MotivoPerda, string][]).map(
                ([chave, rotulo]) => (
                  <label
                    key={chave}
                    className="flex h-[40px] cursor-pointer items-center gap-1 rounded-md px-1 text-sm text-neutral-800 hover:bg-neutral-50"
                  >
                    <input
                      type="radio"
                      name="motivo-perda-palco"
                      value={chave}
                      checked={motivo === chave}
                      onChange={() => setMotivo(chave)}
                      className="h-2 w-2 accent-primary-600"
                    />
                    {rotulo}
                  </label>
                ),
              )}
            </div>
            <div className="mt-2 flex flex-wrap items-center justify-between gap-1 rounded-md bg-accent-100 px-1.5 py-1">
              <span className="text-sm text-accent-700">
                Vai pensar? Não é perda:
              </span>
              <button
                type="button"
                disabled={pendente}
                onClick={() =>
                  executar(() => marcarStandBy(leadId), {
                    aoConcluir: aoSairDaFila,
                  })
                }
                className="inline-flex h-[40px] items-center rounded-md border border-accent-300 bg-neutral-0 px-1.5 text-sm font-medium text-accent-700 hover:brightness-95 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-primary-500 disabled:opacity-50"
              >
                Stand-by — volta em 1 semana
              </button>
            </div>
            <label
              htmlFor="detalhe-perda-palco"
              className="mt-2 block text-sm font-medium text-neutral-800"
            >
              Detalhe (opcional)
            </label>
            <input
              id="detalhe-perda-palco"
              value={detalhe}
              maxLength={280}
              onChange={(e) => setDetalhe(e.target.value)}
              className="mt-0.5 h-[40px] w-full rounded-md border border-neutral-300 bg-neutral-0 px-1.5 text-sm text-neutral-800 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-primary-500"
            />
            {erro ? (
              <p role="alert" className="mt-1 text-sm text-danger">
                {erro}
              </p>
            ) : null}
            <div className="mt-2 flex justify-end gap-1">
              <button
                type="button"
                onClick={() => {
                  setPerdaAberta(false);
                  gatilhoRef.current?.focus();
                }}
                className="inline-flex h-[40px] items-center rounded-md border border-neutral-300 bg-neutral-0 px-1.5 text-sm font-medium text-neutral-800 hover:bg-neutral-100 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-primary-500"
              >
                Cancelar
              </button>
              <button
                type="button"
                disabled={pendente || motivo === ""}
                onClick={() =>
                  executar(() => marcarPerdidoChat(leadId, motivo, detalhe), {
                    aoConcluir: aoSairDaFila,
                  })
                }
                className="inline-flex h-[40px] items-center rounded-md bg-danger px-1.5 text-sm font-medium text-neutral-0 hover:brightness-90 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-primary-500 disabled:cursor-not-allowed disabled:opacity-50"
              >
                Marcar perdido
              </button>
            </div>
          </div>
        </div>
      ) : null}
    </div>
  );
}
