"use client";

import { useActionState, useEffect, useRef, useState } from "react";
import { LockKeyhole, Mail } from "lucide-react";
import { cn } from "@/lib/utils";
import { Button, classesDoBotao } from "@/components/ui/button";
import { ERRO_CAMPO } from "@/components/app/form-styles";
import { redefinirSenha, type EstadoRedefinir } from "./actions";
import { CampoLinha, CampoSenhaLinha } from "../campo-linha";
import { urlEntrar } from "../caminhos";
import { semReset, useIrPara } from "../form-acao";
import {
  BOTAO_ESPERA_PREENCHER,
  CAIXA_AVISO,
  CAIXA_ERRO,
  CAMPO_CODIGO,
  ROTULO_LINHA,
} from "../estilos";

const ESTADO_INICIAL: EstadoRedefinir = {};

export function FormRedefinir({
  email,
  proximo,
}: {
  email: string;
  proximo: string;
}) {
  const [estado, executar, pendente] = useActionState(
    redefinirSenha,
    ESTADO_INICIAL,
  );
  const [codigo, setCodigo] = useState("");
  const indo = Boolean(estado.ir);
  useIrPara(estado.ir);
  const erros = estado.erros ?? {};
  // O formulário sai da tela com o aviso: o foco, que estava no botão, vai
  // para o caminho até o login em vez de cair no body.
  const saida = useRef<HTMLAnchorElement>(null);
  useEffect(() => {
    if (estado.entrar) saida.current?.focus();
  }, [estado.entrar]);

  // Senha trocada, mas sem sessão: o código já foi gasto, então não há o que
  // enviar de novo. O link recarrega a página inteira, como as outras viradas
  // de autenticação (form-acao.ts).
  if (estado.entrar) {
    return (
      <div className="flex flex-col gap-3">
        <p role="status" className={CAIXA_AVISO}>
          Sua senha foi trocada. Entre com a senha nova.
        </p>
        <a
          ref={saida}
          href={estado.entrar}
          className={classesDoBotao({ size: "lg", className: "mt-1 w-full" })}
        >
          Entrar com a senha nova
        </a>
      </div>
    );
  }

  // O "Pedir outro código" mora aqui, e não na secundária da Moldura: assim
  // ele só aparece com o formulário na tela e sai junto com ele quando a
  // senha é trocada. O mt-1.5 é o mesmo espaço da secundária da Moldura.
  return (
    <>
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
          autoFocus={!email}
          defaultValue={email}
          erro={erros.email}
          icone={<Mail size={20} strokeWidth={1.75} aria-hidden />}
        />

        <div className="flex flex-col gap-0.5">
          <label htmlFor="codigo-senha" className={ROTULO_LINHA}>
            Código do e-mail
          </label>
          <input
            id="codigo-senha"
            name="codigo"
            inputMode="numeric"
            autoComplete="one-time-code"
            required
            autoFocus={Boolean(email)}
            value={codigo}
            // Espaço e hífen que vêm colados ao copiar do e-mail saem.
            // Até 10 dígitos porque o tamanho é o configurado no Supabase.
            onChange={(e) =>
              setCodigo(e.target.value.replace(/\D/g, "").slice(0, 10))
            }
            aria-invalid={erros.codigo ? true : undefined}
            aria-describedby={erros.codigo ? "codigo-senha-erro" : undefined}
            data-texto-grande=""
            className={CAMPO_CODIGO}
          />
          {erros.codigo ? (
            <p id="codigo-senha-erro" className={cn(ERRO_CAMPO, "mt-0.5")}>
              {erros.codigo}
            </p>
          ) : null}
        </div>

        <CampoSenhaLinha
          id="senha-nova"
          name="senha"
          label="Nova senha"
          autoComplete="new-password"
          required
          minLength={8}
          maxLength={72}
          ajuda="Mínimo de 8 caracteres."
          erro={erros.senha}
          icone={<LockKeyhole size={20} strokeWidth={1.75} aria-hidden />}
        />

        <CampoSenhaLinha
          id="senha-confirmacao"
          name="confirmacao"
          label="Repita a nova senha"
          autoComplete="new-password"
          required
          minLength={8}
          maxLength={72}
          erro={erros.confirmacao}
          icone={<LockKeyhole size={20} strokeWidth={1.75} aria-hidden />}
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
          {pendente || indo ? "Salvando…" : "Salvar senha e entrar"}
        </Button>
      </form>

      <div className="mt-1.5">
        <Button
          href={urlEntrar("/entrar/esqueci", { email, proximo })}
          variant="secondary"
          size="lg"
          className="w-full"
        >
          Pedir outro código
        </Button>
      </div>
    </>
  );
}
