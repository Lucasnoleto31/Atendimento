"use server";

import { redirect } from "next/navigation";
import { revalidatePath } from "next/cache";
import { perfilQueEscreve } from "@/lib/auth";
import { garantirClienteDoLead } from "@/lib/clientes";

// A edição dos dados do cliente saiu daqui na Ficha 360 (6.2): a aba Cliente
// usa a MESMA salvarFichaCliente da carteira — um formulário, uma checagem
// de papel, um comportamento (inclusive telefone e gatilho 0020).

/** Lead ganho sem registro na base vira cliente (com conta, se informada). */
export async function virarCliente(formData: FormData) {
  const perfil = await perfilQueEscreve();
  if (!perfil) redirect("/entrar");

  const leadId = String(formData.get("lead_id") ?? "");
  if (!leadId) redirect("/leads");
  const conta = String(formData.get("conta") ?? "");

  const resultado = await garantirClienteDoLead(leadId, conta);
  revalidatePath(`/leads/${leadId}`);
  // O cliente recém-criado precisa aparecer na listagem da carteira.
  revalidatePath("/carteira");
  redirect(
    `/leads/${leadId}?aba=cliente&aviso=${encodeURIComponent(
      resultado.erro ?? "Lead vinculado à base de clientes.",
    )}`,
  );
}
