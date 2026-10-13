import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { FormAutenticador } from "./form";
import { autenticadorLiberado } from "./liberado";

export const metadata: Metadata = { title: "Autenticador (local)" };

/**
 * Só no computador de desenvolvimento, sem link em lugar nenhum: o banco
 * de produção esconde os dados de quem não confirmou o app autenticador, e
 * o sistema novo entra só com senha e código no e-mail. Aqui a pessoa
 * digita o código do app e a sessão sobe para o nível que o banco pede.
 * No ar, a página não existe (ver liberado.ts).
 */
export default async function Page() {
  if (!autenticadorLiberado()) notFound();

  const supabase = await createClient();
  const { data } = await supabase.auth.mfa.getAuthenticatorAssuranceLevel();
  const confirmado = data?.currentLevel === "aal2";

  return (
    <main className="mx-auto w-full max-w-[440px] px-2 py-4">
      <h1 className="tipo-titulo-2 text-tinta">Autenticador (só no local)</h1>
      <p className="tipo-corpo mt-1 text-texto-2">
        O banco de produção só mostra os dados para quem confirmou o app
        autenticador. Esta tela existe só no seu computador.
      </p>
      {confirmado ? (
        <p className="tipo-corpo mt-2 text-tinta">
          A sessão já está confirmada com o app.
        </p>
      ) : (
        <FormAutenticador />
      )}
    </main>
  );
}
