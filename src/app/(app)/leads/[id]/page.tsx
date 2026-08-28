import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { ArrowLeft, MessageSquare, Pencil } from "lucide-react";
import { createClient } from "@/lib/supabase/server";
import { perfilAtual } from "@/lib/auth";
import { Button } from "@/components/ui/button";
import { CAMPO } from "@/components/app/form-styles";
import { registrarVenda } from "@/app/(app)/pagamentos/actions";
import { salvarFichaCliente } from "@/app/(app)/carteira/actions";
import { virarCliente } from "./cliente-actions";
import {
  formatarData,
  formatarReais,
  formatarTelefone,
  tempoDesde,
} from "@/lib/format";
import { LotesChart, type PontoLote } from "@/components/app/lotes-chart";
import { estiloEtiqueta } from "@/lib/etiquetas";
import { ROTULO_STATUS, type LeadStatus } from "@/lib/types";
import { cn } from "@/lib/utils";
import { TarefasLead, type TarefaLead } from "@/app/(app)/chat/tarefas-lead";
import {
  ItemConversa,
  PainelConversa,
} from "@/app/(app)/hoje/painel-conversa";

export const metadata: Metadata = { title: "Lead · Zeve CRM" };

/**
 * A Ficha 360 (fase 6.2): tudo de UMA pessoa numa tela só, em abas —
 * Atendimento (funil, etiquetas, tarefas, notas, conversa em painel),
 * Cliente (cadastro + carteira), Vendas e Giro. A ficha da carteira
 * (/carteira/[id]) redireciona para cá quando o cliente tem lead.
 *
 * Cada aba busca SÓ o que mostra — a ficha não paga pelo que não está na
 * tela. A conversa nunca carrega no render: abre num painel lateral sob
 * demanda (o mesmo da /hoje), senão a ficha pagaria a cascata do chat.
 */

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

const ROTULO_STATUS_CLIENTE: Record<string, { texto: string; classe: string }> =
  {
    ativo: { texto: "Ativo", classe: "bg-success-bg text-success" },
    em_risco: { texto: "Em risco", classe: "bg-warning-bg text-warning" },
    reativado: { texto: "Reativado", classe: "bg-info-bg text-info" },
    churn: { texto: "Churn", classe: "bg-danger-bg text-danger" },
  };

type Aba = "atendimento" | "cliente" | "vendas" | "giro";

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
    responsavel_id: string | null;
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
  const aviso = typeof busca.aviso === "string" ? busca.aviso : null;
  const supabase = await createClient();
  const perfil = await perfilAtual();

  const { data } = await supabase
    .from("leads")
    .select(
      `id, nome, telefone_e164, status, campanha, observacao, entrada_motivo,
       criado_em, entrou_na_etapa_em, primeira_resposta_em, customer_id,
       channel:channels(nome),
       stage:pipeline_stages(nome, pipeline:pipelines(nome)),
       responsavel:profiles(nome),
       customer:customers(id, nome_completo, telefone_e164, documento, email,
         conta_aberta_em, ativo, responsavel_id,
         contas:customer_accounts(conta))`,
    )
    .eq("id", id)
    .maybeSingle();

  if (!data) notFound();
  const lead = data as unknown as LeadDetalhe;

  const ehGestor = perfil?.papel === "admin" || perfil?.papel === "gestor";
  // eslint-disable-next-line react-hooks/purity -- Server Component: um render por request
  const agoraMs = Date.now();

  const abas: { chave: Aba; rotulo: string }[] = [
    { chave: "atendimento", rotulo: "Atendimento" },
    { chave: "cliente", rotulo: "Cliente" },
    { chave: "vendas", rotulo: "Vendas" },
    ...(lead.customer_id ? [{ chave: "giro" as const, rotulo: "Giro" }] : []),
  ];
  // Link antigo /leads/[id]?periodo=N (a ficha pré-abas gerava esse formato
  // e ele vive em histórico/bookmark): período era do gráfico de giro — sem
  // aba pedida, cai direto na aba Giro em vez de descartar o parâmetro.
  const aba: Aba = abas.some((a) => a.chave === busca.aba)
    ? (busca.aba as Aba)
    : busca.periodo !== undefined && lead.customer_id
      ? "giro"
      : "atendimento";
  const hrefAba = (chave: Aba) =>
    chave === "atendimento"
      ? `/leads/${lead.id}`
      : chave === "giro" && diasGrafico !== 90
        ? `/leads/${lead.id}?aba=giro&periodo=${diasGrafico}`
        : `/leads/${lead.id}?aba=${chave}`;

  // ── Aba Atendimento: etiquetas, tarefas e notas ───────────────────────────
  let etiquetas: { id: string; nome: string; cor: string | null }[] = [];
  let tarefas: TarefaLead[] = [];
  let tarefasDisponiveis = true;
  let notas: {
    id: string;
    conteudo: string | null;
    criado_em: string;
    autor: { nome: string } | null;
  }[] = [];
  if (aba === "atendimento") {
    const [tagsR, tarefasR, notasR] = await Promise.all([
      supabase
        .from("lead_tags")
        .select("tag:tags(id, nome, cor)")
        .eq("lead_id", id),
      supabase
        .from("lead_tasks")
        .select("id, titulo, vence_em")
        .eq("lead_id", id)
        .is("concluida_em", null)
        .order("vence_em")
        .limit(20),
      supabase
        .from("lead_interactions")
        .select("id, conteudo, criado_em, metadados, autor:profiles(nome)")
        .eq("lead_id", id)
        .eq("tipo", "nota")
        .order("criado_em", { ascending: false })
        .limit(40),
    ]);
    etiquetas = ((tagsR.data ?? []) as unknown as {
      tag: { id: string; nome: string; cor: string | null } | null;
    }[])
      .map((v) => v.tag)
      .filter((t): t is NonNullable<typeof t> => t !== null);
    tarefasDisponiveis = tarefasR.error === null;
    tarefas = (
      (tarefasR.data ?? []) as { id: string; titulo: string; vence_em: string }[]
    ).map((t) => ({
      ...t,
      vencida: new Date(t.vence_em).getTime() < agoraMs,
    }));
    // Só nota escrita por gente: os logs de ação (adiar/resolver/atribuir)
    // são tipo "nota" com metadados.sistema — e os antigos, sem o campo,
    // seguem o texto padrão (mesmo critério da Janela do chat).
    const PADROES_NOTA_SISTEMA = [
      /^Conversa (adiada|resolvida|reaberta)/,
      /^Atendimento atribuído/,
      /^Abriu conta na corretora/,
    ];
    notas = (
      (notasR.data ?? []) as unknown as (typeof notas[number] & {
        metadados: { sistema?: boolean } | null;
      })[]
    )
      .filter(
        (n) =>
          n.metadados?.sistema !== true &&
          !PADROES_NOTA_SISTEMA.some((p) => p.test(n.conteudo ?? "")),
      )
      .slice(0, 20);
  }

  // ── Aba Cliente: carteira + equipe para o formulário ─────────────────────
  type VCarteira = {
    lotes_30d: number | null;
    lotes_30d_anterior: number | null;
    ultimo_giro_em: string | null;
    dias_sem_giro: number | null;
    receita_30d_centavos: number | null;
    ltv_centavos: number | null;
    status: string | null;
    segmento: string | null;
  };
  let vCarteira: VCarteira | null = null;
  let equipe: { id: string; nome: string }[] = [];
  if (aba === "cliente" || aba === "vendas") {
    const [carteiraR, equipeR] = await Promise.all([
      aba === "cliente" && lead.customer_id
        ? supabase
            .from("v_carteira")
            .select(
              "lotes_30d, lotes_30d_anterior, ultimo_giro_em, dias_sem_giro, receita_30d_centavos, ltv_centavos, status, segmento",
            )
            .eq("customer_id", lead.customer_id)
            .maybeSingle()
        : Promise.resolve({ data: null }),
      ehGestor
        ? supabase
            .from("profiles")
            .select("id, nome")
            .eq("ativo", true)
            .order("nome")
        : Promise.resolve({ data: null }),
    ]);
    vCarteira = (carteiraR.data ?? null) as VCarteira | null;
    equipe = (equipeR.data ?? []) as { id: string; nome: string }[];
  }

  // ── Aba Vendas ────────────────────────────────────────────────────────────
  type VendaDoLead = {
    id: string;
    valor_comissao_centavos: number;
    status: "pendente" | "confirmada" | "cancelada";
    ocorreu_em: string;
    produto: { nome: string } | null;
    vendedor: { nome: string } | null;
  };
  let produtos: {
    id: string;
    nome: string;
    valor_comissao_centavos: number;
  }[] = [];
  let vendasDoLead: VendaDoLead[] = [];
  if (aba === "vendas") {
    const [produtosR, vendasR] = await Promise.all([
      supabase
        .from("products")
        .select("id, codigo, nome, valor_comissao_centavos")
        .eq("ativo", true)
        .order("nome"),
      supabase
        .from("sales")
        .select(
          "id, valor_comissao_centavos, status, ocorreu_em, produto:products(nome), vendedor:profiles(nome)",
        )
        .eq("lead_id", id)
        .order("ocorreu_em", { ascending: false }),
    ]);
    produtos = (produtosR.data ?? []) as typeof produtos;
    vendasDoLead = (vendasR.data ?? []) as unknown as VendaDoLead[];
  }

  // ── Aba Giro ──────────────────────────────────────────────────────────────
  type Giro = {
    lotes_30d: number;
    lotes_30d_anterior: number;
    ultimo_giro_em: string | null;
  };
  let giro: Giro | null = null;
  let pontos: PontoLote[] = [];
  let porConta: { conta: string; total30d: number; totalPeriodo: number }[] = [];

  if (aba === "giro" && lead.customer_id) {
    const inicio = new Date(agoraMs);
    inicio.setDate(inicio.getDate() - diasGrafico);
    const inicioIso = inicio.toISOString().slice(0, 10);
    const inicio30 = new Date(agoraMs);
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

    // Gráfico: soma de TODAS as contas por dia, só nos DIAS OPERADOS. Encher
    // o calendário com zeros afundava a linha em todo fim de semana, feriado
    // e dia sem giro — o que interessa é o volume de cada dia em que operou.
    const porDia = new Map<string, number>();
    for (const l of linhas) {
      porDia.set(
        l.referencia_data,
        (porDia.get(l.referencia_data) ?? 0) + Number(l.quantidade),
      );
    }
    pontos = [...porDia.entries()]
      .filter(([, quantidade]) => quantidade > 0)
      .sort(([a], [b]) => a.localeCompare(b))
      .map(([data2, quantidade]) => ({ data: data2, quantidade }));

    const mapaContas = new Map<
      string,
      { total30d: number; totalPeriodo: number }
    >();
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
  const statusCliente = vCarteira?.status
    ? (ROTULO_STATUS_CLIENTE[vCarteira.status] ?? {
        texto: vCarteira.status,
        classe: "bg-neutral-100 text-neutral-600",
      })
    : null;
  const variacaoGiro =
    vCarteira?.lotes_30d != null &&
    vCarteira?.lotes_30d_anterior != null &&
    vCarteira.lotes_30d_anterior > 0
      ? Math.round(
          ((vCarteira.lotes_30d - vCarteira.lotes_30d_anterior) /
            vCarteira.lotes_30d_anterior) *
            100,
        )
      : null;

  const avisoSucesso =
    aviso !== null &&
    (aviso === "Venda registrada." ||
      aviso === "Lead vinculado à base de clientes." ||
      aviso === "Dados do cliente atualizados." ||
      aviso.startsWith("Ficha salva"));

  return (
    <div className="p-2 md:p-3">
      <Link
        href="/leads"
        className="inline-flex items-center gap-0.5 rounded-md text-sm text-neutral-600 transition-colors duration-[120ms] hover:text-neutral-800 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-primary-500"
      >
        <ArrowLeft size={16} strokeWidth={1.5} aria-hidden />
        Leads
      </Link>

      {aviso ? (
        <p
          role="status"
          className={cn(
            "mt-2 max-w-[68ch] rounded-md border px-1.5 py-1 text-sm",
            avisoSucesso
              ? "border-success bg-success-bg text-success"
              : "border-warning bg-warning-bg text-warning",
          )}
        >
          {aviso}
        </p>
      ) : null}

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
          {/* A conversa abre num painel lateral, sem sair da ficha — o mesmo
              da /hoje. O caminho para a tela cheia fica no cabeçalho do
              painel ("Abrir no Chat"). */}
          <ItemConversa
            leadId={lead.id}
            nome={lead.nome}
            className="inline-flex h-[32px] w-auto items-center gap-0.5 rounded-md bg-primary-600 px-1.5 text-sm font-medium text-neutral-0 transition-colors duration-[120ms] hover:bg-primary-700 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-primary-500"
          >
            <MessageSquare size={14} strokeWidth={1.5} aria-hidden />
            Conversar
          </ItemConversa>
          <Button href={`/leads/${lead.id}/editar`} variant="secondary" size="sm">
            <Pencil size={14} strokeWidth={1.5} aria-hidden />
            Editar
          </Button>
        </div>
      </header>

      <nav aria-label="Seções da ficha" className="mt-2 border-b border-neutral-200">
        <ul className="flex flex-wrap gap-1">
          {abas.map((a) => {
            const ativa = a.chave === aba;
            return (
              <li key={a.chave}>
                <Link
                  href={hrefAba(a.chave)}
                  aria-current={ativa ? "page" : undefined}
                  className={cn(
                    "inline-flex h-[40px] items-center border-b-2 px-1.5 text-sm transition-colors duration-[120ms] focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-primary-500",
                    ativa
                      ? "border-primary-600 font-medium text-primary-900"
                      : "border-transparent text-neutral-600 hover:text-neutral-800",
                  )}
                >
                  {a.rotulo}
                </Link>
              </li>
            );
          })}
        </ul>
      </nav>

      {/* ── Aba Atendimento ── */}
      {aba === "atendimento" ? (
        <div className="mt-3 grid items-start gap-3 lg:grid-cols-2">
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
                detalhe={formatarData(lead.criado_em)}
              />
              <LinhaDado
                rotulo="Responsável"
                valor={lead.responsavel?.nome ?? "—"}
              />
            </dl>

            {etiquetas.length > 0 ? (
              <ul className="mt-2 flex flex-wrap gap-0.5" aria-label="Etiquetas">
                {etiquetas.map((t) => (
                  <li
                    key={t.id}
                    className={cn(
                      "inline-flex h-[20px] items-center rounded-sm px-1 text-xs font-medium",
                      estiloEtiqueta(t.cor).chip,
                    )}
                  >
                    {t.nome}
                  </li>
                ))}
              </ul>
            ) : null}

            {lead.observacao ? (
              <p className="mt-2 rounded-md bg-neutral-50 px-1.5 py-1 text-sm text-neutral-600">
                {lead.observacao}
              </p>
            ) : null}
          </section>

          <div className="flex flex-col gap-3">
            <section
              aria-labelledby="tarefas-titulo"
              className="rounded-lg border border-neutral-200 bg-neutral-0 p-3 shadow-sm"
            >
              <h2 id="tarefas-titulo" className="text-h3 text-neutral-900">
                Tarefas
              </h2>
              <TarefasLead
                leadId={lead.id}
                tarefas={tarefas}
                disponivel={tarefasDisponiveis}
              />
            </section>

            <section
              aria-labelledby="notas-titulo"
              className="rounded-lg border border-neutral-200 bg-neutral-0 p-3 shadow-sm"
            >
              <h2 id="notas-titulo" className="text-h3 text-neutral-900">
                Notas internas
              </h2>
              {notas.length === 0 ? (
                <p className="mt-1 text-sm text-neutral-600">
                  Nenhuma nota — elas nascem na conversa, pelo modo “Nota”.
                </p>
              ) : (
                <ul className="mt-1 flex flex-col divide-y divide-neutral-200">
                  {notas.map((n) => (
                    <li key={n.id} className="py-1">
                      <p className="text-sm whitespace-pre-wrap text-neutral-800">
                        {n.conteudo ?? ""}
                      </p>
                      <p className="mt-0.5 font-mono text-xs text-neutral-400 tabular-nums">
                        {n.autor?.nome ?? "—"} · {formatarData(n.criado_em)}
                      </p>
                    </li>
                  ))}
                </ul>
              )}
            </section>
          </div>
        </div>
      ) : null}

      {/* ── Aba Cliente ── */}
      {aba === "cliente" ? (
        <div className="mt-3">
          {lead.customer ? (
            <>
              {vCarteira ? (
                <dl className="grid gap-3 border-b border-neutral-200 pb-3 sm:grid-cols-2 lg:grid-cols-4">
                  <div>
                    <dt className="text-xs tracking-[0.06em] text-neutral-600 uppercase">
                      Lotes (30d)
                    </dt>
                    <dd className="font-mono text-h2 text-neutral-900 tabular-nums">
                      {vCarteira.lotes_30d ?? 0}
                      {variacaoGiro !== null ? (
                        <span
                          className={cn(
                            "ml-0.5 text-sm",
                            variacaoGiro < 0 ? "text-danger" : "text-success",
                          )}
                        >
                          {variacaoGiro > 0
                            ? `+${variacaoGiro}%`
                            : `${variacaoGiro}%`}
                        </span>
                      ) : null}
                    </dd>
                  </div>
                  <div>
                    <dt className="text-xs tracking-[0.06em] text-neutral-600 uppercase">
                      Receita (30d)
                    </dt>
                    <dd className="font-mono text-h2 text-neutral-900 tabular-nums">
                      {formatarReais(vCarteira.receita_30d_centavos ?? 0)}
                    </dd>
                  </div>
                  <div>
                    <dt className="text-xs tracking-[0.06em] text-neutral-600 uppercase">
                      LTV
                    </dt>
                    <dd className="font-mono text-h2 text-neutral-900 tabular-nums">
                      {formatarReais(vCarteira.ltv_centavos ?? 0)}
                    </dd>
                  </div>
                  <div>
                    <dt className="text-xs tracking-[0.06em] text-neutral-600 uppercase">
                      Último giro
                    </dt>
                    <dd className="font-mono text-h2 text-neutral-900 tabular-nums">
                      {vCarteira.ultimo_giro_em
                        ? formatarData(vCarteira.ultimo_giro_em)
                        : "nunca"}
                    </dd>
                    {vCarteira.dias_sem_giro != null ? (
                      <dd className="text-xs text-neutral-600">
                        há {vCarteira.dias_sem_giro} dia(s)
                      </dd>
                    ) : null}
                  </div>
                </dl>
              ) : null}

              <div className="mt-3 grid items-start gap-3 lg:grid-cols-2">
                <section
                  aria-labelledby="cliente-titulo"
                  className="rounded-lg border border-neutral-200 bg-neutral-0 p-3 shadow-sm"
                >
                  <div className="flex flex-wrap items-center justify-between gap-1">
                    <h2 id="cliente-titulo" className="text-h3 text-neutral-900">
                      Cliente
                    </h2>
                    <span className="flex items-center gap-0.5">
                      {statusCliente ? (
                        <span
                          className={cn(
                            "inline-flex h-[20px] items-center rounded-sm px-1 text-xs font-medium",
                            statusCliente.classe,
                          )}
                        >
                          {statusCliente.texto}
                        </span>
                      ) : null}
                      {vCarteira?.segmento ? (
                        <span className="inline-flex h-[20px] items-center rounded-sm bg-neutral-100 px-1 text-xs text-neutral-600 capitalize">
                          {vCarteira.segmento}
                        </span>
                      ) : null}
                    </span>
                  </div>
                  <dl className="mt-2 divide-y divide-neutral-200">
                    <LinhaDado
                      rotulo="Nome na base"
                      valor={lead.customer.nome_completo}
                    />
                    <LinhaDado
                      rotulo="Telefone"
                      valor={
                        lead.customer.telefone_e164
                          ? formatarTelefone(lead.customer.telefone_e164)
                          : "—"
                      }
                      mono
                    />
                    <LinhaDado
                      rotulo="CPF/CNPJ"
                      valor={lead.customer.documento ?? "—"}
                      mono
                    />
                    <LinhaDado rotulo="E-mail" valor={lead.customer.email ?? "—"} />
                    <LinhaDado
                      rotulo="Conta aberta em"
                      valor={formatarData(lead.customer.conta_aberta_em)}
                      mono
                    />
                    <LinhaDado
                      rotulo={`Conta(s) — ${lead.customer.contas.length}`}
                      valor={
                        lead.customer.contas.map((c) => c.conta).join(" · ") || "—"
                      }
                      mono
                    />
                    <LinhaDado
                      rotulo="Situação"
                      valor={lead.customer.ativo ? "Ativa" : "Inativa"}
                    />
                  </dl>
                </section>

                {ehGestor ? (
                  <section
                    aria-labelledby="editar-cliente-titulo"
                    className="rounded-lg border border-neutral-200 bg-neutral-0 p-3 shadow-sm"
                  >
                    <h2
                      id="editar-cliente-titulo"
                      className="text-h3 text-neutral-900"
                    >
                      Editar ficha do cliente
                    </h2>
                    {/* A MESMA action da carteira — um formulário só para as
                        duas fichas; o hidden voltar_lead traz de volta aqui. */}
                    <form
                      action={salvarFichaCliente}
                      className="mt-2 flex flex-col gap-2"
                    >
                      <input
                        type="hidden"
                        name="customer_id"
                        value={lead.customer.id}
                      />
                      <input type="hidden" name="voltar_lead" value={lead.id} />
                      {/* O número atual: intocado, ele fica FORA do update
                          (números fora do padrão BR não podem ser regravados
                          nem travar o resto da ficha). */}
                      <input
                        type="hidden"
                        name="telefone_original"
                        value={lead.customer.telefone_e164 ?? ""}
                      />

                      <div className="grid gap-2 sm:grid-cols-2">
                        <div className="flex flex-col gap-1">
                          <label
                            htmlFor="cliente-nome"
                            className="text-sm font-medium text-neutral-800"
                          >
                            Nome
                          </label>
                          <input
                            id="cliente-nome"
                            name="nome_completo"
                            required
                            defaultValue={lead.customer.nome_completo}
                            className={CAMPO}
                          />
                        </div>
                        <div className="flex flex-col gap-1">
                          <label
                            htmlFor="cliente-telefone"
                            className="text-sm font-medium text-neutral-800"
                          >
                            Telefone (WhatsApp)
                          </label>
                          <input
                            id="cliente-telefone"
                            name="telefone"
                            inputMode="tel"
                            placeholder="62 98181-0004"
                            defaultValue={
                              lead.customer.telefone_e164
                                ? formatarTelefone(lead.customer.telefone_e164)
                                : ""
                            }
                            className={CAMPO}
                          />
                        </div>
                        <div className="flex flex-col gap-1">
                          <label
                            htmlFor="cliente-documento"
                            className="text-sm font-medium text-neutral-800"
                          >
                            CPF/CNPJ
                          </label>
                          <input
                            id="cliente-documento"
                            name="documento"
                            inputMode="numeric"
                            defaultValue={lead.customer.documento ?? ""}
                            placeholder="só números"
                            className={cn(CAMPO, "font-mono tabular-nums")}
                          />
                        </div>
                        <div className="flex flex-col gap-1">
                          <label
                            htmlFor="cliente-email"
                            className="text-sm font-medium text-neutral-800"
                          >
                            E-mail
                          </label>
                          <input
                            id="cliente-email"
                            name="email"
                            type="email"
                            defaultValue={lead.customer.email ?? ""}
                            className={CAMPO}
                          />
                        </div>
                        <div className="flex flex-col gap-1">
                          <label
                            htmlFor="cliente-abertura"
                            className="text-sm font-medium text-neutral-800"
                          >
                            Conta aberta em
                          </label>
                          <input
                            id="cliente-abertura"
                            name="conta_aberta_em"
                            type="date"
                            defaultValue={lead.customer.conta_aberta_em ?? ""}
                            className={cn(CAMPO, "font-mono tabular-nums")}
                          />
                        </div>
                        <div className="flex flex-col gap-1">
                          <label
                            htmlFor="cliente-assessor"
                            className="text-sm font-medium text-neutral-800"
                          >
                            Assessor
                          </label>
                          <select
                            id="cliente-assessor"
                            name="responsavel_id"
                            defaultValue={lead.customer.responsavel_id ?? ""}
                            className={CAMPO}
                          >
                            <option value="">Sem dono</option>
                            {/* Assessor desativado continua como opção: sem
                                ela o select cairia em "Sem dono" e qualquer
                                save removeria o dono sem ninguém pedir. */}
                            {lead.customer.responsavel_id &&
                            !equipe.some(
                              (p) => p.id === lead.customer!.responsavel_id,
                            ) ? (
                              <option value={lead.customer.responsavel_id}>
                                Assessor atual (desativado)
                              </option>
                            ) : null}
                            {equipe.map((p) => (
                              <option key={p.id} value={p.id}>
                                {p.nome}
                              </option>
                            ))}
                          </select>
                        </div>
                        <div className="flex flex-col gap-1">
                          <label
                            htmlFor="cliente-situacao"
                            className="text-sm font-medium text-neutral-800"
                          >
                            Situação
                          </label>
                          <select
                            id="cliente-situacao"
                            name="situacao"
                            defaultValue={
                              lead.customer.ativo ? "ativa" : "inativa"
                            }
                            className={CAMPO}
                          >
                            <option value="ativa">Conta ativa</option>
                            <option value="inativa">Conta encerrada</option>
                          </select>
                        </div>
                        <div className="flex flex-col gap-1">
                          <label
                            htmlFor="cliente-contas"
                            className="text-sm font-medium text-neutral-800"
                          >
                            Adicionar conta(s)
                          </label>
                          <input
                            id="cliente-contas"
                            name="contas"
                            placeholder="separe várias por vírgula"
                            className={cn(CAMPO, "font-mono tabular-nums")}
                          />
                        </div>
                      </div>
                      <p className="text-xs text-neutral-600">
                        Contas existentes não saem por aqui — a importação da
                        base é quem manda na lista completa.
                      </p>
                      <div className="flex justify-end">
                        <Button type="submit" variant="secondary" size="sm">
                          Salvar ficha do cliente
                        </Button>
                      </div>
                    </form>
                  </section>
                ) : (
                  <p className="text-sm text-neutral-600">
                    Só gestor ou admin edita a ficha do cliente.
                  </p>
                )}
              </div>
            </>
          ) : lead.status === "ganho" ? (
            <div className="max-w-[560px] rounded-lg border border-neutral-200 bg-neutral-0 p-3 shadow-sm">
              <p className="text-sm text-neutral-600">
                Lead ganho ainda sem registro na base. Crie o cliente agora —
                informando a conta, os lotes das próximas importações já
                vinculam sozinhos.
              </p>
              <form
                action={virarCliente}
                className="mt-2 flex flex-wrap items-end gap-1"
              >
                <input type="hidden" name="lead_id" value={lead.id} />
                <div className="flex min-w-[160px] flex-1 flex-col gap-1">
                  <label
                    htmlFor="conta-cliente"
                    className="text-sm font-medium text-neutral-800"
                  >
                    Conta(s) na corretora
                  </label>
                  <input
                    id="conta-cliente"
                    name="conta"
                    placeholder="opcional — separe várias por vírgula"
                    className={CAMPO}
                  />
                </div>
                <Button type="submit" variant="secondary" size="md">
                  Virar cliente
                </Button>
              </form>
            </div>
          ) : (
            <p className="max-w-[68ch] text-sm text-neutral-600">
              O telefone deste lead não está na base de clientes. Quando a base
              for atualizada e o telefone bater, o vínculo aparece aqui sozinho.
            </p>
          )}
        </div>
      ) : null}

      {/* ── Aba Vendas ── */}
      {aba === "vendas" ? (
        <section
          aria-labelledby="venda-titulo"
          className="mt-3 rounded-lg border border-neutral-200 bg-neutral-0 p-3 shadow-sm"
        >
          <h2 id="venda-titulo" className="text-h3 text-neutral-900">
            Vendas
          </h2>

          {vendasDoLead.length > 0 ? (
            <ul className="mt-2 flex flex-col divide-y divide-neutral-200">
              {vendasDoLead.map((venda) => (
                <li
                  key={venda.id}
                  className="flex items-center justify-between gap-2 py-1"
                >
                  <span className="min-w-0 truncate text-sm text-neutral-800">
                    {venda.produto?.nome ?? "Produto"}
                    <span className="text-neutral-600">
                      {" "}
                      · {venda.vendedor?.nome ?? "—"} ·{" "}
                      {formatarData(venda.ocorreu_em)}
                    </span>
                  </span>
                  <span className="flex shrink-0 items-center gap-1">
                    {venda.status === "cancelada" ? (
                      <span className="inline-flex h-[20px] items-center rounded-sm bg-neutral-100 px-1 text-xs text-neutral-400">
                        cancelada
                      </span>
                    ) : null}
                    <span
                      className={cn(
                        "font-mono text-sm tabular-nums",
                        venda.status === "cancelada"
                          ? "text-neutral-400 line-through"
                          : "text-neutral-900",
                      )}
                    >
                      {formatarReais(venda.valor_comissao_centavos)}
                    </span>
                  </span>
                </li>
              ))}
            </ul>
          ) : (
            <p className="mt-1 text-sm text-neutral-600">
              Nenhuma venda registrada para este lead.
            </p>
          )}

          {produtos.length === 0 ? (
            <p className="mt-2 text-sm text-neutral-600">
              Cadastre um produto em Configurações para registrar vendas.
            </p>
          ) : (
            <form
              action={registrarVenda}
              className="mt-2 flex flex-wrap items-end gap-1 border-t border-neutral-200 pt-2"
            >
              <input type="hidden" name="lead_id" value={lead.id} />

              <div className="flex min-w-[200px] flex-1 flex-col gap-1">
                <label
                  htmlFor="product_id"
                  className="text-sm font-medium text-neutral-800"
                >
                  Produto vendido
                </label>
                <select id="product_id" name="product_id" required className={CAMPO}>
                  {produtos.map((p) => (
                    <option key={p.id} value={p.id}>
                      {p.nome} — {formatarReais(p.valor_comissao_centavos)}
                    </option>
                  ))}
                </select>
              </div>

              {ehGestor && equipe.length > 0 ? (
                <div className="flex min-w-[180px] flex-col gap-1">
                  <label
                    htmlFor="vendedor_id"
                    className="text-sm font-medium text-neutral-800"
                  >
                    Vendedor
                  </label>
                  <select
                    id="vendedor_id"
                    name="vendedor_id"
                    defaultValue={perfil?.id ?? ""}
                    className={CAMPO}
                  >
                    {equipe.map((v) => (
                      <option key={v.id} value={v.id}>
                        {v.nome}
                      </option>
                    ))}
                  </select>
                </div>
              ) : null}

              {lead.customer_id === null ? (
                <div className="flex min-w-[160px] flex-col gap-1">
                  <label
                    htmlFor="conta"
                    className="text-sm font-medium text-neutral-800"
                  >
                    Conta(s) na corretora
                  </label>
                  <input
                    id="conta"
                    name="conta"
                    placeholder="opcional — separe várias por vírgula"
                    className={CAMPO}
                  />
                </div>
              ) : null}

              <label className="flex h-[40px] items-center gap-1 text-sm text-neutral-800">
                <input
                  type="checkbox"
                  name="marcar_ganho"
                  defaultChecked
                  className="h-2 w-2 accent-primary-600"
                />
                Marcar lead como ganho
              </label>

              <Button type="submit" size="md">
                Registrar venda
              </Button>
            </form>
          )}
        </section>
      ) : null}

      {/* ── Aba Giro ── */}
      {aba === "giro" && lead.customer ? (
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
              {girou30d
                ? "Girou nos últimos 30 dias"
                : "Sem giro nos últimos 30 dias"}
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
                          ? `/leads/${lead.id}?aba=giro`
                          : `/leads/${lead.id}?aba=giro&periodo=${p.dias}`
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

          <dl className="mt-2 grid grid-cols-1 gap-1 border-y border-neutral-200 py-2 sm:grid-cols-3 sm:gap-2">
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
                {formatarData(giro?.ultimo_giro_em)}
              </dd>
            </div>
          </dl>

          {porConta.length > 1 ||
          (porConta.length === 1 && porConta[0].conta !== "sem conta") ? (
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

      <PainelConversa />
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
