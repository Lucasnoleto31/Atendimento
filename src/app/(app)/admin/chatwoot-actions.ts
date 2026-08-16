"use server";

import { revalidatePath } from "next/cache";
import { createServiceClient } from "@/lib/supabase/server";
import { perfilAtual } from "@/lib/auth";
import { normalizarTelefone } from "@/lib/csv";
import {
  listarConversas,
  listarMensagensConversa,
  type ConversaChatwoot,
  type MensagemChatwoot,
} from "@/lib/chatwoot";

/**
 * Importa as conversas do Chatwoot como leads, em levas com limite de tempo.
 * Reexecutar continua da página onde parou (o estado devolve a próxima).
 * Dedupe pelo telefone: lead existente só ganha os ids do Chatwoot.
 */

const LIMITE_MS = 120_000;
const POR_PAGINA = 25;

export type ResultadoChatwoot = {
  ok?: boolean;
  erro?: string;
  criados?: number;
  atualizados?: number;
  pulados?: number;
  totalConversas?: number;
  proximaPagina?: number | null;
};

export async function importarChatwoot(
  estadoAnterior: ResultadoChatwoot,
  formData: FormData,
): Promise<ResultadoChatwoot> {
  const perfil = await perfilAtual();
  if (!perfil || (perfil.papel !== "admin" && perfil.papel !== "gestor")) {
    return { erro: "Só administração e gestão podem importar." };
  }

  const inicio = Date.now();
  let pagina = Math.max(1, Number(formData.get("pagina")) || 1);

  const service = createServiceClient();

  // Preparação: etapa/canal padrão, mapa de agentes por e-mail e tags.
  const [{ data: etapa }, { data: canal }, { data: equipe }, { data: tags }] =
    await Promise.all([
      service
        .from("pipeline_stages")
        .select("id, pipeline:pipelines!inner(padrao)")
        .eq("pipeline.padrao", true)
        .order("ordem")
        .limit(1)
        .maybeSingle(),
      service.from("channels").select("id").eq("slug", "whatsapp").maybeSingle(),
      service.from("profiles").select("id, email"),
      service.from("tags").select("id, nome"),
    ]);

  const agentePorEmail = new Map(
    ((equipe ?? []) as { id: string; email: string }[]).map((p) => [
      p.email.toLowerCase(),
      p.id,
    ]),
  );
  const tagPorNome = new Map(
    ((tags ?? []) as { id: string; nome: string }[]).map((t) => [
      t.nome.toLowerCase(),
      t.id,
    ]),
  );

  let criados = 0;
  let atualizados = 0;
  let pulados = 0;
  let totalConversas = 0;
  let terminou = false;

  try {
    while (Date.now() - inicio < LIMITE_MS) {
      const { total, conversas } = await listarConversas(pagina);
      totalConversas = total;

      if (conversas.length === 0) {
        terminou = true;
        break;
      }

      for (const conversa of conversas) {
        const resultado = await importarConversa(service, conversa, {
          etapaId: etapa?.id ?? null,
          canalId: canal?.id ?? null,
          agentePorEmail,
          tagPorNome,
        });
        if (resultado === "criado") criados++;
        else if (resultado === "atualizado") atualizados++;
        else pulados++;
      }

      pagina++;
      if (pagina > Math.ceil(total / POR_PAGINA)) {
        terminou = true;
        break;
      }
    }
  } catch (e) {
    return {
      erro: `Importação interrompida na página ${pagina}: ${
        e instanceof Error ? e.message : String(e)
      }`,
      criados,
      atualizados,
      pulados,
      proximaPagina: pagina,
    };
  }

  revalidatePath("/admin");
  revalidatePath("/leads");
  revalidatePath("/atendimento");

  return {
    ok: true,
    criados,
    atualizados,
    pulados,
    totalConversas,
    proximaPagina: terminou ? null : pagina,
  };
}

async function importarConversa(
  service: ReturnType<typeof createServiceClient>,
  conversa: ConversaChatwoot,
  contexto: {
    etapaId: string | null;
    canalId: string | null;
    agentePorEmail: Map<string, string>;
    tagPorNome: Map<string, string>;
  },
): Promise<"criado" | "atualizado" | "pulado"> {
  const sender = conversa.meta.sender;
  const telefone = normalizarTelefone(sender?.phone_number ?? "");
  if (!telefone) return "pulado"; // sem telefone BR válido (inclui spam gringo)

  const { data: existente } = await service
    .from("leads")
    .select("id, chatwoot_contact_id, chatwoot_conversation_id")
    .eq("telefone_e164", telefone)
    .maybeSingle();

  if (existente) {
    // Só completa o vínculo; não sobrescreve o atendimento local.
    if (
      existente.chatwoot_contact_id === null ||
      existente.chatwoot_conversation_id === null
    ) {
      await service
        .from("leads")
        .update({
          chatwoot_contact_id:
            existente.chatwoot_contact_id ?? sender?.id ?? null,
          chatwoot_conversation_id:
            existente.chatwoot_conversation_id ?? conversa.id,
        })
        .eq("id", existente.id);
      return "atualizado";
    }
    return "pulado";
  }

  const responsavelId = conversa.meta.assignee?.email
    ? (contexto.agentePorEmail.get(conversa.meta.assignee.email.toLowerCase()) ??
      null)
    : null;

  const criadoEm = new Date(conversa.created_at * 1000).toISOString();
  const ultimaAtividade = new Date(
    (conversa.last_activity_at ?? conversa.created_at) * 1000,
  ).toISOString();

  const { data: novo, error } = await service
    .from("leads")
    .insert({
      nome: sender?.name?.trim() || `WhatsApp ${telefone.slice(-4)}`,
      telefone_e164: telefone,
      channel_id: contexto.canalId,
      stage_id: contexto.etapaId,
      status: "em_atendimento",
      entrada_motivo: "importacao",
      responsavel_id: responsavelId,
      criado_em: criadoEm,
      // Conversa no WhatsApp nasce de mensagem do contato: contou como resposta.
      primeira_resposta_em: criadoEm,
      ultima_interacao_em: ultimaAtividade,
      chatwoot_contact_id: sender?.id ?? null,
      chatwoot_conversation_id: conversa.id,
    })
    .select("id")
    .single();

  if (error || !novo) return "pulado";

  // Labels do Chatwoot viram tags do CRM.
  for (const label of conversa.labels ?? []) {
    const nome = label.trim();
    if (!nome) continue;

    let tagId = contexto.tagPorNome.get(nome.toLowerCase());
    if (!tagId) {
      const { data: tag } = await service
        .from("tags")
        .upsert({ nome }, { onConflict: "nome" })
        .select("id")
        .single();
      if (tag) {
        tagId = tag.id as string;
        contexto.tagPorNome.set(nome.toLowerCase(), tagId);
      }
    }
    if (tagId) {
      await service
        .from("lead_tags")
        .upsert(
          { lead_id: novo.id, tag_id: tagId },
          { onConflict: "lead_id,tag_id" },
        );
    }
  }

  return "criado";
}

// ===========================================================================
// Backfill do histórico de mensagens
// ===========================================================================

const ROTULO_ANEXO_IMPORT: Record<string, string> = {
  image: "[imagem]",
  audio: "[áudio]",
  video: "[vídeo]",
  file: "[arquivo]",
  location: "[localização]",
  contact: "[contato]",
};

const MAX_PAGINAS_POR_CONVERSA = 15; // ~300 mensagens por passada

export type ResultadoHistorico = {
  ok?: boolean;
  erro?: string;
  conversas?: number;
  mensagens?: number;
  puladas?: number;
  totalLeads?: number;
  proximoOffset?: number | null;
};

/**
 * Importa o histórico de mensagens das conversas vinculadas, em levas com
 * limite de tempo. Dedup pelo mesmo registro que o webhook usa
 * (webhook_events, cw-msg-<id>), então rodar de novo não duplica nada.
 */
export async function importarHistoricoChatwoot(
  _estadoAnterior: ResultadoHistorico,
  formData: FormData,
): Promise<ResultadoHistorico> {
  const perfil = await perfilAtual();
  if (!perfil || (perfil.papel !== "admin" && perfil.papel !== "gestor")) {
    return { erro: "Só administração e gestão podem importar." };
  }

  const inicio = Date.now();
  let offset = Math.max(0, Number(formData.get("offset")) || 0);

  const service = createServiceClient();

  const { data: equipe } = await service.from("profiles").select("id, email");
  const autorPorEmail = new Map(
    ((equipe ?? []) as { id: string; email: string }[]).map((p) => [
      p.email.toLowerCase(),
      p.id,
    ]),
  );

  const { count: totalLeads } = await service
    .from("leads")
    .select("id", { count: "exact", head: true })
    .not("chatwoot_conversation_id", "is", null);

  let conversas = 0;
  let mensagens = 0;
  let puladas = 0;

  try {
    while (Date.now() - inicio < LIMITE_MS) {
      const { data: leads } = await service
        .from("leads")
        .select("id, chatwoot_conversation_id")
        .not("chatwoot_conversation_id", "is", null)
        .order("criado_em", { ascending: true })
        .range(offset, offset + 9);

      const lote = (leads ?? []) as {
        id: string;
        chatwoot_conversation_id: number;
      }[];
      if (lote.length === 0) {
        return {
          ok: true,
          conversas,
          mensagens,
          puladas,
          totalLeads: totalLeads ?? 0,
          proximoOffset: null,
        };
      }

      for (const lead of lote) {
        const resultado = await importarMensagensDoLead(service, lead, autorPorEmail);
        mensagens += resultado.novas;
        puladas += resultado.puladas;
        conversas++;
        offset++;
        if (Date.now() - inicio >= LIMITE_MS) break;
      }
    }
  } catch (e) {
    return {
      erro: `Importação interrompida no lead ${offset}: ${
        e instanceof Error ? e.message : String(e)
      }`,
      conversas,
      mensagens,
      puladas,
      totalLeads: totalLeads ?? 0,
      proximoOffset: offset,
    };
  }

  revalidatePath("/chat");
  revalidatePath("/admin");

  const terminou = offset >= (totalLeads ?? 0);
  return {
    ok: true,
    conversas,
    mensagens,
    puladas,
    totalLeads: totalLeads ?? 0,
    proximoOffset: terminou ? null : offset,
  };
}

async function importarMensagensDoLead(
  service: ReturnType<typeof createServiceClient>,
  lead: { id: string; chatwoot_conversation_id: number },
  autorPorEmail: Map<string, string>,
): Promise<{ novas: number; puladas: number }> {
  let novas = 0;
  let puladas = 0;
  let antes: number | undefined;

  for (let pagina = 0; pagina < MAX_PAGINAS_POR_CONVERSA; pagina++) {
    const pacote = await listarMensagensConversa(
      lead.chatwoot_conversation_id,
      antes,
    );
    if (pacote.length === 0) break;

    for (const mensagem of pacote) {
      const gravou = await gravarMensagem(service, lead, mensagem, autorPorEmail);
      if (gravou === "nova") novas++;
      else puladas++;
    }

    if (pacote.length < 20) break;
    antes = Math.min(...pacote.map((m) => m.id));
  }

  return { novas, puladas };
}

async function gravarMensagem(
  service: ReturnType<typeof createServiceClient>,
  lead: { id: string },
  mensagem: MensagemChatwoot,
  autorPorEmail: Map<string, string>,
): Promise<"nova" | "pulada"> {
  if (!mensagem.id || mensagem.private) return "pulada";

  // 0 = recebida; 1 = enviada; 3 = template (também enviada). 2 é atividade.
  const tipo =
    mensagem.message_type === 0
      ? "mensagem_recebida"
      : mensagem.message_type === 1 || mensagem.message_type === 3
        ? "mensagem_enviada"
        : null;
  if (!tipo) return "pulada";

  // Mesmo dedup do webhook: a segunda passada (ou o eco ao vivo) não duplica.
  const { error: dupErro } = await service.from("webhook_events").insert({
    origem: "chatwoot",
    evento_id: `cw-msg-${mensagem.id}`,
    payload: { via: "backfill", lead_id: lead.id },
    processado: true,
  });
  if (dupErro) return "pulada";

  const anexos = (mensagem.attachments ?? []).flatMap((a) =>
    a.data_url ? [{ tipo: a.file_type ?? "file", url: a.data_url }] : [],
  );
  const conteudo =
    mensagem.content?.trim() ||
    (anexos.length > 0
      ? (ROTULO_ANEXO_IMPORT[anexos[0].tipo] ?? "[anexo]")
      : "[mensagem sem texto]");

  const autorId =
    tipo === "mensagem_enviada" && mensagem.sender?.email
      ? (autorPorEmail.get(mensagem.sender.email.toLowerCase()) ?? null)
      : null;

  await service.from("lead_interactions").insert({
    lead_id: lead.id,
    tipo,
    conteudo,
    autor_id: autorId,
    criado_em: mensagem.created_at
      ? new Date(mensagem.created_at * 1000).toISOString()
      : undefined,
    metadados: {
      chatwoot_message_id: mensagem.id,
      via: "backfill",
      ...(anexos.length > 0 ? { anexos } : {}),
    },
  });

  return "nova";
}
