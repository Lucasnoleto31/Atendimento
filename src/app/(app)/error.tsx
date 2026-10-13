"use client";

import { Button } from "@/components/ui/button";

/**
 * Erro numa tela de dentro do app, mostrado DENTRO da casca: o menu lateral
 * e a barra de abas continuam, e a saída para as outras áreas fica à vista.
 * Antes só havia o src/app/error.tsx, acima do layout, que trocava a tela
 * inteira e oferecia só "Ir para o chat": se o que quebrou era o próprio
 * chat, o botão voltava ao mesmo erro.
 *
 * O mesmo texto da tela de erro geral (o caso comum é a aba aberta desde
 * antes de uma atualização), num cartão chapado na área do conteúdo.
 */
export default function ErroNaTela({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  return (
    <div className="px-2 pt-3 pb-6 md:px-3 lg:pt-4">
      <section
        role="alert"
        className="max-w-[560px] rounded-painel bg-cartao p-2.5 md:p-3"
      >
        <h1 className="tipo-titulo-2 text-tinta">Esta tela não carregou</h1>
        <p className="tipo-corpo mt-1 text-texto-2">
          O mais provável é o sistema ter sido atualizado com esta aba aberta.
          Recarregar a página resolve quase sempre. As outras áreas continuam
          no menu.
        </p>
        {/* 40px no mouse, 44px no toque (kit, bloco 7). */}
        <div className="mt-2.5 flex flex-wrap gap-1.5">
          <Button
            type="button"
            onClick={reset}
            className="pointer-coarse:h-[44px]"
          >
            Tentar de novo
          </Button>
          <Button
            type="button"
            variant="secondary"
            onClick={() => window.location.reload()}
            className="pointer-coarse:h-[44px]"
          >
            Recarregar a página
          </Button>
        </div>
        {error.digest ? (
          <p className="tipo-nota mt-2 text-texto-2">
            Se continuar, mande este código para a administração:{" "}
            <code className="text-tinta">{error.digest}</code>
          </p>
        ) : null}
      </section>
    </div>
  );
}
