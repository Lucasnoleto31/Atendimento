"use client";

/**
 * Registro de ecos do Realtime.
 *
 * Quando a própria aba envia uma mensagem, a action devolve a interação
 * criada e a Janela já a coloca na tela. O INSERT correspondente volta pelo
 * Supabase Realtime segundos depois: sem este registro, esse eco dispararia
 * uma recarga da conversa — jogando fora o estado local do compositor por
 * uma mensagem que já está lá.
 *
 * Módulo, não estado de componente: a Janela registra no instante em que a
 * action responde, sem re-render, e o assinante do tempo real consome.
 */

const ecosIgnorados = new Set<string>();

/** A Janela chama ao receber a interação criada pela action de envio. */
export function ignorarEcoRealtime(id: string) {
  ecosIgnorados.add(id);
  // Higiene: o eco consome o id ao chegar; se nunca chegar (canal caído),
  // o conjunto não pode crescer para sempre.
  if (ecosIgnorados.size > 50) {
    const primeiro = ecosIgnorados.values().next().value;
    if (primeiro !== undefined) ecosIgnorados.delete(primeiro);
  }
}

/**
 * O assinante do tempo real pergunta: este INSERT é eco do nosso envio?
 * Consome o id — o mesmo eco não é perguntado duas vezes.
 */
export function consumirEcoRealtime(id: string): boolean {
  return ecosIgnorados.delete(id);
}
