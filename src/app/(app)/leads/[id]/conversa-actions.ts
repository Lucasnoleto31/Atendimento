"use server";

import { revalidatePath } from "next/cache";
import { createClient, createServiceClient } from "@/lib/supabase/server";
import { perfilAtual } from "@/lib/auth";
import { enviarMensagem } from "@/lib/chatwoot";

export type ResultadoEnvio = { ok?: boolean; erro?: string };

export async function enviarMensagemLead(
  _estado: ResultadoEnvio,
  formData: FormData,
): Promise<ResultadoEnvio> {
  const perfil = await perfilAtual();
  if (!perfil) return { erro: "Sessão expirada. Entre novamente." };

  const leadId = String(formData.get("lead_id") ?? "");
  const texto = String(formData.get("texto") ?? "").trim();

  if (!leadId) return { erro: "Lead não informado." };
  if (!texto) return { erro: "Escreva a mensagem." };
  if (texto.length > 4096) return { erro: "Mensagem longa demais." };

  const supabase = await createClient();
  const { data: lead } = await supabase
    .from("leads")
    .select("id, chatwoot_conversation_id")
    .eq("id", leadId)
    .maybeSingle();

  if (!lead) return { erro: "Lead não encontrado." };
  if (!lead.chatwoot_conversation_id) {
    return {
      erro: "Este lead não tem conversa vinculada no Chatwoot — ele precisa mandar a primeira mensagem no WhatsApp.",
    };
  }

  let mensagemId: number | null = null;
  try {
    const resposta = await enviarMensagem(lead.chatwoot_conversation_id, texto);
    mensagemId = resposta?.id ?? null;
  } catch (e) {
    return {
      erro: `O Chatwoot recusou o envio: ${e instanceof Error ? e.message : String(e)}. Fora da janela de 24h só template aprovado chega — dispare pelo Chatwoot nesse caso.`,
    };
  }

  const agora = new Date().toISOString();
  const service = createServiceClient();

  // Registra ANTES do eco do webhook e o marca como processado — assim a
  // mensagem não entra duas vezes no histórico.
  if (mensagemId !== null) {
    await service.from("webhook_events").insert({
      origem: "chatwoot",
      evento_id: `cw-msg-${mensagemId}`,
      payload: { via: "crm", lead_id: leadId },
      processado: true,
    });
  }

  await supabase.from("lead_interactions").insert({
    lead_id: leadId,
    tipo: "mensagem_enviada",
    conteudo: texto,
    autor_id: perfil.id,
    metadados: {
      chatwoot_message_id: mensagemId,
      chatwoot_conversation_id: lead.chatwoot_conversation_id,
      via: "crm",
    },
  });

  await supabase
    .from("leads")
    .update({ ultima_interacao_em: agora })
    .eq("id", leadId);

  revalidatePath(`/leads/${leadId}`);
  return { ok: true };
}
