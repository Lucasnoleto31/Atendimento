/**
 * Os parâmetros de campanha que o link do anúncio traz para a /captura
 * (?campanha=&etiqueta=&utm_*) e que o formulário leva escondidos até a
 * action. Mora fora do actions.ts porque arquivo "use server" só exporta
 * função assíncrona, e a página também lê esta lista.
 */
export const CHAVES_RASTREIO = [
  "campanha",
  "etiqueta",
  "utm_source",
  "utm_medium",
  "utm_campaign",
  "utm_content",
] as const;

export type ChaveRastreio = (typeof CHAVES_RASTREIO)[number];

export type Rastreio = { chave: ChaveRastreio; valor: string }[];

/** Teto de todo texto que chega da URL ou do formulário. */
export const MAX_TEXTO = 120;

/**
 * Texto que veio de fora (URL ou formulário): sem caractere de controle,
 * espaços repetidos viram um, curto. O que não é texto vira vazio.
 */
export function limpar(valor: unknown): string {
  return (typeof valor === "string" ? valor : "")
    .replace(/\p{Cc}/gu, " ")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, MAX_TEXTO)
    .trim();
}

/** Os parâmetros preenchidos, na ordem da lista. */
export function lerRastreio(
  ler: (chave: ChaveRastreio) => unknown,
): Rastreio {
  return CHAVES_RASTREIO.flatMap((chave) => {
    const valor = limpar(ler(chave));
    return valor ? [{ chave, valor }] : [];
  });
}
