"use client";

import { useState } from "react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { AnimatePresence, motion, useReducedMotion } from "framer-motion";
import {
  BarChart3,
  CalendarDays,
  Columns3,
  CreditCard,
  LogOut,
  Menu,
  Megaphone,
  MessageSquare,
  Settings,
  ShieldCheck,
  Sun,
  Users,
  Wallet,
  X,
} from "lucide-react";
import { sair } from "@/app/entrar/actions";
import { cn } from "@/lib/utils";
import { AlternadorTema } from "./alternador-tema";
import { ContadorNaoLidas } from "./nao-lidas";

export const MODULOS = [
  { href: "/hoje", label: "Hoje", icon: Sun },
  { href: "/atendimento", label: "Atendimento", icon: Columns3 },
  { href: "/chat", label: "Chat", icon: MessageSquare },
  { href: "/agenda", label: "Agenda", icon: CalendarDays },
  { href: "/carteira", label: "Carteira", icon: Wallet },
  { href: "/leads", label: "Leads", icon: Users },
  { href: "/campanhas", label: "Campanhas", icon: Megaphone, gestor: true },
  { href: "/pagamentos", label: "Pagamentos", icon: CreditCard },
  { href: "/relatorios", label: "Relatórios", icon: BarChart3 },
  { href: "/admin", label: "Administração", icon: ShieldCheck, gestor: true },
  { href: "/configuracoes", label: "Configurações", icon: Settings, gestor: true },
];

export type Perfil = {
  nome: string;
  email: string;
  papel: "admin" | "gestor" | "vendedor";
};

export function AppShell({
  perfil,
  children,
}: {
  perfil: Perfil;
  children: React.ReactNode;
}) {
  const [menuAberto, setMenuAberto] = useState(false);
  const reduceMotion = useReducedMotion();
  const ehGestor = perfil.papel === "admin" || perfil.papel === "gestor";
  const itens = MODULOS.filter((m) => !m.gestor || ehGestor);

  return (
    <div className="flex min-h-full flex-1">
      <aside className="sticky top-0 hidden h-dvh w-[240px] shrink-0 self-start border-r border-neutral-200 bg-neutral-0 lg:flex lg:flex-col">
        <Marca />
        <Navegacao itens={itens} />
        <RodapeUsuario perfil={perfil} />
      </aside>

      <div className="relative flex min-w-0 flex-1 flex-col">
        <header className="flex h-[64px] items-center justify-between gap-1 border-b border-neutral-200 bg-neutral-0 px-2 lg:hidden">
          <Marca compacto />
          <button
            type="button"
            aria-label={menuAberto ? "Fechar menu" : "Abrir menu"}
            aria-expanded={menuAberto}
            aria-controls="menu-modulos"
            onClick={() => setMenuAberto((v) => !v)}
            className="inline-flex h-[40px] w-[40px] items-center justify-center rounded-md text-neutral-800 hover:bg-neutral-100 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-primary-500"
          >
            {menuAberto ? (
              <X size={20} strokeWidth={1.5} aria-hidden />
            ) : (
              <Menu size={20} strokeWidth={1.5} aria-hidden />
            )}
          </button>
        </header>

        <AnimatePresence initial={false}>
          {menuAberto ? (
            <motion.div
              id="menu-modulos"
              initial={reduceMotion ? false : { opacity: 0, y: -4 }}
              animate={{ opacity: 1, y: 0 }}
              exit={reduceMotion ? { opacity: 1 } : { opacity: 0, y: -4 }}
              transition={{ duration: 0.24, ease: [0.2, 0, 0, 1] }}
              // Overlay sobre o conteúdo: no fluxo ele empurrava telas de
              // altura travada (ex.: /chat com 100dvh) e criava rolagem dupla.
              className="absolute inset-x-0 top-[64px] z-40 border-b border-neutral-200 bg-neutral-0 shadow-lg lg:hidden"
              onClick={() => setMenuAberto(false)}
            >
              <Navegacao itens={itens} />
              <RodapeUsuario perfil={perfil} />
            </motion.div>
          ) : null}
        </AnimatePresence>

        <main id="conteudo" className="min-w-0 flex-1">
          {children}
        </main>
      </div>
    </div>
  );
}

function Marca({ compacto = false }: { compacto?: boolean }) {
  return (
    <div className={cn("flex shrink-0 items-center gap-1", compacto ? "" : "h-[64px] border-b border-neutral-200 px-2")}>
      <span
        aria-hidden
        className="flex h-[28px] w-[28px] items-center justify-center rounded-md bg-primary-600 font-mono text-sm text-neutral-0"
      >
        Z
      </span>
      <span className="text-base font-semibold text-neutral-900">Zeve CRM</span>
    </div>
  );
}

function Navegacao({ itens }: { itens: typeof MODULOS }) {
  const pathname = usePathname();

  return (
    <nav aria-label="Módulos" className="relative min-h-0 flex-1 overflow-y-auto p-1">
      <ul className="flex flex-col gap-0.5">
        {itens.map((item) => {
          const Icon = item.icon;
          const ativo = pathname.startsWith(item.href);
          return (
            <li key={item.href}>
              <Link
                href={item.href}
                aria-current={ativo ? "page" : undefined}
                className={cn(
                  "flex h-[40px] items-center gap-1 rounded-md px-1.5 text-sm transition-colors duration-[120ms] focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-primary-500",
                  ativo
                    ? "bg-primary-50 font-medium text-primary-900"
                    : "text-neutral-600 hover:bg-neutral-100 hover:text-neutral-800",
                )}
              >
                <Icon
                  size={18}
                  strokeWidth={1.5}
                  aria-hidden
                  className={ativo ? "text-primary-600" : "text-neutral-400"}
                />
                {item.label}
                {item.href === "/chat" ? <ContadorNaoLidas /> : null}
                {item.href === "/agenda" ? (
                  <ContadorNaoLidas mostrar="tarefas" />
                ) : null}
              </Link>
            </li>
          );
        })}
      </ul>
    </nav>
  );
}

function RodapeUsuario({ perfil }: { perfil: Perfil }) {
  return (
    <div className="shrink-0 border-t border-neutral-200 p-1">
      <div className="flex items-center gap-1 px-1.5 py-1">
        <span
          aria-hidden
          className="flex h-[32px] w-[32px] shrink-0 items-center justify-center rounded-md bg-neutral-100 font-mono text-sm text-neutral-600"
        >
          {perfil.nome.slice(0, 2).toUpperCase()}
        </span>
        <span className="min-w-0 flex-1">
          <span className="block truncate text-sm font-medium text-neutral-800">
            {perfil.nome}
          </span>
          <span className="block truncate text-xs text-neutral-600 capitalize">
            {perfil.papel}
          </span>
        </span>
        <AlternadorTema />
      </div>
      <form action={sair}>
        <button
          type="submit"
          className="flex h-[40px] w-full items-center gap-1 rounded-md px-1.5 text-sm text-neutral-600 transition-colors duration-[120ms] hover:bg-neutral-100 hover:text-neutral-800 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-primary-500"
        >
          <LogOut size={18} strokeWidth={1.5} className="text-neutral-400" aria-hidden />
          Sair
        </button>
      </form>
    </div>
  );
}
