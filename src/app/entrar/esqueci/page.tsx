import type { Metadata } from "next";
import { destinoSeguro } from "@/lib/rotas";
import { Button } from "@/components/ui/button";
import { Moldura } from "../moldura";
import { urlEntrar } from "../caminhos";
import { FormEsqueci } from "./form-esqueci";
import { titulo } from "@/lib/marca";

export const metadata: Metadata = {
  title: titulo("Esqueci a senha"),
};

export default async function EsqueciPage({
  searchParams,
}: PageProps<"/entrar/esqueci">) {
  const params = await searchParams;
  const email =
    typeof params.email === "string" ? params.email.slice(0, 254) : "";
  // O destino que o login tinha: o voltar devolve a ele e a senha nova
  // termina nele.
  const proximo = destinoSeguro(params.proximo);

  return (
    <Moldura
      titulo="Esqueci a senha"
      descricao="Digite o e-mail da sua conta. Se ele tiver cadastro, chega um código para criar uma senha nova."
      voltar={{
        href: urlEntrar("/entrar", { proximo }),
        rotulo: "Voltar ao login",
      }}
      // O mesmo link que ficava no rodapé, agora como o botão de contorno
      // embaixo do principal.
      secundaria={
        <Button
          href={urlEntrar("/entrar/redefinir", { email, proximo })}
          variant="secondary"
          size="lg"
          className="w-full"
        >
          Já tenho um código
        </Button>
      }
    >
      <FormEsqueci email={email} proximo={proximo} />
    </Moldura>
  );
}
