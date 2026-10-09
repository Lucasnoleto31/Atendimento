"use client";

import { useCallback, useState } from "react";
import { cn } from "@/lib/utils";
import { corDoAvatar, iniciaisDoNome } from "@/lib/avatar";

/** Abaixo de 20px, uma inicial só: duas letras largas do Poppins em 10px
 *  ("AM" mede 16px) passam do círculo de 16 e o contorno corta as pontas. */
function iniciaisQueCabem(nome: string, tamanho: number): string {
  const iniciais = iniciaisDoNome(nome);
  return tamanho < 20 ? (Array.from(iniciais)[0] ?? "?") : iniciais;
}

/** O tamanho das iniciais pelo do círculo: 12px no de 32 (o menu), 14 no de
 *  44 (a folha do "Mais"), como eram antes da foto. */
function tamanhoDasIniciais(tamanho: number): number {
  if (tamanho < 28) return 10;
  if (tamanho < 40) return 12;
  if (tamanho < 56) return 14;
  if (tamanho < 80) return 20;
  return Math.round(tamanho * 0.3);
}

/**
 * O círculo de uma pessoa da equipe: a foto que ela pôs em Minha conta ou,
 * sem foto, as iniciais. Embaixo ficam sempre as iniciais; por cima, a foto.
 * Enquanto a foto carrega, ou quando ela falha (arquivo apagado, rede fora),
 * aparecem as iniciais, como no AvatarContato.
 *
 * Sem foto, o círculo é um dos quatro cinzas da ficha (corDoAvatar), com as
 * iniciais na tinta. Com `superficie`, o círculo toma o tom da superfície
 * de baixo do lugar onde está, como a conta sempre foi na casca: o fundo
 * sobre o menu (cartão) e o cartão sobre a folha (flutuante). O cinza do nome
 * sobre o cartão quase some.
 *
 * Decorativo (aria-hidden): o nome está sempre ao lado.
 */
export function AvatarPessoa({
  nome,
  foto,
  tamanho = 32,
  superficie,
  className,
}: {
  nome: string;
  /** URL pública da foto (fotosDaEquipe, no servidor), ou nada. */
  foto?: string | null;
  /** Lado do círculo, em px. */
  tamanho?: number;
  /** O tom do círculo sem foto, quando não é o cinza do nome. */
  superficie?: "fundo" | "cartao";
  className?: string;
}) {
  // Guarda a URL que falhou, não um sim/não: a foto nova (outro endereço,
  // pelo carimbo) volta a ser tentada.
  const [falhou, setFalhou] = useState<string | null>(null);
  const mostrarFoto = Boolean(foto) && foto !== falhou;

  // A foto que falha antes de o React hidratar não chega ao onError (o evento
  // já passou). O ref confere na montagem: terminou e sem largura = quebrou.
  const conferir = useCallback(
    (img: HTMLImageElement | null) => {
      if (img && img.complete && img.naturalWidth === 0) setFalhou(foto ?? null);
    },
    [foto],
  );

  return (
    <span
      aria-hidden
      className={cn(
        "relative flex shrink-0 items-center justify-center overflow-hidden rounded-full leading-none font-semibold text-tinta select-none",
        superficie === "fundo" && "bg-fundo",
        superficie === "cartao" && "bg-cartao",
        className,
      )}
      style={{
        width: tamanho,
        height: tamanho,
        fontSize: tamanhoDasIniciais(tamanho),
        backgroundColor: superficie ? undefined : corDoAvatar(nome),
      }}
    >
      {iniciaisQueCabem(nome, tamanho)}
      {mostrarFoto && foto ? (
        // text-transparent: nada do alt aparece por cima das iniciais no
        // instante entre a falha e a troca.
        // eslint-disable-next-line @next/next/no-img-element -- foto no Storage público, sem passar pelo otimizador do Next
        <img
          ref={conferir}
          src={foto}
          alt=""
          loading="lazy"
          decoding="async"
          onError={() => setFalhou(foto)}
          className="absolute inset-0 h-full w-full object-cover text-transparent"
        />
      ) : null}
    </span>
  );
}
