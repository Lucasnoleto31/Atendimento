"use client";

import { useState } from "react";
import { Button } from "@/components/ui/button";

/** "Copiar" para um texto que se cola em outro lugar (o endereço do
 *  webhook no painel da Meta): digitar uma URL longa é onde o erro entra. */
export function BotaoCopiar({
  texto,
  rotulo,
}: {
  texto: string;
  /** Nome acessível: "Copiar o endereço do webhook". */
  rotulo: string;
}) {
  const [copiado, setCopiado] = useState(false);
  return (
    <Button
      type="button"
      variant="secondary"
      size="sm"
      aria-label={copiado ? undefined : rotulo}
      onClick={() => {
        void navigator.clipboard?.writeText(texto).then(
          () => setCopiado(true),
          () => setCopiado(false),
        );
      }}
      className="shrink-0"
    >
      {copiado ? "Copiado" : "Copiar"}
    </Button>
  );
}
