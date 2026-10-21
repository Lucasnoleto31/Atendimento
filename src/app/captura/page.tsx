import type { Metadata } from "next";
import { Moldura } from "@/app/entrar/moldura";
import { FormCaptura } from "./form-captura";
import { lerRastreio } from "./rastreio";
import { NOME_DA_EMPRESA, QUEM_ATENDE, capitalizar } from "@/lib/marca";

export const metadata: Metadata = {
  title: `Fale com a ${NOME_DA_EMPRESA}`,
  description: `Deixe seu nome e WhatsApp para a equipe da ${NOME_DA_EMPRESA} falar com você.`,
};

/**
 * A página pública de captura: o destino do link do anúncio. Usa a moldura
 * da tela de entrada (duas metades no desktop, faixa no topo no celular,
 * campos de linha). Campanha, etiqueta e utm_* chegam pela URL e atravessam
 * o formulário escondidos; a action faz todo o resto, no servidor.
 *
 * O sucesso é a mesma página com ?ok=1, para o pixel do anúncio contar a
 * conversão pelo endereço.
 */
export default async function CapturaPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const params = await searchParams;
  const rastreio = lerRastreio((chave) => params[chave]);

  if (params.ok === "1") {
    // A saída do sucesso volta ao formulário com os mesmos parâmetros: o
    // segundo envio fica com a atribuição do anúncio.
    const query = new URLSearchParams(
      rastreio.map(({ chave, valor }) => [chave, valor]),
    ).toString();
    return (
      <Moldura
        voltar={{
          href: query ? `/captura?${query}` : "/captura",
          rotulo: "Enviar outro número",
        }}
        titulo="Recebemos seu contato"
        descricao={`${capitalizar(QUEM_ATENDE)} da ${NOME_DA_EMPRESA} vai chamar você no WhatsApp. Pode fechar esta página.`}
      >
        {null}
      </Moldura>
    );
  }

  return (
    <Moldura
      titulo={`Fale com a ${NOME_DA_EMPRESA}`}
      descricao={`Deixe seu nome e WhatsApp e ${QUEM_ATENDE} chama você por lá.`}
      rodape={`Seu nome e WhatsApp ficam com a equipe da ${NOME_DA_EMPRESA} e não são repassados a terceiros.`}
    >
      <FormCaptura rastreio={rastreio} />
    </Moldura>
  );
}
