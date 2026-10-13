"use client";

import { useParams, useSearchParams } from "next/navigation";
import { LinkVoltar } from "../link-voltar";
import { lerVoltar, rotuloVoltar } from "../voltar";

/**
 * Pula as páginas do próprio contato que não abriu: a edição manda a ficha
 * como volta, e a ficha também cairia no "não encontrado". Vale o ?voltar=
 * dela (a conversa, a lista filtrada). Três voltas cobrem editar → ficha →
 * origem com folga; o que sobrar apontando para o contato vira null.
 */
function destinoFora(voltar: string | null, id: string | undefined) {
  if (!id) return voltar;
  const proprio = `/contatos/${id}`;
  let destino = voltar;
  for (let i = 0; i < 3 && destino; i++) {
    const caminho = destino.split(/[?#]/)[0];
    if (caminho !== proprio && !caminho.startsWith(`${proprio}/`)) {
      return destino;
    }
    destino = lerVoltar(
      new URL(destino, "https://x.invalid").searchParams.get("voltar"),
    );
  }
  return null;
}

/**
 * O "← …" do "Contato não encontrado". O not-found não recebe searchParams,
 * então o ?voltar= é lido aqui, no cliente, com as mesmas regras da ficha:
 * quem veio da conversa volta à conversa, e não à lista.
 */
export function VoltarNaoEncontrado() {
  const { id } = useParams<{ id: string }>();
  const destino = destinoFora(lerVoltar(useSearchParams().get("voltar")), id);

  return (
    <LinkVoltar
      href={destino ?? "/contatos"}
      rotulo={destino ? rotuloVoltar(destino) : "Contatos"}
    />
  );
}
