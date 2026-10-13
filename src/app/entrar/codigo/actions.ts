"use server";

import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import { revalidatePath } from "next/cache";
import { after } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { destinoSeguro } from "@/lib/rotas";
import { registrarAcesso } from "@/lib/auditoria";
import {
  APARELHO_VALIDADE_MS,
  assinarAparelho,
  codigoConfere,
  COOKIE_APARELHO,
  COOKIE_CODIGO,
  lerCodigoPendente,
  normalizarCodigo,
  opcoesCookie,
  REENVIO_MS,
  restanteParaReenvio,
} from "@/lib/codigo-login";
import { emitirCodigo } from "../emissao";
import { urlEntrar } from "../caminhos";
import { ipDoCliente, limpar, reservarTentativaDeCodigo } from "../freio";
import { COOKIE_ATIVIDADE } from "../atividade";

export type EstadoEnvio = {
  /** Há código pendente: a tela mostra o campo. false = botão "Enviar código". */
  temCodigo: boolean;
  /** Quanto faltava para liberar o "Reenviar" quando o servidor respondeu.
   *  A tela conta a partir de quando a resposta chegou, no relógio dela. */
  restanteMs: number;
  erro?: string;
  aviso?: string;
  ir?: string;
};

export type EstadoConfirmacao = {
  erro?: string;
  ir?: string;
  /** O código pendente não vale mais (venceu, ou foi apagado pelo freio): a
   *  tela volta ao botão "Enviar código" em vez de seguir pedindo o campo. */
  semCodigo?: boolean;
};

/**
 * Quem está do outro lado. getUser e não getClaims: é daqui que sai a
 * confiança no aparelho por 30 dias, então a sessão é conferida no Auth,
 * sem depender de o middleware ter rodado antes.
 */
async function quemEsta(): Promise<{ id: string; email: string } | null> {
  const supabase = await createClient();
  const { data } = await supabase.auth.getUser();
  if (!data.user?.email) return null;
  return { id: data.user.id, email: data.user.email };
}

/**
 * "Enviar código" e "Reenviar código". A resposta diz o que vale no cookie
 * depois do pedido (há código pendente? quanto falta para o próximo?), sem
 * herdar nada do estado que a tela tinha.
 *
 * O `proximo` é o destino da tela, para a sessão que caiu no meio (venceu,
 * ou foi revogada em outro aparelho) voltar ao login com ele. Chega do
 * navegador como qualquer argumento de action: a barreira é destinoSeguro.
 */
export async function enviarCodigo(proximo?: string): Promise<EstadoEnvio> {
  const usuario = await quemEsta();
  if (!usuario) {
    return {
      temCodigo: false,
      restanteMs: 0,
      ir: urlEntrar("/entrar", { proximo: destinoSeguro(proximo) }),
    };
  }

  const jarro = await cookies();
  const pendente = await lerCodigoPendente(
    jarro.get(COOKIE_CODIGO)?.value,
    usuario.id,
  );
  // A tela já segura o botão por 60 s; isto é para quem chama a action por
  // fora. Apagar o cookie para furar a espera cai no freio de envio.
  const restante = restanteParaReenvio(pendente);
  if (pendente && restante > 0) {
    return {
      temCodigo: true,
      restanteMs: restante,
      erro: "Espere um minuto para pedir outro código.",
    };
  }

  const envio = await emitirCodigo(usuario, await ipDoCliente());
  if ("erro" in envio) {
    return { temCodigo: pendente !== null, restanteMs: 0, erro: envio.erro };
  }
  return {
    temCodigo: true,
    restanteMs: REENVIO_MS,
    aviso: `Código enviado para ${usuario.email}.`,
  };
}

export async function confirmarCodigo(
  formData: FormData,
): Promise<EstadoConfirmacao> {
  const destino = destinoSeguro(formData.get("proximo"));
  const usuario = await quemEsta();
  // Sessão que caiu no meio: o login abre com o mesmo destino.
  if (!usuario) return { ir: urlEntrar("/entrar", { proximo: destino }) };

  const codigo = normalizarCodigo(formData.get("codigo"));
  if (!codigo) return { erro: "Digite os 6 números do código." };

  const jarro = await cookies();
  const pendente = await lerCodigoPendente(
    jarro.get(COOKIE_CODIGO)?.value,
    usuario.id,
  );
  if (!pendente) {
    return {
      erro: "Este código venceu. Peça um código novo.",
      semCodigo: true,
    };
  }

  const email = pendente.email.toLowerCase();
  const ip = await ipDoCliente();
  const reserva = await reservarTentativaDeCodigo(email, ip);
  if (reserva.situacao === "indisponivel") {
    return {
      erro: "Não deu para conferir o código agora. Tente de novo em instantes.",
    };
  }
  if (reserva.situacao === "bloqueada") {
    // O código pendente morre junto: passada a espera, só um código novo
    // (que chega no e-mail do dono da conta) volta a valer.
    jarro.delete(COOKIE_CODIGO);
    registrarAcesso(usuario.id, "codigo_login_bloqueado", {
      email,
      ip,
      motivo: "muitos erros",
    });
    return {
      erro: "Muitas tentativas. Aguarde alguns minutos e peça um código novo.",
      semCodigo: true,
    };
  }

  if (!(await codigoConfere(pendente, codigo))) {
    return {
      erro: "Código não confere. Confira o último e-mail e tente de novo.",
    };
  }

  // O código pendente só existe se o segredo assinou; aqui ele assina de novo.
  jarro.set(
    COOKIE_APARELHO,
    await assinarAparelho(usuario.id),
    opcoesCookie(APARELHO_VALIDADE_MS),
  );
  jarro.delete(COOKIE_CODIGO);
  registrarAcesso(usuario.id, "aparelho_confirmado", { email, ip });
  after(() => limpar("CODIGO", email));
  revalidatePath("/", "layout");
  return { ir: destino };
}

/**
 * "Entrar com outra conta". Escopo local, diferente do Sair do menu: quem
 * está aqui ainda não passou do código, e um sair global derrubaria as
 * sessões do dono da conta em todos os aparelhos. A sessão deste navegador
 * é revogada no servidor do mesmo jeito. O login abre com o mesmo destino.
 */
export async function trocarDeConta(formData: FormData) {
  const proximo = destinoSeguro(formData.get("proximo"));
  const supabase = await createClient();
  await supabase.auth.signOut({ scope: "local" });
  const jarro = await cookies();
  jarro.delete(COOKIE_CODIGO);
  jarro.delete(COOKIE_ATIVIDADE);
  revalidatePath("/", "layout");
  redirect(urlEntrar("/entrar", { proximo }));
}
