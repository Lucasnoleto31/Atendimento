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
import { FiltrosLista, SeletorAtendente } from "./filtros";
import { ListaConversas, type ItemConversa } from "./lista-conversas";
import {
  BotaoPainelLead,
  PainelLead,
  type DetalheLead,
  type GiroCliente,
  type ReceitaCliente,
} from "./painel";
import { type TarefaLead } from "./tarefas-lead";

export const metadata: Metadata = { title: "Chat · Zeve CRM" };

// Eixo "caixa": situação da conversa. O eixo "escopo" (Minhas / Sem dono /
// Todas) vive no parâmetro v (atendente) e combina livremente com este —
// dá para ver "adiadas minhas", "resolvidas sem dono" etc. A antiga aba
// "Não lidas" virou ordenação da Caixa (não lidas primeiro) + contagem no
// rótulo — era filtro client-side depois do limit, mentia por omissão.
const CAIXAS = [
  { chave: "todas", rotulo: "Caixa" },
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
  chat_adiado_ate?: string | null;
  chat_resolvido_em?: string | null;
  marketing_bloqueado_em?: string | null;
};

const CAMPOS_BASE =
  "id, nome, telefone_e164, instagram_id, instagram_usuario, customer_id, responsavel_id, stage_id, ultima_interacao_em, chat_lido_em, chatwoot_conversation_id";
// Sem a migração 0017 a coluna não existe: a consulta cai para os campos base.
const CAMPOS_CONVERSA = `${CAMPOS_BASE}, chat_adiado_em, chat_resolvido_em, marketing_bloqueado_em`;
// Prazo do adiamento (migração 0042); sem ela, cai para CAMPOS_CONVERSA.
const CAMPOS_PRAZO = `${CAMPOS_CONVERSA}, chat_adiado_ate`;

// Cada consulta tenta primeiro com o prazo (0042), depois só com as marcas
// de adiada/resolvida (0017/0018) e por fim com os campos base.
type NivelConsulta = "prazo" | "adiado" | "base";

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
  // f=naolidas também: a caixa padrão já ordena as não lidas primeiro.
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

  // eslint-disable-next-line react-hooks/purity -- Server Component: uma renderização por request, o relógio do request é estável.
  const agoraMs = Date.now();
  // O "agora" dos filtros de prazo: adiada de verdade é a que ainda não
  // venceu; a vencida volta a contar como pendente na caixa de entrada.
  const agoraIso = new Date(agoraMs).toISOString();

  // Recorte da caixa atual, compartilhado entre a lista e as contagens.
  // Nível "prazo": adiada = chat_adiado_em preenchido E prazo no futuro
  // (sem prazo, vale o comportamento antigo: adiada até o lead responder);
  // a vencida cai de volta na caixa padrão sem apagar o histórico.
  // eslint-disable-next-line @typescript-eslint/no-explicit-any -- corta a recursão de tipos do builder na cadeia condicional
  function aplicarCaixa(q: any, nivel: NivelConsulta) {
    if (nivel === "base") return q;
    if (filtro === "adiadas") {
      q = q.not("chat_adiado_em", "is", null);
      if (nivel === "prazo") {
        q = q.or(`chat_adiado_ate.is.null,chat_adiado_ate.gt."${agoraIso}"`);
      }
    } else if (filtro === "resolvidas") {
      q = q.not("chat_resolvido_em", "is", null);
    } else {
      q = q.is("chat_resolvido_em", null);
      q =
        nivel === "prazo"
          ? q.or(`chat_adiado_em.is.null,chat_adiado_ate.lte."${agoraIso}"`)
          : q.is("chat_adiado_em", null);
    }
    return q;
  }

  // A lista da caixa de entrada. O nível desce conforme as migrações que o
  // banco tem: "prazo" (0042) → "adiado" (0017/0018) → "base".
  function montarConsulta(nivel: NivelConsulta) {
    const campos =
      nivel === "prazo"
        ? CAMPOS_PRAZO
        : nivel === "adiado"
          ? CAMPOS_CONVERSA
          : CAMPOS_BASE;
    // eslint-disable-next-line @typescript-eslint/no-explicit-any -- idem
    let q: any = supabase
      .from("leads")
      .select(etiquetaFiltro ? `${campos}, lead_tags!inner(tag_id)` : campos);
    // Na aba Adiadas o que importa é quem volta primeiro: prazo ascendente
    // (só no nível "prazo" — sem a coluna 0042 vale a ordem por hora).
    q =
      filtro === "adiadas" && nivel === "prazo"
        ? q
            .order("chat_adiado_ate", { ascending: true, nullsFirst: false })
            .order("ultima_interacao_em", {
              ascending: false,
              nullsFirst: false,
            })
        : q.order("ultima_interacao_em", {
            ascending: false,
            nullsFirst: false,
          });
    q = q.limit(100);

    // Na Meta a conversa é o próprio telefone (basta ter havido mensagem);
    // no Chatwoot, o vínculo com a conversa de lá.
    q =
      canal === "meta"
        ? q.not("ultima_interacao_em", "is", null)
        : q.not("chatwoot_conversation_id", "is", null);

    // A caixa de entrada mostra só o que falta atender: adiadas (no prazo)
    // e resolvidas saem daqui e vivem nos atalhos próprios.
    q = aplicarCaixa(q, nivel);

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

  // Em promessa, não em await: a lista corre em paralelo com as oito
  // contagens do cabeçalho — antes eram estágios em cascata e a página
  // pagava um round-trip inteiro por estágio (auditoria: ~1,8s sem conversa).
  const listaPromise = (async () => {
    let { data: brutas } = await montarConsulta("prazo");
    if (brutas === null) ({ data: brutas } = await montarConsulta("adiado"));
    if (brutas === null) ({ data: brutas } = await montarConsulta("base"));
    return (brutas ?? []) as unknown as ConversaLinha[];
  })();

  const naoLida = (c: ConversaLinha) =>
    c.ultima_interacao_em !== null &&
    (c.chat_lido_em === null || c.ultima_interacao_em > c.chat_lido_em);

  // Adiada valendo: o prazo ainda não venceu (sem a coluna do prazo — banco
  // sem a 0042 — vale o comportamento antigo: adiada até o lead responder).
  const adiadaNoPrazo = (c: ConversaLinha) =>
    c.chat_adiado_em != null &&
    (c.chat_adiado_ate == null || Date.parse(c.chat_adiado_ate) > agoraMs);

  // Prazo de adiamento vencido e ninguém abriu a conversa desde então: ela
  // voltou à caixa e conta como pendente até alguém olhar (abrir marca lida).
  const adiadaVencida = (c: ConversaLinha) =>
    c.chat_adiado_em != null &&
    c.chat_adiado_ate != null &&
    Date.parse(c.chat_adiado_ate) <= agoraMs &&
    (c.chat_lido_em === null ||
      Date.parse(c.chat_lido_em) < Date.parse(c.chat_adiado_ate));


  // Etiquetas (filtro e ferramentas), parâmetro do alerta de espera, equipe
  // para o filtro de atendente e a contagem do atalho "Adiadas".
  // Sem a migração 0016 não existe coluna cor — a lista continua, sem cor.
  // Contagem dos atalhos fora da caixa (adiadas, resolvidas). A de adiadas
  // só conta as dentro do prazo (0042; sem a coluna cai para todas); sem as
  // migrações 0017/0018 a coluna não existe e o atalho simplesmente some.
  const contarFora = async (
    coluna: "chat_adiado_em" | "chat_resolvido_em",
  ): Promise<number> => {
    const montar = (comPrazo: boolean) => {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any -- idem
      let q: any = supabase
        .from("leads")
        .select("id", { count: "exact", head: true })
        .not(coluna, "is", null);
      if (comPrazo) {
        q = q.or(`chat_adiado_ate.is.null,chat_adiado_ate.gt."${agoraIso}"`);
      }
      q =
        canal === "meta"
          ? q.not("ultima_interacao_em", "is", null)
          : q.not("chatwoot_conversation_id", "is", null);
      if (atendenteFiltro === "sem") q = q.is("responsavel_id", null);
      else if (atendenteFiltro) q = q.eq("responsavel_id", atendenteFiltro);
      return q;
    };
    let { count, error } = await montar(coluna === "chat_adiado_em");
    if (error && coluna === "chat_adiado_em") {
      ({ count, error } = await montar(false));
    }
    return error ? 0 : (count ?? 0);
  };

  // Contagens do eixo de escopo (Minhas / Sem dono / Todas), na caixa atual.
  const contarEscopo = async (vAlvo: string): Promise<number> => {
    const montar = (nivel: NivelConsulta) => {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any -- idem
      let q: any = supabase
        .from("leads")
        .select("id", { count: "exact", head: true });
      q =
        canal === "meta"
          ? q.not("ultima_interacao_em", "is", null)
          : q.not("chatwoot_conversation_id", "is", null);
      q = aplicarCaixa(q, nivel);
      if (vAlvo === "sem") q = q.is("responsavel_id", null);
      else if (vAlvo) q = q.eq("responsavel_id", vAlvo);
      return q;
    };
    let { count, error } = await montar("prazo");
    if (error) ({ count, error } = await montar("adiado"));
    return error ? 0 : (count ?? 0);
  };

  const [
    conversasBrutas,
    { data: tagsAtivas },
    { data: alertaCfg },
    { data: pessoasFiltro },
    totalAdiadas,
    totalResolvidas,
    totalMinhas,
    totalSemDono,
    totalTodas,
  ] = await Promise.all([
      listaPromise,
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
  // A vez é nossa primeiro: na Caixa, as pendentes (não lida ou prazo de
  // adiamento vencido) sobem — o sort é estável, então dentro de cada grupo
  // vale a ordem por hora. A contagem vai para o rótulo da célula "Caixa".
  const pendenteDeAtencao = (c: ConversaLinha) =>
    naoLida(c) || adiadaVencida(c);
  const conversas =
    filtro === "todas"
      ? [...conversasBrutas].sort(
          (a, b) =>
            Number(pendenteDeAtencao(b)) - Number(pendenteDeAtencao(a)),
        )
      : conversasBrutas;
  const totalNaoLidas =
    filtro === "todas" ? conversas.filter(pendenteDeAtencao).length : 0;
  const etiquetas = (tagsAtivas ?? []) as Etiqueta[];
  const equipeAtendentes = (pessoasFiltro ?? []) as { id: string; nome: string }[];
  const minutosAlerta = Math.max(1, Number(alertaCfg?.valor ?? 15));

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

  async function buscarConversaAberta(
    id: string,
  ): Promise<ConversaLinha | null> {
    for (const campos of [CAMPOS_PRAZO, CAMPOS_CONVERSA, CAMPOS_BASE]) {
      const { data, error } = await supabase
        .from("leads")
        .select(campos)
        .eq("id", id)
        .maybeSingle();
      if (!error) return data as unknown as ConversaLinha | null;
    }
    return null;
  }

  // Prévia da última mensagem de cada conversa: a RPC da 0045 devolve UMA
  // linha por lead (distinct on). Sem a migração, cai no caminho antigo —
  // 300 interações recentes, primeira de cada lead.
  async function buscarPrevias(ids: string[]) {
    const { data, error } = await supabase.rpc("previas_conversas", {
      p_lead_ids: ids,
    });
    if (!error) {
      return (data ?? []) as {
        lead_id: string;
        tipo: string;
        conteudo: string | null;
      }[];
    }
    const { data: ultimas } = await supabase
      .from("lead_interactions")
      .select("lead_id, tipo, conteudo, criado_em")
      .in("lead_id", ids)
      .in("tipo", ["mensagem_recebida", "mensagem_enviada"])
      .order("criado_em", { ascending: false })
      .limit(300);
    return (ultimas ?? []) as {
      lead_id: string;
      tipo: string;
      conteudo: string | null;
    }[];
  }

  // Terceiro estágio único: etiquetas da lista, prévias e a conversa aberta
  // que está fora da lista viajam juntas — eram três idas em fila.
  const ids = conversas.map((c) => c.id);
  const precisaBuscarAberta = Boolean(
    leadSelecionado && !conversas.some((c) => c.id === leadSelecionado),
  );
  const [{ data: vinculos }, linhasPrevia, conversaForaDaLista] =
    await Promise.all([
      ids.length > 0
        ? supabase
            .from("lead_tags")
            .select("lead_id, tag:tags(id, nome, cor)")
            .in("lead_id", ids)
        : Promise.resolve({ data: [] }),
      ids.length > 0 ? buscarPrevias(ids) : Promise.resolve([]),
      precisaBuscarAberta && leadSelecionado
        ? buscarConversaAberta(leadSelecionado)
        : Promise.resolve(null),
    ]);

  const etiquetasPorLead = new Map<string, Etiqueta[]>();
  for (const vinculo of (vinculos ?? []) as unknown as {
    lead_id: string;
    tag: Etiqueta | null;
  }[]) {
    if (!vinculo.tag) continue;
    const atuais = etiquetasPorLead.get(vinculo.lead_id) ?? [];
    atuais.push(vinculo.tag);
    etiquetasPorLead.set(vinculo.lead_id, atuais);
  }

  const previas = new Map<string, { texto: string; tipo: string }>();
  for (const linha of linhasPrevia) {
    if (!previas.has(linha.lead_id)) {
      previas.set(linha.lead_id, {
        texto: linha.conteudo ?? "",
        tipo: linha.tipo,
      });
    }
  }

  // Conversa aberta: mensagens + dados do lead; abrir marca como lida.
  // Conversa aberta: pode estar fora da lista (adiada, outro filtro, busca).
  // Desce de nível conforme as colunas que o banco tem (0042 → 0017 → base).
  const atual = leadSelecionado
    ? (conversas.find((c) => c.id === leadSelecionado) ?? conversaForaDaLista)
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
        sistema?: boolean | null;
        via?: string | null;
        campanha?: string | null;
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
        // O que a Janela lê dos metadados: log de sistema (linha fina) e
        // origem do envio (selo "automático" + nome da campanha).
        metadados: m.metadados
          ? {
              sistema: m.metadados.sistema === true,
              via: m.metadados.via ?? null,
              campanha: m.metadados.campanha ?? null,
            }
          : null,
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
  // "Sem dono" nunca teve conversa (a distribuição automática dá dono a
  // todas): a célula só aparece quando a contagem sai do zero.
  const escopos = [
    { rotulo: "Minhas", v: perfil?.id ?? "", total: totalMinhas },
    ...(totalSemDono > 0
      ? [{ rotulo: "Sem dono", v: "sem", total: totalSemDono }]
      : []),
    { rotulo: "Todas", v: "", total: totalTodas },
  ];

  // O select "por atendente" refina o escopo Todas — em Minhas/Sem dono não
  // faz sentido e some (antes eram dois controles gravando o MESMO parâmetro).
  const escopoTodas =
    atendenteFiltro === "" ||
    (atendenteFiltro !== "sem" && atendenteFiltro !== perfil?.id);

  // A lista é um componente cliente (seleção múltipla), então tudo que é
  // cálculo ou classe vai resolvido daqui.
  const itensLista: ItemConversa[] = conversas.map((conversa) => {
    const aberta = conversa.id === atual?.id;
    // A adiada vencida volta como pendente; o alerta de espera continua só
    // para quem tem mensagem sem resposta (na vencida o lead nem respondeu).
    const pendente = (naoLida(conversa) || adiadaVencida(conversa)) && !aberta;
    const espera = naoLida(conversa) && !aberta ? minutosAguardando(conversa) : 0;
    const emAlerta = espera >= minutosAlerta;
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
      previa: previas.get(conversa.id)?.texto ?? "—",
      previaTipo: previas.get(conversa.id)?.tipo ?? null,
      pendente,
      aberta,
      espera: emAlerta
        ? espera >= 60
          ? `${Math.floor(espera / 60)}h`
          : `${espera}min`
        : null,
      // Na aba Adiadas, até quando cada uma dorme (hora se vence hoje).
      adiadaAte:
        filtro === "adiadas" && conversa.chat_adiado_ate
          ? horaOuData(conversa.chat_adiado_ate)
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
      <AtualizadorTempoReal leadAbertoId={leadSelecionado} />
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

          {/* Eixo 1 — escopo (de quem), com contagem. Combina com a caixa.
              Em Todas, o select compacto ao lado refina por atendente. */}
          <nav
            aria-label="Filtro por atendente"
            className="mt-1 flex items-center gap-0.5"
          >
            <ul
              className={cn(
                "grid min-w-0 flex-1 gap-0.5 rounded-md border border-neutral-300 bg-neutral-0 p-0.5",
                escopos.length === 3 ? "grid-cols-3" : "grid-cols-2",
              )}
            >
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
            {escopoTodas ? (
              <SeletorAtendente
                equipe={equipeAtendentes}
                filtro={filtro}
                busca={busca}
                etiquetaAtual={etiquetaFiltro}
                atendenteAtual={atendenteFiltro}
              />
            ) : null}
          </nav>

          {/* Eixo 2 — caixa (situação da conversa), no mesmo desenho do eixo
              de escopo: células iguais, nunca quebra linha. */}
          <nav aria-label="Caixa de conversas" className="mt-1">
            <ul className="grid grid-cols-3 gap-0.5 rounded-md border border-neutral-300 bg-neutral-0 p-0.5">
              {CAIXAS.map((caixa) => {
                const ativo = filtro === caixa.chave;
                const total =
                  caixa.chave === "adiadas"
                    ? totalAdiadas
                    : caixa.chave === "resolvidas"
                      ? totalResolvidas
                      : totalNaoLidas;
                // Adiadas mostra o total REAL (são milhares — "99+" escondia
                // o tamanho da fila que a equipe empurra com a barriga).
                const rotuloTotal =
                  caixa.chave === "adiadas"
                    ? total.toLocaleString("pt-BR")
                    : total > 99
                      ? "99+"
                      : String(total);
                return (
                  <li key={caixa.chave}>
                    <Link
                      href={urlChat(caixa.chave, busca, etiquetaFiltro, atendenteFiltro)}
                      aria-current={ativo ? "page" : undefined}
                      title={
                        total > 0
                          ? `${caixa.rotulo} (${total.toLocaleString("pt-BR")})`
                          : caixa.rotulo
                      }
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
                          {rotuloTotal}
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
              <BotaoPainelLead />
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
              adiada={adiadaNoPrazo(atual)}
              adiadaAte={
                adiadaNoPrazo(atual) && atual.chat_adiado_ate
                  ? horaOuData(atual.chat_adiado_ate)
                  : null
              }
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
