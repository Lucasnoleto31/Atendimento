import { redirect } from "next/navigation";
import { DESTINO_PADRAO } from "@/lib/rotas";

/**
 * A raiz não tem tela própria: o sistema é de uso interno e começa no chat.
 * Quem não está logado é desviado pelo middleware para o /entrar, com o
 * retorno para o chat.
 */
export default function Raiz() {
  redirect(DESTINO_PADRAO);
}
