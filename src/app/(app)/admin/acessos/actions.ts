"use server";

import { createClient } from "@/lib/supabase/server";
import { perfilAtivo } from "@/lib/auth";
import { veTudo } from "@/lib/papeis";
import { consultarLog, LIMITE_LOG, paraLinha, type LinhaLog } from "./consulta";
import { lerFiltrosLog } from "./url";

/**
 * O "Carregar mais" do Log de acesso: os próximos registros dos mesmos
 * filtros (a query da tela), mais velhos que o último que a tela tem. Só
 * lê.
 */
export async function carregarMaisLog(
  query: string,
  antes: string,
): Promise<{ linhas: LinhaLog[]; temMais: boolean } | { erro: string }> {
  const perfil = await perfilAtivo();
  if (!perfil || !veTudo(perfil.papel)) {
    return { erro: "Só gestão e compliance veem o log." };
  }
  if (typeof antes !== "string" || Number.isNaN(Date.parse(antes))) {
    return { erro: "Recarregue a página e tente de novo." };
  }
  const filtros = lerFiltrosLog(new URLSearchParams(String(query ?? "")));
  const supabase = await createClient();
  const { registros, erro } = await consultarLog(supabase, filtros, { antes });
  if (erro) return { erro: `Não deu para ler o log: ${erro}` };
  return {
    linhas: registros.map(paraLinha),
    temMais: registros.length === LIMITE_LOG,
  };
}
