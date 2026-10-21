import type { Metadata } from "next";
import { createClient } from "@/lib/supabase/server";
import { fotosDaEquipe } from "@/lib/fotos-equipe";
import { lerPrivacidade } from "@/lib/privacidade";
import { exigirAdmin } from "../acesso";
import { caminhoDa } from "../rotas";
import { voltarDaSubpagina } from "../subpagina";
import type { UsuarioLinha } from "../usuarios";
import { TelaEquipe } from "./tela";
import { titulo } from "@/lib/marca";

export const metadata: Metadata = { title: titulo("Equipe") };

/** Administração › Equipe: só o admin. */
export default async function EquipePage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const perfil = await exigirAdmin();
  const params = await searchParams;
  const supabase = await createClient();

  const [{ data: usuarios, comRodizio }, privacidade, fotos] = await Promise.all([
    supabase
      .from("profiles")
      .select("id, nome, email, papel, ativo, recebe_leads")
      .order("nome")
      .then((r) =>
        r.error
          ? supabase
              .from("profiles")
              .select("id, nome, email, papel, ativo")
              .order("nome")
              .then((r2) => ({ ...r2, comRodizio: false }))
          : { ...r, comRodizio: true },
      ),
    // A privacidade de cada pessoa aparece no editor dela; a leitura que
    // falha só tira essa linha.
    lerPrivacidade().catch(() => null),
    // A foto que cada um pôs em Minha conta; sem leitura, as iniciais.
    fotosDaEquipe(),
  ]);

  return (
    <TelaEquipe
      meuId={perfil.id}
      equipe={(usuarios ?? []) as UsuarioLinha[]}
      comRodizio={comRodizio}
      privacidade={privacidade}
      fotos={fotos}
      voltar={voltarDaSubpagina(params.voltar, caminhoDa("equipe"))}
    />
  );
}
