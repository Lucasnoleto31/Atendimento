import type { Metadata } from "next";
import Link from "next/link";
import { redirect } from "next/navigation";
import { Download } from "lucide-react";
import { createClient } from "@/lib/supabase/server";
import { perfilAtual } from "@/lib/auth";
import { rotuloPapel, veTudo } from "@/lib/papeis";
import {
  ACOES_SENSIVEIS,
  ROTULO_ACAO,
  descreverDetalhes,
} from "@/lib/auditoria";
import { formatarDataHora } from "@/lib/format";
import { cn } from "@/lib/utils";

export const metadata: Metadata = { title: "Log de acesso · Zeve CRM" };

/** Início da janela em ISO — fora do componente (regra de pureza). */
function corteDeDias(dias: number): string {
  return new Date(Date.now() - dias * 86_400_000).toISOString();
}

const JANELAS = [
  { dias: 1, rotulo: "Hoje" },
  { dias: 7, rotulo: "7 dias" },
  { dias: 30, rotulo: "30 dias" },
] as const;

type Registro = {
  id: string;
  quem: string | null;
  acao: string;
  detalhes: Record<string, unknown>;
  criado_em: string;
  autor: { nome: string; papel: string } | null;
};

export default async function AcessosPage({
  searchParams,
}: PageProps<"/admin/acessos">) {
  const perfil = await perfilAtual();
  if (!perfil || !veTudo(perfil.papel)) redirect("/hoje");

  const params = await searchParams;
  const dias = JANELAS.some((j) => String(j.dias) === params.dias)
    ? Number(params.dias)
    : 7;
  const quem = typeof params.quem === "string" ? params.quem : "";
  const acao = typeof params.acao === "string" ? params.acao : "";
  const corte = corteDeDias(dias);

  const supabase = await createClient();
  let consulta = supabase
    .from("auditoria")
    .select("id, quem, acao, detalhes, criado_em, autor:profiles(nome, papel)")
    .gte("criado_em", corte)
    .order("criado_em", { ascending: false })
    .limit(300);
  if (quem) consulta = consulta.eq("quem", quem);
  if (acao) consulta = consulta.eq("acao", acao);
  const [{ data: linhas, error }, { data: equipe }] = await Promise.all([
    consulta,
    supabase.from("profiles").select("id, nome").order("nome"),
  ]);
  const registros = (linhas ?? []) as unknown as Registro[];
  const pessoas = (equipe ?? []) as { id: string; nome: string }[];
  const exportar = `/api/exportar/auditoria?dias=${dias}${quem ? `&quem=${quem}` : ""}${acao ? `&acao=${encodeURIComponent(acao)}` : ""}`;

  return (
    <div className="p-2 md:p-3">
      <header className="flex flex-wrap items-end justify-between gap-2 border-b border-neutral-200 pb-2">
        <div>
          <h1 className="text-h1 text-neutral-900">Log de acesso</h1>
          <p className="mt-1 max-w-[68ch] text-base text-neutral-600">
            Quem viu o quê, quando — fichas, conversas, CPF revelado,
            exportações e bloqueios. A própria exportação deste log entra no
            log.
          </p>
        </div>
        <Link
          href={exportar}
          className="inline-flex h-[40px] items-center gap-0.5 rounded-md border border-neutral-300 bg-neutral-0 px-2 text-sm font-medium text-neutral-800 transition-colors duration-[120ms] hover:bg-neutral-100 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-primary-500"
        >
          <Download size={16} strokeWidth={1.5} aria-hidden />
          Exportar CSV
        </Link>
      </header>

      <form className="mt-2 flex flex-wrap items-end gap-2" method="get">
        <fieldset className="flex items-center gap-0.5">
          <legend className="sr-only">Período</legend>
          {JANELAS.map((j) => (
            <Link
              key={j.dias}
              href={`/admin/acessos?dias=${j.dias}${quem ? `&quem=${quem}` : ""}${acao ? `&acao=${encodeURIComponent(acao)}` : ""}`}
              aria-current={j.dias === dias ? "page" : undefined}
              className={cn(
                "inline-flex h-[32px] items-center rounded-md px-1.5 text-sm transition-colors duration-[120ms] focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-primary-500",
                j.dias === dias
                  ? "bg-primary-50 font-medium text-primary-900"
                  : "text-neutral-600 hover:bg-neutral-100 hover:text-neutral-800",
              )}
            >
              {j.rotulo}
            </Link>
          ))}
        </fieldset>
        <input type="hidden" name="dias" value={dias} />
        <label className="flex flex-col gap-0.5 text-xs font-medium text-neutral-800">
          Pessoa
          <select
            name="quem"
            defaultValue={quem}
            className="h-[40px] min-w-[180px] rounded-md border border-neutral-300 bg-neutral-0 px-1.5 text-sm text-neutral-800"
          >
            <option value="">todas</option>
            {pessoas.map((p) => (
              <option key={p.id} value={p.id}>
                {p.nome}
              </option>
            ))}
          </select>
        </label>
        <label className="flex flex-col gap-0.5 text-xs font-medium text-neutral-800">
          Ação
          <select
            name="acao"
            defaultValue={acao}
            className="h-[40px] min-w-[200px] rounded-md border border-neutral-300 bg-neutral-0 px-1.5 text-sm text-neutral-800"
          >
            <option value="">todas</option>
            {Object.entries(ROTULO_ACAO).map(([chave, rotulo]) => (
              <option key={chave} value={chave}>
                {rotulo}
              </option>
            ))}
          </select>
        </label>
        <button
          type="submit"
          className="inline-flex h-[40px] items-center rounded-md border border-neutral-300 bg-neutral-0 px-2 text-sm font-medium text-neutral-800 transition-colors duration-[120ms] hover:bg-neutral-100 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-primary-500"
        >
          Filtrar
        </button>
      </form>

      {error ? (
        <p role="alert" className="mt-2 text-sm text-danger">
          Não deu para ler o log: {error.message}
        </p>
      ) : registros.length === 0 ? (
        <div className="mt-3 rounded-lg border border-neutral-200 bg-neutral-0 p-3">
          <h2 className="text-h3 text-neutral-900">Nada no período</h2>
          <p className="mt-1 text-sm text-neutral-600">
            Nenhum acesso registrado com esses filtros.
          </p>
        </div>
      ) : (
        <div className="mt-2 overflow-x-auto rounded-lg border border-neutral-200 bg-neutral-0">
          <table className="w-full border-collapse">
            <thead>
              <tr className="border-b border-neutral-200 bg-neutral-50">
                <th className="px-2 py-1 text-left text-xs tracking-[0.06em] text-neutral-600 uppercase">
                  Quando
                </th>
                <th className="px-2 py-1 text-left text-xs tracking-[0.06em] text-neutral-600 uppercase">
                  Quem
                </th>
                <th className="px-2 py-1 text-left text-xs tracking-[0.06em] text-neutral-600 uppercase">
                  Ação
                </th>
                <th className="px-2 py-1 text-left text-xs tracking-[0.06em] text-neutral-600 uppercase">
                  Objeto
                </th>
              </tr>
            </thead>
            <tbody>
              {registros.map((r) => (
                <tr key={r.id} className="h-[48px] border-b border-neutral-200">
                  <td className="px-2 font-mono text-xs text-neutral-600 tabular-nums">
                    {formatarDataHora(r.criado_em)}
                  </td>
                  <td className="px-2 text-sm text-neutral-800">
                    {r.autor ? (
                      <>
                        {r.autor.nome}
                        <span className="text-neutral-400">
                          {" "}
                          · {rotuloPapel(r.autor.papel)}
                        </span>
                      </>
                    ) : (
                      <span className="text-neutral-400">sistema</span>
                    )}
                  </td>
                  <td className="px-2">
                    <span
                      className={cn(
                        "inline-flex h-[20px] items-center rounded-sm px-1 text-xs font-medium",
                        ACOES_SENSIVEIS.has(r.acao)
                          ? "bg-warning-bg text-warning"
                          : r.acao.includes("bloquead") ||
                              r.acao.includes("falha")
                            ? "bg-danger-bg text-danger"
                            : "bg-neutral-100 text-neutral-800",
                      )}
                    >
                      {ROTULO_ACAO[r.acao] ?? r.acao}
                    </span>
                  </td>
                  <td className="max-w-[360px] truncate px-2 text-sm text-neutral-800">
                    {descreverDetalhes(r.detalhes ?? {})}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
          {registros.length === 300 ? (
            <p className="px-2 py-1 text-xs text-neutral-600">
              Mostrando os 300 mais recentes — para o período inteiro, exporte o
              CSV.
            </p>
          ) : null}
        </div>
      )}
    </div>
  );
}
