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
