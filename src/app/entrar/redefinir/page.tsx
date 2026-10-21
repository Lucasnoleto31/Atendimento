import type { Metadata } from "next";
import { destinoSeguro } from "@/lib/rotas";
import { Moldura } from "../moldura";
import { urlEntrar } from "../caminhos";
import { FormRedefinir } from "./form-redefinir";
import { titulo } from "@/lib/marca";

export const metadata: Metadata = {
  title: titulo("Nova senha"),
};

export default async function RedefinirPage({
  searchParams,
}: PageProps<"/entrar/redefinir">) {
  const params = await searchParams;
  const email =
    typeof params.email === "string" ? params.email.slice(0, 254) : "";
  const proximo = destinoSeguro(params.proximo);

  return (
    <Moldura
      titulo="Criar nova senha"
      descricao="Se o e-mail tiver conta, chega nele um código em instantes. O código vale por 10 minutos."
      voltar={{
        href: urlEntrar("/entrar", { proximo }),
        rotulo: "Voltar ao login",
      }}
      // O "Pedir outro código" fica dentro do FormRedefinir, e não na
      // secundária da Moldura: some junto com o formulário depois da troca.
    >
      <FormRedefinir email={email} proximo={proximo} />
    </Moldura>
  );
}
