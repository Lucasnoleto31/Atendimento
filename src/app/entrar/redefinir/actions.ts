"use server";

import { cookies } from "next/headers";
import { revalidatePath } from "next/cache";
import { after } from "next/server";
import { createClient, createServiceClient } from "@/lib/supabase/server";
import { destinoSeguro } from "@/lib/rotas";
import { registrarAcesso } from "@/lib/auditoria";
import {
  CODIGO_VALIDADE_MS,
  normalizarCodigo,
} from "@/lib/codigo-recuperacao";
import {
  ipDoCliente,
  limpar,
  MENSAGEM_MUITAS_TENTATIVAS,
  reservarTentativaDeCodigo,
} from "../freio";
import { COOKIE_ATIVIDADE } from "../atividade";
import { urlEntrar } from "../caminhos";

export type ErrosRedefinir = {
  email?: string;
  codigo?: string;
  senha?: string;
  confirmacao?: string;
};

export type EstadoRedefinir = {
  erro?: string;
  erros?: ErrosRedefinir;
  ir?: string;
  /** A senha foi trocada, mas a sessão nova não abriu: o endereço do login,
   *  para a pessoa entrar com a senha nova. */
  entrar?: string;
};

const SENHA_MIN = 8;
/** Limite do bcrypt que o Supabase usa: o que passa disso é ignorado. */
const SENHA_MAX = 72;
/** Folga para relógio de servidor diferente do Supabase. */
const FOLGA_MS = 60_000;

/**
 * Nova senha com o código de recuperação. O código vem do Supabase (o
 * tamanho segue o "Email OTP Length" do painel, por isso aceita de 6 a 10
 * dígitos). Errar conta no freio de palpites de código (marca CODIGO).
 */
export async function redefinirSenha(
  _estado: EstadoRedefinir,
  formData: FormData,
): Promise<EstadoRedefinir> {
  const email = String(formData.get("email") ?? "")
    .trim()
    .toLowerCase();
  const codigo = normalizarCodigo(formData.get("codigo"), { min: 6, max: 10 });
  const senha = String(formData.get("senha") ?? "");
  const confirmacao = String(formData.get("confirmacao") ?? "");
  // O destino que o login tinha quando a pessoa foi pedir senha nova; sem
  // ele, o padrão. O campo oculto qualquer um monta: a barreira é esta.
  const destino = destinoSeguro(formData.get("proximo"));

  const erros: ErrosRedefinir = {};
  if (!email || !email.includes("@")) {
    erros.email = "Informe o e-mail da sua conta.";
  }
  if (!codigo) {
    erros.codigo = "Digite os números do código que chegou no e-mail.";
  }
  if (senha.length < SENHA_MIN) {
    erros.senha = `A senha precisa de pelo menos ${SENHA_MIN} caracteres.`;
  } else if (senha.length > SENHA_MAX) {
    erros.senha = `A senha pode ter no máximo ${SENHA_MAX} caracteres.`;
  } else if (confirmacao !== senha) {
    erros.confirmacao = "As duas senhas não são iguais.";
  }
  if (Object.keys(erros).length > 0 || !codigo) return { erros };

  const ip = await ipDoCliente();
  const reserva = await reservarTentativaDeCodigo(email, ip);
  if (reserva.situacao === "indisponivel") {
    return {
      erro: "Não deu para conferir o código agora. Tente de novo em instantes.",
    };
  }
  if (reserva.situacao === "bloqueada") {
    registrarAcesso(null, "codigo_login_bloqueado", {
      email,
      ip,
      motivo: "nova senha",
    });
    return { erro: MENSAGEM_MUITAS_TENTATIVAS };
  }

  // verifyOtp no cliente de servidor: o código certo abre a sessão e os
  // cookies dela já saem nesta resposta.
  const supabase = await createClient();
  const { data, error } = await supabase.auth.verifyOtp({
    email,
    token: codigo,
    type: "recovery",
  });
  if (error || !data.user) {
    return {
      erros: {
        codigo:
          "Código não confere ou já venceu. Confira o último e-mail ou peça outro.",
      },
    };
  }
  const usuario = data.user;

  // O e-mail promete 10 minutos; o prazo do Supabase é o do painel (1 hora
  // por padrão). recovery_sent_at é a hora em que o código foi gerado.
  const geradoEm = Date.parse(usuario.recovery_sent_at ?? "");
  if (
    Number.isFinite(geradoEm) &&
    Date.now() - geradoEm > CODIGO_VALIDADE_MS + FOLGA_MS
  ) {
    await supabase.auth.signOut({ scope: "local" });
    return { erros: { codigo: "Este código venceu. Peça outro." } };
  }

  // Senha pelo admin, não pelo updateUser da sessão: quem cadastrou o app
  // autenticador ainda tem o fator no Auth, e o Supabase recusa troca de
  // senha de sessão sem o segundo fator (insufficient_aal). O código acima
  // já provou que a pessoa manda no e-mail.
  let service: ReturnType<typeof createServiceClient>;
  try {
    service = createServiceClient();
  } catch {
    await supabase.auth.signOut({ scope: "local" });
    return {
      erro: "O servidor está sem a chave de serviço do Supabase. Avise a administração.",
    };
  }
  const { error: erroSenha } = await service.auth.admin.updateUserById(
    usuario.id,
    { password: senha },
  );
  if (erroSenha) {
    // O código já foi gasto: sem sessão pela metade, a pessoa pede outro.
    await supabase.auth.signOut({ scope: "local" });
    console.error(`[redefinir] senha recusada: ${erroSenha.message}`);
    return {
      erros: {
        senha:
          erroSenha.code === "weak_password"
            ? "O servidor pediu uma senha mais forte. Misture letras, números e símbolos e peça um código novo."
            : "A senha não foi salva. Peça um código novo e tente de novo.",
      },
    };
  }

  // A troca pelo admin encerra TODAS as sessões da pessoa no Auth (o
  // UpdatePassword do supabase/auth sem sessão faz Logout de tudo), a que o
  // verifyOtp acabou de abrir também. Os outros aparelhos saem por isso: se
  // a troca foi por suspeita, quem estava dentro com a senha antiga sai. Este
  // entra de novo com a senha nova, como em Minha conta, e os cookies da
  // sessão nova saem nesta resposta.
  const { error: erroEntrada } = await supabase.auth.signInWithPassword({
    email,
    password: senha,
  });
  if (erroEntrada) {
    console.error(`[redefinir] sessão nova não abriu: ${erroEntrada.message}`);
    // Os cookies da sessão encerrada saem: o login abre limpo.
    await supabase.auth.signOut({ scope: "local" });
  } else {
    // Rede de segurança, se o Auth um dia deixar de derrubar as sessões na
    // troca: os outros aparelhos saem pela sessão nova, que fica.
    await supabase.auth.signOut({ scope: "others" });
  }

  // Sessão nova: o carimbo de atividade de antes não vale para ela.
  (await cookies()).delete(COOKIE_ATIVIDADE);

  registrarAcesso(usuario.id, "senha_redefinida", { email, ip });
  // As falhas de senha deste e-mail também saem: quem errou cinco vezes e
  // redefiniu pelo código ficaria barrado no login por mais 15 minutos,
  // agora com a senha certa. As do IP ficam (podem ser de outra pessoa).
  after(async () => {
    await limpar("CODIGO", email);
    await service
      .from("login_tentativas")
      .delete()
      .eq("email", email)
      .then(
        () => {},
        () => {},
      );
  });
  revalidatePath("/", "layout");
  // Sem sessão, o destino mandaria ao login sem dizer que a senha mudou: o
  // formulário dá o aviso e o caminho até lá, com o mesmo destino.
  if (erroEntrada) return { entrar: urlEntrar("/entrar", { proximo: destino }) };
  return { ir: destino };
}
