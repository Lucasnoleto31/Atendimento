import { cn } from "@/lib/utils";

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
      <label htmlFor={id} className="text-sm font-medium text-neutral-800">
        {label}
      </label>
      <input
        id={id}
        aria-invalid={erro ? true : undefined}
        aria-describedby={[ajudaId, erroId].filter(Boolean).join(" ") || undefined}
        className={cn(
          "h-[40px] w-full rounded-md border bg-neutral-0 px-1.5 text-base text-neutral-800 transition-colors duration-[120ms] placeholder:text-neutral-400 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-primary-500",
          erro ? "border-danger" : "border-neutral-300",
          className,
        )}
        {...props}
      />
      {ajuda ? (
        <p id={ajudaId} className="text-xs text-neutral-600">
          {ajuda}
        </p>
      ) : null}
      {erro ? (
        <p id={erroId} className="text-xs text-danger">
          {erro}
        </p>
      ) : null}
    </div>
  );
}
