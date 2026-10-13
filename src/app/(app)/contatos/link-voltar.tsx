"use client";

import Link from "next/link";
import { ArrowLeft } from "lucide-react";
import { useRastro, useVoltarPeloHistorico } from "./rastro";

/**
 * O "← …" do topo das subpáginas de contato, acima do título, como a barra
 * do iOS (kit, bloco 7). Fica no conteúdo, não na navegação: no celular é a
 * saída à vista. O texto diz para onde vai ("Contatos", "Ficha do contato",
 * "Voltar à conversa"). A área de toque passa de 44px sem empurrar o título:
 * a margem negativa devolve o que a altura acrescenta.
 *
 * Quando a entrada anterior do histórico é o próprio destino (a lista que
 * abriu a ficha), o clique volta pelo histórico (rastro.ts): a lista reaparece
 * no ponto em que estava, e o voltar do sistema não cai de novo na ficha. Se
 * a ficha mudou o contato (etiqueta, responsável), a lista relê ao montar.
 * Montado, ele também grava a passagem por esta tela no rastro.
 */
export function LinkVoltar({
  href,
  rotulo,
}: {
  href: string;
  rotulo: string;
}) {
  useRastro(href);
  const voltar = useVoltarPeloHistorico(href);
  return (
    <Link
      href={href}
      onClick={voltar}
      className="-my-1 -ml-1 inline-flex h-[40px] items-center gap-0.5 rounded-controle px-1 tipo-corpo text-texto-2 transition-colors duration-[120ms] hover:bg-realce hover:text-tinta active:bg-pressionado focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-tinta pointer-coarse:h-[44px]"
    >
      <ArrowLeft size={18} strokeWidth={1.75} aria-hidden />
      {rotulo}
    </Link>
  );
}
