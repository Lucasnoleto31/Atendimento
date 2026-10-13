import { cn } from "@/lib/utils";

type Tom = "neutro" | "tinta" | "bom" | "atencao" | "erro";

/*
 * Na ficha padrão a semântica mora no texto curto, não no fundo: a etiqueta
 * é sempre cinza chapada (ou na tinta, para o único destaque da linha) e só a
 * palavra ganha a cor do estado. Chip tintado em cada linha é o arranjo que a
 * direção recusa.
 */
const tons: Record<Tom, string> = {
  neutro: "bg-cartao text-texto-2",
  tinta: "bg-tinta text-fundo",
  bom: "bg-cartao text-bom",
  atencao: "bg-cartao text-atencao",
  erro: "bg-cartao text-erro",
};

/**
 * Etiqueta de leitura (estado, contagem, etiqueta do contato). Não é
 * clicável; para filtro que liga e desliga, use o Chip.
 *
 * `cor` é a cor que a equipe escolheu para a etiqueta do contato: entra só
 * num ponto de 8px antes do nome, nunca no fundo.
 */
export function Etiqueta({
  tom = "neutro",
  cor,
  className,
  children,
  ...props
}: {
  tom?: Tom;
  cor?: string | null;
  className?: string;
  children: React.ReactNode;
} & Omit<React.ComponentProps<"span">, "className" | "children">) {
  return (
    <span
      className={cn(
        "inline-flex h-[22px] max-w-full shrink-0 items-center gap-0.5 rounded-chip px-1 text-xs whitespace-nowrap tabular-nums",
        tons[tom],
        className,
      )}
      {...props}
    >
      {cor ? (
        <span
          aria-hidden
          className="h-[8px] w-[8px] shrink-0 rounded-full"
          style={{ backgroundColor: cor }}
        />
      ) : null}
      <span className="min-w-0 truncate">{children}</span>
    </span>
  );
}

/**
 * Chip de filtro que liga e desliga (aria-pressed). Ligado vai na tinta;
 * desligado, só o fio. 32px de altura, com área estendida até 44px no toque.
 */
export function Chip({
  ativo = false,
  icone,
  cor,
  className,
  children,
  type = "button",
  ...props
}: {
  ativo?: boolean;
  icone?: React.ReactNode;
  /** Cor da etiqueta do contato, como na Etiqueta: só no ponto. */
  cor?: string | null;
  className?: string;
  children: React.ReactNode;
} & Omit<React.ComponentProps<"button">, "className" | "children">) {
  return (
    <button
      type={type}
      aria-pressed={ativo}
      className={cn(
        "relative inline-flex h-[32px] shrink-0 items-center gap-0.5 rounded-chip border px-1.5 text-sm whitespace-nowrap transition-[background-color,border-color,color,scale] duration-[120ms] select-none motion-safe:active:scale-[.97] focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-tinta disabled:cursor-not-allowed disabled:opacity-50",
        "pointer-coarse:after:absolute pointer-coarse:after:inset-x-0 pointer-coarse:after:-inset-y-[6px]",
        ativo
          ? "border-tinta bg-tinta text-fundo hover:bg-tinta-hover"
          : "border-fio-forte bg-transparent text-tinta hover:bg-realce",
        className,
      )}
      {...props}
    >
      {cor ? (
        <span
          aria-hidden
          className="h-[8px] w-[8px] shrink-0 rounded-full"
          style={{ backgroundColor: cor }}
        />
      ) : null}
      {icone}
      {children}
    </button>
  );
}
