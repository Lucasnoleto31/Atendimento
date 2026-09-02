import type { Metadata } from "next";
import Link from "next/link";
import { createClient } from "@/lib/supabase/server";
import { buscarTudo } from "@/lib/supabase/paginar";
import { perfilAtual } from "@/lib/auth";
import { veTudo } from "@/lib/papeis";
import { KanbanBoard, type Coluna } from "@/components/app/kanban/board";
import type { LeadCard, Stage } from "@/lib/types";
import { cn } from "@/lib/utils";
import { horaOuData } from "@/lib/format";

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

// Prazo padrão quando a etapa não define o seu (0051).
const PRAZO_PADRAO_DIAS = 7;

function semaforoDoPrazo(
  entrouEm: string,
  prazoDias: number,
  agoraMs: number,
): "verde" | "laranja" | "vermelho" {
  const dias = (agoraMs - new Date(entrouEm).getTime()) / 86_400_000;
  if (dias >= prazoDias * 2) return "vermelho";
  if (dias >= prazoDias) return "laranja";
  return "verde";
}

function paraCard(
  l: LinhaLead,
  agoraMs: number,
  prazoDias: number,
  naoLidasIds: Set<string>,
): LeadCard {
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
    semaforo: semaforoDoPrazo(l.entrou_na_etapa_em, prazoDias, agoraMs),
    naoLida: naoLidasIds.has(l.id),
  };
}

/** limites por coluna vindos do "Carregar mais" (?mais=id:100,id2:150). */
function limitesDaUrl(bruto: string | undefined): Map<string, number> {
  const mapa = new Map<string, number>();
  for (const parte of (bruto ?? "").split(",")) {
    const [id, n] = parte.split(":");
    const limite = Number(n);
    if (id && Number.isInteger(limite) && limite > 0 && limite <= 500) {
      mapa.set(id, limite);
    }
  }
  return mapa;
}

export default async function AtendimentoPage({
  searchParams,
}: PageProps<"/atendimento">) {
  const supabase = await createClient();
  const params = await searchParams;
  const perfil = await perfilAtual();
  const soMeus = params.meus === "1" && perfil !== null;
  const ehGestor = veTudo(perfil?.papel);
  const limites = limitesDaUrl(
    typeof params.mais === "string" ? params.mais : undefined,
  );

  // "Ver funil de…": gestor filtra o quadro inteiro por uma pessoa. Tem
  // prioridade sobre o "Só meus" (que segue sendo o atalho do vendedor).
  let equipe: { id: string; nome: string }[] = [];
  if (ehGestor) {
    const { data } = await supabase
      .from("profiles")
      .select("id, nome")
      .eq("ativo", true)
      .order("nome");
    equipe = data ?? [];
  }
  const dePedido = typeof params.de === "string" ? params.de : "";
  const funilDe =
    ehGestor && dePedido && equipe.some((p) => p.id === dePedido)
      ? dePedido
      : null;
  const escopoPessoa = funilDe ?? (soMeus && perfil ? perfil.id : null);
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

  let { data: stages } = pipelineAtivo
    ? await supabase
        .from("pipeline_stages")
        .select("id, nome, ordem, is_final, prazo_dias")
        .eq("pipeline_id", pipelineAtivo.id)
        .order("ordem")
    : { data: [] };
  // Banco sem a 0051: a coluna não existe — busca sem ela e o prazo é o padrão.
  if (stages === null && pipelineAtivo) {
    const semPrazo = await supabase
      .from("pipeline_stages")
      .select("id, nome, ordem, is_final")
      .eq("pipeline_id", pipelineAtivo.id)
      .order("ordem");
    stages = semPrazo.data as typeof stages;
  }

  // Não lidas por coluna: uma varredura só, contada aqui (o PostgREST não
  // compara coluna com coluna). Filtra por ultima_interacao_em — na Meta o
  // thread é o telefone, e é essa coluna que diz se há conversa. buscarTudo
  // fura o teto de 1000 linhas do PostgREST (a base já passa disso).
  const buscarNaoLidas = () =>
    buscarTudo<{
      id: string;
      stage_id: string;
      ultima_interacao_em: string;
      chat_lido_em: string | null;
    }>((de, ate) => {
      let q = supabase
        .from("leads")
        .select("id, stage_id, ultima_interacao_em, chat_lido_em")
        .not("ultima_interacao_em", "is", null)
        .range(de, ate);
      if (escopoPessoa) q = q.eq("responsavel_id", escopoPessoa);
      return q;
    });

  // Contagem escopada pelo mesmo "só meus" do funil — senão o cabeçalho
  // mostrava "8 no funil · 640 clientes" (funil filtrado, totais da base
  // inteira), números que não fecham entre si.
  // eslint-disable-next-line @typescript-eslint/no-explicit-any -- corta a recursão de tipos do builder
  const contarBase = (aplicar: (q: any) => any) => {
    let q = supabase.from("leads").select("id", { count: "exact", head: true });
    if (escopoPessoa) q = q.eq("responsavel_id", escopoPessoa);
    return aplicar(q);
  };

  // A varredura de não-lidas vem PRIMEIRO: os ids alimentam o "não lida no
  // topo" das colunas — sem eles, uma coluna ordenada por parado-há-mais-
  // tempo esconderia justamente as conversas novas.
  const { dados: linhasNaoLidas } = await buscarNaoLidas();
  const naoLidasIds = new Set(
    linhasNaoLidas
      .filter(
        (l) =>
          l.chat_lido_em === null || l.ultima_interacao_em > l.chat_lido_em,
      )
      .map((l) => l.id),
  );
  const naoLidasPorStage = new Map<string, string[]>();
  for (const l of linhasNaoLidas) {
    if (!naoLidasIds.has(l.id) || !l.stage_id) continue;
    naoLidasPorStage.set(l.stage_id, [
      ...(naoLidasPorStage.get(l.stage_id) ?? []),
      l.id,
    ]);
  }

  const listaStages = (stages ?? []) as Stage[];

  const [
    colunas,
    { count: totalClientes },
    { count: totalSemResposta },
    semDonoLinhas,
    aguardando24Linhas,
  ] = await Promise.all([
    Promise.all(
      listaStages.map(async (stage): Promise<Coluna> => {
        const limite = limites.get(stage.id) ?? POR_COLUNA;
        const prazo = stage.prazo_dias ?? PRAZO_PADRAO_DIAS;
        const idsNaoLidos = (naoLidasPorStage.get(stage.id) ?? []).slice(
          0,
          limite,
        );

        // Fatia 1: as não lidas da coluna, pela ordem de quem espera há
        // mais tempo na etapa. Fatia 2: completa com os parados há mais
        // tempo. Urgência = não lida > parado > recente.
        // eslint-disable-next-line @typescript-eslint/no-explicit-any -- corta a recursão de tipos do builder
        const consultaNaoLidas: any =
          idsNaoLidos.length > 0
            ? supabase
                .from("leads")
                .select(CAMPOS)
                .in("id", idsNaoLidos)
                .order("entrou_na_etapa_em", { ascending: true })
            : Promise.resolve({ data: [] });

        // eslint-disable-next-line @typescript-eslint/no-explicit-any -- idem
        let consultaResto: any = supabase
          .from("leads")
          .select(CAMPOS, { count: "exact" })
          .eq("stage_id", stage.id)
          .order("entrou_na_etapa_em", { ascending: true })
          .limit(limite);
        if (idsNaoLidos.length > 0) {
          consultaResto = consultaResto.not(
            "id",
            "in",
            `(${idsNaoLidos.join(",")})`,
          );
        }
        if (escopoPessoa) {
          consultaResto = consultaResto.eq("responsavel_id", escopoPessoa);
        }

        // Vermelhos da coluna inteira (não só dos visíveis): estourou o
        // DOBRO do prazo da etapa.
        const corteVermelho = new Date(
          agoraMs - prazo * 2 * 86_400_000,
        ).toISOString();
        // eslint-disable-next-line @typescript-eslint/no-explicit-any -- idem
        let consultaVermelhos: any = supabase
          .from("leads")
          .select("id", { count: "exact", head: true })
          .eq("stage_id", stage.id)
          .lte("entrou_na_etapa_em", corteVermelho);
        if (escopoPessoa) {
          consultaVermelhos = consultaVermelhos.eq(
            "responsavel_id",
            escopoPessoa,
          );
        }

        const [
          { data: dataNaoLidas },
          { data: dataResto, count, error },
          { count: vermelhos },
        ] = await Promise.all([
          consultaNaoLidas,
          consultaResto,
          consultaVermelhos,
        ]);

        const linhas = [
          ...((dataNaoLidas ?? []) as unknown as LinhaLead[]),
          ...((dataResto ?? []) as unknown as LinhaLead[]),
        ].slice(0, limite);

        return {
          stage,
          total: error ? 0 : (count ?? 0) + idsNaoLidos.length,
          vermelhos: vermelhos ?? 0,
          limite,
          leads: linhas.map((l) => paraCard(l, agoraMs, prazo, naoLidasIds)),
        };
      }),
    ),
    contarBase((q) => q.not("customer_id", "is", null)),
    contarBase((q) => q.is("primeira_resposta_em", null)),
    // Raio-x: sem dono por etapa, numa varredura pequena (só os sem dono).
    supabase
      .from("leads")
      .select("stage_id")
      .is("responsavel_id", null)
      .not("stage_id", "is", null)
      .limit(1000),
    // Aguardando 24h+ por etapa (definição canônica da view).
    supabase
      .from("v_leads_listas")
      .select("lead_id, etapa_nome, horas_esperando")
      .eq("aguardando_resposta", true)
      .gte("horas_esperando", 24)
      .limit(1000),
  ]);

  const semDonoPorEtapa = new Map<string, number>();
  for (const l of (semDonoLinhas.data ?? []) as { stage_id: string }[]) {
    semDonoPorEtapa.set(l.stage_id, (semDonoPorEtapa.get(l.stage_id) ?? 0) + 1);
  }
  const aguardando24PorNome = new Map<string, number>();
  for (const l of (aguardando24Linhas.data ?? []) as {
    etapa_nome: string | null;
  }[]) {
    if (!l.etapa_nome) continue;
    aguardando24PorNome.set(
      l.etapa_nome,
      (aguardando24PorNome.get(l.etapa_nome) ?? 0) + 1,
    );
  }
  for (const c of colunas) {
    c.semDono = escopoPessoa ? 0 : (semDonoPorEtapa.get(c.stage.id) ?? 0);
    c.aguardando24 = aguardando24PorNome.get(c.stage.nome) ?? 0;
  }

  // Etiquetas e próximas ações dos cartões visíveis: duas consultas para o
  // quadro inteiro, nunca por cartão.
  const idsVisiveis = colunas.flatMap((c) => c.leads.map((l) => l.id));
  if (idsVisiveis.length > 0) {
    const [{ data: vinculos }, { data: tarefasPend }] = await Promise.all([
      supabase
        .from("lead_tags")
        .select("lead_id, tag:tags(id, nome, cor)")
        .in("lead_id", idsVisiveis),
      supabase
        .from("lead_tasks")
        .select("lead_id, titulo, vence_em")
        .in("lead_id", idsVisiveis)
        .is("concluida_em", null)
        .order("vence_em", { ascending: true })
        .limit(500),
    ]);

    const proximaPorLead = new Map<
      string,
      { titulo: string; quando: string; vencida: boolean }
    >();
    for (const t of (tarefasPend ?? []) as {
      lead_id: string;
      titulo: string;
      vence_em: string;
    }[]) {
      if (proximaPorLead.has(t.lead_id)) continue;
      proximaPorLead.set(t.lead_id, {
        titulo: t.titulo,
        quando: horaOuData(t.vence_em) || "—",
        vencida: new Date(t.vence_em).getTime() < agoraMs,
      });
    }
    for (const c of colunas) {
      for (const lead of c.leads) {
        lead.proximaAcao = proximaPorLead.get(lead.id) ?? null;
      }
    }

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
  for (const linha of (
    (linhasNaoLidas ?? []) as {
      stage_id: string | null;
      ultima_interacao_em: string;
      chat_lido_em: string | null;
    }[]
  ).filter(
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

  // "Carregar mais 50": a URL da própria página com o limite daquela coluna
  // aumentado — servidor renderiza, zero estado no cliente.
  for (const c of colunas) {
    const carregados = c.leads.length;
    if (c.total > carregados) {
      const novos = new Map(limites);
      novos.set(c.stage.id, (c.limite ?? POR_COLUNA) + 50);
      const p = new URLSearchParams();
      if (pipelineAtivo && !pipelineAtivo.padrao)
        p.set("kanban", pipelineAtivo.id);
      if (soMeus) p.set("meus", "1");
      if (funilDe) p.set("de", funilDe);
      p.set(
        "mais",
        [...novos.entries()].map(([id, n]) => `${id}:${n}`).join(","),
      );
      c.hrefMais = `/atendimento?${p.toString()}`;
    } else {
      c.hrefMais = null;
    }
  }

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
                      href={
                        p.padrao
                          ? "/atendimento"
                          : `/atendimento?kanban=${p.id}`
                      }
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
          Neste funil:{" "}
          <span className="font-mono tabular-nums">{totalLeads}</span> leads
          <span className="mx-1 text-neutral-300">|</span>
          Na base
          {funilDe
            ? ` de ${equipe.find((p) => p.id === funilDe)?.nome ?? ""}`
            : soMeus
              ? " (minha)"
              : ""}
          : <span className="font-mono tabular-nums">{totalClientes ?? 0}</span>{" "}
          clientes ·{" "}
          <span className="font-mono tabular-nums">
            {totalSemResposta ?? 0}
          </span>{" "}
          nunca responderam
        </p>

        {ehGestor && equipe.length > 0 ? (
          <form
            action="/atendimento"
            method="get"
            className="mt-1 flex items-center gap-1"
          >
            {pipelineAtivo && !pipelineAtivo.padrao ? (
              <input type="hidden" name="kanban" value={pipelineAtivo.id} />
            ) : null}
            <label htmlFor="de" className="text-xs text-neutral-600">
              Ver funil de
            </label>
            <select
              id="de"
              name="de"
              defaultValue={funilDe ?? ""}
              className="h-[32px] max-w-[200px] rounded-md border border-neutral-300 bg-neutral-0 px-1 text-sm text-neutral-800 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-primary-500"
            >
              <option value="">Todo mundo</option>
              {equipe.map((p) => (
                <option key={p.id} value={p.id}>
                  {p.nome}
                </option>
              ))}
            </select>
            <button
              type="submit"
              className="inline-flex h-[32px] items-center rounded-md border border-neutral-300 bg-neutral-0 px-1.5 text-sm font-medium text-neutral-800 transition-colors duration-[120ms] hover:bg-neutral-100 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-primary-500"
            >
              Ver
            </button>
          </form>
        ) : null}
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
        <KanbanBoard colunas={colunasComBadge} />
      )}
    </div>
  );
}
