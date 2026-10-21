import type { Metadata } from "next";
import { createClient } from "@/lib/supabase/server";
import { lerPrivacidade } from "@/lib/privacidade";
import { exigirAdmin } from "../acesso";
import type { PessoaPrivacidade } from "../privacidade-texto";
import { caminhoDa } from "../rotas";
import { voltarDaSubpagina } from "../subpagina";
import { TelaPrivacidade } from "./tela";
import { titulo } from "@/lib/marca";

export const metadata: Metadata = { title: titulo("Privacidade") };

/** Administração › Privacidade: só o admin vê e grava. */
export default async function PrivacidadePage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  await exigirAdmin();
  const params = await searchParams;
  const supabase = await createClient();

  const [{ data: equipe }, privacidade] = await Promise.all([
    supabase.from("profiles").select("id, nome, papel, ativo").order("nome"),
    // A leitura que falha não derruba a tela; a seção avisa.
    lerPrivacidade().catch(() => null),
  ]);

  return (
    <TelaPrivacidade
      equipe={(equipe ?? []) as PessoaPrivacidade[]}
      privacidade={privacidade}
      voltar={voltarDaSubpagina(params.voltar, caminhoDa("privacidade"))}
    />
  );
}
