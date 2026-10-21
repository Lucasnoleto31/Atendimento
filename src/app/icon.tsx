import { readFileSync } from "node:fs";
import { join } from "node:path";
import { MARCA_DA_ZEVE, NOME_DA_EMPRESA, TEMA } from "@/lib/marca";

/**
 * O favicon, gerado no servidor: o icone.svg do tema do cliente quando há
 * tema; senão o Z da Zeve na Zeve, ou a inicial da empresa (src/lib/marca.ts). SVG com media query, e não PNG,
 * para o ícone acompanhar o tema claro e escuro do navegador, como o
 * arquivo estático fazia.
 */
export const contentType = "image/svg+xml";
export const dynamic = "force-static";

const ESTILO = `
    .fundo { fill: #FFFFFF; }
    .marca { fill: #111111; }
    @media (prefers-color-scheme: dark) {
      .fundo { fill: #0B0B0B; }
      .marca { fill: #F5F5F5; }
    }`;

const Z_DA_ZEVE =
  '<path class="marca" transform="translate(10 15.97) scale(0.13764)" d="M317.06 22.98C325.61 35.93 311.28 44.17 301.68 53.99C290.82 64.16 278.69 75.46 268.04 85.42C236.52 113.94 154.04 193.61 113.87 228.64C109.5 232.46 103.41 233.97 97.79 232.34C97.74 232.34 97.7 232.31 97.67 232.3C89.72 230.31 82.18 226 76.53 220.14C68.28 211.45 72.03 202.76 72.89 190.04C74.93 171.46 77.91 144.69 79.76 127.82C80.23 122.63 81.21 117.21 79.72 112.2C76.21 100.56 62.03 103.14 51.97 106.57C41.69 109.56 27.4 115.15 17.91 116.54C5.47 118.89-2.99 106.67 0.99 96.13C3.16 90.95 8.64 87.77 16.21 82.72C22.77 78.41 29.37 74.07 36.04 69.69C56.36 56.37 76.67 42.88 96.68 29.86C102.49 26.25 109.84 22.27 117.44 22.55C127.76 23.13 138.59 29.25 143.68 38.08C148.7 48.87 141.53 65.44 139.03 77.09C135.93 88.85 132.78 100.9 129.62 112.91C127.13 122.84 123.22 134.9 124.29 141.3C124.86 147.83 132.14 152.43 138.38 149.72C142.81 147.86 146.23 143.7 149.53 140.07C166.35 120.99 193.75 89.98 212.52 68.69C225.68 53.77 240.05 37.5 253.68 22.04C265.24 9.99 272.66-4.34 287.36 1.25C294.6 3.94 301.67 8.88 307.83 13.62C311.62 16.56 314.94 19.8 316.95 22.79L317.08 22.97L317.06 22.98Z"/>';

function inicial(): string {
  const letra = NOME_DA_EMPRESA.charAt(0).toUpperCase().replace("&", "&amp;");
  return `<text class="marca" x="32" y="45" text-anchor="middle" font-family="Poppins, Helvetica, Arial, sans-serif" font-size="38" font-weight="700">${letra}</text>`;
}

export default function Icon() {
  if (TEMA) {
    // Lido do disco no build (força estático): a pasta public/ não é
    // importável, e buscar pela rede no build traria o problema da URL.
    const svg = readFileSync(
      join(process.cwd(), "public", "temas", TEMA, "icone.svg"),
      "utf8",
    );
    return new Response(svg, { headers: { "Content-Type": contentType } });
  }
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 64 64">
  <style>${ESTILO}
  </style>
  <rect class="fundo" width="64" height="64" rx="14"/>
  ${MARCA_DA_ZEVE ? Z_DA_ZEVE : inicial()}
</svg>
`;
  return new Response(svg, { headers: { "Content-Type": contentType } });
}
