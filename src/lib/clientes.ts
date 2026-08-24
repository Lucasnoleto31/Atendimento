import { createServiceClient } from "@/lib/supabase/server";
import { normalizarConta } from "@/lib/imports/tabular";
import { variantesTelefone } from "@/lib/csv";

/**
 * Lead ganho vira cliente: cria (ou encontra, por conta e por telefone) o
 * registro em customers, grava a conta informada e vincula lead e vendas.
 *
 * A importação da base enriquece esse mesmo cliente depois — o casamento de
 * lá é por conta primeiro e telefone em seguida (aplicarClientes), então o
 * registro criado aqui nunca duplica: a linha do diversificador só completa
 * CPF, e-mail e data de abertura.
 */
/** "12345, 67890" (vírgula/espaço) -> lista normalizada, ou o erro da parte inválida. */
export function parsearContas(
  brutas: string,
): { contas: string[] } | { erro: string } {
  const partes = brutas
    .split(/[,;\s]+/)
    .map((p) => p.trim())
    .filter(Boolean);
  const contas: string[] = [];
  for (const parte of partes) {
    const conta = normalizarConta(parte);
    if (!conta) {
      return {
        erro: `Conta inválida: "${parte}" — use só os números (mínimo 3 dígitos).`,
      };
    }
    if (!contas.includes(conta)) contas.push(conta);
  }
  return { contas };
}

export async function garantirClienteDoLead(
  leadId: string,
  contasBrutas?: string,
): Promise<{ ok?: true; erro?: string }> {
  const parse = parsearContas(contasBrutas ?? "");
  if ("erro" in parse) return { erro: parse.erro };
  const { contas } = parse;

  const service = createServiceClient();
  const { data: lead } = await service
    .from("leads")
    .select("id, nome, telefone_e164, customer_id")
    .eq("id", leadId)
    .maybeSingle();
  if (!lead) return { erro: "Lead não encontrado." };

  // CPF/CNPJ dito no chat (0018) — consulta separada, tolerante à coluna ausente.
  const { data: docLinha } = await service
    .from("leads")
    .select("documento")
    .eq("id", leadId)
    .maybeSingle();
  const documentoLead = (docLinha?.documento as string | null | undefined) ?? null;

  let customerId = lead.customer_id as string | null;

  // Documento é a identidade mais forte: se a base já tem o CPF, é ele que manda.
  if (!customerId && documentoLead) {
    const { data } = await service
      .from("customers")
      .select("id")
      .eq("documento", documentoLead)
      .limit(1)
      .maybeSingle();
    customerId = (data?.id as string | undefined) ?? null;
  }

  // Conta já cadastrada aponta o dono (lotes importados antes da base).
  if (!customerId && contas.length > 0) {
    const { data } = await service
      .from("customer_accounts")
      .select("customer_id")
      .in("conta", contas)
      .limit(1)
      .maybeSingle();
    customerId = (data?.customer_id as string | undefined) ?? null;
  }

  // Telefone já na base também evita duplicar — nas duas grafias do nono
  // dígito, senão o cliente que já existe vira um segundo cadastro.
  if (!customerId && lead.telefone_e164) {
    const { data } = await service
      .from("customers")
      .select("id")
      .in("telefone_e164", variantesTelefone(lead.telefone_e164))
      .limit(1)
      .maybeSingle();
    customerId = (data?.id as string | undefined) ?? null;
  }

  if (!customerId) {
    const { data: novo, error } = await service
      .from("customers")
      .insert({
        nome_completo: lead.nome,
        telefone_e164: lead.telefone_e164,
        documento: documentoLead,
        ativo: true,
      })
      .select("id")
      .single();
    if (error) return { erro: `Não deu para criar o cliente: ${error.message}` };
    customerId = novo.id as string;
  }

  if (contas.length > 0) {
    // ignoreDuplicates: conta que já pertence a alguém não é roubada — a
    // importação da base resolve conflito de verdade via mesclar_clientes.
    const { error } = await service
      .from("customer_accounts")
      .upsert(
        contas.map((conta) => ({ customer_id: customerId, conta })),
        { onConflict: "conta", ignoreDuplicates: true },
      );
    if (error) {
      return { erro: `Cliente criado, mas as contas não gravaram: ${error.message}` };
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
