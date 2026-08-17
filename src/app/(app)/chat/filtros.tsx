"use client";

import { useRouter } from "next/navigation";
import type { Etiqueta } from "./ferramentas";

/**
 * Selects compactos da lista de conversas: atendente e etiqueta, lado a lado.
 * Trocar qualquer um navega preservando os demais parâmetros da URL.
 */
export function FiltrosLista({
  etiquetas,
  equipe,
  filtro,
  busca,
  etiquetaAtual,
  atendenteAtual,
}: {
  etiquetas: Etiqueta[];
  equipe: { id: string; nome: string }[];
  filtro: string;
  busca: string;
  etiquetaAtual: string;
  atendenteAtual: string;
}) {
  const router = useRouter();

  const navegar = (etiqueta: string, atendente: string) => {
    const p = new URLSearchParams();
    if (filtro !== "todas") p.set("f", filtro);
    if (busca) p.set("q", busca);
    if (etiqueta) p.set("t", etiqueta);
    if (atendente) p.set("v", atendente);
    const q = p.toString();
    router.push(q ? `/chat?${q}` : "/chat");
  };

  const campo =
    "h-[32px] w-full min-w-0 rounded-md border border-neutral-300 bg-neutral-0 px-1 text-sm text-neutral-800 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-primary-500";

  return (
    <div
      className={
        etiquetas.length > 0 ? "mt-1 grid grid-cols-2 gap-1" : "mt-1"
      }
    >
      <div>
        <label htmlFor="filtro-atendente" className="sr-only">
          Filtrar por atendente
        </label>
        <select
          id="filtro-atendente"
          value={atendenteAtual}
          onChange={(e) => navegar(etiquetaAtual, e.target.value)}
          className={campo}
        >
          <option value="">Atendente: todos</option>
          <option value="sem">Sem atendente</option>
          {equipe.map((pessoa) => (
            <option key={pessoa.id} value={pessoa.id}>
              {pessoa.nome}
            </option>
          ))}
        </select>
      </div>

      {etiquetas.length > 0 ? (
        <div>
          <label htmlFor="filtro-etiqueta" className="sr-only">
            Filtrar por etiqueta
          </label>
          <select
            id="filtro-etiqueta"
            value={etiquetaAtual}
            onChange={(e) => navegar(e.target.value, atendenteAtual)}
            className={campo}
          >
            <option value="">Etiqueta: todas</option>
            {etiquetas.map((etiqueta) => (
              <option key={etiqueta.id} value={etiqueta.id}>
                {etiqueta.nome}
              </option>
            ))}
          </select>
        </div>
      ) : null}
    </div>
  );
}
