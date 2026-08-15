import { cn } from "@/lib/utils";

export function Container({
  className,
  children,
}: {
  className?: string;
  children: React.ReactNode;
}) {
  return (
    <div className={cn("mx-auto w-full max-w-[1200px] px-2 md:px-3", className)}>
      {children}
    </div>
  );
}

export function Section({
  id,
  className,
  children,
  "aria-labelledby": ariaLabelledby,
}: {
  id?: string;
  className?: string;
  children: React.ReactNode;
  "aria-labelledby"?: string;
}) {
  return (
    <section
      id={id}
      aria-labelledby={ariaLabelledby}
      className={cn("py-8 md:py-10", className)}
    >
      <Container>{children}</Container>
    </section>
  );
}

export function SectionHeading({
  eyebrow,
  title,
  description,
  id,
  className,
}: {
  eyebrow?: string;
  title: string;
  description?: string;
  id?: string;
  className?: string;
}) {
  return (
    <div className={cn("max-w-[68ch]", className)}>
      {eyebrow ? (
        <p className="text-xs tracking-[0.06em] text-neutral-600 uppercase">
          {eyebrow}
        </p>
      ) : null}
      <h2 id={id} className={cn("text-h2 text-neutral-900", eyebrow && "mt-1")}>
        {title}
      </h2>
      {description ? (
        <p className="mt-2 text-base text-neutral-600">{description}</p>
      ) : null}
    </div>
  );
}
