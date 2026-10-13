"use client";

import { useEffect, useRef, useState } from "react";
import { useFormStatus } from "react-dom";
import { Button } from "@/components/ui/button";

/**
 * O botão de estado do cartão, dentro do formulário de servidor que a página
 * monta (id e status vão em campos ocultos). Pausar sai num toque. Começar
 * e Retomar pedem uma confirmação curta no lugar, com o que vai acontecer
 * ("Hoje saem até 30 de 312, até as 18h"): a campanha manda template pago
 * para clientes. Esc ou Cancelar desistem e devolvem o foco ao botão.
 *
 * A página manda só texto; a ação é o formulário em volta.
 */
export function BotaoEstado({
  acao,
  rotulo,
  frase,
}: {
  acao: "pausar" | "comecar" | "retomar";
  /** "Começar", "Retomar para os 14". */
  rotulo: string;
  /** O que acontece ao começar, já em frase. */
  frase?: string;
}) {
  const { pending } = useFormStatus();
  const [confirmando, setConfirmando] = useState(false);
  const regiao = useRef<HTMLDivElement>(null);
  const abrir = useRef<HTMLButtonElement>(null);
  const cancelar = useRef<HTMLButtonElement>(null);
  const devolverFoco = useRef(false);

  useEffect(() => {
    if (!confirmando) {
      if (devolverFoco.current) abrir.current?.focus();
      devolverFoco.current = false;
      return;
    }
    cancelar.current?.focus();
    const aoTeclar = (e: KeyboardEvent) => {
      if (e.key !== "Escape" || e.defaultPrevented) return;
      // Com uma janela modal aberta (a folha, a paleta, o menu "Mais") o Esc
      // é dela: o preventDefault daqui engoliria o fechar.
      if (document.querySelector('[aria-modal="true"], dialog[open]')) return;
      e.preventDefault();
      devolverFoco.current = true;
      setConfirmando(false);
    };
    document.addEventListener("keydown", aoTeclar);
    return () => document.removeEventListener("keydown", aoTeclar);
  }, [confirmando]);

  if (acao === "pausar") {
    return (
      <Button
        type="submit"
        variant="secondary"
        carregando={pending}
        className="pointer-coarse:h-[44px]"
      >
        {pending ? "Pausando…" : "Pausar"}
      </Button>
    );
  }

  // O botão do cartão é secundário: com várias campanhas, a tinta fica só no
  // "Começar agora" da confirmação.
  if (!confirmando) {
    return (
      <Button
        ref={abrir}
        type="button"
        variant="secondary"
        onClick={() => setConfirmando(true)}
        className="pointer-coarse:h-[44px]"
      >
        {rotulo}
      </Button>
    );
  }

  return (
    <div
      ref={regiao}
      role="group"
      aria-label={`Confirmar: ${rotulo}`}
      className="flex w-full flex-col gap-1 animate-entrada"
    >
      <p className="tipo-corpo text-tinta tabular-nums">
        {acao === "retomar" ? "Retomar agora?" : "Começar agora?"} {frase}
      </p>
      <div className="flex flex-wrap gap-1.5">
        <Button
          type="submit"
          carregando={pending}
          className="pointer-coarse:h-[44px]"
        >
          {pending
            ? acao === "retomar"
              ? "Retomando…"
              : "Começando…"
            : acao === "retomar"
              ? "Retomar agora"
              : "Começar agora"}
        </Button>
        <Button
          ref={cancelar}
          type="button"
          variant="secondary"
          disabled={pending}
          onClick={() => {
            devolverFoco.current = true;
            setConfirmando(false);
          }}
          className="pointer-coarse:h-[44px]"
        >
          Cancelar
        </Button>
      </div>
    </div>
  );
}
