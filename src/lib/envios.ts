import type { createServiceClient } from "@/lib/supabase/server";
import { agoraEmBrasilia } from "@/lib/format";

/**
 * Orçamento ÚNICO de envios automáticos por dia.
 *
 * O incidente de 24/08 (1.015 templates num dia, qualidade do número caiu
 * para amarelo) aconteceu porque cada motor tinha teto próprio e ninguém
 * somava: cadência + campanhas + disparo manual saíram juntos. A resposta da
 * época — desligar a cadência de aquisição — parou o follow-up de 1.949
 * leads.
 *
 * Agora todos os envios automáticos debitam do MESMO orçamento
 * (settings.envios_teto_dia). A rampa de aquecimento é manual e deliberada:
 * o gestor sobe o teto em Configurações conforme a qualidade se mantém
 * verde (60 → 100 → 150), em vez de um algoritmo decidir sozinho.
 */

const TETO_PADRAO = 100;

type Service = ReturnType<typeof createServiceClient>;

/** Quantos envios automáticos ainda cabem hoje (Brasília). */
export async function orcamentoEnviosRestante(service: Service): Promise<number> {
  const { data: cfg } = await service
    .from("settings")
    .select("valor")
    .eq("chave", "envios_teto_dia")
    .maybeSingle();
  const teto = Number(cfg?.valor ?? TETO_PADRAO) || TETO_PADRAO;

  const inicioDia = agoraEmBrasilia().inicioDoDia;
  const { count } = await service
    .from("lead_interactions")
    .select("id", { count: "exact", head: true })
    .eq("tipo", "mensagem_enviada")
    .gte("criado_em", inicioDia)
    .in("metadados->>via", ["cadencia", "campanha", "disparo"]);

  // O resumo diário do gestor (7.2) não tem lead — não vira interação. O
  // débito dele vive na trilha de auditoria e entra na mesma conta.
  const { count: resumos } = await service
    .from("auditoria")
    .select("id", { count: "exact", head: true })
    .eq("acao", "resumo_gestor")
    .gte("criado_em", inicioDia);

  return Math.max(0, teto - (count ?? 0) - (resumos ?? 0));
}
