"use server";

import { cookies } from "next/headers";
import { revalidatePath } from "next/cache";
import { after } from "next/server";
import { createClient, createServiceClient } from "@/lib/supabase/server";
import { destinoSeguro } from "@/lib/rotas";
import {
  aparelhoConfirmado,
  COOKIE_APARELHO,
  COOKIE_CODIGO,
  lerCodigoPendente,
  REENVIO_MS,
} from "@/lib/codigo-login";
import { ipDoCliente, JANELA_MIN, MAX_FALHAS, paraFiltro } from "./freio";
import { emitirCodigo } from "./emissao";
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
  // barreira de verdade do ?proximo=. A tela do código valida de novo o que
  // recebe, e só então o navegador vai até lá.
  const destino = destinoSeguro(formData.get("proximo"));

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

  // Login correto zera o contador do e-mail e do IP, e aproveita a passagem
  // para expurgar registros velhos (a tabela nunca acumula mais que 1 dia).
  // Depois da resposta (after): o freio só lê o contador na PRÓXIMA tentativa
  // de senha, e quem acabou de acertar não precisa esperar duas idas ao banco.
  after(async () => {
    await Promise.all([
      service
        .from("login_tentativas")
        .delete()
        .or(`email.eq."${paraFiltro(emailNorm)}",ip.eq."${paraFiltro(ip)}"`),
      service
        .from("login_tentativas")
        .delete()
        .lt("criado_em", new Date(Date.now() - 86_400_000).toISOString()),
    ]).catch(() => {});
  });

  revalidatePath("/", "layout");

  // Senha certa. Aparelho que já confirmou o código para esta pessoa segue
  // direto para o destino. Aparelho novo recebe o código no e-mail, e o
  // destino aponta DIRETO para a tela do código: se fosse a tela final, o
  // middleware desviaria por dentro e a tela do código apareceria com o
  // endereço da tela final na barra.
  const usuario = sessao.user;
  const jarro = await cookies();
  // Carimbo de um login anterior (Sair, troca de conta, sessão revogada em
  // outro aparelho) não pode derrubar a sessão que acabou de nascer. Sem
  // ele, o middleware conta a atividade a partir do primeiro request.
  jarro.delete(COOKIE_ATIVIDADE);
  if (await aparelhoConfirmado(jarro.get(COOKIE_APARELHO)?.value, usuario.id)) {
    return { ir: destino };
  }

  let telaCodigo = `/entrar/codigo?proximo=${encodeURIComponent(destino)}`;
  // Dois cliques em Entrar, ou voltar e entrar de novo logo em seguida, não
  // mandam dois e-mails: o código do último minuto continua valendo. Se o
  // envio falhar, a tela do código abre no botão de enviar, e o ?falha= diz
  // o motivo (só a chave; o texto mora em emissao.ts e a URL não injeta
  // frase nenhuma na tela).
  const pendente = await lerCodigoPendente(
    jarro.get(COOKIE_CODIGO)?.value,
    usuario.id,
  );
  const recente = pendente && Date.now() - pendente.enviadoEm < REENVIO_MS;
  if (!recente && usuario.email) {
    const envio = await emitirCodigo(
      { id: usuario.id, email: usuario.email },
      ip,
    );
    if ("erro" in envio) telaCodigo += `&falha=${envio.motivo}`;
  }
  return { ir: telaCodigo };
}
