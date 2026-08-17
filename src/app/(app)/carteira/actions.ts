"use server";

import { revalidatePath } from "next/cache";
import { createClient } from "@/lib/supabase/server";
import { perfilAtual } from "@/lib/auth";

export type ResultadoConversa = { leadId?: string; erro?: string };

/**
 * Abre atendimento para um cliente que ainda não tem lead — o caso do cliente
 * que veio pela importação da corretora e acabou de ganhar telefone no
 * cadastro. Reaproveita o lead que já exista com aquele número; só cria um
 * novo quando não há nenhum.
 */
export async function abrirConversaCliente(
  customerId: string,
): Promise<ResultadoConversa> {
  const perfil = await perfilAtual();
  if (!perfil) return { erro: "Sessão expirada. Entre novamente." };
  if (!customerId) return { erro: "Cliente não informado." };

  const supabase = await createClient();

  const { data: cliente } = await supabase
    .from("customers")
    .select("id, nome_completo, telefone_e164, responsavel_id")
    .eq("id", customerId)
    .maybeSingle();

  if (!cliente) return { erro: "Cliente não encontrado." };
  if (!cliente.telefone_e164) {
    return {
      erro: "Este cliente ainda não tem telefone no cadastro — preencha na ficha para abrir a conversa.",
    };
  }

  // Já existe lead com esse número? Então é só adotar.
  const { data: existente } = await supabase
    .from("leads")
    .select("id, customer_id")
    .eq("telefone_e164", cliente.telefone_e164)
    .maybeSingle();

  if (existente) {
    if (!existente.customer_id) {
      await supabase
        .from("leads")
        .update({
          customer_id: cliente.id,
          cliente_confirmado_em: new Date().toISOString(),
        })
        .eq("id", existente.id);
    }
    revalidatePath("/carteira");
    return { leadId: existente.id };
  }

  const [{ data: canal }, { data: etapa }] = await Promise.all([
    supabase.from("channels").select("id").eq("slug", "whatsapp").maybeSingle(),
    supabase
      .from("pipeline_stages")
      .select("id, pipeline:pipelines!inner(padrao)")
      .eq("pipeline.padrao", true)
      .order("ordem")
      .limit(1)
      .maybeSingle(),
  ]);

  const { data: novo, error } = await supabase
    .from("leads")
    .insert({
      nome: cliente.nome_completo,
      telefone_e164: cliente.telefone_e164,
      customer_id: cliente.id,
      cliente_confirmado_em: new Date().toISOString(),
      channel_id: canal?.id ?? null,
      stage_id: etapa?.id ?? null,
      status: "em_atendimento",
      entrada_motivo: "importacao",
      responsavel_id: cliente.responsavel_id ?? perfil.id,
    })
    .select("id")
    .single();

  if (error || !novo) {
    return { erro: error?.message ?? "Não deu para abrir a conversa." };
  }

  revalidatePath("/carteira");
  revalidatePath("/chat");
  return { leadId: novo.id };
}
