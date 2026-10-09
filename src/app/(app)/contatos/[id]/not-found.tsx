import { Suspense } from "react";
import { Button } from "@/components/ui/button";
import { LinkVoltar } from "../link-voltar";
import { VoltarNaoEncontrado } from "./voltar-nao-encontrado";

/**
 * Ficha (ou edição) de contato que não abre: id errado, contato excluído ou
 * fora do que o papel da pessoa enxerga. Fica dentro do app, com a
 * navegação, e com a saída à vista: para de onde a pessoa veio, pelo
 * ?voltar=, ou para a lista.
 */
export default function ContatoNaoEncontrado() {
  return (
    <div className="px-2 pt-2 pb-4 md:px-3 md:pt-3">
      {/* O ?voltar= é lido no cliente; enquanto isso, a lista. */}
      <Suspense fallback={<LinkVoltar href="/contatos" rotulo="Contatos" />}>
        <VoltarNaoEncontrado />
      </Suspense>
      <div className="mt-2 max-w-[68ch] rounded-painel bg-cartao p-2.5">
        <h1 className="tipo-titulo-3 text-tinta">Contato não encontrado</h1>
        <p className="mt-0.5 tipo-corpo text-texto-2">
          O link pode estar errado, o contato pode ter sido excluído ou estar
          com outra pessoa da equipe.
        </p>
        <Button href="/contatos" variant="secondary" size="sm" className="mt-1.5">
          Ir para Contatos
        </Button>
      </div>
    </div>
  );
}
