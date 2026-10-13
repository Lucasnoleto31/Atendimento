import { AnimarMalhaDepois } from "./animar-malha-depois";

/*
 * O fundo de malha do kit (bloco 9) na ficha padrão. Posições, tamanhos e
 * alfas são os do kit, que manda mantê-los. As matizes saem do acento, e a
 * ficha padrão não tem acento cromático: com saturação zero, cada mancha vira
 * o cinza da luminosidade dela. A base é o fundo escuro da ficha de +4 (o
 * cartão, #151515) a −1 (#080808). A primeira mancha fica por cima. O realce
 * claro embaixo à esquerda é o que dá profundidade; os dois cantos escuros
 * seguram a malha longe da borda.
 *
 * Isto NÃO é o esfumaçado da capa da ficha (#080808 a #2A2A2A). O realce
 * claro em L 76% leva o canto de baixo à esquerda a um cinza médio: medido no
 * print de 1280px, o painel vai de #191919 a #8E8E8E. É o kit ao pé da letra,
 * e o tom final está em aberto com o Artur; os números não mudam sem ele.
 *
 * Mora num elemento com data-theme="dark" (moldura.tsx): o painel é escuro
 * nos dois temas, e o cartão ali é o do tema escuro.
 */
const MALHA = [
  "radial-gradient(70% 55% at 20% 74%, hsl(0 0% 76% / 0.5), transparent 62%)",
  "radial-gradient(105% 85% at 12% 82%, hsl(0 0% 60% / 0.55), transparent 60%)",
  "radial-gradient(85% 70% at 2% 66%, hsl(0 0% 42% / 0.55), transparent 64%)",
  "radial-gradient(105% 95% at 80% 6%, hsl(0 0% 32% / 0.8), transparent 60%)",
  "radial-gradient(75% 62% at 56% 28%, hsl(0 0% 22% / 0.65), transparent 66%)",
  "radial-gradient(120% 110% at 66% 110%, hsl(0 0% 24% / 0.6), transparent 58%)",
  "radial-gradient(75% 70% at 102% 58%, hsl(0 0% 5% / 0.95), transparent 56%)",
  "radial-gradient(60% 55% at 0% 0%, hsl(0 0% 4% / 0.9), transparent 60%)",
  "linear-gradient(145deg, var(--color-cartao), hsl(0 0% 3.3%))",
].join(", ");

/** A luz que segue o cursor: o acento clareado (aqui, branco) a 9%, 4% em
 *  38% do raio e nada a partir de 68%. */
const LUZ =
  "radial-gradient(circle closest-side, hsl(0 0% 100% / 0.09), hsl(0 0% 100% / 0.04) 38%, transparent 68%)";

/**
 * Malha com deriva lenta, parallax do ponteiro e a luz que segue o cursor.
 *
 * - Deriva: 24s, ida e volta, numa camada; parallax em outra, por fora (as
 *   duas na mesma caixa se apagariam).
 * - Parallax: 38px contra o ponteiro, mola lenta (rigidez 42, amortecimento
 *   24), numa caixa 140px maior que o painel de cada lado, para o
 *   deslocamento não descobrir a borda. A caixa tem a altura da tela (svh)
 *   também no celular: a faixa do topo mostra o alto da malha inteira, em vez
 *   de achatar as oito manchas em 64px.
 * - Luz: círculo de 620px em mix-blend-screen, mola um pouco mais rápida
 *   (55, 24, massa .9). Só aparece com mouse: toque e caneta são descartados
 *   pelo pointerType de cada evento.
 * - Com prefers-reduced-motion, a malha fica parada (também se a preferência
 *   mudar com a tela aberta). As animações aqui são da Web Animations API e
 *   de requestAnimationFrame, que a regra do globals.css não alcança.
 *
 * Decorativo: aria-hidden e sem receber ponteiro. A malha parada é HTML e
 * CSS (sai no servidor); o movimento vem depois, em animar-malha.tsx.
 */
export function FundoMalha() {
  return (
    <div
      data-malha="raiz"
      aria-hidden
      className="pointer-events-none absolute inset-0 overflow-hidden"
    >
      <div
        data-malha="caixa"
        className="absolute -inset-x-[140px] -top-[140px] h-[calc(100svh+280px)] will-change-transform"
      >
        <div
          data-malha="camada"
          className="absolute inset-0 will-change-transform"
          style={{ backgroundImage: MALHA, transform: "scale(1.06)" }}
        />
      </div>
      <div
        data-malha="luz"
        className="absolute top-0 left-0 size-[620px] opacity-0 mix-blend-screen transition-opacity duration-[180ms]"
        style={{ backgroundImage: LUZ }}
      />
      <AnimarMalhaDepois />
    </div>
  );
}
