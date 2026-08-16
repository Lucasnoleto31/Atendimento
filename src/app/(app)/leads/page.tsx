import type { Metadata } from "next";
import Link from "next/link";
import { Download, MessageSquare, Plus, Search } from "lucide-react";
import { createClient } from "@/lib/supabase/server";
import { perfilAtual } from "@/lib/auth";
import { formatarTelefone, tempoDesde } from "@/lib/format";
import { listarTemplates, type TemplateWhatsapp } from "@/lib/chatwoot";
import { Button } from "@/components/ui/button";
import { DistribuirLeads } from "./distribuir";
import { DispararTemplate } from "./disparar-template";
import { cn } from "@/lib/utils";

const LISTAS_DISPARO = new Set<string>([
  "esfriando",
  "sem_contato_30",
  "sem_contato_60",
  "sem_contato_nunca",
  "nunca_respondeu",
]);

export const metadata: Metadata = { title: "Leads · Zeve CRM" };

const POR_PAGINA = 50;

const LISTAS = [
  { chave: "todos", rotulo: "Todos" },
  { chave: "nao_cliente", rotulo: "Não são clientes" },
  { chave: "so_abriu_conta", rotulo: "Só abriram a conta" },
  { chave: "girou_30d", rotulo: "Giraram (30d)" },
  { chave: "nunca_girou", rotulo: "Nunca giraram" },
  { chave: "sem_giro_30d", rotulo: "Sem giro" },
  { chave: "nunca_respondeu", rotulo: "Nunca responderam" },
] as const;

// Listas por tempo desde a última interação (exclui ganhos e perdidos).
// São as filas de contato da equipe: quem esfriou aparece antes de sumir.
const LISTAS_CONTATO = [
  { chave: "ativos_24h", rotulo: "Ativos (24h)" },
  { chave: "esfriando", rotulo: "Esfriando (7–30d)" },
  { chave: "sem_contato_30", rotulo: "30–60d sem contato" },
  { chave: "sem_contato_60", rotulo: "+60d sem contato" },
  { chave: "sem_contato_nunca", rotulo: "Nunca contatados" },
] as const;

type ChaveLista =
  | (typeof LISTAS)[number]["chave"]
  | (typeof LISTAS_CONTATO)[number]["chave"];

const CAMPOS_CONTATO = `id, nome, telefone_e164, status, criado_em, customer_id, campanha,
  ultima_interacao_em, primeira_resposta_em,
  responsavel:profiles(nome), channel:channels(nome), stage:pipeline_stages(nome)`;

type LinhaContatoBruta = {
  id: string;
  nome: string;
  telefone_e164: string | null;
  status: string;
  criado_em: string;
  customer_id: string | null;
  campanha: string | null;
  ultima_interacao_em: string | null;
  primeira_resposta_em: string | null;
  responsavel: { nome: string } | null;
  channel: { nome: string } | null;
  stage: { nome: string } | null;
};

type Linha = {
  lead_id: string;
  nome: string;
  telefone_e164: string | null;
  status: string;
  criado_em: string;
  customer_id: string | null;
  campanha: string | null;
  responsavel_nome: string | null;
  canal_nome: string | null;
  etapa_nome: string | null;
  lista: string;
  nunca_respondeu: boolean;
  lotes_30d: number | null;
  ultimo_giro_em: string | null;
  ultima_interacao_em?: string | null;
};

function urlLista(lista: ChaveLista, busca: string) {
  const p = new URLSearchParams();
  if (lista !== "todos") p.set("lista", lista);
  if (busca) p.set("busca", busca);
  const q = p.toString();
  return q ? `/leads?${q}` : "/leads";
}

export default async function LeadsPage({ searchParams }: PageProps<"/leads">) {
  const params = await searchParams;
  const chavesValidas = [...LISTAS, ...LISTAS_CONTATO].map(
    (l) => l.chave as string,
  );
  const listaAtiva = (
    typeof params.lista === "string" && chavesValidas.includes(params.lista)
      ? params.lista
      : "todos"
  ) as ChaveLista;
  const ehListaContato = LISTAS_CONTATO.some((l) => l.chave === listaAtiva);
  const busca = typeof params.busca === "string" ? params.busca.trim() : "";
  const pagina = Math.max(1, Number(params.pagina) || 1);
  const aviso = typeof params.aviso === "string" ? params.aviso : null;

  const supabase = await createClient();
  const perfil = await perfilAtual();
  const ehGestor = perfil?.papel === "admin" || perfil?.papel === "gestor";

  // eslint-disable-next-line react-hooks/purity -- Server Component: uma renderização por request, o relógio do request é estável.
  const agoraMs = Date.now();
  const dataAtras = (dias: number) =>
    new Date(agoraMs - dias * 86_400_000).toISOString();
  const d1 = dataAtras(1);
  const d7 = dataAtras(7);
  const d30 = dataAtras(30);
  const d60 = dataAtras(60);

  function consultaContato(chave: ChaveLista, modo: "dados" | "contagem") {
    let q =
      modo === "contagem"
        ? supabase.from("leads").select("id", { count: "exact", head: true })
        : supabase.from("leads").select(CAMPOS_CONTATO, { count: "exact" });

    // Ganhos e perdidos ficam fora da fila de contato.
    q = q.not("status", "in", "(ganho,perdido)");

    if (chave === "ativos_24h") q = q.gte("ultima_interacao_em", d1);
    if (chave === "esfriando")
      q = q.lt("ultima_interacao_em", d7).gte("ultima_interacao_em", d30);
    if (chave === "sem_contato_30")
      q = q.lt("ultima_interacao_em", d30).gte("ultima_interacao_em", d60);
    if (chave === "sem_contato_60") q = q.lt("ultima_interacao_em", d60);
    if (chave === "sem_contato_nunca") q = q.is("ultima_interacao_em", null);

    if (modo === "dados" && busca) {
      const termo = busca.replace(/[,()]/g, " ").trim();
      const digitos = termo.replace(/\D/g, "");
      q =
        digitos.length >= 4
          ? q.or(`nome.ilike.%${termo}%,telefone_e164.ilike.%${digitos}%`)
          : q.ilike("nome", `%${termo}%`);
    }

    return q;
  }

  function consultaBase() {
    let q = supabase
      .from("v_listas_atendimento")
      .select("*", { count: "exact" });

    if (listaAtiva === "nunca_respondeu") {
      q = q.eq("nunca_respondeu", true);
    } else if (listaAtiva !== "todos") {
      q = q.eq("lista", listaAtiva);
    }

    if (busca) {
      const termo = busca.replace(/[,()]/g, " ").trim();
      const digitos = termo.replace(/\D/g, "");
      q =
        digitos.length >= 4
          ? q.or(`nome.ilike.%${termo}%,telefone_e164.ilike.%${digitos}%`)
          : q.ilike("nome", `%${termo}%`);
    }

    return q;
  }

  const de = (pagina - 1) * POR_PAGINA;

  // Filas de contato: quem está parado há mais tempo aparece primeiro.
  const ordemContato =
    listaAtiva === "ativos_24h"
      ? { coluna: "ultima_interacao_em", ascendente: false }
      : listaAtiva === "sem_contato_nunca"
        ? { coluna: "criado_em", ascendente: true }
        : { coluna: "ultima_interacao_em", ascendente: true };

  const [{ data, count, error }, { count: semResponsavel }, { count: equipeAtiva }, ...contagens] = await Promise.all([
    ehListaContato
      ? consultaContato(listaAtiva, "dados")
          .order(ordemContato.coluna, { ascending: ordemContato.ascendente })
          .range(de, de + POR_PAGINA - 1)
      : consultaBase()
          .order("criado_em", { ascending: false })
          .range(de, de + POR_PAGINA - 1),
    supabase
      .from("leads")
      .select("id", { count: "exact", head: true })
      .is("responsavel_id", null),
    supabase
      .from("profiles")
      .select("id", { count: "exact", head: true })
      .eq("ativo", true),
    ...LISTAS.map(async (l) => {
      let q = supabase
        .from("v_listas_atendimento")
        .select("lead_id", { count: "exact", head: true });
      if (l.chave === "nunca_respondeu") q = q.eq("nunca_respondeu", true);
      else if (l.chave !== "todos") q = q.eq("lista", l.chave);
      const { count: total } = await q;
      return { chave: l.chave, total: total ?? 0 };
    }),
    ...LISTAS_CONTATO.map(async (l) => {
      const { count: total } = await consultaContato(l.chave, "contagem");
      return { chave: l.chave as string, total: total ?? 0 };
    }),
  ]);

  const templatesDisparo =
    ehGestor && LISTAS_DISPARO.has(listaAtiva)
      ? await listarTemplates().catch(() => [] as TemplateWhatsapp[])
      : [];

  const linhas = ehListaContato
    ? ((data ?? []) as unknown as LinhaContatoBruta[]).map(
        (l): Linha => ({
          lead_id: l.id,
          nome: l.nome,
          telefone_e164: l.telefone_e164,
          status: l.status,
          criado_em: l.criado_em,
          customer_id: l.customer_id,
          campanha: l.campanha,
          responsavel_nome: l.responsavel?.nome ?? null,
          canal_nome: l.channel?.nome ?? null,
          etapa_nome: l.stage?.nome ?? null,
          lista: listaAtiva,
          nunca_respondeu: l.primeira_resposta_em === null,
          lotes_30d: null,
          ultimo_giro_em: null,
          ultima_interacao_em: l.ultima_interacao_em,
        }),
      )
    : ((data ?? []) as unknown as Linha[]);
  const total = count ?? 0;
  const totalPaginas = Math.max(1, Math.ceil(total / POR_PAGINA));
  const totalPorLista = new Map(contagens.map((c) => [c.chave, c.total]));

  return (
    <div className="flex min-h-full flex-col p-2 md:p-3">
      <header className="flex flex-wrap items-start justify-between gap-2 border-b border-neutral-200 pb-2">
        <div>
          <h1 className="text-h1 text-neutral-900">Leads</h1>
          <p className="mt-1 text-sm text-neutral-600">
            As listas que a equipe trabalha, cruzadas com o giro de lotes da base.
          </p>
        </div>
        <div className="flex flex-wrap items-start gap-1">
          {ehGestor ? (
            <DistribuirLeads
              semResponsavel={semResponsavel ?? 0}
              equipe={equipeAtiva ?? 0}
            />
          ) : null}
          <Button href="/leads/novo" size="md">
            <Plus size={18} strokeWidth={1.5} aria-hidden />
            Novo lead
          </Button>
        </div>
      </header>

      {aviso ? (
        <p
          role="status"
          className="mt-2 max-w-[68ch] rounded-md border border-neutral-200 bg-neutral-50 px-1.5 py-1 text-sm text-neutral-800"
        >
          {aviso}
        </p>
      ) : null}

      {[
        { rotulo: "Listas da base", listas: LISTAS },
        { rotulo: "Filas de contato", listas: LISTAS_CONTATO },
      ].map((grupo) => (
        <nav aria-label={grupo.rotulo} key={grupo.rotulo} className="mt-2">
          <p className="text-xs font-medium tracking-[0.06em] text-neutral-400 uppercase">
            {grupo.rotulo}
          </p>
          <ul className="mt-0.5 flex flex-wrap gap-1">
            {grupo.listas.map((l) => {
              const ativa = l.chave === listaAtiva;
              return (
                <li key={l.chave}>
                  <Link
                    href={urlLista(l.chave, busca)}
                    aria-current={ativa ? "page" : undefined}
                    className={cn(
                      "inline-flex h-[32px] items-center gap-1 rounded-md px-1.5 text-sm transition-colors duration-[120ms] focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-primary-500",
                      ativa
                        ? "bg-primary-50 font-medium text-primary-900"
                        : "text-neutral-600 hover:bg-neutral-100 hover:text-neutral-800",
                    )}
                  >
                    {l.rotulo}
                    <span
                      className={cn(
                        "font-mono text-xs tabular-nums",
                        ativa ? "text-primary-600" : "text-neutral-400",
                      )}
                    >
                      {totalPorLista.get(l.chave) ?? 0}
                    </span>
                  </Link>
                </li>
              );
            })}
          </ul>
        </nav>
      ))}

      <form action="/leads" method="get" className="mt-2 flex max-w-[400px] gap-1">
        {listaAtiva !== "todos" ? (
          <input type="hidden" name="lista" value={listaAtiva} />
        ) : null}
        <label htmlFor="busca" className="sr-only">
          Buscar por nome ou telefone
        </label>
        <input
          id="busca"
          name="busca"
          defaultValue={busca}
          placeholder="Nome ou telefone…"
          className="h-[40px] min-w-0 flex-1 rounded-md border border-neutral-300 bg-neutral-0 px-1.5 text-base text-neutral-800 placeholder:text-neutral-400 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-primary-500"
        />
        <button
          type="submit"
          aria-label="Buscar"
          className="inline-flex h-[40px] w-[40px] shrink-0 items-center justify-center rounded-md border border-neutral-300 bg-neutral-0 text-neutral-600 transition-colors duration-[120ms] hover:bg-neutral-100 hover:text-neutral-800 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-primary-500"
        >
          <Search size={18} strokeWidth={1.5} aria-hidden />
        </button>
      </form>

      <div className="mt-2 flex flex-wrap items-center gap-1">
        {ehGestor && LISTAS_DISPARO.has(listaAtiva) ? (
          <DispararTemplate
            lista={listaAtiva}
            rotuloLista={
              [...LISTAS, ...LISTAS_CONTATO].find((l) => l.chave === listaAtiva)
                ?.rotulo ?? listaAtiva
            }
            total={total}
            templates={templatesDisparo}
          />
        ) : null}
        <a
          href={`/api/exportar/leads?lista=${listaAtiva}${busca ? `&busca=${encodeURIComponent(busca)}` : ""}`}
          download
          className="inline-flex h-[40px] items-center gap-0.5 rounded-md border border-neutral-300 bg-neutral-0 px-2 text-sm font-medium text-neutral-800 transition-colors duration-[120ms] hover:bg-neutral-100 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-primary-500"
        >
          <Download size={18} strokeWidth={1.5} aria-hidden />
          Exportar CSV
        </a>
      </div>

      {error ? (
        <p
          role="alert"
          className="mt-2 max-w-[68ch] rounded-md border border-danger bg-danger-bg px-1.5 py-1 text-sm text-danger"
        >
          Não foi possível carregar os leads. Verifique se a migration 0007 foi
          aplicada.
        </p>
      ) : linhas.length === 0 ? (
        <div className="mt-3 max-w-[68ch] rounded-lg border border-neutral-200 bg-neutral-0 p-3 shadow-sm">
          <h2 className="text-h3 text-neutral-900">Nada por aqui</h2>
          <p className="mt-1 text-sm text-neutral-600">
            {busca
              ? "Nenhum lead corresponde à busca nesta lista."
              : "Esta lista está vazia no momento."}
          </p>
        </div>
      ) : (
        <>
          <div className="mt-2 overflow-x-auto rounded-lg border border-neutral-200 bg-neutral-0 shadow-sm">
            <table className="w-full min-w-[880px] border-collapse text-left">
              <thead>
                <tr className="border-b border-neutral-200 bg-neutral-50">
                  <Th>Lead</Th>
                  <Th>Situação</Th>
                  <Th>Origem</Th>
                  <Th>Etapa</Th>
                  {ehListaContato ? (
                    <Th alinhar="right">Último contato</Th>
                  ) : (
                    <>
                      <Th alinhar="right">Lotes 30d</Th>
                      <Th alinhar="right">Último giro</Th>
                    </>
                  )}
                  <Th>Responsável</Th>
                  <Th>
                    <span className="sr-only">Ações</span>
                  </Th>
                </tr>
              </thead>
              <tbody className="divide-y divide-neutral-200">
                {linhas.map((linha) => (
                  <tr key={linha.lead_id} className="h-[48px] hover:bg-neutral-50">
                    <td className="px-2">
                      <Link
                        href={`/leads/${linha.lead_id}`}
                        className="block max-w-[280px] truncate rounded-sm text-sm font-medium text-neutral-800 underline-offset-2 hover:text-primary-600 hover:underline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-primary-500"
                      >
                        {linha.nome}
                      </Link>
                      <span className="block font-mono text-xs text-neutral-600 tabular-nums">
                        {linha.telefone_e164
                          ? formatarTelefone(linha.telefone_e164)
                          : "sem telefone"}
                      </span>
                    </td>
                    <td className="px-2">
                      <span
                        className={cn(
                          "inline-flex h-[20px] items-center rounded-sm px-1 text-xs",
                          linha.customer_id
                            ? "bg-success-bg text-success"
                            : "bg-neutral-100 text-neutral-600",
                        )}
                      >
                        {linha.customer_id ? "Cliente" : "Não cliente"}
                      </span>
                      {linha.nunca_respondeu ? (
                        <span className="mt-0.5 block text-xs text-neutral-400">
                          nunca respondeu
                        </span>
                      ) : null}
                    </td>
                    <td className="max-w-[200px] truncate px-2 text-sm text-neutral-600">
                      {linha.canal_nome ?? "—"}
                      {linha.campanha ? ` · ${linha.campanha}` : ""}
                    </td>
                    <td className="px-2 text-sm text-neutral-600">
                      {linha.etapa_nome ?? "—"}
                    </td>
                    {ehListaContato ? (
                      <td className="px-2 text-right font-mono text-sm text-neutral-800 tabular-nums">
                        {linha.ultima_interacao_em
                          ? tempoDesde(linha.ultima_interacao_em)
                          : "nunca"}
                      </td>
                    ) : (
                      <>
                        <td className="px-2 text-right font-mono text-sm text-neutral-800 tabular-nums">
                          {linha.customer_id ? (linha.lotes_30d ?? 0) : "—"}
                        </td>
                        <td className="px-2 text-right font-mono text-sm text-neutral-600 tabular-nums">
                          {linha.ultimo_giro_em
                            ? new Date(
                                `${linha.ultimo_giro_em}T12:00:00`,
                              ).toLocaleDateString("pt-BR")
                            : "—"}
                        </td>
                      </>
                    )}
                    <td className="max-w-[160px] truncate px-2 text-sm text-neutral-600">
                      {linha.responsavel_nome ?? "—"}
                    </td>
                    <td className="px-2">
                      <Link
                        href={`/chat?lead=${linha.lead_id}`}
                        aria-label={`Abrir conversa com ${linha.nome} no chat`}
                        title="Abrir no chat"
                        className="inline-flex h-[32px] w-[32px] items-center justify-center rounded-md text-neutral-600 transition-colors duration-[120ms] hover:bg-neutral-100 hover:text-primary-600 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-primary-500"
                      >
                        <MessageSquare size={16} strokeWidth={1.5} aria-hidden />
                      </Link>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>

          <div className="mt-2 flex items-center justify-between gap-2">
            <p className="text-sm text-neutral-600">
              <span className="font-mono tabular-nums">{total}</span> lead(s) ·
              página{" "}
              <span className="font-mono tabular-nums">
                {pagina}/{totalPaginas}
              </span>
            </p>
            <div className="flex gap-1">
              <PaginaLink
                rotulo="Anterior"
                desabilitado={pagina <= 1}
                href={urlPagina(listaAtiva, busca, pagina - 1)}
              />
              <PaginaLink
                rotulo="Próxima"
                desabilitado={pagina >= totalPaginas}
                href={urlPagina(listaAtiva, busca, pagina + 1)}
              />
            </div>
          </div>
        </>
      )}
    </div>
  );
}

function urlPagina(lista: ChaveLista, busca: string, pagina: number) {
  const p = new URLSearchParams();
  if (lista !== "todos") p.set("lista", lista);
  if (busca) p.set("busca", busca);
  if (pagina > 1) p.set("pagina", String(pagina));
  const q = p.toString();
  return q ? `/leads?${q}` : "/leads";
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
