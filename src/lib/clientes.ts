import { createServiceClient } from "@/lib/supabase/server";
import { normalizarConta } from "@/lib/imports/tabular";

/**
 * Lead ganho vira cliente: cria (ou encontra, por conta e por telefone) o
 * registro em customers, grava a conta informada e vincula lead e vendas.
 *
 * A importação da base enriquece esse mesmo cliente depois — o casamento de
 * lá é por conta primeiro e telefone em seguida (aplicarClientes), então o
 * registro criado aqui nunca duplica: a linha do diversificador só completa
 * CPF, e-mail e data de abertura.
 */
export async function garantirClienteDoLead(
  leadId: string,
  contaBruta?: string,
): Promise<{ ok?: true; erro?: string }> {
  const conta = contaBruta ? normalizarConta(contaBruta) : null;
  if (contaBruta?.trim() && !conta) {
    return { erro: "Conta inválida — use só os números (mínimo 3 dígitos)." };
  }

  const service = createServiceClient();
  const { data: lead } = await service
    .from("leads")
    .select("id, nome, telefone_e164, customer_id")
    .eq("id", leadId)
    .maybeSingle();
  if (!lead) return { erro: "Lead não encontrado." };

  let customerId = lead.customer_id as string | null;

  // Conta já cadastrada aponta o dono (lotes importados antes da base).
  if (!customerId && conta) {
    const { data } = await service
      .from("customer_accounts")
      .select("customer_id")
      .eq("conta", conta)
      .maybeSingle();
    customerId = (data?.customer_id as string | undefined) ?? null;
  }

  // Telefone já na base também evita duplicar.
  if (!customerId && lead.telefone_e164) {
    const { data } = await service
      .from("customers")
      .select("id")
      .eq("telefone_e164", lead.telefone_e164)
      .maybeSingle();
    customerId = (data?.id as string | undefined) ?? null;
  }

  if (!customerId) {
    const { data: novo, error } = await service
      .from("customers")
      .insert({
        nome_completo: lead.nome,
        telefone_e164: lead.telefone_e164,
        ativo: true,
      })
      .select("id")
      .single();
    if (error) return { erro: `Não deu para criar o cliente: ${error.message}` };
    customerId = novo.id as string;
  }

  if (conta) {
    // ignoreDuplicates: se a conta já pertence a alguém, não rouba — a
    // importação da base resolve conflito de verdade via mesclar_clientes.
    const { error } = await service
      .from("customer_accounts")
      .upsert(
        { customer_id: customerId, conta },
        { onConflict: "conta", ignoreDuplicates: true },
      );
    if (error) {
      return { erro: `Cliente criado, mas a conta não gravou: ${error.message}` };
    }
  }

  await service
    .from("leads")
    .update({ customer_id: customerId })
    .eq("id", leadId);

  // Vendas já registradas para o lead ganham o vínculo retroativo.
  await service
    .from("sales")
    .update({ customer_id: customerId })
    .eq("lead_id", leadId)
    .is("customer_id", null);

  return { ok: true };
}
