import type { Metadata } from "next";
import { LoginForm } from "./login-form";
import { Moldura } from "./moldura";
import { destinoSeguro } from "@/lib/rotas";
import { titulo } from "@/lib/marca";

export const metadata: Metadata = {
  title: titulo("Entrar"),
};

export default async function EntrarPage({
  searchParams,
}: PageProps<"/entrar">) {
  const params = await searchParams;
  const proximo = destinoSeguro(params.proximo);

  return (
    <Moldura
      titulo="Que bom te ver de novo"
      descricao="Entre para atender as conversas da equipe."
      rodape="Quem cria as contas é a administração."
    >
      <LoginForm proximo={proximo} />
    </Moldura>
  );
}
