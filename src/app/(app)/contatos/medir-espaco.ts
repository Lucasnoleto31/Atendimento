/**
 * Quanto cabe entre o pé do botão e o pé da área visível, gravado na
 * variável --espaco-menu da caixa do botão (o menu herda). 6px de vão até o
 * menu e 16px de folga embaixo. Igual ao da fila. Devolve o espaço medido
 * (antes do piso de 160px): o "Trocar" da ficha usa para saber se cabe.
 */
export function medirEspaco(caixa: HTMLElement | null): number | null {
  if (!caixa) return null;
  const vv = window.visualViewport;
  const fundoDaTela = vv ? vv.height + vv.offsetTop : window.innerHeight;
  const espaco = Math.floor(
    fundoDaTela - caixa.getBoundingClientRect().bottom - 6 - 16,
  );
  caixa.style.setProperty("--espaco-menu", `${Math.max(espaco, 160)}px`);
  return espaco;
}
