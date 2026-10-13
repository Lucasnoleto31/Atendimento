"use client";

import { useEffect, useRef, useState, useTransition } from "react";
import { Button } from "@/components/ui/button";
import { excluirCampanha } from "./actions";
import { fraseExclusao } from "./regras";

export type CampanhaExcluivel = {
  id: string;
  nome: string;
  /** Envios sem erro. */
  recebidos: number;
  recusadas: number;
  faltam: number;
  concluida: boolean;
};

/**
 * Excluir uma campanha com a confirmação no lugar (kit, bloco 7): o botão
 * abre a pergunta com a consequência escrita (fraseExclusao: some o
 * registro de quem recebeu, que o filtro Campanha do chat e de Contatos usa)
 * e o Excluir em vermelho ao lado do Cancelar. O erro fica ao lado do botão,
 * com a pergunta aberta. Usado no editor da campanha e no retorno de uma
 * campanha criada a partir de uma parada ("Excluir a antiga").
 */
export function ConfirmacaoExclusao({
  campanha,
  rotulo,
  aoExcluir,
}: {
  campanha: CampanhaExcluivel;
  /** O botão antes da pergunta: "Excluir campanha", "Excluir a antiga". */
  rotulo: string;
  /** Excluída: quem usa fecha a folha e volta para a lista com o retorno. */
  aoExcluir: (retorno: string) => void;
}) {
  const [confirmando, setConfirmando] = useState(false);
  const [erro, setErro] = useState<string | null>(null);
  const [pendente, iniciarTransicao] = useTransition();
  const cancelar = useRef<HTMLButtonElement>(null);
  const abrir = useRef<HTMLButtonElement>(null);

  useEffect(() => {
    if (confirmando) cancelar.current?.focus();
  }, [confirmando]);

  function excluir() {
    iniciarTransicao(async () => {
      let r: Awaited<ReturnType<typeof excluirCampanha>>;
      try {
        r = await excluirCampanha(campanha.id);
      } catch {
        r = {
          erro: "A conexão não respondeu. Confira a internet e tente de novo.",
        };
      }
      // A confirmação fica aberta com o erro ao lado do Excluir.
      if ("erro" in r) return setErro(r.erro);
      aoExcluir(r.ok);
    });
  }

  if (!confirmando) {
    return (
      <Button
        ref={abrir}
        type="button"
        variant="ghost"
        onClick={() => setConfirmando(true)}
        className="text-erro hover:text-erro pointer-coarse:h-[44px]"
      >
        {rotulo}
      </Button>
    );
  }

  return (
    <div
      role="group"
      aria-label={`Confirmar exclusão de ${campanha.nome}`}
      className="flex flex-col gap-1 animate-entrada"
    >
      <p className="tipo-corpo text-tinta tabular-nums">
        {fraseExclusao(campanha)}
      </p>
      {erro ? (
        <p role="alert" className="tipo-nota text-erro">
          {erro}
        </p>
      ) : null}
      <div className="flex flex-wrap gap-1.5">
        <Button
          type="button"
          variant="danger"
          onClick={excluir}
          carregando={pendente}
          className="pointer-coarse:h-[44px]"
        >
          {pendente ? "Excluindo…" : "Excluir"}
        </Button>
        <Button
          ref={cancelar}
          type="button"
          variant="secondary"
          disabled={pendente}
          onClick={() => {
            setConfirmando(false);
            setErro(null);
            requestAnimationFrame(() => abrir.current?.focus());
          }}
          className="pointer-coarse:h-[44px]"
        >
          Cancelar
        </Button>
      </div>
    </div>
  );
}
