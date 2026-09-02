"use client";

import { useId, useState } from "react";

const NOVA = "__nova";

/**
 * Etiqueta da lista de leads em UM campo. Antes eram dois — um select de
 * etiquetas e um texto para nome novo — e a equipe tinha que descobrir
 * sozinha qual dos dois mandava. Aqui a escolha é uma só, e o campo de nome
 * só aparece quando ela é "criar nova".
 */
export function EtiquetaLista({
  etiquetas,
}: {
  etiquetas: { id: string; nome: string }[];
}) {
  const [escolha, setEscolha] = useState("");
  const id = useId();
  const ehNova = escolha === NOVA;

  return (
    <div className="flex flex-col gap-1">
      <label htmlFor={id} className="text-sm font-medium text-neutral-800">
        Etiqueta da lista
      </label>

      <select
        id={id}
        value={escolha}
        onChange={(e) => setEscolha(e.target.value)}
        className="h-[40px] w-full rounded-md border border-neutral-300 bg-neutral-0 px-1.5 text-base text-neutral-800 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-primary-500"
      >
        <option value="">Pela coluna “campanha” da planilha</option>
        {etiquetas.map((e) => (
          <option key={e.id} value={e.id}>
            {e.nome}
          </option>
        ))}
        <option value={NOVA}>+ Criar uma etiqueta nova…</option>
      </select>

      {/* O servidor continua recebendo os mesmos dois campos de sempre. */}
      <input type="hidden" name="etiqueta_id" value={ehNova ? "" : escolha} />

      {ehNova ? (
        <input
          name="etiqueta"
          type="text"
          autoFocus
          required
          placeholder="Nome da etiqueta nova"
          className="h-[40px] w-full rounded-md border border-neutral-300 bg-neutral-0 px-1.5 text-base text-neutral-800 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-primary-500"
        />
      ) : null}

      <p className="text-xs text-neutral-600">
        É por ela que a campanha encontra o público.
      </p>
    </div>
  );
}
