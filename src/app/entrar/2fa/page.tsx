import type { Metadata } from "next";
import { Cadastrar2fa } from "./cadastrar";

export const metadata: Metadata = { title: "Segundo fator · Zeve CRM" };

/**
 * Cadastro do segundo fator (app autenticador). O middleware manda para cá
 * quem entrou com senha mas ainda não tem o 2FA — obrigatório para todos.
 */
export default async function Cadastro2faPage({
  searchParams,
}: PageProps<"/entrar/2fa">) {
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
      <div className="w-full max-w-[440px]">
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
          <h1 className="text-h2 text-neutral-900">Ative o segundo fator</h1>
          <p className="mt-1 text-sm text-neutral-600">
            A partir de agora todo acesso ao CRM pede senha e um código do app
            autenticador (Google Authenticator, Authy, 1Password…). Leva um
            minuto e é só uma vez por aparelho.
          </p>
          <div className="mt-3">
            <Cadastrar2fa proximo={proximo} />
          </div>
        </div>
      </div>
    </main>
  );
}
