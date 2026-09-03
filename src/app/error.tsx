"use client";

/**
 * Tela de erro do app. Sem ela, qualquer estouro no navegador vira a página
 * branca padrão do Next ("Application error…"), que não diz nada e não
 * oferece saída. O caso mais comum aqui nem é bug: o sistema publica várias
 * versões por dia, e uma aba aberta desde antes do deploy tenta falar com um
 * servidor que já mudou — recarregar resolve.
 */
export default function Erro({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  return (
    <main className="flex min-h-full flex-1 items-center justify-center px-2 py-8">
      <div className="w-full max-w-[440px] rounded-lg border border-neutral-200 bg-neutral-0 p-3 shadow-sm">
        <h1 className="text-h2 text-neutral-900">Algo saiu do lugar</h1>
        <p className="mt-1 text-sm text-neutral-600">
          O mais provável é que o sistema tenha acabado de ser atualizado
          enquanto esta aba estava aberta. Recarregar resolve na grande
          maioria das vezes.
        </p>
        <div className="mt-2 flex flex-wrap gap-1">
          <button
            type="button"
            onClick={() => window.location.reload()}
            className="inline-flex h-[40px] items-center rounded-md bg-primary-600 px-2 text-sm font-medium text-neutral-0 transition-colors duration-[120ms] hover:bg-primary-700 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-primary-500"
          >
            Recarregar a página
          </button>
          <button
            type="button"
            onClick={reset}
            className="inline-flex h-[40px] items-center rounded-md border border-neutral-300 bg-neutral-0 px-2 text-sm font-medium text-neutral-800 transition-colors duration-[120ms] hover:bg-neutral-100 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-primary-500"
          >
            Tentar de novo sem recarregar
          </button>
        </div>
        {error.digest ? (
          <p className="mt-2 font-mono text-xs text-neutral-400">
            Se persistir, mande este código para a administração: {error.digest}
          </p>
        ) : null}
      </div>
    </main>
  );
}
