/**
 * Os avisos que a ficha sabe escrever, pedidos pela URL (?aviso=). Na URL
 * vai só o código; o texto sai da ficha, com os dados que ela mesma leu.
 * Código fora desta lista é ignorado: texto livre da URL não chega à tela.
 *
 * Arquivo puro: a action de cadastro e a página leem daqui.
 */

/** O cadastro achou o telefone num contato que já existe e abriu a ficha dele. */
export const AVISO_DUPLICADO = "duplicado";

export type AvisoFicha = typeof AVISO_DUPLICADO;

/** O ?aviso= reduzido a um código conhecido, ou null. */
export function lerAviso(valor: unknown): AvisoFicha | null {
  const bruto = Array.isArray(valor) ? valor[0] : valor;
  return bruto === AVISO_DUPLICADO ? AVISO_DUPLICADO : null;
}
