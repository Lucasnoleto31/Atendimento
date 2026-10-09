"use client";

import { useRouter } from "next/navigation";
import { useComandosDaTela } from "@/components/app/paleta-global";

/**
 * Os atalhos do Relatório na paleta (⌘K / Ctrl+K): as duas filas do bloco
 * "Agora", com os mesmos endereços dos números. Recebe só os endereços:
 * componente de servidor não passa função para o cliente.
 */
export function ComandosRelatorio({
  esperando,
  semDono,
}: {
  esperando: string;
  semDono: string;
}) {
  const router = useRouter();
  useComandosDaTela([
    {
      id: "relatorio-esperando",
      rotulo: "Abrir quem espera resposta",
      executar: () => router.push(esperando),
    },
    {
      id: "relatorio-sem-dono",
      rotulo: "Abrir conversas sem dono",
      executar: () => router.push(semDono),
    },
  ]);
  return null;
}
