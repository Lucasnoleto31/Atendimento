import type { Metadata } from "next";
import Link from "next/link";
import { Download, MessageSquare, Search, UserRound } from "lucide-react";
import { createClient } from "@/lib/supabase/server";
import { buscarTudo } from "@/lib/supabase/paginar";
import { perfilAtual } from "@/lib/auth";
import { formatarReais, formatarTelefone } from "@/lib/format";
import { cn } from "@/lib/utils";

export const metadata: Metadata = { title: "Carteira · Zeve CRM" };

// A tela pagina de verdade: o PostgREST corta em 1000 por resposta e jogar
// milhares de linhas em HTML pesa demais no celular.
const POR_PAGINA = 100;

const FILTROS_STATUS = [
  { chave: "todos", rotulo: "Todos" },
  { chave: "em_risco", rotulo: "Em risco" },
  { chave: "ativo", rotulo: "Ativos" },
  { chave: "reativado", rotulo: "Reativados" },
  { chave: "churn", rotulo: "Churn" },
] as const;

const ROTULO_STATUS: Record<string, { texto: string; classe: string }> = {
  ativo: { texto: "Ativo", classe: "bg-success-bg text-success" },
  em_risco: { texto: "Em risco", classe: "bg-warning-bg text-warning" },
  reativado: { texto: "Reativado", classe: "bg-info-bg text-info" },
  churn: { texto: "Churn", classe: "bg-danger-bg text-danger" },
};

type LinhaCarteira = {
  customer_id: string;
  nome_completo: string;
  status: string;
  segmento: string | null;
  conta_aberta_em: string | null;
  responsavel_id: string | null;
  responsavel_nome: string | null;
  lotes_30d: number | null;
  lotes_30d_anterior: number | null;
  ultimo_giro_em: string | null;
  dias_sem_giro: number | null;
  receita_30d_centavos: number | null;
  ltv_centavos: number | null;
  lead_id: string | null;
  telefone_e164: string | null;
  dias_sem_contato: number | null;
};

type LinhaResumo = {
  status: string;
  receita_30d_centavos: number | null;
  responsavel_nome: string | null;
};

export default async function CarteiraPage({
  searchParams,
}: PageProps<"/carteira">) {
  const params = await searchParams;
  const perfil = await perfilAtual();
  const ehGestor = perfil?.papel === "admin" || perfil?.papel === "gestor";
  const filtro =
    params.f === "minha" || (!ehGestor && params.f !== "todas")
      ? "minha"
      : "todas";
  const statusFiltro = (
    FILTROS_STATUS.some((s) => s.chave === params.s) ? params.s : "todos"
  ) as string;
  const busca = typeof params.q === "string" ? params.q.trim() : "";
  const pagina = Math.max(1, Number(params.pagina) || 1);

  const supabase = await createClient();

  /** Filtros comuns ao resumo e à listagem. */
  function aplicarFiltros<T>(q: T): T {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any -- corta a recursão de tipos do builder
    let consulta: any = q;
    if (filtro === "minha" && perfil) {
      consulta = consulta.eq("responsavel_id", perfil.id);
    }
    if (statusFiltro !== "todos") consulta = consulta.eq("status", statusFiltro);
    if (busca) {
      const digitos = busca.replace(/\D/g, "");
      consulta =
        digitos.length >= 4
          ? consulta.or(
              `nome_completo.ilike.%${busca}%,telefone_e164.ilike.%${digitos}%`,
            )
          : consulta.ilike("nome_completo", `%${busca}%`);
    }
    return consulta as T;
  }

  // Resumo sobre a base INTEIRA (em lotes de 1000), não sobre a página.
  const { dados: resumo, erro: erroResumo } = await buscarTudo<LinhaResumo>(
    (de, ate) =>
      aplicarFiltros(
        supabase
          .from("v_carteira")
          .select("status, receita_30d_centavos, responsavel_nome")
          .order("customer_id"),
      ).range(de, ate),
  );

  // Página visível, ordenada pelo mais parado primeiro.
  const de = (pagina - 1) * POR_PAGINA;
  const { data: dadosPagina, count } = await aplicarFiltros(
    supabase
      .from("v_carteira")
      .select("*", { count: "exact" })
      .order("ultimo_giro_em", { ascending: true, nullsFirst: true })
      .order("customer_id"),
  ).range(de, de + POR_PAGINA - 1);

  const linhas = (dadosPagina ?? []) as unknown as LinhaCarteira[];
  const total = count ?? resumo.length;
  const totalPaginas = Math.max(1, Math.ceil(total / POR_PAGINA));

  const contagem = (status: string) =>
    resumo.filter((l) => l.status === status).length;
  const receita30d = resumo.reduce(
    (s, l) => s + (l.receita_30d_centavos ?? 0),
    0,
  );
  const temReceita = receita30d > 0;

  // Visão do gestor: saúde por assessor, sobre a base inteira.
  const porAssessor = new Map<
    string,
    { total: number; emRisco: number; churn: number; receita: number }
  >();
  if (ehGestor && filtro === "todas") {
    for (const linha of resumo) {
      const nome = linha.responsavel_nome ?? "Sem dono";
      const atual =
        porAssessor.get(nome) ?? { total: 0, emRisco: 0, churn: 0, receita: 0 };
      atual.total++;
      if (linha.status === "em_risco") atual.emRisco++;
      if (linha.status === "churn") atual.churn++;
      atual.receita += linha.receita_30d_centavos ?? 0;
      porAssessor.set(nome, atual);
    }
  }

  const dataCurta = (iso: string | null) =>
    iso
      ? new Date(`${iso.slice(0, 10)}T12:00:00`).toLocaleDateString("pt-BR")
      : "—";

  const url = (novos: Record<string, string>) => {
    const p = new URLSearchParams();
    if (filtro === "minha") p.set("f", "minha");
    else if (ehGestor) p.set("f", "todas");
    if (statusFiltro !== "todos") p.set("s", statusFiltro);
    if (busca) p.set("q", busca);
    for (const [k, v] of Object.entries(novos)) {
      if (v) p.set(k, v);
      else p.delete(k);
    }
    const q = p.toString();
    return q ? `/carteira?${q}` : "/carteira";
  };

  return (
    <div className="flex min-h-full flex-col p-2 md:p-3">
      <header className="border-b border-neutral-200 pb-2">
        <h1 className="text-h1 text-neutral-900">Carteira</h1>
        <p className="mt-1 max-w-[68ch] text-sm text-neutral-600">
          Os clientes da assessoria por saúde de giro — quem está parado há mais
          tempo aparece primeiro, para o resgate acontecer antes do churn.
        </p>
      </header>

      {erroResumo ? (
        <p
          role="alert"
          className="mt-2 max-w-[68ch] rounded-md bg-warning-bg px-1.5 py-1 text-sm text-warning"
        >
          A Carteira depende da migração 0015
          (supabase/migrations/0015_retencao.sql) — rode-a no SQL Editor do
          Supabase.
        </p>
      ) : (
        <>
          <dl className="mt-2 grid gap-2 border-b border-neutral-200 pb-2 sm:grid-cols-2 lg:grid-cols-4">
            {(
              [
                ["Em risco", contagem("em_risco"), "text-warning"],
                ["Ativos", contagem("ativo"), "text-success"],
                ["Reativados", contagem("reativado"), "text-info"],
                ["Churn", contagem("churn"), "text-danger"],
              ] as const
            ).map(([rotulo, valor, cor]) => (
              <div key={rotulo}>
                <dt className="text-xs font-medium tracking-[0.06em] text-neutral-600 uppercase">
                  {rotulo}
                </dt>
                <dd className={cn("font-mono text-h2 tabular-nums", cor)}>
                  {valor}
                </dd>
              </div>
            ))}
          </dl>

          <p className="mt-1 text-sm text-neutral-600">
            <span className="font-mono font-medium text-neutral-800 tabular-nums">
              {total}
            </span>{" "}
            cliente(s) no filtro atual
            {temReceita ? (
              <>
                {" · receita estimada (30d): "}
                <span className="font-mono font-medium text-neutral-800 tabular-nums">
                  {formatarReais(receita30d)}
                </span>
              </>
            ) : null}
          </p>

          <nav
            aria-label="Filtros da carteira"
            className="mt-2 flex flex-wrap gap-1"
          >
            {ehGestor ? (
              <>
                {(
                  [
                    ["todas", "Toda a base"],
                    ["minha", "Minha carteira"],
                  ] as const
                ).map(([chave, rotulo]) => (
                  <Link
                    key={chave}
                    href={url({ f: chave, pagina: "" })}
                    aria-current={filtro === chave ? "page" : undefined}
                    className={cn(
                      "inline-flex h-[32px] items-center rounded-md px-1.5 text-sm transition-colors duration-[120ms] focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-primary-500",
                      filtro === chave
                        ? "bg-primary-50 font-medium text-primary-900"
                        : "text-neutral-600 hover:bg-neutral-100 hover:text-neutral-800",
                    )}
                  >
                    {rotulo}
                  </Link>
                ))}
                <span aria-hidden className="mx-0.5 self-center text-neutral-300">
                  ·
                </span>
              </>
            ) : null}
            {FILTROS_STATUS.map((s) => (
              <Link
                key={s.chave}
                href={url({ s: s.chave === "todos" ? "" : s.chave, pagina: "" })}
                aria-current={statusFiltro === s.chave ? "page" : undefined}
                className={cn(
                  "inline-flex h-[32px] items-center rounded-md px-1.5 text-sm transition-colors duration-[120ms] focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-primary-500",
                  statusFiltro === s.chave
                    ? "bg-primary-50 font-medium text-primary-900"
                    : "text-neutral-600 hover:bg-neutral-100 hover:text-neutral-800",
                )}
              >
                {s.rotulo}
              </Link>
            ))}
          </nav>

          <div className="mt-2 flex flex-wrap items-center gap-1">
            <form action="/carteira" method="get" className="flex gap-1">
              {filtro === "minha" ? (
                <input type="hidden" name="f" value="minha" />
              ) : ehGestor ? (
                <input type="hidden" name="f" value="todas" />
              ) : null}
              {statusFiltro !== "todos" ? (
                <input type="hidden" name="s" value={statusFiltro} />
              ) : null}
              <label htmlFor="busca-carteira" className="sr-only">
                Buscar cliente por nome ou telefone
              </label>
              <input
                id="busca-carteira"
                name="q"
                defaultValue={busca}
                placeholder="Nome ou telefone…"
                className="h-[40px] w-[220px] rounded-md border border-neutral-300 bg-neutral-0 px-1.5 text-base text-neutral-800 placeholder:text-neutral-400 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-primary-500"
              />
              <button
                type="submit"
                aria-label="Buscar"
                className="inline-flex h-[40px] w-[40px] shrink-0 items-center justify-center rounded-md border border-neutral-300 bg-neutral-0 text-neutral-600 transition-colors duration-[120ms] hover:bg-neutral-100 hover:text-neutral-800 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-primary-500"
              >
                <Search size={18} strokeWidth={1.5} aria-hidden />
              </button>
            </form>
            <a
              href={`/api/exportar/carteira?f=${filtro}&s=${statusFiltro}${busca ? `&q=${encodeURIComponent(busca)}` : ""}`}
              download
              className="inline-flex h-[40px] items-center gap-0.5 rounded-md border border-neutral-300 bg-neutral-0 px-2 text-sm font-medium text-neutral-800 transition-colors duration-[120ms] hover:bg-neutral-100 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-primary-500"
            >
              <Download size={18} strokeWidth={1.5} aria-hidden />
              Exportar tudo em CSV
            </a>
          </div>

          {porAssessor.size > 0 ? (
            <div className="mt-2 overflow-x-auto rounded-lg border border-neutral-200 bg-neutral-0 shadow-sm">
              <table className="w-full min-w-[480px] border-collapse text-left">
                <thead>
                  <tr className="border-b border-neutral-200 bg-neutral-50">
                    <Th>Assessor</Th>
                    <Th alinhar="right">Clientes</Th>
                    <Th alinhar="right">Em risco</Th>
                    <Th alinhar="right">Churn</Th>
                    {temReceita ? <Th alinhar="right">Receita 30d</Th> : null}
                  </tr>
                </thead>
                <tbody className="divide-y divide-neutral-200">
                  {[...porAssessor.entries()]
                    .sort((a, b) => b[1].emRisco - a[1].emRisco)
                    .map(([nome, r]) => (
                      <tr key={nome} className="h-[40px]">
                        <td className="px-2 text-sm text-neutral-800">{nome}</td>
                        <td className="px-2 text-right font-mono text-sm text-neutral-800 tabular-nums">
                          {r.total}
                        </td>
                        <td
                          className={cn(
                            "px-2 text-right font-mono text-sm tabular-nums",
                            r.emRisco > 0
                              ? "font-medium text-warning"
                              : "text-neutral-600",
                          )}
                        >
                          {r.emRisco}
                        </td>
                        <td className="px-2 text-right font-mono text-sm text-neutral-600 tabular-nums">
                          {r.churn}
                        </td>
                        {temReceita ? (
                          <td className="px-2 text-right font-mono text-sm text-neutral-800 tabular-nums">
                            {formatarReais(r.receita)}
                          </td>
                        ) : null}
                      </tr>
                    ))}
                </tbody>
              </table>
            </div>
          ) : null}

          {linhas.length === 0 ? (
            <div className="mt-3 max-w-[68ch] rounded-lg border border-neutral-200 bg-neutral-0 p-3 shadow-sm">
              <h2 className="text-h3 text-neutral-900">Nada neste filtro</h2>
              <p className="mt-1 text-sm text-neutral-600">
                {busca
                  ? "Nenhum cliente corresponde à busca."
                  : "Os clientes entram aqui pela importação diária de clientes e lotes, na Administração."}
              </p>
            </div>
          ) : (
            <>
              <div className="mt-2 overflow-x-auto rounded-lg border border-neutral-200 bg-neutral-0 shadow-sm">
                <table className="w-full min-w-[960px] border-collapse text-left">
                  <thead>
                    <tr className="border-b border-neutral-200 bg-neutral-50">
                      <Th>Cliente</Th>
                      <Th>Saúde</Th>
                      <Th alinhar="right">Lotes 30d</Th>
                      <Th alinhar="right">Sem giro há</Th>
                      {temReceita ? <Th alinhar="right">Receita 30d</Th> : null}
                      <Th alinhar="right">Sem contato há</Th>
                      <Th>Responsável</Th>
                      <Th>
                        <span className="sr-only">Ações</span>
                      </Th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-neutral-200">
                    {linhas.map((linha) => {
                      const status = ROTULO_STATUS[linha.status] ?? {
                        texto: linha.status,
                        classe: "bg-neutral-100 text-neutral-600",
                      };
                      const variacao =
                        linha.lotes_30d !== null &&
                        linha.lotes_30d_anterior !== null &&
                        linha.lotes_30d_anterior > 0
                          ? Math.round(
                              ((linha.lotes_30d - linha.lotes_30d_anterior) /
                                linha.lotes_30d_anterior) *
                                100,
                            )
                          : null;
                      return (
                        <tr
                          key={linha.customer_id}
                          className="h-[48px] hover:bg-neutral-50"
                        >
                          <td className="px-2">
                            <span className="block max-w-[260px] truncate text-sm font-medium text-neutral-800">
                              {linha.nome_completo}
                            </span>
                            <span className="block font-mono text-xs text-neutral-600 tabular-nums">
                              {linha.telefone_e164
                                ? formatarTelefone(linha.telefone_e164)
                                : "sem telefone"}
                              {linha.conta_aberta_em
                                ? ` · conta ${dataCurta(linha.conta_aberta_em)}`
                                : ""}
                            </span>
                          </td>
                          <td className="px-2">
                            <span
                              className={cn(
                                "inline-flex h-[20px] items-center rounded-sm px-1 text-xs font-medium",
                                status.classe,
                              )}
                            >
                              {status.texto}
                            </span>
                            {linha.segmento ? (
                              <span className="mt-0.5 block text-xs text-neutral-400 capitalize">
                                {linha.segmento}
                              </span>
                            ) : null}
                          </td>
                          <td className="px-2 text-right font-mono text-sm text-neutral-800 tabular-nums">
                            {linha.lotes_30d ?? 0}
                            {variacao !== null ? (
                              <span
                                className={cn(
                                  "ml-0.5 text-xs",
                                  variacao < 0 ? "text-danger" : "text-success",
                                )}
                              >
                                {variacao > 0 ? `+${variacao}%` : `${variacao}%`}
                              </span>
                            ) : null}
                          </td>
                          <td
                            className={cn(
                              "px-2 text-right font-mono text-sm tabular-nums",
                              (linha.dias_sem_giro ?? 0) > 14
                                ? "font-medium text-warning"
                                : "text-neutral-600",
                            )}
                          >
                            {linha.ultimo_giro_em === null
                              ? "nunca girou"
                              : `${linha.dias_sem_giro}d`}
                          </td>
                          {temReceita ? (
                            <td className="px-2 text-right font-mono text-sm text-neutral-800 tabular-nums">
                              {formatarReais(linha.receita_30d_centavos ?? 0)}
                            </td>
                          ) : null}
                          <td className="px-2 text-right font-mono text-sm text-neutral-600 tabular-nums">
                            {linha.dias_sem_contato === null
                              ? "—"
                              : `${linha.dias_sem_contato}d`}
                          </td>
                          <td className="max-w-[140px] truncate px-2 text-sm text-neutral-600">
                            {linha.responsavel_nome ?? "sem dono"}
                          </td>
                          <td className="px-2">
                            {linha.lead_id ? (
                              <span className="inline-flex items-center">
                                <Link
                                  href={`/chat?lead=${linha.lead_id}`}
                                  aria-label={`Abrir conversa com ${linha.nome_completo}`}
                                  title="Abrir no chat"
                                  className="inline-flex h-[40px] w-[40px] items-center justify-center rounded-md text-neutral-600 transition-colors duration-[120ms] hover:bg-neutral-100 hover:text-primary-600 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-primary-500"
                                >
                                  <MessageSquare
                                    size={18}
                                    strokeWidth={1.5}
                                    aria-hidden
                                  />
                                </Link>
                                <Link
                                  href={`/leads/${linha.lead_id}`}
                                  aria-label={`Abrir ficha de ${linha.nome_completo}`}
                                  title="Abrir ficha"
                                  className="inline-flex h-[40px] w-[40px] items-center justify-center rounded-md text-neutral-600 transition-colors duration-[120ms] hover:bg-neutral-100 hover:text-primary-600 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-primary-500"
                                >
                                  <UserRound
                                    size={18}
                                    strokeWidth={1.5}
                                    aria-hidden
                                  />
                                </Link>
                              </span>
                            ) : (
                              <span className="text-xs text-neutral-400">
                                sem lead
                              </span>
                            )}
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>

              <div className="mt-2 flex flex-wrap items-center justify-between gap-2">
                <p className="text-sm text-neutral-600">
                  Mostrando{" "}
                  <span className="font-mono tabular-nums">
                    {de + 1}–{Math.min(de + POR_PAGINA, total)}
                  </span>{" "}
                  de <span className="font-mono tabular-nums">{total}</span> ·
                  página{" "}
                  <span className="font-mono tabular-nums">
                    {pagina}/{totalPaginas}
                  </span>
                </p>
                <div className="flex gap-1">
                  <PaginaLink
                    rotulo="Anterior"
                    desabilitado={pagina <= 1}
                    href={url({ pagina: String(pagina - 1) })}
                  />
                  <PaginaLink
                    rotulo="Próxima"
                    desabilitado={pagina >= totalPaginas}
                    href={url({ pagina: String(pagina + 1) })}
                  />
                </div>
              </div>
            </>
          )}
        </>
      )}
    </div>
  );
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
      <span className="inline-flex h-[40px] cursor-not-allowed items-center rounded-md border border-neutral-200 px-2 text-sm text-neutral-300">
        {rotulo}
      </span>
    );
  }
  return (
    <Link
      href={href}
      className="inline-flex h-[40px] items-center rounded-md border border-neutral-300 bg-neutral-0 px-2 text-sm font-medium text-neutral-800 transition-colors duration-[120ms] hover:bg-neutral-100 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-primary-500"
    >
      {rotulo}
    </Link>
  );
}

function Th({
  children,
  alinhar,
}: {
  children: React.ReactNode;
  alinhar?: "right";
}) {
  return (
    <th
      scope="col"
      className={cn(
        "px-2 py-1 text-xs tracking-[0.06em] text-neutral-600 uppercase",
        alinhar === "right" && "text-right",
      )}
    >
      {children}
    </th>
  );
}
