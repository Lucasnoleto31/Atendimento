import { NextResponse, type NextRequest } from "next/server";
import { createServiceClient } from "@/lib/supabase/server";
import { normalizarTelefone } from "@/lib/csv";
import { atribuirConversaPorEmail } from "@/lib/chatwoot";
import { escolherVendedor } from "@/lib/distribuicao";

/**
 * Webhook do Chatwoot: mensagem criada lá aparece aqui.
 *
 * O Chatwoot não assina os eventos; a proteção é o token na URL:
 *   /api/webhooks/chatwoot?token=CHATWOOT_WEBHOOK_TOKEN
 *
 * message_created (incoming)  -> lead criado/atualizado + interação recebida
 * message_created (outgoing)  -> interação enviada (atendimento feito no
 *                                próprio Chatwoot também fica no histórico)
 */

type EventoChatwoot = {
  event?: string;
  id?: number;
  content?: string | null;
  message_type?: string | number;
  private?: boolean;
  status?: string;
  content_attributes?: { external_error?: string | null };
  conversation?: {
    id?: number;
    meta?: {
      sender?: {
        id?: number;
        name?: string;
        phone_number?: string | null;
      };
    };
  };
  sender?: {
    id?: number;
    name?: string;
    email?: string | null;
    type?: string;
  };
  attachments?: {
    id?: number;
    file_type?: string | null;
    data_url?: string | null;
  }[];
};

const ROTULO_ANEXO: Record<string, string> = {
  image: "[imagem]",
  audio: "[áudio]",
  video: "[vídeo]",
  file: "[arquivo]",
  location: "[localização]",
  contact: "[contato]",
};

export async function POST(request: NextRequest) {
  const esperado = process.env.CHATWOOT_WEBHOOK_TOKEN;
  if (!esperado || request.nextUrl.searchParams.get("token") !== esperado) {
    return new Response("Forbidden", { status: 403 });
  }

  let evento: EventoChatwoot;
  try {
    evento = (await request.json()) as EventoChatwoot;
  } catch {
    return new Response("Bad request", { status: 400 });
  }

  // Recibo de entrega/leitura/falha: atualiza o status da mensagem enviada.
  if (evento.event === "message_updated" && evento.id && !evento.private) {
    const status = evento.status;
    if (status && ["sent", "delivered", "read", "failed"].includes(status)) {
      const service = createServiceClient();
      const { data: linha } = await service
        .from("lead_interactions")
        .select("id, metadados")
        .eq("metadados->>chatwoot_message_id", String(evento.id))
        .maybeSingle();
      if (linha) {
        await service
          .from("lead_interactions")
          .update({
            metadados: {
              ...((linha.metadados as Record<string, unknown>) ?? {}),
              status_envio: status,
              ...(evento.content_attributes?.external_error
                ? { erro_envio: evento.content_attributes.external_error }
                : {}),
            },
          })
          .eq("id", linha.id);
      }
    }
    return NextResponse.json({ ok: true });
  }

  // Só mensagens públicas nos interessam; notas privadas ficam no Chatwoot.
  if (evento.event !== "message_created" || evento.private) {
    return NextResponse.json({ ok: true });
  }

  const tipo =
    evento.message_type === "incoming" || evento.message_type === 0
      ? "recebida"
      : evento.message_type === "outgoing" || evento.message_type === 1
        ? "enviada"
        : null;
  if (!tipo || !evento.id) {
    return NextResponse.json({ ok: true });
  }

  const service = createServiceClient();

  // Dedup — cobre reenvios do Chatwoot e o eco das mensagens que o próprio
  // CRM enviou (elas são registradas em webhook_events na hora do envio).
  const { error: dupErro } = await service.from("webhook_events").insert({
    origem: "chatwoot",
    evento_id: `cw-msg-${evento.id}`,
    payload: evento as unknown as Record<string, unknown>,
  });
  if (dupErro) {
    return NextResponse.json({ ok: true });
  }

  try {
    await processar(service, evento, tipo);
    await service
      .from("webhook_events")
      .update({ processado: true })
      .eq("origem", "chatwoot")
      .eq("evento_id", `cw-msg-${evento.id}`);
  } catch (e) {
    await service
      .from("webhook_events")
      .update({ erro: e instanceof Error ? e.message : String(e) })
      .eq("origem", "chatwoot")
      .eq("evento_id", `cw-msg-${evento.id}`);
  }

  return NextResponse.json({ ok: true });
}

async function processar(
  service: ReturnType<typeof createServiceClient>,
  evento: EventoChatwoot,
  tipo: "recebida" | "enviada",
) {
  const contato = evento.conversation?.meta?.sender;
  const telefone = normalizarTelefone(contato?.phone_number ?? "");
  const conversaId = evento.conversation?.id ?? null;
  if (!telefone) throw new Error("Evento sem telefone BR válido.");

  // Anexos entram nos metadados; sem texto, o rótulo do primeiro anexo
  // vira a prévia na lista de conversas.
  const anexos = (evento.attachments ?? []).flatMap((a) =>
    a.data_url ? [{ tipo: a.file_type ?? "file", url: a.data_url }] : [],
  );
  const texto =
    evento.content?.trim() ||
    (anexos.length > 0
      ? (ROTULO_ANEXO[anexos[0].tipo] ?? "[anexo]")
      : "[mensagem sem texto]");
  const agora = new Date().toISOString();

  const { data: existente } = await service
    .from("leads")
    .select("id, status, primeira_resposta_em, chatwoot_conversation_id")
    .eq("telefone_e164", telefone)
    .maybeSingle();

  let leadId: string;

  if (existente) {
    leadId = existente.id;
    await service
      .from("leads")
      .update({
        ultima_interacao_em: agora,
        chatwoot_conversation_id:
          existente.chatwoot_conversation_id ?? conversaId,
        ...(tipo === "recebida"
          ? {
              primeira_resposta_em: existente.primeira_resposta_em ?? agora,
              ...(existente.status === "novo" ||
              existente.status === "sem_resposta"
                ? { status: "em_atendimento" }
                : {}),
            }
          : {}),
      })
      .eq("id", leadId);
  } else {
    const [{ data: canal }, { data: etapa }, vendedor] = await Promise.all([
      service.from("channels").select("id").eq("slug", "whatsapp").maybeSingle(),
      service
        .from("pipeline_stages")
        .select("id, pipeline:pipelines!inner(padrao)")
        .eq("pipeline.padrao", true)
        .order("ordem")
        .limit(1)
        .maybeSingle(),
      escolherVendedor(service),
    ]);

    const { data: novo, error } = await service
      .from("leads")
      .insert({
        nome: contato?.name?.trim() || `WhatsApp ${telefone.slice(-4)}`,
        telefone_e164: telefone,
        channel_id: canal?.id ?? null,
        stage_id: etapa?.id ?? null,
        status: "em_atendimento",
        entrada_motivo: "webhook_meta",
        responsavel_id: vendedor?.id ?? null,
        primeira_resposta_em: tipo === "recebida" ? agora : null,
        ultima_interacao_em: agora,
        chatwoot_contact_id: contato?.id ?? null,
        chatwoot_conversation_id: conversaId,
      })
      .select("id")
      .single();

    if (error) throw new Error(error.message);
    leadId = novo.id;

    if (vendedor) {
      await service.from("lead_interactions").insert({
        lead_id: leadId,
        tipo: "atribuicao",
        conteudo: `Atendimento atribuído a ${vendedor.nome} (distribuição automática)`,
        metadados: { via: "distribuicao_automatica" },
      });
      if (conversaId) {
        try {
          await atribuirConversaPorEmail(conversaId, vendedor.email);
        } catch {
          // espelho no Chatwoot é melhor esforço
        }
      }
    }
  }

  // Quem enviou (agente no Chatwoot) vira autor, se o e-mail bater.
  let autorId: string | null = null;
  if (tipo === "enviada" && evento.sender?.email) {
    const { data: autor } = await service
      .from("profiles")
      .select("id")
      .eq("email", evento.sender.email.toLowerCase())
      .maybeSingle();
    autorId = autor?.id ?? null;
  }

  // Lead respondeu: a conversa adiada volta para a caixa de entrada.
  // Update separado e ignorável — sem a migração 0017 a coluna não existe
  // e a mensagem precisa entrar do mesmo jeito.
  if (tipo === "recebida") {
    const { error: erroAdiar } = await service
      .from("leads")
      .update({ chat_adiado_em: null })
      .eq("id", leadId);
    if (erroAdiar) {
      // segue sem desadiar
    }
  }

  await service.from("lead_interactions").insert({
    lead_id: leadId,
    tipo: tipo === "recebida" ? "mensagem_recebida" : "mensagem_enviada",
    conteudo: texto,
    autor_id: autorId,
    metadados: {
      chatwoot_message_id: evento.id,
      chatwoot_conversation_id: conversaId,
      via: "chatwoot",
      ...(anexos.length > 0 ? { anexos } : {}),
    },
  });
}
