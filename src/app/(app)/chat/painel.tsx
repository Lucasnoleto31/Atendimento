import Link from "next/link";
import { UserRound } from "lucide-react";
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

function Linha({ rotulo, children }: { rotulo: string; children: React.ReactNode }) {
  return (
    <div className="flex items-baseline justify-between gap-1 py-0.5">
      <dt className="shrink-0 text-xs text-neutral-600">{rotulo}</dt>
      <dd className="text-right text-sm text-neutral-800">{children}</dd>
    </div>
  );
}

/**
 * Painel de contexto do lead ao lado da conversa — a promessa do produto:
 * saber quem é antes de responder, sem sair da tela.
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
  if (!detalhe) return null;

  const dataCurta = formatarData;

  const lotes = giro?.lotes_30d ?? null;
  const lotesAnterior = giro?.lotes_30d_anterior ?? null;
  const variacao =
    lotes !== null && lotesAnterior !== null && lotesAnterior > 0
      ? Math.round(((lotes - lotesAnterior) / lotesAnterior) * 100)
      : null;

  return (
    <aside
      aria-label="Contexto do lead"
      className="hidden w-[280px] shrink-0 flex-col gap-2 overflow-y-auto border-l border-neutral-200 bg-neutral-0 p-1.5 xl:flex"
    >
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

      <Link
        href={`/leads/${leadId}`}
        className="mt-auto inline-flex h-[40px] items-center justify-center gap-0.5 rounded-md border border-neutral-300 bg-neutral-0 px-1.5 text-sm font-medium text-neutral-800 transition-colors duration-[120ms] hover:bg-neutral-100 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-primary-500"
      >
        <UserRound size={16} strokeWidth={1.5} aria-hidden />
        Abrir ficha completa
      </Link>
    </aside>
  );
}
