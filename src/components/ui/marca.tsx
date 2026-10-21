import { cn } from "@/lib/utils";
import {
  ARQUIVOS_DO_TEMA,
  MARCA_DA_ZEVE,
  NOME_DA_EMPRESA,
  NOME_DO_PRODUTO,
} from "@/lib/marca";

/**
 * O Z da Zeve, na cor do texto em volta (currentColor): a tinta no claro e
 * no escuro, sem o azul da marca, como pede a ficha padrão (marca com cor só
 * no detalhe, e aqui não entra). O desenho é o de public/marca/zeve-z.svg,
 * copiado do Hub; fica embutido para herdar a cor e não pedir arquivo.
 * Decorativo: quem usa põe o nome ao lado.
 */
export function MarcaZ({ className }: { className?: string }) {
  if (ARQUIVOS_DO_TEMA) {
    // Tema do cliente: o símbolo dele, com as cores próprias.
    return (
      // eslint-disable-next-line @next/next/no-img-element -- SVG estático do tema, sem otimização
      <img
        src={ARQUIVOS_DO_TEMA.simbolo}
        alt=""
        aria-hidden
        className={cn("h-[20px] w-auto shrink-0", className)}
      />
    );
  }
  if (!MARCA_DA_ZEVE) {
    // Outra empresa: a inicial num quadrado, no lugar do Z.
    return (
      <span
        aria-hidden
        className={cn(
          "inline-flex h-[20px] w-[20px] shrink-0 items-center justify-center rounded-[5px] bg-tinta text-[12px] font-bold leading-none text-fundo",
          className,
        )}
      >
        {NOME_DA_EMPRESA.charAt(0).toUpperCase()}
      </span>
    );
  }
  return (
    <svg
      viewBox="0 0 319.67 232.99"
      aria-hidden
      focusable="false"
      className={cn("h-[16px] w-auto shrink-0", className)}
    >
      <path
        fill="currentColor"
        d="M317.06 22.98C325.61 35.93 311.28 44.17 301.68 53.99C290.82 64.16 278.69 75.46 268.04 85.42C236.52 113.94 154.04 193.61 113.87 228.64C109.5 232.46 103.41 233.97 97.79 232.34C97.74 232.34 97.7 232.31 97.67 232.3C89.72 230.31 82.18 226 76.53 220.14C68.28 211.45 72.03 202.76 72.89 190.04C74.93 171.46 77.91 144.69 79.76 127.82C80.23 122.63 81.21 117.21 79.72 112.2C76.21 100.56 62.03 103.14 51.97 106.57C41.69 109.56 27.4 115.15 17.91 116.54C5.47 118.89-2.99 106.67 0.99 96.13C3.16 90.95 8.64 87.77 16.21 82.72C22.77 78.41 29.37 74.07 36.04 69.69C56.36 56.37 76.67 42.88 96.68 29.86C102.49 26.25 109.84 22.27 117.44 22.55C127.76 23.13 138.59 29.25 143.68 38.08C148.7 48.87 141.53 65.44 139.03 77.09C135.93 88.85 132.78 100.9 129.62 112.91C127.13 122.84 123.22 134.9 124.29 141.3C124.86 147.83 132.14 152.43 138.38 149.72C142.81 147.86 146.23 143.7 149.53 140.07C166.35 120.99 193.75 89.98 212.52 68.69C225.68 53.77 240.05 37.5 253.68 22.04C265.24 9.99 272.66-4.34 287.36 1.25C294.6 3.94 301.67 8.88 307.83 13.62C311.62 16.56 314.94 19.8 316.95 22.79L317.08 22.97L317.06 22.98Z"
      />
    </svg>
  );
}

/**
 * Marca do produto. Na Zeve, o Z e "Atendimento" (o "Zeve" fica para o
 * leitor de tela, que lê "Zeve Atendimento"). Em outra empresa, o nome do
 * produto em texto (src/lib/marca.ts). Quem usa decide o link em volta.
 */
export function Marca({ className }: { className?: string }) {
  if (ARQUIVOS_DO_TEMA) {
    // Tema do cliente: a marca por extenso, uma versão por tema de cor (o
    // SVG num <img> não herda a cor do texto, por isso dois arquivos).
    return (
      <span className={cn("inline-flex items-center text-tinta", className)}>
        {/* eslint-disable-next-line @next/next/no-img-element -- SVG estático do tema */}
        <img
          src={ARQUIVOS_DO_TEMA.logo}
          alt={NOME_DO_PRODUTO}
          className="h-[26px] w-auto dark:hidden"
        />
        {/* eslint-disable-next-line @next/next/no-img-element -- SVG estático do tema */}
        <img
          src={ARQUIVOS_DO_TEMA.logoEscuro}
          alt={NOME_DO_PRODUTO}
          className="hidden h-[26px] w-auto dark:block"
        />
      </span>
    );
  }
  if (!MARCA_DA_ZEVE) {
    return (
      <span className={cn("inline-flex items-center gap-1 text-tinta", className)}>
        <span className="text-base font-semibold tracking-[-0.01em]">
          {NOME_DO_PRODUTO}
        </span>
      </span>
    );
  }
  return (
    <span className={cn("inline-flex items-center gap-1 text-tinta", className)}>
      <MarcaZ className="h-[18px]" />
      <span className="text-base font-semibold tracking-[-0.01em]">
        <span className="sr-only">Zeve </span>Atendimento
      </span>
    </span>
  );
}
