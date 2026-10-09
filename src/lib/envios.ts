import type { createServiceClient } from "@/lib/supabase/server";
import { agoraEmBrasilia } from "@/lib/format";

/**
 * Teto diário de envios automáticos do número.
 *
 * O incidente de 24/08 (1.015 templates num dia, qualidade do número caiu
 * para amarelo) mostrou que o limite precisa ser do NÚMERO, não de cada
 * disparo: várias campanhas ativas somam no mesmo dia. Todo envio
 * automático debita de settings.envios_teto_dia. A rampa de aquecimento é
 * manual e deliberada: o gestor sobe o teto em Configurações conforme a
 * qualidade se mantém verde (60 → 100 → 150), em vez de um algoritmo decidir
 * sozinho.
 */

const TETO_ENVIOS_PADRAO = 100;

/** Marca gravada em lead_interactions.metadados.via pelo disparo em massa. */
export const VIA_DISPARO = "campanha";

type Cliente = ReturnType<typeof createServiceClient>;

/** settings.envios_teto_dia como número; ausente ou inválido vira o padrão. */
export function tetoDeEnvios(valor: unknown): number {
  return Number(valor ?? TETO_ENVIOS_PADRAO) || TETO_ENVIOS_PADRAO;
}

/**
 * Envios automáticos desde o começo do dia (Brasília). É a mesma conta no
 * motor e na tela de disparos, por isso mora aqui: contada no banco, nunca em
 * memória, porque cada instância da Vercel tem a sua.
 */
export function contarEnviosDesde(cliente: Cliente, inicioDoDia: string) {
  return cliente
    .from("lead_interactions")
    .select("id", { count: "exact", head: true })
    .eq("tipo", "mensagem_enviada")
    .gte("criado_em", inicioDoDia)
    .eq("metadados->>via", VIA_DISPARO);
}

/** Quantos envios automáticos ainda cabem hoje (Brasília). */
export async function orcamentoEnviosRestante(service: Cliente): Promise<number> {
  const [{ data: cfg }, { count }] = await Promise.all([
    service
      .from("settings")
      .select("valor")
      .eq("chave", "envios_teto_dia")
      .maybeSingle(),
    contarEnviosDesde(service, agoraEmBrasilia().inicioDoDia),
  ]);
  return Math.max(0, tetoDeEnvios(cfg?.valor) - (count ?? 0));
}
