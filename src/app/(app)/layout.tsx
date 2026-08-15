import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { AppShell, type Perfil } from "@/components/app/app-shell";

export default async function AppLayout({ children }: LayoutProps<"/">) {
  const supabase = await createClient();

  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) {
    redirect("/entrar");
  }

  const { data: perfil } = await supabase
    .from("profiles")
    .select("nome, email, papel")
    .eq("id", user.id)
    .single();

  // Usuário existe no Auth mas sem perfil: o gatilho não rodou ou foi apagado.
  if (!perfil) {
    return (
      <main className="flex flex-1 items-center justify-center px-2 py-8">
        <div className="max-w-[68ch] rounded-lg border border-neutral-200 bg-neutral-0 p-3 shadow-sm">
          <h1 className="text-h3 text-neutral-900">Perfil não encontrado</h1>
          <p className="mt-1 text-sm text-neutral-600">
            Sua conta existe na autenticação, mas não tem perfil na tabela{" "}
            <code className="font-mono text-xs">profiles</code>. Peça à
            administração para recriar o usuário ou inserir o perfil manualmente.
          </p>
        </div>
      </main>
    );
  }

  return <AppShell perfil={perfil as Perfil}>{children}</AppShell>;
}
