import { createServiceClient } from "@/lib/supabase/server";
import { enviarMensagem } from "@/lib/chatwoot";

/**
 * Processa as mensagens agendadas vencidas. Roda no heartbeat do chat
 * (a cada ~10s) e no cron — a consulta é indexada e barata quando não há
 * nada pendente. Cada linha é tentada uma vez: sucesso ou falha, ganha
 * enviado_em (a falha fica registrada em `erro`, visível no compositor).
 */
export async function processarAgendadas(): Promise<number> {
  const service = createServiceClient();
  const agora = new Date().toISOString();

  const { data, error } = await service
    .from("scheduled_messages")
    .select("id, lead_id, texto, autor_id")
    .is("enviado_em", null)
    .lte("enviar_em", agora)
    .order("enviar_em")
    .limit(10);

  // Tabela ausente (migração 0014 não rodou) ou nada vencido.
  if (error || !data || data.length === 0) return 0;

  let enviadas = 0;

  for (const agendada of data as {
    id: string;
    lead_id: string;
    texto: string;
    autor_id: string | null;
  }[]) {
    // Reserva a linha antes de enviar: mesmo com heartbeat e cron juntos,
    // só quem gravar enviado_em primeiro (linha ainda nula) processa.
    const { data: reservada } = await service
      .from("scheduled_messages")
      .update({ enviado_em: agora })
      .eq("id", agendada.id)
      .is("enviado_em", null)
      .select("id")
      .maybeSingle();
    if (!reservada) continue;

    const { data: lead } = await service
      .from("leads")
      .select("chatwoot_conversation_id")
      .eq("id", agendada.lead_id)
      .maybeSingle();

    if (!lead?.chatwoot_conversation_id) {
      await service
        .from("scheduled_messages")
        .update({ erro: "Lead sem conversa vinculada na hora do envio." })
        .eq("id", agendada.id);
      continue;
    }

    try {
      const resposta = await enviarMensagem(
        lead.chatwoot_conversation_id,
        agendada.texto,
      );

      if (resposta?.id) {
        await service.from("webhook_events").insert({
          origem: "chatwoot",
          evento_id: `cw-msg-${resposta.id}`,
          payload: { via: "agendada", lead_id: agendada.lead_id },
          processado: true,
        });
      }

      await service.from("lead_interactions").insert({
        lead_id: agendada.lead_id,
        tipo: "mensagem_enviada",
        conteudo: agendada.texto,
        autor_id: agendada.autor_id,
        metadados: {
          chatwoot_message_id: resposta?.id ?? null,
          via: "agendada",
        },
      });

      await service
        .from("leads")
        .update({ ultima_interacao_em: agora, chat_lido_em: agora })
        .eq("id", agendada.lead_id);

      enviadas++;
    } catch (e) {
      await service
        .from("scheduled_messages")
        .update({
          erro: `O Chatwoot recusou: ${e instanceof Error ? e.message : String(e)}. Fora da janela de 24h só template chega.`,
        })
        .eq("id", agendada.id);
    }
  }

  return enviadas;
}
