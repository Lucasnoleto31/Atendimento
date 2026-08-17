"use server";

import { redirect } from "next/navigation";
import { revalidatePath } from "next/cache";
import { perfilAtual } from "@/lib/auth";
import { garantirClienteDoLead } from "@/lib/clientes";

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
