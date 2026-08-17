import { createHmac, timingSafeEqual } from "node:crypto";
import { NextResponse, type NextRequest } from "next/server";
import { createServiceClient } from "@/lib/supabase/server";
import { escolherVendedor } from "@/lib/distribuicao";
import { hospedarMidiaMeta } from "@/lib/whatsapp";

/**
 * Webhook do WhatsApp Cloud API (Meta).
 *
 * GET  — verificação do endpoint: a Meta manda hub.verify_token e espera o
 *        hub.challenge de volta.
 * POST — eventos. A assinatura X-Hub-Signature-256 é validada com o
 *        META_APP_SECRET; o evento bruto fica em webhook_events (deduplicado
 *        pelo id da mensagem) e cada mensagem recebida vira lead + interação.
 */

export async function GET(request: NextRequest) {
  const params = request.nextUrl.searchParams;
  const modo = params.get("hub.mode");
  const token = params.get("hub.verify_token");
  const challenge = params.get("hub.challenge");
  const esperado = process.env.META_WEBHOOK_VERIFY_TOKEN;

  if (modo === "subscribe" && esperado && token === esperado && challenge) {
    return new Response(challenge, { status: 200 });
  }

  return new Response("Forbidden", { status: 403 });
}

function assinaturaValida(corpo: string, assinatura: string | null): boolean {
  const segredo = process.env.META_APP_SECRET;
  // Sem segredo configurado, aceita — ambiente de desenvolvimento.
  if (!segredo) return true;
  if (!assinatura?.startsWith("sha256=")) return false;

  const esperada = createHmac("sha256", segredo).update(corpo).digest("hex");
  const recebida = assinatura.slice("sha256=".length);

  if (esperada.length !== recebida.length) return false;
  return timingSafeEqual(Buffer.from(esperada), Buffer.from(recebida));
}

type MidiaMeta = {
  id?: string;
  mime_type?: string;
  caption?: string;
  filename?: string;
};

type MensagemMeta = {
  id: string;
  from: string;
  type: string;
  timestamp?: string;
  text?: { body?: string };
  image?: MidiaMeta;
  audio?: MidiaMeta;
  video?: MidiaMeta;
  document?: MidiaMeta;
  sticker?: MidiaMeta;
};

type StatusMeta = {
  id?: string;
  status?: string;
  errors?: { title?: string; message?: string }[];
};

type ValorMeta = {
  metadata?: { phone_number_id?: string };
  contacts?: { wa_id?: string; profile?: { name?: string } }[];
  messages?: MensagemMeta[];
  statuses?: StatusMeta[];
};

const ROTULO_TIPO_META: Record<string, string> = {
  image: "[imagem]",
  audio: "[áudio]",
  video: "[vídeo]",
  document: "[arquivo]",
  sticker: "[figurinha]",
  location: "[localização]",
  contacts: "[contato]",
};

export async function POST(request: NextRequest) {
  const corpo = await request.text();

  if (!assinaturaValida(corpo, request.headers.get("x-hub-signature-256"))) {
    return new Response("Invalid signature", { status: 401 });
  }

  let payload: { entry?: { changes?: { value?: ValorMeta }[] }[] };
  try {
    payload = JSON.parse(corpo);
  } catch {
    return new Response("Bad request", { status: 400 });
  }

  const service = createServiceClient();

  for (const entry of payload.entry ?? []) {
    for (const change of entry.changes ?? []) {
      const valor = change.value;

      // Recibos: sent/delivered/read/failed viram os ✓✓ do chat.
      for (const status of valor?.statuses ?? []) {
        if (!status.id || !status.status) continue;
        if (!["sent", "delivered", "read", "failed"].includes(status.status)) {
          continue;
        }
        const { data: linha } = await service
          .from("lead_interactions")
          .select("id, metadados")
          .eq("metadados->>message_id", status.id)
          .maybeSingle();
        if (linha) {
          const erro =
            status.errors?.[0]?.title ?? status.errors?.[0]?.message ?? null;
          await service
            .from("lead_interactions")
            .update({
              metadados: {
                ...((linha.metadados as Record<string, unknown>) ?? {}),
                status_envio: status.status,
                ...(erro ? { erro_envio: erro } : {}),
              },
            })
            .eq("id", linha.id);
        }
      }

      if (!valor?.messages?.length) continue;

      for (const mensagem of valor.messages) {
        // Dedup: a Meta reenvia em caso de timeout; o id da mensagem é único.
        const { error: dupErro } = await service.from("webhook_events").insert({
          origem: "meta",
          evento_id: mensagem.id,
          payload: valor as unknown as Record<string, unknown>,
        });
        if (dupErro) continue; // já processada

        try {
          await processarMensagem(service, valor, mensagem);
          await service
            .from("webhook_events")
            .update({ processado: true })
            .eq("origem", "meta")
            .eq("evento_id", mensagem.id);
        } catch (e) {
          await service
            .from("webhook_events")
            .update({ erro: e instanceof Error ? e.message : String(e) })
            .eq("origem", "meta")
            .eq("evento_id", mensagem.id);
        }
      }
    }
  }

  // Sempre 200 rápido: a Meta corta webhooks que falham repetidamente.
  return NextResponse.json({ ok: true });
}

async function processarMensagem(
  service: ReturnType<typeof createServiceClient>,
  valor: ValorMeta,
  mensagem: MensagemMeta,
) {
  const telefone = (valor.contacts?.[0]?.wa_id ?? mensagem.from).replace(/\D/g, "");
  if (!telefone) throw new Error("Mensagem sem telefone.");

  const nomePerfil = valor.contacts?.[0]?.profile?.name?.trim();

  // Mídia: baixa da Meta (a URL deles expira) e hospeda no Storage.
  const midia =
    mensagem.image ??
    mensagem.audio ??
    mensagem.video ??
    mensagem.document ??
    mensagem.sticker ??
    null;
  let anexos: { tipo: string; url: string }[] = [];
  if (midia?.id) {
    try {
      const hospedada = await hospedarMidiaMeta(midia.id);
      if (hospedada) {
        const prefixo = hospedada.mime.split("/")[0];
        anexos = [
          {
            tipo:
              prefixo === "image" || prefixo === "audio" || prefixo === "video"
                ? prefixo
                : "file",
            url: hospedada.url,
          },
        ];
      }
    } catch {
      // sem a mídia, a mensagem ainda entra com o rótulo
    }
  }

  const texto =
    mensagem.text?.body?.trim() ||
    midia?.caption?.trim() ||
    ROTULO_TIPO_META[mensagem.type] ||
    `[${mensagem.type ?? "mensagem"} recebida]`;

  // Instância que recebeu: define vendedor responsável do lead novo.
  const phoneNumberId = valor.metadata?.phone_number_id ?? null;
  const { data: instancia } = phoneNumberId
    ? await service
        .from("whatsapp_instances")
        .select("id, vendedor_id")
        .eq("meta_phone_number_id", phoneNumberId)
        .maybeSingle()
    : { data: null };

  const { data: existente } = await service
    .from("leads")
    .select("id, status, primeira_resposta_em, whatsapp_instance_id")
    .eq("telefone_e164", telefone)
    .maybeSingle();

  const agora = new Date().toISOString();
  let leadId: string;

  if (existente) {
    leadId = existente.id;
    await service
      .from("leads")
      .update({
        primeira_resposta_em: existente.primeira_resposta_em ?? agora,
        ultima_interacao_em: agora,
        whatsapp_instance_id: existente.whatsapp_instance_id ?? instancia?.id ?? null,
        ...(existente.status === "novo" || existente.status === "sem_resposta"
          ? { status: "em_atendimento" }
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
      // Instância manda; sem vendedor nela, cai no round-robin.
      instancia?.vendedor_id ? Promise.resolve(null) : escolherVendedor(service),
    ]);

    const { data: novo, error } = await service
      .from("leads")
      .insert({
        nome: nomePerfil || `WhatsApp ${telefone.slice(-4)}`,
        telefone_e164: telefone,
        channel_id: canal?.id ?? null,
        stage_id: etapa?.id ?? null,
        status: "em_atendimento",
        entrada_motivo: "webhook_meta",
        responsavel_id: instancia?.vendedor_id ?? vendedor?.id ?? null,
        whatsapp_instance_id: instancia?.id ?? null,
        primeira_resposta_em: agora,
        ultima_interacao_em: agora,
      })
      .select("id")
      .single();

    if (error) throw new Error(error.message);
    leadId = novo.id;

    if (!instancia?.vendedor_id && vendedor) {
      await service.from("lead_interactions").insert({
        lead_id: leadId,
        tipo: "atribuicao",
        conteudo: `Atendimento atribuído a ${vendedor.nome} (distribuição automática)`,
        metadados: { via: "distribuicao_automatica" },
      });
    }
  }

  // Lead respondeu: a conversa adiada volta para a caixa de entrada.
  // Update separado e ignorável — sem a migração 0017 a coluna não existe
  // e a mensagem precisa entrar do mesmo jeito.
  const { error: erroAdiar } = await service
    .from("leads")
    .update({ chat_adiado_em: null })
    .eq("id", leadId);
  if (erroAdiar) {
    // segue sem desadiar
  }

  await service.from("lead_interactions").insert({
    lead_id: leadId,
    tipo: "mensagem_recebida",
    conteudo: texto,
    metadados: {
      message_id: mensagem.id,
      tipo: mensagem.type,
      phone_number_id: phoneNumberId,
      ...(anexos.length > 0 ? { anexos } : {}),
    },
  });
}
