/**
 * Classes compartilhadas dos formulários (Admin, Configurações, Contatos,
 * Disparos e o Field de components/ui). Ficha padrão do kit: campo com fio,
 * fundo da página, raio de controle (10), foco num anel de 2px na tinta.
 *
 * Altura de 40px no mouse e 44px no toque (kit, bloco 7). No toque o texto
 * sobe para 16px pela regra do globals.css (o Safari do iPhone dá zoom em
 * campo menor que isso).
 */

/** O que todo campo tem, sem o tamanho do texto. O Field usa esta. */
export const CAMPO_BASE =
  "h-[40px] pointer-coarse:h-[44px] rounded-controle border border-fio-forte bg-fundo px-1.5 text-tinta placeholder:text-texto-3 transition-colors duration-[120ms] hover:border-texto-3 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-tinta disabled:cursor-not-allowed disabled:border-fio disabled:bg-cartao disabled:text-texto-3 aria-[invalid=true]:border-erro";

/** Campo de texto, número e data (e o select nativo, que mantém a seta do
 *  sistema). */
export const CAMPO = `${CAMPO_BASE} text-sm`;

/** Select com a seta desenhada no cinza do tema, igual em todo navegador. */
export const CAMPO_SELECT = `${CAMPO} appearance-none bg-[image:var(--seta-select)] bg-[length:16px_16px] bg-[position:right_12px_center] bg-no-repeat pr-4`;

/** Texto longo: mesma moldura, altura livre. */
export const AREA_TEXTO =
  "min-h-[96px] w-full rounded-controle border border-fio-forte bg-fundo px-1.5 py-1 text-sm text-tinta placeholder:text-texto-3 transition-colors duration-[120ms] hover:border-texto-3 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-tinta disabled:cursor-not-allowed disabled:border-fio disabled:bg-cartao disabled:text-texto-3 aria-[invalid=true]:border-erro";

/** Rótulo acima do campo, sempre visível (placeholder não substitui). Em
 *  400, como os rótulos das telas antigas (font-medium caiu no Regular): o
 *  campo se separa do rótulo pelo tamanho (16 no campo, 14 no rótulo) e pelo
 *  lugar, e o 600 fica para título e destaque. */
export const ROTULO = "text-sm text-tinta";

/** Ajuda embaixo do campo. */
export const AJUDA = "text-xs text-texto-2";

/** Erro embaixo do campo, perto do problema. */
export const ERRO_CAMPO = "text-xs text-erro";

/** Botão só de ícone, 40px (44px no toque). Precisa de aria-label. */
export const BOTAO_ICONE =
  "inline-flex h-[40px] w-[40px] pointer-coarse:h-[44px] pointer-coarse:w-[44px] shrink-0 items-center justify-center rounded-controle text-texto-2 transition-[background-color,color,scale] duration-[120ms] hover:bg-realce hover:text-tinta active:bg-pressionado motion-safe:active:scale-[.97] focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-tinta disabled:cursor-not-allowed disabled:text-fio-forte disabled:hover:bg-transparent disabled:active:scale-100";
