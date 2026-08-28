import { createServiceClient } from "@/lib/supabase/server";
import { enviarTextoMeta, metaConfigurada } from "@/lib/whatsapp";

const INTERVALO_MIN_MS = 10_000;
let ultimaVarredura = 0;

/**
 * Processa as mensagens agendadas vencidas. Roda no heartbeat do chat
 * (a cada ~10s) e no cron — a consulta é indexada e barata quando não há
 * nada pendente. Cada linha é tentada uma vez: sucesso ou falha, ganha
 * enviado_em (a falha fica registrada em `erro`, visível no compositor).
 */
export async function processarAgendadas(): Promise<number> {
  if (Date.now() - ultimaVarredura < INTERVALO_MIN_MS) return 0;
  ultimaVarredura = Date.now();

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

    // Na Meta o destino é o telefone do lead — o "thread" é o próprio número.
    const { data: lead } = await service
      .from("leads")
      .select("telefone_e164")
      .eq("id", agendada.lead_id)
      .maybeSingle();

    if (!lead?.telefone_e164) {
      await service
        .from("scheduled_messages")
        .update({ erro: "Lead sem telefone na hora do envio." })
        .eq("id", agendada.id);
      continue;
    }

    // Canal único: sem a Meta configurada a linha ganha erro claro (visível
    // no compositor) em vez de estourar com mensagem de ambiente.
    if (!metaConfigurada()) {
      await service
        .from("scheduled_messages")
        .update({ erro: "WhatsApp (Meta) não configurado." })
        .eq("id", agendada.id);
      continue;
    }

    try {
      const idMensagem = await enviarTextoMeta(
        lead.telefone_e164,
        agendada.texto,
      );

      await service.from("lead_interactions").insert({
        lead_id: agendada.lead_id,
        tipo: "mensagem_enviada",
        conteudo: agendada.texto,
        autor_id: agendada.autor_id,
        metadados: {
          message_id: idMensagem,
          via: "agendada",
        },
      });

      await service
        .from("leads")
        // Só ultima_interacao_em: robô não "lê" a conversa — marcar lida aqui
        // apagava o não-lida de mensagem do cliente que ninguém viu.
        .update({ ultima_interacao_em: agora })
        .eq("id", agendada.lead_id);

      enviadas++;
    } catch (e) {
      await service
        .from("scheduled_messages")
        .update({
          erro: `A Meta recusou: ${e instanceof Error ? e.message : String(e)}. Fora da janela de 24h só template chega.`,
        })
        .eq("id", agendada.id);
    }
  }

  return enviadas;
}
