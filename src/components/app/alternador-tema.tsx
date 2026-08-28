"use client";

import { Moon, Sun } from "lucide-react";

const UM_ANO_EM_SEGUNDOS = 60 * 60 * 24 * 365;

/**
 * Alterna claro ↔ escuro sem reload: trocar data-theme no <html> já troca os
 * tokens (os utilitários resolvem para var(--color-*)). O cookie `tema` é a
 * fonte da verdade — o layout raiz o lê no SSR, então a próxima navegação já
 * vem com o tema certo; o localStorage é só espelho para leitura no cliente.
 *
 * Os dois ícones são renderizados e o CSS (variante dark) decide qual
 * aparece: nada depende de estado React, logo não há divergência de
 * hidratação nem troca visível após montar.
 */
export function AlternadorTema() {
  function alternar() {
    const raiz = document.documentElement;
    const proximo = raiz.dataset.theme === "dark" ? "claro" : "escuro";

    if (proximo === "escuro") {
      raiz.dataset.theme = "dark";
    } else {
      delete raiz.dataset.theme;
    }

    document.cookie = `tema=${proximo}; path=/; max-age=${UM_ANO_EM_SEGUNDOS}; samesite=lax`;
    try {
      localStorage.setItem("tema", proximo);
    } catch {
      // Sem localStorage (ex.: navegação privada antiga): o cookie basta.
    }
  }

  return (
    <button
      type="button"
      onClick={alternar}
      aria-label="Alternar entre tema claro e escuro"
      className="inline-flex h-[40px] w-[40px] shrink-0 items-center justify-center rounded-md text-neutral-600 transition-colors duration-[120ms] hover:bg-neutral-100 hover:text-neutral-800 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-primary-500"
    >
      <Moon size={18} strokeWidth={1.5} aria-hidden className="dark:hidden" />
      <Sun
        size={18}
        strokeWidth={1.5}
        aria-hidden
        className="hidden dark:block"
      />
    </button>
  );
}
