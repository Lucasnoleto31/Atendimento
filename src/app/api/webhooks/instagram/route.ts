import { createHmac, timingSafeEqual } from "node:crypto";
import { NextResponse, type NextRequest } from "next/server";
import { createServiceClient } from "@/lib/supabase/server";
import { escolherVendedor } from "@/lib/distribuicao";
import { perfilInstagram } from "@/lib/instagram";

/**
 * Webhook do Direct do Instagram.
 *
 * Mesmo desenho do webhook do WhatsApp: GET responde o desafio de
 * verificação e POST recebe os eventos com assinatura HMAC.
 *
 * O app do Instagram costuma ser OUTRO — a conta do perfil pode viver numa
 * Business Manager diferente da do WhatsApp, e o caminho "Instagram Login"
 * nem exige página do Facebook. Por isso o segredo e o token de verificação
 * têm variáveis próprias, caindo nas do WhatsApp quando o app é o mesmo.
 *
 * O que muda: aqui a identidade do lead é o IGSID, não o telefone. Um lead
 * do Direct nasce SEM telefone — e isso é normal. Ele ganha telefone se e
 * quando a pessoa passar o número na conversa.
 *
 * O eco do que a própria equipe enviou vem marcado com is_echo: ignorar,
 * senão a mensagem entra duas vezes no histórico.
 */

export async function GET(request: NextRequest) {
  const params = request.nextUrl.searchParams;
  const modo = params.get("hub.mode");
  const token = params.get("hub.verify_token");
  const challenge = params.get("hub.challenge");
  const esperado =
    process.env.INSTAGRAM_WEBHOOK_VERIFY_TOKEN ??
    process.env.META_WEBHOOK_VERIFY_TOKEN;

  if (modo === "subscribe" && esperado && token === esperado && challenge) {
    return new Response(challenge, { status: 200 });
  }
  return new Response("Forbidden", { status: 403 });
}

function assinaturaValida(corpo: string, assinatura: string | null): boolean {
  const segredo =
    process.env.INSTAGRAM_APP_SECRET ?? process.env.META_APP_SECRET;
  // Sem segredo o endpoint é público e escreve com service role: em produção,
  // recusa tudo.
  if (!segredo) return process.env.NODE_ENV !== "production";
  if (!assinatura?.startsWith("sha256=")) return false;

  const esperada = createHmac("sha256", segredo).update(corpo).digest("hex");
  const recebida = assinatura.slice("sha256=".length);
  if (esperada.length !== recebida.length) return false;
  return timingSafeEqual(Buffer.from(esperada), Buffer.from(recebida));
}

type AnexoIg = { type?: string; payload?: { url?: string } };

type MensagemIg = {
  mid?: string;
  text?: string;
  attachments?: AnexoIg[];
  is_echo?: boolean;
  is_deleted?: boolean;
};

type EventoIg = {
  sender?: { id?: string };
  recipient?: { id?: string };
  timestamp?: number;
  message?: MensagemIg;
  reaction?: { emoji?: string };
};

const ROTULO_ANEXO: Record<string, string> = {
  image: "[imagem]",
  video: "[vídeo]",
  audio: "[áudio]",
  file: "[arquivo]",
  share: "[publicação compartilhada]",
  story_mention: "[menção em story]",
  ig_reel: "[reel]",
};

export async function POST(request: NextRequest) {
  const corpo = await request.text();

  if (!assinaturaValida(corpo, request.headers.get("x-hub-signature-256"))) {
    return new Response("Invalid signature", { status: 401 });
  }

  let payload: {
    object?: string;
    entry?: { id?: string; messaging?: EventoIg[] }[];
  };
  try {
    payload = JSON.parse(corpo);
  } catch {
    return new Response("Bad request", { status: 400 });
  }

  const service = createServiceClient();

  for (const entry of payload.entry ?? []) {
    for (const evento of entry.messaging ?? []) {
      // Eco do que nós mesmos mandamos, e apagados: não viram histórico.
      if (evento.message?.is_echo || evento.message?.is_deleted) continue;

      const igsid = evento.sender?.id;
      const mid = evento.message?.mid;
      if (!igsid || !mid) continue;

      // Dedup: a Meta reenvia em caso de timeout.
      const { error: duplicado } = await service
        .from("webhook_events")
        .insert({
          origem: "instagram",
          evento_id: `ig-${mid}`,
          payload: evento as unknown as Record<string, unknown>,
        });
      if (duplicado) continue;

      try {
        await processarDirect(service, evento, igsid, mid);
        await service
          .from("webhook_events")
          .update({ processado: true })
          .eq("evento_id", `ig-${mid}`);
      } catch (e) {
        await service
          .from("webhook_events")
          .update({ erro: e instanceof Error ? e.message : String(e) })
          .eq("evento_id", `ig-${mid}`);
      }
    }
  }

  // A Meta desliga o webhook que não devolve 200 — erro fica registrado na
  // linha do evento, não no status.
  return NextResponse.json({ ok: true });
}

async function processarDirect(
  service: ReturnType<typeof createServiceClient>,
  evento: EventoIg,
  igsid: string,
  mid: string,
) {
  const anexos = (evento.message?.attachments ?? []).flatMap((a) =>
    a.payload?.url
      ? [{ tipo: a.type === "image" || a.type === "video" || a.type === "audio" ? a.type : "file", url: a.payload.url }]
      : [],
  );

  const texto =
    evento.message?.text?.trim() ||
    (evento.reaction?.emoji ? `Reagiu com ${evento.reaction.emoji}` : "") ||
    ROTULO_ANEXO[evento.message?.attachments?.[0]?.type ?? ""] ||
    "[mensagem do Direct]";

  const agora = new Date(evento.timestamp ?? Date.now()).toISOString();

  const { data: existente } = await service
    .from("leads")
    .select("id, status, primeira_resposta_em")
    .eq("instagram_id", igsid)
    .maybeSingle();

  let leadId: string;

  if (existente) {
    leadId = existente.id;
    await service
      .from("leads")
      .update({
        ultima_interacao_em: agora,
        // Primeira resposta só é gravada uma vez: é a métrica de ativação.
        ...(existente.primeira_resposta_em
          ? {}
          : { primeira_resposta_em: agora }),
        // Conversa nova reabre o que estava resolvido ou adiado.
        chat_resolvido_em: null,
        chat_adiado_em: null,
        ...(existente.status === "novo"
          ? { status: "em_atendimento" as const }
          : {}),
      })
      .eq("id", leadId);
  } else {
    // Nome e @ para o lead não nascer como um número opaco.
    const perfil = await perfilInstagram(igsid);
    const [{ data: canal }, { data: etapa }, vendedor] = await Promise.all([
      service.from("channels").select("id").eq("slug", "instagram").maybeSingle(),
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
        nome: perfil.nome ?? (perfil.usuario ? `@${perfil.usuario}` : "Direct do Instagram"),
        instagram_id: igsid,
        instagram_usuario: perfil.usuario,
        // Lead do Direct não tem telefone — e não precisa ter para ser atendido.
        telefone_e164: null,
        channel_id: canal?.id ?? null,
        stage_id: etapa?.id ?? null,
        status: "em_atendimento",
        entrada_motivo: "webhook_instagram",
        responsavel_id: vendedor?.id ?? null,
        primeira_resposta_em: agora,
        ultima_interacao_em: agora,
      })
      .select("id")
      .single();

    if (error || !novo) {
      throw new Error(`Não deu para criar o lead do Direct: ${error?.message}`);
    }
    leadId = novo.id;
  }

  await service.from("lead_interactions").insert({
    lead_id: leadId,
    tipo: "mensagem_recebida",
    conteudo: texto,
    metadados: {
      canal: "instagram",
      message_id: mid,
      igsid,
      ...(anexos.length > 0 ? { anexos } : {}),
    },
  });
}
