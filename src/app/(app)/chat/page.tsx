import type { Metadata } from "next";
import Link from "next/link";
import { ArrowLeft, Search, UserRound } from "lucide-react";
import { createClient } from "@/lib/supabase/server";
import { perfilAtual } from "@/lib/auth";
import { formatarTelefone, horaOuData } from "@/lib/format";
import { cn } from "@/lib/utils";
import {
  obterStatusConversa,
  type StatusConversa,
  type TemplateWhatsapp,
} from "@/lib/chatwoot";
import { canalAtivo, listarTemplatesCanal } from "@/lib/canal";
import { estiloEtiqueta } from "@/lib/etiquetas";
import { Janela, type Mensagem, type MensagemPadrao } from "./janela";
import { AtualizadorTempoReal } from "./tempo-real";
import {
  FerramentasConversa,
  type Etiqueta,
  type EtapaFunil,
  type PessoaEquipe,
} from "./ferramentas";
import { FiltrosLista } from "./filtros";
import { ListaConversas, type ItemConversa } from "./lista-conversas";
import {
  PainelLead,
  type DetalheLead,
  type GiroCliente,
  type ReceitaCliente,
} from "./painel";
import { type TarefaLead } from "./tarefas-lead";

export const metadata: Metadata = { title: "Chat · Zeve CRM" };

// Eixo "caixa": situação da conversa. O eixo "escopo" (Minhas / Sem dono /
// Todas) vive no parâmetro v (atendente) e combina livremente com este —
// dá para ver "adiadas minhas", "não lidas sem dono" etc.
const CAIXAS = [
  { chave: "todas", rotulo: "Caixa" },
  { chave: "naolidas", rotulo: "Não lidas" },
  { chave: "adiadas", rotulo: "Adiadas" },
  { chave: "resolvidas", rotulo: "Resolvidas" },
] as const;

type ChaveFiltro = (typeof CAIXAS)[number]["chave"];

type ConversaLinha = {
  id: string;
  nome: string;
  telefone_e164: string | null;
  instagram_id?: string | null;
  instagram_usuario?: string | null;
  customer_id: string | null;
  responsavel_id: string | null;
  stage_id: string | null;
  ultima_interacao_em: string | null;
  chat_lido_em: string | null;
  chatwoot_conversation_id: number | null;
  chat_adiado_em?: string | null;
  chat_resolvido_em?: string | null;
  marketing_bloqueado_em?: string | null;
};

const CAMPOS_BASE =
  "id, nome, telefone_e164, instagram_id, instagram_usuario, customer_id, responsavel_id, stage_id, ultima_interacao_em, chat_lido_em, chatwoot_conversation_id";
// Sem a migração 0017 a coluna não existe: a consulta cai para os campos base.
const CAMPOS_CONVERSA = `${CAMPOS_BASE}, chat_adiado_em, chat_resolvido_em, marketing_bloqueado_em`;

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
  // f=minhas era o filtro antigo — virou escopo (v = o próprio usuário).
  const fBruto = params.f === "minhas" ? "todas" : params.f;
  const filtro = (
    CAIXAS.some((c) => c.chave === fBruto) ? fBruto : "todas"
  ) as ChaveFiltro;
  const busca = typeof params.q === "string" ? params.q.trim() : "";
  const etiquetaFiltro = typeof params.t === "string" ? params.t : "";
  // "sem" = sem atendente; qualquer outro valor é o id do vendedor.
  let atendenteFiltro = typeof params.v === "string" ? params.v : "";
  const leadSelecionado = typeof params.lead === "string" ? params.lead : null;
  const limiteMensagens = Math.min(
    2000,
    Math.max(200, Number(params.m) || 200),
  );

  const perfil = await perfilAtual();
  const supabase = await createClient();
  if (params.f === "minhas" && !atendenteFiltro && perfil) {
    atendenteFiltro = perfil.id; // link antigo continua filtrando as minhas
  }

  const canal = canalAtivo();

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
    if (atendenteFiltro === "sem") q = q.is("responsavel_id", null);
    else if (atendenteFiltro) q = q.eq("responsavel_id", atendenteFiltro);
    const { count, error } = await q;
    return error ? 0 : (count ?? 0);
  };

  // Contagens do eixo de escopo (Minhas / Sem dono / Todas), na caixa atual.
  const contarEscopo = async (vAlvo: string): Promise<number> => {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any -- idem
    let q: any = supabase
      .from("leads")
      .select("id", { count: "exact", head: true });
    q =
      canal === "meta"
        ? q.not("ultima_interacao_em", "is", null)
        : q.not("chatwoot_conversation_id", "is", null);
    if (filtro === "adiadas") q = q.not("chat_adiado_em", "is", null);
    else if (filtro === "resolvidas") {
      q = q.not("chat_resolvido_em", "is", null);
    } else {
      q = q.is("chat_adiado_em", null).is("chat_resolvido_em", null);
    }
    if (vAlvo === "sem") q = q.is("responsavel_id", null);
    else if (vAlvo) q = q.eq("responsavel_id", vAlvo);
    const { count, error } = await q;
    return error ? 0 : (count ?? 0);
  };

  const [
    { data: tagsAtivas },
    { data: alertaCfg },
    { data: pessoasFiltro },
    totalAdiadas,
    totalResolvidas,
    totalMinhas,
    totalSemDono,
    totalTodas,
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
      contarEscopo(perfil?.id ?? ""),
      contarEscopo("sem"),
      contarEscopo(""),
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

  if (atual) {
    // A leitura é marcada pelo CLIENTE ao montar a conversa (Janela), não
    // aqui: marcar no render fazia qualquer aba aberta de um colega apagar o
    // "não lida" da equipe a cada atualização automática (30s), inclusive
    // desfazendo o "marcar como não lida".

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
        anexos?: { tipo?: string | null; nome?: string | null; url?: string | null }[];
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
          a.url
            ? [{ tipo: a.tipo ?? "file", nome: a.nome ?? null, url: a.url }]
            : [],
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
  }

  // Na Meta o "thread" é o telefone; no Chatwoot, a conversa vinculada.
  const temCanalEnvio = atual
    ? canal === "meta"
      ? atual.telefone_e164 !== null
      : atual.chatwoot_conversation_id !== null
    : false;

  // Hora no dia de hoje, data nos anteriores — tudo no fuso de Brasília.
  const horaCurta = horaOuData;

  // Quem está no atendimento aparece em cima do nome do lead na lista.
  const nomePorAtendente = new Map(
    equipeAtendentes.map((p) => [p.id, p.nome]),
  );

  // Eixo de escopo do cabeçalho: Minhas / Sem dono / Todas, com contagem.
  const escopos = [
    { rotulo: "Minhas", v: perfil?.id ?? "", total: totalMinhas },
    { rotulo: "Sem dono", v: "sem", total: totalSemDono },
    { rotulo: "Todas", v: "", total: totalTodas },
  ];

  // A lista é um componente cliente (seleção múltipla), então tudo que é
  // cálculo ou classe vai resolvido daqui.
  const itensLista: ItemConversa[] = conversas.map((conversa) => {
    const aberta = conversa.id === atual?.id;
    const pendente = naoLida(conversa) && !aberta;
    const espera = pendente ? minutosAguardando(conversa) : 0;
    const emAlerta = pendente && espera >= minutosAlerta;
    const etiquetasDaConversa = etiquetasPorLead.get(conversa.id) ?? [];

    return {
      id: conversa.id,
      nome: conversa.nome,
      atendente: conversa.responsavel_id
        ? (nomePorAtendente.get(conversa.responsavel_id) ?? null)
        : null,
      href: urlChat(filtro, busca, etiquetaFiltro, atendenteFiltro, conversa.id),
      hora: horaCurta(conversa.ultima_interacao_em),
      // De onde veio a conversa: no Direct o @ identifica melhor que o nome.
      origem: conversa.instagram_id
        ? {
            canal: "instagram" as const,
            identificador: conversa.instagram_usuario
              ? `@${conversa.instagram_usuario}`
              : "Direct",
          }
        : null,
      previa: previas.get(conversa.id) ?? "—",
      pendente,
      aberta,
      espera: emAlerta
        ? espera >= 60
          ? `${Math.floor(espera / 60)}h`
          : `${espera}min`
        : null,
      // A faixa lateral herda a cor da primeira etiqueta; a conversa aberta
      // continua mandando na cor.
      faixa: aberta
        ? "border-primary-600"
        : etiquetasDaConversa.length > 0
          ? estiloEtiqueta(etiquetasDaConversa[0].cor).faixa
          : "border-transparent",
      etiquetas: etiquetasDaConversa.slice(0, 3).map((e) => ({
        id: e.id,
        nome: e.nome,
        chip: estiloEtiqueta(e.cor).chip,
      })),
      etiquetasExtras: Math.max(0, etiquetasDaConversa.length - 3),
    };
  });

  return (
    <div className="flex h-[calc(100dvh-64px)] min-h-0 overflow-hidden lg:h-dvh">
      <AtualizadorTempoReal />
      {/* Lista de conversas */}
      <aside
        className={cn(
          "w-full min-h-0 flex-col border-r border-neutral-200 bg-neutral-0 lg:flex lg:w-[320px] lg:shrink-0",
          atual ? "hidden" : "flex",
        )}
      >
        <div className="border-b border-neutral-200 p-1.5">
          {/* Título e busca dividem a linha — o cabeçalho inteiro cabe em
              quatro linhas compactas (era o dobro, com atalhos empilhados). */}
          <div className="flex items-center gap-1">
            <h1 className="shrink-0 px-0.5 text-h3 text-neutral-900">Chat</h1>
            <form
              action="/chat"
              method="get"
              className="flex min-w-0 flex-1 gap-0.5"
            >
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
                className="h-[32px] min-w-0 flex-1 rounded-md border border-neutral-300 bg-neutral-0 px-1 text-sm text-neutral-800 placeholder:text-neutral-400 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-primary-500"
              />
              <button
                type="submit"
                aria-label="Buscar"
                className="inline-flex h-[32px] w-[32px] shrink-0 items-center justify-center rounded-md border border-neutral-300 text-neutral-600 transition-colors duration-[120ms] hover:bg-neutral-100 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-primary-500"
              >
                <Search size={16} strokeWidth={1.5} aria-hidden />
              </button>
            </form>
          </div>

          {/* Eixo 1 — escopo (de quem), com contagem. Combina com a caixa. */}
          <nav aria-label="Filtro por atendente" className="mt-1">
            <ul className="grid grid-cols-3 gap-0.5 rounded-md border border-neutral-300 bg-neutral-0 p-0.5">
              {escopos.map((escopo) => {
                const ativo = atendenteFiltro === escopo.v;
                return (
                  <li key={escopo.rotulo}>
                    <Link
                      href={urlChat(filtro, busca, etiquetaFiltro, escopo.v)}
                      aria-current={ativo ? "page" : undefined}
                      className={cn(
                        "flex h-[32px] items-center justify-center gap-0.5 rounded-sm text-xs font-medium transition-colors duration-[120ms] focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-primary-500",
                        ativo
                          ? "bg-primary-50 text-primary-900"
                          : "text-neutral-600 hover:bg-neutral-100 hover:text-neutral-800",
                      )}
                    >
                      {escopo.rotulo}
                      <span
                        className={cn(
                          "font-mono tabular-nums",
                          ativo ? "text-primary-500" : "text-neutral-400",
                        )}
                      >
                        {escopo.total > 99 ? "99+" : escopo.total}
                      </span>
                    </Link>
                  </li>
                );
              })}
            </ul>
          </nav>

          {/* Eixo 2 — caixa (situação da conversa), no mesmo desenho do eixo
              de escopo: células iguais, nunca quebra linha. */}
          <nav aria-label="Caixa de conversas" className="mt-1">
            <ul className="grid grid-cols-4 gap-0.5 rounded-md border border-neutral-300 bg-neutral-0 p-0.5">
              {CAIXAS.map((caixa) => {
                const ativo = filtro === caixa.chave;
                const total =
                  caixa.chave === "adiadas"
                    ? totalAdiadas
                    : caixa.chave === "resolvidas"
                      ? totalResolvidas
                      : 0;
                return (
                  <li key={caixa.chave}>
                    <Link
                      href={urlChat(caixa.chave, busca, etiquetaFiltro, atendenteFiltro)}
                      aria-current={ativo ? "page" : undefined}
                      title={total > 0 ? `${caixa.rotulo} (${total})` : caixa.rotulo}
                      className={cn(
                        "flex h-[32px] items-center justify-center gap-0.5 rounded-sm text-xs font-medium transition-colors duration-[120ms] focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-primary-500",
                        ativo
                          ? "bg-primary-50 text-primary-900"
                          : "text-neutral-600 hover:bg-neutral-100 hover:text-neutral-800",
                      )}
                    >
                      {caixa.rotulo}
                      {total > 0 ? (
                        <span
                          className={cn(
                            "font-mono tabular-nums",
                            ativo ? "text-primary-500" : "text-neutral-400",
                          )}
                        >
                          {total > 99 ? "99+" : total}
                        </span>
                      ) : null}
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
        </div>

        <ListaConversas
          itens={itensLista}
          equipe={equipeAtendentes}
          etiquetas={etiquetas.map((e) => ({ id: e.id, nome: e.nome }))}
        />
      </aside>

      {/* Janela da conversa */}
      <section
        aria-label="Conversa"
        className={cn(
          "min-h-0 min-w-0 flex-1 flex-col lg:flex",
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
              // key: trocar de conversa REMONTA o composer — anexos, erro e
              // rascunho de um lead nunca vazam para o outro.
              key={atual.id}
              leadId={atual.id}
              temConversa={temCanalEnvio}
              mensagens={mensagens}
              mensagensPadrao={mensagensPadrao}
              templates={templates}
              restanteJanela={restanteJanela}
              marketingBloqueado={atual.marketing_bloqueado_em != null}
              urlMaisAntigas={urlMaisAntigas}
              hojeChave={hojeChave}
              ontemChave={ontemChave}
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
