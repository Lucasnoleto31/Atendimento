"use client";

import { useEffect, useRef, useState } from "react";
import { useFormStatus } from "react-dom";
import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import { useComandosDaTela } from "@/components/app/paleta-global";
import { pausarTodasCampanhas } from "./actions";
import { numero } from "./regras";

/**
 * "Pausar todas" para quando o número piora: no título do grupo Enviando e,
 * com a qualidade Amarela ou Vermelha, também no bloco do número. Pede uma
 * confirmação curta no lugar ("Pausar as 4? Nenhum envio sai até alguém
 * começar de novo.") e grava tudo numa ida (pausarTodasCampanhas), em vez de
 * um Pausar por cartão com uma recarga entre eles.
 *
 * Pausa todas as ativas, as Paradas inclusive (voltariam a enviar sozinhas
 * quando o bloqueio saísse); a pergunta separa as duas contas para não dizer
 * "enviando" de quem não envia.
 *
 * `comPaleta`: só uma das cópias registra o comando na paleta (⌘K); ele abre
 * a mesma confirmação, com o foco no botão de pausar.
 */
export function PausarTodas({
  enviando,
  paradas = 0,
  comPaleta = false,
  recuo,
}: {
  /** Campanhas que enviam de fato (ativa e sem bloqueio). */
  enviando: number;
  /** Ativas que o motor pula (Paradas). */
  paradas?: number;
  comPaleta?: boolean;
  /** Recuo da confirmação aberta, para alinhar com o texto em volta. */
  recuo?: string;
}) {
  const quantas = enviando + paradas;
  const [confirmando, setConfirmando] = useState(false);
  const raiz = useRef<HTMLDivElement>(null);
  const abrir = useRef<HTMLButtonElement>(null);
  const confirmar = useRef<HTMLButtonElement>(null);
  const devolverFoco = useRef(false);

  useEffect(() => {
    if (!confirmando) {
      if (devolverFoco.current) abrir.current?.focus();
      devolverFoco.current = false;
      return;
    }
    raiz.current?.scrollIntoView({ block: "nearest" });
    confirmar.current?.focus();
    const aoTeclar = (e: KeyboardEvent) => {
      if (e.key !== "Escape" || e.defaultPrevented) return;
      // Com uma janela modal aberta (a folha, a paleta) o Esc é dela.
      if (document.querySelector('[aria-modal="true"], dialog[open]')) return;
      e.preventDefault();
      devolverFoco.current = true;
      setConfirmando(false);
    };
    document.addEventListener("keydown", aoTeclar);
    return () => document.removeEventListener("keydown", aoTeclar);
  }, [confirmando]);

  useComandosDaTela(
    comPaleta && quantas > 0
      ? [
          {
            id: "disparos-pausar-todas",
            rotulo: "Pausar todas as campanhas",
            grupo: "Disparos",
            executar: () => setConfirmando(true),
          },
        ]
      : [],
  );

  if (quantas === 0) return null;

  const pergunta = `${perguntaPausar(enviando, paradas)} Nenhum envio sai até alguém começar de novo.`;

  return (
    <div ref={raiz} className={confirmando ? cn("w-full", recuo) : undefined}>
      {confirmando ? (
        <form
          action={pausarTodasCampanhas}
          role="group"
          aria-label="Confirmar: pausar todas"
          className="flex flex-col gap-1 animate-entrada"
        >
          <p className="tipo-corpo text-tinta tabular-nums">{pergunta}</p>
          <Botoes
            confirmar={confirmar}
            quantas={quantas}
            aoCancelar={() => {
              devolverFoco.current = true;
              setConfirmando(false);
            }}
          />
        </form>
      ) : (
        <Button
          ref={abrir}
          type="button"
          variant="secondary"
          size="sm"
          onClick={() => setConfirmando(true)}
        >
          Pausar todas
        </Button>
      )}
    </div>
  );
}

/** "Pausar as 3?", ou com Paradas no meio "Pausar as 3: 2 enviando e 1
 *  parada?". */
function perguntaPausar(enviando: number, paradas: number): string {
  const total = enviando + paradas;
  if (paradas === 0) {
    return total === 1
      ? "Pausar a campanha que está enviando?"
      : `Pausar as ${numero(total)}?`;
  }
  if (enviando === 0) {
    return total === 1
      ? "Pausar a campanha parada?"
      : `Pausar as ${numero(total)} paradas?`;
  }
  return `Pausar as ${numero(total)}: ${numero(enviando)} enviando e ${numero(paradas)} ${paradas === 1 ? "parada" : "paradas"}?`;
}

/** Dentro do formulário, para ler o envio em andamento. */
function Botoes({
  confirmar,
  quantas,
  aoCancelar,
}: {
  confirmar: React.RefObject<HTMLButtonElement | null>;
  quantas: number;
  aoCancelar: () => void;
}) {
  const { pending } = useFormStatus();
  return (
    <div className="flex flex-wrap gap-1.5">
      <Button
        ref={confirmar}
        type="submit"
        carregando={pending}
        className="pointer-coarse:h-[44px]"
      >
        {pending
          ? "Pausando…"
          : quantas === 1
            ? "Pausar"
            : `Pausar as ${numero(quantas)}`}
      </Button>
      <Button
        type="button"
        variant="secondary"
        disabled={pending}
        onClick={aoCancelar}
        className="pointer-coarse:h-[44px]"
      >
        Cancelar
      </Button>
    </div>
  );
}
