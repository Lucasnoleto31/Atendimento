"use client";

import { useRouter } from "next/navigation";
import type { Etiqueta } from "./ferramentas";

const CAMPO =
  "h-[32px] w-full min-w-0 rounded-md border border-neutral-300 bg-neutral-0 px-1 text-sm text-neutral-800 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-primary-500";

function urlLista(
  filtro: string,
  busca: string,
  etiqueta: string,
  atendente: string,
) {
  const p = new URLSearchParams();
  if (filtro !== "todas") p.set("f", filtro);
  if (busca) p.set("q", busca);
  if (etiqueta) p.set("t", etiqueta);
  if (atendente) p.set("v", atendente);
  const q = p.toString();
  return q ? `/chat?${q}` : "/chat";
}

/**
 * Refino do escopo Todas: ver a caixa de UM atendente específico. Vive ao
 * lado da célula "Todas" e grava o mesmo parâmetro v do eixo de escopo —
 * antes havia um segundo select solto duplicando esse estado.
 */
export function SeletorAtendente({
  equipe,
  filtro,
  busca,
  etiquetaAtual,
  atendenteAtual,
}: {
  equipe: { id: string; nome: string }[];
  filtro: string;
  busca: string;
  etiquetaAtual: string;
  atendenteAtual: string;
}) {
  const router = useRouter();
  if (equipe.length === 0) return null;

  return (
    <div className="shrink-0">
      <label htmlFor="filtro-atendente" className="sr-only">
        Ver conversas de um atendente
      </label>
      <select
        id="filtro-atendente"
        value={atendenteAtual}
        onChange={(e) =>
          router.push(urlLista(filtro, busca, etiquetaAtual, e.target.value))
        }
        className="h-[32px] w-[112px] rounded-md border border-neutral-300 bg-neutral-0 px-0.5 text-xs text-neutral-600 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-primary-500"
      >
        <option value="">por atendente</option>
        {equipe.map((pessoa) => (
          <option key={pessoa.id} value={pessoa.id}>
            {pessoa.nome}
          </option>
        ))}
      </select>
    </div>
  );
}

/**
 * Filtro por etiqueta da lista de conversas. Trocar navega preservando os
 * demais parâmetros da URL. (O filtro de atendente virou o eixo de escopo
 * Minhas/Todas + o select compacto ao lado de "Todas".)
 */
export function FiltrosLista({
  etiquetas,
  filtro,
  busca,
  etiquetaAtual,
  atendenteAtual,
}: {
  etiquetas: Etiqueta[];
  filtro: string;
  busca: string;
  etiquetaAtual: string;
  atendenteAtual: string;
}) {
  const router = useRouter();
  if (etiquetas.length === 0) return null;

  return (
    <div className="mt-1">
      <label htmlFor="filtro-etiqueta" className="sr-only">
        Filtrar por etiqueta
      </label>
      <select
        id="filtro-etiqueta"
        value={etiquetaAtual}
        onChange={(e) =>
          router.push(urlLista(filtro, busca, e.target.value, atendenteAtual))
        }
        className={CAMPO}
      >
        <option value="">Etiqueta: todas</option>
        {etiquetas.map((etiqueta) => (
          <option key={etiqueta.id} value={etiqueta.id}>
            {etiqueta.nome}
          </option>
        ))}
      </select>
    </div>
  );
}
