import { createHmac, timingSafeEqual } from "node:crypto";
import { NextResponse, type NextRequest } from "next/server";
import { createServiceClient } from "@/lib/supabase/server";

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

type MensagemMeta = {
  id: string;
  from: string;
  type: string;
  timestamp?: string;
  text?: { body?: string };
};

type ValorMeta = {
  metadata?: { phone_number_id?: string };
  contacts?: { wa_id?: string; profile?: { name?: string } }[];
  messages?: MensagemMeta[];
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
      if (!valor?.messages?.length) continue; // recibos de status etc.

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
  const texto =
    mensagem.text?.body?.trim() || `[${mensagem.type ?? "mensagem"} recebida]`;

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
    const [{ data: canal }, { data: etapa }] = await Promise.all([
      service.from("channels").select("id").eq("slug", "whatsapp").maybeSingle(),
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
        nome: nomePerfil || `WhatsApp ${telefone.slice(-4)}`,
        telefone_e164: telefone,
        channel_id: canal?.id ?? null,
        stage_id: etapa?.id ?? null,
        status: "em_atendimento",
        entrada_motivo: "webhook_meta",
        responsavel_id: instancia?.vendedor_id ?? null,
        whatsapp_instance_id: instancia?.id ?? null,
        primeira_resposta_em: agora,
        ultima_interacao_em: agora,
      })
      .select("id")
      .single();

    if (error) throw new Error(error.message);
    leadId = novo.id;
  }

  await service.from("lead_interactions").insert({
    lead_id: leadId,
    tipo: "mensagem_recebida",
    conteudo: texto,
    metadados: {
      message_id: mensagem.id,
      tipo: mensagem.type,
      phone_number_id: phoneNumberId,
    },
  });
}
