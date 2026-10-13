import { LoaderCircle } from "lucide-react";
import { cn } from "@/lib/utils";

/**
 * O indicador de "gravando" dos botões e das ações curtas. Gira só para quem
 * deixou o movimento liberado; com menos movimento fica parado, e o rótulo do
 * botão ("Salvando…") é quem diz que algo está acontecendo.
 *
 * Carregamento de tela não usa isto: usa esqueleto no formato da tela.
 */
export function Spinner({
  tamanho = 16,
  rotulo,
  className,
}: {
  tamanho?: number;
  /** Texto para o leitor de tela. Sem ele, o indicador é decorativo (o
   *  texto ao lado já diz o que acontece). */
  rotulo?: string;
  className?: string;
}) {
  return (
    <LoaderCircle
      size={tamanho}
      strokeWidth={2}
      role={rotulo ? "status" : undefined}
      aria-label={rotulo}
      aria-hidden={rotulo ? undefined : true}
      className={cn("shrink-0 motion-safe:animate-spin", className)}
    />
  );
}
