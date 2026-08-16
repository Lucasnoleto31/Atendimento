"use client";

import { CORES_ETIQUETA } from "@/lib/etiquetas";
import { alterarCorTag } from "./actions";

/** Troca a cor da etiqueta assim que a escolha muda, sem botão extra. */
export function SeletorCorTag({
  id,
  nome,
  cor,
}: {
  id: string;
  nome: string;
  cor: string | null | undefined;
}) {
  return (
    <form action={alterarCorTag} className="flex">
      <input type="hidden" name="id" value={id} />
      <label htmlFor={`cor-${id}`} className="sr-only">
        Cor da etiqueta {nome}
      </label>
      <select
        id={`cor-${id}`}
        name="cor"
        defaultValue={cor ?? "neutro"}
        onChange={(e) => e.currentTarget.form?.requestSubmit()}
        className="h-[20px] rounded-sm border border-neutral-300 bg-neutral-0 text-xs text-neutral-800 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-primary-500"
      >
        {CORES_ETIQUETA.map((c) => (
          <option key={c.chave} value={c.chave}>
            {c.rotulo}
          </option>
        ))}
      </select>
    </form>
  );
}
