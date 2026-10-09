/**
 * Os endereços da Administração, num lugar só. Arquivo puro (sem servidor e
 * sem "use client"): a casca, a paleta, as páginas e o editor leem daqui.
 *
 * Desde 09/10/2026 há uma entrada só, "Administração", no lugar de "Log de
 * acesso", "Administração" e "Configurações" (pedido do Artur: "os log de
 * acesso acredito que pode ficar em adm ou algo assim"). O /admin é um índice
 * no desenho dos Ajustes do iPhone e cada linha abre a subpágina dela, com
 * "‹ Administração" no alto. O /configuracoes redireciona para cá.
 *
 * O editor aberto mora na URL (?abrir=<chave>): outra tela abre o editor
 * certo por um link, e o voltar do celular fecha a folha em vez de sair da
 * página. O /admin?abrir=<chave> leva à subpágina da chave, com o resto da
 * query junto (?voltar=, ?texto=).
 */

/** O parâmetro da URL com o editor aberto ("etiqueta:nova"). */
export const PARAM_ABRIR = "abrir";

/** O texto que já vem escrito no editor de mensagem pronta nova (o chat
 *  manda a resposta que a pessoa quer guardar). */
export const PARAM_TEXTO = "texto";

/** O que sai da URL quando o editor fecha. O ?voltar= fica: é da página. */
export const PARAMS_DO_EDITOR = [PARAM_ABRIR, PARAM_TEXTO, "editar"];

export const CAMINHO_ADMIN = "/admin";
export const CAMINHO_LOG = "/admin/acessos";

export type Subpagina =
  | "mensagens"
  | "etiquetas"
  | "atendimento"
  | "importar"
  | "equipe"
  | "privacidade"
  | "acessos"
  | "whatsapp"
  | "instagram";

export const TITULO_SUBPAGINA: Record<Subpagina, string> = {
  mensagens: "Mensagens prontas",
  etiquetas: "Etiquetas",
  atendimento: "Atendimento",
  importar: "Importar contatos",
  equipe: "Equipe",
  privacidade: "Privacidade",
  acessos: "Log de acesso",
  whatsapp: "WhatsApp",
  instagram: "Instagram Direct",
};

export function caminhoDa(subpagina: Subpagina): string {
  return `${CAMINHO_ADMIN}/${subpagina}`;
}

/**
 * A subpágina que tem o editor da chave: "mensagem:nova" mora em Mensagens
 * prontas, "rodizio" em Atendimento. O Instagram Direct não tem editor (as
 * chaves moram no ambiente). null quando a chave não é de ninguém.
 */
export function subpaginaDoEditor(chave: string): Subpagina | null {
  const prefixo = chave.split(":")[0];
  switch (prefixo) {
    case "mensagem":
      return "mensagens";
    case "etiqueta":
      return "etiquetas";
    case "rodizio":
    case "horario":
    case "resposta":
    case "teto":
      return "atendimento";
    case "importar":
    case "importacao":
      return "importar";
    case "usuario":
      return "equipe";
    case "privacidade-regra":
    case "privacidade-grupo":
      return "privacidade";
    case "numero":
      return "whatsapp";
    default:
      return null;
  }
}

/** O endereço que abre o editor da chave, com a volta quando há. */
export function hrefDoEditor(chave: string, voltar?: string | null): string {
  const subpagina = subpaginaDoEditor(chave);
  const p = new URLSearchParams({ [PARAM_ABRIR]: chave });
  if (voltar) p.set("voltar", voltar);
  return `${subpagina ? caminhoDa(subpagina) : CAMINHO_ADMIN}?${p.toString()}`;
}
