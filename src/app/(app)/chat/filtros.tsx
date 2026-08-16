"use client";

import { useRouter } from "next/navigation";
import type { Etiqueta } from "./ferramentas";

/** Filtro por etiqueta na lista de conversas — troca a URL ao selecionar. */
export function FiltroEtiqueta({
  etiquetas,
  filtro,
  busca,
  etiquetaAtual,
}: {
  etiquetas: Etiqueta[];
  filtro: string;
  busca: string;
  etiquetaAtual: string;
}) {
  const router = useRouter();

  const navegar = (etiqueta: string) => {
    const p = new URLSearchParams();
    if (filtro !== "todas") p.set("f", filtro);
    if (busca) p.set("q", busca);
    if (etiqueta) p.set("t", etiqueta);
    const q = p.toString();
    router.push(q ? `/chat?${q}` : "/chat");
  };

  return (
    <>
      <label htmlFor="filtro-etiqueta" className="sr-only">
        Filtrar por etiqueta
      </label>
      <select
        id="filtro-etiqueta"
        value={etiquetaAtual}
        onChange={(e) => navegar(e.target.value)}
        className="h-[32px] w-full rounded-md border border-neutral-300 bg-neutral-0 px-1 text-sm text-neutral-800 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-primary-500"
      >
        <option value="">Todas as etiquetas</option>
        {etiquetas.map((etiqueta) => (
          <option key={etiqueta.id} value={etiqueta.id}>
            {etiqueta.nome}
          </option>
        ))}
      </select>
    </>
  );
}
