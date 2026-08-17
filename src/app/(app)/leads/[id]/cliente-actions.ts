"use server";

import { redirect } from "next/navigation";
import { revalidatePath } from "next/cache";
import { createServiceClient } from "@/lib/supabase/server";
import { perfilAtual } from "@/lib/auth";
import { garantirClienteDoLead, parsearContas } from "@/lib/clientes";

/** Lead ganho sem registro na base vira cliente (com conta, se informada). */
export async function virarCliente(formData: FormData) {
  const perfil = await perfilAtual();
  if (!perfil) redirect("/entrar");

  const leadId = String(formData.get("lead_id") ?? "");
  if (!leadId) redirect("/leads");
  const conta = String(formData.get("conta") ?? "");

  const resultado = await garantirClienteDoLead(leadId, conta);
  revalidatePath(`/leads/${leadId}`);
  redirect(
    `/leads/${leadId}?aviso=${encodeURIComponent(
      resultado.erro ?? "Lead vinculado à base de clientes.",
    )}`,
  );
}

/**
 * Edição manual dos dados do cliente (gestor/admin). A importação da base
 * continua sendo a fonte principal — aqui é o ajuste fino: CPF, e-mail,
 * abertura, situação e contas adicionais.
 */
export async function atualizarCliente(formData: FormData) {
  const perfil = await perfilAtual();
  if (!perfil) redirect("/entrar");

  const leadId = String(formData.get("lead_id") ?? "");
  const customerId = String(formData.get("customer_id") ?? "");
  if (!leadId || !customerId) redirect("/leads");

  function falhar(aviso: string): never {
    redirect(`/leads/${leadId}?aviso=${encodeURIComponent(aviso)}`);
  }

  if (perfil.papel !== "admin" && perfil.papel !== "gestor") {
    falhar("Só gestor ou admin edita dados do cliente.");
  }

  const documento = String(formData.get("documento") ?? "").replace(/\D/g, "");
  if (documento && documento.length !== 11 && documento.length !== 14) {
    falhar("CPF/CNPJ inválido — 11 dígitos (CPF) ou 14 (CNPJ).");
  }
  const email = String(formData.get("email") ?? "").trim();
  const abertura = String(formData.get("conta_aberta_em") ?? "").trim();
  const ativo = String(formData.get("situacao") ?? "ativa") === "ativa";

  const parse = parsearContas(String(formData.get("contas") ?? ""));
  if ("erro" in parse) falhar(parse.erro);

  const service = createServiceClient();
  const { error } = await service
    .from("customers")
    .update({
      documento: documento || null,
      email: email || null,
      conta_aberta_em: abertura || null,
      ativo,
    })
    .eq("id", customerId);
  if (error) falhar(`Não deu para salvar: ${error.message}`);

  if (parse.contas.length > 0) {
    const { error: erroContas } = await service
      .from("customer_accounts")
      .upsert(
        parse.contas.map((conta) => ({ customer_id: customerId, conta })),
        { onConflict: "conta", ignoreDuplicates: true },
      );
    if (erroContas) falhar(`Dados salvos, mas as contas não: ${erroContas.message}`);
  }

  revalidatePath(`/leads/${leadId}`);
  redirect(
    `/leads/${leadId}?aviso=${encodeURIComponent("Dados do cliente atualizados.")}`,
  );
}
