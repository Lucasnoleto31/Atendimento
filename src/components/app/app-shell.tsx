"use client";

import { useState } from "react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { AnimatePresence, motion, useReducedMotion } from "framer-motion";
import {
  BarChart3,
  Columns3,
  CreditCard,
  LogOut,
  Menu,
  Megaphone,
  PanelLeftClose,
  PanelLeftOpen,
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

// Agenda saiu do menu (6.3): a visão-dia mora na /hoje e o calendário abre
// pelo botão "Ver calendário" — a rota /agenda continua existindo.
export const MODULOS = [
  { href: "/hoje", label: "Hoje", icon: Sun },
  { href: "/atendimento", label: "Atendimento", icon: Columns3 },
  { href: "/chat", label: "Chat", icon: MessageSquare },
  { href: "/carteira", label: "Carteira", icon: Wallet },
  { href: "/leads", label: "Leads", icon: Users },
  { href: "/campanhas", label: "Campanhas", icon: Megaphone, gestor: true },
  { href: "/pagamentos", label: "Pagamentos", icon: CreditCard },
  { href: "/relatorios", label: "Relatórios", icon: BarChart3 },
  { href: "/admin", label: "Administração", icon: ShieldCheck, gestor: true },
  {
    href: "/configuracoes",
    label: "Configurações",
    icon: Settings,
    gestor: true,
  },
];

export type Perfil = {
  nome: string;
  email: string;
  papel: "admin" | "gestor" | "vendedor";
};

export function AppShell({
  perfil,
  menuChatExpandido = false,
  children,
}: {
  perfil: Perfil;
  /** Cookie "menu-chat" lido no SSR: o primeiro paint já vem na largura certa. */
  menuChatExpandido?: boolean;
  children: React.ReactNode;
}) {
  const [menuAberto, setMenuAberto] = useState(false);
  const reduceMotion = useReducedMotion();
  const pathname = usePathname();
  const ehGestor = perfil.papel === "admin" || perfil.papel === "gestor";
  const itens = MODULOS.filter((m) => !m.gestor || ehGestor);

  // No chat a conversa é quem precisa do espaço: o menu recolhe sozinho e
  // vira régua de ícones. Quem preferir o menu cheio expande pelo botão —
  // a escolha fica no navegador (e vale só para o chat).
  const noChat = pathname.startsWith("/chat");
  // Estado em memória (o toggle funciona mesmo sem cookie/armazenamento);
  // o cookie é a persistência — no padrão do tema (alternador-tema.tsx).
  const [expandidoNoChat, setExpandidoNoChat] = useState(menuChatExpandido);
  const recolhido = noChat && !expandidoNoChat;
  const alternarLargura = () => {
    const novo = !expandidoNoChat;
    setExpandidoNoChat(novo);
    document.cookie = `menu-chat=${novo ? "expandido" : "recolhido"}; path=/; max-age=${60 * 60 * 24 * 365}; samesite=lax`;
  };

  return (
    <div className="flex min-h-full flex-1">
      <aside
        className={cn(
          "sticky top-0 hidden h-dvh shrink-0 self-start border-r border-neutral-200 bg-neutral-0 lg:flex lg:flex-col",
          "motion-safe:transition-[width] motion-safe:duration-[180ms]",
          recolhido ? "w-[64px]" : "w-[240px]",
        )}
      >
        <Marca recolhido={recolhido} />
        <Navegacao itens={itens} recolhido={recolhido} />
        {noChat ? (
          <div className="shrink-0 p-1">
            <button
              type="button"
              onClick={alternarLargura}
              className={cn(
                "flex h-[40px] w-full items-center rounded-md text-sm text-neutral-600 transition-colors duration-[120ms] hover:bg-neutral-100 hover:text-neutral-800 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-primary-500",
                recolhido ? "justify-center" : "gap-1 px-1.5",
              )}
              title={recolhido ? "Expandir o menu" : "Recolher o menu"}
            >
              {recolhido ? (
                <PanelLeftOpen
                  size={18}
                  strokeWidth={1.5}
                  className="text-neutral-400"
                  aria-hidden
                />
              ) : (
                <PanelLeftClose
                  size={18}
                  strokeWidth={1.5}
                  className="text-neutral-400"
                  aria-hidden
                />
              )}
              <span className={cn("whitespace-nowrap", recolhido && "sr-only")}>
                {recolhido ? "Expandir menu" : "Recolher menu"}
              </span>
            </button>
          </div>
        ) : null}
        <RodapeUsuario perfil={perfil} recolhido={recolhido} />
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

function Marca({
  compacto = false,
  recolhido = false,
}: {
  compacto?: boolean;
  recolhido?: boolean;
}) {
  return (
    <div
      className={cn(
        "flex shrink-0 items-center gap-1",
        compacto ? "" : "h-[64px] border-b border-neutral-200",
        compacto ? "" : recolhido ? "justify-center" : "px-2",
      )}
    >
      <span
        aria-hidden
        className="flex h-[28px] w-[28px] items-center justify-center rounded-md bg-primary-600 font-mono text-sm text-neutral-0"
      >
        Z
      </span>
      <span
        className={cn(
          "whitespace-nowrap text-base font-semibold text-neutral-900",
          recolhido && "sr-only",
        )}
      >
        Zeve CRM
      </span>
    </div>
  );
}

function Navegacao({
  itens,
  recolhido = false,
}: {
  itens: typeof MODULOS;
  recolhido?: boolean;
}) {
  const pathname = usePathname();

  return (
    <nav
      aria-label="Módulos"
      className="relative min-h-0 flex-1 overflow-x-hidden overflow-y-auto p-1"
    >
      <ul className="flex flex-col gap-0.5">
        {itens.map((item) => {
          const Icon = item.icon;
          const ativo = pathname.startsWith(item.href);
          const badge =
            item.href === "/chat" ? (
              <ContadorNaoLidas />
            ) : item.href === "/hoje" ? (
              <ContadorNaoLidas mostrar="tarefas" />
            ) : null;
          return (
            <li key={item.href}>
              <Link
                href={item.href}
                aria-current={ativo ? "page" : undefined}
                title={recolhido ? item.label : undefined}
                className={cn(
                  "flex h-[40px] items-center rounded-md text-sm transition-colors duration-[120ms] focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-primary-500",
                  recolhido ? "relative justify-center" : "gap-1 px-1.5",
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
                <span
                  className={cn("whitespace-nowrap", recolhido && "sr-only")}
                >
                  {item.label}
                </span>
                {badge ? (
                  // O invólucro NUNCA muda de tipo entre os modos: trocar a
                  // árvore remontaria o contador — que religa o canal de
                  // tempo real e toca o bip como se fosse mensagem nova.
                  <span
                    className={
                      recolhido
                        ? "pointer-events-none absolute right-0 top-0 scale-90"
                        : "contents"
                    }
                  >
                    {badge}
                  </span>
                ) : null}
              </Link>
            </li>
          );
        })}
      </ul>
    </nav>
  );
}

function RodapeUsuario({
  perfil,
  recolhido = false,
}: {
  perfil: Perfil;
  recolhido?: boolean;
}) {
  if (recolhido) {
    return (
      <div className="flex shrink-0 flex-col items-center gap-0.5 border-t border-neutral-200 p-1">
        <span title={`${perfil.nome} (${perfil.papel})`}>
          <span
            aria-hidden
            className="flex h-[32px] w-[32px] items-center justify-center rounded-md bg-neutral-100 font-mono text-sm text-neutral-600"
          >
            {perfil.nome.slice(0, 2).toUpperCase()}
          </span>
          <span className="sr-only">
            {perfil.nome} ({perfil.papel})
          </span>
        </span>
        <AlternadorTema />
        <form action={sair}>
          <button
            type="submit"
            aria-label="Sair"
            title="Sair"
            className="flex h-[40px] w-[40px] items-center justify-center rounded-md text-neutral-600 transition-colors duration-[120ms] hover:bg-neutral-100 hover:text-neutral-800 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-primary-500"
          >
            <LogOut
              size={18}
              strokeWidth={1.5}
              className="text-neutral-400"
              aria-hidden
            />
          </button>
        </form>
      </div>
    );
  }
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
          <LogOut
            size={18}
            strokeWidth={1.5}
            className="text-neutral-400"
            aria-hidden
          />
          Sair
        </button>
      </form>
    </div>
  );
}
