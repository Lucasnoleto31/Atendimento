import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { AlertTriangle, Pause, Pencil, Play, Trash2 } from "lucide-react";
import { createClient } from "@/lib/supabase/server";
import { perfilAtual } from "@/lib/auth";
import { listarTemplatesCanal } from "@/lib/canal";
import { inicioDoDiaSaoPaulo } from "@/lib/campanhas";
import { formatarDataCurta } from "@/lib/format";
import { NovaCampanha, type TemplateOpcao } from "./nova-campanha";
import {
  alterarStatusCampanha,
  editarRitmoCampanha,
  excluirCampanha,
} from "./actions";

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
    { enviados: number; hoje: number; falhas: number; novosDepois: number }
  >();
  await Promise.all(
    campanhas.map(async (c) => {
      const [total, doDia, falhas, novos] = await Promise.all([
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
        // Campanha concluída NÃO volta a rodar. Quem entrou na etiqueta
        // depois disso nunca vai receber — e antes a tela chamava essa gente
        // de "faltam", como se fosse fila andando.
        c.status === "concluida" && c.concluida_em && c.etiqueta_id
          ? supabase
              .from("lead_tags")
              .select("lead_id", { count: "exact", head: true })
              .eq("tag_id", c.etiqueta_id)
              .gt("criado_em", c.concluida_em)
          : Promise.resolve({ count: 0 }),
      ]);
      progresso.set(c.id, {
        enviados: total.count ?? 0,
        hoje: doDia.count ?? 0,
        falhas: falhas.count ?? 0,
        novosDepois: novos.count ?? 0,
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
                  novosDepois: 0,
                };
                const publico = c.etiqueta_id
                  ? (publicoPorEtiqueta.get(c.etiqueta_id) ?? 0)
                  : 0;
                const entregues = Math.max(dados.enviados - dados.falhas, 0);
                // Quem entrou na etiqueta depois de concluir não é fila: essa
                // campanha não vai buscá-los. Fica de fora da conta do que
                // "falta" e vira um aviso com ação própria.
                const naFila = Math.max(
                  publico - dados.enviados - dados.novosDepois,
                  0,
                );
                const alvo = Math.max(publico - dados.novosDepois, 0);
                const percentual =
                  alvo > 0
                    ? Math.min(Math.round((dados.enviados / alvo) * 100), 100)
                    : 0;
                const previsao =
                  c.status === "ativa"
                    ? previsaoTermino(naFila, c.por_dia, c.dias_uteis)
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

                    {c.status !== "concluida" ? (
                      <details className="mt-1">
                        <summary className="inline-flex h-[32px] cursor-pointer list-none items-center gap-0.5 rounded-md px-1 text-xs font-medium text-neutral-600 transition-colors duration-[120ms] select-none hover:bg-neutral-100 hover:text-neutral-800 [&::-webkit-details-marker]:hidden">
                          <Pencil size={14} strokeWidth={1.5} aria-hidden />
                          Editar ritmo
                        </summary>
                        <form
                          action={editarRitmoCampanha}
                          className="mt-1 flex flex-wrap items-end gap-1.5 rounded-md border border-neutral-200 bg-neutral-50 p-1.5"
                        >
                          <input type="hidden" name="id" value={c.id} />
                          <div className="flex flex-col gap-0.5">
                            <label
                              htmlFor={`por-dia-${c.id}`}
                              className="text-xs font-medium text-neutral-800"
                            >
                              Envios por dia
                            </label>
                            <input
                              id={`por-dia-${c.id}`}
                              name="por_dia"
                              type="number"
                              min={1}
                              max={500}
                              defaultValue={c.por_dia}
                              className="h-[36px] w-[90px] rounded-md border border-neutral-300 bg-neutral-0 px-1 text-sm text-neutral-800 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-primary-500"
                            />
                          </div>
                          <div className="flex flex-col gap-0.5">
                            <label
                              htmlFor={`inicio-${c.id}`}
                              className="text-xs font-medium text-neutral-800"
                            >
                              Das
                            </label>
                            <input
                              id={`inicio-${c.id}`}
                              name="hora_inicio"
                              type="number"
                              min={0}
                              max={23}
                              defaultValue={c.hora_inicio}
                              className="h-[36px] w-[64px] rounded-md border border-neutral-300 bg-neutral-0 px-1 text-sm text-neutral-800 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-primary-500"
                            />
                          </div>
                          <div className="flex flex-col gap-0.5">
                            <label
                              htmlFor={`fim-${c.id}`}
                              className="text-xs font-medium text-neutral-800"
                            >
                              Às
                            </label>
                            <input
                              id={`fim-${c.id}`}
                              name="hora_fim"
                              type="number"
                              min={1}
                              max={24}
                              defaultValue={c.hora_fim}
                              className="h-[36px] w-[64px] rounded-md border border-neutral-300 bg-neutral-0 px-1 text-sm text-neutral-800 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-primary-500"
                            />
                          </div>
                          <label className="flex h-[36px] items-center gap-1 text-sm text-neutral-800">
                            <input
                              name="dias_uteis"
                              type="checkbox"
                              defaultChecked={c.dias_uteis}
                              className="h-[16px] w-[16px] accent-primary-600"
                            />
                            Só seg a sex
                          </label>
                          <button
                            type="submit"
                            className="inline-flex h-[36px] items-center rounded-md bg-primary-600 px-1.5 text-sm font-medium text-neutral-0 transition-colors duration-[120ms] hover:bg-primary-700 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-primary-500"
                          >
                            Salvar
                          </button>
                          <p className="w-full text-xs text-neutral-600">
                            Vale a partir de agora: se o ritmo novo for maior
                            que o já enviado hoje, o motor completa a cota do
                            dia. Template e etiqueta não mudam — para outra
                            mensagem ou outro público, crie outra campanha.
                          </p>
                        </form>
                      </details>
                    ) : null}

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
                        {entregues}
                      </span>{" "}
                      de{" "}
                      <span className="font-mono tabular-nums">{alvo}</span>{" "}
                      entregues
                      {dados.falhas > 0 ? (
                        <>
                          {" "}
                          ·{" "}
                          <span className="font-mono tabular-nums text-warning">
                            {dados.falhas}
                          </span>{" "}
                          recusados pela Meta
                        </>
                      ) : null}
                      {c.status !== "concluida" ? (
                        <>
                          {" "}
                          · {dados.hoje} hoje · faltam{" "}
                          <span className="font-mono tabular-nums">
                            {naFila}
                          </span>
                        </>
                      ) : null}
                      {previsao ? (
                        <>
                          {" "}
                          · termina por volta de{" "}
                          {formatarDataCurta(previsao.data)}
                        </>
                      ) : null}
                    </p>

                    {dados.novosDepois > 0 ? (
                      <div className="mt-1 flex flex-wrap items-center gap-1 rounded-md bg-warning-bg px-1.5 py-1">
                        <AlertTriangle
                          size={14}
                          strokeWidth={1.5}
                          aria-hidden
                          className="shrink-0 text-warning"
                        />
                        <span className="text-sm text-warning">
                          <span className="font-mono tabular-nums">
                            {dados.novosDepois}
                          </span>{" "}
                          entraram na etiqueta depois que ela concluiu. Uma
                          campanha concluída não volta sozinha — reabra para
                          alcançar essa gente.
                        </span>
                        <form action={alterarStatusCampanha} className="ml-auto">
                          <input type="hidden" name="id" value={c.id} />
                          <input type="hidden" name="status" value="ativa" />
                          <button
                            type="submit"
                            className="inline-flex h-[32px] items-center gap-0.5 rounded-md border border-warning bg-neutral-0 px-1.5 text-sm font-medium text-warning transition-colors duration-[120ms] hover:bg-warning-bg focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-primary-500"
                          >
                            <Play size={14} strokeWidth={1.5} aria-hidden />
                            Reabrir para os {dados.novosDepois}
                          </button>
                        </form>
                      </div>
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
