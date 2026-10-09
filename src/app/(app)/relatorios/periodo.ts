/*
 * O período dos números do Relatório (recebidas, enviadas, mediana da 1ª
 * resposta, Equipe e Resolvidas), escolhido nas pílulas e guardado na URL
 * (?periodo=7d): o voltar do navegador volta ao período anterior. Arquivo
 * puro: a página (servidor) e as pílulas (cliente) leem daqui.
 *
 * "Hoje" vai da meia-noite de Brasília até agora; "7 dias" e "30 dias" são
 * as últimas 7 × 24 h e 30 × 24 h, a mesma janela corrida que o Relatório
 * sempre usou para os 30 dias. O gráfico por dia e o horário de pico não
 * mudam com o período (30 dias e 4 semanas inteiras), e dizem isso no
 * rótulo.
 */

export const PERIODOS = ["hoje", "7d", "30d"] as const;
export type Periodo = (typeof PERIODOS)[number];

/** O de sempre, fora da URL. */
export const PERIODO_PADRAO: Periodo = "30d";

export function lerPeriodo(valor: unknown): Periodo {
  const bruto = Array.isArray(valor) ? valor[0] : valor;
  return typeof bruto === "string" &&
    (PERIODOS as readonly string[]).includes(bruto)
    ? (bruto as Periodo)
    : PERIODO_PADRAO;
}

export function hrefPeriodo(periodo: Periodo): string {
  return periodo === PERIODO_PADRAO
    ? "/relatorios"
    : `/relatorios?periodo=${periodo}`;
}

/** Rótulo da pílula e da coluna do total: "Hoje", "7 dias", "30 dias". */
export function rotuloPeriodo(periodo: Periodo): string {
  return periodo === "hoje" ? "Hoje" : periodo === "7d" ? "7 dias" : "30 dias";
}

/** Título da seção: "Hoje", "Últimos 7 dias", "Últimos 30 dias". */
export function tituloPeriodo(periodo: Periodo): string {
  return periodo === "hoje" ? "Hoje" : `Últimos ${rotuloPeriodo(periodo)}`;
}

/** Para o fim de uma frase: "hoje", "nos últimos 7 dias". */
export function noPeriodo(periodo: Periodo): string {
  return periodo === "hoje"
    ? "hoje"
    : `nos últimos ${rotuloPeriodo(periodo)}`;
}
