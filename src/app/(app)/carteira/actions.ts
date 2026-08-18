"use server";

import { revalidatePath } from "next/cache";
import { createClient } from "@/lib/supabase/server";
import { perfilAtual } from "@/lib/auth";
import { variantesTelefone } from "@/lib/csv";

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

  // Já existe lead com esse número? Considera as DUAS grafias do nono
  // dígito — o WhatsApp registra sem o 9 e o cadastro costuma vir com —
  // e prefere a conversa que já tem mensagem em vez de criar outra.
  const { data: candidatos } = await supabase
    .from("leads")
    .select("id, customer_id, ultima_interacao_em")
    .in("telefone_e164", variantesTelefone(cliente.telefone_e164));

  const existente =
    (candidatos ?? [])
      .slice()
      .sort((a, b) =>
        (b.ultima_interacao_em ?? "").localeCompare(a.ultima_interacao_em ?? ""),
      )[0] ?? null;

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

// ===========================================================================
// Ficha do cliente
// ===========================================================================

import { redirect } from "next/navigation";
import { createServiceClient } from "@/lib/supabase/server";
import { normalizarTelefone } from "@/lib/csv";

/**
 * Edição da ficha do cliente — o único lugar onde dá para gravar o telefone
 * de quem veio pela importação da corretora e nunca teve lead. Salvar o
 * telefone dispara o gatilho da 0020, que adota o lead daquele número.
 */
export async function salvarFichaCliente(formData: FormData) {
  const perfil = await perfilAtual();
  if (!perfil) redirect("/entrar");

  const customerId = String(formData.get("customer_id") ?? "");
  if (!customerId) redirect("/carteira");

  function terminar(aviso: string): never {
    revalidatePath(`/carteira/${customerId}`);
    revalidatePath("/carteira");
    redirect(`/carteira/${customerId}?aviso=${encodeURIComponent(aviso)}`);
  }

  if (perfil.papel !== "admin" && perfil.papel !== "gestor") {
    terminar("Só gestor ou admin edita a ficha do cliente.");
  }

  const nome = String(formData.get("nome_completo") ?? "").trim();
  if (!nome) terminar("O nome não pode ficar vazio.");

  const telefoneBruto = String(formData.get("telefone") ?? "").trim();
  let telefone: string | null = null;
  if (telefoneBruto) {
    telefone = normalizarTelefone(telefoneBruto);
    if (!telefone) {
      terminar(
        "Telefone inválido. Use DDD + número, por exemplo 62 98181-0004.",
      );
    }
  }

  const documento = String(formData.get("documento") ?? "").replace(/\D/g, "");
  if (documento && documento.length !== 11 && documento.length !== 14) {
    terminar("CPF/CNPJ inválido — 11 dígitos (CPF) ou 14 (CNPJ).");
  }

  const email = String(formData.get("email") ?? "").trim();
  const abertura = String(formData.get("conta_aberta_em") ?? "").trim();
  const responsavel = String(formData.get("responsavel_id") ?? "");
  const ativo = String(formData.get("situacao") ?? "ativa") === "ativa";

  const service = createServiceClient();

  // Telefone é único entre clientes: avisa em vez de estourar erro do banco.
  if (telefone) {
    const { data: conflito } = await service
      .from("customers")
      .select("id, nome_completo")
      .eq("telefone_e164", telefone)
      .neq("id", customerId)
      .maybeSingle();
    if (conflito) {
      terminar(
        `Este telefone já está no cadastro de ${conflito.nome_completo}. Verifique se não é a mesma pessoa duplicada.`,
      );
    }
  }

  const { error } = await service
    .from("customers")
    .update({
      nome_completo: nome,
      telefone_e164: telefone,
      documento: documento || null,
      email: email || null,
      conta_aberta_em: abertura || null,
      responsavel_id: responsavel || null,
      ativo,
    })
    .eq("id", customerId);

  if (error) terminar(`Não deu para salvar: ${error.message}`);

  terminar(
    telefone
      ? "Ficha salva. Com o telefone no cadastro, dá para abrir a conversa."
      : "Ficha salva.",
  );
}
