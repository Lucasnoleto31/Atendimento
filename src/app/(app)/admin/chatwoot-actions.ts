"use server";

import { revalidatePath } from "next/cache";
import { createServiceClient } from "@/lib/supabase/server";
import { perfilAtual } from "@/lib/auth";
import { normalizarTelefone } from "@/lib/csv";
import { listarConversas, type ConversaChatwoot } from "@/lib/chatwoot";

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
