import type { Metadata } from "next";
import Link from "next/link";
import { AlarmClock, ArrowLeft, CheckCheck, Search, UserRound } from "lucide-react";
import { createClient } from "@/lib/supabase/server";
import { perfilAtual } from "@/lib/auth";
import { formatarTelefone } from "@/lib/format";
import { cn } from "@/lib/utils";
import {
  obterStatusConversa,
  type StatusConversa,
  type TemplateWhatsapp,
} from "@/lib/chatwoot";
import { canalAtivo, listarTemplatesCanal } from "@/lib/canal";
import { estiloEtiqueta } from "@/lib/etiquetas";
import { processarCadencia } from "@/lib/cadencia";
import { processarAgendadas } from "@/lib/agendadas";
import {
  Janela,
  type Agendada,
  type Mensagem,
  type MensagemPadrao,
} from "./janela";
import { AtualizadorTempoReal } from "./tempo-real";
import {
  FerramentasConversa,
  type Etiqueta,
  type EtapaFunil,
  type PessoaEquipe,
} from "./ferramentas";
import { FiltrosLista } from "./filtros";
import {
  PainelLead,
  type DetalheLead,
  type GiroCliente,
  type ReceitaCliente,
} from "./painel";
import { type TarefaLead } from "./tarefas-lead";
import { marcarChatLido } from "./actions";

export const metadata: Metadata = { title: "Chat · Zeve CRM" };

const FILTROS = [
  { chave: "todas", rotulo: "Todas" },
  { chave: "minhas", rotulo: "Minhas" },
  { chave: "naolidas", rotulo: "Não lidas" },
  { chave: "adiadas", rotulo: "Adiadas" },
  { chave: "resolvidas", rotulo: "Resolvidas" },
] as const;

// No controle segmentado ficam só os filtros do dia a dia; "adiadas" vive num
// atalho próprio e "sem atendente"/vendedor viraram o select de atendente.
const SEGMENTOS = ["todas", "minhas", "naolidas"] as const;

type ChaveFiltro = (typeof FILTROS)[number]["chave"];

type ConversaLinha = {
  id: string;
  nome: string;
  telefone_e164: string | null;
  customer_id: string | null;
  responsavel_id: string | null;
  stage_id: string | null;
  ultima_interacao_em: string | null;
  chat_lido_em: string | null;
  chatwoot_conversation_id: number | null;
  chat_adiado_em?: string | null;
  chat_resolvido_em?: string | null;
};

const CAMPOS_BASE =
  "id, nome, telefone_e164, customer_id, responsavel_id, stage_id, ultima_interacao_em, chat_lido_em, chatwoot_conversation_id";
// Sem a migração 0017 a coluna não existe: a consulta cai para os campos base.
const CAMPOS_CONVERSA = `${CAMPOS_BASE}, chat_adiado_em, chat_resolvido_em`;

function urlChat(
  filtro: ChaveFiltro,
  busca: string,
  etiqueta: string,
  atendente: string,
  leadId?: string,
) {
  const p = new URLSearchParams();
  if (filtro !== "todas") p.set("f", filtro);
  if (busca) p.set("q", busca);
  if (etiqueta) p.set("t", etiqueta);
  if (atendente) p.set("v", atendente);
  if (leadId) p.set("lead", leadId);
  const q = p.toString();
  return q ? `/chat?${q}` : "/chat";
}

export default async function ChatPage({ searchParams }: PageProps<"/chat">) {
  const params = await searchParams;
  const filtro = (
    FILTROS.some((f) => f.chave === params.f) ? params.f : "todas"
  ) as ChaveFiltro;
  const busca = typeof params.q === "string" ? params.q.trim() : "";
  const etiquetaFiltro = typeof params.t === "string" ? params.t : "";
  // "sem" = sem atendente; qualquer outro valor é o id do vendedor.
  const atendenteFiltro = typeof params.v === "string" ? params.v : "";
  const leadSelecionado = typeof params.lead === "string" ? params.lead : null;
  const limiteMensagens = Math.min(
    2000,
    Math.max(200, Number(params.m) || 200),
  );

  const perfil = await perfilAtual();
  const supabase = await createClient();

  // Heartbeat: cadência de follow-up e mensagens agendadas pegam carona na
  // atualização da tela. As mensagens chegam pelo webhook da Meta.
  const canal = canalAtivo();
  processarCadencia().catch(() => {});
  processarAgendadas().catch(() => {});

  // A lista da caixa de entrada. `comAdiado` desliga tudo que depende da
  // coluna chat_adiado_em, para a tela seguir de pé sem a migração 0017.
  function montarConsulta(comAdiado: boolean) {
    const campos = comAdiado ? CAMPOS_CONVERSA : CAMPOS_BASE;
    // eslint-disable-next-line @typescript-eslint/no-explicit-any -- corta a recursão de tipos do builder na cadeia condicional
    let q: any = supabase
      .from("leads")
      .select(etiquetaFiltro ? `${campos}, lead_tags!inner(tag_id)` : campos)
      .order("ultima_interacao_em", { ascending: false, nullsFirst: false })
      .limit(100);

    // Na Meta a conversa é o próprio telefone (basta ter havido mensagem);
    // no Chatwoot, o vínculo com a conversa de lá.
    q =
      canal === "meta"
        ? q.not("ultima_interacao_em", "is", null)
        : q.not("chatwoot_conversation_id", "is", null);

    if (comAdiado) {
      // A caixa de entrada mostra só o que falta atender: adiadas e
      // resolvidas saem daqui e vivem nos atalhos próprios.
      if (filtro === "adiadas") q = q.not("chat_adiado_em", "is", null);
      else if (filtro === "resolvidas") {
        q = q.not("chat_resolvido_em", "is", null);
      } else {
        q = q.is("chat_adiado_em", null).is("chat_resolvido_em", null);
      }
    }

    if (filtro === "minhas" && perfil) q = q.eq("responsavel_id", perfil.id);
    if (atendenteFiltro === "sem") q = q.is("responsavel_id", null);
    else if (atendenteFiltro) q = q.eq("responsavel_id", atendenteFiltro);
    if (etiquetaFiltro) q = q.eq("lead_tags.tag_id", etiquetaFiltro);
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

  let { data: brutas } = await montarConsulta(true);
  if (brutas === null) ({ data: brutas } = await montarConsulta(false));
  let conversas = (brutas ?? []) as unknown as ConversaLinha[];

  const naoLida = (c: ConversaLinha) =>
    c.ultima_interacao_em !== null &&
    (c.chat_lido_em === null || c.ultima_interacao_em > c.chat_lido_em);

  if (filtro === "naolidas") {
    conversas = conversas.filter(naoLida);
  }

  // Etiquetas (filtro e ferramentas), parâmetro do alerta de espera, equipe
  // para o filtro de atendente e a contagem do atalho "Adiadas".
  // Sem a migração 0016 não existe coluna cor — a lista continua, sem cor.
  // Contagem dos atalhos fora da caixa (adiadas, resolvidas). Sem as
  // migrações 0017/0018 a coluna não existe e o atalho simplesmente some.
  const contarFora = async (coluna: string): Promise<number> => {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any -- idem
    let q: any = supabase
      .from("leads")
      .select("id", { count: "exact", head: true })
      .not(coluna, "is", null);
    q =
      canal === "meta"
        ? q.not("ultima_interacao_em", "is", null)
        : q.not("chatwoot_conversation_id", "is", null);
    if (filtro === "minhas" && perfil) q = q.eq("responsavel_id", perfil.id);
    if (atendenteFiltro === "sem") q = q.is("responsavel_id", null);
    else if (atendenteFiltro) q = q.eq("responsavel_id", atendenteFiltro);
    const { count, error } = await q;
    return error ? 0 : (count ?? 0);
  };

  const [
    { data: tagsAtivas },
    { data: alertaCfg },
    { data: pessoasFiltro },
    totalAdiadas,
    totalResolvidas,
  ] = await Promise.all([
      supabase
        .from("tags")
        .select("id, nome, cor")
        .eq("ativo", true)
        .order("nome")
        .then((r) =>
          r.error
            ? supabase.from("tags").select("id, nome").eq("ativo", true).order("nome")
            : r,
        ),
      supabase
        .from("settings")
        .select("valor")
        .eq("chave", "minutos_alerta_espera")
        .maybeSingle(),
      supabase.from("profiles").select("id, nome").eq("ativo", true).order("nome"),
      contarFora("chat_adiado_em"),
      contarFora("chat_resolvido_em"),
    ]);
  const etiquetas = (tagsAtivas ?? []) as Etiqueta[];
  const equipeAtendentes = (pessoasFiltro ?? []) as { id: string; nome: string }[];
  const minutosAlerta = Math.max(1, Number(alertaCfg?.valor ?? 15));

  // eslint-disable-next-line react-hooks/purity -- Server Component: uma renderização por request, o relógio do request é estável.
  const agoraMs = Date.now();
  // Chaves de dia no fuso da equipe — os separadores do histórico comparam
  // com elas tanto no servidor quanto no cliente, sem depender do fuso local.
  const formatoDia = new Intl.DateTimeFormat("pt-BR", {
    timeZone: "America/Sao_Paulo",
  });
  const hojeChave = formatoDia.format(new Date(agoraMs));
  const ontemChave = formatoDia.format(new Date(agoraMs - 86_400_000));
  const minutosAguardando = (c: ConversaLinha) =>
    c.ultima_interacao_em
      ? Math.floor((agoraMs - new Date(c.ultima_interacao_em).getTime()) / 60_000)
      : 0;

  // Etiquetas das conversas listadas, numa consulta só — a cor aparece na
  // faixa lateral e nos chips, para reconhecer a conversa de relance.
  const etiquetasPorLead = new Map<string, Etiqueta[]>();
  if (conversas.length > 0) {
    const { data: vinculos } = await supabase
      .from("lead_tags")
      .select("lead_id, tag:tags(id, nome, cor)")
      .in(
        "lead_id",
        conversas.map((c) => c.id),
      );

    for (const vinculo of (vinculos ?? []) as unknown as {
      lead_id: string;
      tag: Etiqueta | null;
    }[]) {
      if (!vinculo.tag) continue;
      const atuais = etiquetasPorLead.get(vinculo.lead_id) ?? [];
      atuais.push(vinculo.tag);
      etiquetasPorLead.set(vinculo.lead_id, atuais);
    }
  }

  // Prévia da última mensagem, numa consulta só.
  const previas = new Map<string, string>();
  if (conversas.length > 0) {
    const { data: ultimas } = await supabase
      .from("lead_interactions")
      .select("lead_id, conteudo, criado_em")
      .in(
        "lead_id",
        conversas.map((c) => c.id),
      )
      .in("tipo", ["mensagem_recebida", "mensagem_enviada"])
      .order("criado_em", { ascending: false })
      .limit(300);

    for (const linha of (ultimas ?? []) as {
      lead_id: string;
      conteudo: string | null;
    }[]) {
      if (!previas.has(linha.lead_id)) {
        previas.set(linha.lead_id, linha.conteudo ?? "");
      }
    }
  }

  // Conversa aberta: mensagens + dados do lead; abrir marca como lida.
  // Conversa aberta: pode estar fora da lista (adiada, outro filtro, busca).
  const atual = leadSelecionado
    ? (conversas.find((c) => c.id === leadSelecionado) ??
      ((
        await supabase
          .from("leads")
          .select(CAMPOS_CONVERSA)
          .eq("id", leadSelecionado)
          .maybeSingle()
          .then((r) =>
            r.error
              ? supabase
                  .from("leads")
                  .select(CAMPOS_BASE)
                  .eq("id", leadSelecionado)
                  .maybeSingle()
              : r,
          )
      ).data as ConversaLinha | null))
    : null;

  let mensagens: Mensagem[] = [];
  let mensagensPadrao: MensagemPadrao[] = [];
  let equipe: PessoaEquipe[] = [];
  let etiquetasLead: string[] = [];
  let etapas: EtapaFunil[] = [];
  let templates: TemplateWhatsapp[] = [];
  let statusConversa: StatusConversa | null = null;
  let restanteJanela: number | null = null;
  let detalhe: DetalheLead | null = null;
  let giro: GiroCliente | null = null;
  let receita: ReceitaCliente | null = null;
  let urlMaisAntigas: string | null = null;
  let tarefas: TarefaLead[] = [];
  let tarefasDisponiveis = false;
  let agendadas: Agendada[] = [];

  if (atual) {
    if (naoLida(atual)) await marcarChatLido(atual.id);

    const [
      { data: interacoes },
      { data: padroes },
      { data: pessoas },
      { data: tagsDoLead },
      { data: etapasFunil },
      { data: leadDetalhe },
      { data: giroCliente },
      { data: receitaCliente },
      templatesInbox,
      statusAtual,
    ] = await Promise.all([
      // Da mais nova para a mais antiga: o corte fica no passado, não no fim.
      supabase
        .from("lead_interactions")
        .select("id, tipo, conteudo, criado_em, metadados, autor:profiles(nome)")
        .eq("lead_id", atual.id)
        .in("tipo", ["mensagem_recebida", "mensagem_enviada", "nota"])
        .order("criado_em", { ascending: false })
        .limit(limiteMensagens),
      supabase
        .from("quick_replies")
        .select("id, titulo, corpo")
        .eq("ativo", true)
        .order("titulo"),
      supabase
        .from("profiles")
        .select("id, nome")
        .eq("ativo", true)
        .order("nome"),
      supabase.from("lead_tags").select("tag_id").eq("lead_id", atual.id),
      supabase
        .from("pipeline_stages")
        .select("id, nome, pipeline:pipelines!inner(padrao)")
        .eq("pipeline.padrao", true)
        .order("ordem"),
      supabase
        .from("leads")
        .select(
          "campanha, utm_campaign, entrada_motivo, observacao, criado_em, primeira_resposta_em, channel:channels(nome), customer:customers(nome_completo, conta_aberta_em)",
        )
        .eq("id", atual.id)
        .maybeSingle(),
      atual.customer_id !== null
        ? supabase
            .from("v_customer_giro")
            .select("lotes_30d, lotes_30d_anterior, ultimo_giro_em")
            .eq("customer_id", atual.customer_id)
            .maybeSingle()
        : Promise.resolve({ data: null }),
      // Receita estimada (migração 0015 + taxa configurada; tolerante).
      atual.customer_id !== null
        ? supabase
            .from("v_customer_receita")
            .select("receita_30d_centavos, ltv_centavos")
            .eq("customer_id", atual.customer_id)
            .maybeSingle()
        : Promise.resolve({ data: null }),
      // Canal fora do ar não derruba a página: segue sem template/status.
      listarTemplatesCanal().catch(() => [] as TemplateWhatsapp[]),
      canal === "chatwoot" && atual.chatwoot_conversation_id !== null
        ? obterStatusConversa(atual.chatwoot_conversation_id).catch(() => null)
        : Promise.resolve(null),
    ]);

    const linhas = (interacoes ?? []) as unknown as {
      id: string;
      tipo: Mensagem["tipo"];
      conteudo: string | null;
      criado_em: string;
      metadados: {
        anexos?: { tipo?: string | null; url?: string | null }[];
        status_envio?: string | null;
        erro_envio?: string | null;
      } | null;
      autor: { nome: string } | null;
    }[];

    mensagens = linhas
      .map((m) => ({
        id: m.id,
        tipo: m.tipo,
        conteudo: m.conteudo,
        criado_em: m.criado_em,
        autor: m.autor?.nome ?? null,
        anexos: (m.metadados?.anexos ?? []).flatMap((a) =>
          a.url ? [{ tipo: a.tipo ?? "file", url: a.url }] : [],
        ),
        statusEnvio: m.metadados?.status_envio ?? null,
        erroEnvio: m.metadados?.erro_envio ?? null,
      }))
      .reverse();

    if (linhas.length === limiteMensagens) {
      urlMaisAntigas = `${urlChat(filtro, busca, etiquetaFiltro, atendenteFiltro, atual.id)}&m=${
        limiteMensagens + 300
      }`;
    }
    mensagensPadrao = (padroes ?? []) as MensagemPadrao[];
    equipe = (pessoas ?? []) as PessoaEquipe[];
    etiquetasLead = ((tagsDoLead ?? []) as { tag_id: string }[]).map(
      (t) => t.tag_id,
    );
    etapas = ((etapasFunil ?? []) as { id: string; nome: string }[]).map(
      (e) => ({ id: e.id, nome: e.nome }),
    );
    templates = templatesInbox;
    statusConversa = statusAtual;
    detalhe = (leadDetalhe ?? null) as DetalheLead | null;
    giro = (giroCliente ?? null) as GiroCliente | null;
    receita = (receitaCliente ?? null) as ReceitaCliente | null;

    // Janela de 24h do WhatsApp: conta a partir da última mensagem do lead.
    const ultimaRecebida = [...mensagens]
      .reverse()
      .find((m) => m.tipo === "mensagem_recebida");
    restanteJanela = ultimaRecebida
      ? new Date(ultimaRecebida.criado_em).getTime() + 24 * 3600 * 1000 - agoraMs
      : null;

    // Tarefas do lead (migração 0013; sem ela, o painel mostra o aviso).
    const { data: tarefasLinhas, error: tarefasErro } = await supabase
      .from("lead_tasks")
      .select("id, titulo, vence_em")
      .eq("lead_id", atual.id)
      .is("concluida_em", null)
      .order("vence_em")
      .limit(20);
    tarefasDisponiveis = tarefasErro === null;
    tarefas = (
      (tarefasLinhas ?? []) as { id: string; titulo: string; vence_em: string }[]
    ).map((t) => ({
      ...t,
      vencida: new Date(t.vence_em).getTime() < agoraMs,
    }));

    // Agendadas pendentes + falhas recentes (migração 0014; tolerante).
    const { data: agendadasLinhas } = await supabase
      .from("scheduled_messages")
      .select("id, texto, enviar_em, enviado_em, erro")
      .eq("lead_id", atual.id)
      .or("enviado_em.is.null,erro.not.is.null")
      .order("enviar_em")
      .limit(10);
    agendadas = (
      (agendadasLinhas ?? []) as {
        id: string;
        texto: string;
        enviar_em: string;
        enviado_em: string | null;
        erro: string | null;
      }[]
    ).map((a) => ({
      id: a.id,
      texto: a.texto,
      enviar_em: a.enviar_em,
      erro: a.erro,
      pendente: a.enviado_em === null,
    }));
  }

  // Na Meta o "thread" é o telefone; no Chatwoot, a conversa vinculada.
  const temCanalEnvio = atual
    ? canal === "meta"
      ? atual.telefone_e164 !== null
      : atual.chatwoot_conversation_id !== null
    : false;

  const horaCurta = (iso: string | null) => {
    if (!iso) return "";
    const data = new Date(iso);
    const hoje = new Date();
    return data.toDateString() === hoje.toDateString()
      ? data.toLocaleTimeString("pt-BR", { hour: "2-digit", minute: "2-digit" })
      : data.toLocaleDateString("pt-BR", { day: "2-digit", month: "2-digit" });
  };

  return (
    <div className="flex h-[calc(100dvh-64px)] min-h-0 lg:h-dvh">
      <AtualizadorTempoReal />
      {/* Lista de conversas */}
      <aside
        className={cn(
          "w-full flex-col border-r border-neutral-200 bg-neutral-0 lg:flex lg:w-[320px] lg:shrink-0",
          atual ? "hidden" : "flex",
        )}
      >
        <div className="border-b border-neutral-200 p-1.5">
          <h1 className="px-0.5 text-h3 text-neutral-900">Chat</h1>

          <form action="/chat" method="get" className="mt-1 flex gap-1">
            {filtro !== "todas" ? (
              <input type="hidden" name="f" value={filtro} />
            ) : null}
            {etiquetaFiltro ? (
              <input type="hidden" name="t" value={etiquetaFiltro} />
            ) : null}
            {atendenteFiltro ? (
              <input type="hidden" name="v" value={atendenteFiltro} />
            ) : null}
            <label htmlFor="busca-chat" className="sr-only">
              Buscar conversa
            </label>
            <input
              id="busca-chat"
              name="q"
              defaultValue={busca}
              placeholder="Nome ou telefone…"
              className="h-[40px] min-w-0 flex-1 rounded-md border border-neutral-300 bg-neutral-0 px-1.5 text-sm text-neutral-800 placeholder:text-neutral-400 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-primary-500"
            />
            <button
              type="submit"
              aria-label="Buscar"
              className="inline-flex h-[40px] w-[40px] shrink-0 items-center justify-center rounded-md border border-neutral-300 text-neutral-600 transition-colors duration-[120ms] hover:bg-neutral-100 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-primary-500"
            >
              <Search size={18} strokeWidth={1.5} aria-hidden />
            </button>
          </form>

          {/* Controle segmentado: os três filtros do dia a dia, larguras iguais. */}
          <nav aria-label="Filtro de conversas" className="mt-1">
            <ul className="grid grid-cols-3 gap-0.5 rounded-md border border-neutral-300 bg-neutral-0 p-0.5">
              {FILTROS.filter((f) =>
                (SEGMENTOS as readonly string[]).includes(f.chave),
              ).map((f) => {
                const ativo = f.chave === filtro;
                return (
                  <li key={f.chave}>
                    <Link
                      href={urlChat(f.chave, busca, etiquetaFiltro, atendenteFiltro)}
                      aria-current={ativo ? "page" : undefined}
                      className={cn(
                        "flex h-[32px] items-center justify-center rounded-sm text-sm transition-colors duration-[120ms] focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-primary-500",
                        ativo
                          ? "bg-primary-50 font-medium text-primary-900"
                          : "text-neutral-600 hover:bg-neutral-100 hover:text-neutral-800",
                      )}
                    >
                      {f.rotulo}
                    </Link>
                  </li>
                );
              })}
            </ul>
          </nav>

          <FiltrosLista
            etiquetas={etiquetas}
            equipe={equipeAtendentes}
            filtro={filtro}
            busca={busca}
            etiquetaAtual={etiquetaFiltro}
            atendenteAtual={atendenteFiltro}
          />

          {/* Fora do fluxo do dia a dia — atalhos só quando existirem. */}
          {filtro === "resolvidas" || totalResolvidas > 0 ? (
            <div className="mt-1 flex justify-end">
              <Link
                href={urlChat(
                  filtro === "resolvidas" ? "todas" : "resolvidas",
                  busca,
                  etiquetaFiltro,
                  atendenteFiltro,
                )}
                aria-current={filtro === "resolvidas" ? "page" : undefined}
                className={cn(
                  "inline-flex h-[32px] items-center gap-0.5 rounded-md px-1 text-sm transition-colors duration-[120ms] focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-primary-500",
                  filtro === "resolvidas"
                    ? "bg-success-bg font-medium text-success"
                    : "text-neutral-600 hover:bg-neutral-100 hover:text-neutral-800",
                )}
              >
                <CheckCheck size={14} strokeWidth={1.5} aria-hidden />
                {filtro === "resolvidas"
                  ? "Voltar para a caixa"
                  : `Resolvidas (${totalResolvidas})`}
              </Link>
            </div>
          ) : null}

          {filtro === "adiadas" || totalAdiadas > 0 ? (
            <div className="mt-1 flex justify-end">
              <Link
                href={urlChat(
                  filtro === "adiadas" ? "todas" : "adiadas",
                  busca,
                  etiquetaFiltro,
                  atendenteFiltro,
                )}
                aria-current={filtro === "adiadas" ? "page" : undefined}
                className={cn(
                  "inline-flex h-[32px] items-center gap-0.5 rounded-md px-1 text-sm transition-colors duration-[120ms] focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-primary-500",
                  filtro === "adiadas"
                    ? "bg-primary-50 font-medium text-primary-900"
                    : "text-neutral-600 hover:bg-neutral-100 hover:text-neutral-800",
                )}
              >
                <AlarmClock size={14} strokeWidth={1.5} aria-hidden />
                {filtro === "adiadas"
                  ? "Voltar para a caixa"
                  : `Adiadas (${totalAdiadas})`}
              </Link>
            </div>
          ) : null}
        </div>

        <ul className="min-h-0 flex-1 divide-y divide-neutral-200 overflow-y-auto">
          {conversas.length === 0 ? (
            <li className="p-2 text-sm text-neutral-600">
              Nenhuma conversa aqui.
            </li>
          ) : (
            conversas.map((conversa) => {
              const selecionada = conversa.id === atual?.id;
              const pendente = naoLida(conversa) && !selecionada;
              const espera = pendente ? minutosAguardando(conversa) : 0;
              const emAlerta = pendente && espera >= minutosAlerta;
              const etiquetasDaConversa = etiquetasPorLead.get(conversa.id) ?? [];
              // A faixa lateral herda a cor da primeira etiqueta; a seleção
              // continua mandando na cor quando a conversa está aberta.
              const faixa = selecionada
                ? "border-primary-600"
                : etiquetasDaConversa.length > 0
                  ? estiloEtiqueta(etiquetasDaConversa[0].cor).faixa
                  : "border-transparent";
              return (
                <li key={conversa.id}>
                  <Link
                    href={urlChat(filtro, busca, etiquetaFiltro, atendenteFiltro, conversa.id)}
                    aria-current={selecionada ? "true" : undefined}
                    className={cn(
                      "flex items-center gap-1 border-l-4 px-1.5 py-1 transition-colors duration-[120ms] focus-visible:outline-2 focus-visible:-outline-offset-2 focus-visible:outline-primary-500",
                      faixa,
                      selecionada ? "bg-primary-50" : "hover:bg-neutral-50",
                    )}
                  >
                    <span
                      aria-hidden
                      className="flex h-[40px] w-[40px] shrink-0 items-center justify-center rounded-md bg-neutral-100 font-mono text-sm text-neutral-600"
                    >
                      {conversa.nome.slice(0, 2).toUpperCase()}
                    </span>
                    <span className="min-w-0 flex-1">
                      <span className="flex items-baseline justify-between gap-1">
                        <span
                          className={cn(
                            "truncate text-sm text-neutral-800",
                            pendente ? "font-semibold" : "font-medium",
                          )}
                        >
                          {conversa.nome}
                        </span>
                        <span className="shrink-0 font-mono text-xs text-neutral-400 tabular-nums">
                          {horaCurta(conversa.ultima_interacao_em)}
                        </span>
                      </span>
                      <span className="flex items-center justify-between gap-1">
                        <span
                          className={cn(
                            "truncate text-xs",
                            pendente
                              ? "font-medium text-neutral-800"
                              : "text-neutral-600",
                          )}
                        >
                          {previas.get(conversa.id) ?? "—"}
                        </span>
                        {emAlerta ? (
                          <span className="inline-flex h-[20px] shrink-0 items-center rounded-sm bg-warning-bg px-0.5 font-mono text-xs font-medium text-warning tabular-nums">
                            {espera >= 60
                              ? `${Math.floor(espera / 60)}h`
                              : `${espera}min`}
                          </span>
                        ) : pendente ? (
                          <span
                            aria-label="Mensagens não lidas"
                            className="h-1 w-1 shrink-0 rounded-full bg-primary-600"
                          />
                        ) : null}
                      </span>

                      {etiquetasDaConversa.length > 0 ? (
                        <span className="mt-0.5 flex flex-wrap items-center gap-0.5">
                          {etiquetasDaConversa.slice(0, 3).map((etiqueta) => (
                            <span
                              key={etiqueta.id}
                              className={cn(
                                "inline-flex h-[20px] items-center rounded-sm px-1 text-xs font-medium",
                                estiloEtiqueta(etiqueta.cor).chip,
                              )}
                            >
                              {etiqueta.nome}
                            </span>
                          ))}
                          {etiquetasDaConversa.length > 3 ? (
                            <span className="text-xs text-neutral-400">
                              +{etiquetasDaConversa.length - 3}
                            </span>
                          ) : null}
                        </span>
                      ) : null}
                    </span>
                  </Link>
                </li>
              );
            })
          )}
        </ul>
      </aside>

      {/* Janela da conversa */}
      <section
        aria-label="Conversa"
        className={cn(
          "min-w-0 flex-1 flex-col lg:flex",
          atual ? "flex" : "hidden",
        )}
      >
        {atual ? (
          <>
            <header className="flex items-center gap-1 border-b border-neutral-200 bg-neutral-0 px-1.5 py-1">
              <Link
                href={urlChat(filtro, busca, etiquetaFiltro, atendenteFiltro)}
                aria-label="Voltar para a lista"
                className="inline-flex h-[40px] w-[40px] items-center justify-center rounded-md text-neutral-600 hover:bg-neutral-100 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-primary-500 lg:hidden"
              >
                <ArrowLeft size={18} strokeWidth={1.5} aria-hidden />
              </Link>
              <div className="min-w-0 flex-1">
                <p className="truncate text-sm font-semibold text-neutral-900">
                  {atual.nome}
                </p>
                <p className="font-mono text-xs text-neutral-600 tabular-nums">
                  {atual.telefone_e164
                    ? formatarTelefone(atual.telefone_e164)
                    : "sem telefone"}
                </p>
              </div>
              <span
                className={cn(
                  "inline-flex h-[20px] shrink-0 items-center rounded-sm px-1 text-xs",
                  atual.customer_id
                    ? "bg-success-bg text-success"
                    : "bg-neutral-100 text-neutral-600",
                )}
              >
                {atual.customer_id ? "Cliente" : "Não cliente"}
              </span>
              <Link
                href={`/leads/${atual.id}`}
                className="inline-flex h-[32px] shrink-0 items-center gap-0.5 rounded-md border border-neutral-300 bg-neutral-0 px-1.5 text-xs font-medium text-neutral-800 transition-colors duration-[120ms] hover:bg-neutral-100 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-primary-500"
              >
                <UserRound size={14} strokeWidth={1.5} aria-hidden />
                Ficha
              </Link>
            </header>

            <FerramentasConversa
              leadId={atual.id}
              temConversa={temCanalEnvio}
              statusConversa={statusConversa}
              responsavelId={atual.responsavel_id}
              equipe={equipe}
              etiquetas={etiquetas}
              etiquetasLead={etiquetasLead}
              etapas={etapas}
              etapaId={atual.stage_id}
              adiada={atual.chat_adiado_em != null}
              resolvida={atual.chat_resolvido_em != null}
            />

            <Janela
              leadId={atual.id}
              temConversa={temCanalEnvio}
              mensagens={mensagens}
              mensagensPadrao={mensagensPadrao}
              templates={templates}
              restanteJanela={restanteJanela}
              urlMaisAntigas={urlMaisAntigas}
              hojeChave={hojeChave}
              ontemChave={ontemChave}
              agendadas={agendadas}
            />
          </>
        ) : (
          <div className="hidden flex-1 items-center justify-center lg:flex">
            <p className="text-sm text-neutral-600">
              Escolha uma conversa na lista.
            </p>
          </div>
        )}
      </section>

      {atual ? (
        <PainelLead
          leadId={atual.id}
          detalhe={detalhe}
          giro={giro}
          receita={receita}
          tarefas={tarefas}
          tarefasDisponiveis={tarefasDisponiveis}
        />
      ) : null}
    </div>
  );
}
