import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { AlertTriangle, Pause, Pencil, Play, Trash2 } from "lucide-react";
import { createClient, createServiceClient } from "@/lib/supabase/server";
import { perfilAtual } from "@/lib/auth";
import {
  buscarQualidadeNumero,
  listarTemplatesMeta,
  metaConfigurada,
  type TemplateWhatsapp,
} from "@/lib/whatsapp";
import { inicioDoDiaSaoPaulo } from "@/lib/campanhas";
import { formatarDataCurta, formatarDataHora } from "@/lib/format";
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

/** Registro de mais de 24h conta como velho e dispara nova consulta. */
function qualidadeEstaVelha(em?: string | null): boolean {
  return !em || Date.now() - Date.parse(em) > 24 * 3600_000;
}

/**
 * Estado em settings.numero_qualidade — gravado pelo webhook da Meta ou pela
 * consulta ativa desta página. `em` é DESDE QUANDO a nota vale (o que o
 * painel mostra); `verificado_em` é a última checagem (só controla as 24h —
 * o webhook não grava, e aí `em` faz os dois papéis, pois evento é fresco).
 */
type QualidadeNumero = {
  rating?: string | null;
  limite?: string | null;
  em?: string | null;
  verificado_em?: string | null;
};

// Cor + rótulo textual, nunca só cor: é o que a gestão olha antes de subir
// o ritmo de qualquer campanha.
const QUALIDADE: Record<string, { rotulo: string; classe: string }> = {
  GREEN: { rotulo: "verde — saudável", classe: "bg-success-bg text-success" },
  YELLOW: {
    rotulo: "amarela — reduza o ritmo",
    classe: "bg-warning-bg text-warning",
  },
  RED: {
    rotulo: "vermelha — risco de bloqueio",
    classe: "bg-danger-bg text-danger",
  },
};

const TETO_PADRAO = 100;

/** Janela da rotina de erros: 7 dias para trás, em ISO. */
function seteDiasAtrasIso() {
  return new Date(Date.now() - 7 * 24 * 60 * 60 * 1000).toISOString();
}

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
    redirect("/hoje");
  }

  const { aviso } = await searchParams;
  const supabase = await createClient();

  // Mesmo relógio do motor de envio (Brasília) — e a janela da rotina de erros.
  const inicioDoDia = inicioDoDiaSaoPaulo();
  const seteDiasAtras = seteDiasAtrasIso();

  const [
    { data: linhas, error },
    templates,
    { data: tags },
    { data: configs },
    { count: enviadosHojeCount },
    { data: errosLinhas },
  ] = await Promise.all([
    supabase
      .from("campanhas")
      .select(
        "id, nome, template_nome, template_idioma, etiqueta_id, por_dia, dias_uteis, hora_inicio, hora_fim, status, criado_em, concluida_em",
      )
      .order("criado_em", { ascending: false }),
    // Antes o erro da API de templates derrubava a página inteira (era a
    // única chamada sem catch); com a Meta indisponível a lista fica vazia e
    // o formulário de nova campanha avisa, como nas outras telas.
    (metaConfigurada()
      ? listarTemplatesMeta()
      : Promise.resolve([] as TemplateWhatsapp[])
    ).catch(() => [] as TemplateWhatsapp[]),
    supabase.from("tags").select("id, nome").eq("ativo", true).order("nome"),
    supabase
      .from("settings")
      .select("chave, valor")
      .in("chave", ["numero_qualidade", "envios_teto_dia"]),
    // Orçamento do dia: mesma conta de src/lib/envios.ts — tudo que é
    // automático (cadência + campanha + disparo) debita do mesmo teto.
    supabase
      .from("lead_interactions")
      .select("id", { count: "exact", head: true })
      .eq("tipo", "mensagem_enviada")
      .gte("criado_em", inicioDoDia)
      .in("metadados->>via", ["cadencia", "campanha", "disparo"]),
    // As 5 recusas mais recentes — o total é contado no banco, por campanha.
    supabase
      .from("campanha_envios")
      .select("campanha_id, erro, enviado_em")
      .not("erro", "is", null)
      .gte("enviado_em", seteDiasAtras)
      .order("enviado_em", { ascending: false })
      .limit(5),
  ]);

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

  const progresso = new Map<
    string,
    {
      enviados: number;
      hoje: number;
      falhas: number;
      novosDepois: number;
      erros7d: number;
    }
  >();
  await Promise.all(
    campanhas.map(async (c) => {
      const [total, doDia, falhas, novos, erros7d] = await Promise.all([
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
        // Recusas da semana: contadas no banco (head + exact) — trazer as
        // linhas esbarraria no teto de 1000 do PostgREST em dia ruim.
        supabase
          .from("campanha_envios")
          .select("lead_id", { count: "exact", head: true })
          .eq("campanha_id", c.id)
          .not("erro", "is", null)
          .gte("enviado_em", seteDiasAtras),
      ]);
      progresso.set(c.id, {
        enviados: total.count ?? 0,
        hoje: doDia.count ?? 0,
        falhas: falhas.count ?? 0,
        novosDepois: novos.count ?? 0,
        erros7d: erros7d.count ?? 0,
      });
    }),
  );

  // --- Saúde do canal -------------------------------------------------------

  const configuracoes = (configs ?? []) as { chave: string; valor: unknown }[];

  const qualidadeBruta = configuracoes.find(
    (c) => c.chave === "numero_qualidade",
  )?.valor;
  let qualidade =
    qualidadeBruta && typeof qualidadeBruta === "object"
      ? (qualidadeBruta as QualidadeNumero)
      : null;

  // O webhook só avisa quando a qualidade MUDA — número saudável que nunca
  // mudou não gera evento, e o painel ficava em "sem dado" para sempre.
  // Sem evento gravado (ou com checagem de mais de 24h), pergunta direto à
  // Meta e guarda no mesmo lugar; o webhook segue cobrindo o tempo real.
  if (
    metaConfigurada() &&
    (!qualidade?.rating ||
      qualidadeEstaVelha(qualidade.verificado_em ?? qualidade.em))
  ) {
    const inicioConsulta = new Date().toISOString();
    try {
      const aoVivo = await buscarQualidadeNumero();
      if (aoVivo.rating) {
        const mesmaNota = qualidade?.rating?.toUpperCase() === aoVivo.rating;
        qualidade = {
          rating: aoVivo.rating,
          // A consulta pode vir sem o tier — não apaga o que o webhook sabia.
          limite: aoVivo.limite ?? qualidade?.limite ?? null,
          // "desde" é a mudança de nota, não a checagem: nota igual mantém.
          em: mesmaNota && qualidade?.em ? qualidade.em : inicioConsulta,
          verificado_em: inicioConsulta,
        };
        const service = createServiceClient();
        const valor = {
          ...qualidade,
          telefone: aoVivo.telefone,
          evento: "consulta_api",
        };
        // Condicional para não atropelar o webhook: se um evento chegou no
        // meio do render (em >= agora), a escrita não acontece — e aí o
        // registro dele, mais fresco, é o que vale no painel também.
        const { data: gravadas, error: erroGravar } = await service
          .from("settings")
          .update({ valor, atualizado_em: inicioConsulta })
          .eq("chave", "numero_qualidade")
          .lt("valor->>em", inicioConsulta)
          .select("chave");
        if (erroGravar) {
          console.error(
            "[campanhas] qualidade não persistiu:",
            erroGravar.message,
          );
        } else if (!gravadas?.length) {
          if (qualidadeBruta) {
            const { data: relido } = await service
              .from("settings")
              .select("valor")
              .eq("chave", "numero_qualidade")
              .maybeSingle();
            if (relido?.valor && typeof relido.valor === "object") {
              qualidade = relido.valor as QualidadeNumero;
            }
          } else {
            // Primeira gravação de todas; duplicata = webhook chegou antes.
            const { error: erroInserir } = await service
              .from("settings")
              .insert({
                chave: "numero_qualidade",
                valor,
                atualizado_em: inicioConsulta,
              });
            if (erroInserir && !erroInserir.message.includes("duplicate")) {
              console.error(
                "[campanhas] qualidade não persistiu:",
                erroInserir.message,
              );
            }
          }
        }
      }
    } catch {
      // Meta fora do ar: fica o que o webhook tiver gravado (ou "sem dado").
    }
  }
  const qualidadeVisual = qualidade?.rating
    ? QUALIDADE[qualidade.rating.toUpperCase()]
    : undefined;

  const tetoBruto = configuracoes.find(
    (c) => c.chave === "envios_teto_dia",
  )?.valor;
  const teto = Number(tetoBruto ?? TETO_PADRAO) || TETO_PADRAO;
  const enviadosHoje = enviadosHojeCount ?? 0;
  const percentualTeto = Math.min(Math.round((enviadosHoje / teto) * 100), 100);
  const tetoEmRisco = enviadosHoje >= teto * 0.8;

  const errosPorCampanha = campanhas
    .map((c) => ({ nome: c.nome, erros: progresso.get(c.id)?.erros7d ?? 0 }))
    .filter((c) => c.erros > 0)
    .sort((a, b) => b.erros - a.erros);
  const totalErros7d = errosPorCampanha.reduce((s, c) => s + c.erros, 0);
  const errosRecentes = (errosLinhas ?? []) as {
    campanha_id: string;
    erro: string;
    enviado_em: string;
  }[];

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

      <section
        aria-labelledby="saude-titulo"
        className="mt-3 rounded-lg border border-neutral-200 bg-neutral-0 p-2 shadow-sm"
      >
        <h2 id="saude-titulo" className="sr-only">
          Saúde do canal
        </h2>

        <div className="flex flex-wrap items-center gap-x-3 gap-y-1">
          {qualidade ? (
            <p className="flex flex-wrap items-center gap-1 text-xs text-neutral-600">
              <span
                className={`inline-flex h-[24px] items-center rounded-sm px-1 font-medium ${
                  qualidadeVisual?.classe ?? "bg-neutral-100 text-neutral-600"
                }`}
              >
                Qualidade do número:{" "}
                {qualidadeVisual?.rotulo ?? qualidade.rating ?? "desconhecida"}
              </span>
              {qualidade.limite ? (
                <span>
                  limite <span className="font-mono">{qualidade.limite}</span>
                </span>
              ) : null}
              {qualidade.em ? (
                <span>
                  desde{" "}
                  <span className="font-mono tabular-nums">
                    {formatarDataHora(qualidade.em)}
                  </span>
                </span>
              ) : null}
            </p>
          ) : (
            <p className="flex flex-wrap items-center gap-1 text-xs text-neutral-600">
              <span className="inline-flex h-[24px] items-center rounded-sm bg-neutral-100 px-1 font-medium">
                Qualidade do número: sem dado
              </span>
              <span>
                a Meta não retornou a qualidade agora — recarregue mais tarde
              </span>
            </p>
          )}

          <div className="min-w-[220px] max-w-[360px] flex-1">
            <p className="text-sm text-neutral-600">
              Envios automáticos hoje:{" "}
              <span
                className={`font-mono tabular-nums ${tetoEmRisco ? "font-medium text-warning" : "text-neutral-800"}`}
              >
                {enviadosHoje}
              </span>{" "}
              de <span className="font-mono tabular-nums">{teto}</span>
            </p>
            <div
              className="mt-0.5 h-1 w-full overflow-hidden rounded-full bg-neutral-100"
              role="img"
              aria-label={`${enviadosHoje} de ${teto} envios automáticos usados hoje`}
            >
              <div
                className={`h-full rounded-full ${tetoEmRisco ? "bg-warning" : "bg-primary-600"}`}
                style={{ width: `${percentualTeto}%` }}
              />
            </div>
          </div>
        </div>

        {totalErros7d > 0 ? (
          <div className="mt-2 border-t border-neutral-200 pt-2">
            <p className="flex items-center gap-0.5 text-sm text-neutral-800">
              <AlertTriangle
                size={14}
                strokeWidth={1.5}
                aria-hidden
                className="shrink-0 text-warning"
              />
              <span>
                <span className="font-medium">
                  <span className="font-mono tabular-nums">{totalErros7d}</span>{" "}
                  {totalErros7d === 1 ? "erro" : "erros"} de envio
                </span>{" "}
                nos últimos 7 dias
              </span>
            </p>
            <p className="mt-0.5 text-xs text-neutral-600">
              {errosPorCampanha
                .map((c) => `${c.nome} (${c.erros})`)
                .join(" · ")}
            </p>
            {errosRecentes.length > 0 ? (
              <ul className="mt-1 flex flex-col gap-0.5">
                {errosRecentes.map((e) => {
                  const nome =
                    campanhas.find((c) => c.id === e.campanha_id)?.nome ??
                    "campanha excluída";
                  return (
                    <li
                      key={`${e.campanha_id}-${e.enviado_em}`}
                      className="flex items-baseline gap-1 text-xs text-neutral-600"
                    >
                      <span className="shrink-0 font-mono tabular-nums">
                        {formatarDataHora(e.enviado_em)}
                      </span>
                      <span className="min-w-0 flex-1 truncate" title={e.erro}>
                        {nome} — {e.erro}
                      </span>
                    </li>
                  );
                })}
              </ul>
            ) : null}
          </div>
        ) : null}
      </section>

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
                  erros7d: 0,
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
                          {c.dias_uteis ? "seg a sex" : "todo dia"},{" "}
                          {c.hora_inicio}h às {c.hora_fim}h
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
                                <Pause
                                  size={18}
                                  strokeWidth={1.5}
                                  aria-hidden
                                />
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
                      de <span className="font-mono tabular-nums">{alvo}</span>{" "}
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
                        <form
                          action={alterarStatusCampanha}
                          className="ml-auto"
                        >
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
