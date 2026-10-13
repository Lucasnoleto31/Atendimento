"use client";

import { MarcaZ } from "@/components/ui/marca";

/**
 * Tela de erro do app. Sem ela, qualquer estouro no navegador vira a página
 * branca padrão do Next ("Application error…"), que não diz nada e não
 * oferece saída. O caso mais comum aqui nem é bug: o sistema publica várias
 * versões por dia, e uma aba aberta desde antes do deploy tenta falar com um
 * servidor que já mudou. Recarregar resolve.
 *
 * É a reserva de erro de TODAS as rotas, e o JavaScript dela vai junto em
 * toda página, mesmo que quase nunca apareça. Por isso fica leve: só HTML e
 * classes, sem a moldura de duas metades da entrada (que traz o fundo de
 * malha) e sem componentes. O desenho segue o lado claro da entrada: marca,
 * título, o aviso e o botão na largura toda, com o de contorno embaixo.
 */
const BOTAO =
  "inline-flex h-[48px] w-full items-center justify-center rounded-controle text-base font-semibold transition-colors duration-[120ms] focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-tinta";

export default function Erro({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  return (
    <main className="flex flex-1 flex-col px-2 pt-[max(24px,env(safe-area-inset-top))] pb-4 md:items-center md:justify-center md:py-6">
      <div className="w-full md:max-w-[480px]">
        <p className="flex items-center gap-1 text-tinta">
          <MarcaZ className="size-[20px]" />
          <span className="tipo-corpo font-semibold">Atendimento</span>
        </p>
        <h1 className="tipo-titulo-1 mt-4 font-normal text-tinta">
          Esta tela não carregou
        </h1>
        <p className="tipo-corpo mt-1 text-texto-2">
          O mais provável é o sistema ter sido atualizado com esta aba aberta.
          Recarregar a página resolve quase sempre.
        </p>
        <div className="mt-3 flex flex-col gap-1.5">
          <button
            type="button"
            onClick={() => window.location.reload()}
            className={`${BOTAO} bg-tinta text-fundo hover:bg-tinta-hover`}
          >
            Recarregar a página
          </button>
          <button
            type="button"
            onClick={reset}
            className={`${BOTAO} border border-fio-forte text-tinta hover:bg-realce`}
          >
            Tentar sem recarregar
          </button>
        </div>
        {/* Saída que não depende da tela que quebrou: navegação completa
            (<a>, não Link), que também pega a versão nova do sistema. */}
        <a
          href="/chat"
          className="-ml-1 mt-2 inline-flex h-[40px] items-center rounded-controle px-1 text-sm font-semibold text-texto-2 transition-colors duration-[120ms] hover:bg-realce hover:text-tinta focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-tinta pointer-coarse:h-[44px]"
        >
          Ir para o chat
        </a>
        {error.digest ? (
          <p className="tipo-nota mt-2 text-texto-2">
            Se continuar, mande este código para a administração:{" "}
            <code className="text-tinta">{error.digest}</code>
          </p>
        ) : null}
      </div>
    </main>
  );
}
