"use client";

import { useEffect, useRef, useState } from "react";
import { Eye, EyeOff } from "lucide-react";
import { cn } from "@/lib/utils";
import {
  AJUDA,
  CAMPO_BASE,
  ERRO_CAMPO,
  ROTULO,
} from "@/components/app/form-styles";

/**
 * O olho da senha: o estado de mostrar, a referência do campo e o alternar.
 * Serve ao CampoSenha (com caixa, o de Minha conta) e ao campo de linha das
 * telas de /entrar (campo-linha.tsx).
 *
 * No envio do formulário o campo volta a ser de senha antes de os dados
 * saírem: com type="text" na hora do envio, alguns navegadores guardam o
 * valor no histórico de preenchimento e passam a sugerir a senha em outros
 * campos de texto.
 */
export function useMostrarSenha() {
  const [visivel, setVisivel] = useState(false);
  const campo = useRef<HTMLInputElement>(null);

  useEffect(() => {
    const form = campo.current?.form;
    if (!form) return;
    // Ouvinte no próprio form: dispara no alvo, antes do onSubmit do React
    // (que fica na raiz) montar o FormData. O type vai direto no elemento,
    // na hora; o estado só acompanha para o próximo render não desfazer.
    const esconder = () => {
      if (campo.current) campo.current.type = "password";
      setVisivel(false);
    };
    form.addEventListener("submit", esconder);
    return () => form.removeEventListener("submit", esconder);
  }, []);

  const alternar = () => {
    const el = campo.current;
    const comFoco = el !== null && document.activeElement === el;
    const inicio = el?.selectionStart ?? null;
    const fim = el?.selectionEnd ?? null;
    setVisivel((v) => !v);
    // Trocar o type do input pode jogar o cursor para o fim em alguns
    // navegadores; quem estava digitando no meio continua no mesmo ponto.
    if (comFoco && el) {
      requestAnimationFrame(() => {
        el.focus();
        if (inicio !== null && fim !== null) el.setSelectionRange(inicio, fim);
      });
    }
  };

  return { visivel, campo, alternar };
}

/**
 * O botão do olho. O rótulo é sempre "Mostrar senha" e o estado vai no
 * aria-pressed: trocar o rótulo junto faria o leitor de tela dizer "Ocultar
 * senha, pressionado" com a senha à mostra, que se lê como o contrário.
 */
export function BotaoMostrarSenha({
  visivel,
  alternar,
  controla,
  className,
}: {
  visivel: boolean;
  alternar: () => void;
  /** id do campo de senha. */
  controla: string;
  className?: string;
}) {
  return (
    <button
      type="button"
      // Clique de mouse não tira o foco do campo: dá para olhar a senha e
      // seguir digitando. Pelo teclado o botão recebe foco normalmente.
      onMouseDown={(e) => e.preventDefault()}
      onClick={alternar}
      aria-label="Mostrar senha"
      aria-pressed={visivel}
      aria-controls={controla}
      className={className}
    >
      {visivel ? (
        <EyeOff size={18} strokeWidth={1.75} aria-hidden />
      ) : (
        <Eye size={18} strokeWidth={1.75} aria-hidden />
      )}
    </button>
  );
}

/**
 * Campo de senha com o botão de mostrar. Mesmo visual do Field de
 * components/ui (as mesmas classes de form-styles), com o olho dentro do
 * campo, à direita, numa área de 40px (44 no toque).
 */
export function CampoSenha({
  id,
  label,
  ajuda,
  erro,
  className,
  ...props
}: {
  id: string;
  label: string;
  ajuda?: string;
  erro?: string;
} & Omit<React.ComponentProps<"input">, "type" | "id">) {
  const { visivel, campo, alternar } = useMostrarSenha();
  const ajudaId = ajuda ? `${id}-ajuda` : undefined;
  const erroId = erro ? `${id}-erro` : undefined;

  return (
    <div className="flex flex-col gap-1">
      <label htmlFor={id} className={ROTULO}>
        {label}
      </label>
      <div className="relative">
        <input
          ref={campo}
          id={id}
          type={visivel ? "text" : "password"}
          aria-invalid={erro ? true : undefined}
          aria-describedby={
            [ajudaId, erroId].filter(Boolean).join(" ") || undefined
          }
          className={cn(
            CAMPO_BASE,
            "w-full py-0 pr-[48px] text-base",
            className,
          )}
          {...props}
        />
        <BotaoMostrarSenha
          visivel={visivel}
          alternar={alternar}
          controla={id}
          className="absolute inset-y-0 right-0 inline-flex w-[40px] items-center justify-center rounded-controle text-texto-2 transition-colors duration-[120ms] hover:text-tinta focus-visible:outline-2 focus-visible:-outline-offset-2 focus-visible:outline-tinta aria-pressed:text-tinta pointer-coarse:w-[44px]"
        />
      </div>
      {ajuda ? (
        <p id={ajudaId} className={AJUDA}>
          {ajuda}
        </p>
      ) : null}
      {erro ? (
        <p id={erroId} className={ERRO_CAMPO}>
          {erro}
        </p>
      ) : null}
    </div>
  );
}
