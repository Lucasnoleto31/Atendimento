import { cookies } from "next/headers";
import { NextResponse, type NextRequest } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { COOKIE_ATIVIDADE } from "../atividade";

/**
 * O Sair do app inteiro: o do menu lateral, o da folha do "Mais" e o das
 * telas sem acesso ("Acesso desativado" e "Perfil não encontrado") postam
 * para cá. Formulário comum, sem server action: funciona antes da hidratação
 * e com a conta desativada, de quem o middleware barra toda server action.
 *
 * O escopo é global: revoga o refresh token no servidor, em todos os
 * aparelhos, e não só apaga o cookie deste navegador. O token de acesso
 * morre em minutos, e o getUser() do middleware derruba antes disso. O
 * carimbo de atividade perde o sentido e é apagado.
 *
 * Só POST, e 303 para o /entrar virar GET. O cookie de sessão é SameSite=Lax:
 * um site de fora não o manda num POST e não consegue tirar ninguém daqui.
 * O middleware deixa este caminho passar sem o desvio das telas de entrada.
 */
export async function POST(request: NextRequest) {
  const supabase = await createClient();
  await supabase.auth.signOut({ scope: "global" });
  (await cookies()).delete(COOKIE_ATIVIDADE);
  return NextResponse.redirect(new URL("/entrar", request.url), 303);
}
