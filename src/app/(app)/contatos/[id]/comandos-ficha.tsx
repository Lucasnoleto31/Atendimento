"use client";

import { useRouter } from "next/navigation";
import { useComandosDaTela } from "@/components/app/paleta-global";

/**
 * Os comandos da ficha na paleta (⌘K / Ctrl+K): abrir a conversa e editar,
 * com os mesmos endereços dos botões (caminho de volta incluído). Recebe só
 * os endereços: componente de servidor não passa função para o cliente.
 */
export function ComandosFicha({
  conversa,
  editar,
}: {
  conversa: string;
  editar: string | null;
}) {
  const router = useRouter();
  useComandosDaTela([
    {
      id: "ficha-conversa",
      rotulo: "Abrir conversa",
      grupo: "Este contato",
      executar: () => router.push(conversa),
    },
    ...(editar
      ? [
          {
            id: "ficha-editar",
            rotulo: "Editar contato",
            grupo: "Este contato",
            executar: () => router.push(editar),
          },
        ]
      : []),
  ]);
  return null;
}
