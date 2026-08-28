"use server";

import { revalidatePath } from "next/cache";
import { createClient } from "@/lib/supabase/server";
import { ehMotivoPerda } from "@/lib/perda";

export type ResultadoMover = { erro?: string };

/**
 * Move o lead para outra etapa. O gatilho handle_stage_change registra a
 * mudança em lead_interactions e reinicia o relógio da coluna.
 *
 * Coluna final (Perdido) não passa por aqui: o quadro abre o diálogo de
 * motivo e chama marcarPerdido — perder sem dizer por quê deixaria o
 * relatório de perdas cego de novo.
 */
export async function moverLead(
  leadId: string,
  stageId: string,
): Promise<ResultadoMover> {
  const supabase = await createClient();

  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) {
    return { erro: "Sessão expirada. Entre novamente." };
  }

  const { error } = await supabase
    .from("leads")
    .update({ stage_id: stageId })
    .eq("id", leadId);

  if (error) {
    return { erro: "Não foi possível mover o lead." };
  }

  // Card saindo de Perdido volta ao atendimento: o gatilho da 0038 limpa
  // motivo e carimbo sozinho. Ganho fica ganho — coluna não desfaz conta
  // aberta. Sem a 0038 este update é inofensivo (só mexe no status).
  await supabase
    .from("leads")
    .update({ status: "em_atendimento" })
    .eq("id", leadId)
    .eq("status", "perdido");

  revalidatePath("/atendimento");
  return {};
}

/**
 * Perde o lead com motivo: move para a etapa final E marca o status — antes
 * o card ia para a coluna Perdido com o status ainda vivo, e o kanban e o
 * relatório contavam histórias diferentes.
 */
export async function marcarPerdido(
  leadId: string,
  stageId: string,
  motivo: string,
  detalhe: string,
): Promise<ResultadoMover> {
  const supabase = await createClient();

  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) {
    return { erro: "Sessão expirada. Entre novamente." };
  }
  if (!ehMotivoPerda(motivo)) {
    return { erro: "Escolha o motivo da perda." };
  }

  const texto = detalhe.trim().slice(0, 280);
  const { error } = await supabase
    .from("leads")
    .update({
      stage_id: stageId,
      status: "perdido",
      perda_motivo: motivo,
      perda_detalhe: texto || null,
    })
    .eq("id", leadId);

  if (error) {
    // Banco ainda sem a 0038: perde do jeito antigo em vez de travar a mesa.
    if (error.code === "42703") {
      const { error: erroSimples } = await supabase
        .from("leads")
        .update({ stage_id: stageId, status: "perdido" })
        .eq("id", leadId);
      if (erroSimples) return { erro: "Não foi possível mover o lead." };
      revalidatePath("/atendimento");
      return {};
    }
    return { erro: "Não foi possível marcar a perda." };
  }

  revalidatePath("/atendimento");
  revalidatePath("/leads");
  return {};
}

/**
 * Tarefa rápida a partir do cartão do kanban — sem sair do quadro. O dono é
 * o responsável do lead (quem vai executá-la), não quem clicou.
 */
export async function criarTarefaRapida(
  leadId: string,
  titulo: string,
  venceEmIso: string,
): Promise<ResultadoMover> {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return { erro: "Sessão expirada. Entre novamente." };

  const limpo = titulo.trim().slice(0, 120);
  if (!limpo) return { erro: "Dê um título à tarefa." };
  const vence = new Date(venceEmIso);
  if (Number.isNaN(vence.getTime())) return { erro: "Prazo inválido." };

  const { data: lead } = await supabase
    .from("leads")
    .select("responsavel_id")
    .eq("id", leadId)
    .maybeSingle();

  const { error } = await supabase.from("lead_tasks").insert({
    lead_id: leadId,
    titulo: limpo,
    vence_em: vence.toISOString(),
    autor_id: user.id,
    responsavel_id: lead?.responsavel_id ?? user.id,
  });
  if (error) return { erro: "Não deu para criar a tarefa." };

  revalidatePath("/atendimento");
  revalidatePath("/hoje");
  revalidatePath("/agenda");
  return {};
}
