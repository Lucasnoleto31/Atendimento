"use client";

import { createContext, useContext, type ReactNode } from "react";
import { CircleDashed } from "lucide-react";
import { AvatarPessoa } from "@/components/app/avatar-pessoa";

/*
 * As fotos da equipe dentro do chat. A página lê o mapa uma vez no servidor
 * (fotosDaEquipe, em lib/fotos-equipe.ts) e o chat o entrega por contexto:
 * a bolha, a linha da fila, o cabeçalho e as listas da equipe acham a foto
 * pelo id da pessoa, sem ir ao banco por conversa e sem passar o mapa de
 * componente em componente. Fora do provedor (ou sem foto), as iniciais.
 */

type MapaFotos = Readonly<Record<string, string>>;

const SEM_FOTOS: MapaFotos = {};

const FotosDaEquipe = createContext<MapaFotos>(SEM_FOTOS);

/** Envolve o chat com o mapa de fotos que a página leu. */
export function ProvedorFotosDaEquipe({
  fotos,
  children,
}: {
  fotos: MapaFotos;
  children: ReactNode;
}) {
  return <FotosDaEquipe value={fotos}>{children}</FotosDaEquipe>;
}

/** A URL da foto de alguém da equipe pelo id do perfil, ou null. */
export function useFotoDaEquipe(id: string | null | undefined): string | null {
  const fotos = useContext(FotosDaEquipe);
  if (!id) return null;
  // typeof: um id que bata com nome de propriedade do Object não vira foto.
  const url = fotos[id];
  return typeof url === "string" ? url : null;
}

/**
 * O círculo de alguém da equipe no chat: a foto pelo id ou, sem ela, as
 * iniciais (AvatarPessoa). Pequeno ao lado do nome (16px, na bolha, na
 * linha da fila e no cabeçalho) e no lugar do ícone das listas (20px).
 *
 * O que cabe no círculo de 16 (uma inicial só, em 10px, a menor letra da
 * ficha) é regra do AvatarPessoa, que sabe o tamanho; aqui não se força
 * tamanho de letra por cima do dele.
 */
export function AvatarDaEquipe({
  id,
  nome,
  tamanho = 16,
  className,
}: {
  id: string | null | undefined;
  nome: string;
  tamanho?: number;
  className?: string;
}) {
  const foto = useFotoDaEquipe(id);
  return (
    <AvatarPessoa
      nome={nome}
      foto={foto}
      tamanho={tamanho}
      className={className}
    />
  );
}

/**
 * O ícone de cada linha das listas da equipe (Transferir, Atendentes): a
 * foto ou as iniciais em 20px, a medida do ícone dos menus. "Sem dono" (id
 * nulo) é o círculo tracejado, o lugar vazio; a cor dele vem de quem envolve.
 *
 * Item desabilitado (o limite do filtro, o Transferir pendente): o nome vai
 * para o texto-3, e a foto e o círculo das iniciais, que têm cor própria,
 * acompanham em 40% de opacidade. O tracejado já segue a cor do item.
 */
export function IconeDaPessoa({
  id,
  nome,
}: {
  id: string | null;
  nome: string;
}) {
  if (!id) return <CircleDashed size={20} strokeWidth={1.75} aria-hidden />;
  return (
    <AvatarDaEquipe
      id={id}
      nome={nome}
      tamanho={20}
      className="transition-opacity duration-[120ms] group-disabled/item:opacity-40"
    />
  );
}
