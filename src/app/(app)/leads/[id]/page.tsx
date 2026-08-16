import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { ArrowLeft, Pencil } from "lucide-react";
import { createClient } from "@/lib/supabase/server";
import { Button } from "@/components/ui/button";
import { formatarTelefone, tempoDesde } from "@/lib/format";
import { LotesChart, type PontoLote } from "@/components/app/lotes-chart";
import { ROTULO_STATUS, type LeadStatus } from "@/lib/types";
import { cn } from "@/lib/utils";

export const metadata: Metadata = { title: "Lead · Zeve CRM" };

const PERIODOS = [
  { dias: 30, rotulo: "30 dias" },
  { dias: 90, rotulo: "90 dias" },
  { dias: 180, rotulo: "6 meses" },
  { dias: 365, rotulo: "12 meses" },
];

const ROTULO_MOTIVO: Record<string, string> = {
  manual: "Cadastro manual",
  importacao: "Importação",
  webhook_meta: "WhatsApp (Meta)",
  formulario: "Formulário",
  queda_lotes: "Reativação — queda de lotes",
  sem_giro: "Reativação — sem giro",
};

type LeadDetalhe = {
  id: string;
  nome: string;
  telefone_e164: string | null;
  status: LeadStatus;
  campanha: string | null;
  observacao: string | null;
  entrada_motivo: string;
  criado_em: string;
  entrou_na_etapa_em: string;
  primeira_resposta_em: string | null;
  customer_id: string | null;
  channel: { nome: string } | null;
  stage: { nome: string; pipeline: { nome: string } | null } | null;
  responsavel: { nome: string } | null;
  customer: {
    id: string;
    nome_completo: string;
    telefone_e164: string | null;
    documento: string | null;
    email: string | null;
    conta_aberta_em: string | null;
    ativo: boolean;
    contas: { conta: string }[];
  } | null;
};

export default async function LeadPage({
  params,
  searchParams,
}: PageProps<"/leads/[id]">) {
  const { id } = await params;
  const busca = await searchParams;
  const diasGrafico = PERIODOS.some((p) => p.dias === Number(busca.periodo))
    ? Number(busca.periodo)
    : 90;
  const supabase = await createClient();

  const { data } = await supabase
    .from("leads")
    .select(
      `id, nome, telefone_e164, status, campanha, observacao, entrada_motivo,
       criado_em, entrou_na_etapa_em, primeira_resposta_em, customer_id,
       channel:channels(nome),
       stage:pipeline_stages(nome, pipeline:pipelines(nome)),
       responsavel:profiles(nome),
       customer:customers(id, nome_completo, telefone_e164, documento, email,
         conta_aberta_em, ativo, contas:customer_accounts(conta))`,
    )
    .eq("id", id)
    .maybeSingle();

  if (!data) notFound();
  const lead = data as unknown as LeadDetalhe;

  // Giro e histórico de lotes — só quando o lead é cliente.
  type Giro = {
    lotes_30d: number;
    lotes_30d_anterior: number;
    ultimo_giro_em: string | null;
  };
  let giro: Giro | null = null;
  let pontos: PontoLote[] = [];
  let porConta: { conta: string; total30d: number; totalPeriodo: number }[] = [];

  if (lead.customer_id) {
    const inicio = new Date();
    inicio.setDate(inicio.getDate() - diasGrafico);
    const inicioIso = inicio.toISOString().slice(0, 10);
    const inicio30 = new Date();
    inicio30.setDate(inicio30.getDate() - 30);
    const inicio30Iso = inicio30.toISOString().slice(0, 10);

    const [{ data: giroData }, { data: lotes }] = await Promise.all([
      supabase
        .from("v_customer_giro")
        .select("lotes_30d, lotes_30d_anterior, ultimo_giro_em")
        .eq("customer_id", lead.customer_id)
        .maybeSingle(),
      supabase
        .from("customer_lots")
        .select("referencia_data, quantidade, conta")
        .eq("customer_id", lead.customer_id)
        .gte("referencia_data", inicioIso)
        .order("referencia_data"),
    ]);

    giro = (giroData as Giro | null) ?? null;

    const linhas = (lotes ?? []) as {
      referencia_data: string;
      quantidade: number;
      conta: string | null;
    }[];

    // Gráfico: soma de TODAS as contas por dia; dia sem registro conta zero.
    const porDia = new Map<string, number>();
    for (const l of linhas) {
      porDia.set(
        l.referencia_data,
        (porDia.get(l.referencia_data) ?? 0) + Number(l.quantidade),
      );
    }
    pontos = Array.from({ length: diasGrafico }, (_, i) => {
      const d = new Date();
      d.setDate(d.getDate() - (diasGrafico - 1 - i));
      const iso = d.toISOString().slice(0, 10);
      return { data: iso, quantidade: porDia.get(iso) ?? 0 };
    });

    // Detalhe por conta: total no período do gráfico e nos últimos 30 dias.
    const mapaContas = new Map<string, { total30d: number; totalPeriodo: number }>();
    for (const l of linhas) {
      const chave = l.conta ?? "sem conta";
      const atual = mapaContas.get(chave) ?? { total30d: 0, totalPeriodo: 0 };
      atual.totalPeriodo += Number(l.quantidade);
      if (l.referencia_data >= inicio30Iso) atual.total30d += Number(l.quantidade);
      mapaContas.set(chave, atual);
    }
    porConta = [...mapaContas.entries()]
      .map(([conta, totais]) => ({ conta, ...totais }))
      .sort((a, b) => b.totalPeriodo - a.totalPeriodo);
  }

  const girou30d = (giro?.lotes_30d ?? 0) > 0;

  return (
    <div className="p-2 md:p-3">
      <Link
        href="/leads"
        className="inline-flex items-center gap-0.5 rounded-md text-sm text-neutral-600 transition-colors duration-[120ms] hover:text-neutral-800 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-primary-500"
      >
        <ArrowLeft size={16} strokeWidth={1.5} aria-hidden />
        Leads
      </Link>

      <header className="mt-1 flex flex-wrap items-start justify-between gap-2 border-b border-neutral-200 pb-2">
        <div>
          <h1 className="text-h1 text-neutral-900">{lead.nome}</h1>
          <p className="mt-0.5 font-mono text-sm text-neutral-600 tabular-nums">
            {lead.telefone_e164
              ? formatarTelefone(lead.telefone_e164)
              : "sem telefone na base"}
          </p>
        </div>
        <div className="flex flex-wrap items-center gap-1">
          <span
            className={cn(
              "inline-flex h-[20px] items-center rounded-sm px-1 text-xs",
              lead.customer_id
                ? "bg-success-bg text-success"
                : "bg-neutral-100 text-neutral-600",
            )}
          >
            {lead.customer_id ? "Cliente" : "Não cliente"}
          </span>
          <span className="inline-flex h-[20px] items-center rounded-sm bg-info-bg px-1 text-xs text-info">
            {ROTULO_STATUS[lead.status]}
          </span>
          {lead.primeira_resposta_em === null ? (
            <span className="inline-flex h-[20px] items-center rounded-sm bg-neutral-100 px-1 text-xs text-neutral-600">
              nunca respondeu
            </span>
          ) : null}
          <Button href={`/leads/${lead.id}/editar`} variant="secondary" size="sm">
            <Pencil size={14} strokeWidth={1.5} aria-hidden />
            Editar
          </Button>
        </div>
      </header>

      <div className="mt-3 grid items-start gap-3 lg:grid-cols-2">
        {/* Atendimento */}
        <section
          aria-labelledby="atendimento-titulo"
          className="rounded-lg border border-neutral-200 bg-neutral-0 p-3 shadow-sm"
        >
          <h2 id="atendimento-titulo" className="text-h3 text-neutral-900">
            Atendimento
          </h2>
          <dl className="mt-2 divide-y divide-neutral-200">
            <LinhaDado
              rotulo="Etapa"
              valor={
                lead.stage
                  ? `${lead.stage.nome}${lead.stage.pipeline ? ` · ${lead.stage.pipeline.nome}` : ""}`
                  : "—"
              }
              detalhe={`nesta etapa ${tempoDesde(lead.entrou_na_etapa_em) ?? ""}`}
            />
            <LinhaDado
              rotulo="Origem"
              valor={lead.channel?.nome ?? "—"}
              detalhe={lead.campanha ?? undefined}
            />
            <LinhaDado
              rotulo="Entrada"
              valor={ROTULO_MOTIVO[lead.entrada_motivo] ?? lead.entrada_motivo}
              detalhe={new Date(lead.criado_em).toLocaleDateString("pt-BR")}
            />
            <LinhaDado rotulo="Responsável" valor={lead.responsavel?.nome ?? "—"} />
          </dl>
          {lead.observacao ? (
            <p className="mt-2 rounded-md bg-neutral-50 px-1.5 py-1 text-sm text-neutral-600">
              {lead.observacao}
            </p>
          ) : null}
        </section>

        {/* Cliente */}
        <section
          aria-labelledby="cliente-titulo"
          className="rounded-lg border border-neutral-200 bg-neutral-0 p-3 shadow-sm"
        >
          <h2 id="cliente-titulo" className="text-h3 text-neutral-900">
            Cliente
          </h2>

          {lead.customer ? (
            <dl className="mt-2 divide-y divide-neutral-200">
              <LinhaDado rotulo="Nome na base" valor={lead.customer.nome_completo} />
              <LinhaDado
                rotulo="CPF/CNPJ"
                valor={lead.customer.documento ?? "—"}
                mono
              />
              <LinhaDado rotulo="E-mail" valor={lead.customer.email ?? "—"} />
              <LinhaDado
                rotulo="Conta aberta em"
                valor={
                  lead.customer.conta_aberta_em
                    ? new Date(
                        `${lead.customer.conta_aberta_em}T12:00:00`,
                      ).toLocaleDateString("pt-BR")
                    : "—"
                }
                mono
              />
              <LinhaDado
                rotulo={`Conta(s) — ${lead.customer.contas.length}`}
                valor={lead.customer.contas.map((c) => c.conta).join(" · ") || "—"}
                mono
              />
              <LinhaDado
                rotulo="Situação"
                valor={lead.customer.ativo ? "Ativa" : "Inativa"}
              />
            </dl>
          ) : (
            <p className="mt-2 text-sm text-neutral-600">
              O telefone deste lead não está na base de clientes. Quando a base
              for atualizada e o telefone bater, o vínculo aparece aqui sozinho.
            </p>
          )}
        </section>
      </div>

      {/* Giro */}
      {lead.customer ? (
        <section
          aria-labelledby="giro-titulo"
          className="mt-3 rounded-lg border border-neutral-200 bg-neutral-0 p-3 shadow-sm"
        >
          <div className="flex flex-wrap items-center justify-between gap-2">
            <h2 id="giro-titulo" className="text-h3 text-neutral-900">
              Giro de lotes
            </h2>
            <span
              className={cn(
                "inline-flex h-[20px] items-center rounded-sm px-1 text-xs",
                girou30d
                  ? "bg-success-bg text-success"
                  : "bg-warning-bg text-warning",
              )}
            >
              {girou30d ? "Girou nos últimos 30 dias" : "Sem giro nos últimos 30 dias"}
            </span>
          </div>

          <nav aria-label="Período do gráfico" className="mt-2">
            <ul className="flex flex-wrap gap-1">
              {PERIODOS.map((p) => {
                const ativo = p.dias === diasGrafico;
                return (
                  <li key={p.dias}>
                    <Link
                      href={
                        p.dias === 90
                          ? `/leads/${lead.id}`
                          : `/leads/${lead.id}?periodo=${p.dias}`
                      }
                      aria-current={ativo ? "true" : undefined}
                      className={cn(
                        "inline-flex h-[32px] items-center rounded-md px-1.5 text-sm transition-colors duration-[120ms] focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-primary-500",
                        ativo
                          ? "bg-primary-50 font-medium text-primary-900"
                          : "text-neutral-600 hover:bg-neutral-100 hover:text-neutral-800",
                      )}
                    >
                      {p.rotulo}
                    </Link>
                  </li>
                );
              })}
            </ul>
          </nav>

          <dl className="mt-2 grid grid-cols-3 gap-2 border-y border-neutral-200 py-2">
            <div>
              <dt className="text-xs tracking-[0.06em] text-neutral-600 uppercase">
                Últimos 30 dias
              </dt>
              <dd className="font-mono text-h3 text-neutral-900 tabular-nums">
                {giro?.lotes_30d ?? 0}
              </dd>
            </div>
            <div>
              <dt className="text-xs tracking-[0.06em] text-neutral-600 uppercase">
                30 dias anteriores
              </dt>
              <dd className="font-mono text-h3 text-neutral-600 tabular-nums">
                {giro?.lotes_30d_anterior ?? 0}
              </dd>
            </div>
            <div>
              <dt className="text-xs tracking-[0.06em] text-neutral-600 uppercase">
                Último giro
              </dt>
              <dd className="font-mono text-h3 text-neutral-900 tabular-nums">
                {giro?.ultimo_giro_em
                  ? new Date(`${giro.ultimo_giro_em}T12:00:00`).toLocaleDateString(
                      "pt-BR",
                    )
                  : "—"}
              </dd>
            </div>
          </dl>

          {porConta.length > 1 || (porConta.length === 1 && porConta[0].conta !== "sem conta") ? (
            <div className="mt-2 overflow-hidden rounded-md border border-neutral-200">
              <table className="w-full border-collapse text-left">
                <caption className="sr-only">
                  Lotes por conta nos últimos {diasGrafico} e 30 dias
                </caption>
                <thead>
                  <tr className="border-b border-neutral-200 bg-neutral-50">
                    <th
                      scope="col"
                      className="px-1.5 py-0.5 text-xs tracking-[0.06em] text-neutral-600 uppercase"
                    >
                      Conta
                    </th>
                    <th
                      scope="col"
                      className="px-1.5 py-0.5 text-right text-xs tracking-[0.06em] text-neutral-600 uppercase"
                    >
                      Últimos 30d
                    </th>
                    <th
                      scope="col"
                      className="px-1.5 py-0.5 text-right text-xs tracking-[0.06em] text-neutral-600 uppercase"
                    >
                      Período ({diasGrafico}d)
                    </th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-neutral-200">
                  {porConta.map((c) => (
                    <tr key={c.conta}>
                      <td className="px-1.5 py-1 font-mono text-sm text-neutral-800 tabular-nums">
                        {c.conta}
                      </td>
                      <td className="px-1.5 py-1 text-right font-mono text-sm text-neutral-800 tabular-nums">
                        {c.total30d}
                      </td>
                      <td className="px-1.5 py-1 text-right font-mono text-sm text-neutral-600 tabular-nums">
                        {c.totalPeriodo}
                      </td>
                    </tr>
                  ))}
                </tbody>
                <tfoot>
                  <tr className="border-t border-neutral-200 bg-neutral-50">
                    <td className="px-1.5 py-1 text-sm font-medium text-neutral-800">
                      Total
                    </td>
                    <td className="px-1.5 py-1 text-right font-mono text-sm font-medium text-neutral-900 tabular-nums">
                      {porConta.reduce((s, c) => s + c.total30d, 0)}
                    </td>
                    <td className="px-1.5 py-1 text-right font-mono text-sm font-medium text-neutral-900 tabular-nums">
                      {porConta.reduce((s, c) => s + c.totalPeriodo, 0)}
                    </td>
                  </tr>
                </tfoot>
              </table>
            </div>
          ) : null}

          <div className="mt-2">
            <LotesChart pontos={pontos} dias={diasGrafico} />
          </div>
        </section>
      ) : null}
    </div>
  );
}

function LinhaDado({
  rotulo,
  valor,
  detalhe,
  mono = false,
}: {
  rotulo: string;
  valor: string;
  detalhe?: string;
  mono?: boolean;
}) {
  return (
    <div className="flex items-baseline justify-between gap-2 py-1">
      <dt className="shrink-0 text-sm text-neutral-600">{rotulo}</dt>
      <dd className="text-right">
        <span
          className={cn(
            "text-sm font-medium break-all text-neutral-800",
            mono && "font-mono tabular-nums",
          )}
        >
          {valor}
        </span>
        {detalhe ? (
          <span className="block text-xs text-neutral-400">{detalhe}</span>
        ) : null}
      </dd>
    </div>
  );
}
