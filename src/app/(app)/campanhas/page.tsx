import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { AlertTriangle, Pause, Play, Trash2 } from "lucide-react";
import { createClient } from "@/lib/supabase/server";
import { perfilAtual } from "@/lib/auth";
import { listarTemplatesCanal } from "@/lib/canal";
import { inicioDoDiaSaoPaulo } from "@/lib/campanhas";
import { formatarDataCurta } from "@/lib/format";
import { NovaCampanha, type TemplateOpcao } from "./nova-campanha";
import { alterarStatusCampanha, excluirCampanha } from "./actions";

export const metadata: Metadata = { title: "Campanhas · Zeve CRM" };

type Campanha = {
  id: string;
  nome: string;
  template_nome: string;
  template_idioma: string;
  etiqueta_id: string | null;
  por_dia: number;
  dias_uteis: boolean;
  hora_inicio: number;
  hora_fim: number;
  status: "ativa" | "pausada" | "concluida";
  criado_em: string;
  concluida_em: string | null;
};

const ROTULO_STATUS: Record<Campanha["status"], string> = {
  ativa: "Enviando",
  pausada: "Pausada",
  concluida: "Concluída",
};

const COR_STATUS: Record<Campanha["status"], string> = {
  ativa: "bg-success-bg text-success",
  pausada: "bg-neutral-100 text-neutral-600",
  concluida: "bg-primary-50 text-primary-900",
};

/** Dias úteis a partir de hoje para escoar o que falta no ritmo atual. */
function previsaoTermino(faltam: number, porDia: number, diasUteis: boolean) {
  if (faltam <= 0 || porDia <= 0) return null;
  const dias = Math.ceil(faltam / porDia);
  const data = new Date();
  let restantes = dias;
  while (restantes > 0) {
    data.setDate(data.getDate() + 1);
    const semana = data.getDay();
    if (!diasUteis || (semana !== 0 && semana !== 6)) restantes--;
  }
  return { dias, data };
}

export default async function CampanhasPage({
  searchParams,
}: PageProps<"/campanhas">) {
  const perfil = await perfilAtual();
  if (!perfil) redirect("/entrar");
  if (perfil.papel !== "admin" && perfil.papel !== "gestor") {
    redirect("/atendimento");
  }

  const { aviso } = await searchParams;
  const supabase = await createClient();

  const [{ data: linhas, error }, templates, { data: tags }] = await Promise.all(
    [
      supabase
        .from("campanhas")
        .select(
          "id, nome, template_nome, template_idioma, etiqueta_id, por_dia, dias_uteis, hora_inicio, hora_fim, status, criado_em, concluida_em",
        )
        .order("criado_em", { ascending: false }),
      listarTemplatesCanal(),
      supabase.from("tags").select("id, nome").eq("ativo", true).order("nome"),
    ],
  );

  const semMigracao = Boolean(error);
  const campanhas = (linhas ?? []) as Campanha[];
  const etiquetas = (tags ?? []) as { id: string; nome: string }[];

  // Tamanho de cada etiqueta: é o que a gestão olha para escolher o público.
  const publicoPorEtiqueta = new Map<string, number>();
  await Promise.all(
    etiquetas.map(async (e) => {
      const { count } = await supabase
        .from("lead_tags")
        .select("lead_id", { count: "exact", head: true })
        .eq("tag_id", e.id);
      publicoPorEtiqueta.set(e.id, count ?? 0);
    }),
  );

  const inicioDoDia = inicioDoDiaSaoPaulo();

  const progresso = new Map<
    string,
    { enviados: number; hoje: number; falhas: number }
  >();
  await Promise.all(
    campanhas.map(async (c) => {
      const [total, doDia, falhas] = await Promise.all([
        supabase
          .from("campanha_envios")
          .select("lead_id", { count: "exact", head: true })
          .eq("campanha_id", c.id),
        supabase
          .from("campanha_envios")
          .select("lead_id", { count: "exact", head: true })
          .eq("campanha_id", c.id)
          .gte("enviado_em", inicioDoDia),
        supabase
          .from("campanha_envios")
          .select("lead_id", { count: "exact", head: true })
          .eq("campanha_id", c.id)
          .not("erro", "is", null),
      ]);
      progresso.set(c.id, {
        enviados: total.count ?? 0,
        hoje: doDia.count ?? 0,
        falhas: falhas.count ?? 0,
      });
    }),
  );

  return (
    <div className="p-2 md:p-3">
      <header className="border-b border-neutral-200 pb-2">
        <h1 className="text-h1 text-neutral-900">Campanhas</h1>
        <p className="mt-1 max-w-[68ch] text-base text-neutral-600">
          Lista grande sai aos poucos: o CRM manda a cota do dia sozinho, em
          horário comercial, e para quando a lista acaba. Quem responder cai no
          Chat como qualquer conversa.
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

      {semMigracao ? (
        <p
          role="alert"
          className="mt-2 max-w-[68ch] rounded-md border border-warning bg-warning-bg px-1.5 py-1 text-sm text-warning"
        >
          Rode a migração 0021 no Supabase para as campanhas funcionarem.
        </p>
      ) : null}

      <div className="mt-3 grid gap-3 lg:grid-cols-[1fr_minmax(360px,420px)]">
        <section aria-labelledby="lista-titulo">
          <h2 id="lista-titulo" className="sr-only">
            Campanhas criadas
          </h2>

          {campanhas.length === 0 ? (
            <p className="rounded-lg border border-dashed border-neutral-300 p-3 text-sm text-neutral-600">
              Nenhuma campanha ainda. Importe a lista em Administração, marque
              todo mundo com uma etiqueta e crie a campanha ao lado.
            </p>
          ) : (
            <ul className="flex flex-col gap-2">
              {campanhas.map((c) => {
                const dados = progresso.get(c.id) ?? {
                  enviados: 0,
                  hoje: 0,
                  falhas: 0,
                };
                const publico = c.etiqueta_id
                  ? (publicoPorEtiqueta.get(c.etiqueta_id) ?? 0)
                  : 0;
                const faltam = Math.max(publico - dados.enviados, 0);
                const percentual =
                  publico > 0
                    ? Math.round((dados.enviados / publico) * 100)
                    : 0;
                const previsao =
                  c.status === "ativa"
                    ? previsaoTermino(faltam, c.por_dia, c.dias_uteis)
                    : null;
                const etiqueta = etiquetas.find((e) => e.id === c.etiqueta_id);

                return (
                  <li
                    key={c.id}
                    className="rounded-lg border border-neutral-200 bg-neutral-0 p-2 shadow-sm"
                  >
                    <div className="flex flex-wrap items-start justify-between gap-1">
                      <div className="min-w-0">
                        <h3 className="text-base font-medium text-neutral-800">
                          {c.nome}
                        </h3>
                        <p className="mt-0.5 font-mono text-xs text-neutral-600">
                          {c.template_nome} · {etiqueta?.nome ?? "sem etiqueta"}{" "}
                          · {c.por_dia}/dia ·{" "}
                          {c.dias_uteis ? "seg a sex" : "todo dia"}, {c.hora_inicio}h
                          às {c.hora_fim}h
                        </p>
                      </div>

                      <div className="flex items-center gap-1">
                        <span
                          className={`inline-flex h-[24px] items-center rounded-sm px-1 text-xs font-medium ${COR_STATUS[c.status]}`}
                        >
                          {ROTULO_STATUS[c.status]}
                        </span>

                        {c.status !== "concluida" ? (
                          <form action={alterarStatusCampanha}>
                            <input type="hidden" name="id" value={c.id} />
                            <input
                              type="hidden"
                              name="status"
                              value={c.status === "ativa" ? "pausada" : "ativa"}
                            />
                            <button
                              type="submit"
                              aria-label={
                                c.status === "ativa"
                                  ? `Pausar ${c.nome}`
                                  : `Ativar ${c.nome}`
                              }
                              className="inline-flex h-[40px] w-[40px] items-center justify-center rounded-md text-neutral-600 transition-colors duration-[120ms] hover:bg-neutral-100 hover:text-neutral-800 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-primary-500"
                            >
                              {c.status === "ativa" ? (
                                <Pause size={18} strokeWidth={1.5} aria-hidden />
                              ) : (
                                <Play size={18} strokeWidth={1.5} aria-hidden />
                              )}
                            </button>
                          </form>
                        ) : null}

                        <form action={excluirCampanha}>
                          <input type="hidden" name="id" value={c.id} />
                          <button
                            type="submit"
                            aria-label={`Excluir ${c.nome}`}
                            className="inline-flex h-[40px] w-[40px] items-center justify-center rounded-md text-neutral-400 transition-colors duration-[120ms] hover:bg-danger-bg hover:text-danger focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-primary-500"
                          >
                            <Trash2 size={18} strokeWidth={1.5} aria-hidden />
                          </button>
                        </form>
                      </div>
                    </div>

                    <div
                      className="mt-1.5 h-1 w-full overflow-hidden rounded-full bg-neutral-100"
                      role="img"
                      aria-label={`${percentual}% da lista enviada`}
                    >
                      <div
                        className="h-full rounded-full bg-primary-600"
                        style={{ width: `${percentual}%` }}
                      />
                    </div>

                    <p className="mt-1 text-sm text-neutral-600">
                      <span className="font-mono tabular-nums text-neutral-800">
                        {dados.enviados}
                      </span>{" "}
                      de{" "}
                      <span className="font-mono tabular-nums">{publico}</span>{" "}
                      enviados · {dados.hoje} hoje · faltam{" "}
                      <span className="font-mono tabular-nums">{faltam}</span>
                      {previsao ? (
                        <>
                          {" "}
                          · termina por volta de{" "}
                          {formatarDataCurta(previsao.data)}
                        </>
                      ) : null}
                    </p>

                    {dados.falhas > 0 ? (
                      <p className="mt-0.5 inline-flex items-center gap-0.5 text-xs text-warning">
                        <AlertTriangle size={14} strokeWidth={1.5} aria-hidden />
                        {dados.falhas} envio(s) recusado(s) pela Meta
                      </p>
                    ) : null}
                  </li>
                );
              })}
            </ul>
          )}
        </section>

        <NovaCampanha
          templates={templates as TemplateOpcao[]}
          etiquetas={etiquetas.map((e) => ({
            ...e,
            leads: publicoPorEtiqueta.get(e.id) ?? 0,
          }))}
        />
      </div>
    </div>
  );
}
