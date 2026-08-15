"use client";

import { motion, useReducedMotion } from "framer-motion";
import { cn } from "@/lib/utils";

const EASE_IN = [0.2, 0, 0, 1] as const;

/**
 * Revela um bloco quando ele entra na viewport.
 * Anima só opacity/transform, 180ms, deslocamento de 8px — e nada quando o
 * usuário pede movimento reduzido.
 */
export function Reveal({
  children,
  className,
  delay = 0,
  as = "div",
}: {
  children: React.ReactNode;
  className?: string;
  delay?: number;
  as?: "div" | "li" | "section";
}) {
  const reduceMotion = useReducedMotion();
  const MotionTag = motion[as];

  if (reduceMotion) {
    const Tag = as;
    return <Tag className={className}>{children}</Tag>;
  }

  return (
    <MotionTag
      className={cn(className)}
      initial={{ opacity: 0, y: 8 }}
      whileInView={{ opacity: 1, y: 0 }}
      viewport={{ once: true, margin: "-64px" }}
      transition={{ duration: 0.18, ease: EASE_IN, delay }}
    >
      {children}
    </MotionTag>
  );
}
