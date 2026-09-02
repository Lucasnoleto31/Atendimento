import type { Metadata } from "next";
import { Confirmar2fa } from "./confirmar";

export const metadata: Metadata = { title: "Confirmar · Zeve CRM" };

/** Segundo passo do login: o código do app autenticador. */
export default async function CodigoPage({
  searchParams,
}: PageProps<"/entrar/codigo">) {
  const params = await searchParams;
  const proximo =
    typeof params.proximo === "string" &&
    params.proximo.startsWith("/") &&
    !params.proximo.startsWith("//") &&
    !params.proximo.startsWith("/\\")
      ? params.proximo
      : "/hoje";
  return (
    <main className="flex flex-1 items-center justify-center px-2 py-8">
      <div className="w-full max-w-[400px]">
        <div className="flex items-center gap-1">
          <span
            aria-hidden
            className="flex h-[28px] w-[28px] items-center justify-center rounded-md bg-primary-600 font-mono text-sm text-neutral-0"
          >
            Z
          </span>
          <span className="text-base font-semibold text-neutral-900">
            Zeve CRM
          </span>
        </div>
        <div className="mt-3 rounded-lg border border-neutral-200 bg-neutral-0 p-3 shadow-sm">
          <h1 className="text-h2 text-neutral-900">Confirme que é você</h1>
          <p className="mt-1 text-sm text-neutral-600">
            Digite o código de 6 dígitos do seu app autenticador. Ele muda a
            cada 30 segundos.
          </p>
          <div className="mt-3">
            <Confirmar2fa proximo={proximo} />
          </div>
        </div>
        <p className="mt-2 text-sm text-neutral-600">
          Perdeu o aparelho? A administração pode resetar o seu segundo fator.
        </p>
      </div>
    </main>
  );
}
