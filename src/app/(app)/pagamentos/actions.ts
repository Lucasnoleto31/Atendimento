"use server";

import { redirect } from "next/navigation";
import { revalidatePath } from "next/cache";
import { createClient } from "@/lib/supabase/server";
import { perfilAtual } from "@/lib/auth";

/**
 * Registra a venda a partir da ficha do lead. A comissão é copiada do
 * produto no momento do registro — reajustes futuros não mexem no histórico.
 */
export async function registrarVenda(formData: FormData) {
  const perfil = await perfilAtual();
  if (!perfil) redirect("/entrar");

  const leadId = String(formData.get("lead_id") ?? "");
  const productId = String(formData.get("product_id") ?? "");
  const vendedorEscolhido = String(formData.get("vendedor_id") ?? "");
  const marcarGanho = formData.get("marcar_ganho") === "on";
  const observacao = String(formData.get("observacao") ?? "").trim();

  function falhar(aviso: string): never {
    redirect(`/leads/${leadId}?aviso=${encodeURIComponent(aviso)}`);
  }

  if (!leadId) redirect("/leads");
  if (!productId) falhar("Escolha o produto vendido.");

  const ehGestor = perfil.papel === "admin" || perfil.papel === "gestor";
  // Vendedor só lança venda no próprio nome (mesma regra do RLS).
  const vendedorId = ehGestor && vendedorEscolhido ? vendedorEscolhido : perfil.id;

  const supabase = await createClient();

  const [{ data: produto }, { data: lead }] = await Promise.all([
    supabase
      .from("products")
      .select("valor_comissao_centavos, ativo, nome")
      .eq("id", productId)
      .maybeSingle(),
    supabase
      .from("leads")
      .select("customer_id")
      .eq("id", leadId)
      .maybeSingle(),
  ]);

  if (!produto) falhar("Produto não encontrado.");
  if (!produto.ativo) falhar(`O produto ${produto.nome} está inativo.`);
  if (!lead) redirect("/leads");

  const { error } = await supabase.from("sales").insert({
    lead_id: leadId,
    customer_id: lead.customer_id,
    product_id: productId,
    vendedor_id: vendedorId,
    valor_comissao_centavos: produto.valor_comissao_centavos,
    observacao: observacao || null,
  });

  if (error) falhar(`Não deu para registrar: ${error.message}`);

  if (marcarGanho) {
    await supabase.from("leads").update({ status: "ganho" }).eq("id", leadId);
  }

  revalidatePath(`/leads/${leadId}`);
  revalidatePath("/pagamentos");
  revalidatePath("/relatorios");
  redirect(`/leads/${leadId}?aviso=${encodeURIComponent("Venda registrada.")}`);
}

/** Cancela (não apaga): a operação sai dos totais mas fica no histórico. */
export async function cancelarVenda(formData: FormData) {
  const perfil = await perfilAtual();
  if (!perfil) redirect("/entrar");

  const id = String(formData.get("id") ?? "");
  if (!id) redirect("/pagamentos");

  const supabase = await createClient();
  const { error } = await supabase
    .from("sales")
    .update({ status: "cancelada" })
    .eq("id", id);

  revalidatePath("/pagamentos");
  revalidatePath("/relatorios");
  redirect(
    error
      ? `/pagamentos?aviso=${encodeURIComponent(`Não deu para cancelar: ${error.message}`)}`
      : "/pagamentos",
  );
}
