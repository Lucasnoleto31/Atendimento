"use server";

import { createClient } from "@/lib/supabase/server";
import { perfilAtual } from "@/lib/auth";
import { ehPassoAtivacao, PASSOS_ATIVACAO } from "@/lib/ativacao-passos";

/**
 * A camada de dados do chat novo (/conversas). A mudança que importa é de
 * ARQUITETURA, não de consulta: o chat antigo refazia a página inteira
 * (~18–28 consultas) a cada clique; aqui a lista vive no navegador e cada
 * gesto busca só o que mudou — trocar de visão é UMA chamada, abrir uma
 * conversa é outra (carregarConversa, a mesma da /hoje).
 *
 * As quatro visões vêm do uso medido (9 dias úteis):
 *   caixa      — o dia real: conversas em aberto + adiadas VENCIDAS (as
 *                1.006 do buraco negro voltam para cá). Quem espera mais,
 *                primeiro.
 *   aguardando — só quem espera resposta, em fila de verdade (FIFO).
 *   adiadas    — dormindo com hora para acordar (as no prazo).
 *   resolvidas — fechadas, mais recente primeiro. Antes só reapareciam
 *                misturadas em "tudo", e resolver parecia apagar.
 *   tudo       — o acervo, com busca e filtros finos.
 */

export type VisaoConversas =
  "caixa" | "aguardando" | "adiadas" | "resolvidas" | "tudo";

export type LinhaConversa = {
  leadId: string;
  nome: string;
  telefone: string | null;
  instagram: string | null;
  cliente: boolean;
  /** Prévia da última mensagem + de quem foi a vez. */
  previa: string | null;
  vez: "eles" | "nos" | null;
  ultimaEm: string | null;
  esperaHoras: number | null;
  janelaAberta: boolean;
  naoLida: boolean;
  adiadaAte: string | null;
  adiadaVencida: boolean;
  resolvida: boolean;
  responsavelIniciais: string | null;
  /** Quem está no atendimento — aparece acima do nome do lead na fila. */
  responsavelNome: string | null;
  etiquetaNome: string | null;
  /** Todas as etiquetas do lead, com a cor cadastrada — vão na linha. */
  etiquetas: { nome: string; cor: string | null }[];
  sub: string | null;
};

export type Contagens = {
  caixa: number;
  aguardando: number;
  adiadas: number;
  resolvidas: number;
};

export type CargaConversas = {
  linhas: LinhaConversa[];
  contagens: Contagens;
  temMais: boolean;
  /** Etiquetas ativas, para o seletor das ações em massa. */
  etiquetas: { id: string; nome: string; cor: string | null }[];
};

const PAGINA = 60;

type LinhaView = {
  lead_id: string;
  nome: string;
  telefone_e164: string | null;
  customer_id: string | null;
  responsavel_id: string | null;
  responsavel_nome: string | null;
  ultima_mensagem_em: string | null;
  ultimo_tipo: string | null;
  horas_esperando: number | null;
  aguardando_resposta: boolean | null;
  janela_aberta: boolean | null;
  adiado_vencido: boolean | null;
  etiquetas: string[] | null;
};

type ExtrasLead = {
  id: string;
  instagram_usuario: string | null;
  chat_lido_em: string | null;
  chat_adiado_em: string | null;
  chat_adiado_ate?: string | null;
  chat_resolvido_em: string | null;
};

function iniciais(nome: string | null): string | null {
  if (!nome) return null;
  const partes = nome.trim().split(/\s+/);
  return (
    ((partes[0]?.[0] ?? "") + (partes[1]?.[0] ?? "")).toUpperCase() || null
  );
}

const CAMPOS_VIEW =
  "lead_id, nome, telefone_e164, customer_id, responsavel_id, responsavel_nome, ultima_mensagem_em, ultimo_tipo, horas_esperando, aguardando_resposta, janela_aberta, adiado_vencido, etiquetas";

export async function carregarListaConversas(
  visao: VisaoConversas,
  opts: {
    escopo: "minhas" | "todas";
    busca?: string;
    atendenteId?: string;
    etiquetaId?: string;
    offset?: number;
  },
): Promise<CargaConversas | { erro: string }> {
  const perfil = await perfilAtual();
  if (!perfil) return { erro: "Sessão expirada. Entre novamente." };

  const supabase = await createClient();
  const offset = opts.offset ?? 0;
  const busca = (opts.busca ?? "").trim().replaceAll(/[,()"]/g, "");

  // eslint-disable-next-line @typescript-eslint/no-explicit-any -- corta a recursão de tipos do builder
  const base = (): any => {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any -- idem
    let q: any = supabase.from("v_leads_listas").select(CAMPOS_VIEW);
    if (opts.escopo === "minhas") q = q.eq("responsavel_id", perfil.id);
    if (opts.atendenteId) q = q.eq("responsavel_id", opts.atendenteId);
    if (opts.etiquetaId) q = q.contains("etiqueta_ids", [opts.etiquetaId]);
    if (busca) {
      q = q.or(`nome.ilike.%${busca}%,telefone_e164.ilike.%${busca}%`);
    }
    return q;
  };

  let linhasView: LinhaView[] = [];
  let temMais = false;

  if (visao === "aguardando") {
    const { data, error } = await base()
      .eq("aguardando_resposta", true)
      .order("horas_esperando", { ascending: false, nullsFirst: false })
      .range(offset, offset + PAGINA - 1);
    if (error) return { erro: error.message };
    linhasView = (data ?? []) as LinhaView[];
    temMais = linhasView.length === PAGINA;
  } else if (visao === "caixa") {
    // O dia: conversas em aberto (com conversa de verdade) + adiadas cujo
    // prazo venceu. Duas fatias — a ordenação final (quem espera mais,
    // primeiro) fecha aqui, porque mistura campos que o PostgREST não
    // ordena junto.
    const [abertas, vencidas] = await Promise.all([
      base()
        .eq("em_aberto", true)
        .not("ultima_mensagem_em", "is", null)
        .order("ultima_mensagem_em", { ascending: false })
        .limit(80),
      base()
        .eq("adiado_vencido", true)
        .order("ultima_mensagem_em", { ascending: false })
        .limit(40),
    ]);
    if (abertas.error) return { erro: abertas.error.message };
    const mapa = new Map<string, LinhaView>();
    for (const l of [
      ...((abertas.data ?? []) as LinhaView[]),
      ...((vencidas.data ?? []) as LinhaView[]),
    ]) {
      mapa.set(l.lead_id, l);
    }
    linhasView = [...mapa.values()].sort((a, b) => {
      const ea = a.horas_esperando ?? -1;
      const eb = b.horas_esperando ?? -1;
      if (ea !== eb) return eb - ea;
      return (b.ultima_mensagem_em ?? "").localeCompare(
        a.ultima_mensagem_em ?? "",
      );
    });
  } else if (visao === "adiadas") {
    // Adiada é estado de LEADS (a view não separa adiada de resolvida):
    // a fonte é a tabela, ordenada por quem volta primeiro (0042); antes
    // dela, pela data do adiamento. Vencida mora na Caixa, não aqui.
    // eslint-disable-next-line @typescript-eslint/no-explicit-any -- builder
    const montarAdiadas = (comPrazo: boolean): any => {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any -- idem
      let q: any = supabase
        .from("leads")
        .select("id")
        .not("chat_adiado_em", "is", null)
        .is("chat_resolvido_em", null)
        .neq("status", "perdido");
      if (opts.escopo === "minhas") q = q.eq("responsavel_id", perfil.id);
      if (opts.atendenteId) q = q.eq("responsavel_id", opts.atendenteId);
      if (busca)
        q = q.or(`nome.ilike.%${busca}%,telefone_e164.ilike.%${busca}%`);
      if (comPrazo) {
        // Mesma regra da view: no prazo pela hora marcada OU, para o que foi
        // adiado sem prazo (fallback de um erro passageiro), pela heurística
        // de 3 dias. Sem o segundo ramo, essa linha sumia de TODAS as visões.
        const agoraIso = new Date().toISOString();
        const tresDias = new Date(Date.now() - 3 * 86_400_000).toISOString();
        q = q
          .or(
            `chat_adiado_ate.gte.${agoraIso},and(chat_adiado_ate.is.null,chat_adiado_em.gte.${tresDias})`,
          )
          .order("chat_adiado_ate", { ascending: true, nullsFirst: false });
      } else {
        q = q
          .gte(
            "chat_adiado_em",
            new Date(Date.now() - 3 * 86_400_000).toISOString(),
          )
          .order("chat_adiado_em", { ascending: false });
      }
      return q.range(offset, offset + PAGINA - 1);
    };
    let adiadasR = await montarAdiadas(true);
    if (adiadasR.error) adiadasR = await montarAdiadas(false);
    if (adiadasR.error) return { erro: adiadasR.error.message };
    const idsAdiadas = ((adiadasR.data ?? []) as { id: string }[]).map(
      (l) => l.id,
    );
    if (idsAdiadas.length > 0) {
      const { data, error } = await supabase
        .from("v_leads_listas")
        .select(CAMPOS_VIEW)
        .in("lead_id", idsAdiadas);
      if (error) return { erro: error.message };
      const porId = new Map(
        ((data ?? []) as LinhaView[]).map((l) => [l.lead_id, l]),
      );
      linhasView = idsAdiadas
        .map((id) => porId.get(id))
        .filter((l): l is LinhaView => Boolean(l));
    }
    temMais = idsAdiadas.length === PAGINA;
  } else if (visao === "resolvidas") {
    // Mesma história das adiadas: `chat_resolvido_em` é coluna de LEADS, a
    // view não separa. Busca os ids lá e hidrata pela view.
    // eslint-disable-next-line @typescript-eslint/no-explicit-any -- builder
    let q: any = supabase
      .from("leads")
      .select("id")
      .not("chat_resolvido_em", "is", null)
      .neq("status", "perdido")
      .order("chat_resolvido_em", { ascending: false });
    if (opts.escopo === "minhas") q = q.eq("responsavel_id", perfil.id);
    if (opts.atendenteId) q = q.eq("responsavel_id", opts.atendenteId);
    if (busca) q = q.or(`nome.ilike.%${busca}%,telefone_e164.ilike.%${busca}%`);

    const { data: brutas, error } = await q.range(offset, offset + PAGINA - 1);
    if (error) return { erro: error.message };
    const ids = ((brutas ?? []) as { id: string }[]).map((l) => l.id);
    if (ids.length > 0) {
      const { data, error: erroView } = await supabase
        .from("v_leads_listas")
        .select(CAMPOS_VIEW)
        .in("lead_id", ids);
      if (erroView) return { erro: erroView.message };
      const porId = new Map(
        ((data ?? []) as LinhaView[]).map((l) => [l.lead_id, l]),
      );
      linhasView = ids
        .map((id) => porId.get(id))
        .filter((l): l is LinhaView => Boolean(l));
    }
    temMais = ids.length === PAGINA;
  } else {
    const { data, error } = await base()
      .not("ultima_mensagem_em", "is", null)
      .order("ultima_mensagem_em", { ascending: false })
      .range(offset, offset + PAGINA - 1);
    if (error) return { erro: error.message };
    linhasView = (data ?? []) as LinhaView[];
    temMais = linhasView.length === PAGINA;
  }

  const ids = linhasView.map((l) => l.lead_id);
  // A view devolve os NOMES das etiquetas; a cor mora em tags. Uma consulta
  // para a lista inteira (são poucas etiquetas), não uma por linha.

  // Enriquecimento em paralelo: colunas de leads que a view não expõe,
  // prévia da última mensagem (RPC 0045) e as três contagens do trilho.
  const [
    extrasR,
    previasR,
    ctCaixaAbertas,
    ctCaixaVencidas,
    ctAguardando,
    ctAdiadas,
    ctResolvidas,
    tagsR,
  ] = await Promise.all([
    ids.length > 0
      ? (async () => {
          const cheio = await supabase
            .from("leads")
            .select(
              "id, instagram_usuario, chat_lido_em, chat_adiado_em, chat_adiado_ate, chat_resolvido_em",
            )
            .in("id", ids);
          if (cheio.error) {
            // Sem a 0042 (chat_adiado_ate) ou 0017/0018: pede o que der.
            return supabase
              .from("leads")
              .select(
                "id, instagram_usuario, chat_lido_em, chat_adiado_em, chat_resolvido_em",
              )
              .in("id", ids);
          }
          return cheio;
        })()
      : Promise.resolve({ data: [] as ExtrasLead[], error: null }),
    ids.length > 0
      ? supabase.rpc("previas_conversas", { p_lead_ids: ids })
      : Promise.resolve({ data: [], error: null }),
    base()
      .select("lead_id", { count: "exact", head: true })
      .eq("em_aberto", true)
      .not("ultima_mensagem_em", "is", null),
    base()
      .select("lead_id", { count: "exact", head: true })
      .eq("adiado_vencido", true),
    base()
      .select("lead_id", { count: "exact", head: true })
      .eq("aguardando_resposta", true),
    (async () => {
      // Conta as adiadas na fonte certa (leads), com o mesmo fallback.
      // eslint-disable-next-line @typescript-eslint/no-explicit-any -- builder
      const montar = (comPrazo: boolean): any => {
        // eslint-disable-next-line @typescript-eslint/no-explicit-any -- idem
        let q: any = supabase
          .from("leads")
          .select("id", { count: "exact", head: true })
          .not("chat_adiado_em", "is", null)
          .is("chat_resolvido_em", null)
          .neq("status", "perdido");
        if (opts.escopo === "minhas") q = q.eq("responsavel_id", perfil.id);
        // O contador tem de contar exatamente o que a lista mostra.
        if (comPrazo) {
          const agoraIso = new Date().toISOString();
          const tresDias = new Date(Date.now() - 3 * 86_400_000).toISOString();
          q = q.or(
            `chat_adiado_ate.gte.${agoraIso},and(chat_adiado_ate.is.null,chat_adiado_em.gte.${tresDias})`,
          );
        } else
          q = q.gte(
            "chat_adiado_em",
            new Date(Date.now() - 3 * 86_400_000).toISOString(),
          );
        return q;
      };
      const cheio = await montar(true);
      return cheio.error ? montar(false) : cheio;
    })(),
    (async () => {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any -- builder
      let q: any = supabase
        .from("leads")
        .select("id", { count: "exact", head: true })
        .not("chat_resolvido_em", "is", null)
        .neq("status", "perdido");
      if (opts.escopo === "minhas") q = q.eq("responsavel_id", perfil.id);
      if (opts.atendenteId) q = q.eq("responsavel_id", opts.atendenteId);
      return q;
    })(),
    supabase.from("tags").select("id, nome, cor").order("nome"),
  ]);

  // Nome → cor. Sem a consulta (RLS, migração), o chip sai neutro: melhor
  // etiqueta sem cor do que linha sem etiqueta.
  const tags = (tagsR.data ?? []) as {
    id: string;
    nome: string;
    cor: string | null;
  }[];
  const coresPorNome = new Map(tags.map((t) => [t.nome, t.cor]));

  const extras = new Map(
    ((extrasR.data ?? []) as ExtrasLead[]).map((e) => [e.id, e]),
  );
  const previas = new Map(
    (
      (previasR.data ?? []) as {
        lead_id: string;
        tipo: string;
        conteudo: string | null;
      }[]
    ).map((p) => [p.lead_id, p]),
  );

  const agoraMs = Date.now();

  const linhas: LinhaConversa[] = linhasView.map((l) => {
    const ex = extras.get(l.lead_id);
    const pv = previas.get(l.lead_id);
    const naoLida =
      l.ultima_mensagem_em !== null &&
      (!ex?.chat_lido_em || l.ultima_mensagem_em > ex.chat_lido_em);
    const adiadaAte = ex?.chat_adiado_ate ?? null;
    const adiada = Boolean(ex?.chat_adiado_em) && !ex?.chat_resolvido_em;
    const adiadaVencida =
      Boolean(l.adiado_vencido) ||
      (adiada && adiadaAte !== null && Date.parse(adiadaAte) < agoraMs);
    return {
      leadId: l.lead_id,
      nome: l.nome,
      telefone: l.telefone_e164,
      instagram: ex?.instagram_usuario ?? null,
      cliente: l.customer_id !== null,
      previa: pv?.conteudo ?? null,
      vez: pv ? (pv.tipo === "mensagem_recebida" ? "eles" : "nos") : null,
      ultimaEm: l.ultima_mensagem_em,
      esperaHoras: l.horas_esperando,
      janelaAberta: Boolean(l.janela_aberta),
      naoLida,
      adiadaAte,
      adiadaVencida,
      resolvida: Boolean(ex?.chat_resolvido_em),
      responsavelIniciais: iniciais(l.responsavel_nome),
      responsavelNome: l.responsavel_nome,
      etiquetaNome: l.etiquetas?.[0] ?? null,
      etiquetas: (l.etiquetas ?? []).map((nome) => ({
        nome,
        cor: coresPorNome.get(nome) ?? null,
      })),
      // Stand-by já aparece como chip de etiqueta na linha.
      sub: adiadaVencida ? "adiada · prazo venceu" : null,
    };
  });

  return {
    linhas,
    contagens: {
      caixa: (ctCaixaAbertas.count ?? 0) + (ctCaixaVencidas.count ?? 0),
      aguardando: ctAguardando.count ?? 0,
      adiadas: ctAdiadas.count ?? 0,
      resolvidas: ctResolvidas.count ?? 0,
    },
    temMais,
    etiquetas: tags,
  };
}

// ═════════════════════ Bloco C: o painel de contexto ═════════════════════

export type TarefaDoLead = {
  id: string;
  titulo: string;
  venceEm: string;
  vencida: boolean;
};

export type ContextoConversa = {
  telefone: string | null;
  email: string | null;
  criadoEm: string;
  primeiraRespostaEm: string | null;
  entradaMotivo: string;
  campanha: string | null;
  canal: string | null;
  observacao: string | null;
  responsavelNome: string | null;
  etapaNome: string | null;
  /** Preenchido só quando o lead já é cliente da corretora. */
  cliente: {
    nome: string;
    contaAbertaEm: string | null;
    lotes30d: number | null;
    lotes30dAnterior: number | null;
    ultimoGiroEm: string | null;
    receita30dCentavos: number | null;
    ltvCentavos: number | null;
  } | null;
  /** Templates já disparados a este lead — cada um custa e desgasta. */
  templates: {
    total: number;
    ultimoEm: string | null;
    ultimoNome: string | null;
    /** Custo acumulado estimado, quando a taxa está configurada. */
    custoCentavos: number | null;
  };
  tarefas: TarefaDoLead[];
  /** false quando a 0013 não está aplicada — o painel avisa em vez de mentir. */
  tarefasDisponiveis: boolean;
  /** Roteiro de ativação — null quando não se aplica (lead fora da
   *  ativação e sem nenhum passo marcado) ou quando a 0065 não rodou. */
  ativacao:
    | {
        passo: string;
        rotulo: string;
        feitoEm: string | null;
        autor: string | null;
        /** Veio dos fatos (Genial): não dá para desmarcar à mão. */
        automatico: boolean;
      }[]
    | null;
};

/**
 * O contexto do lead para o painel do palco. É uma chamada À PARTE de
 * carregarConversa de propósito: abrir a conversa (o gesto de 200×/dia) não
 * pode esperar por giro, receita e tarefas — o painel chega logo depois.
 */
export async function carregarContexto(
  leadId: string,
): Promise<ContextoConversa | { erro: string }> {
  const perfil = await perfilAtual();
  if (!perfil) return { erro: "Sessão expirada." };

  const supabase = await createClient();
  const { data: lead, error } = await supabase
    .from("leads")
    .select(
      "telefone_e164, email, criado_em, primeira_resposta_em, entrada_motivo, campanha, utm_campaign, observacao, customer_id, status, responsavel:profiles(nome), etapa:pipeline_stages(nome), canal:channels(nome), customer:customers(nome_completo, conta_aberta_em)",
    )
    .eq("id", leadId)
    .maybeSingle();
  if (error) return { erro: "Não deu para ler os dados do lead." };
  if (!lead) return { erro: "Lead não encontrado." };

  type LeadContexto = {
    telefone_e164: string | null;
    email: string | null;
    criado_em: string;
    primeira_resposta_em: string | null;
    entrada_motivo: string;
    campanha: string | null;
    utm_campaign: string | null;
    observacao: string | null;
    customer_id: string | null;
    status: string | null;
    responsavel: { nome: string } | null;
    etapa: { nome: string } | null;
    canal: { nome: string } | null;
    customer: { nome_completo: string; conta_aberta_em: string | null } | null;
  };
  const l = lead as unknown as LeadContexto;
  const agora = Date.now();

  // Giro, receita e tarefas em paralelo — e cada uma tolerante: view ou
  // migração ausente vira ausência de cartão, nunca painel quebrado.
  const [giroR, receitaR, tarefasR, templatesR, custoR, checklistR, loteR] =
    await Promise.all([
      l.customer_id
        ? supabase
            .from("v_customer_giro")
            .select("lotes_30d, lotes_30d_anterior, ultimo_giro_em")
            .eq("customer_id", l.customer_id)
            .maybeSingle()
        : Promise.resolve({ data: null, error: null }),
      l.customer_id
        ? supabase
            .from("v_customer_receita")
            .select("receita_30d_centavos, ltv_centavos")
            .eq("customer_id", l.customer_id)
            .maybeSingle()
        : Promise.resolve({ data: null, error: null }),
      supabase
        .from("lead_tasks")
        .select("id, titulo, vence_em")
        .eq("lead_id", leadId)
        .is("concluida_em", null)
        .order("vence_em")
        .limit(10),
      // Template disparado deixa metadados.template no histórico: é por aí
      // que se sabe quantas vezes já se pagou para falar com este lead.
      supabase
        .from("lead_interactions")
        .select("criado_em, metadados", { count: "exact" })
        .eq("lead_id", leadId)
        .eq("tipo", "mensagem_enviada")
        .not("metadados->>template", "is", null)
        // Recusado pela Meta não chegou e não foi cobrado.
        .not("metadados->>status_envio", "eq", "failed")
        .order("criado_em", { ascending: false })
        .limit(1),
      supabase
        .from("settings")
        .select("valor")
        .eq("chave", "custo_template_centavos")
        .maybeSingle(),
      // Passos marcados à mão do roteiro de ativação (0065). Tolerante:
      // sem a migração, a seção some do painel em vez de quebrá-lo.
      supabase
        .from("ativacao_checklist")
        .select("passo, feito_em, autor:profiles(nome)")
        .eq("lead_id", leadId),
      // 1ª operação = primeiro lote da vida (definição canônica da Fase 2).
      l.customer_id
        ? supabase
            .from("customer_lots")
            .select("referencia_data")
            .eq("customer_id", l.customer_id)
            .order("referencia_data", { ascending: true })
            .limit(1)
            .maybeSingle()
        : Promise.resolve({ data: null, error: null }),
    ]);

  const giro = giroR.data as {
    lotes_30d: number | null;
    lotes_30d_anterior: number | null;
    ultimo_giro_em: string | null;
  } | null;
  const receita = receitaR.data as {
    receita_30d_centavos: number | null;
    ltv_centavos: number | null;
  } | null;

  return {
    telefone: l.telefone_e164,
    email: l.email,
    criadoEm: l.criado_em,
    primeiraRespostaEm: l.primeira_resposta_em,
    entradaMotivo: l.entrada_motivo,
    campanha: l.campanha ?? l.utm_campaign,
    canal: l.canal?.nome ?? null,
    observacao: l.observacao,
    responsavelNome: l.responsavel?.nome ?? null,
    etapaNome: l.etapa?.nome ?? null,
    cliente: l.customer
      ? {
          nome: l.customer.nome_completo,
          contaAbertaEm: l.customer.conta_aberta_em,
          lotes30d: giro?.lotes_30d ?? null,
          lotes30dAnterior: giro?.lotes_30d_anterior ?? null,
          ultimoGiroEm: giro?.ultimo_giro_em ?? null,
          receita30dCentavos: receita?.receita_30d_centavos ?? null,
          ltvCentavos: receita?.ltv_centavos ?? null,
        }
      : null,
    templates: (() => {
      const total = templatesR.error ? 0 : (templatesR.count ?? 0);
      const ultimo = (templatesR.data ?? [])[0] as
        | { criado_em: string; metadados: { template?: string | null } | null }
        | undefined;
      const taxa = Number(custoR.data?.valor ?? 0) || 0;
      return {
        total,
        ultimoEm: ultimo?.criado_em ?? null,
        ultimoNome: ultimo?.metadados?.template ?? null,
        custoCentavos: taxa > 0 ? total * taxa : null,
      };
    })(),
    tarefas: (
      (tarefasR.data ?? []) as {
        id: string;
        titulo: string;
        vence_em: string;
      }[]
    ).map((t) => ({
      id: t.id,
      titulo: t.titulo,
      venceEm: t.vence_em,
      vencida: Date.parse(t.vence_em) < agora,
    })),
    tarefasDisponiveis: tarefasR.error === null,
    ativacao: (() => {
      if (checklistR.error) return null; // banco ainda sem a 0065
      const marcados = new Map(
        (
          (checklistR.data ?? []) as unknown as {
            passo: string;
            feito_em: string;
            autor: { nome: string } | null;
          }[]
        ).map((m) => [m.passo, m]),
      );
      // Mostra para quem está no funil de ativação — cliente vinculado,
      // etapa Ativação, ganho, ou qualquer passo já marcado. Lead da caixa
      // comum não precisa de mais um cartão.
      const seAplica =
        l.customer_id !== null ||
        l.status === "ganho" ||
        l.etapa?.nome === "Ativação" ||
        marcados.size > 0;
      if (!seAplica) return null;

      const primeiroLote =
        (loteR.data as { referencia_data: string } | null)?.referencia_data ??
        null;
      return PASSOS_ATIVACAO.map((def) => {
        // Os automáticos vêm dos fatos e vencem qualquer marcação manual.
        const fato =
          def.passo === "conta_aprovada"
            ? (l.customer?.conta_aberta_em ?? null)
            : def.passo === "primeira_operacao"
              ? primeiroLote
              : null;
        // Automático SÓ acredita no fato: linha manual (inserida por fora)
        // não pode pintar de feito o que a Genial ainda não confirmou.
        const manual = def.auto ? undefined : marcados.get(def.passo);
        return {
          passo: def.passo,
          rotulo: def.rotulo,
          feitoEm: def.auto ? fato : (manual?.feito_em ?? null),
          autor: def.auto
            ? fato
              ? "Genial"
              : null
            : (manual?.autor?.nome ?? null),
          automatico: def.auto,
        };
      });
    })(),
  };
}

/**
 * Marca ou desmarca um passo do roteiro de ativação. Os passos automáticos
 * (conta aprovada, 1ª operação) não passam por aqui — nascem dos fatos.
 */
export async function alternarPassoAtivacao(
  leadId: string,
  passo: string,
  feito: boolean,
): Promise<{ ok?: true; erro?: string }> {
  const perfil = await perfilAtual();
  if (!perfil) return { erro: "Sessão expirada. Entre novamente." };
  if (!ehPassoAtivacao(passo)) return { erro: "Passo desconhecido." };
  const def = PASSOS_ATIVACAO.find((d) => d.passo === passo);
  if (def?.auto) {
    return { erro: "Este passo é marcado pela importação da Genial." };
  }

  const supabase = await createClient();
  if (feito) {
    const { error } = await supabase.from("ativacao_checklist").upsert({
      lead_id: leadId,
      passo,
      feito_em: new Date().toISOString(),
      autor_id: perfil.id,
    });
    if (error) {
      return {
        erro:
          // O PostgREST atual devolve PGRST205 (schema cache) para tabela
          // ausente — o 42P01 clássico só chega em corrida de cache.
          error.code === "42P01" || error.code === "PGRST205"
            ? "Banco ainda sem a 0065 — rode a migração do checklist."
            : "Não deu para marcar o passo. Tente de novo.",
      };
    }
  } else {
    const { error } = await supabase
      .from("ativacao_checklist")
      .delete()
      .eq("lead_id", leadId)
      .eq("passo", passo);
    if (error) return { erro: "Não deu para desmarcar o passo." };
  }
  return { ok: true };
}
