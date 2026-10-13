/**
 * O código de nova senha, as peças puras. O código nasce e é conferido no
 * Supabase (generateLink/verifyOtp) — aqui não há segredo nem assinatura,
 * só o prazo prometido no e-mail e a limpeza do que a pessoa digita.
 */

/**
 * Prazo prometido no e-mail ("Vale por 10 minutos"). O prazo do Supabase é
 * o do painel (1 hora por padrão); a tela da senha nova corta no prometido.
 */
export const CODIGO_VALIDADE_MS = 10 * 60 * 1000;

/**
 * O que a pessoa digitou, só com os dígitos. Copiar do e-mail ou do celular
 * traz espaço e hífen junto ("123 456", "123-456"); isso sai. Letra ou
 * tamanho fora da faixa devolve null.
 */
export function normalizarCodigo(
  bruto: unknown,
  digitos: { min: number; max: number },
): string | null {
  if (typeof bruto !== "string") return null;
  const limpo = bruto.replace(/[\s\-‐-―−]/g, "");
  if (!/^\d+$/.test(limpo)) return null;
  if (limpo.length < digitos.min || limpo.length > digitos.max) return null;
  return limpo;
}
