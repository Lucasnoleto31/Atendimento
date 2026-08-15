import Link from "next/link";
import { cn } from "@/lib/utils";

type Variant = "primary" | "secondary" | "ghost";
type Size = "sm" | "md" | "lg";

const base =
  "inline-flex items-center justify-center gap-0.5 rounded-md font-medium whitespace-nowrap transition-colors duration-[120ms] focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-primary-500 disabled:cursor-not-allowed disabled:bg-neutral-200 disabled:text-neutral-400";

const variants: Record<Variant, string> = {
  primary: "bg-primary-600 text-neutral-0 hover:bg-primary-700",
  secondary:
    "bg-neutral-0 text-neutral-800 border border-neutral-300 hover:bg-neutral-100",
  ghost: "text-neutral-600 hover:bg-neutral-100 hover:text-neutral-800",
};

const sizes: Record<Size, string> = {
  sm: "h-[32px] px-1.5 text-sm",
  md: "h-[40px] px-2 text-sm",
  lg: "h-[48px] px-3 text-base",
};

type SharedProps = {
  variant?: Variant;
  size?: Size;
  className?: string;
  children: React.ReactNode;
};

type LinkProps = SharedProps &
  Omit<React.ComponentProps<typeof Link>, "className" | "children">;

type NativeButtonProps = SharedProps &
  Omit<React.ComponentProps<"button">, "className" | "children"> & {
    href?: never;
  };

export type ButtonProps = LinkProps | NativeButtonProps;

export function Button(props: ButtonProps) {
  const classes = cn(
    base,
    variants[props.variant ?? "primary"],
    sizes[props.size ?? "md"],
    props.className,
  );

  if (props.href !== undefined) {
    const { variant: _v, size: _s, className: _c, children, ...linkProps } = props;
    return (
      <Link className={classes} {...linkProps}>
        {children}
      </Link>
    );
  }

  const { variant: _v, size: _s, className: _c, children, href: _h, ...buttonProps } =
    props;
  return (
    <button className={classes} {...buttonProps}>
      {children}
    </button>
  );
}
