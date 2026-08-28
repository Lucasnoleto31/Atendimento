import type { Metadata } from "next";
import Link from "next/link";
import { MessageSquare } from "lucide-react";
import { createClient } from "@/lib/supabase/server";
import { perfilAtual } from "@/lib/auth";
import { agoraEmBrasilia, formatarTelefone, horaOuData } from "@/lib/format";
import { cn } from "@/lib/utils";
import { TarefaDoDia, type TarefaDia } from "./tarefa-do-dia";

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
};

type LinhaAtivacao = {
  lead_id: string;
  nome: string;
  telefone_e164: string | null;
  dias_conta_aberta: number | null;
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

  const ehGestor = perfil.papel === "admin" || perfil.papel === "gestor";
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
  // Brasil não tem mais horário de verão — o deslocamento é fixo (lib/format).
  const fimDeHoje = `${hoje.dia}T23:59:59-03:00`;
  // eslint-disable-next-line react-hooks/purity -- Server Component: um render por request
  const agoraMs = Date.now();

  // Ativações de hoje não existem estruturadas: são o cliente da pessoa cujo
  // PRIMEIRO lote da vida entrou na importação de hoje. Como o arquivo da
  // Genial chega no dia seguinte, o rótulo da tela diz "registradas hoje".
  async function ativacoesRegistradasHoje(): Promise<number> {
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
    { data: tarefasData, count: totalTarefas, error: erroTarefas },
    { data: esperaData, count: totalEspera, error: erroEspera },
    { data: ativacaoData, count: totalAtivacao, error: erroAtivacao },
    { count: enviadasManuais },
    { count: enviadasDisparo },
    { count: respostasHoje },
    { count: ganhosHoje },
    { count: vendasHoje },
    ativacoesHoje,
    { data: metaPerfil },
  ] = await Promise.all([
    // 1. Tarefas vencidas e as que vencem até o fim de hoje, em Brasília.
    supabase
      .from("lead_tasks")
      .select("id, titulo, vence_em, lead:leads(id, nome)", { count: "exact" })
      .eq("responsavel_id", alvoId)
      .is("concluida_em", null)
      .lte("vence_em", fimDeHoje)
      .order("vence_em", { ascending: true })
      .limit(LIMITE),
    // 2. Cliente falou por último e ninguém voltou — quem espera há mais
    // tempo vem primeiro (mesma definição canônica da view, migração 0032).
    supabase
      .from("v_leads_listas")
      .select("lead_id, nome, telefone_e164, horas_esperando", {
        count: "exact",
      })
      .eq("aguardando_resposta", true)
      .eq("responsavel_id", alvoId)
      .order("horas_esperando", { ascending: false, nullsFirst: false })
      .limit(LIMITE),
    // 3. Conta aberta sem primeiro giro: recém-abertas ou que já conversaram
    // com a mesa — as duas filas que cabem em telefone, não em campanha.
    supabase
      .from("v_leads_listas")
      .select("lead_id, nome, telefone_e164, dias_conta_aberta", {
        count: "exact",
      })
      .or("primeiro_giro_recente.is.true,sem_giro_ja_conversou.is.true")
      .eq("responsavel_id", alvoId)
      .order("conta_aberta_em", { ascending: false, nullsFirst: false })
      .limit(LIMITE),
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
    supabase
      .from("profiles")
      .select("meta_contatos_dia")
      .eq("id", alvoId)
      .maybeSingle(),
  ]);

  const tarefas: TarefaDia[] = ((tarefasData ?? []) as unknown as LinhaTarefa[])
    .filter((t) => t.lead)
    .map((t) => ({
      id: t.id,
      titulo: t.titulo,
      quandoRotulo: horaOuData(t.vence_em) || "—",
      vencida: new Date(t.vence_em).getTime() < agoraMs,
      leadId: t.lead!.id,
      leadNome: t.lead!.nome,
    }));
  const vencidas = tarefas.filter((t) => t.vencida).length;

  const espera = (esperaData ?? []) as unknown as LinhaEspera[];
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
            {totalTarefas ?? 0}
          </span>
          {vencidas > 0 ? (
            <span className="inline-flex h-[20px] items-center rounded-sm bg-danger-bg px-1 text-xs font-medium text-danger">
              {vencidas === 1 ? "1 vencida" : `${vencidas} vencidas`}
            </span>
          ) : null}
        </div>

        {erroTarefas ? (
          <p
            role="alert"
            className="mt-1 max-w-[68ch] rounded-md bg-warning-bg px-1.5 py-1 text-sm text-warning"
          >
            As tarefas dependem da migração 0013 (lead_tasks) — rode-a no SQL
            Editor do Supabase.
          </p>
        ) : tarefas.length === 0 ? (
          <p className="mt-1 rounded-lg border border-dashed border-neutral-300 p-2 text-sm text-neutral-600">
            Tudo em dia — nenhuma tarefa vencida nem marcada para hoje.
          </p>
        ) : (
          <>
            <ul className="mt-1 flex flex-col gap-1">
              {tarefas.map((t) => (
                <TarefaDoDia key={t.id} tarefa={t} />
              ))}
            </ul>
            <MaisNaLista
              total={totalTarefas ?? 0}
              href="/agenda"
              rotulo="ver todas na Agenda"
              unidade="tarefa(s)"
            />
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
                <li key={l.lead_id}>
                  <Link
                    href={`/chat?lead=${l.lead_id}`}
                    className="flex items-center gap-1 rounded-md border border-neutral-200 bg-neutral-0 px-1.5 py-1 transition-colors duration-[120ms] hover:border-neutral-300 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-primary-500"
                  >
                    <span className="min-w-0 flex-1">
                      <span className="block truncate text-sm font-medium text-neutral-800">
                        {l.nome}
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
                  </Link>
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
          Conta aberta, sem 1º giro — o roteiro do Profit Pro é para eles.
        </p>

        {erroAtivacao ? null : ativacao.length === 0 ? (
          <p className="mt-1 rounded-lg border border-dashed border-neutral-300 p-2 text-sm text-neutral-600">
            Nenhuma conta aberta sem primeiro giro nesta carteira.
          </p>
        ) : (
          <>
            <ul className="mt-1 flex flex-col gap-1">
              {ativacao.map((l) => (
                <li key={l.lead_id}>
                  <Link
                    href={`/chat?lead=${l.lead_id}`}
                    className="flex items-center gap-1 rounded-md border border-neutral-200 bg-neutral-0 px-1.5 py-1 transition-colors duration-[120ms] hover:border-neutral-300 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-primary-500"
                  >
                    <span className="min-w-0 flex-1">
                      <span className="block truncate text-sm font-medium text-neutral-800">
                        {l.nome}
                      </span>
                      <span className="block font-mono text-xs text-neutral-600 tabular-nums">
                        {l.telefone_e164
                          ? formatarTelefone(l.telefone_e164)
                          : "sem telefone"}
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
                  </Link>
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

      {erroView ? (
        <p
          role="alert"
          className="mt-3 max-w-[68ch] rounded-md border border-warning bg-warning-bg px-1.5 py-1 text-sm text-warning"
        >
          As filas de resposta e ativação dependem da migração 0032
          (v_leads_listas) — rode-a no SQL Editor do Supabase.
        </p>
      ) : null}
    </div>
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
