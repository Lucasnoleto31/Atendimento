import { createServiceClient } from "@/lib/supabase/server";
import { normalizarTelefone } from "@/lib/csv";
import {
  listarConversas,
  listarMensagensConversa,
  type MensagemChatwoot,
} from "@/lib/chatwoot";
import { processarCadencia } from "@/lib/cadencia";
import { processarAgendadas } from "@/lib/agendadas";

/**
 * Sincronização incremental com o Chatwoot, para quando o webhook não
 * alcança este app (desenvolvimento local, ou produção enquanto o webhook
 * aponta para o app antigo). A página do chat chama a cada atualização;
 * o throttle garante no máximo uma varredura a cada 10s por processo.
 *
 * Dedup pelo mesmo registro do webhook (webhook_events, cw-msg-<id>) —
 * webhook, backfill e sync podem rodar juntos sem duplicar nada.
 */

const INTERVALO_MIN_MS = 10_000;
let ultimaSync = 0;

const ROTULO_ANEXO: Record<string, string> = {
  image: "[imagem]",
  audio: "[áudio]",
  video: "[vídeo]",
  file: "[arquivo]",
  location: "[localização]",
  contact: "[contato]",
};

type Service = ReturnType<typeof createServiceClient>;

export async function sincronizarChatwoot(): Promise<void> {
  if (Date.now() - ultimaSync < INTERVALO_MIN_MS) return;
  ultimaSync = Date.now();

  // Carona no heartbeat: cadência e mensagens agendadas andam por aqui.
  processarCadencia().catch(() => {});
  processarAgendadas().catch(() => {});

  const service = createServiceClient();

  const [{ conversas }, { data: equipe }] = await Promise.all([
    listarConversas(1), // as ~20 com atividade mais recente
    service.from("profiles").select("id, email"),
  ]);
  const autorPorEmail = new Map(
    ((equipe ?? []) as { id: string; email: string }[]).map((p) => [
      p.email.toLowerCase(),
      p.id,
    ]),
  );

  for (const conversa of conversas) {
    const telefone = normalizarTelefone(
      conversa.meta.sender?.phone_number ?? "",
    );
    if (!telefone) continue;

    const atividade = new Date(
      (conversa.last_activity_at ?? conversa.created_at) * 1000,
    ).toISOString();

    const { data: lead } = await service
      .from("leads")
      .select(
        "id, status, primeira_resposta_em, ultima_interacao_em, chatwoot_contact_id, chatwoot_conversation_id",
      )
      .eq("telefone_e164", telefone)
      .maybeSingle();

    // Sem novidade para este lead: nada a fazer.
    if (
      lead &&
      lead.chatwoot_conversation_id !== null &&
      lead.ultima_interacao_em !== null &&
      lead.ultima_interacao_em >= atividade
    ) {
      continue;
    }

    let leadId: string;
    if (lead) {
      leadId = lead.id;
    } else {
      const [{ data: canal }, { data: etapa }] = await Promise.all([
        service
          .from("channels")
          .select("id")
          .eq("slug", "whatsapp")
          .maybeSingle(),
        service
          .from("pipeline_stages")
          .select("id, pipeline:pipelines!inner(padrao)")
          .eq("pipeline.padrao", true)
          .order("ordem")
          .limit(1)
          .maybeSingle(),
      ]);

      const { data: novo, error } = await service
        .from("leads")
        .insert({
          nome:
            conversa.meta.sender?.name?.trim() ||
            `WhatsApp ${telefone.slice(-4)}`,
          telefone_e164: telefone,
          channel_id: canal?.id ?? null,
          stage_id: etapa?.id ?? null,
          status: "em_atendimento",
          entrada_motivo: "webhook_meta",
          primeira_resposta_em: atividade,
          ultima_interacao_em: atividade,
          chatwoot_contact_id: conversa.meta.sender?.id ?? null,
          chatwoot_conversation_id: conversa.id,
        })
        .select("id")
        .single();
      if (error || !novo) continue;
      leadId = novo.id;
    }

    const resultado = await gravarUltimasMensagens(
      service,
      leadId,
      conversa.id,
      autorPorEmail,
    );

    await service
      .from("leads")
      .update({
        ultima_interacao_em: atividade,
        chatwoot_contact_id:
          lead?.chatwoot_contact_id ?? conversa.meta.sender?.id ?? null,
        chatwoot_conversation_id: lead?.chatwoot_conversation_id ?? conversa.id,
        ...(resultado.recebeuNova
          ? {
              primeira_resposta_em: lead?.primeira_resposta_em ?? atividade,
              ...(lead?.status === "novo" || lead?.status === "sem_resposta"
                ? { status: "em_atendimento" }
                : {}),
            }
          : {}),
      })
      .eq("id", leadId);
  }
}

/** Grava as mensagens da última página que ainda não temos. */
async function gravarUltimasMensagens(
  service: Service,
  leadId: string,
  conversaId: number,
  autorPorEmail: Map<string, string>,
): Promise<{ recebeuNova: boolean }> {
  const pacote = await listarMensagensConversa(conversaId);
  let recebeuNova = false;

  for (const mensagem of pacote) {
    const gravada = await gravarMensagem(
      service,
      leadId,
      conversaId,
      mensagem,
      autorPorEmail,
    );
    if (gravada && mensagem.message_type === 0) recebeuNova = true;
  }

  return { recebeuNova };
}

async function gravarMensagem(
  service: Service,
  leadId: string,
  conversaId: number,
  mensagem: MensagemChatwoot,
  autorPorEmail: Map<string, string>,
): Promise<boolean> {
  if (!mensagem.id || mensagem.private) return false;

  const tipo =
    mensagem.message_type === 0
      ? "mensagem_recebida"
      : mensagem.message_type === 1 || mensagem.message_type === 3
        ? "mensagem_enviada"
        : null;
  if (!tipo) return false;

  const { error: dupErro } = await service.from("webhook_events").insert({
    origem: "chatwoot",
    evento_id: `cw-msg-${mensagem.id}`,
    payload: { via: "sync", lead_id: leadId },
    processado: true,
  });
  if (dupErro) return false; // já temos (webhook, envio do CRM ou backfill)

  const anexos = (mensagem.attachments ?? []).flatMap((a) =>
    a.data_url ? [{ tipo: a.file_type ?? "file", url: a.data_url }] : [],
  );
  const conteudo =
    mensagem.content?.trim() ||
    (anexos.length > 0
      ? (ROTULO_ANEXO[anexos[0].tipo] ?? "[anexo]")
      : "[mensagem sem texto]");

  const autorId =
    tipo === "mensagem_enviada" && mensagem.sender?.email
      ? (autorPorEmail.get(mensagem.sender.email.toLowerCase()) ?? null)
      : null;

  await service.from("lead_interactions").insert({
    lead_id: leadId,
    tipo,
    conteudo,
    autor_id: autorId,
    criado_em: mensagem.created_at
      ? new Date(mensagem.created_at * 1000).toISOString()
      : undefined,
    metadados: {
      chatwoot_message_id: mensagem.id,
      chatwoot_conversation_id: conversaId,
      via: "sync",
      ...(anexos.length > 0 ? { anexos } : {}),
    },
  });

  return true;
}
