"use server";

import { revalidatePath } from "next/cache";
import { createClient } from "@/lib/supabase/server";
import { perfilQueEscreve, perfilAtual } from "@/lib/auth";
import { registrarAcesso } from "@/lib/auditoria";
import { templateBloqueadoAte } from "@/lib/perda";

export type ResultadoAcao = { ok?: boolean; erro?: string };

/**
 * Conclui uma tarefa a partir da fila do dia. É o mesmo update da action do
 * chat, mas com revalidação da própria /hoje — a action de lá não sabe que
 * esta tela existe, e a tarefa concluída ficaria pendurada na fila.
 */
export async function concluirTarefaHoje(
  tarefaId: string,
  leadId: string,
): Promise<ResultadoAcao> {
  const perfil = await perfilQueEscreve();
  if (!perfil)
    return {
      erro: "Sem permissão para alterar (perfil somente leitura) — ou a sessão expirou.",
    };
  if (!tarefaId) return { erro: "Tarefa não informada." };

  const supabase = await createClient();
  const { error } = await supabase
    .from("lead_tasks")
    .update({ concluida_em: new Date().toISOString() })
    .eq("id", tarefaId);
  if (error) return { erro: error.message };

  revalidatePath("/hoje");
  revalidatePath("/agenda");
  if (leadId) revalidatePath(`/leads/${leadId}`);
  return { ok: true };
}

// ═══════════════════════ Fase 5: soneca e painel ═══════════════════════

import { adiarConversa } from "@/app/(app)/chat/actions";
import { agoraEmBrasilia } from "@/lib/format";
import {
  listarTemplatesMeta,
  metaConfigurada,
  type TemplateWhatsapp,
} from "@/lib/whatsapp";
import type { Mensagem, MensagemPadrao } from "@/app/(app)/chat/janela";

/** Amanhã de manhã (7h de Brasília) — quando a soneca devolve o item. */
function amanhaDeManha(): string {
  const hoje = agoraEmBrasilia();
  const d = new Date(`${hoje.dia}T07:00:00-03:00`);
  d.setDate(d.getDate() + 1);
  return d.toISOString();
}

/**
 * Soneca de item que NÃO é conversa (ativação, risco): esconde da fila da
 * pessoa até amanhã de manhã, sem tocar no lead nem nos motores.
 */
export async function sonecarItem(
  tipo: "ativacao" | "risco",
  alvo: string,
  pessoa: string,
): Promise<{ ok?: boolean; erro?: string }> {
  const supabase = await createClient();
  const { error } = await supabase.from("hoje_soneca").upsert({
    pessoa,
    tipo,
    alvo,
    ate: amanhaDeManha(),
  });
  if (error) {
    return {
      erro:
        error.code === "42P01"
          ? "Rode a migração 0049 para a soneca funcionar."
          : "Não deu para sonecar agora.",
    };
  }
  revalidatePath("/hoje");
  return { ok: true };
}

/** Soneca de conversa: usa o adiar-com-prazo que já existe no chat. */
export async function sonecarConversa(
  leadId: string,
): Promise<{ ok?: boolean; erro?: string }> {
  const resultado = await adiarConversa(leadId, "amanha");
  revalidatePath("/hoje");
  return resultado?.erro ? { erro: resultado.erro } : { ok: true };
}

export type FerramentasDaConversa = {
  etapaId: string | null;
  responsavelId: string | null;
  etapas: { id: string; nome: string }[];
  equipe: { id: string; nome: string }[];
  etiquetas: { id: string; nome: string; cor: string | null }[];
  etiquetasLead: string[];
  leadPerdido: boolean;
  /** Resolver tira a conversa da Caixa; sem isto o palco não tinha como
   *  oferecer a volta, e o gesto virava um caminho sem retorno. */
  conversaResolvida: boolean;
};

export type ConversaDoPainel = {
  nome: string;
  temConversa: boolean;
  mensagens: Mensagem[];
  mensagensPadrao: MensagemPadrao[];
  templates: TemplateWhatsapp[];
  restanteJanela: number | null;
  marketingBloqueado: boolean;
  /** Lead perdido há menos de 30 dias: sem template até esta data (ISO). */
  templateBloqueadoAte: string | null;
  hojeChave: string;
  ontemChave: string;
  /** O que o menu "⋯" do palco (/conversas, Bloco B) precisa. Opcional:
   *  bancos sem alguma migração degradam sem quebrar o painel da /hoje. */
  ferramentas?: FerramentasDaConversa;
};

/** A linha crua de lead_interactions, como o PostgREST devolve. */
type LinhaBrutaInteracao = {
  id: string;
  tipo: Mensagem["tipo"];
  conteudo: string | null;
  criado_em: string;
  metadados: {
    anexos?: {
      tipo?: string | null;
      nome?: string | null;
      url?: string | null;
    }[];
    status_envio?: string | null;
    erro_envio?: string | null;
    sistema?: boolean | null;
    via?: string | null;
    campanha?: string | null;
  } | null;
  autor: { nome: string } | null;
};

/** Linha do banco → bolha da Janela. */
function paraMensagem(m: LinhaBrutaInteracao): Mensagem {
  return {
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
    metadados: m.metadados
      ? {
          sistema: m.metadados.sistema === true,
          via: m.metadados.via ?? null,
          campanha: m.metadados.campanha ?? null,
        }
      : null,
  };
}

/**
 * Carrega o necessário para a Janela do chat abrir dentro da /hoje — a
 * mesma conversa, sem sair da fila.
 */
export async function carregarConversa(
  leadId: string,
  opcoes: { registrarAcesso?: boolean } = {},
): Promise<ConversaDoPainel | { erro: string }> {
  const perfil = await perfilAtual();
  if (!perfil) return { erro: "Sessão expirada." };

  const supabase = await createClient();
  const [
    leadR,
    { data: interacoes },
    padroesR,
    templates,
    etapasR,
    equipeR,
    etiquetasR,
    vinculosR,
  ] = await Promise.all([
    (async () => {
      const cheio = await supabase
        .from("leads")
        .select(
          "id, nome, ultima_interacao_em, marketing_bloqueado_em, status, perdido_em, stage_id, responsavel_id, chat_resolvido_em",
        )
        .eq("id", leadId)
        .maybeSingle();
      // Coluna ausente (banco sem alguma migração): a conversa continua
      // abrindo com o essencial, e o menu "⋯" some — melhor sem menu do que
      // com um menu mostrando etapa/atendente vazios que não são verdade.
      if (cheio.error) {
        const minimo = await supabase
          .from("leads")
          .select("id, nome, ultima_interacao_em, marketing_bloqueado_em")
          .eq("id", leadId)
          .maybeSingle();
        return { ...minimo, degradado: true };
      }
      return { ...cheio, degradado: false };
    })(),
    supabase
      .from("lead_interactions")
      .select("id, tipo, conteudo, criado_em, metadados, autor:profiles(nome)")
      .eq("lead_id", leadId)
      .in("tipo", ["mensagem_recebida", "mensagem_enviada", "nota"])
      .order("criado_em", { ascending: false })
      .limit(200),
    // Anexos das prontas (0060); sem a migração, formato antigo.
    supabase
      .from("quick_replies")
      .select("id, titulo, corpo, anexos")
      .eq("ativo", true)
      .order("titulo")
      .then((r) =>
        r.error
          ? supabase
              .from("quick_replies")
              .select("id, titulo, corpo")
              .eq("ativo", true)
              .order("titulo")
          : r,
      ),
    // Sem a Meta configurada a janela abre sem templates — enviar avisa lá.
    (metaConfigurada()
      ? listarTemplatesMeta()
      : Promise.resolve([] as TemplateWhatsapp[])
    ).catch(() => [] as TemplateWhatsapp[]),
    supabase
      .from("pipeline_stages")
      .select("id, nome, pipeline:pipelines!inner(padrao)")
      .eq("pipeline.padrao", true)
      .order("ordem"),
    supabase
      .from("profiles")
      .select("id, nome")
      .eq("ativo", true)
      .order("nome"),
    supabase
      .from("tags")
      .select("id, nome, cor")
      .eq("ativo", true)
      .order("nome"),
    supabase.from("lead_tags").select("tag_id").eq("lead_id", leadId),
  ]);
  const lead = leadR.data as {
    id: string;
    nome: string;
    ultima_interacao_em: string | null;
    marketing_bloqueado_em: string | null;
    status?: string;
    perdido_em?: string | null;
    stage_id?: string | null;
    responsavel_id?: string | null;
  } | null;
  const padroes = padroesR.data;

  // O menu "⋯" só aparece se TODAS as consultas que o alimentam vieram —
  // uma delas falhando (migração faltando, RLS) devolveria um menu com
  // listas vazias, que o atendente lê como "não há etapa/etiqueta".
  const ferramentasIntegras =
    !leadR.degradado &&
    !etapasR.error &&
    !equipeR.error &&
    !etiquetasR.error &&
    !vinculosR.error;
  const etapas = etapasR.data;
  const equipe = equipeR.data;
  const etiquetas = etiquetasR.data;
  const vinculos = vinculosR.data;

  if (!lead) return { erro: "Lead não encontrado." };
  // Só a ABERTURA da conversa entra no log — recarga periódica e volta de
  // aba não são "alguém olhou". E só depois de o RLS confirmar que a
  // pessoa enxerga o lead: tentativa fora do alcance não vira "abriu".
  if (opcoes.registrarAcesso) {
    registrarAcesso(perfil.id, "abriu_conversa", {
      lead_id: leadId,
      nome: lead.nome,
    });
  }

  const mensagens: Mensagem[] = (
    (interacoes ?? []) as unknown as LinhaBrutaInteracao[]
  )
    .map(paraMensagem)
    .reverse();

  const ultimaRecebida = [...mensagens]
    .reverse()
    .find((m) => m.tipo === "mensagem_recebida");
  const restanteJanela = ultimaRecebida
    ? new Date(ultimaRecebida.criado_em).getTime() +
      24 * 3600 * 1000 -
      Date.now()
    : null;

  const formatoDia = new Intl.DateTimeFormat("pt-BR", {
    timeZone: "America/Sao_Paulo",
  });

  return {
    nome: lead.nome,
    temConversa: mensagens.length > 0 || lead.ultima_interacao_em !== null,
    mensagens,
    mensagensPadrao: (padroes ?? []) as MensagemPadrao[],
    templates,
    restanteJanela,
    marketingBloqueado: lead.marketing_bloqueado_em !== null,
    templateBloqueadoAte: templateBloqueadoAte(lead.status, lead.perdido_em),
    hojeChave: formatoDia.format(new Date()),
    ontemChave: formatoDia.format(new Date(Date.now() - 86_400_000)),
    // Sem os dados completos o menu "⋯" não tem como dizer a verdade sobre
    // etapa/atendente/etiquetas — some, e o palco cai no link da tela antiga.
    ferramentas: !ferramentasIntegras
      ? undefined
      : {
          etapaId: lead.stage_id ?? null,
          responsavelId: lead.responsavel_id ?? null,
          etapas: ((etapas ?? []) as { id: string; nome: string }[]).map(
            (e) => ({ id: e.id, nome: e.nome }),
          ),
          equipe: (equipe ?? []) as { id: string; nome: string }[],
          etiquetas: (etiquetas ?? []) as {
            id: string;
            nome: string;
            cor: string | null;
          }[],
          etiquetasLead: ((vinculos ?? []) as { tag_id: string }[]).map(
            (v) => v.tag_id,
          ),
          leadPerdido: lead.status === "perdido",
          conversaResolvida: Boolean(
            (lead as { chat_resolvido_em?: string | null }).chat_resolvido_em,
          ),
        },
  };
}

/**
 * As mensagens ANTERIORES às que já estão na tela. A conversa abre com as
 * 200 últimas (o que cobre quase tudo); em cliente antigo, é por aqui que
 * o atendente alcança o começo da história.
 */
export async function carregarMensagensAnteriores(
  leadId: string,
  antesDeIso: string,
): Promise<{ mensagens: Mensagem[]; temMais: boolean } | { erro: string }> {
  const perfil = await perfilAtual();
  if (!perfil) return { erro: "Sessão expirada." };
  if (!leadId || !antesDeIso) return { erro: "Conversa não informada." };

  const LOTE = 100;
  const supabase = await createClient();
  const { data, error } = await supabase
    .from("lead_interactions")
    .select("id, tipo, conteudo, criado_em, metadados, autor:profiles(nome)")
    .eq("lead_id", leadId)
    .in("tipo", ["mensagem_recebida", "mensagem_enviada", "nota"])
    .lt("criado_em", antesDeIso)
    .order("criado_em", { ascending: false })
    .limit(LOTE);
  if (error) return { erro: "Não deu para carregar o histórico." };

  const linhas = (data ?? []) as unknown as LinhaBrutaInteracao[];
  return {
    mensagens: linhas.map(paraMensagem).reverse(),
    temMais: linhas.length === LOTE,
  };
}
