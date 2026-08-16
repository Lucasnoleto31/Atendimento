/**
 * Paleta das etiquetas — fechada nos tokens do design system. A cor serve de
 * reforço visual; o nome da etiqueta aparece sempre junto, porque cor não
 * pode ser o único portador de informação.
 */

export type CorEtiqueta = "azul" | "ambar" | "verde" | "vermelho" | "neutro";

export const CORES_ETIQUETA: {
  chave: CorEtiqueta;
  rotulo: string;
  /** Chip: fundo + texto. */
  chip: string;
  /** Faixa da linha na lista de conversas (só a borda esquerda tem largura). */
  faixa: string;
  /** Borda esquerda de um elemento que já tem borda nos quatro lados. */
  faixaLateral: string;
  /** Ponto sólido, para densidade máxima (card do kanban). */
  ponto: string;
}[] = [
  {
    chave: "azul",
    rotulo: "Azul",
    chip: "bg-primary-50 text-primary-900",
    faixa: "border-primary-600",
    faixaLateral: "border-l-primary-600",
    ponto: "bg-primary-600",
  },
  {
    chave: "ambar",
    rotulo: "Âmbar",
    chip: "bg-accent-100 text-accent-700",
    faixa: "border-accent-500",
    faixaLateral: "border-l-accent-500",
    ponto: "bg-accent-500",
  },
  {
    chave: "verde",
    rotulo: "Verde",
    chip: "bg-success-bg text-success",
    faixa: "border-success",
    faixaLateral: "border-l-success",
    ponto: "bg-success",
  },
  {
    chave: "vermelho",
    rotulo: "Vermelho",
    chip: "bg-danger-bg text-danger",
    faixa: "border-danger",
    faixaLateral: "border-l-danger",
    ponto: "bg-danger",
  },
  {
    chave: "neutro",
    rotulo: "Neutro",
    chip: "bg-neutral-100 text-neutral-600",
    faixa: "border-neutral-400",
    faixaLateral: "border-l-neutral-400",
    ponto: "bg-neutral-400",
  },
];

const PADRAO = CORES_ETIQUETA[CORES_ETIQUETA.length - 1];

export function estiloEtiqueta(cor: string | null | undefined) {
  return CORES_ETIQUETA.find((c) => c.chave === cor) ?? PADRAO;
}
