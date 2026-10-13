import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import { after } from "next/server";
import { LogOut } from "lucide-react";
import { idDaSessao, perfilAtual } from "@/lib/auth";
import { AppShell } from "@/components/app/app-shell";
import { Button } from "@/components/ui/button";
import { Moldura } from "@/app/entrar/moldura";
import { fotosDaEquipe } from "@/lib/fotos-equipe";
import { processarCampanhas } from "@/lib/campanhas";

export default async function AppLayout({ children }: LayoutProps<"/">) {
  // Mesmo perfil (em cache) que a página e os loaders do request vão ler:
  // uma verificação de sessão e uma consulta a profiles para a tela toda.
  // A foto vem do cache entre requests (fotosDaEquipe): não pesa na tela.
  const [perfil, fotos] = await Promise.all([perfilAtual(), fotosDaEquipe()]);

  if (!perfil) {
    if (!(await idDaSessao())) {
      redirect("/entrar");
    }

    // Usuário existe no Auth mas sem perfil: o gatilho não rodou ou foi apagado.
    return (
      <TelaSemAcesso titulo="Perfil não encontrado">
        Sua conta existe na autenticação, mas não tem perfil na tabela{" "}
        <code className="text-xs">profiles</code>. Peça à administração para
        recriar o usuário ou inserir o perfil.
      </TelaSemAcesso>
    );
  }

  if (!perfil.ativo) {
    return (
      <TelaSemAcesso titulo="Acesso desativado">
        A administração desativou esta conta. Para voltar a usar o sistema, fale
        com o gestor da equipe.
      </TelaSemAcesso>
    );
  }

  // Batimento das campanhas: elas mandam a cota do dia aos poucos e não há
  // cron externo (a rota /api/cron/campanhas existe, mas é opcional). Daqui,
  // QUALQUER página aberta por QUALQUER pessoa alimenta o motor — o freio de
  // 5 min dentro de processarCampanhas evita repetição. Roda depois da
  // resposta (after), sem atrasar a tela.
  // MOTORES_DESLIGADOS=1 é para a máquina de desenvolvimento ligada no banco
  // de produção: sem isto, abrir uma página local dispararia campanhas reais
  // com o envio desligado, e os envios seriam gravados como falha.
  if (process.env.MOTORES_DESLIGADOS !== "1") {
    after(async () => {
      await processarCampanhas().catch(() => {});
    });
  }

  // Preferência "menu cheio no chat" no cookie (padrão do tema): o SSR já
  // pinta a largura certa e o menu lateral não pula depois da hidratação.
  const jarro = await cookies();
  const menuChatExpandido = jarro.get("menu-chat")?.value === "expandido";

  return (
    <AppShell
      perfil={{
        nome: perfil.nome,
        email: perfil.email,
        papel: perfil.papel,
        foto: fotos[perfil.id] ?? null,
      }}
      menuChatExpandido={menuChatExpandido}
    >
      {children}
    </AppShell>
  );
}

/**
 * As duas telas acima trocam o app inteiro (sem menu), no desenho da tela de
 * entrada (duas metades no desktop, faixa no topo no celular). A saída é o
 * Sair, sem ela quem está logado fica preso até apagar os cookies. Posta
 * para /entrar/sair, como todo Sair do app: é formulário comum, e não
 * server action, que o middleware barra para conta desativada.
 */
function TelaSemAcesso({
  titulo,
  children,
}: {
  titulo: string;
  children: React.ReactNode;
}) {
  return (
    <Moldura titulo={titulo} descricao={children}>
      <form action="/entrar/sair" method="post">
        <Button
          type="submit"
          variant="secondary"
          size="lg"
          className="w-full"
          icone={<LogOut size={18} strokeWidth={1.75} aria-hidden />}
        >
          Sair
        </Button>
      </form>
    </Moldura>
  );
}
