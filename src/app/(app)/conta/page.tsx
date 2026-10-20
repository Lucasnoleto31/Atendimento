import type { Metadata } from "next";
import { perfilAtual } from "@/lib/auth";
import { fotoDaSessao } from "@/lib/fotos-equipe";
import { TelaConta } from "./tela";
import { titulo } from "@/lib/marca";

export const metadata: Metadata = { title: titulo("Minha conta") };

/** Minha conta, para todo papel. Sem perfil (ou com a conta desativada), o
 *  layout já mostra a tela certa no lugar desta. */
export default async function ContaPage() {
  // As duas leituras juntas: o perfil (em cache, o layout já leu) e a
  // própria foto, pela sessão (sem ler a equipe inteira no Auth).
  const [perfil, sessao] = await Promise.all([perfilAtual(), fotoDaSessao()]);
  if (!perfil) return null;

  return (
    <TelaConta
      nome={perfil.nome}
      email={perfil.email}
      papel={perfil.papel}
      foto={sessao?.id === perfil.id ? sessao.foto : null}
    />
  );
}
