import { cn } from "@/lib/utils";
import { AJUDA, CAMPO_BASE, ERRO_CAMPO, ROTULO } from "@/components/app/form-styles";

/**
 * Campo de texto com rótulo sempre visível em cima, ajuda e erro embaixo
 * (o erro perto do problema, kit bloco 4). O erro liga aria-invalid e
 * aria-describedby; a borda vira a semântica de erro.
 */
export function Field({
  id,
  label,
  ajuda,
  erro,
  className,
  ...props
}: {
  id: string;
  label: string;
  ajuda?: string;
  erro?: string;
} & React.ComponentProps<"input">) {
  const ajudaId = ajuda ? `${id}-ajuda` : undefined;
  const erroId = erro ? `${id}-erro` : undefined;

  return (
    <div className="flex flex-col gap-1">
      <label htmlFor={id} className={ROTULO}>
        {label}
      </label>
      <input
        id={id}
        aria-invalid={erro ? true : undefined}
        aria-describedby={[ajudaId, erroId].filter(Boolean).join(" ") || undefined}
        className={cn(CAMPO_BASE, "w-full text-base", className)}
        {...props}
      />
      {ajuda ? (
        <p id={ajudaId} className={AJUDA}>
          {ajuda}
        </p>
      ) : null}
      {erro ? (
        <p id={erroId} className={ERRO_CAMPO}>
          {erro}
        </p>
      ) : null}
    </div>
  );
}
