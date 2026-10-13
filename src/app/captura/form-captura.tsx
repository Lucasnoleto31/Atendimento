"use client";

import { useActionState } from "react";
import { Phone, User } from "lucide-react";
import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import { CampoLinha } from "@/app/entrar/campo-linha";
import { BOTAO_ESPERA_PREENCHER, CAIXA_ERRO } from "@/app/entrar/estilos";
import { capturarLead, type EstadoCaptura } from "./actions";
import { MAX_TEXTO, type Rastreio } from "./rastreio";

const ESTADO_INICIAL: EstadoCaptura = {};

/**
 * Nome e WhatsApp, nada mais: é a página de destino do anúncio, aberta no
 * celular. Os parâmetros de campanha vão escondidos até a action.
 *
 * O form usa a action direto (e não o semReset do /entrar): antes da
 * hidratação, no celular lento que veio do anúncio, o envio nativo já chega
 * à action. Depois do erro os campos voltam com o que foi digitado, pelo
 * defaultValue que a action devolve: o React esvazia o form depois de toda
 * action e o refaz a partir do defaultValue novo.
 */
export function FormCaptura({ rastreio }: { rastreio: Rastreio }) {
  const [estado, executar, pendente] = useActionState(
    capturarLead,
    ESTADO_INICIAL,
  );

  return (
    <form action={executar} className="group/form flex flex-col gap-3">
      {rastreio.map((c) => (
        <input key={c.chave} type="hidden" name={c.chave} value={c.valor} />
      ))}

      {/* Honeypot: fora da tela para gente, irresistível para robô. Fora do
          leitor de tela (aria-hidden) e do Tab (tabIndex -1). */}
      <div
        aria-hidden
        className="absolute -left-[9999px] top-auto h-px w-px overflow-hidden"
      >
        <label htmlFor="captura-website">Website</label>
        <input
          id="captura-website"
          name="website"
          type="text"
          tabIndex={-1}
          autoComplete="off"
        />
      </div>

      <CampoLinha
        id="captura-nome"
        name="nome"
        label="Nome"
        autoComplete="name"
        required
        maxLength={MAX_TEXTO}
        defaultValue={estado.nome}
        erro={estado.erroNome}
        icone={<User size={20} strokeWidth={1.75} aria-hidden />}
      />

      <CampoLinha
        id="captura-telefone"
        name="telefone"
        label="WhatsApp"
        type="tel"
        inputMode="tel"
        autoComplete="tel"
        required
        maxLength={20}
        placeholder="(11) 91234-5678"
        ajuda={estado.erroTelefone ? undefined : "Com DDD."}
        defaultValue={estado.telefone}
        erro={estado.erroTelefone}
        icone={<Phone size={20} strokeWidth={1.75} aria-hidden />}
      />

      {estado.erro ? (
        <p role="alert" className={CAIXA_ERRO}>
          {estado.erro}
        </p>
      ) : null}

      <Button
        type="submit"
        size="lg"
        carregando={pendente}
        className={cn("mt-1 w-full", BOTAO_ESPERA_PREENCHER)}
      >
        {pendente ? "Enviando…" : "Enviar"}
      </Button>
    </form>
  );
}
