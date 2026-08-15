"use server";

import { revalidatePath } from "next/cache";
import { createClient } from "@/lib/supabase/server";

export type ResultadoMover = { erro?: string };

/**
 * Move o lead para outra etapa. O gatilho handle_stage_change registra a
 * mudança em lead_interactions e reinicia o relógio da coluna.
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

  revalidatePath("/atendimento");
  return {};
}
