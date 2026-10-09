"use client";

import { useRef, useState, useTransition } from "react";
import { Button } from "@/components/ui/button";
import { Folha } from "./folha";
import { recusasDaCampanha, type RecusasDaCampanha } from "./actions";
import { numero } from "./regras";

/**
 * "40 recusadas" no cartão da campanha: o número vira botão e abre uma folha
 * com os motivos DESTA campanha, agrupados pelo texto do erro da Meta, com a
 * contagem e a data da última ("31 · mensagem não entregue · última em
 * 08/10/2026"). A leitura sai ao abrir (só leitura, até 1.000 recusas) e
 * de novo a cada abertura, para a folha nunca mostrar número velho.
 *
 * Reenviar para quem foi recusado não existe aqui: mexe no que vai para o
 * cliente e é decisão de regra, não de tela.
 */
export function BotaoRecusas({
  campanhaId,
  campanhaNome,
  total,
}: {
  campanhaId: string;
  campanhaNome: string;
  total: number;
}) {
  const [aberta, setAberta] = useState(false);
  const [resultado, setResultado] = useState<RecusasDaCampanha | null>(null);
  const [carregando, iniciarTransicao] = useTransition();

  function carregar() {
    iniciarTransicao(async () => {
      try {
        setResultado(await recusasDaCampanha(campanhaId));
      } catch {
        setResultado({
          erro: "A conexão não respondeu. Confira a internet e tente de novo.",
        });
      }
    });
  }

  function abrir() {
    setResultado(null);
    setAberta(true);
    carregar();
  }

  const rotulo = `${numero(total)} ${total === 1 ? "recusada" : "recusadas"}`;

  return (
    <>
      <button
        type="button"
        onClick={abrir}
        aria-haspopup="dialog"
        aria-label={`${rotulo} pela Meta em ${campanhaNome}: ver os motivos`}
        // Texto no meio da linha do número: a área de toque cresce por cima
        // e por baixo até 44px sem mudar o desenho (kit, bloco 7).
        className="relative rounded-celula text-erro underline-offset-4 transition-colors duration-[120ms] hover:underline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-tinta pointer-coarse:after:absolute pointer-coarse:after:-inset-x-0.5 pointer-coarse:after:-inset-y-[12px]"
      >
        {rotulo}
      </button>

      <Folha
        aberta={aberta}
        aoFechar={() => setAberta(false)}
        titulo="Recusas da Meta"
        apoio={campanhaNome}
      >
        <Conteudo
          resultado={resultado}
          carregando={carregando}
          tentarDeNovo={carregar}
        />
      </Folha>
    </>
  );
}

/**
 * O corpo da folha num contêiner fixo: o "Tentar de novo" some quando a
 * leitura recomeça, e o foco passa antes para o contêiner (não cai no
 * corpo do diálogo). A linha do total fica numa região viva montada desde
 * o começo, para o leitor de tela anunciar quando a lista chega.
 */
function Conteudo({
  resultado,
  carregando,
  tentarDeNovo,
}: {
  resultado: RecusasDaCampanha | null;
  carregando: boolean;
  tentarDeNovo: () => void;
}) {
  const regiao = useRef<HTMLDivElement>(null);
  const esperando = !resultado || (carregando && "erro" in resultado);
  const erro =
    !esperando && resultado && "erro" in resultado ? resultado.erro : null;
  const lista =
    !esperando && resultado && !("erro" in resultado) ? resultado : null;

  return (
    <div
      ref={regiao}
      tabIndex={-1}
      aria-busy={esperando || undefined}
      className="outline-none"
    >
      <div aria-live="polite">
        {lista === null ? null : lista.motivos.length === 0 ? (
          <p className="tipo-corpo text-texto-2">
            Nenhuma recusa registrada nesta campanha.
          </p>
        ) : (
          <p className="px-2 tipo-nota text-texto-2 tabular-nums">
            {lista.lidas < lista.total
              ? `As ${numero(lista.lidas)} recusas mais recentes de ${numero(lista.total)}, pelo texto da Meta.`
              : `${numero(lista.total)} ${lista.total === 1 ? "recusa" : "recusas"}, pelo texto da Meta.`}
          </p>
        )}
      </div>

      {esperando ? (
        // Esqueleto no formato da lista: três motivos.
        <div role="status" aria-label="Carregando as recusas">
          <ul className="overflow-hidden rounded-painel bg-cartao">
            {[0, 1, 2].map((i) => (
              <li key={i} className="group pl-2">
                <div className="flex min-h-[64px] flex-col justify-center gap-0.5 border-t border-fio py-1 pr-2 group-first:border-t-0">
                  <div className="h-[16px] w-[200px] max-w-full rounded-celula bg-fio motion-safe:animate-pulse" />
                  <div className="h-[12px] w-[120px] rounded-celula bg-fio motion-safe:animate-pulse" />
                </div>
              </li>
            ))}
          </ul>
        </div>
      ) : null}

      {erro !== null ? (
        <div className="flex flex-col items-start gap-1.5">
          <p role="alert" className="tipo-corpo text-erro">
            {erro}
          </p>
          <Button
            type="button"
            variant="secondary"
            onClick={() => {
              regiao.current?.focus({ preventScroll: true });
              tentarDeNovo();
            }}
            className="pointer-coarse:h-[44px]"
          >
            Tentar de novo
          </Button>
        </div>
      ) : null}

      {lista && lista.motivos.length > 0 ? (
        <>
          <ul className="mt-1 overflow-hidden rounded-painel bg-cartao">
            {lista.motivos.map((m) => (
              <li key={m.erro} className="group pl-2">
                <div className="flex min-h-[48px] items-start gap-1.5 border-t border-fio py-1 pr-2 group-first:border-t-0">
                  <span className="w-[40px] shrink-0 text-right tipo-destaque text-tinta tabular-nums">
                    {numero(m.total)}
                  </span>
                  <span className="min-w-0 flex-1">
                    <span className="block tipo-corpo break-words text-tinta">
                      {m.erro}
                    </span>
                    <span className="block tipo-nota text-texto-2 tabular-nums">
                      última em {m.ultima}
                    </span>
                  </span>
                </div>
              </li>
            ))}
          </ul>
          <p className="mt-1 px-2 tipo-nota text-texto-2">
            Quem foi recusado não entra de novo nesta campanha.
          </p>
        </>
      ) : null}
    </div>
  );
}
