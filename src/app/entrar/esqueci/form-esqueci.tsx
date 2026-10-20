"use client";

import { useActionState } from "react";
import { Mail } from "lucide-react";
import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import { pedirCodigoSenha, type EstadoEsqueci } from "./actions";
import { CampoLinha } from "../campo-linha";
import { semReset, useIrPara } from "../form-acao";
import { BOTAO_ESPERA_PREENCHER, CAIXA_ERRO } from "../estilos";
import { EMAIL_EXEMPLO } from "@/lib/marca";

const ESTADO_INICIAL: EstadoEsqueci = {};

export function FormEsqueci({
  email,
  proximo,
}: {
  email: string;
  proximo: string;
}) {
  const [estado, executar, pendente] = useActionState(
    pedirCodigoSenha,
    ESTADO_INICIAL,
  );
  const indo = Boolean(estado.ir);
  useIrPara(estado.ir);

  return (
    <form
      method="post"
      onSubmit={semReset(executar)}
      className="group/form flex flex-col gap-3"
    >
      <input type="hidden" name="proximo" value={proximo} />

      <CampoLinha
        id="email"
        name="email"
        label="E-mail"
        type="email"
        autoComplete="username"
        required
        autoFocus
        defaultValue={email}
        placeholder={EMAIL_EXEMPLO}
        icone={<Mail size={20} strokeWidth={1.75} aria-hidden />}
      />

      {estado.erro ? (
        <p role="alert" className={CAIXA_ERRO}>
          {estado.erro}
        </p>
      ) : null}

      <Button
        type="submit"
        size="lg"
        disabled={pendente || indo}
        className={cn("mt-1 w-full", BOTAO_ESPERA_PREENCHER)}
      >
        {pendente || indo ? "Enviando…" : "Enviar código"}
      </Button>
    </form>
  );
}
