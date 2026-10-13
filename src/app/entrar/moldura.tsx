import Link from "next/link";
import { ArrowLeft } from "lucide-react";
import { Marca } from "@/components/ui/marca";
import { FundoMalha } from "./fundo-malha";
import { LINK_VOLTAR } from "./estilos";

/**
 * Casca das telas de fora do app: o login e os passos dele (esqueci,
 * redefinir), o erro, o 404, "Acesso desativado" e o formulário público
 * /captura. O desenho é o de duas metades.
 *
 * Do desktop para cima (lg): à esquerda, metade da largura, o painel escuro
 * com o fundo de malha do kit e a marca no canto de cima, parado enquanto o
 * lado do formulário rola; à direita, no fundo da página, o título, a linha
 * de apoio e o formulário, centrados na vertical, com até 480px.
 *
 * Abaixo disso o painel vira uma faixa de 64px no topo, com a marca, e o
 * formulário vem logo embaixo, no alto da tela (kit, bloco 8): o teclado
 * cobre a metade de baixo, e com o bloco centrado o campo e o botão iam para
 * baixo dele. No tablet o bloco centraliza no que sobra da janela.
 *
 * O painel leva data-theme="dark": é escuro nos dois temas (a capa da ficha
 * padrão é escura), e os tokens dentro dele são os do tema escuro, sem cor
 * solta. Não tem texto além da marca, de propósito: o realce claro da malha
 * fica embaixo à esquerda, e texto ali passaria por cima do cinza claro.
 */
export function Moldura({
  titulo,
  descricao,
  voltar,
  secundaria,
  rodape,
  children,
}: {
  titulo: string;
  descricao?: React.ReactNode;
  /** Link "← …" acima do título; o rótulo diz para onde vai. */
  voltar?: { href: string; rotulo: string };
  /** Ação de contorno logo abaixo do botão principal, na largura toda. */
  secundaria?: React.ReactNode;
  /** Nota curta embaixo de tudo. */
  rodape?: React.ReactNode;
  children: React.ReactNode;
}) {
  return (
    <div className="flex flex-1 flex-col lg:flex-row">
      <header
        data-theme="dark"
        className="relative isolate shrink-0 overflow-hidden bg-fundo text-tinta lg:sticky lg:top-0 lg:h-dvh lg:w-1/2"
      >
        <FundoMalha />
        <div className="relative box-content flex h-[64px] items-center px-2 pt-[env(safe-area-inset-top)] md:px-3 lg:h-auto lg:px-6 lg:pt-6">
          <Marca />
        </div>
      </header>

      <main className="flex min-w-0 flex-1 flex-col px-2 pt-3 pb-4 md:items-center md:justify-center md:px-3 md:py-6 lg:px-6">
        <div className="w-full md:max-w-[480px]">
          {voltar ? (
            <div className="mb-2 flex items-center">
              <Link href={voltar.href} className={LINK_VOLTAR}>
                <ArrowLeft size={18} strokeWidth={1.75} aria-hidden />
                {voltar.rotulo}
              </Link>
            </div>
          ) : null}

          {/* Título grande no peso do corpo, como no desenho de referência:
              o 600 do papel pesava num título de boas-vindas. */}
          <h1 className="tipo-titulo-1 font-normal text-tinta">{titulo}</h1>
          {descricao ? (
            <p className="tipo-corpo mt-1 text-texto-2">{descricao}</p>
          ) : null}

          <div className="mt-4">{children}</div>

          {secundaria ? <div className="mt-1.5">{secundaria}</div> : null}

          {rodape ? (
            <div className="tipo-nota mt-3 text-texto-2">{rodape}</div>
          ) : null}
        </div>
      </main>
    </div>
  );
}
