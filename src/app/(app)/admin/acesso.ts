import { redirect } from "next/navigation";
import { perfilAtual, type PerfilSessao } from "@/lib/auth";
import { entradaDaAdministracao, ehGestao } from "@/lib/papeis";

/*
 * Quem entra em cada subpágina da Administração. As permissões são as de
 * antes (as actions conferem de novo): gestão vê as configurações, só o admin
 * vê Equipe e Privacidade, e o compliance só o Log de acesso. Quem cai numa
 * subpágina que não é dele vai para a entrada do papel, não para o chat.
 */

/** Admin ou gestor; o compliance vai ao Log, os outros ao chat. */
export async function exigirGestao(): Promise<PerfilSessao> {
  const perfil = await perfilAtual();
  if (!perfil || !ehGestao(perfil.papel)) {
    redirect(entradaDaAdministracao(perfil?.papel) ?? "/chat");
  }
  return perfil;
}

/** Só o admin; o gestor volta ao índice. */
export async function exigirAdmin(): Promise<PerfilSessao> {
  const perfil = await exigirGestao();
  if (perfil.papel !== "admin") redirect("/admin");
  return perfil;
}
