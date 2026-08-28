import { redirect } from "next/navigation";
import { after } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { AppShell, type Perfil } from "@/components/app/app-shell";
import { processarCadencia } from "@/lib/cadencia";
import { processarAgendadas } from "@/lib/agendadas";
import { processarCampanhas } from "@/lib/campanhas";
import { garantirGiroFresco } from "@/lib/giro";
import { sincronizarGenial } from "@/lib/genial";
import { processarResumoGestor } from "@/lib/resumo-gestor";

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
    .select("nome, email, papel, ativo")
    .eq("id", user.id)
    .single();

  if (perfil && !perfil.ativo) {
    return (
      <main className="flex flex-1 items-center justify-center px-2 py-8">
        <div className="max-w-[68ch] rounded-lg border border-neutral-200 bg-neutral-0 p-3 shadow-sm">
          <h1 className="text-h3 text-neutral-900">Acesso desativado</h1>
          <p className="mt-1 text-sm text-neutral-600">
            Sua conta foi desativada pela administração. Fale com o gestor da
            equipe para reativar.
          </p>
        </div>
      </main>
    );
  }

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

  // O batimento das automações morava só no /chat: cadência e campanha
  // paravam se ninguém abrisse aquela tela (e o dono optou por não usar cron
  // externo). Daqui, QUALQUER página aberta por QUALQUER pessoa alimenta os
  // motores — o freio de 5 min dentro de cada processador evita repetição.
  after(async () => {
    // Genial antes do giro: se o dia trouxe arquivo novo, o giro que os
    // motores leem já sai atualizado por ele.
    await sincronizarGenial().catch(() => {});
    await garantirGiroFresco();
    await processarCadencia().catch(() => {});
    await processarAgendadas().catch(() => {});
    await processarCampanhas().catch(() => {});
    await processarResumoGestor().catch(() => {});
  });

  return <AppShell perfil={perfil as Perfil}>{children}</AppShell>;
}
