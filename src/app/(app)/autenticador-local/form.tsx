"use client";

import { useActionState } from "react";
import { Button } from "@/components/ui/button";
import { Field } from "@/components/ui/field";
import {
  confirmarAutenticador,
  type EstadoAutenticador,
} from "./actions";

const INICIAL: EstadoAutenticador = {};

export function FormAutenticador() {
  const [estado, acao, pendente] = useActionState(
    confirmarAutenticador,
    INICIAL,
  );
  return (
    <form action={acao} className="mt-3 flex flex-col gap-2">
      <Field
        id="codigo-autenticador"
        name="codigo"
        label="Código do app autenticador"
        inputMode="numeric"
        autoComplete="one-time-code"
        maxLength={6}
        required
        autoFocus
        erro={estado.erro}
      />
      <Button type="submit" carregando={pendente}>
        {pendente ? "Confirmando…" : "Confirmar"}
      </Button>
    </form>
  );
}
