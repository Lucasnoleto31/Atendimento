import { UUID } from "./filtros";

/**
 * Os avisos que a lista de contatos sabe escrever, pedidos pela URL
 * (?aviso=<código>&para=<id>), como a ficha faz com o dela (aviso-ficha.ts).
 * Na URL vão só o código e o id de quem recebeu o contato; o texto sai da
 * lista, com o nome que ela mesma leu da equipe. Código fora desta lista é
 * ignorado: texto livre da URL não chega à tela.
 *
 * O caso é o contato que passa para alguém cujos contatos quem salvou não
 * vê (Administração > Privacidade): a ficha dele cairia no "não
 * encontrado", e quem salvou volta para a lista sem saber se salvou.
 *
 * Arquivo puro: as actions de cadastro e de edição e a página leem daqui.
 */

/** A edição passou o contato para alguém que quem editou não vê. */
export const AVISO_PASSOU = "passou";

/** O cadastro foi feito para alguém que quem cadastrou não vê. */
export const AVISO_CADASTRADO_OCULTO = "cadastrado-oculto";

/** O cadastro foi feito para outra pessoa, e as regras de privacidade não
 *  carregaram para dizer se quem cadastrou a vê: a ficha não abre. */
export const AVISO_CADASTRADO = "cadastrado";

/** O "Trocar" da ficha passou o contato para alguém, e ele saiu da vista
 *  de quem trocou (o assessor que passa um contato da carteira: o cliente
 *  vai junto para o novo dono). */
export const AVISO_SAIU = "saiu";

export type AvisoLista =
  | typeof AVISO_PASSOU
  | typeof AVISO_CADASTRADO_OCULTO
  | typeof AVISO_CADASTRADO
  | typeof AVISO_SAIU;

const CODIGOS: readonly string[] = [
  AVISO_PASSOU,
  AVISO_CADASTRADO_OCULTO,
  AVISO_CADASTRADO,
  AVISO_SAIU,
];

/** O ?aviso= e o ?para= reduzidos ao que a lista conhece, ou null. */
export function lerAvisoLista(
  aviso: unknown,
  para: unknown,
): { aviso: AvisoLista; para: string | null } | null {
  const bruto = Array.isArray(aviso) ? aviso[0] : aviso;
  if (typeof bruto !== "string" || !CODIGOS.includes(bruto)) return null;
  const id = Array.isArray(para) ? para[0] : para;
  return {
    aviso: bruto as AvisoLista,
    para: typeof id === "string" && UUID.test(id) ? id.toLowerCase() : null,
  };
}

/**
 * O destino com o aviso, quando o destino é a lista de contatos (com os
 * filtros dela ou sem). Outra tela (a fila do chat, por exemplo) não lê o
 * ?aviso=: vai sem ele.
 */
export function comAvisoLista(
  destino: string,
  aviso: AvisoLista,
  para: string | null,
): string {
  const url = new URL(destino, "https://x.invalid");
  if (url.pathname !== "/contatos") return destino;
  url.searchParams.delete("pagina");
  url.searchParams.set("aviso", aviso);
  if (para && UUID.test(para)) url.searchParams.set("para", para);
  else url.searchParams.delete("para");
  return `${url.pathname}?${url.searchParams.toString()}`;
}

/** O texto do aviso, com o nome de quem recebeu (null: não está na equipe
 *  ativa que a lista leu). */
export function textoAvisoLista(aviso: AvisoLista, nome: string | null): string {
  const quem = nome ?? "outra pessoa da equipe";
  switch (aviso) {
    case AVISO_PASSOU:
      return nome
        ? `Contato passou para ${nome}. Você não vê os contatos de ${nome}: ele sai da sua lista.`
        : `Contato passou para ${quem}, de quem você não vê os contatos: ele sai da sua lista.`;
    case AVISO_CADASTRADO_OCULTO:
      return nome
        ? `Contato cadastrado para ${nome}. Você não vê os contatos de ${nome}: ele não aparece na sua lista.`
        : `Contato cadastrado para ${quem}, de quem você não vê os contatos: ele não aparece na sua lista.`;
    case AVISO_CADASTRADO:
      return `Contato cadastrado para ${quem}.`;
    case AVISO_SAIU:
      return `Contato passou para ${quem}. Ele sai da sua lista.`;
  }
}
