import { createHmac, timingSafeEqual } from "node:crypto";
import { NextResponse, type NextRequest } from "next/server";
import { createServiceClient } from "@/lib/supabase/server";
import { normalizarTelefone, variantesTelefone } from "@/lib/csv";
import { MOTIVOS_SEM_VOLTA } from "@/lib/perda";
import { escolherVendedor } from "@/lib/distribuicao";
import { hospedarMidiaMeta } from "@/lib/whatsapp";
import { extrairDocumento } from "@/lib/documento";
import { marcarPrintRecebido } from "@/lib/ativacao";

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
  // Reação a uma mensagem: emoji vazio = o cliente removeu a reação.
  reaction?: { message_id?: string; emoji?: string };
  button?: { text?: string; payload?: string };
  interactive?: {
    button_reply?: { title?: string };
    list_reply?: { title?: string };
  };
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
        erro.error_data?.details ??
        erro.title ??
        erro.message ??
        "Falha no envio."
      );
  }
}

type ValorMeta = {
  /** Lead Ads (field "leadgen"). */
  leadgen_id?: string;
  form_id?: string;
  ad_id?: string;
  created_time?: number;
  metadata?: { phone_number_id?: string };
  contacts?: { wa_id?: string; profile?: { name?: string } }[];
  messages?: MensagemMeta[];
  statuses?: StatusMeta[];
  // field "phone_number_quality_update": a qualidade do número É o canal
  // inteiro da mesa (incidente de 24/08). O formato varia por versão da API:
  // às vezes vem event (FLAGGED/UNFLAGGED), às vezes quality_score/rating.
  display_phone_number?: string;
  event?: string;
  current_limit?: string;
  quality_score?: { score?: string } | string;
  quality_rating?: string;
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

  let payload: {
    entry?: {
      time?: number;
      changes?: { field?: string; value?: ValorMeta }[];
    }[];
  };
  try {
    payload = JSON.parse(corpo);
  } catch {
    return new Response("Bad request", { status: 400 });
  }

  const service = createServiceClient();

  for (const entry of payload.entry ?? []) {
    for (const change of entry.changes ?? []) {
      const valor = change.value;

      // Mudança de qualidade do número: registra e segue — nunca pode
      // atrapalhar o processamento de mensagens. Qualquer outro field
      // desconhecido continua caindo no "continue" logo abaixo, sem erro.
      if (change.field === "phone_number_quality_update") {
        if (valor) await registrarQualidadeNumero(service, valor, entry.time);
        continue;
      }

      // Formulário do Facebook/Instagram (Lead Ads): a Meta manda só o id;
      // os campos vêm por uma busca na Graph API.
      if (change.field === "leadgen") {
        if (valor?.leadgen_id) await registrarLeadAds(service, valor);
        continue;
      }

      // Recibos: sent/delivered/read/failed viram os ✓✓ do chat.
      for (const status of valor?.statuses ?? []) {
        if (!status.id || !status.status) continue;
        if (!["sent", "delivered", "read", "failed"].includes(status.status)) {
          continue;
        }
        let { data: linha } = await service
          .from("lead_interactions")
          .select("id, lead_id, metadados")
          .eq("metadados->>message_id", status.id)
          .maybeSingle();
        if (!linha) {
          // Envio com vários anexos: cada arquivo tem um wamid próprio,
          // guardados em metadados.message_ids — o recibo casa por qualquer um.
          ({ data: linha } = await service
            .from("lead_interactions")
            .select("id, lead_id, metadados")
            .contains("metadados", { message_ids: [status.id] })
            .maybeSingle());
        }
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
          if (
            erro &&
            linha.lead_id &&
            typeof metadados.campanha_id === "string"
          ) {
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
 * Evento de qualidade do número (phone_number_quality_update): grava o estado
 * em settings.numero_qualidade para o painel de Campanhas mostrar. No
 * incidente de 24/08 a qualidade caiu para amarelo e ninguém viu no CRM —
 * souberam pelo painel da Meta.
 */
/** Campos que interessam de um formulário de Lead Ads. */
type CamposLeadAds = {
  nome: string | null;
  telefone: string | null;
  email: string | null;
  respostas: string[];
};

/**
 * Busca as respostas do formulário na Graph API. O token precisa da
 * permissão leads_retrieval na página — é o passo que depende do Business
 * Manager e por isso a falha aqui é registrada, não engolida.
 */
async function buscarLeadAds(leadgenId: string): Promise<CamposLeadAds> {
  const token = process.env.META_PAGE_TOKEN || process.env.META_WHATSAPP_TOKEN;
  if (!token) throw new Error("Sem META_PAGE_TOKEN para ler o formulário.");
  const r = await fetch(
    `https://graph.facebook.com/v21.0/${leadgenId}?fields=field_data&access_token=${encodeURIComponent(token)}`,
    { cache: "no-store", signal: AbortSignal.timeout(8000) },
  );
  const json = (await r.json().catch(() => null)) as {
    field_data?: { name?: string; values?: string[] }[];
    error?: { message?: string };
  } | null;
  if (!r.ok || !json?.field_data) {
    throw new Error(json?.error?.message ?? `Graph ${r.status}`);
  }

  const achar = (...chaves: string[]) =>
    json.field_data!.find((c) =>
      chaves.some((k) => (c.name ?? "").toLowerCase().includes(k)),
    )?.values?.[0] ?? null;

  return {
    nome: achar("full_name", "nome", "name"),
    telefone: achar("phone", "telefone", "celular"),
    email: achar("email", "e-mail"),
    respostas: json.field_data.map(
      (c) => `${c.name ?? "campo"}: ${(c.values ?? []).join(", ")}`,
    ),
  };
}

/**
 * Lead Ads: cria o lead do formulário na hora, com UTM e as respostas.
 *
 * A Meta manda só o `leadgen_id`; os campos vêm de uma busca na Graph API
 * com o token da página. Sem permissão (leads_retrieval) a busca falha — o
 * evento fica registrado em webhook_events com o motivo e ninguém perde o
 * lead: ele continua no Gerenciador de Anúncios para baixar à mão.
 */
async function registrarLeadAds(
  service: ReturnType<typeof createServiceClient>,
  valor: ValorMeta,
) {
  const eventoId = `leadgen-${valor.leadgen_id}`;
  const { error: dup } = await service.from("webhook_events").insert({
    origem: "meta",
    evento_id: eventoId,
    payload: valor as unknown as Record<string, unknown>,
  });
  if (dup) return; // já processado

  try {
    const campos = await buscarLeadAds(valor.leadgen_id!);
    const nome = campos.nome || "Lead do formulário";
    const telefone = campos.telefone
      ? normalizarTelefone(campos.telefone)
      : null;
    if (!telefone) {
      throw new Error("Formulário sem telefone — não dá para atender.");
    }

    const [{ data: canal }, { data: etapa }, vendedor] = await Promise.all([
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
      escolherVendedor(service),
    ]);

    // Telefone repetido = a mesma pessoa preencheu de novo: não duplica.
    // limit(1), não maybeSingle: o mesmo número existe nas duas grafias do
    // nono dígito e o maybeSingle devolveria erro — perdendo a submissão.
    const { data: jaExiste } = await service
      .from("leads")
      .select("id, status, chat_resolvido_em")
      .in("telefone_e164", variantesTelefone(telefone))
      .limit(1);
    const antigo = jaExiste?.[0];
    let leadId = antigo?.id as string | undefined;

    // Preencheu o formulário de novo: é interesse novo — volta para a fila.
    if (antigo && (antigo.status === "perdido" || antigo.chat_resolvido_em)) {
      await service
        .from("leads")
        .update({
          status: "novo",
          chat_resolvido_em: null,
          stage_id: await primeiraEtapa(service),
          entrou_na_etapa_em: new Date().toISOString(),
        })
        .eq("id", antigo.id);
    }
    if (!leadId) {
      const { data: novo, error } = await service
        .from("leads")
        .insert({
          nome,
          telefone_e164: telefone,
          email: campos.email ?? null,
          channel_id: canal?.id ?? null,
          stage_id: etapa?.id ?? null,
          status: "novo",
          entrada_motivo: "meta_lead_ads",
          responsavel_id: vendedor?.id ?? null,
          campanha: valor.form_id ?? null,
          utm_source: "meta",
          utm_medium: "lead_ads",
          // O payload do leadgen traz form_id e ad_id — campaign_id não vem.
          utm_campaign: valor.form_id ?? null,
          utm_content: valor.ad_id ?? null,
        })
        .select("id")
        .single();
      if (error) throw new Error(error.message);
      leadId = novo.id as string;
    }

    // As respostas do formulário viram a primeira nota da conversa: quem
    // atender já sabe o que a pessoa pediu.
    if (campos.respostas.length > 0) {
      await service.from("lead_interactions").insert({
        lead_id: leadId,
        tipo: "nota",
        conteudo: `Respostas do formulário:\n${campos.respostas.join("\n")}`,
        metadados: { via: "lead_ads", sistema: true, form_id: valor.form_id },
      });
    }

    await service
      .from("webhook_events")
      .update({ processado: true })
      .eq("origem", "meta")
      .eq("evento_id", eventoId);
  } catch (e) {
    await service
      .from("webhook_events")
      .update({ erro: e instanceof Error ? e.message : String(e) })
      .eq("origem", "meta")
      .eq("evento_id", eventoId);
  }
}

/** A primeira etapa do funil padrão — para onde o lead reaberto volta. */
async function primeiraEtapa(
  service: ReturnType<typeof createServiceClient>,
): Promise<string | null> {
  const { data } = await service
    .from("pipeline_stages")
    .select("id, pipeline:pipelines!inner(padrao)")
    .eq("pipeline.padrao", true)
    .order("ordem")
    .limit(1)
    .maybeSingle();
  return (data?.id as string | undefined) ?? null;
}

/** Régua "reabrir perdido ao responder" (0069), lida uma vez por chamada. */
let cacheReabrir: { valor: boolean; expira: number } | null = null;
async function reabrirPerdido(
  service: ReturnType<typeof createServiceClient>,
): Promise<boolean> {
  if (cacheReabrir && Date.now() < cacheReabrir.expira)
    return cacheReabrir.valor;
  const { data } = await service
    .from("settings")
    .select("valor")
    .eq("chave", "reabrir_perdido_ao_responder")
    .maybeSingle();
  const bruto =
    data?.valor === undefined || data?.valor === null
      ? "1"
      : String(data.valor).replace(/"/g, "");
  const valor = bruto !== "0" && bruto !== "false";
  cacheReabrir = { valor, expira: Date.now() + 60_000 };
  return valor;
}

async function registrarQualidadeNumero(
  service: ReturnType<typeof createServiceClient>,
  valor: ValorMeta,
  entryTime?: number,
) {
  // Dedup no padrão da rota: a Meta reenvia em caso de timeout; o timestamp
  // do entry é estável entre as tentativas.
  const eventoId = `quality-${entryTime ?? Date.now()}`;
  const { error: dupErro } = await service.from("webhook_events").insert({
    origem: "meta",
    evento_id: eventoId,
    payload: valor as unknown as Record<string, unknown>,
  });
  if (dupErro) return; // já processado

  try {
    const bruto =
      typeof valor.quality_score === "string"
        ? valor.quality_score
        : (valor.quality_score?.score ?? valor.quality_rating);
    // Sem score explícito, o event ainda diz a direção: FLAGGED = caiu.
    const rating =
      bruto?.trim().toUpperCase() ||
      (valor.event === "FLAGGED"
        ? "RED"
        : valor.event === "UNFLAGGED"
          ? "GREEN"
          : null);

    const { error } = await service.from("settings").upsert({
      chave: "numero_qualidade",
      valor: {
        rating,
        limite: valor.current_limit ?? null,
        evento: valor.event ?? null,
        telefone: valor.display_phone_number ?? null,
        em: new Date().toISOString(),
      },
      atualizado_em: new Date().toISOString(),
    });
    if (error) throw new Error(error.message);

    await service
      .from("webhook_events")
      .update({ processado: true })
      .eq("origem", "meta")
      .eq("evento_id", eventoId);
  } catch (e) {
    await service
      .from("webhook_events")
      .update({ erro: e instanceof Error ? e.message : String(e) })
      .eq("origem", "meta")
      .eq("evento_id", eventoId);
  }
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
  const telefone = (valor.contacts?.[0]?.wa_id ?? mensagem.from).replace(
    /\D/g,
    "",
  );
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

  // Reação, resposta de botão e resposta de lista têm o conteúdo em campos
  // próprios — sem tratá-los, a mensagem virava um "[reaction recebida]" e a
  // equipe não via o que o cliente quis dizer.
  const textoEspecial =
    mensagem.type === "reaction"
      ? mensagem.reaction?.emoji?.trim()
        ? `Reagiu com ${mensagem.reaction.emoji.trim()}`
        : "Removeu a reação"
      : mensagem.type === "button"
        ? mensagem.button?.text?.trim() || null
        : mensagem.type === "interactive"
          ? (mensagem.interactive?.button_reply?.title?.trim() ??
            mensagem.interactive?.list_reply?.title?.trim() ??
            null)
          : null;

  const texto =
    mensagem.text?.body?.trim() ||
    midia?.caption?.trim() ||
    textoEspecial ||
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
    .select(
      "id, nome, status, perda_motivo, primeira_resposta_em, whatsapp_instance_id, telefone_e164",
    )
    .in("telefone_e164", variantesTelefone(telefone));
  const existente =
    candidatos?.find((l) => l.telefone_e164 === telefone) ??
    candidatos?.[0] ??
    null;

  const agora = new Date().toISOString();
  let leadId: string;

  if (existente) {
    leadId = existente.id;
    // Quem foi perdido por número errado ou por dizer que não quer NÃO
    // reabre: reabrir apagaria o motivo (trigger da 0038) e devolveria a
    // pessoa para as réguas de marketing.
    const vaiReabrir =
      existente.status === "perdido" &&
      !MOTIVOS_SEM_VOLTA.has(existente.perda_motivo ?? "") &&
      (await reabrirPerdido(service));
    const etapaDeVolta = vaiReabrir ? await primeiraEtapa(service) : null;
    await service
      .from("leads")
      .update({
        primeira_resposta_em: existente.primeira_resposta_em ?? agora,
        ultima_interacao_em: agora,
        whatsapp_instance_id:
          existente.whatsapp_instance_id ?? instancia?.id ?? null,
        ...(existente.status === "novo" || existente.status === "sem_resposta"
          ? { status: "em_atendimento" }
          : {}),
        // Perdido que volta a falar: reabre. O trigger da 0038 limpa motivo
        // e carimbo sozinho quando o status sai de 'perdido' — por isso a
        // decisão precisa ser tomada ANTES, com o motivo ainda na mão.
        ...(vaiReabrir
          ? {
              status: "em_atendimento",
              chat_resolvido_em: null,
              chat_adiado_em: null,
              chat_adiado_ate: null,
              // Sai da coluna Perdido: sem isto o card fica parado lá e o
              // prazo por etapa (0051) mede um relógio da época da perda.
              stage_id: etapaDeVolta,
              entrou_na_etapa_em: agora,
            }
          : {}),
      })
      .eq("id", leadId);

    // A reabertura precisa aparecer no fio da conversa: sem isso o lead
    // volta para a Caixa e ninguém entende por quê.
    if (vaiReabrir) {
      await service.from("lead_interactions").insert({
        lead_id: leadId,
        tipo: "nota",
        conteudo:
          "Lead respondeu: reaberto automaticamente — saiu de perdido e voltou para a Caixa.",
        metadados: { via: "webhook", sistema: true, reabertura: true },
      });
    }
  } else {
    const [{ data: canal }, { data: etapa }, vendedor] = await Promise.all([
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
      // Instância manda; sem vendedor nela, cai no round-robin.
      instancia?.vendedor_id
        ? Promise.resolve(null)
        : escolherVendedor(service),
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

    if (error) {
      // Corrida: duas mensagens do MESMO contato novo em POSTs paralelos —
      // o perdedor do índice único de telefone reaproveita o lead do outro,
      // em vez de perder a mensagem para sempre.
      if (error.code === "23505") {
        const { data: corrida } = await service
          .from("leads")
          .select("id")
          .eq("telefone_e164", telefone)
          .maybeSingle();
        if (corrida) {
          leadId = corrida.id;
        } else {
          throw new Error(error.message);
        }
      } else {
        throw new Error(error.message);
      }
    } else {
      leadId = novo.id;
    }

    if (!error && !instancia?.vendedor_id && vendedor) {
      await service.from("lead_interactions").insert({
        lead_id: leadId,
        tipo: "atribuicao",
        conteudo: `Atendimento atribuído a ${vendedor.nome} (distribuição automática)`,
        metadados: { via: "distribuicao_automatica" },
      });
    }
  }

  // Lead respondeu: conversa adiada OU resolvida volta para a caixa de
  // entrada (o prazo do adiamento também zera). Update separado e ignorável,
  // descendo um degrau por migração ausente (0042 → 0017/0018) — a mensagem
  // precisa entrar do mesmo jeito.
  const { error: erroFila } = await service
    .from("leads")
    .update({
      chat_adiado_em: null,
      chat_adiado_ate: null,
      chat_resolvido_em: null,
    })
    .eq("id", leadId);
  if (erroFila) {
    const { error: erroSemPrazo } = await service
      .from("leads")
      .update({ chat_adiado_em: null, chat_resolvido_em: null })
      .eq("id", leadId);
    if (erroSemPrazo) {
      await service
        .from("leads")
        .update({ chat_adiado_em: null })
        .eq("id", leadId);
    }
  }

  const { error: erroInteracao } = await service
    .from("lead_interactions")
    .insert({
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

  if (erroInteracao) {
    // Sem a interação gravada, o evento não pode virar "processado" — a falha
    // fica visível em webhook_events.erro em vez de sumir com a mensagem.
    throw new Error(`Falha ao gravar a mensagem: ${erroInteracao.message}`);
  }

  // Imagem de lead na fila de Ativação = quase sempre o print da 1ª operação.
  // A marca alimenta o funil do roteiro; a nota avisa a equipe de conferir.
  if (mensagem.type === "image") {
    await marcarPrintRecebido(service, leadId);
  }

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
