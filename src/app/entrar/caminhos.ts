import { DESTINO_PADRAO } from "@/lib/rotas";

/**
 * Endereço de uma tela de /entrar levando o e-mail e o ?proximo= adiante.
 * Quem sai do login para pedir senha nova volta a ele, ou entra depois da
 * senha nova, com o mesmo destino. O destino padrão não vai na URL, e o
 * `proximo` já tem de vir de destinoSeguro. Arquivo puro: o formulário do
 * login (cliente) também usa.
 */
export function urlEntrar(
  caminho: string,
  { email, proximo }: { email?: string; proximo?: string },
): string {
  const busca = new URLSearchParams();
  if (email) busca.set("email", email);
  if (proximo && proximo !== DESTINO_PADRAO) busca.set("proximo", proximo);
  const texto = busca.toString();
  return texto ? `${caminho}?${texto}` : caminho;
}
