import type { Metadata } from "next";
import Link from "next/link";
import { LoginForm } from "./login-form";

export const metadata: Metadata = {
  title: "Entrar · Zeve CRM",
};

export default async function EntrarPage({
  searchParams,
}: PageProps<"/entrar">) {
  const params = await searchParams;
  const proximo =
    typeof params.proximo === "string" && params.proximo.startsWith("/")
      ? params.proximo
      : "/atendimento";

  return (
    <main className="flex flex-1 items-center justify-center px-2 py-8">
      <div className="w-full max-w-[400px]">
        <Link
          href="/"
          className="inline-flex items-center gap-1 rounded-md focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-primary-500"
        >
          <span
            aria-hidden
            className="flex h-[28px] w-[28px] items-center justify-center rounded-md bg-primary-600 font-mono text-sm text-neutral-0"
          >
            Z
          </span>
          <span className="text-base font-semibold text-neutral-900">
            Zeve CRM
          </span>
        </Link>

        <div className="mt-3 rounded-lg border border-neutral-200 bg-neutral-0 p-3 shadow-sm">
          <h1 className="text-h2 text-neutral-900">Entrar</h1>
          <p className="mt-1 text-sm text-neutral-600">
            Acesso restrito à equipe. Quem cria as contas é a administração.
          </p>

          <div className="mt-3">
            <LoginForm proximo={proximo} />
          </div>
        </div>

        <p className="mt-2 text-sm text-neutral-600">
          Esqueceu a senha? Fale com a administração para redefinir.
        </p>
      </div>
    </main>
  );
}
