import type { Metadata } from "next";
import Link from "next/link";
import { Ban } from "lucide-react";
import { createClient } from "@/lib/supabase/server";
import { perfilAtual } from "@/lib/auth";
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
function janelaAnterior(chave: ChavePeriodo): { de: string; ate: string } | null {
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
  const ehGestor = perfil?.papel === "admin" || perfil?.papel === "gestor";

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

  const relacaoLead = fBusca ? "lead:leads!inner(id, nome)" : "lead:leads(id, nome)";
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
  const comparativoPromise = anterior
    ? (() => {
        // eslint-disable-next-line @typescript-eslint/no-explicit-any -- idem
        let q: any = supabase
          .from("sales")
          .select("valor_comissao_centavos")
          .eq("status", "confirmada")
          .gte("ocorreu_em", anterior.de)
          .lt("ocorreu_em", anterior.ate);
        if (fVendedor) q = q.eq("vendedor_id", fVendedor);
        if (fProduto) q = q.eq("product_id", fProduto);
        return q;
      })()
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

  const [
    tabela,
    { dados: confirmadas },
    { data: comparativo },
    { data: pendentesBrutos },
    { count: operacoes },
    { data: vendasMes },
    { data: equipe },
    { data: produtosLista },
  ] = await Promise.all([
    tabelaPromise,
    confirmadasPromise,
    comparativoPromise,
    pendentesPromise,
    consultaOperacoes,
    supabase
      .from("sales")
      .select("vendedor_id, valor_comissao_centavos")
      .eq("status", "confirmada")
      .gte("ocorreu_em", inicioMes),
    supabase
      .from("profiles")
      .select("id, nome, meta_mensal_centavos")
      .eq("ativo", true)
      .order("nome"),
    supabase.from("products").select("id, nome").order("nome"),
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
    new Intl.DateTimeFormat("en-CA", { timeZone: "America/Sao_Paulo" }).format(d);
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
  const pendentes = ((pendentesBrutos ?? []) as unknown as Pendente[]);
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
  const porVendedorPend = new Map<string, { nome: string; pendentes: number }>();
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

  const metas = (
    (equipe ?? []) as { id: string; nome: string; meta_mensal_centavos: number }[]
  )
    .map((v) => ({
      ...v,
      realizado: doMes.get(v.id) ?? 0,
    }))
    .filter((v) => v.meta_mensal_centavos > 0 || v.realizado > 0)
    .sort((a, b) => b.realizado - a.realizado);

  return (
    <div className="p-2 md:p-3">
      <header className="border-b border-neutral-200 pb-2">
        <h1 className="text-h1 text-neutral-900">Pagamentos</h1>
        <p className="mt-1 max-w-[68ch] text-base text-neutral-600">
          As últimas operações de venda da equipe. A venda é registrada na
          ficha do lead, com a comissão do dia.
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
                  href={p.chave === "mes" ? "/pagamentos" : `/pagamentos?periodo=${p.chave}`}
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
      <form action="/pagamentos" method="get" className="mt-2 flex flex-wrap items-center gap-1">
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
          {((produtosLista ?? []) as { id: string; nome: string }[]).map((p) => (
            <option key={p.id} value={p.id}>
              {p.nome}
            </option>
          ))}
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

      {/* Metas do mês */}
      {metas.length > 0 ? (
        <section aria-labelledby="metas-titulo" className="mt-3">
          <h2 id="metas-titulo" className="text-h3 text-neutral-900">
            Meta do mês por vendedor
          </h2>
          <ul className="mt-2 flex max-w-[680px] flex-col gap-1">
            {metas.map((v) => {
              const pct =
                v.meta_mensal_centavos > 0
                  ? Math.min((v.realizado / v.meta_mensal_centavos) * 100, 100)
                  : 0;
              const bateu =
                v.meta_mensal_centavos > 0 && v.realizado >= v.meta_mensal_centavos;
              return (
                // flex-wrap: em 375px o valor desce para a linha de baixo em
                // vez de estourar a borda e criar rolagem horizontal.
                <li key={v.id} className="flex flex-wrap items-center gap-1">
                  <span className="w-[180px] shrink-0 truncate text-sm text-neutral-800">
                    {v.nome}
                  </span>
                  <span
                    aria-hidden
                    className="h-1 min-w-[120px] flex-1 overflow-hidden rounded-sm bg-neutral-100"
                  >
                    <span
                      className={cn(
                        "block h-full rounded-sm",
                        bateu ? "bg-success" : "bg-primary-500",
                      )}
                      style={{ width: `${pct}%` }}
                    />
                  </span>
                  <span className="ml-auto w-[176px] shrink-0 text-right font-mono text-xs text-neutral-600 tabular-nums">
                    {formatarReais(v.realizado)}
                    {v.meta_mensal_centavos > 0
                      ? ` / ${formatarReais(v.meta_mensal_centavos)}`
                      : " · sem meta"}
                  </span>
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
                    <th scope="col" className="px-2 py-1 text-xs tracking-[0.06em] text-neutral-600 uppercase">
                      Data
                    </th>
                    <th scope="col" className="px-2 py-1 text-xs tracking-[0.06em] text-neutral-600 uppercase">
                      Lead
                    </th>
                    <th scope="col" className="px-2 py-1 text-xs tracking-[0.06em] text-neutral-600 uppercase">
                      Produto
                    </th>
                    <th scope="col" className="px-2 py-1 text-xs tracking-[0.06em] text-neutral-600 uppercase">
                      Vendedor
                    </th>
                    <th scope="col" className="px-2 py-1 text-right text-xs tracking-[0.06em] text-neutral-600 uppercase">
                      Comissão
                    </th>
                    <th scope="col" className="px-2 py-1 text-right text-xs tracking-[0.06em] text-neutral-600 uppercase">
                      <span className="sr-only">Ações</span>
                    </th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-neutral-200">
                  {linhas.map((venda) => {
                    const cancelada = venda.status === "cancelada";
                    const podeCancelar =
                      !cancelada && (ehGestor || venda.vendedor?.id === perfil?.id);
                    return (
                      <tr key={venda.id} className="h-[48px] hover:bg-neutral-50">
                        <td className="px-2 font-mono text-sm text-neutral-600 tabular-nums">
                          {formatarData(venda.ocorreu_em)}
                        </td>
                        <td className="max-w-[220px] truncate px-2">
                          {venda.lead ? (
                            <Link
                              href={`/leads/${venda.lead.id}`}
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
                            <form action={cancelarVenda} className="inline-flex">
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
        <polygon
          points={area}
          fill="var(--color-primary-500)"
          opacity=".12"
        />
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
              x={Math.min(
                Math.max(margem.esq + iPico * passo, 40),
                L - 60,
              )}
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
