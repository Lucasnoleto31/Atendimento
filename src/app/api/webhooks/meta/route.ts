import { createHmac, timingSafeEqual } from "node:crypto";
import { NextResponse, type NextRequest } from "next/server";
import { createServiceClient } from "@/lib/supabase/server";
import { variantesTelefone } from "@/lib/csv";
import { escolherVendedor } from "@/lib/distribuicao";
import { hospedarMidiaMeta } from "@/lib/whatsapp";
import { extrairDocumento } from "@/lib/documento";

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
  // Sem segredo: aceita só em desenvolvimento. Em produção o endpoint é
  // público e escreve com service role — sem validação, recusa tudo.
  if (!segredo) return process.env.NODE_ENV !== "production";
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
  errors?: {
    code?: number;
    title?: string;
    message?: string;
    error_data?: { details?: string };
  }[];
};

/** Tradução dos códigos de falha mais comuns da Graph API. */
function descreverErroMeta(erro: NonNullable<StatusMeta["errors"]>[number]) {
  switch (erro.code) {
    case 131047:
      return "Janela de 24h fechada — fora dela só template aprovado chega.";
    case 131030:
      return "Número fora da lista de destinatários de teste (app em modo desenvolvimento).";
    case 190:
      return "Token da Meta inválido ou expirado.";
    case 131026:
      return "Não entregue — o número pode não ter WhatsApp ou bloqueou a empresa.";
    case 131050:
      return "O cliente desativou mensagens de marketing da sua empresa no WhatsApp. Template de utilidade e resposta na janela de 24h ainda chegam.";
    case 131049:
      return "A Meta segurou o envio para preservar o engajamento (limite de marketing por usuário). Tente mais tarde ou por outro caminho.";
    case 130472:
      // Grupo de controle da Meta: ~1% dos usuários não recebe template de
      // marketing de empresa nenhuma. Repetir dá o mesmo erro.
      return "Este número está no grupo de teste da Meta e não recebe template de marketing de nenhuma empresa. Fale por outro caminho (ligação, e-mail) ou espere ele te mandar mensagem primeiro.";
    default:
      return (
        erro.error_data?.details ?? erro.title ?? erro.message ?? "Falha no envio."
      );
  }
}

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
          .select("id, lead_id, metadados")
          .eq("metadados->>message_id", status.id)
          .maybeSingle();
        if (linha) {
          const falha = status.errors?.[0];
          const erro = falha ? descreverErroMeta(falha) : null;

          // Recusou marketing: marca o lead para o disparo em massa e a
          // cadência pularem — falha repetida derruba a reputação do número.
          const recusouMarketing =
            falha?.code === 131050 ||
            /stop receiving marketing/i.test(
              `${falha?.title ?? ""} ${falha?.message ?? ""} ${falha?.error_data?.details ?? ""}`,
            );
          if (recusouMarketing && linha.lead_id) {
            await service
              .from("leads")
              .update({ marketing_bloqueado_em: new Date().toISOString() })
              .eq("id", linha.lead_id);
          }
          const metadados = (linha.metadados as Record<string, unknown>) ?? {};

          // A Meta aceita o envio e só depois avisa que não entregou. Sem
          // devolver isso para campanha_envios, a tela da campanha mostraria
          // zero recusa enquanto o número apanha na prática.
          if (erro && linha.lead_id && typeof metadados.campanha_id === "string") {
            await service
              .from("campanha_envios")
              .update({ erro })
              .eq("campanha_id", metadados.campanha_id)
              .eq("lead_id", linha.lead_id)
              .is("erro", null);
          }

          await service
            .from("lead_interactions")
            .update({
              metadados: {
                ...metadados,
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

/**
 * Contas WhatsApp BR antigas chegam da Meta sem o nono dígito (55+DDD+8).
 * O lookup considera as duas grafias para não duplicar lead no cutover.
 */
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

  const { data: candidatos } = await service
    .from("leads")
    .select("id, status, primeira_resposta_em, whatsapp_instance_id, telefone_e164")
    .in("telefone_e164", variantesTelefone(telefone));
  const existente =
    candidatos?.find((l) => l.telefone_e164 === telefone) ?? candidatos?.[0] ?? null;

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

  // Lead respondeu: conversa adiada OU resolvida volta para a caixa de
  // entrada. Update separado e ignorável — sem as migrações 0017/0018 as
  // colunas não existem e a mensagem precisa entrar do mesmo jeito.
  const { error: erroFila } = await service
    .from("leads")
    .update({ chat_adiado_em: null, chat_resolvido_em: null })
    .eq("id", leadId);
  if (erroFila) {
    await service
      .from("leads")
      .update({ chat_adiado_em: null })
      .eq("id", leadId);
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

  // CPF/CNPJ dito na conversa: grava no lead — o gatilho do banco vincula à
  // base de clientes na hora, ou a próxima importação vincula (0018). Sem a
  // migração a coluna não existe e o update só devolve erro, sem derrubar.
  if (mensagem.type === "text") {
    const documento = extrairDocumento(texto, telefone);
    if (documento) {
      await service.from("leads").update({ documento }).eq("id", leadId);
    }
  }
}
