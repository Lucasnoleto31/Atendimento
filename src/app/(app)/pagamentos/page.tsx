import type { Metadata } from "next";
import Link from "next/link";
import { Ban } from "lucide-react";
import { createClient } from "@/lib/supabase/server";
import { perfilAtual } from "@/lib/auth";
import { formatarData, formatarReais } from "@/lib/format";
import { cn } from "@/lib/utils";
import { cancelarVenda } from "./actions";

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
  lead: { id: string; nome: string } | null;
  produto: { nome: string; codigo: string } | null;
  vendedor: { id: string; nome: string } | null;
};

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

  const perfil = await perfilAtual();
  const ehGestor = perfil?.papel === "admin" || perfil?.papel === "gestor";

  const supabase = await createClient();
  const inicio = inicioDoPeriodo(periodo);
  const de = (pagina - 1) * POR_PAGINA;

  let consulta = supabase
    .from("sales")
    .select(
      `id, valor_comissao_centavos, status, ocorreu_em, observacao,
       lead:leads(id, nome),
       produto:products(nome, codigo),
       vendedor:profiles(id, nome)`,
      { count: "exact" },
    )
    .order("ocorreu_em", { ascending: false })
    .range(de, de + POR_PAGINA - 1);
  if (inicio) consulta = consulta.gte("ocorreu_em", inicio);

  const inicioMes = inicioDoPeriodo("mes")!;

  let consultaTotais = supabase
    .from("sales")
    .select("valor_comissao_centavos")
    .eq("status", "confirmada");
  if (inicio) consultaTotais = consultaTotais.gte("ocorreu_em", inicio);

  const [
    { data: vendas, count },
    { data: totaisPeriodo },
    { data: vendasMes },
    { data: equipe },
  ] = await Promise.all([
    consulta,
    consultaTotais,
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
  ]);

  const linhas = (vendas ?? []) as unknown as Venda[];
  const total = count ?? 0;
  const totalPaginas = Math.max(1, Math.ceil(total / POR_PAGINA));

  const totalPeriodoCentavos = (
    (totaisPeriodo ?? []) as { valor_comissao_centavos: number }[]
  ).reduce((s, v) => s + v.valor_comissao_centavos, 0);

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

      <dl className="mt-3 grid gap-3 border-y border-neutral-200 py-3 sm:grid-cols-2">
        <div>
          <dt className="text-xs tracking-[0.06em] text-neutral-600 uppercase">
            Comissão confirmada no período
          </dt>
          <dd className="font-mono text-h1 text-neutral-900 tabular-nums">
            {formatarReais(totalPeriodoCentavos)}
          </dd>
        </div>
        <div>
          <dt className="text-xs tracking-[0.06em] text-neutral-600 uppercase">
            Operações no período
          </dt>
          <dd className="font-mono text-h1 text-neutral-900 tabular-nums">
            {total.toLocaleString("pt-BR")}
          </dd>
        </div>
      </dl>

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
