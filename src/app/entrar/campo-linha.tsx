"use client";

import { cn } from "@/lib/utils";
import { AJUDA, ERRO_CAMPO } from "@/components/app/form-styles";
import { BotaoMostrarSenha, useMostrarSenha } from "./campo-senha";
import {
  LINHA_CAMPO,
  LINHA_ERRO,
  LINHA_FOCO,
  ROTULO_LINHA,
  SEM_COR_DE_AUTOFILL,
} from "./estilos";

type PropsCampoLinha = {
  id: string;
  label: string;
  /** Ícone à esquerda, já com tamanho e traço; decorativo (aria-hidden). */
  icone: React.ReactNode;
  ajuda?: string;
  erro?: string;
  /** O que fica à direita, dentro da linha (o olho da senha). */
  fim?: React.ReactNode;
  ref?: React.Ref<HTMLInputElement>;
} & Omit<React.ComponentProps<"input">, "id" | "ref">;

/**
 * Campo das telas de /entrar: sem caixa, só a linha embaixo, com o ícone à
 * esquerda. O rótulo fica à vista acima da linha (o placeholder não substitui
 * o rótulo), e ajuda e erro embaixo, ligados ao campo pelo aria-describedby,
 * como no Field. O foco engrossa a linha (ver LINHA_CAMPO em estilos.ts).
 *
 * A linha tem 48px: alvo de toque folgado, também no celular.
 */
export function CampoLinha({
  id,
  label,
  icone,
  ajuda,
  erro,
  fim,
  className,
  ref,
  ...props
}: PropsCampoLinha) {
  const ajudaId = ajuda ? `${id}-ajuda` : undefined;
  const erroId = erro ? `${id}-erro` : undefined;

  return (
    <div className="flex flex-col gap-0.5">
      <label htmlFor={id} className={ROTULO_LINHA}>
        {label}
      </label>
      <div
        className={cn(
          "group/linha flex items-center gap-1",
          LINHA_CAMPO,
          erro ? LINHA_ERRO : LINHA_FOCO,
        )}
      >
        {/* O ícone acompanha o fio: cinza parado, na tinta com o foco. */}
        <span className="flex shrink-0 text-texto-3 transition-colors duration-[120ms] group-has-[input:focus]/linha:text-tinta">
          {icone}
        </span>
        <input
          ref={ref}
          id={id}
          aria-invalid={erro ? true : undefined}
          aria-describedby={
            [ajudaId, erroId].filter(Boolean).join(" ") || undefined
          }
          className={cn(
            "h-[48px] min-w-0 flex-1 bg-transparent text-base text-tinta outline-hidden placeholder:text-texto-3 disabled:cursor-not-allowed disabled:text-texto-3",
            SEM_COR_DE_AUTOFILL,
            className,
          )}
          {...props}
        />
        {fim}
      </div>
      {ajuda ? (
        <p id={ajudaId} className={cn(AJUDA, "mt-0.5")}>
          {ajuda}
        </p>
      ) : null}
      {erro ? (
        <p id={erroId} className={cn(ERRO_CAMPO, "mt-0.5")}>
          {erro}
        </p>
      ) : null}
    </div>
  );
}

/**
 * Senha no campo de linha, com o olho à direita (o mesmo do CampoSenha: o
 * campo volta a ser de senha no envio, e o clique no olho não tira o foco).
 */
export function CampoSenhaLinha(
  props: Omit<PropsCampoLinha, "type" | "fim" | "ref">,
) {
  const { visivel, campo, alternar } = useMostrarSenha();

  return (
    <CampoLinha
      {...props}
      ref={campo}
      type={visivel ? "text" : "password"}
      fim={
        <BotaoMostrarSenha
          visivel={visivel}
          alternar={alternar}
          controla={props.id}
          className="-mr-1 inline-flex h-[40px] w-[40px] shrink-0 items-center justify-center rounded-controle text-texto-2 transition-colors duration-[120ms] hover:bg-realce hover:text-tinta focus-visible:outline-2 focus-visible:outline-offset-0 focus-visible:outline-tinta aria-pressed:text-tinta pointer-coarse:h-[44px] pointer-coarse:w-[44px]"
        />
      }
    />
  );
}
