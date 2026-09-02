import type { createServiceClient } from "@/lib/supabase/server";
import { SLA_PADRAO, type ReguaSla } from "@/lib/sla";

/**
 * As réguas de conversão vivem em settings (0069) e são editáveis em
 * Configurações. Toda leitura tolera ausência: sem a migração, valem os
 * padrões e nada quebra.
 */
export const REGUAS_PADRAO = {
  sla: SLA_PADRAO,
  reabrirPerdidoAoResponder: true,
  nutrirPerdidoAposDias: 30,
  travarCpfDuplicado: true,
};

type Leitor = {
  from: (t: string) => {
    select: (c: string) => {
      in: (
        col: string,
        vals: string[],
      ) => PromiseLike<{
        data: { chave: string; valor: unknown }[] | null;
        error: unknown;
      }>;
    };
  };
};

const CHAVES = [
  "sla_atencao_min",
  "minutos_alerta_espera",
  "sla_horario_comercial",
  "reabrir_perdido_ao_responder",
  "nutrir_perdido_apos_dias",
  "travar_cpf_duplicado",
];

function numero(v: unknown, padrao: number): number {
  const n = Number(typeof v === "string" ? v.replace(/"/g, "") : v);
  return Number.isFinite(n) && n > 0 ? n : padrao;
}
function ligado(v: unknown, padrao: boolean): boolean {
  if (v === null || v === undefined) return padrao;
  const t = String(v).replace(/"/g, "");
  return t !== "0" && t !== "false";
}

export async function lerReguasConversao(
  supabase: Leitor | ReturnType<typeof createServiceClient>,
): Promise<typeof REGUAS_PADRAO> {
  const { data, error } = await (supabase as Leitor)
    .from("settings")
    .select("chave, valor")
    .in("chave", CHAVES);
  if (error || !data) return REGUAS_PADRAO;
  const mapa = new Map(data.map((l) => [l.chave, l.valor]));
  const sla: ReguaSla = {
    atencaoMin: numero(mapa.get("sla_atencao_min"), SLA_PADRAO.atencaoMin),
    alarmeMin: numero(mapa.get("minutos_alerta_espera"), SLA_PADRAO.alarmeMin),
    horarioComercial: ligado(
      mapa.get("sla_horario_comercial"),
      SLA_PADRAO.horarioComercial,
    ),
  };
  return {
    // Alarme antes da atenção seria régua invertida: o alarme manda.
    sla: { ...sla, atencaoMin: Math.min(sla.atencaoMin, sla.alarmeMin) },
    reabrirPerdidoAoResponder: ligado(
      mapa.get("reabrir_perdido_ao_responder"),
      true,
    ),
    nutrirPerdidoAposDias: numero(mapa.get("nutrir_perdido_apos_dias"), 30),
    travarCpfDuplicado: ligado(mapa.get("travar_cpf_duplicado"), true),
  };
}
