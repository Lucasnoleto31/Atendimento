import { NextResponse, type NextRequest } from "next/server";
import { createServerClient } from "@supabase/ssr";
import { destinoSeguro } from "@/lib/rotas";
import { COOKIE_ATIVIDADE } from "@/app/entrar/atividade";

const INATIVIDADE_MS = 24 * 60 * 60 * 1000;
/** Idade mínima do carimbo antes de regravá-lo (ver a renovação abaixo). */
const RENOVACAO_MS = 5 * 60 * 1000;
/** O sair por formulário (entrar/sair/route.ts): passa sem os desvios. */
const ROTA_SAIR = "/entrar/sair";

/** Redirect que leva junto os cookies que o Supabase acabou de renovar. */
function comCookies(destino: NextResponse, origem: NextResponse): NextResponse {
  origem.cookies.getAll().forEach((c) => destino.cookies.set(c));
  return destino;
}

/**
 * Renova o cookie de sessão a cada request, barra acesso às rotas internas
 * de quem não está autenticado e derruba sessão parada há mais de 24h.
 *
 * A expiração por inatividade vive AQUI, não no Supabase: o corte por
 * inatividade é recurso pago do painel, e o middleware já vê toda
 * requisição. Cada acesso conta como atividade (o carimbo é regravado de
 * 5 em 5 min, ver RENOVACAO_MS); passadas 24h sem nenhum, a sessão é
 * revogada NO SERVIDOR (signOut invalida o refresh token — o cookie roubado
 * de um navegador não volta à vida) e a pessoa cai no /entrar com o retorno
 * para onde estava.
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
      // O destino leva a query junto (/chat?lead=…, /contatos?busca=…): sem
      // ela a pessoa voltaria à tela, mas não à conversa ou ao filtro.
      if (!pathname.startsWith("/entrar")) {
        url.searchParams.set("proximo", pathname + request.nextUrl.search);
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
    // Regrava só quando o carimbo passou de 5 min: o chat dispara action,
    // prefetch e RSC sem parar, e um Set-Cookie em cada resposta não muda
    // nada num prazo de 24h. O corte pode chegar até 5 min antes das 24h
    // exatas da última atividade — diferença que ninguém sente. Carimbo
    // ausente, ilegível ou no futuro conta como vencido e é regravado.
    const idade = Date.now() - carimbo;
    if (!(idade >= 0 && idade <= RENOVACAO_MS)) {
      response.cookies.set(COOKIE_ATIVIDADE, String(Date.now()), {
        httpOnly: true,
        sameSite: "lax",
        secure: process.env.NODE_ENV === "production",
        path: "/",
        maxAge: 60 * 60 * 24 * 30,
      });
    }
  }

  // Webhooks e cron não têm sessão de gente: autenticam na própria rota
  // (assinatura da Meta, CRON_SECRET) e ficam fora dos dois portões.
  const semPessoa =
    pathname.startsWith("/api/webhooks") || pathname.startsWith("/api/cron");

  // O formulário de captura é a página do anúncio: quem chega não tem conta,
  // e a action confere tudo no servidor. Só passa sem sessão; logado, segue
  // pelos portões abaixo como qualquer tela, porque um POST de server action
  // vale em qualquer endereço de página, e liberar /captura para quem está
  // logado abriria um desvio do portão da conta desativada.
  const formularioPublico =
    pathname === "/captura" || pathname.startsWith("/captura/");

  const rotaPublica =
    // A raiz só redireciona para o destino padrão; quem não está logado
    // segue dali para o /entrar com o retorno já certo.
    pathname === "/" ||
    pathname.startsWith("/entrar") ||
    formularioPublico ||
    semPessoa;

  if (!user) {
    // Sem sessão, o carimbo de atividade de antes não vale para nada, e
    // ficando no navegador ele derrubaria o próximo login logo no primeiro
    // request (Sair na sexta, entrar na segunda). A action de entrar e a
    // rota /entrar/sair também o apagam; aqui cobre o resto (sessão revogada
    // em outro aparelho, token vencido).
    const semCarimbo = (r: NextResponse) => {
      if (request.cookies.has(COOKIE_ATIVIDADE)) {
        r.cookies.delete(COOKIE_ATIVIDADE);
      }
      return r;
    };
    if (rotaPublica) return semCarimbo(response);
    const url = request.nextUrl.clone();
    url.pathname = "/entrar";
    // A query da tela pedida vai dentro do ?proximo=, não solta no /entrar.
    url.search = "";
    url.searchParams.set("proximo", pathname + request.nextUrl.search);
    return semCarimbo(comCookies(NextResponse.redirect(url), response));
  }

  if (semPessoa || pathname === ROTA_SAIR) return response;

  // Já dentro: as telas de entrada não têm o que fazer e levam ao destino
  // pedido (ou ao padrão).
  if (pathname.startsWith("/entrar")) {
    const destino = destinoSeguro(request.nextUrl.searchParams.get("proximo"));
    return comCookies(
      NextResponse.redirect(new URL(destino, request.url)),
      response,
    );
  }

  // Conta desativada. Desativar grava só profiles.ativo = false; a sessão
  // continua válida e o RLS não olha essa coluna. As telas já mostram
  // "Acesso desativado" (o layout), mas a aba aberta seguia chamando server
  // action (mandar WhatsApp, disparar, ler conversas) e a rota de exportar
  // a base. Aqui a conta inativa perde as duas coisas, seja qual for a
  // guarda da action. Só nesses pedidos, para não pôr uma consulta a mais
  // em toda página: action é POST com o cabeçalho Next-Action. A saída
  // dessa pessoa é o ROTA_SAIR, liberado acima. Erro de rede na consulta
  // deixa passar: a guarda da action (perfilAtivo) é a barreira de verdade.
  const age = request.method === "POST" && request.headers.has("next-action");
  if (age || pathname.startsWith("/api/exportar")) {
    const { data, error } = await supabase
      .from("profiles")
      .select("ativo")
      .eq("id", user.id)
      .maybeSingle();
    if (!error && !data?.ativo) {
      return comCookies(
        new NextResponse("Acesso desativado.", { status: 403 }),
        response,
      );
    }
  }

  return response;
}

export const config = {
  // Tudo passa por aqui, menos os arquivos do build, o ícone da aba
  // (src/app/icon.tsx, servido em /icon) e as pastas public/marca e
  // public/temas (a marca e os tokens do tema do cliente). Sem o ícone na exceção, as
  // telas de /entrar ficavam sem ícone (o pedido dele era desviado para o
  // login) e, para quem está dentro, cada pedido do ícone passava pelo
  // getUser. A exceção é por nome, nunca por extensão: pular .png ou .svg
  // abria um desvio, porque /contatos/x.png casa com a rota /contatos/[id]
  // e chegava ao layout e às server actions sem passar pelos portões daqui.
  matcher: ["/((?!_next/static|_next/image|favicon.ico|icon$|marca/|temas/).*)"],
};
