"use client";

import { useOptimistic, useTransition } from "react";
import { useRouter } from "next/navigation";
import { cn } from "@/lib/utils";
import { Segmentado } from "@/components/ui/segmentado";
import { useComandosDaTela } from "@/components/app/paleta-global";
import {
  PERIODOS,
  hrefPeriodo,
  rotuloPeriodo,
  tituloPeriodo,
  type Periodo,
} from "./periodo";

/**
 * A seção do período: o título (do servidor), as pílulas "Hoje · 7 dias ·
 * 30 dias" e os números embaixo (também do servidor, como filhos). A
 * escolha vai para a URL com push (o voltar do navegador volta ao período
 * anterior) e sem rolar a página para o topo: quem trocou o período estava
 * olhando esta seção. Na paleta (⌘K), um comando por período.
 *
 * O servidor leva de 1 a 3 s para refazer as leituras: a pílula escolhida
 * acende na hora (useOptimistic) e o título e os números ficam esmaecidos,
 * com aria-busy, até a resposta chegar, como no filtro do Log de acesso. As
 * setas do teclado andam a partir da pílula acesa, não do período velho, e
 * pedir de novo o mesmo período não empilha outra entrada no histórico.
 */
export function SecaoPeriodo({
  periodo,
  titulo,
  children,
}: {
  periodo: Periodo;
  titulo: React.ReactNode;
  children: React.ReactNode;
}) {
  const router = useRouter();
  const [mudando, iniciar] = useTransition();
  // O último período pedido; volta a ser o da URL quando a troca termina
  // (ou quando o voltar do navegador muda o período por fora).
  const [pedido, pedir] = useOptimistic(periodo);

  const ir = (p: Periodo) => {
    if (p === pedido) return;
    iniciar(() => {
      pedir(p);
      router.push(hrefPeriodo(p), { scroll: false });
    });
  };

  useComandosDaTela(
    PERIODOS.filter((p) => p !== pedido).map((p) => ({
      id: `relatorio-periodo-${p}`,
      rotulo: `Período: ${rotuloPeriodo(p)}`,
      grupo: "Relatório",
      executar: () => ir(p),
    })),
  );

  const esmaecido = cn(
    "transition-opacity duration-[120ms]",
    mudando && "opacity-60",
  );

  return (
    <>
      <section
        aria-labelledby="mes-titulo"
        aria-busy={mudando || undefined}
        className="mt-6"
      >
        <div className="flex flex-wrap items-center justify-between gap-x-2 gap-y-1">
          <div className={cn("min-w-0", esmaecido)}>{titulo}</div>
          <Segmentado
            rotulo="Período"
            tamanho="sm"
            valor={pedido}
            onMudar={ir}
            opcoes={PERIODOS.map((p) => ({ valor: p, rotulo: rotuloPeriodo(p) }))}
          />
        </div>
        <div className={esmaecido}>{children}</div>
      </section>
      {/* Fora da seção: o aria-busy dela seguraria o anúncio. */}
      <p role="status" className="sr-only">
        {mudando
          ? `Carregando ${pedido === "hoje" ? "os números de hoje" : `os números dos ${tituloPeriodo(pedido).toLowerCase()}`}…`
          : ""}
      </p>
    </>
  );
}
