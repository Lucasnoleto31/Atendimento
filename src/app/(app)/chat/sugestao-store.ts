"use client";

/**
 * A resposta sugerida do desenho do Chat da Mesa: o palco pede a sugestão à
 * IA quando abre uma conversa em que o cliente falou por último, e o
 * compositor a mostra como balão fantasma — Tab aceita, digitar ignora.
 *
 * Store de módulo (mesmo padrão da assinaturaStore): palco e compositor são
 * componentes distantes na árvore, e prop-drilling atravessaria a Janela
 * inteira por causa de um textinho.
 */

type Sugestao = { leadId: string; texto: string } | null;

let atual: Sugestao = null;
const ouvintes = new Set<() => void>();

export const sugestaoStore = {
  subscribe(cb: () => void) {
    ouvintes.add(cb);
    return () => {
      ouvintes.delete(cb);
    };
  },
  ler(): Sugestao {
    return atual;
  },
  lerNoServidor(): Sugestao {
    return null;
  },
  definir(leadId: string, texto: string) {
    atual = { leadId, texto };
    ouvintes.forEach((cb) => cb());
  },
  limpar(leadId?: string) {
    if (leadId && atual && atual.leadId !== leadId) return;
    atual = null;
    ouvintes.forEach((cb) => cb());
  },
};
