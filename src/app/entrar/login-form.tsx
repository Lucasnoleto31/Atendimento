"use client";

import { useActionState } from "react";
import { useFormStatus } from "react-dom";
import { entrar, type EstadoLogin } from "./actions";
import { Field } from "@/components/ui/field";
import { Button } from "@/components/ui/button";

const ESTADO_INICIAL: EstadoLogin = {};

function BotaoEntrar({ indo }: { indo: boolean }) {
  const { pending } = useFormStatus();
  return (
    <Button
      type="submit"
      size="lg"
      disabled={pending || indo}
      className="w-full"
    >
      {pending || indo ? "Entrando…" : "Entrar"}
    </Button>
  );
}

export function LoginForm({ proximo }: { proximo: string }) {
  const [estado, formAction] = useActionState(entrar, ESTADO_INICIAL);

  // Recarga completa de propósito — nada de router.push. Ver EstadoLogin.ir.
  if (typeof window !== "undefined" && estado.ir) {
     
    window.location.assign(estado.ir);
  }

  return (
    <form action={formAction} className="flex flex-col gap-2">
      <input type="hidden" name="proximo" value={proximo} />

      <Field
        id="email"
        name="email"
        label="E-mail"
        type="email"
        autoComplete="username"
        required
        placeholder="voce@zeve.com.br"
      />

      <Field
        id="senha"
        name="senha"
        label="Senha"
        type="password"
        autoComplete="current-password"
        required
      />

      {estado.erro ? (
        <p
          role="alert"
          className="rounded-md border border-danger bg-danger-bg px-1.5 py-1 text-sm text-danger"
        >
          {estado.erro}
        </p>
      ) : null}

      <div className="mt-1">
        <BotaoEntrar indo={Boolean(estado.ir)} />
      </div>
    </form>
  );
}
