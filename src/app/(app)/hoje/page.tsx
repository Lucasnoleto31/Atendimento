import type { Metadata } from "next";
import Link from "next/link";
import { MessageSquare } from "lucide-react";
import { createClient } from "@/lib/supabase/server";
import { perfilAtual } from "@/lib/auth";
import { veTudo } from "@/lib/papeis";
import {
  agoraEmBrasilia,
  formatarData,
  formatarReais,
  formatarTelefone,
  horaOuData,
} from "@/lib/format";
import { cn } from "@/lib/utils";
import { TarefaDoDia, type TarefaDia } from "./tarefa-do-dia";
import { BotaoSoneca, ItemConversa, PainelConversa } from "./painel-conversa";

export const metadata: Metadata = { title: "Hoje · Zeve CRM" };

/**
 * A fila do dia de UMA pessoa, em ordem do que fazer primeiro. O dado já
 * existia espalhado em quatro telas (agenda, chat, leads, relatórios) — aqui
 * ele vira uma sequência: tarefas com hora marcada, gente esperando resposta
 * e as contas abertas paradas que pagam a mesa quando giram.
 */

const LIMITE = 25;

type LinhaTarefa = {
  id: string;
  titulo: string;
  vence_em: string;
  lead: { id: string; nome: string } | null;
};

type LinhaEspera = {
  lead_id: string;
  nome: string;
  telefone_e164: string | null;
  horas_esperando: number | null;
  customer_id: string | null;
  quente_sem_conta: boolean | null;
};

type LinhaAtivacao = {
  lead_id: string;
  nome: string;
  telefone_e164: string | null;
  dias_conta_aberta: number | null;
  ultima_interacao_em: string | null;
  etiquetas: string[] | null;
};

const ETIQUETA_ROTEIRO = "Ativação · roteiro enviado";

type LinhaRisco = {
  customer_id: string;
  nome_completo: string;
  lotes_30d: number | null;
  lotes_30d_anterior: number | null;
  dias_sem_giro: number | null;
  receita_30d_centavos: number | null;
  lead_id: string | null;
  ultima_interacao_em: string | null;
};

type LinhaQuadro = {
  responsavel_id: string;
  nome: string;
  meta_contatos_dia: number;
  mensagens_manuais: number;
  mensagens_disparo: number;
  aguardando: number;
  espera_max_horas: number | null;
  tarefas_vencidas: number;
  giro_em_risco: number;
};

type LinhaVendaPendente = {
  id: string;
  valor_comissao_centavos: number;
  ocorreu_em: string;
  produto: { nome: string } | null;
  lead: { id: string; nome: string } | null;
};

/** "menos de 1h", "5h", "3 dias" — a idade da espera, sem casas decimais. */
function tempoEsperando(horas: number | null) {
  if (horas === null) return "—";
  if (horas < 1) return "menos de 1h";
  if (horas < 24) return `${Math.floor(horas)}h`;
  const dias = Math.floor(horas / 24);
  return dias === 1 ? "1 dia" : `${dias} dias`;
}

export default async function HojePage({ searchParams }: PageProps<"/hoje">) {
  const params = await searchParams;
  const perfil = await perfilAtual();
  // O layout do grupo (app) já redireciona sem sessão — isto só acalma o tipo.
  if (!perfil) return null;

  const ehGestor = veTudo(perfil.papel);
  const dePedido = typeof params.de === "string" ? params.de : "";

  const supabase = await createClient();

  // A equipe só entra para o seletor do gestor — vendedor vê o próprio dia.
  let equipe: { id: string; nome: string }[] = [];
  if (ehGestor) {
    const { data } = await supabase
      .from("profiles")
      .select("id, nome")
      .eq("ativo", true)
      .order("nome");
    equipe = data ?? [];
  }

  const alvoId =
    ehGestor && dePedido && equipe.some((p) => p.id === dePedido)
      ? dePedido
      : perfil.id;
  const outraPessoa = alvoId !== perfil.id;
  const nomeAlvo = outraPessoa
    ? (equipe.find((p) => p.id === alvoId)?.nome ?? "")
    : perfil.nome;

  const hoje = agoraEmBrasilia();

  // Itens sonecados pelo alvo (fase 5): somem das filas até amanhã de manhã.
  // Consulta minúscula ANTES das demais — os ids entram como filtro. Sem a
  // migração 0049 vem erro e as filas seguem completas.
  const { data: sonecas } = await supabase
    .from("hoje_soneca")
    .select("tipo, alvo")
    .eq("pessoa", alvoId)
    .gt("ate", new Date().toISOString());
  const sonecaAtivacao = (sonecas ?? [])
    .filter((x) => x.tipo === "ativacao")
    .map((x) => x.alvo);
  const sonecaRisco = new Set(
    (sonecas ?? []).filter((x) => x.tipo === "risco").map((x) => x.alvo),
  );
  // Brasil não tem mais horário de verão — o deslocamento é fixo (lib/format).
  const fimDeHoje = `${hoje.dia}T23:59:59-03:00`;
  // eslint-disable-next-line react-hooks/purity -- Server Component: um render por request
  const agoraMs = Date.now();

  // Ativações de hoje não existem estruturadas: são o cliente da pessoa cujo
  // PRIMEIRO lote da vida entrou na importação de hoje. Como o arquivo da
  // Genial chega no dia seguinte, o rótulo da tela diz "registradas hoje".
  async function ativacoesRegistradasHoje(): Promise<number> {
    // Uma viagem só (RPC da 0047); sem a migração, cai na cadeia de três.
    const { data: viaRpc, error: erroRpc } = await supabase.rpc(
      "ativacoes_registradas",
      { p_responsavel: alvoId, p_inicio: hoje.inicioDoDia },
    );
    if (!erroRpc) return Number(viaRpc ?? 0);

    const { data: deHoje } = await supabase
      .from("customer_lots")
      .select("customer_id")
      .gte("criado_em", hoje.inicioDoDia)
      .limit(1000);
    const candidatos = [...new Set((deHoje ?? []).map((l) => l.customer_id))];
    if (candidatos.length === 0) return 0;
    const { data: antigos } = await supabase
      .from("customer_lots")
      .select("customer_id")
      .in("customer_id", candidatos)
      .lt("criado_em", hoje.inicioDoDia)
      .limit(1000);
    const jaTinham = new Set((antigos ?? []).map((l) => l.customer_id));
    const novos = candidatos.filter((c) => !jaTinham.has(c));
    if (novos.length === 0) return 0;
    const { count } = await supabase
      .from("customers")
      .select("id", { count: "exact", head: true })
      .in("id", novos)
      .eq("responsavel_id", alvoId);
    return count ?? 0;
  }

  const [
    { data: vencidasData, count: totalVencidas, error: erroTarefas },
    { data: deHojeData, count: totalDeHoje },
    { data: esperaData, count: totalEspera, error: erroEspera },
    { data: ativacaoData, count: totalAtivacao, error: erroAtivacao },
    { count: enviadasManuais },
    { count: enviadasDisparo },
    { count: respostasHoje },
    { count: ganhosHoje },
    { count: vendasHoje },
    ativacoesHoje,
    { data: quadroData },
    { data: riscoBruto, error: erroRisco },
    { data: pendentesData, count: totalPendentes, error: erroPendentes },
    { data: metaPerfil },
  ] = await Promise.all([
    // 1a. Vencidas de OUTROS dias. Fatia separada das de hoje (6.3): numa
    // consulta só, ordenada por vence_em, um monte de vencidas antigas
    // empurrava a agenda do dia para fora do limite de 25.
    supabase
      .from("lead_tasks")
      .select("id, titulo, vence_em, lead:leads(id, nome)", { count: "exact" })
      .eq("responsavel_id", alvoId)
      .is("concluida_em", null)
      .lt("vence_em", hoje.inicioDoDia)
      .order("vence_em", { ascending: true })
      .limit(LIMITE),
    // 1b. A agenda de hoje: vence entre a meia-noite e o fim do dia, em
    // ordem de hora, em Brasília.
    supabase
      .from("lead_tasks")
      .select("id, titulo, vence_em, lead:leads(id, nome)", { count: "exact" })
      .eq("responsavel_id", alvoId)
      .is("concluida_em", null)
      .gte("vence_em", hoje.inicioDoDia)
      .lte("vence_em", fimDeHoje)
      .order("vence_em", { ascending: true })
      .limit(LIMITE),
    // 2. Cliente falou por último e ninguém voltou — quem espera há mais
    // tempo vem primeiro (mesma definição canônica da view, migração 0032).
    supabase
      .from("v_leads_listas")
      .select(
        "lead_id, nome, telefone_e164, horas_esperando, customer_id, quente_sem_conta",
        { count: "exact" },
      )
      .eq("aguardando_resposta", true)
      .eq("responsavel_id", alvoId)
      .order("horas_esperando", { ascending: false, nullsFirst: false })
      // Empate no tempo: cliente vem primeiro (customer_id nulo por último).
      .order("customer_id", { ascending: true, nullsFirst: false })
      .limit(LIMITE),
    // 3. Conta aberta sem primeiro giro: recém-abertas ou que já conversaram
    // com a mesa — as duas filas que cabem em telefone, não em campanha.
    // Quem nunca recebeu o roteiro vem primeiro; dentro de cada grupo, a
    // conta mais antiga primeiro (é a que está há mais tempo sem gerar nada).
    // Duas consultas porque não dá para ordenar por "tem a etiqueta" no
    // servidor; a segunda só completa o que faltar até o limite.
    (async () => {
      const campos =
        "lead_id, nome, telefone_e164, dias_conta_aberta, ultima_interacao_em, etiquetas";
      const base = () => {
        let q = supabase
          .from("v_leads_listas")
          .select(campos, { count: "exact" })
          .or("primeiro_giro_recente.is.true,sem_giro_ja_conversou.is.true")
          .eq("responsavel_id", alvoId);
        if (sonecaAtivacao.length > 0) {
          q = q.not("lead_id", "in", `(${sonecaAtivacao.join(",")})`);
        }
        return q;
      };

      const semRoteiro = await base()
        .not("etiquetas", "cs", `{"${ETIQUETA_ROTEIRO}"}`)
        .order("conta_aberta_em", { ascending: true, nullsFirst: false })
        .limit(LIMITE);
      // Coluna de etiquetas ausente (0037): cai na consulta única de antes.
      if (semRoteiro.error) {
        return supabase
          .from("v_leads_listas")
          .select(campos.replace(", etiquetas", ""), { count: "exact" })
          .or("primeiro_giro_recente.is.true,sem_giro_ja_conversou.is.true")
          .eq("responsavel_id", alvoId)
          .order("conta_aberta_em", { ascending: false, nullsFirst: false })
          .limit(LIMITE);
      }

      const faltam = LIMITE - (semRoteiro.data?.length ?? 0);
      const comRoteiro =
        faltam > 0
          ? await base()
              .contains("etiquetas", [ETIQUETA_ROTEIRO])
              .order("conta_aberta_em", { ascending: true, nullsFirst: false })
              .limit(faltam)
          : { data: [], count: 0 };

      return {
        data: [...(semRoteiro.data ?? []), ...(comRoteiro.data ?? [])],
        count: (semRoteiro.count ?? 0) + (comRoteiro.count ?? 0),
        error: null,
      };
    })(),
    // Placar do dia, tudo desde a meia-noite de Brasília.
    // Mensagens MANUAIS: digitadas no chat. O disparo em massa grava com o
    // autor de quem clicou — sem este corte ele inflava a meta de contatos.
    supabase
      .from("lead_interactions")
      .select("id", { count: "exact", head: true })
      .eq("tipo", "mensagem_enviada")
      .eq("autor_id", alvoId)
      .gte("criado_em", hoje.inicioDoDia)
      .or("metadados->>via.is.null,metadados->>via.neq.disparo"),
    supabase
      .from("lead_interactions")
      .select("id", { count: "exact", head: true })
      .eq("tipo", "mensagem_enviada")
      .eq("autor_id", alvoId)
      .gte("criado_em", hoje.inicioDoDia)
      .eq("metadados->>via", "disparo"),
    // Respostas recebidas hoje nos leads da pessoa.
    supabase
      .from("lead_interactions")
      .select("id, lead:leads!inner(responsavel_id)", {
        count: "exact",
        head: true,
      })
      .eq("tipo", "mensagem_recebida")
      .eq("lead.responsavel_id", alvoId)
      .gte("criado_em", hoje.inicioDoDia),
    // Contas abertas hoje = leads da pessoa marcados como ganho hoje (o
    // carimbo é na hora do vínculo; a data da Genial só chega amanhã).
    supabase
      .from("leads")
      .select("id", { count: "exact", head: true })
      .eq("responsavel_id", alvoId)
      .eq("status", "ganho")
      .gte("cliente_confirmado_em", hoje.inicioDoDia),
    // Vendas confirmadas hoje.
    supabase
      .from("sales")
      .select("id", { count: "exact", head: true })
      .eq("vendedor_id", alvoId)
      .eq("status", "confirmada")
      .gte("ocorreu_em", hoje.inicioDoDia),
    ativacoesRegistradasHoje(),
    // Quadro da equipe (só gestor; a RPC devolve vazio para vendedor e erro
    // sem a migração 0048 — o quadro simplesmente não aparece).
    ehGestor
      ? supabase.rpc("quadro_equipe", { p_inicio: hoje.inicioDoDia })
      : Promise.resolve({ data: null, error: null }),
    // 4. Giro em risco: mesmo critério da Carteira (queda de 25%+ ou zerou,
    // entre quem já girou). A comparação coluna×coluna (atual < 75% do
    // anterior) não existe no PostgREST: busca o conjunto candidato — quem já
    // girou nesta carteira, um punhado — e o critério exato fecha aqui.
    supabase
      .from("v_carteira")
      .select(
        "customer_id, nome_completo, lotes_30d, lotes_30d_anterior, dias_sem_giro, receita_30d_centavos, lead_id, ultima_interacao_em",
      )
      .eq("responsavel_id", alvoId)
      .not("ultimo_giro_em", "is", null)
      .or("lotes_30d.eq.0,lotes_30d_anterior.gt.0")
      .limit(1000),
    // 5. Vendas pendentes há mais de 7 dias.
    supabase
      .from("sales")
      .select(
        "id, valor_comissao_centavos, ocorreu_em, produto:products(nome), lead:leads(id, nome)",
        { count: "exact" },
      )
      .eq("vendedor_id", alvoId)
      .eq("status", "pendente")
      .lte("ocorreu_em", new Date(agoraMs - 7 * 86_400_000).toISOString())
      .order("ocorreu_em", { ascending: true })
      .limit(LIMITE),
    supabase
      .from("profiles")
      .select("meta_contatos_dia")
      .eq("id", alvoId)
      .maybeSingle(),
  ]);

  const paraTarefa = (t: LinhaTarefa): TarefaDia => ({
    id: t.id,
    titulo: t.titulo,
    quandoRotulo: horaOuData(t.vence_em) || "—",
    vencida: new Date(t.vence_em).getTime() < agoraMs,
    leadId: t.lead!.id,
    leadNome: t.lead!.nome,
  });
  const tarefasVencidas: TarefaDia[] = (
    (vencidasData ?? []) as unknown as LinhaTarefa[]
  )
    .filter((t) => t.lead)
    .map(paraTarefa);
  const tarefasDeHoje: TarefaDia[] = (
    (deHojeData ?? []) as unknown as LinhaTarefa[]
  )
    .filter((t) => t.lead)
    .map(paraTarefa);
  const totalTarefas = (totalVencidas ?? 0) + (totalDeHoje ?? 0);
  const exibidasTarefas = tarefasVencidas.length + tarefasDeHoje.length;

  const espera = (esperaData ?? []) as unknown as LinhaEspera[];

  // Critério exato do risco + ordenação pelo maior dinheiro em risco.
  const riscoTodos = ((riscoBruto ?? []) as unknown as LinhaRisco[])
    .filter((c) => {
      if (sonecaRisco.has(c.customer_id)) return false;
      const atual = c.lotes_30d ?? 0;
      const anterior = c.lotes_30d_anterior ?? 0;
      return atual === 0 || (anterior > 0 && atual < anterior * 0.75);
    })
    .sort(
      (a, b) => (b.receita_30d_centavos ?? 0) - (a.receita_30d_centavos ?? 0),
    );
  const risco = riscoTodos.slice(0, LIMITE);
  const totalRisco = riscoTodos.length;

  const pendentes = (pendentesData ?? []) as unknown as LinhaVendaPendente[];

  // Ritmo esperado da meta: fração do expediente (9h–18h de Brasília) já
  // decorrida. Antes das 9h ninguém está "atrasado"; depois das 18h a meta
  // cobra inteira.
  const fracaoExpediente = Math.min(1, Math.max(0, (hoje.hora - 9) / 9));
  const quadro = (quadroData ?? []) as unknown as LinhaQuadro[];
  const ativacao = (ativacaoData ?? []) as unknown as LinhaAtivacao[];

  const enviadas = enviadasManuais ?? 0;
  const disparos = enviadasDisparo ?? 0;
  const meta = metaPerfil?.meta_contatos_dia ?? 0;
  const progresso = meta > 0 ? Math.min(100, (enviadas / meta) * 100) : 0;

  const erroView = erroEspera ?? erroAtivacao;

  return (
    <div className="flex min-h-full flex-col p-2 md:p-3">
      <header className="flex flex-wrap items-end justify-between gap-2 border-b border-neutral-200 pb-2">
        <div>
          <h1 className="text-h1 text-neutral-900">Hoje</h1>
          <p className="mt-1 max-w-[68ch] text-sm text-neutral-600">
            {outraPessoa
              ? `A fila do dia de ${nomeAlvo}, em ordem do que fazer primeiro.`
              : "Sua fila do dia, em ordem do que fazer primeiro."}
          </p>
        </div>

        {ehGestor && equipe.length > 0 ? (
          <form action="/hoje" method="get" className="flex items-center gap-1">
            <label htmlFor="de" className="sr-only">
              Ver o dia de
            </label>
            <select
              id="de"
              name="de"
              defaultValue={alvoId}
              className="h-[40px] max-w-[220px] rounded-md border border-neutral-300 bg-neutral-0 px-1 text-sm text-neutral-800 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-primary-500"
            >
              {equipe.map((p) => (
                <option key={p.id} value={p.id}>
                  {p.id === perfil.id ? `${p.nome} (eu)` : p.nome}
                </option>
              ))}
            </select>
            <button
              type="submit"
              className="inline-flex h-[40px] items-center rounded-md border border-neutral-300 bg-neutral-0 px-1.5 text-sm font-medium text-neutral-800 transition-colors duration-[120ms] hover:bg-neutral-100 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-primary-500"
            >
              Ver
            </button>
          </form>
        ) : null}
      </header>

      {/* ── Placar do dia ── */}
      <section
        aria-labelledby="placar-titulo"
        className="mt-2 max-w-[720px] rounded-lg border border-neutral-200 bg-neutral-0 p-2 shadow-sm"
      >
        <h2
          id="placar-titulo"
          className="text-xs font-medium tracking-[0.06em] text-neutral-600 uppercase"
        >
          Placar do dia
        </h2>

        <div className="mt-1 flex flex-wrap items-baseline justify-between gap-1">
          <p className="text-sm text-neutral-800">Mensagens manuais</p>
          <p className="font-mono text-sm text-neutral-800 tabular-nums">
            {enviadas}
            {meta > 0 ? ` / ${meta}` : ""}
            {disparos > 0 ? (
              <span className="ml-1 text-xs text-neutral-400">
                + {disparos} por disparo
              </span>
            ) : null}
          </p>
        </div>
        {meta > 0 ? (
          <>
            <span
              aria-hidden
              className="mt-0.5 block h-1 overflow-hidden rounded-sm bg-neutral-100"
            >
              <span
                className="block h-full rounded-sm bg-primary-600"
                style={{ width: `${progresso}%` }}
              />
            </span>
            <p className="mt-0.5 text-xs text-neutral-600">
              {enviadas >= meta
                ? "Meta do dia batida."
                : `Faltam ${meta - enviadas} para a meta do dia.`}
            </p>
          </>
        ) : (
          <p className="mt-0.5 text-xs text-neutral-600">
            Sem meta diária definida — a administração define no perfil de cada
            vendedor.
          </p>
        )}

        <dl className="mt-2 grid grid-cols-2 gap-1 border-t border-neutral-200 pt-2 sm:grid-cols-4">
          <div>
            <dt className="text-xs text-neutral-600">Respostas recebidas</dt>
            <dd className="font-mono text-h3 text-neutral-900 tabular-nums">
              {respostasHoje ?? 0}
            </dd>
          </div>
          <div>
            <dt className="text-xs text-neutral-600">Contas abertas</dt>
            <dd className="font-mono text-h3 text-neutral-900 tabular-nums">
              {ganhosHoje ?? 0}
            </dd>
          </div>
          <div>
            <dt
              className="text-xs text-neutral-600"
              title="Cliente seu cujo primeiro lote da vida entrou na importação de hoje — o arquivo da Genial chega no dia seguinte à operação."
            >
              Ativações registradas
            </dt>
            <dd className="font-mono text-h3 text-neutral-900 tabular-nums">
              {ativacoesHoje}
            </dd>
          </div>
          <div>
            <dt className="text-xs text-neutral-600">Vendas confirmadas</dt>
            <dd className="font-mono text-h3 text-neutral-900 tabular-nums">
              {vendasHoje ?? 0}
            </dd>
          </div>
        </dl>
      </section>

      {/* ── Quadro da equipe (gestor) ── */}
      {ehGestor && quadro.length > 0 ? (
        <section aria-labelledby="quadro-titulo" className="mt-3 max-w-[720px]">
          <h2
            id="quadro-titulo"
            className="text-xs font-medium tracking-[0.06em] text-neutral-600 uppercase"
          >
            Quadro da equipe
          </h2>
          <div className="mt-1 overflow-x-auto rounded-lg border border-neutral-200 bg-neutral-0 shadow-sm">
            <table className="w-full min-w-[560px] border-collapse text-left">
              <thead>
                <tr className="border-b border-neutral-200 bg-neutral-50">
                  <th className="px-2 py-1 text-xs tracking-[0.06em] text-neutral-600 uppercase">
                    Pessoa
                  </th>
                  <th className="px-2 py-1 text-right text-xs tracking-[0.06em] text-neutral-600 uppercase">
                    Msgs / meta
                  </th>
                  <th className="px-2 py-1 text-right text-xs tracking-[0.06em] text-neutral-600 uppercase">
                    Aguardando
                  </th>
                  <th className="px-2 py-1 text-right text-xs tracking-[0.06em] text-neutral-600 uppercase">
                    Vencidas
                  </th>
                  <th className="px-2 py-1 text-right text-xs tracking-[0.06em] text-neutral-600 uppercase">
                    Giro em risco
                  </th>
                </tr>
              </thead>
              <tbody className="divide-y divide-neutral-200">
                {quadro.map((q) => {
                  // "Abaixo do ritmo": a meta cobrada proporcional à fração
                  // do expediente já decorrida (9h–18h de Brasília).
                  const esperado = Math.ceil(
                    q.meta_contatos_dia * fracaoExpediente,
                  );
                  const metaAtrasada =
                    q.meta_contatos_dia > 0 &&
                    esperado > 0 &&
                    q.mensagens_manuais < esperado;
                  const esperaEstourada = (q.espera_max_horas ?? 0) >= 24;
                  return (
                    <tr key={q.responsavel_id} className="h-[48px]">
                      <td className="px-2">
                        <Link
                          href={`/hoje?de=${q.responsavel_id}`}
                          className={cn(
                            "rounded-sm text-sm font-medium underline-offset-2 hover:underline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-primary-500",
                            q.responsavel_id === alvoId
                              ? "text-primary-600"
                              : "text-neutral-800",
                          )}
                        >
                          {q.nome}
                        </Link>
                      </td>
                      <td
                        className={cn(
                          "px-2 text-right font-mono text-sm tabular-nums",
                          metaAtrasada
                            ? "font-medium text-danger"
                            : "text-neutral-800",
                        )}
                        title={
                          metaAtrasada
                            ? `Abaixo do ritmo: o esperado a esta hora era ${esperado}.`
                            : undefined
                        }
                      >
                        {q.mensagens_manuais}
                        {q.meta_contatos_dia > 0
                          ? ` / ${q.meta_contatos_dia}`
                          : ""}
                        {q.mensagens_disparo > 0 ? (
                          <span className="ml-0.5 text-xs font-normal text-neutral-400">
                            +{q.mensagens_disparo}
                          </span>
                        ) : null}
                      </td>
                      <td
                        className={cn(
                          "px-2 text-right font-mono text-sm tabular-nums",
                          esperaEstourada
                            ? "font-medium text-danger"
                            : "text-neutral-800",
                        )}
                        title={
                          esperaEstourada
                            ? "Há conversa esperando há mais de 24h nesta fila."
                            : undefined
                        }
                      >
                        {q.aguardando}
                      </td>
                      <td
                        className={cn(
                          "px-2 text-right font-mono text-sm tabular-nums",
                          q.tarefas_vencidas > 0
                            ? "font-medium text-danger"
                            : "text-neutral-800",
                        )}
                      >
                        {q.tarefas_vencidas}
                      </td>
                      <td className="px-2 text-right font-mono text-sm text-neutral-800 tabular-nums">
                        {q.giro_em_risco}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
          <p className="mt-0.5 text-xs text-neutral-600">
            Vermelho: tarefa vencida, conversa esperando 24h+ ou meta abaixo do
            ritmo do expediente. Clique no nome para ver a fila da pessoa.
          </p>
        </section>
      ) : null}

      {/* ── 1. Tarefas ── */}
      <section className="mt-3 max-w-[720px]" aria-labelledby="tarefas-titulo">
        <div className="flex flex-wrap items-baseline gap-1">
          <h2
            id="tarefas-titulo"
            className="text-xs font-medium tracking-[0.06em] text-neutral-600 uppercase"
          >
            1 · Tarefas vencidas e de hoje
          </h2>
          <span className="font-mono text-xs text-neutral-400 tabular-nums">
            {totalTarefas}
          </span>
          {(totalVencidas ?? 0) > 0 ? (
            <span className="inline-flex h-[20px] items-center rounded-sm bg-danger-bg px-1 text-xs font-medium text-danger">
              {totalVencidas === 1 ? "1 vencida" : `${totalVencidas} vencidas`}
            </span>
          ) : null}
          <Link
            href="/agenda"
            className="ml-auto inline-flex h-[32px] items-center rounded-md border border-neutral-300 bg-neutral-0 px-1.5 text-sm font-medium text-neutral-800 transition-colors duration-[120ms] hover:bg-neutral-100 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-primary-500"
          >
            Ver calendário
          </Link>
        </div>

        {erroTarefas ? (
          <p
            role="alert"
            className="mt-1 max-w-[68ch] rounded-md bg-warning-bg px-1.5 py-1 text-sm text-warning"
          >
            As tarefas dependem da migração 0013 (lead_tasks) — rode-a no SQL
            Editor do Supabase.
          </p>
        ) : exibidasTarefas === 0 ? (
          <p className="mt-1 rounded-lg border border-dashed border-neutral-300 p-2 text-sm text-neutral-600">
            Tudo em dia — nenhuma tarefa vencida nem marcada para hoje.
          </p>
        ) : (
          <>
            {tarefasVencidas.length > 0 ? (
              <>
                <h3 className="mt-1 text-xs font-medium text-danger">
                  Vencidas de outros dias
                </h3>
                <ul className="mt-0.5 flex flex-col gap-1">
                  {tarefasVencidas.map((t) => (
                    <TarefaDoDia key={t.id} tarefa={t} />
                  ))}
                </ul>
              </>
            ) : null}
            {tarefasDeHoje.length > 0 ? (
              <>
                <h3 className="mt-1 text-xs font-medium text-neutral-600">
                  Hoje, em ordem de hora
                </h3>
                <ul className="mt-0.5 flex flex-col gap-1">
                  {tarefasDeHoje.map((t) => (
                    <TarefaDoDia key={t.id} tarefa={t} />
                  ))}
                </ul>
              </>
            ) : null}
            {totalTarefas > exibidasTarefas ? (
              <p className="mt-1 text-xs text-neutral-600">
                +
                <span className="font-mono tabular-nums">
                  {totalTarefas - exibidasTarefas}
                </span>{" "}
                tarefa(s) além destas —{" "}
                <Link
                  href="/agenda"
                  className="font-medium text-primary-500 underline-offset-2 hover:underline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-primary-500"
                >
                  ver todas na Agenda
                </Link>
              </p>
            ) : null}
          </>
        )}
      </section>

      {/* ── 2. Aguardando resposta ── */}
      <section className="mt-3 max-w-[720px]" aria-labelledby="espera-titulo">
        <div className="flex flex-wrap items-baseline gap-1">
          <h2
            id="espera-titulo"
            className="text-xs font-medium tracking-[0.06em] text-neutral-600 uppercase"
          >
            2 · Aguardando resposta
          </h2>
          <span className="font-mono text-xs text-neutral-400 tabular-nums">
            {totalEspera ?? 0}
          </span>
        </div>
        <p className="mt-0.5 max-w-[68ch] text-sm text-neutral-600">
          O cliente mandou a última mensagem e ninguém voltou. Quem espera há
          mais tempo vem primeiro.
        </p>

        {erroEspera ? null : espera.length === 0 ? (
          <p className="mt-1 rounded-lg border border-dashed border-neutral-300 p-2 text-sm text-neutral-600">
            Tudo em dia — ninguém esperando resposta.
          </p>
        ) : (
          <>
            <ul className="mt-1 flex flex-col gap-1">
              {espera.map((l) => (
                <li
                  key={l.lead_id}
                  className="flex items-center gap-0.5 rounded-md border border-neutral-200 bg-neutral-0 pr-0.5 transition-colors duration-[120ms] hover:border-neutral-300"
                >
                  <ItemConversa
                    leadId={l.lead_id}
                    nome={l.nome}
                    className="flex min-w-0 flex-1 items-center gap-1 rounded-md px-1.5 py-1 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-primary-500"
                  >
                    <span className="min-w-0 flex-1">
                      <span className="flex items-center gap-1">
                        <span className="truncate text-sm font-medium text-neutral-800">
                          {l.nome}
                        </span>
                        {l.customer_id ? (
                          <span className="inline-flex h-[20px] shrink-0 items-center rounded-sm bg-success-bg px-1 text-xs font-medium text-success">
                            cliente
                          </span>
                        ) : l.quente_sem_conta ? (
                          <span className="inline-flex h-[20px] shrink-0 items-center rounded-sm bg-accent-100 px-1 text-xs font-medium text-accent-700">
                            quente · sem conta
                          </span>
                        ) : null}
                      </span>
                      <span className="block font-mono text-xs text-neutral-600 tabular-nums">
                        {l.telefone_e164
                          ? formatarTelefone(l.telefone_e164)
                          : "sem telefone"}
                      </span>
                    </span>
                    <span
                      className={cn(
                        "shrink-0 font-mono text-xs tabular-nums",
                        (l.horas_esperando ?? 0) >= 24
                          ? "font-medium text-danger"
                          : "text-neutral-600",
                      )}
                    >
                      espera {tempoEsperando(l.horas_esperando)}
                    </span>
                    <MessageSquare
                      size={16}
                      strokeWidth={1.5}
                      aria-hidden
                      className="shrink-0 text-neutral-400"
                    />
                  </ItemConversa>
                  <BotaoSoneca
                    tipo="conversa"
                    alvo={l.lead_id}
                    pessoa={alvoId}
                  />
                </li>
              ))}
            </ul>
            <MaisNaLista
              total={totalEspera ?? 0}
              href="/leads?lista=aguardando"
              rotulo="ver a lista em Leads"
              unidade="conversa(s)"
            />
          </>
        )}
      </section>

      {/* ── 3. Fila de ativação ── */}
      <section className="mt-3 max-w-[720px]" aria-labelledby="ativacao-titulo">
        <div className="flex flex-wrap items-baseline gap-1">
          <h2
            id="ativacao-titulo"
            className="text-xs font-medium tracking-[0.06em] text-neutral-600 uppercase"
          >
            3 · Fila de ativação
          </h2>
          <span className="font-mono text-xs text-neutral-400 tabular-nums">
            {totalAtivacao ?? 0}
          </span>
        </div>
        <p className="mt-0.5 max-w-[68ch] text-sm text-neutral-600">
          Conta aberta, sem 1º giro — o roteiro do Profit Pro é para eles. Quem
          nunca recebeu o roteiro vem primeiro; depois, a conta mais antiga.
        </p>

        {erroAtivacao ? null : ativacao.length === 0 ? (
          <p className="mt-1 rounded-lg border border-dashed border-neutral-300 p-2 text-sm text-neutral-600">
            Nenhuma conta aberta sem primeiro giro nesta carteira.
          </p>
        ) : (
          <>
            <ul className="mt-1 flex flex-col gap-1">
              {ativacao.map((l) => (
                <li
                  key={l.lead_id}
                  className="flex items-center gap-0.5 rounded-md border border-neutral-200 bg-neutral-0 pr-0.5 transition-colors duration-[120ms] hover:border-neutral-300"
                >
                  <ItemConversa
                    leadId={l.lead_id}
                    nome={l.nome}
                    className="flex min-w-0 flex-1 items-center gap-1 rounded-md px-1.5 py-1 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-primary-500"
                  >
                    <span className="min-w-0 flex-1">
                      <span className="flex items-center gap-1">
                        <span className="truncate text-sm font-medium text-neutral-800">
                          {l.nome}
                        </span>
                        {l.etiquetas?.includes(ETIQUETA_ROTEIRO) ? (
                          <span className="inline-flex h-[20px] shrink-0 items-center rounded-sm bg-neutral-100 px-1 text-xs text-neutral-600">
                            roteiro enviado
                          </span>
                        ) : (
                          <span className="inline-flex h-[20px] shrink-0 items-center rounded-sm bg-accent-100 px-1 text-xs font-medium text-accent-700">
                            sem roteiro
                          </span>
                        )}
                      </span>
                      <span className="block font-mono text-xs text-neutral-600 tabular-nums">
                        {l.telefone_e164
                          ? formatarTelefone(l.telefone_e164)
                          : "sem telefone"}
                        {l.ultima_interacao_em
                          ? ` · último contato ${horaOuData(l.ultima_interacao_em)}`
                          : " · nunca contatado"}
                      </span>
                    </span>
                    <span className="shrink-0 font-mono text-xs text-neutral-600 tabular-nums">
                      {l.dias_conta_aberta === null
                        ? "conta aberta"
                        : l.dias_conta_aberta <= 0
                          ? "conta aberta hoje"
                          : l.dias_conta_aberta === 1
                            ? "conta há 1 dia"
                            : `conta há ${l.dias_conta_aberta} dias`}
                    </span>
                    <MessageSquare
                      size={16}
                      strokeWidth={1.5}
                      aria-hidden
                      className="shrink-0 text-neutral-400"
                    />
                  </ItemConversa>
                  <BotaoSoneca
                    tipo="ativacao"
                    alvo={l.lead_id}
                    pessoa={alvoId}
                  />
                </li>
              ))}
            </ul>
            <MaisNaLista
              total={totalAtivacao ?? 0}
              href="/leads?lista=primeiro_giro"
              rotulo="ver a lista em Leads"
              unidade="conta(s)"
            />
          </>
        )}
      </section>

      {/* ── 4. Giro em risco ── */}
      <section className="mt-3 max-w-[720px]" aria-labelledby="risco-titulo">
        <div className="flex flex-wrap items-baseline gap-1">
          <h2
            id="risco-titulo"
            className="text-xs font-medium tracking-[0.06em] text-neutral-600 uppercase"
          >
            4 · Giro em risco
          </h2>
          <span className="font-mono text-xs text-neutral-400 tabular-nums">
            {totalRisco}
          </span>
        </div>
        <p className="mt-0.5 max-w-[68ch] text-sm text-neutral-600">
          Clientes desta carteira que caíram 25%+ ou zeraram o giro — o maior
          dinheiro em risco primeiro.
        </p>

        {erroRisco ? null : risco.length === 0 ? (
          <p className="mt-1 rounded-lg border border-dashed border-neutral-300 p-2 text-sm text-neutral-600">
            Tudo em dia — nenhum cliente desta carteira com giro em risco.
          </p>
        ) : (
          <>
            <ul className="mt-1 flex flex-col gap-1">
              {risco.map((c) => {
                return (
                  <li
                    key={c.customer_id}
                    className="flex items-center gap-0.5 rounded-md border border-neutral-200 bg-neutral-0 pr-0.5 transition-colors duration-[120ms] hover:border-neutral-300"
                  >
                    {c.lead_id ? (
                      <ItemConversa
                        leadId={c.lead_id}
                        nome={c.nome_completo}
                        className="flex min-w-0 flex-1 items-center gap-1 rounded-md px-1.5 py-1 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-primary-500"
                      >
                        <ConteudoRisco c={c} />
                      </ItemConversa>
                    ) : (
                      <Link
                        href={`/carteira/${c.customer_id}`}
                        className="flex min-w-0 flex-1 items-center gap-1 rounded-md px-1.5 py-1 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-primary-500"
                      >
                        <ConteudoRisco c={c} />
                      </Link>
                    )}
                    <BotaoSoneca
                      tipo="risco"
                      alvo={c.customer_id}
                      pessoa={alvoId}
                    />
                  </li>
                );
              })}
            </ul>
            <MaisNaLista
              total={totalRisco}
              href="/leads?lista=giro_em_risco"
              rotulo="ver a lista em Leads"
              unidade="cliente(s)"
            />
          </>
        )}
      </section>

      {/* ── 5. Vendas pendentes ── */}
      <section
        className="mt-3 max-w-[720px]"
        aria-labelledby="pendentes-titulo"
      >
        <div className="flex flex-wrap items-baseline gap-1">
          <h2
            id="pendentes-titulo"
            className="text-xs font-medium tracking-[0.06em] text-neutral-600 uppercase"
          >
            5 · Vendas pendentes
          </h2>
          <span className="font-mono text-xs text-neutral-400 tabular-nums">
            {totalPendentes ?? 0}
          </span>
        </div>
        <p className="mt-0.5 max-w-[68ch] text-sm text-neutral-600">
          Vendas suas paradas em “pendente” há mais de 7 dias — confirmar ou
          cancelar.
        </p>

        {erroPendentes ? null : pendentes.length === 0 ? (
          <p className="mt-1 rounded-lg border border-dashed border-neutral-300 p-2 text-sm text-neutral-600">
            Tudo em dia — nenhuma venda pendente antiga.
          </p>
        ) : (
          <>
            <ul className="mt-1 flex flex-col gap-1">
              {pendentes.map((v) => (
                <li key={v.id}>
                  <Link
                    href={
                      v.lead ? `/leads/${v.lead.id}?aba=vendas` : "/pagamentos"
                    }
                    className="flex items-center gap-1 rounded-md border border-neutral-200 bg-neutral-0 px-1.5 py-1 transition-colors duration-[120ms] hover:border-neutral-300 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-primary-500"
                  >
                    <span className="min-w-0 flex-1">
                      <span className="block truncate text-sm font-medium text-neutral-800">
                        {v.lead?.nome ?? "Lead removido"}
                      </span>
                      <span className="block font-mono text-xs text-neutral-600 tabular-nums">
                        {v.produto?.nome ?? "produto"} ·{" "}
                        {formatarData(v.ocorreu_em)}
                      </span>
                    </span>
                    <span className="shrink-0 font-mono text-xs font-medium text-neutral-800 tabular-nums">
                      {formatarReais(v.valor_comissao_centavos)}
                    </span>
                  </Link>
                </li>
              ))}
            </ul>
            <MaisNaLista
              total={totalPendentes ?? 0}
              href="/pagamentos"
              rotulo="ver em Pagamentos"
              unidade="venda(s)"
            />
          </>
        )}
      </section>

      {erroView ? (
        <p
          role="alert"
          className="mt-3 max-w-[68ch] rounded-md border border-warning bg-warning-bg px-1.5 py-1 text-sm text-warning"
        >
          As filas de resposta e ativação dependem da migração 0032
          (v_leads_listas) — rode-a no SQL Editor do Supabase.
        </p>
      ) : null}

      <PainelConversa />
    </div>
  );
}

/** O conteúdo da linha de Giro em risco — igual dentro do painel ou do link. */
function ConteudoRisco({ c }: { c: LinhaRisco }) {
  const atual = c.lotes_30d ?? 0;
  const anterior = c.lotes_30d_anterior ?? 0;
  const variacao =
    anterior > 0 ? Math.round(((atual - anterior) / anterior) * 100) : null;
  return (
    <>
      <span className="min-w-0 flex-1">
        <span className="block truncate text-sm font-medium text-neutral-800">
          {c.nome_completo}
        </span>
        <span className="block font-mono text-xs text-neutral-600 tabular-nums">
          {atual} lote(s) 30d
          {variacao !== null ? (
            <span
              className={cn(
                "ml-0.5",
                variacao < 0 ? "text-danger" : "text-neutral-600",
              )}
            >
              ({variacao > 0 ? "+" : ""}
              {variacao}%)
            </span>
          ) : null}
          {c.dias_sem_giro !== null && c.dias_sem_giro > 0
            ? ` · sem giro há ${c.dias_sem_giro}d`
            : ""}
          {c.ultima_interacao_em
            ? ` · último contato ${horaOuData(c.ultima_interacao_em)}`
            : " · nunca contatado"}
        </span>
      </span>
      <span className="shrink-0 font-mono text-xs font-medium text-neutral-800 tabular-nums">
        {formatarReais(c.receita_30d_centavos ?? 0)}
      </span>
      <MessageSquare
        size={16}
        strokeWidth={1.5}
        aria-hidden
        className="shrink-0 text-neutral-400"
      />
    </>
  );
}

/** "+N além destas 25" com o caminho para a lista completa. */
function MaisNaLista({
  total,
  href,
  rotulo,
  unidade,
}: {
  total: number;
  href: string;
  rotulo: string;
  unidade: string;
}) {
  if (total <= LIMITE) return null;
  return (
    <p className="mt-1 text-xs text-neutral-600">
      +<span className="font-mono tabular-nums">{total - LIMITE}</span>{" "}
      {unidade} além destas {LIMITE} —{" "}
      <Link
        href={href}
        className="font-medium text-primary-500 underline-offset-2 hover:underline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-primary-500"
      >
        {rotulo}
      </Link>
    </p>
  );
}
