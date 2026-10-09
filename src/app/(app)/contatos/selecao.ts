import { UUID } from "./filtros";

/**
 * A seleção em massa da lista de contatos, a parte que a tela, as actions e
 * a rota do CSV dividem. Arquivo puro: roda no navegador e no servidor.
 */

/**
 * Quantos contatos uma ação em massa alcança por vez: o mesmo teto das
 * ações em massa do chat. A tela marca no máximo uma página (60), e os ids
 * vão na URL do CSV; 200 ids cabem com folga no endereço. Com o filtro
 * inteiro marcado, é o tamanho de cada lote que o servidor escreve.
 */
export const TETO_SELECAO = 200;

/**
 * Os ids escolhidos, vindos de um array (action) ou de "a,b,c" (a URL do
 * CSV): só uuid, sem repetição, na ordem em que vieram. null quando não veio
 * nada, para a rota distinguir "exportar a lista filtrada" de "exportar uma
 * seleção que chegou vazia" (que não pode virar a base inteira).
 */
export function lerIds(valor: unknown): string[] | null {
  if (valor === null || valor === undefined) return null;
  const partes = Array.isArray(valor)
    ? valor
    : typeof valor === "string"
      ? valor.split(",")
      : [];
  const ids = new Set<string>();
  for (const parte of partes) {
    if (typeof parte !== "string") continue;
    const id = parte.trim().toLowerCase();
    if (UUID.test(id)) ids.add(id);
  }
  return [...ids];
}

/**
 * Quantos contatos uma ação alcança com "Marcar os N deste filtro": o
 * servidor percorre a consulta da lista em lotes de TETO_SELECAO e para
 * aqui. Passou disso, valem os primeiros da lista (na ordem da tela), e a
 * barra avisa antes.
 */
export const TETO_FILTRO = 5000;

/**
 * Para quem vai a ação em massa: os ids marcados na tela, ou o filtro
 * inteiro (a query da lista sem a página, de consultaDosFiltros). O
 * servidor relê o filtro e chega só ao que a lista mostraria.
 */
export type AlcanceContatos = string[] | { filtro: string };

/** O CSV da seleção: a mesma rota da exportação, com os ids escolhidos. */
export function urlExportarSelecao(ids: string[]): string {
  return `/api/exportar/contatos?ids=${ids.join(",")}`;
}

/** O valor de ?selecao= que pede o CSV do filtro inteiro pela seleção,
 *  com o teto de TETO_FILTRO e o nome de arquivo da seleção. */
export const SELECAO_FILTRO = "filtro";

/** O CSV de "Marcar os N deste filtro": os filtros da lista e o aviso de
 *  que é a seleção, que tem teto. */
export function urlExportarFiltro(consulta: string): string {
  const p = new URLSearchParams(consulta);
  p.set("selecao", SELECAO_FILTRO);
  return `/api/exportar/contatos?${p.toString()}`;
}
