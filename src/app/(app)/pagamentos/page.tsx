import type { Metadata } from "next";
import Link from "next/link";
import { Ban } from "lucide-react";
import { createClient } from "@/lib/supabase/server";
import { perfilAtual } from "@/lib/auth";
import { veTudo } from "@/lib/papeis";
import { formatarData, formatarReais } from "@/lib/format";
import { cn } from "@/lib/utils";
import { buscarTudo } from "@/lib/supabase/paginar";
import { cancelarVenda, definirPrevista } from "./actions";

export const metadata: Metadata = { title: "Pagamentos · Zeve CRM" };

const POR_PAGINA = 50;

const PERIODOS = [
  { chave: "hoje", rotulo: "Hoje" },
  { chave: "mes", rotulo: "Este mês" },
  { chave: "30", rotulo: "30 dias" },
  { chave: "90", rotulo: "90 dias" },
  { chave: "tudo", rotulo: "Tudo" },
] as const;

type ChavePeriodo = (typeof PERIODOS)[number]["chave"];

type Venda = {
  id: string;
  valor_comissao_centavos: number;
  status: "pendente" | "confirmada" | "cancelada";
  ocorreu_em: string;
  observacao: string | null;
  prevista_em?: string | null;
  lead: { id: string; nome: string } | null;
  produto: { nome: string; codigo: string } | null;
  vendedor: { id: string; nome: string } | null;
};

/** A janela anterior de mesmo tamanho, para o "vs período anterior". */
function janelaAnterior(
  chave: ChavePeriodo,
): { de: string; ate: string } | null {
  const inicio = inicioDoPeriodo(chave);
  if (!inicio) return null; // "tudo" não tem anterior
  const de = new Date(inicio);
  const ate = new Date(inicio);
  if (chave === "mes") {
    de.setMonth(de.getMonth() - 1);
  } else if (chave === "hoje") {
    de.setDate(de.getDate() - 1);
  } else {
    de.setDate(de.getDate() - Number(chave));
  }
  return { de: de.toISOString(), ate: ate.toISOString() };
}

function variacaoPct(atual: number, anterior: number): string | null {
  if (anterior <= 0) return null;
  const pct = Math.round(((atual - anterior) / anterior) * 100);
  return `${pct >= 0 ? "+" : ""}${pct}%`;
}

function inicioDoPeriodo(chave: ChavePeriodo): string | null {
  if (chave === "tudo") return null;
  const agora = new Date();
  if (chave === "hoje") {
    // Meia-noite de hoje em Brasília — o dia de trabalho da mesa.
    const diaLocal = new Intl.DateTimeFormat("en-CA", {
      timeZone: "America/Sao_Paulo",
    }).format(agora);
    return new Date(`${diaLocal}T00:00:00-03:00`).toISOString();
  }
  if (chave === "mes") {
    return new Date(agora.getFullYear(), agora.getMonth(), 1).toISOString();
  }
  agora.setDate(agora.getDate() - Number(chave));
  return agora.toISOString();
}

export default async function PagamentosPage({
  searchParams,
}: PageProps<"/pagamentos">) {
  const params = await searchParams;
  const periodo = (
    PERIODOS.some((p) => p.chave === params.periodo) ? params.periodo : "mes"
  ) as ChavePeriodo;
  const pagina = Math.max(1, Number(params.pagina) || 1);
  const aviso = typeof params.aviso === "string" ? params.aviso : null;
  // Filtros combináveis com o período (5.1).
  const fVendedor = typeof params.v === "string" ? params.v : "";
  const fProduto = typeof params.p === "string" ? params.p : "";
  const fStatus = ["pendente", "confirmada", "cancelada"].includes(
    String(params.st),
  )
    ? String(params.st)
    : "";
  const fBusca = typeof params.q === "string" ? params.q.trim() : "";

  const perfil = await perfilAtual();
  const ehGestor = veTudo(perfil?.papel);

  const supabase = await createClient();
  const inicio = inicioDoPeriodo(periodo);
  const de = (pagina - 1) * POR_PAGINA;

  // Os filtros valem para a tabela E para os números — uma função só os
  // aplica em todo lugar, para as somas nunca discordarem do extrato.
  // eslint-disable-next-line @typescript-eslint/no-explicit-any -- corta a recursão de tipos do builder
  const aplicarFiltros = (q: any, comBusca: boolean) => {
    if (inicio) q = q.gte("ocorreu_em", inicio);
    if (fVendedor) q = q.eq("vendedor_id", fVendedor);
    if (fProduto) q = q.eq("product_id", fProduto);
    if (comBusca && fBusca) {
      q = q.ilike("lead.nome", `%${fBusca.replaceAll(/[,()]/g, " ")}%`);
    }
    return q;
  };

  const relacaoLead = fBusca
    ? "lead:leads!inner(id, nome)"
    : "lead:leads(id, nome)";
  // Sem a 0052 a coluna prevista_em não existe: tenta com ela e cai sem.
  const selecionar = (comPrevista: boolean) =>
    `id, valor_comissao_centavos, status, ocorreu_em, observacao,${
      comPrevista ? " prevista_em," : ""
    }
       ${relacaoLead},
       produto:products(nome, codigo),
       vendedor:profiles(id, nome)`;

  const montarTabela = (comPrevista: boolean) => {
    let q = supabase
      .from("sales")
      .select(selecionar(comPrevista), { count: "exact" })
      .order("ocorreu_em", { ascending: false })
      .range(de, de + POR_PAGINA - 1);
    q = aplicarFiltros(q, true);
    if (fStatus) q = q.eq("status", fStatus);
    return q;
  };

  const inicioMes = inicioDoPeriodo("mes")!;

  // Linhas confirmadas do período (com produto e dia): alimentam o total, o
  // bloco Por produto e o gráfico — uma consulta em lotes serve os três.
  const confirmadasPromise = buscarTudo<{
    valor_comissao_centavos: number;
    ocorreu_em: string;
    product_id: string;
  }>((de2, ate2) => {
    let q = supabase
      .from("sales")
      .select("valor_comissao_centavos, ocorreu_em, product_id")
      .eq("status", "confirmada")
      .order("id")
      .range(de2, ate2);
    q = aplicarFiltros(q, false);
    return q;
  });

  const anterior = janelaAnterior(periodo);
  // buscarTudo: o select cru parava nos 1000 do PostgREST e o "vs anterior"
  // encolhia em janela cheia — o padrão é o mesmo da confirmadasPromise.
  const comparativoPromise = anterior
    ? buscarTudo<{ valor_comissao_centavos: number }>((de2, ate2) => {
        let q = supabase
          .from("sales")
          .select("valor_comissao_centavos")
          .eq("status", "confirmada")
          .gte("ocorreu_em", anterior.de)
          .lt("ocorreu_em", anterior.ate)
          .order("id")
          .range(de2, ate2);
        if (fVendedor) q = q.eq("vendedor_id", fVendedor);
        if (fProduto) q = q.eq("product_id", fProduto);
        return q;
      }).then((r) => ({ data: r.dados }))
    : Promise.resolve({ data: null });

  // Pendentes: o pipeline inteiro (sem filtro de período — pendente é
  // pendente até resolver), respeitando vendedor/produto.
  const pendentesPromise = (() => {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any -- idem
    let q: any = supabase
      .from("sales")
      .select(
        "id, valor_comissao_centavos, ocorreu_em, vendedor:profiles(id, nome)",
      )
      .eq("status", "pendente")
      .order("ocorreu_em", { ascending: true })
      .limit(500);
    if (fVendedor) q = q.eq("vendedor_id", fVendedor);
    if (fProduto) q = q.eq("product_id", fProduto);
    return q;
  })();

  // "Operações no período" conta o que valeu — venda cancelada sai da conta
  // (a lista abaixo ainda mostra a cancelada riscada, para rastreio).
  const consultaOperacoes = aplicarFiltros(
    supabase
      .from("sales")
      .select("id", { count: "exact", head: true })
      .neq("status", "cancelada"),
    false,
  );

  const tabelaPromise = (async () => {
    const r = await montarTabela(true);
    if (r.error?.code === "42703") return montarTabela(false);
    return r;
  })();

  // Funil + contas/ativações por pessoa + histórico de 3 meses, num único
  // round-trip (migração 0053). Sem a função no banco, os blocos novos somem
  // e a página segue de pé.
  const resumoPromise = supabase.rpc("pagamentos_resumo", {
    p_inicio: inicio,
  });

  // Metas por tipo (0050): tenta com as colunas novas e cai sem elas.
  const equipePromise = (async () => {
    const r = await supabase
      .from("profiles")
      .select(
        "id, nome, meta_mensal_centavos, meta_contas_mes, meta_ativacoes_mes",
      )
      .eq("ativo", true)
      .order("nome");
    if (r.error?.code === "42703") {
      return supabase
        .from("profiles")
        .select("id, nome, meta_mensal_centavos")
        .eq("ativo", true)
        .order("nome");
    }
    return r;
  })();

  const [
    tabela,
    { dados: confirmadas },
    { data: comparativo },
    { data: pendentesBrutos },
    { count: operacoes },
    { data: vendasMes },
    { data: equipe },
    { data: produtosLista },
    { data: resumoBruto },
  ] = await Promise.all([
    tabelaPromise,
    confirmadasPromise,
    comparativoPromise,
    pendentesPromise,
    consultaOperacoes,
    buscarTudo<{ vendedor_id: string; valor_comissao_centavos: number }>(
      (de2, ate2) =>
        supabase
          .from("sales")
          .select("vendedor_id, valor_comissao_centavos")
          .eq("status", "confirmada")
          .gte("ocorreu_em", inicioMes)
          .order("id")
          .range(de2, ate2),
    ).then((r) => ({ data: r.dados })),
    equipePromise,
    supabase.from("products").select("id, nome").order("nome"),
    resumoPromise,
  ]);

  const { data: vendas, count } = tabela as {
    data: unknown;
    count: number | null;
  };
  const linhas = (vendas ?? []) as unknown as Venda[];
  const total = count ?? 0;
  const totalPaginas = Math.max(1, Math.ceil(total / POR_PAGINA));

  const totalPeriodoCentavos = confirmadas.reduce(
    (s, v) => s + v.valor_comissao_centavos,
    0,
  );
  const anteriorCentavos = (
    (comparativo ?? null) as { valor_comissao_centavos: number }[] | null
  )?.reduce((s, v) => s + v.valor_comissao_centavos, 0);
  const vsAnterior =
    anteriorCentavos === undefined
      ? null
      : variacaoPct(totalPeriodoCentavos, anteriorCentavos);

  // Por produto: comissão, vendas e ticket médio (5.1) — das mesmas linhas.
  const nomeProduto = new Map(
    ((produtosLista ?? []) as { id: string; nome: string }[]).map((p) => [
      p.id,
      p.nome,
    ]),
  );
  const porProduto = [
    ...confirmadas
      .reduce((mapa, v) => {
        const atual = mapa.get(v.product_id) ?? { total: 0, vendas: 0 };
        atual.total += v.valor_comissao_centavos;
        atual.vendas += 1;
        mapa.set(v.product_id, atual);
        return mapa;
      }, new Map<string, { total: number; vendas: number }>())
      .entries(),
  ]
    .map(([id, agg]) => ({
      nome: nomeProduto.get(id) ?? "Produto removido",
      ...agg,
      ticket: agg.vendas > 0 ? Math.round(agg.total / agg.vendas) : 0,
    }))
    .sort((a, b) => b.total - a.total);

  // Série diária para o gráfico (5.2): comissão confirmada por dia. No
  // "Tudo" a série cobre os últimos 90 dias — mais que isso vira ruído.
  const DIA_MS = 86_400_000;
  const fimSerie = new Date();
  const inicioSerie = inicio
    ? new Date(inicio)
    : new Date(fimSerie.getTime() - 90 * DIA_MS);
  const chaveDia = (d: Date) =>
    new Intl.DateTimeFormat("en-CA", { timeZone: "America/Sao_Paulo" }).format(
      d,
    );
  const porDia = new Map<string, number>();
  for (const v of confirmadas) {
    const quando = new Date(v.ocorreu_em);
    if (quando < inicioSerie) continue;
    const chave = chaveDia(quando);
    porDia.set(chave, (porDia.get(chave) ?? 0) + v.valor_comissao_centavos);
  }
  const serie: { dia: string; total: number }[] = [];
  for (
    let d = new Date(inicioSerie);
    d <= fimSerie;
    d = new Date(d.getTime() + DIA_MS)
  ) {
    const chave = chaveDia(d);
    serie.push({ dia: chave, total: porDia.get(chave) ?? 0 });
  }

  // Pipeline de pendentes (5.5).
  type Pendente = {
    id: string;
    valor_comissao_centavos: number;
    ocorreu_em: string;
    vendedor: { id: string; nome: string } | null;
  };
  const pendentes = (pendentesBrutos ?? []) as unknown as Pendente[];
  const pendentesTotal = pendentes.reduce(
    (s, v) => s + v.valor_comissao_centavos,
    0,
  );
  // eslint-disable-next-line react-hooks/purity -- Server Component: um render por request
  const agoraMs = Date.now();
  const pendentesVelhas = pendentes.filter(
    (v) => agoraMs - new Date(v.ocorreu_em).getTime() > 7 * DIA_MS,
  ).length;
  // "Conversão" honesta possível sem histórico de status: confirmadas do
  // período vs pendentes em aberto, por vendedor.
  const porVendedorPend = new Map<
    string,
    { nome: string; pendentes: number }
  >();
  for (const v of pendentes) {
    const chave = v.vendedor?.id ?? "-";
    const atual = porVendedorPend.get(chave) ?? {
      nome: v.vendedor?.nome ?? "—",
      pendentes: 0,
    };
    atual.pendentes += 1;
    porVendedorPend.set(chave, atual);
  }

  // Comissão do mês por vendedor, para a barra de meta.
  const doMes = new Map<string, number>();
  for (const v of (vendasMes ?? []) as {
    vendedor_id: string;
    valor_comissao_centavos: number;
  }[]) {
    doMes.set(
      v.vendedor_id,
      (doMes.get(v.vendedor_id) ?? 0) + v.valor_comissao_centavos,
    );
  }

  // ----- Resumo agregado (0053): funil, por pessoa e histórico ---------------
  type ResumoRpc = {
    funil: { contas: number; ativadas: number; compraram: number };
    por_pessoa: {
      id: string;
      nome: string;
      contas_mes: number;
      ativacoes_mes: number;
      tempo_medio_dias: number | null;
    }[];
    historico: {
      pessoa: string;
      mes: string;
      comissao_centavos: number;
      contas: number;
      ativacoes: number;
    }[];
  };
  const resumo = (resumoBruto ?? null) as ResumoRpc | null;
  const pessoaResumo = new Map(
    (resumo?.por_pessoa ?? []).map((p) => [p.id, p]),
  );
  // Histórico por pessoa, meses em ordem (a RPC já ordena por mês).
  const historicoDe = new Map<string, ResumoRpc["historico"]>();
  for (const h of resumo?.historico ?? []) {
    const lista = historicoDe.get(h.pessoa) ?? [];
    lista.push(h);
    historicoDe.set(h.pessoa, lista);
  }

  // ----- Dias úteis do mês (Brasília), para a projeção -----------------------
  const hojeLocal = new Intl.DateTimeFormat("en-CA", {
    timeZone: "America/Sao_Paulo",
  }).format(new Date(agoraMs));
  const [anoBR, mesBR, diaBR] = hojeLocal.split("-").map(Number);
  const ultimoDia = new Date(Date.UTC(anoBR, mesBR, 0)).getUTCDate();
  let uteisTotal = 0;
  let uteisAteHoje = 0; // inclui hoje: o realizado já conta as vendas de hoje
  for (let d = 1; d <= ultimoDia; d++) {
    const semana = new Date(Date.UTC(anoBR, mesBR - 1, d)).getUTCDay();
    if (semana === 0 || semana === 6) continue;
    uteisTotal += 1;
    if (d <= diaBR) uteisAteHoje += 1;
  }
  const hojeUtil =
    new Date(Date.UTC(anoBR, mesBR - 1, diaBR)).getUTCDay() % 6 !== 0;
  // Para o "ritmo necessário" hoje ainda conta: dá tempo de agir hoje.
  const uteisRestantes = uteisTotal - uteisAteHoje + (hojeUtil ? 1 : 0);

  /** Projeção linear por dias úteis + estado vs meta + ritmo diário. */
  const projetar = (realizado: number, meta: number) => {
    const proj = Math.round(
      (realizado / Math.max(uteisAteHoje, 1)) * uteisTotal,
    );
    const estado =
      meta <= 0
        ? ("sem-meta" as const)
        : proj >= meta * 1.1
          ? ("acima" as const)
          : proj >= meta * 0.9
            ? ("ritmo" as const)
            : ("abaixo" as const);
    const falta = Math.max(meta - realizado, 0);
    const ritmoDia =
      meta <= 0
        ? 0
        : uteisRestantes > 0
          ? Math.ceil(falta / uteisRestantes)
          : falta;
    return { proj, estado, ritmoDia };
  };

  type PerfilMeta = {
    id: string;
    nome: string;
    meta_mensal_centavos: number;
    meta_contas_mes?: number;
    meta_ativacoes_mes?: number;
  };
  const metas = ((equipe ?? []) as PerfilMeta[])
    .map((v) => {
      const r = pessoaResumo.get(v.id);
      return {
        ...v,
        realizado: doMes.get(v.id) ?? 0,
        contas: r?.contas_mes ?? 0,
        ativacoes: r?.ativacoes_mes ?? 0,
        tempoMedio: r?.tempo_medio_dias ?? null,
      };
    })
    .filter(
      (v) =>
        v.meta_mensal_centavos > 0 ||
        (v.meta_contas_mes ?? 0) > 0 ||
        (v.meta_ativacoes_mes ?? 0) > 0 ||
        v.realizado > 0 ||
        v.contas > 0 ||
        v.ativacoes > 0,
    )
    .sort((a, b) => b.realizado - a.realizado);

  const conversao = (parte: number, todo: number) =>
    todo > 0 ? `${Math.round((parte / todo) * 100)}%` : "—";

  return (
    <div className="p-2 md:p-3">
      <header className="border-b border-neutral-200 pb-2">
        <h1 className="text-h1 text-neutral-900">Pagamentos</h1>
        <p className="mt-1 max-w-[68ch] text-base text-neutral-600">
          As últimas operações de venda da equipe. A venda é registrada na ficha
          do lead, com a comissão do dia.
        </p>
      </header>

      {aviso ? (
        <p
          role="alert"
          className="mt-2 max-w-[68ch] rounded-md border border-warning bg-warning-bg px-1.5 py-1 text-sm text-warning"
        >
          {aviso}
        </p>
      ) : null}

      <nav aria-label="Período" className="mt-2">
        <ul className="flex flex-wrap gap-1">
          {PERIODOS.map((p) => {
            const ativo = p.chave === periodo;
            return (
              <li key={p.chave}>
                <Link
                  href={
                    p.chave === "mes"
                      ? "/pagamentos"
                      : `/pagamentos?periodo=${p.chave}`
                  }
                  aria-current={ativo ? "page" : undefined}
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

      {/* Filtros combináveis com o período (5.1) */}
      <form
        action="/pagamentos"
        method="get"
        className="mt-2 flex flex-wrap items-center gap-1"
      >
        {periodo !== "mes" ? (
          <input type="hidden" name="periodo" value={periodo} />
        ) : null}
        <select
          name="v"
          defaultValue={fVendedor}
          aria-label="Filtrar por vendedor"
          className="h-[40px] max-w-[160px] rounded-md border border-neutral-300 bg-neutral-0 px-1 text-sm text-neutral-800 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-primary-500"
        >
          <option value="">Todo vendedor</option>
          {((equipe ?? []) as { id: string; nome: string }[]).map((p) => (
            <option key={p.id} value={p.id}>
              {p.nome}
            </option>
          ))}
        </select>
        <select
          name="p"
          defaultValue={fProduto}
          aria-label="Filtrar por produto"
          className="h-[40px] max-w-[190px] rounded-md border border-neutral-300 bg-neutral-0 px-1 text-sm text-neutral-800 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-primary-500"
        >
          <option value="">Todo produto</option>
          {((produtosLista ?? []) as { id: string; nome: string }[]).map(
            (p) => (
              <option key={p.id} value={p.id}>
                {p.nome}
              </option>
            ),
          )}
        </select>
        <select
          name="st"
          defaultValue={fStatus}
          aria-label="Filtrar por status"
          className="h-[40px] rounded-md border border-neutral-300 bg-neutral-0 px-1 text-sm text-neutral-800 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-primary-500"
        >
          <option value="">Todo status</option>
          <option value="confirmada">Confirmadas</option>
          <option value="pendente">Pendentes</option>
          <option value="cancelada">Canceladas</option>
        </select>
        <input
          name="q"
          defaultValue={fBusca}
          placeholder="Lead…"
          aria-label="Buscar por lead"
          className="h-[40px] w-[140px] rounded-md border border-neutral-300 bg-neutral-0 px-1.5 text-sm text-neutral-800 placeholder:text-neutral-400 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-primary-500"
        />
        <button
          type="submit"
          className="inline-flex h-[40px] items-center rounded-md border border-neutral-300 bg-neutral-0 px-1.5 text-sm font-medium text-neutral-800 transition-colors duration-[120ms] hover:bg-neutral-100 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-primary-500"
        >
          Filtrar
        </button>
        {ehGestor ? (
          <a
            href={`/api/exportar/vendas?periodo=${periodo}${fVendedor ? `&v=${fVendedor}` : ""}${fProduto ? `&p=${fProduto}` : ""}${fStatus ? `&st=${fStatus}` : ""}${fBusca ? `&q=${encodeURIComponent(fBusca)}` : ""}`}
            download
            className="inline-flex h-[40px] items-center rounded-md border border-neutral-300 bg-neutral-0 px-1.5 text-sm font-medium text-neutral-800 transition-colors duration-[120ms] hover:bg-neutral-100 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-primary-500"
          >
            Exportar CSV
          </a>
        ) : null}
      </form>

      <dl className="mt-3 grid gap-3 border-y border-neutral-200 py-3 sm:grid-cols-2">
        <div>
          <dt className="text-xs tracking-[0.06em] text-neutral-600 uppercase">
            Comissão confirmada no período
          </dt>
          <dd className="font-mono text-h1 text-neutral-900 tabular-nums">
            {formatarReais(totalPeriodoCentavos)}
            {vsAnterior ? (
              <span
                className={cn(
                  "ml-1 align-middle font-sans text-sm",
                  vsAnterior.startsWith("+") ? "text-success" : "text-danger",
                )}
              >
                vs anterior: {vsAnterior}
              </span>
            ) : null}
          </dd>
        </div>
        <div>
          <dt className="text-xs tracking-[0.06em] text-neutral-600 uppercase">
            Operações no período
          </dt>
          <dd className="font-mono text-h1 text-neutral-900 tabular-nums">
            {(operacoes ?? 0).toLocaleString("pt-BR")}
          </dd>
        </div>
      </dl>

      {/* Funil do período (5.3): conta aberta → ativada → comprou produto */}
      {resumo ? (
        <section aria-labelledby="funil-titulo" className="mt-3">
          <h2
            id="funil-titulo"
            className="text-xs tracking-[0.06em] text-neutral-600 uppercase"
          >
            Funil do período — toda a mesa
          </h2>
          <div className="mt-1 grid gap-1 sm:grid-cols-3">
            {(
              [
                {
                  rotulo: "Contas abertas",
                  valor: resumo.funil.contas,
                  de: null,
                },
                {
                  rotulo: "Clientes ativados",
                  valor: resumo.funil.ativadas,
                  de: resumo.funil.contas,
                },
                {
                  rotulo: "Compraram produto",
                  valor: resumo.funil.compraram,
                  de: resumo.funil.ativadas,
                },
              ] as const
            ).map((etapa) => (
              <div
                key={etapa.rotulo}
                className="rounded-lg border border-neutral-200 bg-neutral-0 p-2 shadow-sm"
              >
                <p className="text-xs text-neutral-600">{etapa.rotulo}</p>
                <p className="mt-0.5 font-mono text-h2 text-neutral-900 tabular-nums">
                  {etapa.valor.toLocaleString("pt-BR")}
                  {etapa.de !== null ? (
                    <span className="ml-1 align-middle font-sans text-sm text-neutral-600">
                      {conversao(etapa.valor, etapa.de)} da anterior
                    </span>
                  ) : null}
                </p>
              </div>
            ))}
          </div>
          <p className="mt-0.5 text-xs text-neutral-400">
            Contas = registros de venda de Abertura da equipe. Ativação = 1º
            lote da vida do cliente (planilha Genial), pelo dia real da
            operação. Cada etapa conta quem fez aquilo NO período — a ativação
            pode ser de conta aberta antes dele.
          </p>
        </section>
      ) : null}

      {/* Pipeline de pendentes (5.5) */}
      {pendentes.length > 0 ? (
        <section aria-labelledby="pendentes-titulo" className="mt-3">
          <div className="rounded-lg border border-accent-300 bg-accent-100 p-2">
            <h2 id="pendentes-titulo" className="text-h3 text-accent-700">
              {formatarReais(pendentesTotal)} em{" "}
              {pendentes.length === 1
                ? "1 venda pendente"
                : `${pendentes.length} vendas pendentes`}
            </h2>
            <p className="mt-0.5 text-sm text-accent-700">
              {pendentesVelhas > 0
                ? `${pendentesVelhas} há mais de 7 dias — confirmar ou cancelar. `
                : ""}
              Em aberto por vendedor:{" "}
              {[...porVendedorPend.values()]
                .map((v) => `${v.nome} ${v.pendentes}`)
                .join(" · ")}
              .
            </p>
          </div>
        </section>
      ) : null}

      {/* Comissão por dia (5.2) */}
      {serie.some((s2) => s2.total > 0) ? (
        <section aria-labelledby="grafico-titulo" className="mt-3">
          <h2
            id="grafico-titulo"
            className="text-xs tracking-[0.06em] text-neutral-600 uppercase"
          >
            Comissão confirmada por dia
            {periodo === "tudo" ? " (últimos 90 dias)" : ""}
          </h2>
          <GraficoLinha serie={serie} />
        </section>
      ) : null}

      {/* Por produto (5.1) */}
      {porProduto.length > 0 ? (
        <section aria-labelledby="produto-titulo" className="mt-3">
          <h2
            id="produto-titulo"
            className="text-xs tracking-[0.06em] text-neutral-600 uppercase"
          >
            Por produto
          </h2>
          <div className="mt-1 overflow-x-auto rounded-lg border border-neutral-200 bg-neutral-0 shadow-sm">
            <table className="w-full min-w-[440px] border-collapse text-left">
              <thead>
                <tr className="border-b border-neutral-200 bg-neutral-50">
                  <th className="px-2 py-1 text-xs tracking-[0.06em] text-neutral-600 uppercase">
                    Produto
                  </th>
                  <th className="px-2 py-1 text-right text-xs tracking-[0.06em] text-neutral-600 uppercase">
                    Vendas
                  </th>
                  <th className="px-2 py-1 text-right text-xs tracking-[0.06em] text-neutral-600 uppercase">
                    Comissão
                  </th>
                  <th className="px-2 py-1 text-right text-xs tracking-[0.06em] text-neutral-600 uppercase">
                    Ticket médio
                  </th>
                </tr>
              </thead>
              <tbody className="divide-y divide-neutral-200">
                {porProduto.map((pr) => (
                  <tr key={pr.nome} className="h-[48px]">
                    <td className="px-2 text-sm text-neutral-800">{pr.nome}</td>
                    <td className="px-2 text-right font-mono text-sm text-neutral-800 tabular-nums">
                      {pr.vendas}
                    </td>
                    <td className="px-2 text-right font-mono text-sm text-neutral-800 tabular-nums">
                      {formatarReais(pr.total)}
                    </td>
                    <td className="px-2 text-right font-mono text-sm text-neutral-600 tabular-nums">
                      {formatarReais(pr.ticket)}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </section>
      ) : null}

      {/* Metas do mês (5.4): R$ / contas / ativações com projeção */}
      {metas.length > 0 ? (
        <section aria-labelledby="metas-titulo" className="mt-3">
          <h2 id="metas-titulo" className="text-h3 text-neutral-900">
            Meta do mês por vendedor
          </h2>
          <p className="mt-0.5 text-sm text-neutral-600">
            Projeção pelo ritmo dos dias úteis:{" "}
            <span className="font-mono tabular-nums">
              {uteisAteHoje}/{uteisTotal}
            </span>{" "}
            já correram
            {resumo
              ? ""
              : " — rode a migração 0053 para ver contas e ativações"}
            .
          </p>
          <ul className="mt-2 flex flex-col gap-2">
            {metas.map((v) => {
              const hist = historicoDe.get(v.id) ?? [];
              const celulas = [
                {
                  rotulo: "Comissão",
                  realizado: v.realizado,
                  meta: v.meta_mensal_centavos,
                  dinheiro: true,
                  historico: hist.map((h) => ({
                    mes: h.mes,
                    valor: h.comissao_centavos,
                  })),
                },
                ...(resumo
                  ? [
                      {
                        rotulo: "Contas abertas",
                        realizado: v.contas,
                        meta: v.meta_contas_mes ?? 0,
                        dinheiro: false,
                        historico: hist.map((h) => ({
                          mes: h.mes,
                          valor: h.contas,
                        })),
                      },
                      {
                        rotulo: "Ativações",
                        realizado: v.ativacoes,
                        meta: v.meta_ativacoes_mes ?? 0,
                        dinheiro: false,
                        historico: hist.map((h) => ({
                          mes: h.mes,
                          valor: h.ativacoes,
                        })),
                      },
                    ]
                  : []),
              ];
              return (
                <li
                  key={v.id}
                  className="rounded-lg border border-neutral-200 bg-neutral-0 p-2 shadow-sm"
                >
                  <div className="flex flex-wrap items-baseline justify-between gap-1">
                    <h3 className="text-sm font-medium text-neutral-800">
                      {v.nome}
                    </h3>
                    {v.tempoMedio !== null ? (
                      <span
                        className="font-mono text-xs text-neutral-600 tabular-nums"
                        title="Tempo médio entre abrir a conta e o 1º lote — só contas abertas dentro do histórico de lotes (o resto não tem 1º lote confiável)"
                      >
                        abre→ativa: {v.tempoMedio}d
                      </span>
                    ) : null}
                  </div>
                  <div className="mt-1 grid gap-1 sm:grid-cols-3">
                    {celulas.map((c) => {
                      const { proj, estado, ritmoDia } = projetar(
                        c.realizado,
                        c.meta,
                      );
                      const pct =
                        c.meta > 0
                          ? Math.min((c.realizado / c.meta) * 100, 100)
                          : 0;
                      const fmt = (n: number) =>
                        c.dinheiro ? formatarReais(n) : String(n);
                      return (
                        <div
                          key={c.rotulo}
                          className="rounded-md border border-neutral-200 p-1.5"
                        >
                          <p className="text-xs text-neutral-600">{c.rotulo}</p>
                          <p className="mt-0.5 font-mono text-sm text-neutral-900 tabular-nums">
                            {fmt(c.realizado)}
                            <span className="text-neutral-400">
                              {c.meta > 0 ? ` / ${fmt(c.meta)}` : " · sem meta"}
                            </span>
                          </p>
                          <span
                            aria-hidden
                            className="mt-1 block h-0.5 overflow-hidden rounded-sm bg-neutral-100"
                          >
                            <span
                              className={cn(
                                "block h-full rounded-sm",
                                estado === "abaixo"
                                  ? "bg-danger"
                                  : c.meta > 0 && c.realizado >= c.meta
                                    ? "bg-success"
                                    : "bg-primary-500",
                              )}
                              style={{ width: `${pct}%` }}
                            />
                          </span>
                          {c.meta > 0 ? (
                            <p className="mt-1 text-xs">
                              <span
                                className={cn(
                                  "font-medium",
                                  estado === "acima"
                                    ? "text-success"
                                    : estado === "abaixo"
                                      ? "text-danger"
                                      : "text-neutral-600",
                                )}
                              >
                                {estado === "acima"
                                  ? "acima do ritmo"
                                  : estado === "abaixo"
                                    ? "abaixo do ritmo"
                                    : "no ritmo"}
                              </span>
                              <span className="text-neutral-600">
                                {" · proj. "}
                                <span className="font-mono tabular-nums">
                                  {fmt(proj)}
                                </span>
                                {ritmoDia > 0 && uteisRestantes > 0 ? (
                                  <>
                                    {" · falta "}
                                    <span className="font-mono tabular-nums">
                                      {fmt(ritmoDia)}
                                    </span>
                                    /dia útil
                                  </>
                                ) : null}
                              </span>
                            </p>
                          ) : null}
                          {c.historico.length > 1 ? (
                            <p className="mt-0.5 font-mono text-xs text-neutral-400 tabular-nums">
                              {c.historico
                                .map(
                                  (h) =>
                                    `${nomeMes(h.mes)} ${
                                      c.dinheiro
                                        ? reaisCompacto(h.valor)
                                        : h.valor
                                    }`,
                                )
                                .join(" · ")}
                            </p>
                          ) : null}
                        </div>
                      );
                    })}
                  </div>
                </li>
              );
            })}
          </ul>
        </section>
      ) : null}

      {/* Extrato */}
      <section aria-labelledby="extrato-titulo" className="mt-3 mb-3">
        <h2 id="extrato-titulo" className="text-h3 text-neutral-900">
          Últimas operações
        </h2>

        {linhas.length === 0 ? (
          <p className="mt-2 text-sm text-neutral-600">
            Nenhuma venda no período. Registre pela ficha do lead.
          </p>
        ) : (
          <>
            <div className="mt-2 overflow-x-auto rounded-lg border border-neutral-200 bg-neutral-0 shadow-sm">
              <table className="w-full min-w-[760px] border-collapse text-left">
                <thead>
                  <tr className="border-b border-neutral-200 bg-neutral-50">
                    <th
                      scope="col"
                      className="px-2 py-1 text-xs tracking-[0.06em] text-neutral-600 uppercase"
                    >
                      Data
                    </th>
                    <th
                      scope="col"
                      className="px-2 py-1 text-xs tracking-[0.06em] text-neutral-600 uppercase"
                    >
                      Lead
                    </th>
                    <th
                      scope="col"
                      className="px-2 py-1 text-xs tracking-[0.06em] text-neutral-600 uppercase"
                    >
                      Produto
                    </th>
                    <th
                      scope="col"
                      className="px-2 py-1 text-xs tracking-[0.06em] text-neutral-600 uppercase"
                    >
                      Vendedor
                    </th>
                    <th
                      scope="col"
                      className="px-2 py-1 text-right text-xs tracking-[0.06em] text-neutral-600 uppercase"
                    >
                      Comissão
                    </th>
                    <th
                      scope="col"
                      className="px-2 py-1 text-right text-xs tracking-[0.06em] text-neutral-600 uppercase"
                    >
                      <span className="sr-only">Ações</span>
                    </th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-neutral-200">
                  {linhas.map((venda) => {
                    const cancelada = venda.status === "cancelada";
                    const podeCancelar =
                      !cancelada &&
                      (ehGestor || venda.vendedor?.id === perfil?.id);
                    return (
                      <tr
                        key={venda.id}
                        className="h-[48px] hover:bg-neutral-50"
                      >
                        <td className="px-2 font-mono text-sm text-neutral-600 tabular-nums">
                          {formatarData(venda.ocorreu_em)}
                        </td>
                        <td className="max-w-[220px] truncate px-2">
                          {venda.lead ? (
                            <Link
                              href={`/leads/${venda.lead.id}?aba=vendas`}
                              className="rounded-sm text-sm font-medium text-neutral-800 underline-offset-2 hover:text-primary-600 hover:underline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-primary-500"
                            >
                              {venda.lead.nome}
                            </Link>
                          ) : (
                            <span className="text-sm text-neutral-400">—</span>
                          )}
                        </td>
                        <td className="px-2 text-sm text-neutral-800">
                          {venda.produto?.nome ?? "—"}
                          {venda.produto?.codigo ? (
                            <span className="ml-0.5 font-mono text-xs text-neutral-400">
                              {venda.produto.codigo}
                            </span>
                          ) : null}
                        </td>
                        <td className="max-w-[180px] truncate px-2 text-sm text-neutral-600">
                          {venda.vendedor?.nome ?? "—"}
                        </td>
                        <td
                          className={cn(
                            "px-2 text-right font-mono text-sm tabular-nums",
                            cancelada
                              ? "text-neutral-400 line-through"
                              : "text-neutral-900",
                          )}
                        >
                          {formatarReais(venda.valor_comissao_centavos)}
                          {venda.status === "pendente" ? (
                            <form
                              action={definirPrevista}
                              className="mt-0.5 flex items-center justify-end gap-0.5"
                            >
                              <input type="hidden" name="id" value={venda.id} />
                              <label
                                htmlFor={`prev-${venda.id}`}
                                className={cn(
                                  "text-xs",
                                  venda.prevista_em &&
                                    venda.prevista_em <
                                      new Date().toISOString().slice(0, 10)
                                    ? "font-medium text-danger"
                                    : "text-neutral-400",
                                )}
                              >
                                prev.
                              </label>
                              <input
                                id={`prev-${venda.id}`}
                                type="date"
                                name="prevista"
                                defaultValue={venda.prevista_em ?? ""}
                                className="h-[24px] rounded-sm border border-neutral-300 bg-neutral-0 px-0.5 font-mono text-xs text-neutral-800 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-primary-500"
                              />
                              <button
                                type="submit"
                                aria-label="Salvar data prevista"
                                className="rounded-sm px-0.5 text-xs text-primary-600 hover:underline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-primary-500"
                              >
                                ok
                              </button>
                            </form>
                          ) : null}
                        </td>
                        <td className="px-2 text-right">
                          {cancelada ? (
                            <span className="inline-flex h-[20px] items-center rounded-sm bg-neutral-100 px-1 text-xs text-neutral-400">
                              cancelada
                            </span>
                          ) : podeCancelar ? (
                            <form
                              action={cancelarVenda}
                              className="inline-flex"
                            >
                              <input type="hidden" name="id" value={venda.id} />
                              <button
                                type="submit"
                                aria-label={`Cancelar venda de ${venda.produto?.nome ?? "produto"} para ${venda.lead?.nome ?? "lead"}`}
                                title="Cancelar venda (sai dos totais, fica no histórico)"
                                className="inline-flex h-[40px] w-[40px] items-center justify-center rounded-md text-neutral-400 transition-colors duration-[120ms] hover:bg-danger-bg hover:text-danger focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-primary-500"
                              >
                                <Ban size={16} strokeWidth={1.5} aria-hidden />
                              </button>
                            </form>
                          ) : null}
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>

            <div className="mt-2 flex items-center justify-between gap-2">
              <p className="text-sm text-neutral-600">
                página{" "}
                <span className="font-mono tabular-nums">
                  {pagina}/{totalPaginas}
                </span>
              </p>
              <div className="flex gap-1">
                <PaginaLink
                  rotulo="Anterior"
                  desabilitado={pagina <= 1}
                  href={urlPagina(periodo, pagina - 1)}
                />
                <PaginaLink
                  rotulo="Próxima"
                  desabilitado={pagina >= totalPaginas}
                  href={urlPagina(periodo, pagina + 1)}
                />
              </div>
            </div>
          </>
        )}
      </section>
    </div>
  );
}

/** "2026-06" → "jun" — rótulo curto do mini-histórico. */
function nomeMes(anoMes: string) {
  const [ano, mes] = anoMes.split("-").map(Number);
  return new Date(Date.UTC(ano, mes - 1, 1))
    .toLocaleDateString("pt-BR", { month: "short", timeZone: "UTC" })
    .replace(".", "");
}

/** Centavos → "4,1k" / "830" — o histórico precisa caber em meia linha. */
function reaisCompacto(centavos: number) {
  const reais = centavos / 100;
  if (reais >= 1000) {
    return `${(reais / 1000).toLocaleString("pt-BR", { maximumFractionDigits: 1 })}k`;
  }
  return Math.round(reais).toLocaleString("pt-BR");
}

function urlPagina(periodo: ChavePeriodo, pagina: number) {
  const p = new URLSearchParams();
  if (periodo !== "mes") p.set("periodo", periodo);
  if (pagina > 1) p.set("pagina", String(pagina));
  const q = p.toString();
  return q ? `/pagamentos?${q}` : "/pagamentos";
}

function PaginaLink({
  rotulo,
  href,
  desabilitado,
}: {
  rotulo: string;
  href: string;
  desabilitado: boolean;
}) {
  if (desabilitado) {
    return (
      <span className="inline-flex h-[32px] items-center rounded-md border border-neutral-200 px-1.5 text-sm text-neutral-400">
        {rotulo}
      </span>
    );
  }
  return (
    <Link
      href={href}
      className="inline-flex h-[32px] items-center rounded-md border border-neutral-300 bg-neutral-0 px-1.5 text-sm text-neutral-800 transition-colors duration-[120ms] hover:bg-neutral-100 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-primary-500"
    >
      {rotulo}
    </Link>
  );
}

/**
 * Comissão por dia em SVG desenhado à mão: sem biblioteca, cores por token
 * (currentColor herda o tema claro/escuro). Área suave + linha + pontos de
 * pico, rótulos só onde informam (primeiro dia, último, maior valor).
 */
function GraficoLinha({ serie }: { serie: { dia: string; total: number }[] }) {
  const L = 720;
  const A = 120;
  const margem = { esq: 8, dir: 8, topo: 12, base: 20 };
  const maior = Math.max(...serie.map((p) => p.total), 1);
  const passo =
    serie.length > 1 ? (L - margem.esq - margem.dir) / (serie.length - 1) : 0;
  const y = (v: number) =>
    A - margem.base - (v / maior) * (A - margem.topo - margem.base);
  const pontos = serie.map(
    (p, i) => `${(margem.esq + i * passo).toFixed(1)},${y(p.total).toFixed(1)}`,
  );
  const area = `${margem.esq},${A - margem.base} ${pontos.join(" ")} ${(
    margem.esq +
    (serie.length - 1) * passo
  ).toFixed(1)},${A - margem.base}`;
  const iPico = serie.reduce(
    (melhor, p, i) => (p.total > serie[melhor].total ? i : melhor),
    0,
  );
  const rotuloDia = (iso: string) => {
    const [, m, d] = iso.split("-");
    return `${d}/${m}`;
  };

  return (
    <figure className="mt-1 overflow-x-auto rounded-lg border border-neutral-200 bg-neutral-0 p-2 shadow-sm">
      <svg
        viewBox={`0 0 ${L} ${A}`}
        role="img"
        aria-label={`Comissão confirmada por dia; pico de ${formatarReais(serie[iPico].total)} em ${rotuloDia(serie[iPico].dia)}.`}
        className="h-auto w-full min-w-[440px] text-neutral-800"
      >
        <line
          x1={margem.esq}
          y1={A - margem.base}
          x2={L - margem.dir}
          y2={A - margem.base}
          stroke="currentColor"
          strokeWidth="1"
          opacity=".2"
        />
        <polygon points={area} fill="var(--color-primary-500)" opacity=".12" />
        <polyline
          points={pontos.join(" ")}
          fill="none"
          stroke="var(--color-primary-500)"
          strokeWidth="2"
          strokeLinejoin="round"
          strokeLinecap="round"
        />
        {serie[iPico].total > 0 ? (
          <>
            <circle
              cx={margem.esq + iPico * passo}
              cy={y(serie[iPico].total)}
              r="3.5"
              fill="var(--color-primary-500)"
            />
            <text
              x={Math.min(Math.max(margem.esq + iPico * passo, 40), L - 60)}
              y={Math.max(y(serie[iPico].total) - 8, 10)}
              textAnchor="middle"
              fontSize="11"
              fontFamily="var(--font-geist-mono, monospace)"
              fill="currentColor"
            >
              {formatarReais(serie[iPico].total)}
            </text>
          </>
        ) : null}
        <text
          x={margem.esq}
          y={A - 6}
          fontSize="10"
          fontFamily="var(--font-geist-mono, monospace)"
          fill="currentColor"
          opacity=".55"
        >
          {rotuloDia(serie[0].dia)}
        </text>
        <text
          x={L - margem.dir}
          y={A - 6}
          textAnchor="end"
          fontSize="10"
          fontFamily="var(--font-geist-mono, monospace)"
          fill="currentColor"
          opacity=".55"
        >
          {rotuloDia(serie[serie.length - 1].dia)}
        </text>
      </svg>
      <figcaption className="sr-only">
        Evolução diária da comissão confirmada no período.
      </figcaption>
    </figure>
  );
}
