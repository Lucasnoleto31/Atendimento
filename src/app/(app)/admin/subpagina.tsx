import Link from "next/link";
import { ChevronLeft } from "lucide-react";
import {
  lerVoltar,
  rotuloVoltar,
  voltarDiferenteDe,
} from "@/app/(app)/contatos/voltar";
import { CabecalhoPagina } from "../configuracoes/ui";
import { CAMINHO_ADMIN } from "./rotas";

/*
 * O alto de cada subpágina da Administração: "‹ Administração" acima do
 * título, como a barra dos Ajustes do iPhone, e o título grande. Quem chegou
 * de outra tela com ?voltar= (o chat, Disparos) vê a volta para lá no lugar
 * ("‹ Voltar à conversa", "‹ Disparos"); a Administração continua no menu.
 *
 * Sem "use client": serve às páginas de servidor e às telas de cliente.
 */

/** O ?voltar= da subpágina, já conferido (só tela deste site, e não ela
 *  mesma). */
export function voltarDaSubpagina(
  valor: unknown,
  propria: string,
): string | null {
  return voltarDiferenteDe(lerVoltar(valor), propria);
}

/**
 * O "‹ …" do alto. 40px (44 no toque) sem empurrar o título: a margem
 * negativa devolve o que a altura acrescenta.
 */
export function LinkVoltarAdmin({
  href,
  rotulo,
}: {
  href: string;
  rotulo: string;
}) {
  return (
    <Link
      href={href}
      className="tipo-corpo -my-1 -ml-1 inline-flex h-[40px] items-center gap-0.5 rounded-controle pr-1 pl-0.5 text-texto-2 transition-colors duration-[120ms] hover:bg-realce hover:text-tinta active:bg-pressionado focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-tinta pointer-coarse:h-[44px]"
    >
      <ChevronLeft size={20} strokeWidth={1.75} aria-hidden />
      {rotulo}
    </Link>
  );
}

/**
 * O "‹ Administração" (ou a volta do ?voltar=) e o título. `raiz`: a
 * subpágina é a entrada do papel (o Log de acesso para o compliance), e não
 * há para onde voltar.
 */
export function CabecalhoSubpagina({
  titulo,
  voltar = null,
  raiz = false,
  acoes,
}: {
  titulo: string;
  voltar?: string | null;
  raiz?: boolean;
  acoes?: React.ReactNode;
}) {
  const volta = voltar
    ? { href: voltar, rotulo: rotuloVoltar(voltar) }
    : raiz
      ? null
      : { href: CAMINHO_ADMIN, rotulo: "Administração" };
  return (
    <>
      {volta ? (
        <div className="mb-1.5">
          <LinkVoltarAdmin href={volta.href} rotulo={volta.rotulo} />
        </div>
      ) : null}
      <CabecalhoPagina titulo={titulo} acoes={acoes} />
    </>
  );
}

/** A moldura da subpágina: o mesmo respiro das outras telas, um pouco
 *  menos em cima quando há o "‹" acima do título. */
export function MolduraSubpagina({
  children,
  comVolta = true,
}: {
  children: React.ReactNode;
  comVolta?: boolean;
}) {
  return (
    <div
      className={
        comVolta
          ? "px-2 pt-2 pb-6 md:px-3 md:pt-3 lg:pt-3"
          : "px-2 pt-3 pb-6 md:px-3 lg:pt-4"
      }
    >
      {children}
    </div>
  );
}
