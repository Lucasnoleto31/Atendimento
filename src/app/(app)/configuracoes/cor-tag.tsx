"use client";

import { useEffect, useRef } from "react";
import { CORES_ETIQUETA } from "@/lib/etiquetas";
import { alterarCorTag } from "./actions";
import { FormAcao, useGravando } from "./editor";
import { GrupoEscolha, OpcaoEscolha, PontoCor } from "./ui";

/**
 * As cinco cores da etiqueta em linhas de escolha, com o ponto ao lado.
 * Gravando, a escolha não muda: a segunda troca rápida era descartada calada
 * (a tela mostrava uma cor e o banco tinha outra). Bloqueia o clique e as
 * setas em vez de desativar os rádios, que tiraria o foco de quem escolhe
 * pelo teclado.
 */
export function OpcoesCor({
  name = "cor",
  selecionada,
}: {
  name?: string;
  selecionada: string;
}) {
  const gravando = useGravando();
  return (
    <div
      aria-busy={gravando || undefined}
      onClickCapture={(e) => {
        if (gravando) e.preventDefault();
      }}
      onKeyDownCapture={(e) => {
        if (gravando && e.key.startsWith("Arrow")) e.preventDefault();
      }}
    >
      <GrupoEscolha rotulo="Cor">
        {CORES_ETIQUETA.map((c) => (
          <OpcaoEscolha
            key={c.chave}
            name={name}
            value={c.chave}
            defaultChecked={c.chave === selecionada}
          >
            <PontoCor cor={c.chave} />
            <span className="tipo-corpo min-w-0 flex-1 truncate text-tinta">
              {c.rotulo}
            </span>
          </OpcaoEscolha>
        ))}
      </GrupoEscolha>
    </div>
  );
}

/**
 * A cor de uma etiqueta que já existe: grava assim que a escolha muda, como
 * as listas de opção do iOS, sem botão de salvar. O formulário remonta na
 * cor gravada (key): a tela segue o banco, e não o último toque; deu erro,
 * a escolha volta para a gravada.
 */
export function EscolhaCorEtiqueta({
  id,
  cor,
}: {
  id: string;
  cor: string | null | undefined;
}) {
  const gravada = cor ?? "neutro";
  const caixa = useRef<HTMLDivElement>(null);

  // A remontagem tira da tela o rádio que estava focado: quem escolhia pelo
  // teclado continua no rádio da cor gravada, em vez de cair no body.
  useEffect(() => {
    const ativo = document.activeElement;
    if (ativo && ativo !== document.body) return;
    caixa.current
      ?.querySelector<HTMLInputElement>('input[type="radio"]:checked')
      ?.focus();
  }, [gravada]);

  return (
    <div
      ref={caixa}
      onChange={(e) => {
        const alvo = e.target as HTMLInputElement;
        if (alvo.type === "radio") alvo.form?.requestSubmit();
      }}
    >
      <FormAcao
        key={gravada}
        acao={alterarCorTag}
        desfazerNoErro
        className="flex flex-col gap-1"
      >
        <input type="hidden" name="id" value={id} />
        <OpcoesCor selecionada={gravada} />
      </FormAcao>
    </div>
  );
}
