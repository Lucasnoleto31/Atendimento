"use server";

import { revalidatePath } from "next/cache";
import { createClient } from "@/lib/supabase/server";
import { perfilAtual } from "@/lib/auth";

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
  const perfil = await perfilAtual();
  if (!perfil) return { erro: "Sessão expirada. Entre novamente." };
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
import { listarTemplatesCanal } from "@/lib/canal";
import { agoraEmBrasilia } from "@/lib/format";
import type { TemplateWhatsapp } from "@/lib/chatwoot";
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

export type ConversaDoPainel = {
  nome: string;
  temConversa: boolean;
  mensagens: Mensagem[];
  mensagensPadrao: MensagemPadrao[];
  templates: TemplateWhatsapp[];
  restanteJanela: number | null;
  marketingBloqueado: boolean;
  hojeChave: string;
  ontemChave: string;
};

/**
 * Carrega o necessário para a Janela do chat abrir dentro da /hoje — a
 * mesma conversa, sem sair da fila.
 */
export async function carregarConversa(
  leadId: string,
): Promise<ConversaDoPainel | { erro: string }> {
  const perfil = await perfilAtual();
  if (!perfil) return { erro: "Sessão expirada." };

  const supabase = await createClient();
  const [{ data: lead }, { data: interacoes }, { data: padroes }, templates] =
    await Promise.all([
      supabase
        .from("leads")
        .select("id, nome, ultima_interacao_em, marketing_bloqueado_em")
        .eq("id", leadId)
        .maybeSingle(),
      supabase
        .from("lead_interactions")
        .select(
          "id, tipo, conteudo, criado_em, metadados, autor:profiles(nome)",
        )
        .eq("lead_id", leadId)
        .in("tipo", ["mensagem_recebida", "mensagem_enviada", "nota"])
        .order("criado_em", { ascending: false })
        .limit(200),
      supabase
        .from("quick_replies")
        .select("id, titulo, corpo")
        .order("titulo"),
      listarTemplatesCanal().catch(() => [] as TemplateWhatsapp[]),
    ]);

  if (!lead) return { erro: "Lead não encontrado." };

  type LinhaBruta = {
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
  };

  const mensagens: Mensagem[] = ((interacoes ?? []) as unknown as LinhaBruta[])
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
      metadados: m.metadados
        ? {
            sistema: m.metadados.sistema === true,
            via: m.metadados.via ?? null,
            campanha: m.metadados.campanha ?? null,
          }
        : null,
    }))
    .reverse();

  const ultimaRecebida = [...mensagens]
    .reverse()
    .find((m) => m.tipo === "mensagem_recebida");
  const restanteJanela = ultimaRecebida
    ? new Date(ultimaRecebida.criado_em).getTime() + 24 * 3600 * 1000 - Date.now()
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
    hojeChave: formatoDia.format(new Date()),
    ontemChave: formatoDia.format(new Date(Date.now() - 86_400_000)),
  };
}
