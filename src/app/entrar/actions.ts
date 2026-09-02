"use server";

import { headers } from "next/headers";
import { redirect } from "next/navigation";
import { revalidatePath } from "next/cache";
import { createClient, createServiceClient } from "@/lib/supabase/server";

export type EstadoLogin = { erro?: string };

const MAX_FALHAS = 5;
const JANELA_MIN = 15;

/**
 * Valor seguro para o filtro or= do PostgREST: vírgula, parêntese e aspas
 * quebram a sintaxe — e-mail com esses caracteres nem é válido de qualquer
 * forma, então remover não bloqueia ninguém legítimo.
 */
function paraFiltro(valor: string): string {
  return valor.replaceAll(/[,()"]/g, "");
}

/** Primeiro salto do x-forwarded-for — é o IP real do cliente na Vercel. */
async function ipDoCliente(): Promise<string> {
  const h = await headers();
  const encadeado = h.get("x-forwarded-for") ?? "";
  const primeiro = encadeado.split(",")[0]?.trim();
  return primeiro || h.get("x-real-ip") || "desconhecido";
}

export async function entrar(
  _estado: EstadoLogin,
  formData: FormData,
): Promise<EstadoLogin> {
  const email = String(formData.get("email") ?? "").trim();
  const senha = String(formData.get("senha") ?? "");
  const proximo = String(formData.get("proximo") ?? "/hoje");

  if (!email || !senha) {
    return { erro: "Informe e-mail e senha." };
  }

  const emailNorm = email.toLowerCase();
  const ip = await ipDoCliente();
  const service = createServiceClient();
  const corte = new Date(Date.now() - JANELA_MIN * 60_000).toISOString();

  // Freio ANTES de tentar a senha: 5 falhas em 15 minutos para este e-mail
  // OU este IP bloqueiam a tentativa. A mensagem é genérica de propósito —
  // não revela se o e-mail existe nem quanto tempo falta.
  // Se a tabela ainda não existe (0046 pendente), o login segue sem freio:
  // segurança extra nunca pode derrubar a porta de entrada.
  const { count: falhasRecentes, error: erroContagem } = await service
    .from("login_tentativas")
    .select("id", { count: "exact", head: true })
    .or(`email.eq."${paraFiltro(emailNorm)}",ip.eq."${paraFiltro(ip)}"`)
    .gte("criado_em", corte);

  if (!erroContagem && (falhasRecentes ?? 0) >= MAX_FALHAS) {
    // A trilha registra a tentativa barrada — quem tentou, de onde, quando.
    await service.from("auditoria").insert({
      quem: null,
      acao: "login_bloqueado",
      detalhes: { email: emailNorm, ip },
    });
    return {
      erro: "Muitas tentativas. Aguarde alguns minutos e tente de novo.",
    };
  }

  const supabase = await createClient();
  const { data: sessao, error } = await supabase.auth.signInWithPassword({
    email,
    password: senha,
  });

  if (error) {
    // Grava a falha para o contador — e mantém a mensagem genérica.
    await service
      .from("login_tentativas")
      .insert({ email: emailNorm, ip })
      .then(
        () => {},
        () => {},
      );
    return { erro: "E-mail ou senha incorretos." };
  }

  // Login correto zera o contador do e-mail e do IP, e aproveita a passagem
  // para expurgar registros velhos (a tabela nunca acumula mais que 1 dia).
  await service
    .from("login_tentativas")
    .delete()
    .or(`email.eq."${paraFiltro(emailNorm)}",ip.eq."${paraFiltro(ip)}"`)
    .then(
      () => {},
      () => {},
    );
  await service
    .from("login_tentativas")
    .delete()
    .lt("criado_em", new Date(Date.now() - 86_400_000).toISOString())
    .then(
      () => {},
      () => {},
    );

  revalidatePath("/", "layout");
  const destino =
    proximo.startsWith("/") && !proximo.startsWith("//") ? proximo : "/hoje";
  // Senha certa = sessão aal1. Com 2FA obrigatório, o próximo passo é o
  // código (ou o cadastro do fator) — redireciona DIRETO para lá: se
  // mandasse para /hoje, o Next seguiria o 307 do middleware por dentro e
  // a tela do código apareceria com /hoje na barra.
  if (process.env.EXIGIR_2FA !== "0") {
    const temFator = (sessao.user?.factors ?? []).some(
      (f) => f.status === "verified",
    );
    redirect(
      `/entrar/${temFator ? "codigo" : "2fa"}?proximo=${encodeURIComponent(destino)}`,
    );
  }
  redirect(destino);
}

export async function sair() {
  const supabase = await createClient();
  // Escopo global explícito: revoga o refresh token NO SERVIDOR, em todos
  // os aparelhos — sair não é só apagar o cookie deste navegador. O token
  // de acesso morre em minutos e o getUser() do middleware (que valida no
  // servidor a cada request) derruba antes disso.
  await supabase.auth.signOut({ scope: "global" });
  revalidatePath("/", "layout");
  redirect("/entrar");
}
