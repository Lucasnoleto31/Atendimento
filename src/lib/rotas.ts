/**
 * Para onde vai quem acabou de entrar (senha, código do e-mail, nova senha)
 * e quem abre o /entrar já logado. Uma constante só porque são vários
 * pontos de saída: com o literal repetido em cada um, basta esquecer um na
 * troca da tela inicial para algum login terminar em 404. Arquivo puro (sem
 * imports de servidor): o middleware também lê daqui.
 */
export const DESTINO_PADRAO = "/chat";

const ORIGEM_FICTICIA = "https://x.invalid";

/**
 * O `?proximo=` do login reduzido a um caminho deste site; qualquer outra
 * coisa vira DESTINO_PADRAO. O valor chega de um link que qualquer um monta,
 * e depois da senha e do código ele vai direto para window.location.assign.
 *
 * Comparar prefixos ("/" sim, "//" não) não basta: o navegador apaga TAB e
 * quebra de linha do endereço antes de resolvê-lo, então "/\t/evil.com" passa
 * no teste e abre https://evil.com/. Por isso o valor com espaço, caractere de
 * controle ou barra invertida é recusado, e o resto passa pelo mesmo parser de
 * URL do navegador: só fica o que continua na origem fictícia, e sai o
 * caminho já normalizado por ele. A normalização também cria "//": o "/.//x"
 * vira o caminho "//x", que no assign seria o site x. Esse sai recusado.
 */
export function destinoSeguro(proximo: unknown): string {
  if (typeof proximo !== "string" || !proximo.startsWith("/")) {
    return DESTINO_PADRAO;
  }
  if (/[\s\\\p{Cc}]/u.test(proximo)) return DESTINO_PADRAO;
  try {
    const url = new URL(proximo, ORIGEM_FICTICIA);
    if (url.origin !== ORIGEM_FICTICIA) return DESTINO_PADRAO;
    const caminho = url.pathname + url.search + url.hash;
    return caminho.startsWith("//") ? DESTINO_PADRAO : caminho;
  } catch {
    return DESTINO_PADRAO;
  }
}
