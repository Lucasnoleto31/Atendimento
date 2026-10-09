"use client";

import { useEffect, useRef } from "react";

/*
 * A animação do fundo de malha (deriva, parallax e a luz que segue o
 * cursor), num pedaço de JavaScript à parte: fundo-malha.tsx desenha a malha
 * parada em HTML e CSS, e isto só chega depois da tela, pelo
 * animar-malha-depois.tsx. Acha as camadas pelo data-malha do painel.
 */

/** Medidas do kit, bloco 9 (medidas na tela, não gosto). */
const AMPLITUDE = 38;
const RAIO_LUZ = 310;

type Mola = { x: number; y: number; vx: number; vy: number; ax: number; ay: number };

const novaMola = (): Mola => ({ x: 0, y: 0, vx: 0, vy: 0, ax: 0, ay: 0 });

/** Um passo da mola (Euler semi-implícito). Devolve true quando parou. */
function avancar(m: Mola, rigidez: number, amortecimento: number, massa: number, dt: number) {
  m.vx += ((-rigidez * (m.x - m.ax) - amortecimento * m.vx) / massa) * dt;
  m.vy += ((-rigidez * (m.y - m.ay) - amortecimento * m.vy) / massa) * dt;
  m.x += m.vx * dt;
  m.y += m.vy * dt;
  return (
    Math.abs(m.x - m.ax) < 0.05 &&
    Math.abs(m.y - m.ay) < 0.05 &&
    Math.abs(m.vx) < 0.05 &&
    Math.abs(m.vy) < 0.05
  );
}

export function AnimarMalha() {
  const marca = useRef<HTMLSpanElement>(null);

  useEffect(() => {
    const elRaiz = marca.current?.closest<HTMLElement>('[data-malha="raiz"]');
    const elCaixa = elRaiz?.querySelector<HTMLElement>('[data-malha="caixa"]');
    const elCamada = elRaiz?.querySelector<HTMLElement>('[data-malha="camada"]');
    const elLuz = elRaiz?.querySelector<HTMLElement>('[data-malha="luz"]');
    if (!elRaiz || !elCaixa || !elCamada || !elLuz) return;
    const menosMovimento = window.matchMedia(
      "(prefers-reduced-motion: reduce)",
    );
    const fundo = novaMola();
    const foco = novaMola();
    let deriva: Animation | null = null;
    let quadro = 0;
    let anterior = 0;
    let luzAcesa = false;

    const pintar = () => {
      elCaixa.style.transform = `translate3d(${fundo.x}px, ${fundo.y}px, 0)`;
      elLuz.style.transform = `translate3d(${foco.x - RAIO_LUZ}px, ${foco.y - RAIO_LUZ}px, 0)`;
    };

    const passo = (agora: number) => {
      // Aba que volta do segundo plano não dá um salto: o passo tem teto. E
      // piso: o carimbo do primeiro quadro pode vir antes do performance.now()
      // de quem o pediu.
      const dt = Math.min(Math.max(agora - anterior, 0) / 1000, 1 / 30);
      anterior = agora;
      const parouFundo = avancar(fundo, 42, 24, 1, dt);
      const parouLuz = avancar(foco, 55, 24, 0.9, dt);
      pintar();
      quadro = parouFundo && parouLuz ? 0 : requestAnimationFrame(passo);
    };

    const acordar = () => {
      if (quadro) return;
      anterior = performance.now();
      quadro = requestAnimationFrame(passo);
    };

    const aoMover = (evento: PointerEvent) => {
      if (evento.pointerType !== "mouse" || menosMovimento.matches) return;
      const nx = (evento.clientX / window.innerWidth) * 2 - 1;
      const ny = (evento.clientY / window.innerHeight) * 2 - 1;
      fundo.ax = -nx * AMPLITUDE;
      fundo.ay = -ny * AMPLITUDE;
      const caixaRaiz = elRaiz.getBoundingClientRect();
      foco.ax = evento.clientX - caixaRaiz.left;
      foco.ay = evento.clientY - caixaRaiz.top;
      if (!luzAcesa) {
        // A luz nasce onde o cursor está, sem voar do canto até ele.
        foco.x = foco.ax;
        foco.y = foco.ay;
        luzAcesa = true;
        elLuz.style.opacity = "1";
      }
      acordar();
    };

    const aplicarPreferencia = () => {
      if (menosMovimento.matches) {
        deriva?.cancel();
        deriva = null;
        cancelAnimationFrame(quadro);
        quadro = 0;
        Object.assign(fundo, novaMola());
        luzAcesa = false;
        elLuz.style.opacity = "0";
        pintar();
        return;
      }
      deriva ??= elCamada.animate(
        [
          { transform: "scale(1.06)", easing: "ease-in-out" },
          {
            transform: "translate3d(-2.5%, 1.5%, 0) scale(1.1)",
            easing: "ease-in-out",
          },
          { transform: "scale(1.06)" },
        ],
        { duration: 24_000, iterations: Infinity },
      );
    };

    aplicarPreferencia();
    menosMovimento.addEventListener("change", aplicarPreferencia);
    window.addEventListener("pointermove", aoMover, { passive: true });
    return () => {
      menosMovimento.removeEventListener("change", aplicarPreferencia);
      window.removeEventListener("pointermove", aoMover);
      cancelAnimationFrame(quadro);
      deriva?.cancel();
    };
  }, []);

  return <span ref={marca} hidden />;
}
