import { createServiceClient } from "@/lib/supabase/server";

/**
 * Distribuição automática: com o parâmetro `distribuicao_automatica` = 1,
 * lead novo vai para quem ATENDE (profiles.recebe_leads) com menos
 * atendimentos em aberto. Papel não decide mais: o rodízio antigo filtrava
 * papel = vendedor, só o Aikon passava, e o "rodízio" era de uma pessoa só
 * (1.022 leads nas costas dele). Quem entra na roda é decisão do gestor, no
 * Admin. Usada pelo webhook da Meta.
 */
export async function escolherVendedor(
  service: ReturnType<typeof createServiceClient>,
): Promise<{ id: string; nome: string; email: string } | null> {
  const { data: config } = await service
    .from("settings")
    .select("valor")
    .eq("chave", "distribuicao_automatica")
    .maybeSingle();
  if (Number(config?.valor ?? 0) !== 1) return null;

  let { data: vendedores } = await service
    .from("profiles")
    .select("id, nome, email")
    .eq("ativo", true)
    .eq("recebe_leads", true)
    .order("nome");
  // Banco ainda sem a 0041: cai na regra antiga (papel vendedor).
  if (vendedores === null) {
    const antigo = await service
      .from("profiles")
      .select("id, nome, email")
      .eq("ativo", true)
      .eq("papel", "vendedor")
      .order("nome");
    vendedores = antigo.data;
  }
  const equipe = (vendedores ?? []) as {
    id: string;
    nome: string;
    email: string;
  }[];
  if (equipe.length === 0) return null;

  const { data: abertos } = await service
    .from("leads")
    .select("responsavel_id")
    .eq("status", "em_atendimento")
    .in(
      "responsavel_id",
      equipe.map((v) => v.id),
    );

  const carga = new Map(equipe.map((v) => [v.id, 0]));
  for (const linha of (abertos ?? []) as { responsavel_id: string }[]) {
    carga.set(linha.responsavel_id, (carga.get(linha.responsavel_id) ?? 0) + 1);
  }

  return equipe.reduce((menor, v) =>
    (carga.get(v.id) ?? 0) < (carga.get(menor.id) ?? 0) ? v : menor,
  );
}
