import Link from "next/link";
import { cn } from "@/lib/utils";
import { Spinner } from "./spinner";

type Variant = "primary" | "secondary" | "ghost" | "danger";
type Size = "sm" | "md" | "lg";

/*
 * Os botões da ficha padrão: o principal na tinta com o texto no fundo, o
 * secundário só com o fio, o sutil sem moldura e o destrutivo na semântica de
 * erro. Um principal por tela ou por diálogo.
 *
 * Toque: escala .97 enquanto pressiona (kit, bloco 6), só com movimento
 * liberado. O sm tem 32px de altura e ganha área estendida invisível até
 * 44px na tela de toque (kit, bloco 7).
 */
// O apagado do desativado não vale durante o "carregando" (aria-busy): o
// botão que grava continua com a cara dele, com o indicador no lugar do ícone.
const base =
  "relative inline-flex items-center justify-center gap-1 rounded-controle font-semibold whitespace-nowrap select-none transition-[background-color,border-color,color,scale] duration-[120ms] focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-tinta motion-safe:active:scale-[.97] disabled:cursor-not-allowed disabled:active:scale-100 aria-busy:cursor-progress";

const variants: Record<Variant, string> = {
  primary:
    "bg-tinta text-fundo hover:bg-tinta-hover disabled:not-aria-busy:bg-fio disabled:not-aria-busy:text-texto-3 disabled:aria-busy:hover:bg-tinta",
  secondary:
    "border border-fio-forte bg-transparent text-tinta hover:bg-realce active:bg-pressionado disabled:not-aria-busy:border-fio disabled:not-aria-busy:text-texto-3 disabled:hover:bg-transparent",
  ghost:
    "text-texto-2 hover:bg-realce hover:text-tinta active:bg-pressionado disabled:not-aria-busy:text-texto-3 disabled:hover:bg-transparent",
  danger:
    "bg-erro text-fundo hover:bg-erro/90 disabled:not-aria-busy:bg-fio disabled:not-aria-busy:text-texto-3 disabled:aria-busy:hover:bg-erro",
};

const sizes: Record<Size, string> = {
  sm: "h-[32px] px-1.5 text-sm pointer-coarse:after:absolute pointer-coarse:after:inset-x-0 pointer-coarse:after:-inset-y-[6px]",
  md: "h-[40px] px-2 text-sm",
  lg: "h-[48px] px-3 text-base",
};

type SharedProps = {
  variant?: Variant;
  size?: Size;
  /** Ícone à esquerda do rótulo. Com `carregando`, o indicador ocupa o lugar
   *  dele e a largura do botão não muda. */
  icone?: React.ReactNode;
  className?: string;
  children: React.ReactNode;
};

type LinkProps = SharedProps &
  Omit<React.ComponentProps<typeof Link>, "className" | "children"> & {
    carregando?: never;
  };

type NativeButtonProps = SharedProps &
  Omit<React.ComponentProps<"button">, "className" | "children"> & {
    href?: never;
    /** Gravando: desativa o botão, marca aria-busy e troca o ícone pelo
     *  indicador. O rótulo ("Salvando…") continua por conta de quem usa. */
    carregando?: boolean;
  };

export type ButtonProps = LinkProps | NativeButtonProps;

/** As classes do botão, para quem precisa delas num elemento que não é o
 *  Button (um <label> de arquivo, um <summary>). */
export function classesDoBotao({
  variant = "primary",
  size = "md",
  className,
}: {
  variant?: Variant;
  size?: Size;
  className?: string;
} = {}) {
  return cn(base, variants[variant], sizes[size], className);
}

export function Button(props: ButtonProps) {
  const classes = classesDoBotao({
    variant: props.variant,
    size: props.size,
    className: props.className,
  });

  if (props.href !== undefined) {
    const {
      variant: _v,
      size: _s,
      className: _c,
      icone,
      carregando: _l,
      children,
      ...linkProps
    } = props;
    return (
      <Link className={classes} {...linkProps}>
        {icone}
        {children}
      </Link>
    );
  }

  const {
    variant: _v,
    size: _s,
    className: _c,
    icone,
    carregando = false,
    children,
    href: _h,
    disabled,
    ...buttonProps
  } = props;
  const tamanhoIndicador = (props.size ?? "md") === "lg" ? 18 : 16;
  return (
    <button
      className={classes}
      disabled={disabled || carregando}
      aria-busy={carregando || undefined}
      {...buttonProps}
    >
      {carregando ? <Spinner tamanho={tamanhoIndicador} /> : icone}
      {children}
    </button>
  );
}
