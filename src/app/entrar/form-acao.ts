"use client";

import { startTransition, useEffect } from "react";

/**
 * onSubmit que chama a action do useActionState sem o reset automático.
 * Com <form action={...}>, o React 19 esvazia os campos depois de TODA
 * action, inclusive a que volta com erro: a pessoa errava a senha e tinha
 * de digitar o e-mail de novo. Pelo onSubmit, o que foi digitado fica.
 *
 * Todo form que usa isto leva method="post". Antes da hidratação (celular
 * lento, gerenciador de senha que preenche e envia sozinho, JS que não
 * carregou) o onSubmit ainda não existe e quem envia é o navegador; sem
 * method, o envio nativo é um GET e a senha ou o código vão para a URL, o
 * histórico e o log de requisições. Com POST eles vão no corpo, e a página
 * só recarrega.
 */
export function semReset(executar: (dados: FormData) => void) {
  return (evento: React.FormEvent<HTMLFormElement>) => {
    evento.preventDefault();
    const dados = new FormData(evento.currentTarget);
    startTransition(() => executar(dados));
  };
}

/**
 * Navega com recarga completa quando a action devolve um destino. Nada de
 * router.push nas viradas de autenticação: a aba aberta desde antes de um
 * deploy carrega chunks velhos e a navegação client-side morre em silêncio;
 * a recarga ainda leva os cookies novos junto.
 */
export function useIrPara(destino: string | undefined) {
  useEffect(() => {
    if (destino) window.location.assign(destino);
  }, [destino]);
}
