"use server";

import { createClient } from "@/lib/supabase/server";
import { perfilAtual } from "@/lib/auth";

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
 *   tudo       — o acervo, com busca e filtros finos.
 */

export type VisaoConversas = "caixa" | "aguardando" | "adiadas" | "tudo";

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
  etiquetaNome: string | null;
  sub: string | null;
};

export type Contagens = { caixa: number; aguardando: number; adiadas: number };

export type CargaConversas = {
  linhas: LinhaConversa[];
  contagens: Contagens;
  temMais: boolean;
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
  return ((partes[0]?.[0] ?? "") + (partes[1]?.[0] ?? "")).toUpperCase() || null;
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
      return (b.ultima_mensagem_em ?? "").localeCompare(a.ultima_mensagem_em ?? "");
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
      if (busca) q = q.or(`nome.ilike.%${busca}%,telefone_e164.ilike.%${busca}%`);
      if (comPrazo) {
        q = q
          .gte("chat_adiado_ate", new Date().toISOString())
          .order("chat_adiado_ate", { ascending: true });
      } else {
        q = q
          .gte("chat_adiado_em", new Date(Date.now() - 3 * 86_400_000).toISOString())
          .order("chat_adiado_em", { ascending: false });
      }
      return q.range(offset, offset + PAGINA - 1);
    };
    let adiadasR = await montarAdiadas(true);
    if (adiadasR.error) adiadasR = await montarAdiadas(false);
    if (adiadasR.error) return { erro: adiadasR.error.message };
    const idsAdiadas = ((adiadasR.data ?? []) as { id: string }[]).map((l) => l.id);
    if (idsAdiadas.length > 0) {
      const { data, error } = await supabase
        .from("v_leads_listas")
        .select(CAMPOS_VIEW)
        .in("lead_id", idsAdiadas);
      if (error) return { erro: error.message };
      const porId = new Map(((data ?? []) as LinhaView[]).map((l) => [l.lead_id, l]));
      linhasView = idsAdiadas
        .map((id) => porId.get(id))
        .filter((l): l is LinhaView => Boolean(l));
    }
    temMais = idsAdiadas.length === PAGINA;
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

  // Enriquecimento em paralelo: colunas de leads que a view não expõe,
  // prévia da última mensagem (RPC 0045) e as três contagens do trilho.
  const [extrasR, previasR, ctCaixaAbertas, ctCaixaVencidas, ctAguardando, ctAdiadas] =
    await Promise.all([
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
                .select("id, instagram_usuario, chat_lido_em, chat_adiado_em, chat_resolvido_em")
                .in("id", ids);
            }
            return cheio;
          })()
        : Promise.resolve({ data: [] as ExtrasLead[], error: null }),
      ids.length > 0
        ? supabase.rpc("previas_conversas", { p_lead_ids: ids })
        : Promise.resolve({ data: [], error: null }),
      base().select("lead_id", { count: "exact", head: true })
        .eq("em_aberto", true)
        .not("ultima_mensagem_em", "is", null),
      base().select("lead_id", { count: "exact", head: true }).eq("adiado_vencido", true),
      base().select("lead_id", { count: "exact", head: true }).eq("aguardando_resposta", true),
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
          if (comPrazo) q = q.gte("chat_adiado_ate", new Date().toISOString());
          else
            q = q.gte(
              "chat_adiado_em",
              new Date(Date.now() - 3 * 86_400_000).toISOString(),
            );
          return q;
        };
        const cheio = await montar(true);
        return cheio.error ? montar(false) : cheio;
      })(),
    ]);

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
      etiquetaNome: l.etiquetas?.[0] ?? null,
      sub: adiadaVencida
        ? "adiada · prazo venceu"
        : l.etiquetas?.includes("Stand-by")
          ? "Stand-by"
          : null,
    };
  });

  return {
    linhas,
    contagens: {
      caixa: (ctCaixaAbertas.count ?? 0) + (ctCaixaVencidas.count ?? 0),
      aguardando: ctAguardando.count ?? 0,
      adiadas: ctAdiadas.count ?? 0,
    },
    temMais,
  };
}
