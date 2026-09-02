import { NextResponse, type NextRequest } from "next/server";
import { createServerClient } from "@supabase/ssr";

const COOKIE_ATIVIDADE = "za_atividade";
const INATIVIDADE_MS = 24 * 60 * 60 * 1000;

/**
 * Renova o cookie de sessão a cada request, barra acesso às rotas internas
 * de quem não está autenticado e derruba sessão parada há mais de 24h.
 *
 * A expiração por inatividade vive AQUI, não no Supabase: o corte por
 * inatividade é recurso pago do painel, e o middleware já vê toda
 * requisição. Cada acesso renova o carimbo; passadas 24h sem nenhum, a
 * sessão é revogada NO SERVIDOR (signOut invalida o refresh token — o
 * cookie roubado de um navegador não volta à vida) e a pessoa cai no
 * /entrar com o retorno para onde estava.
 *
 * Limite honesto: o carimbo é um cookie do próprio usuário — adulterá-lo só
 * desliga o corte de inatividade DELE MESMO, que é exatamente o
 * comportamento que o sistema tinha até ontem. O que protege a conta é a
 * revogação no servidor, não o carimbo.
 */
export async function middleware(request: NextRequest) {
  let response = NextResponse.next({ request });

  const supabase = createServerClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
    {
      cookies: {
        getAll() {
          return request.cookies.getAll();
        },
        setAll(cookiesToSet) {
          cookiesToSet.forEach(({ name, value }) =>
            request.cookies.set(name, value),
          );
          response = NextResponse.next({ request });
          cookiesToSet.forEach(({ name, value, options }) =>
            response.cookies.set(name, value, options),
          );
        },
      },
    },
  );

  const {
    data: { user },
  } = await supabase.auth.getUser();

  const { pathname } = request.nextUrl;

  // Sessão parada há mais de 24h: revoga no servidor e manda para o login,
  // guardando o destino — depois de logar, a pessoa volta para onde estava.
  if (user) {
    const carimbo = Number(request.cookies.get(COOKIE_ATIVIDADE)?.value ?? 0);
    if (carimbo > 0 && Date.now() - carimbo > INATIVIDADE_MS) {
      await supabase.auth.signOut();
      const url = request.nextUrl.clone();
      url.pathname = "/entrar";
      url.search = "";
      if (!pathname.startsWith("/entrar")) {
        url.searchParams.set("proximo", pathname);
      }
      const expirada = NextResponse.redirect(url);
      // Os cookies de limpeza do signOut foram escritos em `response`
      // (via setAll) — o redirect precisa carregá-los, senão o navegador
      // fica com a sessão morta no bolso.
      response.cookies.getAll().forEach((c) => expirada.cookies.set(c));
      expirada.cookies.delete(COOKIE_ATIVIDADE);
      return expirada;
    }
    // Atividade renova o prazo. httpOnly: só o servidor escreve.
    response.cookies.set(COOKIE_ATIVIDADE, String(Date.now()), {
      httpOnly: true,
      sameSite: "lax",
      secure: process.env.NODE_ENV === "production",
      path: "/",
      maxAge: 60 * 60 * 24 * 30,
    });
  }

  const rotaPublica =
    pathname === "/" ||
    pathname.startsWith("/entrar") ||
    // Formulário público de captura (7.1): a action valida tudo no servidor.
    pathname.startsWith("/captura") ||
    pathname.startsWith("/api/webhooks") ||
    // Cron autentica por CRON_SECRET na própria rota, não por sessão.
    pathname.startsWith("/api/cron");

  if (!user && !rotaPublica) {
    const url = request.nextUrl.clone();
    url.pathname = "/entrar";
    url.searchParams.set("proximo", pathname);
    return NextResponse.redirect(url);
  }

  // Segundo fator obrigatório (EXIGIR_2FA=0 desliga em emergência). Quem
  // entrou só com a senha: com fator cadastrado vai digitar o código; sem
  // fator vai cadastrar. As duas telas ficam sob /entrar e são as únicas
  // que um usuário "meio logado" alcança.
  if (user && process.env.EXIGIR_2FA !== "0") {
    const paginaCodigo = pathname.startsWith("/entrar/codigo");
    const paginaCadastro = pathname.startsWith("/entrar/2fa");
    // "Tem fator?" vem do getUser() de cima (servidor, fresco) — o cookie
    // guarda uma foto velha dos fatores e mandaria gente para a tela errada.
    // "Confirmou?" é a claim aal do próprio token.
    const { data: aal } =
      await supabase.auth.mfa.getAuthenticatorAssuranceLevel();
    const temFator = (user.factors ?? []).some((f) => f.status === "verified");
    const confirmado = aal?.currentLevel === "aal2";
    if (!confirmado) {
      const destino = temFator ? "/entrar/codigo" : "/entrar/2fa";
      const jaLa = temFator ? paginaCodigo : paginaCadastro;
      const liberada =
        pathname.startsWith("/api/webhooks") ||
        pathname.startsWith("/api/cron");
      if (!jaLa && !liberada) {
        const url = request.nextUrl.clone();
        url.pathname = destino;
        url.search = "";
        if (!pathname.startsWith("/entrar") && pathname !== "/") {
          url.searchParams.set("proximo", pathname);
        }
        const ida = NextResponse.redirect(url);
        response.cookies.getAll().forEach((c) => ida.cookies.set(c));
        return ida;
      }
      return response;
    }
  }

  if (user && pathname.startsWith("/entrar")) {
    const url = request.nextUrl.clone();
    url.pathname = "/hoje";
    url.search = "";
    return NextResponse.redirect(url);
  }

  return response;
}

export const config = {
  matcher: [
    "/((?!_next/static|_next/image|favicon.ico|.*\\.(?:svg|png|jpg|jpeg|gif|webp)$).*)",
  ],
};
