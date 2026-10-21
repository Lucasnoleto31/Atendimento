"use client";

import Link from "next/link";
import { useActionState, useEffect, useRef } from "react";
import { LockKeyhole, Mail } from "lucide-react";
import { cn } from "@/lib/utils";
import { entrar, type EstadoLogin } from "./actions";
import { Button } from "@/components/ui/button";
import { CampoLinha, CampoSenhaLinha } from "./campo-linha";
import { semReset, useIrPara } from "./form-acao";
import {
  BOTAO_ESPERA_PREENCHER,
  CAIXA_ERRO,
  LINK_SUBLINHADO,
} from "./estilos";
import { urlEntrar } from "./caminhos";
import { EMAIL_EXEMPLO } from "@/lib/marca";

const ESTADO_INICIAL: EstadoLogin = {};

/**
 * "Lembrar meu e-mail" guarda só o e-mail, e só neste navegador
 * (localStorage). A senha fica com o gerenciador de senhas do navegador, que
 * o autoComplete dos campos continua alimentando. Leitura e escrita dentro de
 * try: aba anônima e armazenamento bloqueado lançam erro, e a tela funciona
 * do mesmo jeito sem ele.
 */
const CHAVE_EMAIL = "entrar:email";

function lerEmailLembrado(): string | null {
  try {
    return window.localStorage.getItem(CHAVE_EMAIL);
  } catch {
    return null;
  }
}

function gravarEmailLembrado(email: string | null) {
  try {
    if (email) window.localStorage.setItem(CHAVE_EMAIL, email);
    else window.localStorage.removeItem(CHAVE_EMAIL);
  } catch {
    // Sem armazenamento, o e-mail só não fica lembrado.
  }
}

export function LoginForm({ proximo }: { proximo: string }) {
  const [estado, executar, pendente] = useActionState(entrar, ESTADO_INICIAL);
  const indo = Boolean(estado.ir);
  useIrPara(estado.ir);

  const campoEmail = useRef<HTMLInputElement>(null);
  const caixaLembrar = useRef<HTMLInputElement>(null);

  // O e-mail lembrado entra direto no campo, sem estado do React: os campos
  // são livres (o navegador e o gerenciador de senhas preenchem por fora), e
  // remontar o campo para trocar o defaultValue apagaria o que o navegador
  // já tivesse posto. Campo já preenchido não é sobrescrito.
  useEffect(() => {
    const lembrado = lerEmailLembrado();
    if (!lembrado) return;
    if (caixaLembrar.current) caixaLembrar.current.checked = true;
    if (campoEmail.current && !campoEmail.current.value) {
      campoEmail.current.value = lembrado;
    }
  }, []);

  const enviar = (evento: React.FormEvent<HTMLFormElement>) => {
    // Marcado, guarda o e-mail do envio; desmarcado, esquece.
    if (caixaLembrar.current?.checked) {
      gravarEmailLembrado(campoEmail.current?.value.trim() || null);
    } else {
      gravarEmailLembrado(null);
    }
    semReset(executar)(evento);
  };

  return (
    // method="post": antes da hidratação o envio é o nativo do navegador, e
    // sem method ele vira GET com a senha na URL (ver semReset).
    <form
      method="post"
      onSubmit={enviar}
      className="group/form flex flex-col gap-3"
    >
      <input type="hidden" name="proximo" value={proximo} />

      <CampoLinha
        ref={campoEmail}
        id="email"
        name="email"
        label="E-mail"
        type="email"
        autoComplete="username"
        required
        placeholder={EMAIL_EXEMPLO}
        icone={<Mail size={20} strokeWidth={1.75} aria-hidden />}
      />

      <div className="flex flex-col gap-1.5">
        <CampoSenhaLinha
          id="senha"
          name="senha"
          label="Senha"
          autoComplete="current-password"
          required
          icone={<LockKeyhole size={20} strokeWidth={1.75} aria-hidden />}
        />

        {/* 12px entre os dois no toque (kit, bloco 7): o vão do justify
            nunca fica abaixo do gap. */}
        <div className="flex flex-wrap items-center justify-between gap-x-1.5">
          {/* Sem name: a escolha fica no navegador e não vai ao servidor. */}
          <label className="inline-flex min-h-[32px] cursor-pointer items-center gap-1 text-sm text-tinta pointer-coarse:min-h-[44px]">
            <input
              ref={caixaLembrar}
              type="checkbox"
              onChange={(e) => {
                if (!e.currentTarget.checked) gravarEmailLembrado(null);
              }}
              className="size-[18px] shrink-0 cursor-pointer"
            />
            Lembrar meu e-mail
          </label>

          {/* O destino vai junto: o "Voltar ao login" de lá devolve a ele. */}
          <Link
            href={urlEntrar("/entrar/esqueci", { proximo })}
            className={LINK_SUBLINHADO}
          >
            Esqueci a senha
          </Link>
        </div>
      </div>

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
        {pendente || indo ? "Entrando…" : "Entrar"}
      </Button>
    </form>
  );
}
