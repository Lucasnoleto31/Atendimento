"use server";

import { revalidatePath } from "next/cache";
import { createServiceClient } from "@/lib/supabase/server";
import { perfilAtual } from "@/lib/auth";
import { variantesTelefone } from "@/lib/csv";
import { canalAtivo, listarTemplatesCanal } from "@/lib/canal";
import { dispararTemplate } from "@/lib/cadencia";
import { avancarAposDisparo } from "@/lib/kanban";

/**
 * Ações que a carteira executa sobre VÁRIOS clientes de uma vez: etiquetar
 * (para virar público de campanha) e disparar um template aprovado.
 *
 * Teto do disparo imediato: a Meta limita conversas iniciadas por dia e
 * bloqueio em massa derruba a qualidade do número — que é o canal de TODO o
 * atendimento. Lista maior é trabalho de campanha, que escoa no ritmo certo.
 */
const MAX_DISPARO_MASSA = 50;
const MAX_ETIQUETA_MASSA = 200;

type LeadDoCliente = {
  id: string;
  nome: string | null;
  telefone_e164: string | null;
  chatwoot_contact_id: number | null;
  chatwoot_conversation_id: number | null;
  marketing_bloqueado_em: string | null;
  ultima_interacao_em: string | null;
};

type ClienteAlvo = {
  id: string;
  nome_completo: string;
  telefone_e164: string | null;
  responsavel_id: string | null;
};

type Servico = ReturnType<typeof createServiceClient>;

const CAMPOS_LEAD =
  "id, nome, telefone_e164, chatwoot_contact_id, chatwoot_conversation_id, marketing_bloqueado_em, ultima_interacao_em";

export type ResultadoMassa = { ok?: boolean; erro?: string; aviso?: string };

/** Conversa mais viva primeiro — o mesmo critério da v_carteira. */
function maisVivo(linhas: LeadDoCliente[]): LeadDoCliente | null {
  return (
    linhas
      .slice()
      .sort((a, b) =>
        (b.ultima_interacao_em ?? "").localeCompare(a.ultima_interacao_em ?? ""),
      )[0] ?? null
  );
}

async function padroesDeLead(
  service: Servico,
): Promise<{ canalId: string | null; etapaId: string | null }> {
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
  return { canalId: canal?.id ?? null, etapaId: etapa?.id ?? null };
}

/**
 * O lead por onde se fala com este cliente. Quem veio da importação e nunca
 * teve lead ganha um agora — sem lead a etiqueta não serviria para campanha
 * nenhuma, porque o motor de campanha varre `lead_tags`.
 */
async function resolverLeadDoCliente(
  service: Servico,
  cliente: ClienteAlvo,
  padroes: { canalId: string | null; etapaId: string | null },
  autorId: string,
): Promise<{ lead: LeadDoCliente | null; criado: boolean }> {
  const { data: vinculados } = await service
    .from("leads")
    .select(CAMPOS_LEAD)
    .eq("customer_id", cliente.id);

  const existente = maisVivo((vinculados ?? []) as LeadDoCliente[]);
  if (existente) return { lead: existente, criado: false };

  if (!cliente.telefone_e164) return { lead: null, criado: false };

  // Pode haver lead com esse número ainda sem vínculo — as duas grafias do
  // nono dígito, porque o WhatsApp registra sem o 9 e o cadastro vem com.
  const { data: soltos } = await service
    .from("leads")
    .select(CAMPOS_LEAD)
    .in("telefone_e164", variantesTelefone(cliente.telefone_e164));

  const solto = maisVivo((soltos ?? []) as LeadDoCliente[]);
  if (solto) {
    await service
      .from("leads")
      .update({
        customer_id: cliente.id,
        cliente_confirmado_em: new Date().toISOString(),
      })
      .eq("id", solto.id);
    return { lead: solto, criado: false };
  }

  const { data: novo } = await service
    .from("leads")
    .insert({
      nome: cliente.nome_completo,
      telefone_e164: cliente.telefone_e164,
      customer_id: cliente.id,
      cliente_confirmado_em: new Date().toISOString(),
      channel_id: padroes.canalId,
      stage_id: padroes.etapaId,
      status: "em_atendimento",
      entrada_motivo: "importacao",
      responsavel_id: cliente.responsavel_id ?? autorId,
    })
    .select(CAMPOS_LEAD)
    .single();

  return { lead: (novo as LeadDoCliente) ?? null, criado: Boolean(novo) };
}

/**
 * Marca a etiqueta nos clientes escolhidos — o passo que transforma uma
 * seleção da carteira em público de campanha. Aceita etiqueta que já existe
 * ou um nome novo, criado na hora.
 */
export async function etiquetarClientesEmMassa(
  customerIds: string[],
  etiqueta: { id?: string; novoNome?: string },
): Promise<ResultadoMassa> {
  const perfil = await perfilAtual();
  if (!perfil) return { erro: "Sessão expirada. Entre novamente." };

  const ids = [...new Set(customerIds.filter(Boolean))];
  if (ids.length === 0) return { erro: "Selecione pelo menos um cliente." };
  if (ids.length > MAX_ETIQUETA_MASSA) {
    return { erro: `Muitos de uma vez — no máximo ${MAX_ETIQUETA_MASSA}.` };
  }

  const service = createServiceClient();

  let tagId = etiqueta.id ?? "";
  if (!tagId) {
    const nome = (etiqueta.novoNome ?? "").trim();
    if (!nome) return { erro: "Escolha uma etiqueta ou dê um nome à nova." };
    const { data: existente } = await service
      .from("tags")
      .select("id")
      .ilike("nome", nome)
      // limit(1): dois nomes que só diferem no caixa fariam maybeSingle
      // devolver erro e a tela diria "não deu para criar" sem motivo.
      .limit(1)
      .maybeSingle();
    if (existente) {
      tagId = existente.id as string;
    } else {
      const { data: criada, error } = await service
        .from("tags")
        .insert({ nome })
        .select("id")
        .single();
      if (error || !criada) {
        return {
          erro: `Não deu para criar a etiqueta: ${error?.message ?? ""}`,
        };
      }
      tagId = criada.id as string;
    }
  }

  const { data: clientes } = await service
    .from("customers")
    .select("id, nome_completo, telefone_e164, responsavel_id")
    .in("id", ids);

  const padroes = await padroesDeLead(service);

  let etiquetados = 0;
  let criados = 0;
  let semTelefone = 0;

  for (const cliente of (clientes ?? []) as ClienteAlvo[]) {
    const { lead, criado } = await resolverLeadDoCliente(
      service,
      cliente,
      padroes,
      perfil.id,
    );
    if (!lead) {
      semTelefone++;
      continue;
    }
    if (criado) criados++;
    const { error } = await service
      .from("lead_tags")
      .upsert(
        { lead_id: lead.id, tag_id: tagId },
        { onConflict: "lead_id,tag_id", ignoreDuplicates: true },
      );
    if (!error) etiquetados++;
  }

  revalidatePath("/carteira");
  revalidatePath("/campanhas");

  const partes = [`${etiquetados} cliente(s) etiquetado(s)`];
  if (criados > 0) partes.push(`${criados} ganharam conversa nova`);
  if (semTelefone > 0) {
    partes.push(`${semTelefone} ficaram de fora por não ter telefone`);
  }
  return {
    ok: true,
    aviso: `${partes.join(" · ")}. Agora crie a campanha apontando para esta etiqueta.`,
  };
}

/**
 * Dispara o mesmo template aprovado para os clientes escolhidos, um a um.
 * Quem pediu descadastro fica de fora, e a falha de um não derruba os outros.
 */
export async function dispararTemplateEmMassa(
  customerIds: string[],
  templateNome: string,
  templateIdioma: string,
  valores: Record<string, string>,
): Promise<ResultadoMassa> {
  const perfil = await perfilAtual();
  if (!perfil) return { erro: "Sessão expirada. Entre novamente." };

  const ids = [...new Set(customerIds.filter(Boolean))];
  if (ids.length === 0) return { erro: "Selecione pelo menos um cliente." };
  if (ids.length > MAX_DISPARO_MASSA) {
    return {
      erro: `Disparo imediato vai até ${MAX_DISPARO_MASSA} por vez — a Meta limita conversas iniciadas por dia. Para uma lista maior, etiquete a seleção e crie uma campanha.`,
    };
  }
  if (!templateNome) return { erro: "Escolha um template." };

  let template;
  try {
    const templates = await listarTemplatesCanal();
    template = templates.find(
      (t) => t.nome === templateNome && t.idioma === templateIdioma,
    );
  } catch (e) {
    return {
      erro: `Não deu para carregar os templates: ${e instanceof Error ? e.message : String(e)}`,
    };
  }
  if (!template) return { erro: "Template não encontrado ou não aprovado." };

  for (const token of template.parametros) {
    if (!(valores[token] ?? "").trim()) {
      return { erro: `Preencha a variável {{${token}}}.` };
    }
  }

  const service = createServiceClient();
  const canal = canalAtivo();
  const padroes = await padroesDeLead(service);

  const { data: clientes } = await service
    .from("customers")
    .select("id, nome_completo, telefone_e164, responsavel_id")
    .in("id", ids);

  let enviados = 0;
  let bloqueados = 0;
  let semTelefone = 0;
  const falhas: string[] = [];

  for (const cliente of (clientes ?? []) as ClienteAlvo[]) {
    const { lead } = await resolverLeadDoCliente(
      service,
      cliente,
      padroes,
      perfil.id,
    );
    if (!lead || !lead.telefone_e164) {
      semTelefone++;
      continue;
    }
    if (lead.marketing_bloqueado_em) {
      bloqueados++;
      continue;
    }

    // {nome} é o mesmo atalho que a equipe já usa nas campanhas.
    const primeiro = (lead.nome ?? cliente.nome_completo)
      .trim()
      .split(/\s+/)[0];
    const preenchidos: Record<string, string> = {};
    for (const token of template.parametros) {
      preenchidos[token] = (valores[token] ?? "").replace(
        /\{nome\}/gi,
        primeiro,
      );
    }

    try {
      const idMensagem = await dispararTemplate(
        service,
        canal,
        {
          leadId: lead.id,
          nome: lead.nome ?? cliente.nome_completo,
          telefone: lead.telefone_e164,
          chatwootContatoId: lead.chatwoot_contact_id,
          chatwootConversaId: lead.chatwoot_conversation_id,
        },
        template,
        preenchidos,
      );

      const conteudo = template.corpo.replace(
        /\{\{\s*([^{}]+?)\s*\}\}/g,
        (bloco, token: string) => preenchidos[token] ?? bloco,
      );
      const agora = new Date().toISOString();

      await service.from("lead_interactions").insert({
        lead_id: lead.id,
        tipo: "mensagem_enviada",
        conteudo,
        autor_id: perfil.id,
        metadados: {
          via: "carteira_massa",
          template: template.nome,
          ...(canal === "meta"
            ? { message_id: idMensagem }
            : { chatwoot_message_id: idMensagem }),
        },
      });

      await service
        .from("leads")
        .update({ ultima_interacao_em: agora, chat_lido_em: agora })
        .eq("id", lead.id);

      await avancarAposDisparo(service, [lead.id]);
      enviados++;
    } catch (e) {
      falhas.push(
        `${cliente.nome_completo}: ${e instanceof Error ? e.message : String(e)}`,
      );
    }
  }

  revalidatePath("/carteira");
  revalidatePath("/chat");

  if (enviados === 0 && falhas.length > 0) {
    return { erro: `Nenhum saiu. ${falhas[0]}` };
  }

  const partes = [`${enviados} template(s) enviado(s)`];
  if (bloqueados > 0) partes.push(`${bloqueados} pediram descadastro`);
  if (semTelefone > 0) partes.push(`${semTelefone} sem telefone`);
  if (falhas.length > 0) partes.push(`${falhas.length} falharam (${falhas[0]})`);
  return { ok: true, aviso: `${partes.join(" · ")}.` };
}
