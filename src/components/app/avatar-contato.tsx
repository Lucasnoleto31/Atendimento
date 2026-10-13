"use client";

import { memo, useCallback, useState } from "react";
import { cn } from "@/lib/utils";
import { corDoAvatar, iniciaisDoNome, urlFotoContato } from "@/lib/avatar";

/**
 * O círculo do contato. Embaixo ficam sempre as iniciais na cor do nome; por
 * cima, só no contato do Instagram, a foto do perfil que o webhook copiou
 * para o Storage. Enquanto a foto carrega, ou quando ela não existe (contato
 * anterior à cópia, perfil sem foto, download que falhou), aparecem as
 * iniciais.
 *
 * Contato do WhatsApp não pede imagem nenhuma: a Cloud API não entrega a
 * foto, e cada linha da fila viraria um 404.
 *
 * Sem foto, o círculo é um dos quatro cinzas da ficha (corDoAvatar) com as
 * iniciais na tinta; os cinzas mudam com o tema e a conta de contraste está
 * no globals.css.
 *
 * Tamanho, fonte e anel vêm de quem usa, pela className. É decorativo (o nome
 * está sempre ao lado), por isso aria-hidden.
 */
export const AvatarContato = memo(function AvatarContato({
  nome,
  leadId,
  instagram,
  className,
  title,
}: {
  nome: string;
  leadId: string;
  /** Contato que veio pelo Direct, pelo critério único de veioPeloDirect
   *  (lib/avatar): só ele tem foto guardada. */
  instagram: boolean;
  className?: string;
  title?: string;
}) {
  const url = instagram ? urlFotoContato(leadId) : null;
  // Guarda a URL que falhou, não um sim/não: o mesmo componente reaproveitado
  // para outro contato volta a tentar a foto desse outro.
  const [falhou, setFalhou] = useState<string | null>(null);
  const mostrarFoto = url !== null && url !== falhou;

  // A foto que falha antes de o React hidratar não chega ao onError (o evento
  // já passou). O ref confere na montagem: terminou e sem largura = quebrou.
  const conferir = useCallback(
    (img: HTMLImageElement | null) => {
      if (img && img.complete && img.naturalWidth === 0) setFalhou(url);
    },
    [url],
  );

  return (
    <span
      aria-hidden
      title={title}
      className={cn(
        "relative flex shrink-0 items-center justify-center overflow-hidden rounded-full font-semibold text-tinta select-none",
        className,
      )}
      style={{ backgroundColor: corDoAvatar(nome) }}
    >
      {iniciaisDoNome(nome)}
      {mostrarFoto ? (
        // text-transparent: o alt não aparece por cima das iniciais no
        // instante entre a falha e a troca.
        // eslint-disable-next-line @next/next/no-img-element -- foto no Storage público, sem passar pelo otimizador do Next
        <img
          ref={conferir}
          src={url}
          alt={nome}
          loading="lazy"
          decoding="async"
          onError={() => setFalhou(url)}
          className="absolute inset-0 h-full w-full object-cover text-transparent"
        />
      ) : null}
    </span>
  );
});
