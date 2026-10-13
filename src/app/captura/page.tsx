import type { Metadata } from "next";
import { Moldura } from "@/app/entrar/moldura";
import { FormCaptura } from "./form-captura";
import { lerRastreio } from "./rastreio";

export const metadata: Metadata = {
  title: "Fale com a Zeve",
  description: "Deixe seu nome e WhatsApp para a equipe da Zeve falar com você.",
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
        descricao="Um assessor da Zeve vai chamar você no WhatsApp. Pode fechar esta página."
      >
        {null}
      </Moldura>
    );
  }

  return (
    <Moldura
      titulo="Fale com a Zeve"
      descricao="Deixe seu nome e WhatsApp e um assessor chama você por lá."
      rodape="Seu nome e WhatsApp ficam com a equipe da Zeve e não são repassados a terceiros."
    >
      <FormCaptura rastreio={rastreio} />
    </Moldura>
  );
}
