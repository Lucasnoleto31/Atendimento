"use client";

import { useEffect, useSyncExternalStore } from "react";
import { PanelRight, X } from "lucide-react";
import { cn } from "@/lib/utils";
import { formatarData, formatarReais } from "@/lib/format";
import { TarefasLead, type TarefaLead } from "./tarefas-lead";

export type ReceitaCliente = {
  receita_30d_centavos: number | null;
  ltv_centavos: number | null;
};

const ROTULO_MOTIVO: Record<string, string> = {
  manual: "Cadastro manual",
  importacao: "Importação",
  webhook_meta: "WhatsApp (Meta)",
  formulario: "Formulário",
  queda_lotes: "Reativação — queda de lotes",
  sem_giro: "Reativação — sem giro",
};

export type DetalheLead = {
  campanha: string | null;
  utm_campaign: string | null;
  entrada_motivo: string;
  observacao: string | null;
  criado_em: string;
  primeira_resposta_em: string | null;
  channel: { nome: string } | null;
  customer: { nome_completo: string; conta_aberta_em: string | null } | null;
};

export type GiroCliente = {
  lotes_30d: number | null;
  lotes_30d_anterior: number | null;
  ultimo_giro_em: string | null;
};

/**
 * Abaixo de xl o painel vira overlay aberto pelo botão do cabeçalho — o
 * botão e o painel moram em pontos diferentes da árvore, então o estado
 * vive num store de módulo (mesmo padrão da assinatura na Janela).
 */
const painelStore = {
  aberto: false,
  ouvintes: new Set<() => void>(),
  subscribe(cb: () => void) {
    painelStore.ouvintes.add(cb);
    return () => {
      painelStore.ouvintes.delete(cb);
    };
  },
  ler() {
    return painelStore.aberto;
  },
  lerNoServidor() {
    return false;
  },
  definir(valor: boolean) {
    painelStore.aberto = valor;
    painelStore.ouvintes.forEach((cb) => cb());
  },
};

/** Botão do cabeçalho da conversa que abre o painel em telas < xl. */
export function BotaoPainelLead() {
  const aberto = useSyncExternalStore(
    painelStore.subscribe,
    painelStore.ler,
    painelStore.lerNoServidor,
  );
  return (
    <button
      type="button"
      aria-label="Contexto do lead"
      aria-expanded={aberto}
      title="Contexto do lead"
      onClick={() => painelStore.definir(!aberto)}
      className="hidden h-[32px] w-[32px] shrink-0 items-center justify-center rounded-md border border-neutral-300 bg-neutral-0 text-neutral-600 transition-colors duration-[120ms] hover:bg-neutral-100 hover:text-neutral-800 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-primary-500 lg:inline-flex xl:hidden"
    >
      <PanelRight size={16} strokeWidth={1.5} aria-hidden />
    </button>
  );
}

function Linha({ rotulo, children }: { rotulo: string; children: React.ReactNode }) {
  return (
    <div className="flex items-baseline justify-between gap-1 py-0.5">
      <dt className="shrink-0 text-xs text-neutral-600">{rotulo}</dt>
      <dd className="text-right text-sm text-neutral-800">{children}</dd>
    </div>
  );
}

function ConteudoPainel({
  leadId,
  detalhe,
  giro,
  receita,
  tarefas,
  tarefasDisponiveis,
}: {
  leadId: string;
  detalhe: DetalheLead;
  giro: GiroCliente | null;
  receita: ReceitaCliente | null;
  tarefas: TarefaLead[];
  tarefasDisponiveis: boolean;
}) {
  const dataCurta = formatarData;

  const lotes = giro?.lotes_30d ?? null;
  const lotesAnterior = giro?.lotes_30d_anterior ?? null;
  const variacao =
    lotes !== null && lotesAnterior !== null && lotesAnterior > 0
      ? Math.round(((lotes - lotesAnterior) / lotesAnterior) * 100)
      : null;

  return (
    <>
      <section aria-labelledby="painel-lead-titulo">
        <h2
          id="painel-lead-titulo"
          className="text-xs font-medium tracking-[0.06em] text-neutral-600 uppercase"
        >
          Lead
        </h2>
        <dl className="mt-0.5 divide-y divide-neutral-200">
          <Linha rotulo="Origem">{detalhe.channel?.nome ?? "—"}</Linha>
          <Linha rotulo="Entrada">
            {ROTULO_MOTIVO[detalhe.entrada_motivo] ?? detalhe.entrada_motivo}
          </Linha>
          <Linha rotulo="Campanha">
            {detalhe.campanha ?? detalhe.utm_campaign ?? "—"}
          </Linha>
          <Linha rotulo="Criado em">{dataCurta(detalhe.criado_em)}</Linha>
          <Linha rotulo="Primeira resposta">
            {detalhe.primeira_resposta_em
              ? dataCurta(detalhe.primeira_resposta_em)
              : "nunca respondeu"}
          </Linha>
        </dl>
      </section>

      <section aria-labelledby="painel-cliente-titulo">
        <h2
          id="painel-cliente-titulo"
          className="text-xs font-medium tracking-[0.06em] text-neutral-600 uppercase"
        >
          Cliente
        </h2>
        {detalhe.customer ? (
          <dl className="mt-0.5 divide-y divide-neutral-200">
            <Linha rotulo="Nome">{detalhe.customer.nome_completo}</Linha>
            <Linha rotulo="Conta desde">
              {dataCurta(detalhe.customer.conta_aberta_em)}
            </Linha>
            <Linha rotulo="Lotes (30d)">
              <span className="font-mono tabular-nums">{lotes ?? "—"}</span>
              {variacao !== null ? (
                <span
                  className={cn(
                    "ml-0.5 font-mono text-xs tabular-nums",
                    variacao < 0 ? "text-danger" : "text-success",
                  )}
                >
                  {variacao > 0 ? `+${variacao}%` : `${variacao}%`}
                </span>
              ) : null}
            </Linha>
            <Linha rotulo="Último giro">
              {dataCurta(giro?.ultimo_giro_em ?? null)}
            </Linha>
            {(receita?.receita_30d_centavos ?? 0) > 0 ? (
              <Linha rotulo="Receita (30d)">
                <span className="font-mono tabular-nums">
                  {formatarReais(receita?.receita_30d_centavos ?? 0)}
                </span>
              </Linha>
            ) : null}
            {(receita?.ltv_centavos ?? 0) > 0 ? (
              <Linha rotulo="LTV">
                <span className="font-mono tabular-nums">
                  {formatarReais(receita?.ltv_centavos ?? 0)}
                </span>
              </Linha>
            ) : null}
          </dl>
        ) : (
          <p className="mt-0.5 text-sm text-neutral-600">
            Ainda não é cliente — o cruzamento por telefone não encontrou
            conta.
          </p>
        )}
      </section>

      <section aria-labelledby="painel-tarefas-titulo">
        <h2
          id="painel-tarefas-titulo"
          className="text-xs font-medium tracking-[0.06em] text-neutral-600 uppercase"
        >
          Tarefas
        </h2>
        <TarefasLead
          leadId={leadId}
          tarefas={tarefas}
          disponivel={tarefasDisponiveis}
        />
      </section>

      {detalhe.observacao ? (
        <section aria-labelledby="painel-obs-titulo">
          <h2
            id="painel-obs-titulo"
            className="text-xs font-medium tracking-[0.06em] text-neutral-600 uppercase"
          >
            Observação
          </h2>
          <p className="mt-0.5 text-sm break-words whitespace-pre-wrap text-neutral-800">
            {detalhe.observacao}
          </p>
        </section>
      ) : null}
    </>
  );
}

/**
 * Painel de contexto do lead ao lado da conversa — a promessa do produto:
 * saber quem é antes de responder, sem sair da tela. Fixo em xl+; de lg a
 * xl abre como overlay pelo botão do cabeçalho da conversa.
 */
export function PainelLead({
  leadId,
  detalhe,
  giro,
  receita,
  tarefas,
  tarefasDisponiveis,
}: {
  leadId: string;
  detalhe: DetalheLead | null;
  giro: GiroCliente | null;
  receita: ReceitaCliente | null;
  tarefas: TarefaLead[];
  tarefasDisponiveis: boolean;
}) {
  const aberto = useSyncExternalStore(
    painelStore.subscribe,
    painelStore.ler,
    painelStore.lerNoServidor,
  );

  // Esc fecha o overlay (só existe overlay abaixo de xl; em xl+ o painel
  // fixo ignora o estado).
  useEffect(() => {
    if (!aberto) return;
    const aoTeclar = (e: KeyboardEvent) => {
      if (e.key === "Escape") painelStore.definir(false);
    };
    document.addEventListener("keydown", aoTeclar);
    return () => document.removeEventListener("keydown", aoTeclar);
  }, [aberto]);

  if (!detalhe) return null;

  const conteudo = (
    <ConteudoPainel
      leadId={leadId}
      detalhe={detalhe}
      giro={giro}
      receita={receita}
      tarefas={tarefas}
      tarefasDisponiveis={tarefasDisponiveis}
    />
  );

  return (
    <>
      {/* xl+: coluna fixa, como sempre foi. */}
      <aside
        aria-label="Contexto do lead"
        className="relative hidden min-h-0 w-[280px] shrink-0 flex-col gap-2 overflow-y-auto border-l border-neutral-200 bg-neutral-0 p-1.5 xl:flex"
      >
        {conteudo}
      </aside>

      {/* < xl: overlay à direita, aberto pelo botão do cabeçalho. */}
      {aberto ? (
        <div className="fixed inset-0 z-30 xl:hidden">
          <button
            type="button"
            aria-label="Fechar painel do lead"
            tabIndex={-1}
            onClick={() => painelStore.definir(false)}
            className="absolute inset-0 cursor-default bg-[rgba(26,25,23,0.4)]"
          />
          <aside
            aria-label="Contexto do lead"
            className="absolute inset-y-0 right-0 flex w-[280px] flex-col gap-2 overflow-y-auto border-l border-neutral-200 bg-neutral-0 p-1.5 shadow-lg"
          >
            <button
              type="button"
              aria-label="Fechar painel"
              onClick={() => painelStore.definir(false)}
              className="absolute top-1 right-1 inline-flex h-[32px] w-[32px] items-center justify-center rounded-md text-neutral-600 transition-colors duration-[120ms] hover:bg-neutral-100 hover:text-neutral-800 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-primary-500"
            >
              <X size={16} strokeWidth={1.5} aria-hidden />
            </button>
            {conteudo}
          </aside>
        </div>
      ) : null}
    </>
  );
}
