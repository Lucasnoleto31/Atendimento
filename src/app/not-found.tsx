import type { Metadata } from "next";
import { Button } from "@/components/ui/button";
import { Moldura } from "./entrar/moldura";
import { titulo } from "@/lib/marca";

export const metadata: Metadata = {
  title: titulo("Página não encontrada"),
};

/**
 * 404 do sistema inteiro. Fica fora do app (sem o menu), então a saída para
 * o chat precisa estar na própria tela. Quem não estiver logado cai no login
 * pelo caminho, como em qualquer página interna. Mesmo desenho da tela de
 * entrada (entrar/moldura.tsx).
 */
export default function NaoEncontrada() {
  return (
    <Moldura
      titulo="Página não encontrada"
      descricao="O endereço está errado ou a página saiu do sistema."
    >
      <Button href="/chat" size="lg" className="w-full">
        Ir para o chat
      </Button>
    </Moldura>
  );
}
