/**
 * Paleta das etiquetas, a única fonte: a escolha de Configurações, o ponto da
 * lista de Configurações e o ponto da Etiqueta e do Chip no resto do app
 * (contatos/cor-etiqueta.ts só repassa daqui). A cor que a equipe dá vira só
 * um ponto de 8px antes do nome, nunca o fundo; o nome aparece sempre junto,
 * porque cor não pode ser o único portador de informação.
 *
 * A chave gravada no banco não muda ("azul" continua "azul"); o que muda é o
 * que a tela mostra para ela. A ficha não tem azul (o primary virou a tinta)
 * e, na tinta, o ponto sumiria dentro do Chip ligado, que é tinta também: o
 * "azul" é o Grafite, no cinza secundário, que aparece no chip ligado e no
 * desligado, nos dois temas. "Neutro" e etiqueta sem cor ficam sem ponto, e é
 * isso que os separa do Grafite.
 */

export type CorEtiqueta = "azul" | "ambar" | "verde" | "vermelho" | "neutro";

export const CORES_ETIQUETA: {
  chave: CorEtiqueta;
  rotulo: string;
  /** Cor do ponto (token do tema, troca sozinho no escuro); null = sem ponto. */
  ponto: string | null;
}[] = [
  { chave: "azul", rotulo: "Grafite", ponto: "var(--color-texto-2)" },
  { chave: "ambar", rotulo: "Âmbar", ponto: "var(--color-accent-500)" },
  { chave: "verde", rotulo: "Verde", ponto: "var(--color-success)" },
  { chave: "vermelho", rotulo: "Vermelho", ponto: "var(--color-danger)" },
  { chave: "neutro", rotulo: "Neutro", ponto: null },
];

/** O ponto da etiqueta, ou null quando ela não tem cor (neutro, vazio ou
 *  chave desconhecida). */
export function pontoDaEtiqueta(cor: string | null | undefined): string | null {
  return CORES_ETIQUETA.find((c) => c.chave === cor)?.ponto ?? null;
}
