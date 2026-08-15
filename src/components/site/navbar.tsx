"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { AnimatePresence, motion, useReducedMotion } from "framer-motion";
import { Menu, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Container } from "@/components/ui/container";
import { cn } from "@/lib/utils";

const NAV_LINKS = [
  { href: "#recursos", label: "Como funciona" },
  { href: "#numeros", label: "Números" },
  { href: "#modulos", label: "Módulos" },
];

export function Navbar() {
  const [open, setOpen] = useState(false);
  const [scrolled, setScrolled] = useState(false);
  const reduceMotion = useReducedMotion();

  useEffect(() => {
    const onScroll = () => setScrolled(window.scrollY > 8);
    onScroll();
    window.addEventListener("scroll", onScroll, { passive: true });
    return () => window.removeEventListener("scroll", onScroll);
  }, []);

  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && setOpen(false);
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [open]);

  return (
    <header
      className={cn(
        "fixed inset-x-0 top-0 z-50 bg-neutral-0 transition-shadow duration-[120ms]",
        scrolled ? "border-b border-neutral-200 shadow-sm" : "border-b border-transparent",
      )}
    >
      <Container>
        <div className="flex h-[64px] items-center justify-between gap-2">
          <Link
            href="/"
            className="flex items-center gap-1 rounded-md focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-primary-500"
          >
            <span
              aria-hidden
              className="flex h-[28px] w-[28px] items-center justify-center rounded-md bg-primary-600 font-mono text-sm text-neutral-0"
            >
              Z
            </span>
            <span className="text-base font-semibold text-neutral-900">
              Zeve CRM
            </span>
          </Link>

          <nav aria-label="Principal" className="hidden md:block">
            <ul className="flex items-center gap-1">
              {NAV_LINKS.map((link) => (
                <li key={link.href}>
                  <Link
                    href={link.href}
                    className="inline-flex h-[40px] items-center rounded-md px-1.5 text-sm text-neutral-600 transition-colors duration-[120ms] hover:bg-neutral-100 hover:text-neutral-800 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-primary-500"
                  >
                    {link.label}
                  </Link>
                </li>
              ))}
            </ul>
          </nav>

          <div className="hidden items-center gap-1 md:flex">
            <Button href="#modulos" variant="ghost" size="md">
              Módulos
            </Button>
            <Button href="/entrar" size="md">
              Entrar no sistema
            </Button>
          </div>

          <button
            type="button"
            aria-label={open ? "Fechar menu" : "Abrir menu"}
            aria-expanded={open}
            aria-controls="menu-mobile"
            onClick={() => setOpen((v) => !v)}
            className="inline-flex h-[40px] w-[40px] items-center justify-center rounded-md text-neutral-800 transition-colors duration-[120ms] hover:bg-neutral-100 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-primary-500 md:hidden"
          >
            {open ? (
              <X size={20} strokeWidth={1.5} aria-hidden />
            ) : (
              <Menu size={20} strokeWidth={1.5} aria-hidden />
            )}
          </button>
        </div>
      </Container>

      <AnimatePresence initial={false}>
        {open ? (
          <motion.div
            id="menu-mobile"
            key="menu-mobile"
            initial={reduceMotion ? false : { opacity: 0, y: -4 }}
            animate={{ opacity: 1, y: 0 }}
            exit={reduceMotion ? { opacity: 1 } : { opacity: 0, y: -4 }}
            transition={{ duration: 0.24, ease: [0.2, 0, 0, 1] }}
            className="border-t border-neutral-200 bg-neutral-0 md:hidden"
          >
            <Container className="py-2">
              <nav aria-label="Principal (mobile)">
                <ul className="flex flex-col">
                  {NAV_LINKS.map((link) => (
                    <li key={link.href}>
                      <Link
                        href={link.href}
                        onClick={() => setOpen(false)}
                        className="flex h-[48px] items-center rounded-md px-1 text-base text-neutral-800 transition-colors duration-[120ms] hover:bg-neutral-100 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-primary-500"
                      >
                        {link.label}
                      </Link>
                    </li>
                  ))}
                </ul>
              </nav>
              <div className="mt-2 flex flex-col gap-1">
                <Button href="/entrar" size="lg" onClick={() => setOpen(false)}>
                  Entrar no sistema
                </Button>
              </div>
            </Container>
          </motion.div>
        ) : null}
      </AnimatePresence>
    </header>
  );
}
