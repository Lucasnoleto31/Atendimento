"use client";

import { Moon, Sun } from "lucide-react";
import { cn } from "@/lib/utils";
import { BOTAO_ICONE } from "./form-styles";

const UM_ANO_EM_SEGUNDOS = 60 * 60 * 24 * 365;

/** O fundo de cada tema, para a cor da barra do navegador (theme-color). */
const FUNDO = { claro: "#FFFFFF", escuro: "#0B0B0B" } as const;

/**
 * Alterna claro e escuro sem recarregar: trocar data-theme no <html> já troca
 * os tokens (os utilitários resolvem para var(--color-*)). O cookie `tema` é
 * a fonte da verdade: o layout raiz o lê no SSR, então a próxima navegação já
 * vem com o tema certo; o localStorage é só espelho para leitura no cliente.
 */
export function alternarTema() {
  const raiz = document.documentElement;
  const proximo = raiz.dataset.theme === "dark" ? "claro" : "escuro";

  if (proximo === "escuro") {
    raiz.dataset.theme = "dark";
  } else {
    delete raiz.dataset.theme;
  }

  // A barra do navegador no celular acompanha sem esperar a próxima página.
  document
    .querySelector('meta[name="theme-color"]')
    ?.setAttribute("content", FUNDO[proximo]);

  document.cookie = `tema=${proximo}; path=/; max-age=${UM_ANO_EM_SEGUNDOS}; samesite=lax`;
  try {
    localStorage.setItem("tema", proximo);
  } catch {
    // Sem localStorage (ex.: navegação privada antiga): o cookie basta.
  }
}

/**
 * O botão do tema. Os dois ícones e os dois rótulos são renderizados e o CSS
 * (variante dark) decide qual aparece: nada depende de estado React, logo não
 * há divergência de hidratação nem troca visível depois de montar.
 *
 * - "icone" (padrão): botão de 40px, no pé do menu lateral do desktop.
 * - "linha": linha de lista com ícone e texto, para a folha do "Mais" no
 *   celular. Diz para onde vai ("Usar tema escuro"), não onde está.
 */
export function AlternadorTema({
  variante = "icone",
  className,
}: {
  variante?: "icone" | "linha";
  className?: string;
}) {
  if (variante === "linha") {
    return (
      <button
        type="button"
        onClick={alternarTema}
        // Sem raio e sem tamanho de texto próprios: a linha vive dentro de
        // um grupo (cartão com raio de painel) e herda o papel de quem usa.
        className={cn(
          "flex h-[48px] w-full items-center gap-1.5 pr-1 pl-1.5 text-left text-tinta transition-colors duration-[120ms] hover:bg-realce active:bg-pressionado focus-visible:outline-2 focus-visible:-outline-offset-2 focus-visible:outline-tinta",
          className,
        )}
      >
        <Moon
          size={20}
          strokeWidth={1.75}
          aria-hidden
          className="text-texto-2 dark:hidden"
        />
        <Sun
          size={20}
          strokeWidth={1.75}
          aria-hidden
          className="hidden text-texto-2 dark:block"
        />
        <span className="dark:hidden">Usar tema escuro</span>
        <span className="hidden dark:inline">Usar tema claro</span>
      </button>
    );
  }

  return (
    <button
      type="button"
      onClick={alternarTema}
      title="Alternar tema"
      className={cn(BOTAO_ICONE, className)}
    >
      <Moon size={18} strokeWidth={1.75} aria-hidden className="dark:hidden" />
      <Sun
        size={18}
        strokeWidth={1.75}
        aria-hidden
        className="hidden dark:block"
      />
      <span className="sr-only dark:hidden">Usar tema escuro</span>
      <span className="sr-only hidden dark:inline">Usar tema claro</span>
    </button>
  );
}
