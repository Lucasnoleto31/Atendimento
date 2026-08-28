import { createServiceClient } from "@/lib/supabase/server";
import { hojeEmBrasilia } from "@/lib/format";

/**
 * O giro é uma materialized view (0044): calcula uma vez, todo mundo lê de
 * graça. Mas a janela de 30 dias é relativa a hoje — a foto envelhece mesmo
 * sem importação. Este guardião roda no batimento do app e garante um
 * refresh por dia (Brasília); a importação de lotes chama o refresh direto.
 */

let ultimaVerificacao = 0;
const INTERVALO_MS = 10 * 60_000;

export async function garantirGiroFresco(): Promise<void> {
  if (Date.now() - ultimaVerificacao < INTERVALO_MS) return;
  ultimaVerificacao = Date.now();
  try {
    const service = createServiceClient();
    const { data } = await service
      .from("settings")
      .select("valor")
      .eq("chave", "giro_atualizado_em")
      .maybeSingle();
    // Sem a 0044 a chave não existe e o rpc falharia: não faz nada.
    if (!data) return;
    const atualizadoEm = String(data.valor ?? "").replace(/^"|"$/g, "");
    if (atualizadoEm.slice(0, 10) === hojeEmBrasilia()) return;
    await service.rpc("atualizar_giro");
  } catch {
    // Foto de ontem ainda é utilizável; o próximo batimento tenta de novo.
  }
}
