"use server";

import { cookies } from "next/headers";
import { revalidatePath } from "next/cache";
import { after } from "next/server";
import { createClient, createServiceClient } from "@/lib/supabase/server";
import { destinoSeguro } from "@/lib/rotas";
import { ipDoCliente, JANELA_MIN, MAX_FALHAS, MAX_FALHAS_IP } from "./freio";
import { COOKIE_ATIVIDADE } from "./atividade";

export type EstadoLogin = {
  erro?: string;
  /** Para onde ir após a senha. O FORM navega com recarga completa
   *  (window.location) em vez de redirect do router: aba aberta desde antes
   *  de um deploy carrega chunks velhos, e a navegação client-side do Next
   *  morre em silêncio — foi exatamente o "clico em Entrar e nada acontece".
   *  A recarga zera o estado da aba e ainda leva os cookies novos junto. */
  ir?: string;
};

export async function entrar(
  _estado: EstadoLogin,
  formData: FormData,
): Promise<EstadoLogin> {
  const email = String(formData.get("email") ?? "").trim();
  const senha = String(formData.get("senha") ?? "");
  // O campo oculto vem do formulário, que qualquer um monta: esta é a
  // barreira de verdade do ?proximo=.
  const destino = destinoSeguro(formData.get("proximo"));

  if (!email || !senha) {
    return { erro: "Informe e-mail e senha." };
  }

  const emailNorm = email.toLowerCase();
  const ip = await ipDoCliente();
  const service = createServiceClient();
  const corte = new Date(Date.now() - JANELA_MIN * 60_000).toISOString();

  // Freio ANTES de tentar a senha, em duas contas separadas nos últimos 15
  // minutos: 5 falhas para este e-mail ou MAX_FALHAS_IP para este IP
  // bloqueiam a tentativa. A mensagem é genérica de propósito — não revela
  // se o e-mail existe nem quanto tempo falta.
  // Se a tabela ainda não existe (0046 pendente), o login segue sem freio:
  // segurança extra nunca pode derrubar a porta de entrada.
  const falhas = (coluna: "email" | "ip", valor: string) =>
    service
      .from("login_tentativas")
      .select("id", { count: "exact", head: true })
      .eq(coluna, valor)
      .gte("criado_em", corte);
  const [porEmail, porIp] = await Promise.all([
    falhas("email", emailNorm),
    falhas("ip", ip),
  ]);
  const barrado =
    (!porEmail.error && (porEmail.count ?? 0) >= MAX_FALHAS) ||
    (!porIp.error && (porIp.count ?? 0) >= MAX_FALHAS_IP);

  if (barrado) {
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

  if (error || !sessao.user) {
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

  // Login correto zera as falhas DESTE e-mail (de qualquer IP) e aproveita a
  // passagem para expurgar registros velhos (a tabela nunca acumula mais que
  // 1 dia). As do IP ficam até sair da janela: apagá-las deixava quem tem uma
  // conta qualquer errar 4 senhas de outra pessoa, entrar com a própria do
  // mesmo IP para zerar e repetir sem fim — com a senha como única barreira
  // da entrada, isso era tomada de conta.
  // Depois da resposta (after): o freio só lê o contador na PRÓXIMA tentativa
  // de senha, e quem acabou de acertar não precisa esperar duas idas ao banco.
  after(async () => {
    await Promise.all([
      service.from("login_tentativas").delete().eq("email", emailNorm),
      service
        .from("login_tentativas")
        .delete()
        .lt("criado_em", new Date(Date.now() - 86_400_000).toISOString()),
    ]).catch(() => {});
  });

  revalidatePath("/", "layout");

  // Senha certa: direto ao destino. O carimbo de um login anterior (Sair,
  // troca de conta, sessão revogada em outro aparelho) não pode derrubar a
  // sessão que acabou de nascer; sem ele, o middleware conta a atividade a
  // partir do primeiro request.
  (await cookies()).delete(COOKIE_ATIVIDADE);
  return { ir: destino };
}
