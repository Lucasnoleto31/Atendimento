import { createServiceClient } from "@/lib/supabase/server";

/**
 * Disparo de template move o lead da primeira coluna para a segunda
 * (Novo -> Em Contato).
 *
 * A regra é estreita de propósito: só o kanban padrão e só quem ainda está
 * na primeira coluna. Lead que já avançou não volta nem pula etapa, e o
 * kanban da Carteira (Ativos, Esfriando, Resgate) fica fora — lá a coluna é
 * o estado do cliente, não o andamento do contato.
 */

const CACHE_MS = 5 * 60_000;
let cache: { primeira: string; segunda: string } | null = null;
let cacheExpira = 0;

type Service = ReturnType<typeof createServiceClient>;

async function colunasDoFunil(service: Service) {
  if (cache && Date.now() < cacheExpira) return cache;

  const { data } = await service
    .from("pipeline_stages")
    .select("id, ordem, pipeline:pipelines!inner(padrao)")
    .eq("pipeline.padrao", true)
    .order("ordem")
    .limit(2);

  const etapas = (data ?? []) as unknown as { id: string; ordem: number }[];
  // Funil de uma coluna só: não há para onde mover.
  if (etapas.length < 2) return null;

  cache = { primeira: etapas[0].id, segunda: etapas[1].id };
  cacheExpira = Date.now() + CACHE_MS;
  return cache;
}

/**
 * Devolve quantos leads mudaram de coluna. Falha de banco não interrompe o
 * disparo: a mensagem já saiu, e o kanban desatualizado é o menor problema.
 */
export async function avancarAposDisparo(
  service: Service,
  leadIds: string[],
): Promise<number> {
  if (leadIds.length === 0) return 0;

  try {
    const colunas = await colunasDoFunil(service);
    if (!colunas) return 0;

    const { data: movidos } = await service
      .from("leads")
      .update({ stage_id: colunas.segunda })
      .in("id", leadIds)
      .eq("stage_id", colunas.primeira)
      .select("id");

    const ids = (movidos ?? []).map((l: { id: string }) => l.id);
    if (ids.length === 0) return 0;

    // Quem saiu de "Novo" está em contato — o status acompanha a coluna.
    await service
      .from("leads")
      .update({ status: "em_atendimento" })
      .in("id", ids)
      .eq("status", "novo");

    return ids.length;
  } catch {
    return 0;
  }
}
