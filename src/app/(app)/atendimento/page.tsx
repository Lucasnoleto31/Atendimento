import type { Metadata } from "next";
import Link from "next/link";
import { createClient } from "@/lib/supabase/server";
import { buscarTudo } from "@/lib/supabase/paginar";
import { perfilAtual } from "@/lib/auth";
import { KanbanBoard, type Coluna } from "@/components/app/kanban/board";
import type { LeadCard, Stage } from "@/lib/types";
import { cn } from "@/lib/utils";

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

// Parado na etapa além disso pinta o card de alerta.
const DIAS_PARADO = 7;

function paraCard(l: LinhaLead, agoraMs: number): LeadCard {
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
    atrasado:
      agoraMs - new Date(l.entrou_na_etapa_em).getTime() >
      DIAS_PARADO * 86_400_000,
  };
}

export default async function AtendimentoPage({
  searchParams,
}: PageProps<"/atendimento">) {
  const supabase = await createClient();
  const params = await searchParams;
  const perfil = await perfilAtual();
  const soMeus = params.meus === "1" && perfil !== null;
  // eslint-disable-next-line react-hooks/purity -- Server Component: uma renderização por request, o relógio do request é estável.
  const agoraMs = Date.now();

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

  // Não lidas por coluna: uma varredura só, contada aqui (o PostgREST não
  // compara coluna com coluna). Filtra por ultima_interacao_em — o canal
  // Meta direto nunca preenche chatwoot_conversation_id, então o filtro
  // antigo cegava justamente as conversas novas. buscarTudo fura o teto de
  // 1000 linhas do PostgREST (a base já passa disso).
  const buscarNaoLidas = () =>
    buscarTudo<{
      stage_id: string;
      ultima_interacao_em: string;
      chat_lido_em: string | null;
    }>((de, ate) => {
      let q = supabase
        .from("leads")
        .select("stage_id, ultima_interacao_em, chat_lido_em")
        .not("ultima_interacao_em", "is", null)
        .range(de, ate);
      if (soMeus && perfil) q = q.eq("responsavel_id", perfil.id);
      return q;
    });

  // Contagem escopada pelo mesmo "só meus" do funil — senão o cabeçalho
  // mostrava "8 no funil · 640 clientes" (funil filtrado, totais da base
  // inteira), números que não fecham entre si.
  // eslint-disable-next-line @typescript-eslint/no-explicit-any -- corta a recursão de tipos do builder
  const contarBase = (aplicar: (q: any) => any) => {
    let q = supabase.from("leads").select("id", { count: "exact", head: true });
    if (soMeus && perfil) q = q.eq("responsavel_id", perfil.id);
    return aplicar(q);
  };

  const [colunas, { dados: linhasNaoLidas }, { count: totalClientes }, { count: totalSemResposta }] =
    await Promise.all([
      Promise.all(
        ((stages ?? []) as Stage[]).map(async (stage): Promise<Coluna> => {
          let consulta = supabase
            .from("leads")
            .select(CAMPOS, { count: "exact" })
            .eq("stage_id", stage.id)
            .order("entrou_na_etapa_em", { ascending: false })
            .limit(POR_COLUNA);
          if (soMeus && perfil) {
            consulta = consulta.eq("responsavel_id", perfil.id);
          }
          const { data, count, error } = await consulta;

          return {
            stage,
            total: error ? 0 : (count ?? 0),
            leads: ((data ?? []) as unknown as LinhaLead[]).map((l) =>
              paraCard(l, agoraMs),
            ),
          };
        }),
      ),
      buscarNaoLidas(),
      contarBase((q) => q.not("customer_id", "is", null)),
      contarBase((q) => q.is("primeira_resposta_em", null)),
    ]);

  // Etiquetas dos cartões visíveis, numa consulta só.
  const idsVisiveis = colunas.flatMap((c) => c.leads.map((l) => l.id));
  if (idsVisiveis.length > 0) {
    const { data: vinculos } = await supabase
      .from("lead_tags")
      .select("lead_id, tag:tags(id, nome, cor)")
      .in("lead_id", idsVisiveis);

    const porLead = new Map<
      string,
      { id: string; nome: string; cor?: string | null }[]
    >();
    for (const vinculo of (vinculos ?? []) as unknown as {
      lead_id: string;
      tag: { id: string; nome: string; cor?: string | null } | null;
    }[]) {
      if (!vinculo.tag) continue;
      const atuais = porLead.get(vinculo.lead_id) ?? [];
      atuais.push(vinculo.tag);
      porLead.set(vinculo.lead_id, atuais);
    }
    for (const coluna of colunas) {
      for (const lead of coluna.leads) {
        lead.etiquetas = porLead.get(lead.id) ?? [];
      }
    }
  }

  const naoLidasPorEtapa = new Map<string, number>();
  for (const linha of ((linhasNaoLidas ?? []) as {
    stage_id: string | null;
    ultima_interacao_em: string;
    chat_lido_em: string | null;
  }[]).filter(
    (l) => l.chat_lido_em === null || l.ultima_interacao_em > l.chat_lido_em,
  )) {
    if (linha.stage_id) {
      naoLidasPorEtapa.set(
        linha.stage_id,
        (naoLidasPorEtapa.get(linha.stage_id) ?? 0) + 1,
      );
    }
  }
  const colunasComBadge = colunas.map((c) => ({
    ...c,
    naoLidas: naoLidasPorEtapa.get(c.stage.id) ?? 0,
  }));

  const totalLeads = colunas.reduce((s, c) => s + c.total, 0);

  return (
    <div className="flex min-h-full flex-col">
      <header className="px-2 pt-2 pb-2 md:px-3 md:pt-3">
        <div className="flex flex-wrap items-center justify-between gap-1">
          <h1 className="text-h1 text-neutral-900">Atendimento</h1>
          {perfil ? (
            <Link
              href={
                soMeus
                  ? pipelineAtivo && !pipelineAtivo.padrao
                    ? `/atendimento?kanban=${pipelineAtivo.id}`
                    : "/atendimento"
                  : pipelineAtivo && !pipelineAtivo.padrao
                    ? `/atendimento?kanban=${pipelineAtivo.id}&meus=1`
                    : "/atendimento?meus=1"
              }
              aria-pressed={soMeus}
              className={cn(
                "inline-flex h-[32px] items-center rounded-md px-1.5 text-sm transition-colors duration-[120ms] focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-primary-500",
                soMeus
                  ? "bg-primary-50 font-medium text-primary-900"
                  : "border border-neutral-300 text-neutral-600 hover:bg-neutral-100 hover:text-neutral-800",
              )}
            >
              {soMeus ? "Vendo só os meus" : "Só meus leads"}
            </Link>
          ) : null}
        </div>

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
          {soMeus ? "meus já são clientes" : "já são clientes"} ·{" "}
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
        <KanbanBoard colunas={colunasComBadge} limitePorColuna={POR_COLUNA} />
      )}
    </div>
  );
}
