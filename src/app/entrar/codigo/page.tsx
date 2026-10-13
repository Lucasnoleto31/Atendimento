import type { Metadata } from "next";
import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import { ArrowLeft } from "lucide-react";
import { createClient } from "@/lib/supabase/server";
import { destinoSeguro } from "@/lib/rotas";
import {
  COOKIE_CODIGO,
  lerCodigoPendente,
  restanteParaReenvio,
} from "@/lib/codigo-login";
import { MENSAGEM_FALHA, motivoFalha } from "../emissao";
import { Moldura } from "../moldura";
import { LINK_VOLTAR } from "../estilos";
import { trocarDeConta } from "./actions";
import { FormCodigo } from "./form-codigo";

export const metadata: Metadata = {
  title: "Código de acesso · Zeve Atendimento",
};

/**
 * Segundo passo do login num aparelho novo: o código que chegou no e-mail.
 * O middleware manda para cá quem tem sessão mas ainda não confirmou ESTE
 * aparelho, e é a única tela que essa pessoa alcança. Sem código pendente
 * (venceu, ou o envio falhou no login), a tela oferece o botão de enviar;
 * se o login mandou um ?falha=, ela diz por que o código não saiu.
 */
export default async function CodigoPage({
  searchParams,
}: PageProps<"/entrar/codigo">) {
  const params = await searchParams;
  const proximo = destinoSeguro(params.proximo);

  // getUser, a mesma conferência do middleware. Com getClaims, um token que
  // um aceitasse e o outro não faria o middleware mandar para cá e esta
  // página devolver para o /entrar, sem fim. Tela rara: a ida a mais ao
  // Auth não pesa.
  const supabase = await createClient();
  const { data } = await supabase.auth.getUser();
  const usuario = data.user;
  if (!usuario) {
    redirect(`/entrar?proximo=${encodeURIComponent(proximo)}`);
  }

  const pendente = await lerCodigoPendente(
    (await cookies()).get(COOKIE_CODIGO)?.value,
    usuario.id,
  );
  // A tela tira o ?falha= da barra assim que monta (form-codigo.tsx). Se ele
  // chegar mesmo assim (endereço guardado, código mandado de outra aba), com
  // código pendente já não diz nada e não aparece.
  const motivo = pendente ? null : motivoFalha(params.falha);

  return (
    <Moldura
      titulo="Confirme que é você"
      topo={
        // À vista em todos os estados, acima do título como o voltar das
        // outras telas: é a saída de quem não tem como receber o código, e
        // no celular o teclado do campo cobre o rodapé. Form e não link,
        // porque sair revoga a sessão; leva o destino de volta ao login.
        <form action={trocarDeConta}>
          <input type="hidden" name="proximo" value={proximo} />
          <button type="submit" className={LINK_VOLTAR}>
            <ArrowLeft size={18} strokeWidth={1.75} aria-hidden />
            Entrar com outra conta
          </button>
        </form>
      }
      rodape="Depois do código, este aparelho fica lembrado por 30 dias."
    >
      <FormCodigo
        email={usuario.email ?? ""}
        temCodigo={pendente !== null}
        restanteMs={restanteParaReenvio(pendente)}
        falha={motivo ? MENSAGEM_FALHA[motivo] : undefined}
        proximo={proximo}
      />
    </Moldura>
  );
}
