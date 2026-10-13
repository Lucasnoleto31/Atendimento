"use client";

import { useEffect, useRef, useState } from "react";
import { useFormStatus } from "react-dom";
import { cn } from "@/lib/utils";
import { classesDoBotao } from "@/components/ui/button";
import { Spinner } from "@/components/ui/spinner";
import { useGravando } from "./editor";

/**
 * A confirmação das ações sem volta de Configurações e Administração. Mora
 * DENTRO do <form> e acha o formulário pelo próprio botão: a página não passa
 * função nenhuma para cá.
 */

/**
 * Ação sem volta (excluir, gerar senha nova) pede confirmação no lugar: o
 * botão vira a pergunta, "Cancelar" e o botão que envia. Esc ou clique fora
 * também cancelam. Enviado, a pergunta fica até a resposta, com o indicador
 * no botão ("Excluindo…"): a linha some (excluir) ou o resultado aparece ao
 * lado (senha nova).
 *
 * O botão tem rótulo ("Excluir mensagem"), sem ícone: mora no fim do editor,
 * onde a ação destrutiva fica por último e separada.
 */
export function ConfirmarAntes({
  rotulo,
  pergunta,
  confirmar = "Excluir",
  confirmarGravando = "Excluindo…",
  texto,
  tom = "perigo",
}: {
  /** Nome acessível do botão: "Excluir campanha X". */
  rotulo: string;
  /** Uma linha sobre o que acontece. */
  pergunta: string;
  confirmar?: string;
  /** Rótulo do botão que confirma enquanto grava. */
  confirmarGravando?: string;
  /** Rótulo visível (padrão: o `rotulo`). */
  texto?: string;
  /** O botão que confirma: no erro (padrão) ou na tinta. */
  tom?: "perigo" | "principal";
}) {
  const [confirmando, setConfirmando] = useState(false);
  const regiao = useRef<HTMLSpanElement>(null);
  const abrir = useRef<HTMLButtonElement>(null);
  const cancelar = useRef<HTMLButtonElement>(null);
  const enviar = useRef<HTMLButtonElement>(null);
  const devolverFoco = useRef(false);

  // Gravando: no FormAcao (envio pelo onSubmit) ou num <form action>, como o
  // da senha nova.
  const status = useFormStatus();
  const gravando = useGravando() || status.pending;

  // A resposta chegou (deu certo ou não): a pergunta fecha. Com erro, ele
  // aparece no formulário e o foco volta para o botão.
  const [gravandoAntes, setGravandoAntes] = useState(gravando);
  if (gravando !== gravandoAntes) {
    setGravandoAntes(gravando);
    if (!gravando && confirmando) setConfirmando(false);
  }

  // Aberta, o foco vai para o "Cancelar"; fechada, volta para o botão que a
  // abriu (quando foi pelo teclado, pelo Cancelar ou depois do envio).
  useEffect(() => {
    if (!confirmando) {
      if (devolverFoco.current) abrir.current?.focus();
      devolverFoco.current = false;
      return;
    }
    cancelar.current?.focus();
  }, [confirmando]);

  // Clique fora cancela, menos com o envio no ar: aí não há mais o que
  // cancelar, só esperar a resposta.
  useEffect(() => {
    if (!confirmando) return;
    const form = enviar.current?.form ?? null;
    const aoClicar = (e: MouseEvent) => {
      if (gravando) return;
      if (!regiao.current?.contains(e.target as Node)) setConfirmando(false);
    };
    const aoEnviar = () => {
      devolverFoco.current = true;
    };
    document.addEventListener("mousedown", aoClicar);
    form?.addEventListener("submit", aoEnviar);
    return () => {
      document.removeEventListener("mousedown", aoClicar);
      form?.removeEventListener("submit", aoEnviar);
    };
  }, [confirmando, gravando]);

  if (!confirmando) {
    return (
      <button
        ref={abrir}
        type="button"
        onClick={() => setConfirmando(true)}
        aria-label={texto ? undefined : rotulo}
        className={classesDoBotao({
          variant: "ghost",
          size: "md",
          className: cn(
            // O texto alinha com o do editor; o fundo do hover sobra para a
            // margem.
            "-ml-2 justify-start pointer-coarse:h-[44px]",
            tom === "perigo" && "text-erro hover:text-erro",
          ),
        })}
      >
        {texto ?? rotulo}
      </button>
    );
  }

  return (
    <span
      ref={regiao}
      role="group"
      aria-label={rotulo}
      aria-busy={gravando || undefined}
      // Esc cancela só a confirmação: marcado como usado, a folha ou o
      // painel em volta não fecham junto (nem com o envio no ar).
      onKeyDown={(e) => {
        if (e.key !== "Escape") return;
        e.preventDefault();
        if (gravando) return;
        devolverFoco.current = true;
        setConfirmando(false);
      }}
      className="flex flex-col gap-1.5"
    >
      <span className="tipo-corpo text-tinta">{pergunta}</span>
      <span className="inline-flex flex-wrap items-center gap-1.5">
        {/* Com o envio no ar, os dois botões ficam no lugar (sem disabled,
            que tiraria o foco deles) e não respondem. */}
        <button
          ref={cancelar}
          type="button"
          aria-disabled={gravando || undefined}
          onClick={() => {
            if (gravando) return;
            devolverFoco.current = true;
            setConfirmando(false);
          }}
          className={classesDoBotao({
            variant: "secondary",
            size: "sm",
            className:
              "aria-disabled:cursor-not-allowed aria-disabled:border-fio aria-disabled:text-texto-3 aria-disabled:hover:bg-transparent",
          })}
        >
          Cancelar
        </button>
        <button
          ref={enviar}
          type="submit"
          aria-disabled={gravando || undefined}
          aria-busy={gravando || undefined}
          onClick={(e) => {
            // O segundo toque não manda outra vez (na senha nova, geraria
            // outra senha por cima da que está chegando).
            if (gravando) e.preventDefault();
          }}
          className={classesDoBotao({
            variant: tom === "perigo" ? "danger" : "primary",
            size: "sm",
          })}
        >
          {gravando ? <Spinner tamanho={16} /> : null}
          {gravando ? confirmarGravando : confirmar}
        </button>
      </span>
    </span>
  );
}
