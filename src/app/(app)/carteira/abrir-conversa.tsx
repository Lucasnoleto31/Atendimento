"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { MessageSquarePlus } from "lucide-react";
import { abrirConversaCliente } from "./actions";

/**
 * Cliente veio da corretora e ganhou telefone no cadastro, mas ainda não tem
 * atendimento: cria o lead e já entra na conversa.
 */
export function AbrirConversa({
  customerId,
  nome,
}: {
  customerId: string;
  nome: string;
}) {
  const [pendente, iniciar] = useTransition();
  const [erro, setErro] = useState<string | null>(null);
  const router = useRouter();

  return (
    <span className="inline-flex items-center">
      <button
        type="button"
        aria-label={`Abrir conversa com ${nome}`}
        title="Criar atendimento e abrir no chat"
        disabled={pendente}
        onClick={() => {
          setErro(null);
          iniciar(async () => {
            const resultado = await abrirConversaCliente(customerId);
            if (resultado.erro) setErro(resultado.erro);
            else if (resultado.leadId) {
              router.push(`/chat?lead=${resultado.leadId}`);
            }
          });
        }}
        className="inline-flex h-[40px] w-[40px] items-center justify-center rounded-md text-neutral-600 transition-colors duration-[120ms] hover:bg-neutral-100 hover:text-primary-600 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-primary-500 disabled:cursor-not-allowed disabled:text-neutral-300"
      >
        <MessageSquarePlus size={18} strokeWidth={1.5} aria-hidden />
      </button>
      {erro ? (
        <span role="alert" className="ml-0.5 text-xs text-danger">
          {erro}
        </span>
      ) : null}
    </span>
  );
}
