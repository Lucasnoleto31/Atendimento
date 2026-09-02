"use server";

import { perfilAtual } from "@/lib/auth";
import { createClient } from "@/lib/supabase/server";
import { formatarDocumento } from "@/lib/documento";
import { registrarAcesso } from "@/lib/auditoria";

/**
 * Revela o CPF/CNPJ inteiro de um cliente. O RLS decide se a pessoa pode
 * ver o cliente; aqui só fica o registro de que ela REVELOU — é isso que o
 * log de acesso mostra ao compliance.
 */
export async function revelarDocumento(
  customerId: string,
): Promise<{ documento?: string; erro?: string }> {
  const perfil = await perfilAtual();
  if (!perfil) return { erro: "Sessão expirada. Entre novamente." };

  const supabase = await createClient();
  const { data, error } = await supabase
    .from("customers")
    .select("documento, nome_completo")
    .eq("id", customerId)
    .maybeSingle();
  if (error) return { erro: "Não deu para ler o documento." };
  if (!data) return { erro: "Cliente fora do seu alcance." };
  if (!data.documento)
    return { erro: "Este cliente não tem documento cadastrado." };

  registrarAcesso(perfil.id, "revelou_documento", {
    customer_id: customerId,
    nome: data.nome_completo,
  });
  return { documento: formatarDocumento(data.documento) };
}
