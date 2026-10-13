"use server";

import { after } from "next/server";
import { createServiceClient } from "@/lib/supabase/server";
import { enviarCodigoNovaSenha } from "@/lib/email";
import { registrarAcesso } from "@/lib/auditoria";
import { destinoSeguro } from "@/lib/rotas";
import {
  contarRecentes,
  ipDoCliente,
  MAX_FALHAS,
  MENSAGEM_MUITAS_TENTATIVAS,
  reservarPedidoDeRecuperacao,
  type TetoRecuperacao,
} from "../freio";
import { urlEntrar } from "../caminhos";

export type EstadoEsqueci = { erro?: string; ir?: string };

/** O que a tela diz e o que o Log de acesso grava, por teto que barrou. */
const BARRADO: Record<TetoRecuperacao, { erro: string; motivo: string }> = {
  janela: {
    erro: "Muitos pedidos seguidos. Aguarde alguns minutos e tente de novo.",
    motivo: "muitos pedidos",
  },
  dia: {
    erro: "Este e-mail já pediu muitos códigos hoje. Para entrar antes, peça uma senha nova à administração.",
    motivo: "teto do dia do e-mail",
  },
  hora: {
    erro: "Muitos pedidos de nova senha agora. Tente de novo daqui a uma hora ou peça uma senha nova à administração.",
    motivo: "teto da hora do sistema",
  },
};

/**
 * Pedido de nova senha. A resposta é SEMPRE a mesma, com ou sem conta para
 * o e-mail: a tela não serve para descobrir quem tem acesso. Por isso o
 * código é gerado e mandado depois da resposta (after), e o tempo de
 * resposta também não muda com a existência da conta.
 *
 * Freio com a marca RECUPERACAO (ver freio.ts): 5 pedidos em 15 minutos por
 * e-mail OU IP, 10 por e-mail em 24 h e 30 por hora no sistema inteiro,
 * para ninguém encher a caixa de alguém nem gastar a cota do Resend. O
 * pedido é gravado antes de contar, então rajada em paralelo não fura.
 *
 * Com a conferência travada (5 códigos errados em 15 min pelo e-mail ou
 * pelo IP, as chaves de reservarTentativaDeCodigo), o código novo seria
 * recusado na tela da senha nova: não sai e-mail nem se grava pedido até a
 * trava passar. A resposta não revela conta: a tela da senha nova grava a
 * linha CODIGO para qualquer e-mail digitado, antes de conferir o código.
 */
export async function pedirCodigoSenha(
  _estado: EstadoEsqueci,
  formData: FormData,
): Promise<EstadoEsqueci> {
  const email = String(formData.get("email") ?? "")
    .trim()
    .toLowerCase();
  if (!email || !email.includes("@") || email.length > 254) {
    return { erro: "Informe o e-mail da sua conta." };
  }

  const ip = await ipDoCliente();
  // Antes da reserva: pedido barrado aqui não gasta vaga nos tetos acima.
  // Sem linha no Log de acesso: a trava aparece lá quando a conferência
  // barra. Banco fora do ar não segura o pedido.
  const erros = await contarRecentes("CODIGO", { email, ip });
  if (erros !== null && erros >= MAX_FALHAS) {
    return { erro: MENSAGEM_MUITAS_TENTATIVAS };
  }

  const reserva = await reservarPedidoDeRecuperacao(email, ip);
  if (reserva.situacao === "bloqueada") {
    const { erro, motivo } = BARRADO[reserva.teto];
    registrarAcesso(null, "recuperacao_bloqueada", { email, ip, motivo });
    return { erro };
  }

  after(() => mandarCodigoDeNovaSenha(email, ip));

  // O destino do login segue para a tela da senha nova, que termina nele.
  const proximo = destinoSeguro(formData.get("proximo"));
  return { ir: urlEntrar("/entrar/redefinir", { email, proximo }) };
}

/**
 * Gera o código de recuperação no Supabase (generateLink devolve o OTP cru
 * em properties.email_otp, sem mandar e-mail nenhum) e manda pelo Resend.
 * Grava na trilha direto, sem registrarAcesso: aqui já se está dentro de um
 * after().
 */
async function mandarCodigoDeNovaSenha(email: string, ip: string) {
  let service: ReturnType<typeof createServiceClient>;
  try {
    service = createServiceClient();
  } catch {
    console.warn(
      "[esqueci] sem SUPABASE_SERVICE_ROLE_KEY: o código de nova senha não é gerado.",
    );
    return;
  }

  const auditar = (quem: string | null, detalhes: Record<string, unknown>) =>
    service
      .from("auditoria")
      .insert({ quem, acao: "recuperacao_pedida", detalhes })
      .then(
        () => {},
        () => {},
      );

  const { data, error } = await service.auth.admin.generateLink({
    type: "recovery",
    email,
  });
  const codigo = data?.properties?.email_otp;
  if (error || !codigo) {
    await auditar(null, {
      email,
      ip,
      motivo:
        error?.code === "user_not_found" || error?.status === 404
          ? "e-mail sem conta"
          : "código não gerado",
    });
    if (error && error.status !== 404) {
      console.error(`[esqueci] generateLink falhou: ${error.message}`);
    }
    return;
  }

  try {
    await enviarCodigoNovaSenha(email, codigo);
    await auditar(data.user?.id ?? null, { email, ip });
  } catch (erro) {
    console.error(
      "[esqueci] código de nova senha não saiu:",
      erro instanceof Error ? erro.message : erro,
    );
    await auditar(data.user?.id ?? null, {
      email,
      ip,
      motivo: "e-mail não saiu",
    });
  }
}
