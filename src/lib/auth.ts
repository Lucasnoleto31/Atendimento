import { createClient } from "@/lib/supabase/server";

export type PerfilSessao = {
  id: string;
  nome: string;
  email: string;
  papel: "admin" | "gestor" | "vendedor";
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
