import type { Metadata } from "next";
import Link from "next/link";
import { ChevronLeft, ChevronRight, Clock, MessageSquare } from "lucide-react";
import { createClient } from "@/lib/supabase/server";
import { perfilAtual } from "@/lib/auth";
import { cn } from "@/lib/utils";
import { formatarHora } from "@/lib/format";
import { TarefaItem, type ItemAgenda } from "./tarefa-item";

export const metadata: Metadata = { title: "Agenda · Zeve CRM" };

const FUSO = "America/Sao_Paulo";
const DIAS_SEMANA = ["seg", "ter", "qua", "qui", "sex", "sáb", "dom"];

/** Chave YYYY-MM-DD no fuso da mesa, para o dia não virar à meia-noite errada. */
function chaveDia(data: Date): string {
  const partes = new Intl.DateTimeFormat("en-CA", {
    timeZone: FUSO,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(data);
  return partes; // en-CA já devolve YYYY-MM-DD
}

type MensagemAgendada = {
  id: string;
  texto: string;
  enviar_em: string;
  leadId: string;
  leadNome: string;
};

export default async function AgendaPage({
  searchParams,
}: PageProps<"/agenda">) {
  const params = await searchParams;
  const perfil = await perfilAtual();
  const supabase = await createClient();

  // eslint-disable-next-line react-hooks/purity -- Server Component: um render por request
  const agoraMs = Date.now();
  const hojeChave = chaveDia(new Date(agoraMs));

  const soMinhas = params.f !== "todas";
  const diaSelecionado =
    typeof params.dia === "string" && /^\d{4}-\d{2}-\d{2}$/.test(params.dia)
      ? params.dia
      : hojeChave;

  // Mês exibido: o do dia selecionado, salvo navegação explícita.
  const mesParam =
    typeof params.mes === "string" && /^\d{4}-\d{2}$/.test(params.mes)
      ? params.mes
      : diaSelecionado.slice(0, 7);
  const [anoMes, mesMes] = mesParam.split("-").map(Number);

  // Grade do mês começando na segunda-feira.
  const primeiroDoMes = new Date(Date.UTC(anoMes, mesMes - 1, 1));
  const diasNoMes = new Date(Date.UTC(anoMes, mesMes, 0)).getUTCDate();
  const diaSemanaInicio = (primeiroDoMes.getUTCDay() + 6) % 7; // 0 = segunda
  const celulas: (string | null)[] = [
    ...Array.from({ length: diaSemanaInicio }, () => null),
    ...Array.from({ length: diasNoMes }, (_, i) => {
      const dia = String(i + 1).padStart(2, "0");
      return `${mesParam}-${dia}`;
    }),
  ];
  while (celulas.length % 7 !== 0) celulas.push(null);

  // Tarefas: todas as pendentes (para não perder atrasadas de meses anteriores)
  // mais as concluídas do mês exibido, que dão contexto ao histórico.
  let consultaTarefas = supabase
    .from("lead_tasks")
    .select(
      // profiles!responsavel_id: lead_tasks tem DUAS FKs para profiles (autor
      // e responsável) — sem a dica o PostgREST recusa o embed (PGRST201).
      "id, titulo, vence_em, concluida_em, responsavel_id, lead:leads(id, nome), responsavel:profiles!responsavel_id(nome)",
    )
    .gte("vence_em", `${mesParam}-01T00:00:00-03:00`)
    .lt("vence_em", `${mesParam}-${String(diasNoMes).padStart(2, "0")}T23:59:59-03:00`)
    .order("vence_em")
    .limit(500);
  if (soMinhas && perfil) {
    consultaTarefas = consultaTarefas.eq("responsavel_id", perfil.id);
  }

  let consultaPendentes = supabase
    .from("lead_tasks")
    .select(
      // profiles!responsavel_id: lead_tasks tem DUAS FKs para profiles (autor
      // e responsável) — sem a dica o PostgREST recusa o embed (PGRST201).
      "id, titulo, vence_em, concluida_em, responsavel_id, lead:leads(id, nome), responsavel:profiles!responsavel_id(nome)",
    )
    .is("concluida_em", null)
    .order("vence_em")
    .limit(500);
  if (soMinhas && perfil) {
    consultaPendentes = consultaPendentes.eq("responsavel_id", perfil.id);
  }

  const [{ data: doMes, error: erroTarefas }, { data: pendentes }, { data: agendadasBrutas }] =
    await Promise.all([
      consultaTarefas,
      consultaPendentes,
      supabase
        .from("scheduled_messages")
        .select("id, texto, enviar_em, lead:leads(id, nome)")
        .is("enviado_em", null)
        .order("enviar_em")
        .limit(200),
    ]);

  type LinhaTarefa = {
    id: string;
    titulo: string;
    vence_em: string;
    concluida_em: string | null;
    lead: { id: string; nome: string } | null;
    responsavel: { nome: string } | null;
  };

  const porId = new Map<string, LinhaTarefa>();
  for (const linha of [
    ...((doMes ?? []) as unknown as LinhaTarefa[]),
    ...((pendentes ?? []) as unknown as LinhaTarefa[]),
  ]) {
    porId.set(linha.id, linha);
  }

  const itens: ItemAgenda[] = [...porId.values()]
    .filter((t) => t.lead)
    .map((t) => ({
      id: t.id,
      titulo: t.titulo,
      quando: t.vence_em,
      leadId: t.lead!.id,
      leadNome: t.lead!.nome,
      responsavelNome: t.responsavel?.nome ?? null,
      concluida: t.concluida_em !== null,
      atrasada:
        t.concluida_em === null && new Date(t.vence_em).getTime() < agoraMs,
    }))
    .sort((a, b) => a.quando.localeCompare(b.quando));

  const agendadas: MensagemAgendada[] = (
    (agendadasBrutas ?? []) as unknown as {
      id: string;
      texto: string;
      enviar_em: string;
      lead: { id: string; nome: string } | null;
    }[]
  )
    .filter((m) => m.lead)
    .map((m) => ({
      id: m.id,
      texto: m.texto,
      enviar_em: m.enviar_em,
      leadId: m.lead!.id,
      leadNome: m.lead!.nome,
    }));

  // Distribuição por dia, no fuso da mesa.
  const porDia = new Map<string, ItemAgenda[]>();
  for (const item of itens) {
    const chave = chaveDia(new Date(item.quando));
    porDia.set(chave, [...(porDia.get(chave) ?? []), item]);
  }
  const agendadasPorDia = new Map<string, MensagemAgendada[]>();
  for (const m of agendadas) {
    const chave = chaveDia(new Date(m.enviar_em));
    agendadasPorDia.set(chave, [...(agendadasPorDia.get(chave) ?? []), m]);
  }

  const atrasadas = itens.filter((i) => i.atrasada);
  const deHoje = (porDia.get(hojeChave) ?? []).filter((i) => !i.concluida);
  const doDia = porDia.get(diaSelecionado) ?? [];
  const agendadasDoDia = agendadasPorDia.get(diaSelecionado) ?? [];

  const url = (novos: Record<string, string>) => {
    const p = new URLSearchParams();
    if (!soMinhas) p.set("f", "todas");
    p.set("mes", mesParam);
    p.set("dia", diaSelecionado);
    for (const [k, v] of Object.entries(novos)) p.set(k, v);
    return `/agenda?${p.toString()}`;
  };

  const mesAnterior = `${mesMes === 1 ? anoMes - 1 : anoMes}-${String(mesMes === 1 ? 12 : mesMes - 1).padStart(2, "0")}`;
  const mesSeguinte = `${mesMes === 12 ? anoMes + 1 : anoMes}-${String(mesMes === 12 ? 1 : mesMes + 1).padStart(2, "0")}`;
  const nomeMes = new Date(Date.UTC(anoMes, mesMes - 1, 15)).toLocaleDateString(
    "pt-BR",
    { month: "long", year: "numeric", timeZone: "UTC" },
  );
  const dataLonga = new Date(`${diaSelecionado}T12:00:00`).toLocaleDateString(
    "pt-BR",
    { day: "2-digit", month: "long", weekday: "long", timeZone: FUSO },
  );

  return (
    <div className="flex min-h-full flex-col p-2 md:p-3">
      <header className="border-b border-neutral-200 pb-2">
        <h1 className="text-h1 text-neutral-900">Agenda</h1>
        <p className="mt-1 max-w-[68ch] text-sm text-neutral-600">
          Os retornos combinados com cada cliente. Clique no cliente para cair
          direto na conversa dele.
        </p>
      </header>

      {erroTarefas ? (
        <p
          role="alert"
          className="mt-2 max-w-[68ch] rounded-md bg-warning-bg px-1.5 py-1 text-sm text-warning"
        >
          A agenda depende da migração 0013 (lead_tasks) — rode-a no SQL Editor
          do Supabase.
        </p>
      ) : (
        <>
          <div className="mt-2 flex flex-wrap items-center justify-between gap-2 border-b border-neutral-200 pb-2">
            <dl className="flex flex-wrap gap-3">
              <div>
                <dt className="text-xs font-medium tracking-[0.06em] text-neutral-600 uppercase">
                  Atrasadas
                </dt>
                <dd
                  className={cn(
                    "font-mono text-h3 tabular-nums",
                    atrasadas.length > 0 ? "text-danger" : "text-neutral-800",
                  )}
                >
                  {atrasadas.length}
                </dd>
              </div>
              <div>
                <dt className="text-xs font-medium tracking-[0.06em] text-neutral-600 uppercase">
                  Hoje
                </dt>
                <dd className="font-mono text-h3 text-neutral-800 tabular-nums">
                  {deHoje.length}
                </dd>
              </div>
              <div>
                <dt className="text-xs font-medium tracking-[0.06em] text-neutral-600 uppercase">
                  Envios agendados
                </dt>
                <dd className="font-mono text-h3 text-neutral-800 tabular-nums">
                  {agendadas.length}
                </dd>
              </div>
            </dl>

            <nav aria-label="Filtro de responsável" className="flex gap-0.5">
              {(
                [
                  ["minhas", "Minhas"],
                  ["todas", "Toda a equipe"],
                ] as const
              ).map(([chave, rotulo]) => {
                const ativo = (chave === "minhas") === soMinhas;
                const p = new URLSearchParams();
                if (chave === "todas") p.set("f", "todas");
                p.set("mes", mesParam);
                p.set("dia", diaSelecionado);
                return (
                  <Link
                    key={chave}
                    href={`/agenda?${p.toString()}`}
                    aria-current={ativo ? "page" : undefined}
                    className={cn(
                      "inline-flex h-[32px] items-center rounded-md px-1.5 text-sm transition-colors duration-[120ms] focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-primary-500",
                      ativo
                        ? "bg-primary-50 font-medium text-primary-900"
                        : "text-neutral-600 hover:bg-neutral-100 hover:text-neutral-800",
                    )}
                  >
                    {rotulo}
                  </Link>
                );
              })}
            </nav>
          </div>

          {atrasadas.length > 0 ? (
            <section className="mt-2" aria-labelledby="atrasadas-titulo">
              <h2
                id="atrasadas-titulo"
                className="text-xs font-medium tracking-[0.06em] text-danger uppercase"
              >
                Passou da hora
              </h2>
              <ul className="mt-1 flex flex-col gap-1">
                {atrasadas.slice(0, 5).map((item) => (
                  <TarefaItem key={item.id} item={item} />
                ))}
              </ul>
            </section>
          ) : null}

          <div className="mt-3 grid gap-3 lg:grid-cols-[1fr_360px]">
            {/* Grade do mês */}
            <section aria-labelledby="mes-titulo">
              <div className="flex items-center justify-between gap-1">
                <h2
                  id="mes-titulo"
                  className="text-h3 text-neutral-900 capitalize"
                >
                  {nomeMes}
                </h2>
                <span className="flex gap-0.5">
                  <Link
                    href={url({ mes: mesAnterior })}
                    aria-label="Mês anterior"
                    className="inline-flex h-[40px] w-[40px] items-center justify-center rounded-md text-neutral-600 transition-colors duration-[120ms] hover:bg-neutral-100 hover:text-neutral-800 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-primary-500"
                  >
                    <ChevronLeft size={18} strokeWidth={1.5} aria-hidden />
                  </Link>
                  <Link
                    href={url({ mes: hojeChave.slice(0, 7), dia: hojeChave })}
                    className="inline-flex h-[40px] items-center rounded-md px-1.5 text-sm text-neutral-600 transition-colors duration-[120ms] hover:bg-neutral-100 hover:text-neutral-800 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-primary-500"
                  >
                    Hoje
                  </Link>
                  <Link
                    href={url({ mes: mesSeguinte })}
                    aria-label="Próximo mês"
                    className="inline-flex h-[40px] w-[40px] items-center justify-center rounded-md text-neutral-600 transition-colors duration-[120ms] hover:bg-neutral-100 hover:text-neutral-800 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-primary-500"
                  >
                    <ChevronRight size={18} strokeWidth={1.5} aria-hidden />
                  </Link>
                </span>
              </div>

              <div className="mt-1 grid grid-cols-7 gap-0.5">
                {DIAS_SEMANA.map((dia) => (
                  <div
                    key={dia}
                    className="pb-0.5 text-center text-xs font-medium tracking-[0.06em] text-neutral-400 uppercase"
                  >
                    {dia}
                  </div>
                ))}
                {celulas.map((chave, i) => {
                  if (!chave) return <div key={`vazio-${i}`} />;
                  const doDiaCelula = porDia.get(chave) ?? [];
                  const pendentesDia = doDiaCelula.filter((t) => !t.concluida);
                  const atrasadasDia = doDiaCelula.filter((t) => t.atrasada);
                  const enviosDia = agendadasPorDia.get(chave) ?? [];
                  const ehHoje = chave === hojeChave;
                  const selecionado = chave === diaSelecionado;
                  return (
                    <Link
                      key={chave}
                      href={url({ dia: chave })}
                      aria-current={selecionado ? "date" : undefined}
                      className={cn(
                        "flex min-h-[72px] flex-col gap-0.5 rounded-md border p-0.5 transition-colors duration-[120ms] focus-visible:outline-2 focus-visible:-outline-offset-2 focus-visible:outline-primary-500",
                        selecionado
                          ? "border-primary-600 bg-primary-50"
                          : "border-neutral-200 bg-neutral-0 hover:border-neutral-300",
                      )}
                    >
                      <span
                        className={cn(
                          "inline-flex h-[20px] w-[20px] items-center justify-center rounded-full font-mono text-xs tabular-nums",
                          ehHoje
                            ? "bg-primary-600 font-medium text-neutral-0"
                            : "text-neutral-600",
                        )}
                      >
                        {Number(chave.slice(-2))}
                      </span>
                      {pendentesDia.length > 0 ? (
                        <span
                          className={cn(
                            "inline-flex h-[20px] items-center rounded-sm px-0.5 text-xs font-medium",
                            atrasadasDia.length > 0
                              ? "bg-danger-bg text-danger"
                              : "bg-primary-50 text-primary-900",
                          )}
                        >
                          {pendentesDia.length}{" "}
                          {pendentesDia.length === 1 ? "tarefa" : "tarefas"}
                        </span>
                      ) : null}
                      {enviosDia.length > 0 ? (
                        <span className="inline-flex h-[20px] items-center gap-0.5 rounded-sm bg-accent-100 px-0.5 text-xs font-medium text-accent-700">
                          <Clock size={10} strokeWidth={1.5} aria-hidden />
                          {enviosDia.length}
                        </span>
                      ) : null}
                    </Link>
                  );
                })}
              </div>
            </section>

            {/* Dia selecionado */}
            <section aria-labelledby="dia-titulo">
              <h2 id="dia-titulo" className="text-h3 text-neutral-900 capitalize">
                {dataLonga}
              </h2>

              {doDia.length === 0 && agendadasDoDia.length === 0 ? (
                <p className="mt-1 text-sm text-neutral-600">
                  Nada marcado. As tarefas nascem no chat, no painel do lead.
                </p>
              ) : (
                <div className="mt-1 flex flex-col gap-2">
                  {doDia.length > 0 ? (
                    <ul className="flex flex-col gap-1">
                      {doDia.map((item) => (
                        <TarefaItem key={item.id} item={item} />
                      ))}
                    </ul>
                  ) : null}

                  {agendadasDoDia.length > 0 ? (
                    <div>
                      <h3 className="text-xs font-medium tracking-[0.06em] text-neutral-600 uppercase">
                        Mensagens que saem sozinhas
                      </h3>
                      <ul className="mt-1 flex flex-col gap-1">
                        {agendadasDoDia.map((m) => (
                          <li
                            key={m.id}
                            className="flex items-start gap-1 rounded-md border border-accent-300 bg-accent-100/40 px-1.5 py-1"
                          >
                            <Clock
                              size={14}
                              strokeWidth={1.5}
                              aria-hidden
                              className="mt-0.5 shrink-0 text-accent-700"
                            />
                            <span className="min-w-0 flex-1">
                              <span className="font-mono text-xs text-neutral-600 tabular-nums">
                                {formatarHora(m.enviar_em)}
                              </span>
                              <span className="ml-1 text-sm text-neutral-800">
                                {m.leadNome}
                              </span>
                              <span className="mt-0.5 block truncate text-xs text-neutral-600">
                                {m.texto}
                              </span>
                            </span>
                            <Link
                              href={`/chat?lead=${m.leadId}`}
                              aria-label={`Abrir conversa com ${m.leadNome}`}
                              className="inline-flex h-[40px] w-[40px] shrink-0 items-center justify-center rounded-md text-neutral-600 transition-colors duration-[120ms] hover:bg-neutral-100 hover:text-primary-600 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-primary-500"
                            >
                              <MessageSquare
                                size={18}
                                strokeWidth={1.5}
                                aria-hidden
                              />
                            </Link>
                          </li>
                        ))}
                      </ul>
                    </div>
                  ) : null}
                </div>
              )}
            </section>
          </div>
        </>
      )}
    </div>
  );
}
