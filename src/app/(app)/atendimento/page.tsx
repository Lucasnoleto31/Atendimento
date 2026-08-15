import type { Metadata } from "next";
import Link from "next/link";
import { createClient } from "@/lib/supabase/server";
import { KanbanBoard, type Coluna } from "@/components/app/kanban/board";
import type { LeadCard, Stage } from "@/lib/types";

export const metadata: Metadata = { title: "Atendimento · Zeve CRM" };

/** Cartões carregados por coluna; o restante fica acessível pela página Leads. */
const POR_COLUNA = 50;

type LinhaLead = {
  id: string;
  nome: string;
  telefone_e164: string | null;
  customer_id: string | null;
  campanha: string | null;
  stage_id: string | null;
  status: LeadCard["status"];
  entrou_na_etapa_em: string;
  primeira_resposta_em: string | null;
  channel: { nome: string } | null;
  responsavel: { nome: string } | null;
};

const CAMPOS = `id, nome, telefone_e164, customer_id, campanha, stage_id, status,
  entrou_na_etapa_em, primeira_resposta_em,
  channel:channels(nome),
  responsavel:profiles(nome)`;

function paraCard(l: LinhaLead): LeadCard {
  return {
    id: l.id,
    nome: l.nome,
    telefone_e164: l.telefone_e164,
    customer_id: l.customer_id,
    campanha: l.campanha,
    stage_id: l.stage_id,
    status: l.status,
    entrou_na_etapa_em: l.entrou_na_etapa_em,
    primeira_resposta_em: l.primeira_resposta_em,
    canal: l.channel?.nome ?? null,
    responsavel: l.responsavel?.nome ?? null,
  };
}

export default async function AtendimentoPage({
  searchParams,
}: PageProps<"/atendimento">) {
  const supabase = await createClient();
  const params = await searchParams;

  const { data: pipelines } = await supabase
    .from("pipelines")
    .select("id, nome, padrao")
    .order("criado_em");

  const listaPipelines = (pipelines ?? []) as {
    id: string;
    nome: string;
    padrao: boolean;
  }[];

  const kanbanParam = typeof params.kanban === "string" ? params.kanban : null;
  const pipelineAtivo =
    listaPipelines.find((p) => p.id === kanbanParam) ??
    listaPipelines.find((p) => p.padrao) ??
    listaPipelines[0] ??
    null;

  const { data: stages } = pipelineAtivo
    ? await supabase
        .from("pipeline_stages")
        .select("id, nome, ordem, is_final")
        .eq("pipeline_id", pipelineAtivo.id)
        .order("ordem")
    : { data: [] };

  const [colunas, { count: totalClientes }, { count: totalSemResposta }] =
    await Promise.all([
      Promise.all(
        ((stages ?? []) as Stage[]).map(async (stage): Promise<Coluna> => {
          const { data, count, error } = await supabase
            .from("leads")
            .select(CAMPOS, { count: "exact" })
            .eq("stage_id", stage.id)
            .order("entrou_na_etapa_em", { ascending: false })
            .limit(POR_COLUNA);

          return {
            stage,
            total: error ? 0 : (count ?? 0),
            leads: ((data ?? []) as unknown as LinhaLead[]).map(paraCard),
          };
        }),
      ),
      supabase
        .from("leads")
        .select("id", { count: "exact", head: true })
        .not("customer_id", "is", null),
      supabase
        .from("leads")
        .select("id", { count: "exact", head: true })
        .is("primeira_resposta_em", null),
    ]);

  const totalLeads = colunas.reduce((s, c) => s + c.total, 0);

  return (
    <div className="flex min-h-full flex-col">
      <header className="px-2 pt-2 pb-2 md:px-3 md:pt-3">
        <h1 className="text-h1 text-neutral-900">Atendimento</h1>

        {listaPipelines.length > 1 ? (
          <nav aria-label="Kanbans" className="mt-1">
            <ul className="flex flex-wrap gap-1">
              {listaPipelines.map((p) => {
                const ativo = p.id === pipelineAtivo?.id;
                return (
                  <li key={p.id}>
                    <Link
                      href={p.padrao ? "/atendimento" : `/atendimento?kanban=${p.id}`}
                      aria-current={ativo ? "page" : undefined}
                      className={
                        ativo
                          ? "inline-flex h-[32px] items-center rounded-md bg-primary-50 px-1.5 text-sm font-medium text-primary-900 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-primary-500"
                          : "inline-flex h-[32px] items-center rounded-md px-1.5 text-sm text-neutral-600 transition-colors duration-[120ms] hover:bg-neutral-100 hover:text-neutral-800 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-primary-500"
                      }
                    >
                      {p.nome}
                    </Link>
                  </li>
                );
              })}
            </ul>
          </nav>
        ) : null}

        <p className="mt-1 text-sm text-neutral-600">
          <span className="font-mono tabular-nums">{totalLeads}</span> leads no
          funil ·{" "}
          <span className="font-mono tabular-nums">{totalClientes ?? 0}</span>{" "}
          já são clientes ·{" "}
          <span className="font-mono tabular-nums">
            {totalSemResposta ?? 0}
          </span>{" "}
          nunca responderam
        </p>
      </header>

      {totalLeads === 0 ? (
        <div className="mx-2 max-w-[68ch] rounded-lg border border-neutral-200 bg-neutral-0 p-3 shadow-sm md:mx-3">
          <h2 className="text-h3 text-neutral-900">Nenhum lead ainda</h2>
          <p className="mt-1 text-sm text-neutral-600">
            Os leads entram por webhook da Meta, por importação ou pela
            reativação de clientes sem giro.
          </p>
        </div>
      ) : (
        <KanbanBoard colunas={colunas} limitePorColuna={POR_COLUNA} />
      )}
    </div>
  );
}
