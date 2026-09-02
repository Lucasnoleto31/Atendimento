import type { Papel } from "@/lib/papeis";
import { createClient } from "@/lib/supabase/server";

export type PerfilSessao = {
  id: string;
  nome: string;
  email: string;
  papel: Papel;
};

/** Perfil do usuário logado, ou null. */
export async function perfilAtual(): Promise<PerfilSessao | null> {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) return null;

  const { data } = await supabase
    .from("profiles")
    .select("id, nome, email, papel")
    .eq("id", user.id)
    .single();

  return (data as PerfilSessao) ?? null;
}

export async function ehGestor() {
  const perfil = await perfilAtual();
  return perfil?.papel === "admin" || perfil?.papel === "gestor";
}

/**
 * Igual a perfilAtual(), mas devolve null para quem não pode gravar
 * (compliance é só leitura). É a guarda das actions que escrevem por
 * service role ou disparam efeito externo (WhatsApp) — o RLS restritivo
 * não alcança esses caminhos.
 */
export async function perfilQueEscreve(): Promise<PerfilSessao | null> {
  const perfil = await perfilAtual();
  if (!perfil || perfil.papel === "compliance") return null;
  return perfil;
}
