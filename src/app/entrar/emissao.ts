import { cookies } from "next/headers";
import {
  assinarCodigoPendente,
  CODIGO_VALIDADE_MS,
  COOKIE_CODIGO,
  gerarCodigo,
  opcoesCookie,
} from "@/lib/codigo-login";
import { enviarCodigoPorEmail } from "@/lib/email";
import { registrarAcesso } from "@/lib/auditoria";
import { contarRecentes, MAX_FALHAS, registrar } from "./freio";

/** Por que o código não saiu. A chave vai no ?falha= da tela do código. */
export type MotivoFalha =
  | "muitas_tentativas"
  | "muitos_envios"
  | "sem_configuracao"
  | "email";

export const MENSAGEM_FALHA: Record<MotivoFalha, string> = {
  // A mesma frase da conferência barrada: quem leu "Muitas tentativas" e
  // pediu outro código lê de novo a mesma coisa, e não um aviso novo.
  muitas_tentativas:
    "Muitas tentativas. Aguarde alguns minutos e peça um código novo.",
  muitos_envios:
    "Você pediu muitos códigos. Espere alguns minutos e tente de novo.",
  sem_configuracao:
    "O servidor está sem a configuração do código de acesso. Avise a administração.",
  email: "O e-mail com o código não saiu. Tente de novo em instantes.",
};

/** A chave de falha que veio na URL, se for uma das conhecidas. */
export function motivoFalha(valor: unknown): MotivoFalha | null {
  return typeof valor === "string" && Object.hasOwn(MENSAGEM_FALHA, valor)
    ? (valor as MotivoFalha)
    : null;
}

export type ResultadoEmissao =
  | { enviadoEm: number }
  | { erro: string; motivo: MotivoFalha };

function falhou(motivo: MotivoFalha): ResultadoEmissao {
  return { erro: MENSAGEM_FALHA[motivo], motivo };
}

/**
 * Gera um código de acesso, manda por e-mail e grava o cookie do código
 * pendente. Serve ao login (senha certa num aparelho novo) e ao "Reenviar
 * código". Só roda dentro de server action: grava cookie.
 *
 * Freio de envio: 5 códigos em 15 minutos por e-mail. Só por e-mail, não
 * por IP: no primeiro dia a equipe inteira entra do mesmo escritório, cada
 * um num aparelho novo. Sem o banco, o envio segue: o pior caso é e-mail
 * repetido, não conta aberta, e o freio do código continua valendo.
 *
 * Com a conferência travada (5 códigos errados em 15 min pelo e-mail ou
 * pelo IP, as mesmas chaves de reservarTentativaDeCodigo), o código novo
 * seria recusado na hora: não sai e-mail nenhum até a trava passar. As duas
 * contagens vão juntas, então a espera da resposta não cresce.
 */
export async function emitirCodigo(
  usuario: { id: string; email: string },
  ip: string,
): Promise<ResultadoEmissao> {
  const email = usuario.email.toLowerCase();

  const [erros, enviados] = await Promise.all([
    contarRecentes("CODIGO", { email, ip }),
    contarRecentes("ENVIO", { email }),
  ]);
  if (erros !== null && erros >= MAX_FALHAS) {
    // Sem linha no Log de acesso: aqui nada foi tentado, e a trava aparece
    // lá quando a conferência barra ("muitos erros").
    return falhou("muitas_tentativas");
  }
  if (enviados !== null && enviados >= MAX_FALHAS) {
    registrarAcesso(usuario.id, "codigo_login_bloqueado", {
      email,
      ip,
      motivo: "muitos envios",
    });
    return falhou("muitos_envios");
  }

  const codigo = gerarCodigo();
  const agora = Date.now();

  // Assina antes de mandar: sem o segredo configurado, melhor não mandar um
  // código que ninguém conseguiria conferir.
  let cookie: string;
  try {
    cookie = await assinarCodigoPendente({
      uid: usuario.id,
      email,
      codigo,
      agora,
    });
  } catch (erro) {
    console.error(
      "[entrar] código de acesso sem assinatura:",
      erro instanceof Error ? erro.message : erro,
    );
    return falhou("sem_configuracao");
  }

  try {
    await enviarCodigoPorEmail(usuario.email, codigo, "acesso");
  } catch (erro) {
    console.error(
      "[entrar] código de acesso não saiu:",
      erro instanceof Error ? erro.message : erro,
    );
    return falhou("email");
  }

  const jarro = await cookies();
  jarro.set(COOKIE_CODIGO, cookie, opcoesCookie(CODIGO_VALIDADE_MS));
  await registrar("ENVIO", email, ip);
  return { enviadoEm: agora };
}
