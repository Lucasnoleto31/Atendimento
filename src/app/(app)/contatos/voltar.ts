import { DESTINO_PADRAO, destinoSeguro } from "@/lib/rotas";

/**
 * O caminho de volta das subpáginas de contato (ficha, editar, novo). Quem
 * abre a página manda ?voltar=<de onde veio> quando a origem não é o pai
 * óbvio: o chat manda a conversa, a lista filtrada manda a lista com os
 * filtros. Sem ele, cada página volta para o pai lógico.
 *
 * Arquivo puro: a página e a action leem daqui.
 */

/**
 * As telas para onde um "← …" pode levar. Rota de API e de login ficam de
 * fora: um link montado com ?voltar=/api/exportar/contatos faria o "← Voltar"
 * baixar a base (e gravar a exportação no log em nome de quem clicou).
 */
const TELAS = [
  "/chat",
  "/contatos",
  "/campanhas",
  "/relatorios",
  "/admin",
  "/configuracoes",
];

/**
 * O ?voltar= reduzido a um caminho de tela deste site, ou null quando não
 * veio (ou veio torto, ou não é tela). destinoSeguro devolve o chat para
 * qualquer valor recusado; aqui o recusado vira null, para a página cair no
 * pai lógico e não no chat.
 */
export function lerVoltar(valor: unknown): string | null {
  const bruto = Array.isArray(valor) ? valor[0] : valor;
  if (typeof bruto !== "string" || !bruto) return null;
  const destino = destinoSeguro(bruto);
  if (destino === DESTINO_PADRAO && !bruto.startsWith(DESTINO_PADRAO)) {
    return null;
  }
  // O caminho já normalizado pelo parser de URL (sem "..", sem "//"): é por
  // ele que se decide se é tela, e não pelo texto cru.
  const caminho = caminhoDe(destino);
  const ehTela = TELAS.some(
    (tela) => caminho === tela || caminho.startsWith(`${tela}/`),
  );
  return ehTela ? destino : null;
}

/** O caminho sem query nem âncora. */
function caminhoDe(destino: string): string {
  return destino.split(/[?#]/)[0];
}

/**
 * Um ?voltar= que aponta para a própria página faria o "← Voltar" girar em
 * falso: vale o pai lógico.
 */
export function voltarDiferenteDe(
  voltar: string | null,
  propria: string,
): string | null {
  return voltar && caminhoDe(voltar) !== propria ? voltar : null;
}

/** Acrescenta o ?voltar= a um endereço, quando há para onde voltar. */
export function comVoltar(href: string, voltar: string | null): string {
  if (!voltar) return href;
  const separador = href.includes("?") ? "&" : "?";
  return `${href}${separador}voltar=${encodeURIComponent(voltar)}`;
}

/**
 * A conversa da pessoa no chat, com o caminho de volta para a origem (a
 * lista com os filtros, a ficha): o "←" da conversa diz "Contatos" ou "Ficha
 * do contato" e leva de volta para lá.
 */
export function urlConversa(leadId: string, origem: string): string {
  return comVoltar(`/chat?lead=${encodeURIComponent(leadId)}`, origem);
}

/**
 * O "Abrir conversa" da ficha. Quem chegou à ficha pela conversa desta mesma
 * pessoa volta para ela como estava (a fila com a visão e os filtros de
 * antes), em vez de empilhar chat → ficha → chat no ?voltar=. Os outros vão
 * ao chat com a ficha como volta; a ficha leva junto a origem dela, menos
 * quando a origem é o chat, que viraria um ciclo.
 */
export function conversaDaFicha(leadId: string, voltar: string | null): string {
  if (voltar && caminhoDe(voltar) === "/chat") {
    const lead = new URL(voltar, "https://x.invalid").searchParams.get("lead");
    if (lead === leadId) return voltar;
  }
  const ficha = comVoltar(
    `/contatos/${leadId}`,
    voltar && caminhoDe(voltar) !== "/chat" ? voltar : null,
  );
  return urlConversa(leadId, ficha);
}

/**
 * Para onde ir quando o contato some da vista de quem edita (passou para um
 * dono oculto, Administração > Privacidade): o ?voltar= sem as telas do
 * próprio contato. A ficha e a edição dele cairiam no "não encontrado", e
 * a conversa dele também: da conversa fica a fila, com os filtros. Sobe
 * pelos ?voltar= encaixados (editar → ficha → lista); null quando todos
 * apontam para ele, e quem chama cai na lista.
 */
export function voltarSemOContato(
  voltar: string | null,
  leadId: string,
): string | null {
  const proprio = `/contatos/${leadId}`;
  let destino = voltar;
  for (let i = 0; i < 3 && destino; i++) {
    const caminho = caminhoDe(destino);
    const url = new URL(destino, "https://x.invalid");
    if (caminho === "/chat" && url.searchParams.get("lead") === leadId) {
      url.searchParams.delete("lead");
      url.searchParams.delete("voltar");
      const fila = url.searchParams.toString();
      return fila ? `/chat?${fila}` : "/chat";
    }
    if (caminho !== proprio && !caminho.startsWith(`${proprio}/`)) {
      return destino;
    }
    destino = lerVoltar(url.searchParams.get("voltar"));
  }
  return null;
}

/** O rótulo do "← …": diz para onde o link leva. */
export function rotuloVoltar(destino: string): string {
  const caminho = caminhoDe(destino);
  if (caminho === "/chat") {
    // Com ?lead= (ou outra conversa aberta) a volta é para a conversa.
    return destino.includes("?") ? "Voltar à conversa" : "Chat";
  }
  if (/^\/contatos\/[^/]+$/.test(caminho) && caminho !== "/contatos/novo") {
    return "Ficha do contato";
  }
  if (caminho.startsWith("/contatos")) return "Contatos";
  if (caminho.startsWith("/campanhas")) return "Disparos";
  if (caminho.startsWith("/relatorios")) return "Relatório";
  if (caminho.startsWith("/admin/acessos")) return "Log de acesso";
  if (caminho.startsWith("/admin")) return "Administração";
  if (caminho.startsWith("/configuracoes")) return "Configurações";
  return "Voltar";
}
