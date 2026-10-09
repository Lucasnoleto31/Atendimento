"use client";

import { useRef, useState } from "react";
import { cn } from "@/lib/utils";
import type { DiaGrafico } from "./dados";

/*
 * Recebidas e enviadas pela equipe nos últimos 30 dias, em colunas
 * espelhadas: o que chega sobe, o que sai desce, as duas na mesma escala
 * (um eixo só; a comparação de um dia é a altura de cima contra a de baixo).
 * Tinta cheia para as recebidas, tinta a 45% para as enviadas (cor por
 * intensidade, kit bloco 5), trilho a 4% atrás de cada coluna para o dia sem
 * mensagem continuar ocupando o lugar.
 *
 * Passar o mouse, tocar ou andar com as setas (com o foco no gráfico) mostra
 * o dia na linha de cima; sem nada escolhido ela mostra hoje. No toque, o
 * dedo arrastado de lado mostra o dia que está embaixo dele e o dia fica
 * escolhido ao soltar; a rolagem vertical que começa no gráfico cancela o
 * toque e a leitura volta ao que era. A tabela escondida traz os 30 dias
 * para o leitor de tela.
 */

/** Dias com rótulo no eixo, além de hoje (o último). */
const MARCAS = [0, 7, 14, 21];

function numero(n: number) {
  return n.toLocaleString("pt-BR");
}

/** Topo da escala num número redondo e perto do maior valor, para a coluna
 *  mais alta quase encher a metade: 187 → 200, 250 → 250, 1.340 → 1.500. */
function topoDaEscala(maior: number) {
  if (maior <= 10) return Math.max(1, Math.ceil(maior));
  const ordem = 10 ** Math.floor(Math.log10(maior));
  const passo =
    [1, 1.2, 1.5, 2, 2.5, 3, 4, 5, 6, 8, 10].find((p) => maior <= p * ordem) ??
    10;
  return Math.round(passo * ordem);
}

/** Altura da coluna: 2px no mínimo para o dia que teve alguma mensagem. */
function altura(valor: number | null, topo: number) {
  if (!valor) return "0px";
  return `max(2px, ${(valor / topo) * 100}%)`;
}

function media(valores: (number | null)[]) {
  const validos = valores.filter((v): v is number => v !== null);
  if (validos.length === 0) return null;
  return Math.round(validos.reduce((s, v) => s + v, 0) / validos.length);
}

export function GraficoDias({
  dias,
  agoraHora,
}: {
  dias: DiaGrafico[];
  /** "14h32": até onde vai a coluna de hoje. */
  agoraHora: string;
}) {
  const [ativo, setAtivo] = useState<number | null>(null);
  const area = useRef<HTMLDivElement>(null);
  // O toque em andamento (dedo ou caneta) e o dia que estava na leitura
  // antes dele, para voltar se o navegador assumir a rolagem.
  const toque = useRef<{ id: number; antes: number | null } | null>(null);
  const ultimo = dias.length - 1;
  const temEnviadas = dias.some((d) => d.enviadas !== null);
  const topo = topoDaEscala(
    Math.max(0, ...dias.map((d) => Math.max(d.recebidas, d.enviadas ?? 0))),
  );

  // Média pelos dias completos: hoje ainda não acabou e puxaria para baixo.
  const completos = dias.slice(0, ultimo);
  const mediaRecebidas = media(completos.map((d) => d.recebidas));
  const mediaEnviadas = media(completos.map((d) => d.enviadas));

  const mostrado = ativo ?? ultimo;
  const dia = dias[mostrado];
  const quando =
    mostrado === ultimo
      ? `Hoje, até ${agoraHora}`
      : `${dia.semana[0].toUpperCase()}${dia.semana.slice(1)}, ${dia.rotulo}`;
  const leitura = `${quando}: ${numero(dia.recebidas)} ${
    dia.recebidas === 1 ? "recebida" : "recebidas"
  }${
    temEnviadas
      ? ` · ${dia.enviadas === null ? "—" : numero(dia.enviadas)} ${
          dia.enviadas === 1 ? "enviada" : "enviadas"
        } pela equipe`
      : ""
  }`;

  function diaNoPonto(clientX: number) {
    const caixa = area.current?.getBoundingClientRect();
    if (!caixa || caixa.width === 0) return null;
    const i = Math.floor(((clientX - caixa.left) / caixa.width) * dias.length);
    return Math.min(ultimo, Math.max(0, i));
  }

  function aoTeclar(e: React.KeyboardEvent) {
    const atual = ativo ?? ultimo;
    const proximo =
      e.key === "ArrowLeft" || e.key === "ArrowDown"
        ? Math.max(0, atual - 1)
        : e.key === "ArrowRight" || e.key === "ArrowUp"
          ? Math.min(ultimo, atual + 1)
          : e.key === "Home"
            ? 0
            : e.key === "End"
              ? ultimo
              : undefined;
    if (proximo === undefined) {
      if (e.key === "Escape") setAtivo(null);
      return;
    }
    e.preventDefault();
    setAtivo(proximo);
  }

  return (
    <div>
      <ul className="flex flex-wrap gap-x-3 gap-y-0.5 tipo-nota text-texto-2">
        <li className="flex items-center gap-0.5">
          <span aria-hidden className="h-[8px] w-[8px] rounded-[2px] bg-tinta" />
          <span>
            <span className="font-semibold text-tinta tabular-nums">
              {mediaRecebidas === null ? "—" : numero(mediaRecebidas)}
            </span>{" "}
            recebidas por dia em média
          </span>
        </li>
        {temEnviadas ? (
          <li className="flex items-center gap-0.5">
            <span
              aria-hidden
              className="h-[8px] w-[8px] rounded-[2px] bg-tinta/45"
            />
            <span>
              <span className="font-semibold text-tinta tabular-nums">
                {mediaEnviadas === null ? "—" : numero(mediaEnviadas)}
              </span>{" "}
              enviadas pela equipe por dia em média
            </span>
          </li>
        ) : null}
      </ul>

      {/* Sem aria-live: com o foco no gráfico, o leitor de tela já lê o
          dia pelo aria-valuetext; o anúncio aqui sairia em dobro. */}
      <p className="mt-1 min-h-[36px] tipo-nota text-tinta tabular-nums @xl:min-h-[18px]">
        {leitura}
      </p>

      <div className="mt-1 flex gap-0.5">
        {/* Escala: o topo das duas metades. A tabela escondida tem os
            números de cada dia. */}
        <div
          aria-hidden
          className="flex w-[32px] shrink-0 flex-col justify-between pb-[22px] text-right tipo-legenda-2 text-texto-2 tabular-nums"
        >
          <span className="-mt-[2px]">{numero(topo)}</span>
          <span className="-mb-[2px]">{numero(topo)}</span>
        </div>

        <div className="min-w-0 flex-1">
          <div
            ref={area}
            role="slider"
            tabIndex={0}
            aria-label="Dia do gráfico de mensagens"
            aria-valuemin={1}
            aria-valuemax={dias.length}
            aria-valuenow={mostrado + 1}
            aria-valuetext={leitura}
            onKeyDown={aoTeclar}
            // No toque o dia não troca ao encostar: quem encosta para rolar a
            // página não muda a leitura. O dia sai ao arrastar e ao soltar.
            onPointerDown={(e) => {
              if (e.pointerType === "mouse") return;
              toque.current = { id: e.pointerId, antes: ativo };
            }}
            onPointerMove={(e) => {
              if (
                e.pointerType === "mouse" ||
                toque.current?.id === e.pointerId
              ) {
                setAtivo(diaNoPonto(e.clientX));
              }
            }}
            onPointerUp={(e) => {
              if (toque.current?.id !== e.pointerId) return;
              toque.current = null;
              setAtivo(diaNoPonto(e.clientX));
            }}
            // O navegador assumiu a rolagem (touch-pan-y): volta a leitura de
            // antes do toque.
            onPointerCancel={(e) => {
              if (toque.current?.id !== e.pointerId) return;
              setAtivo(toque.current.antes);
              toque.current = null;
            }}
            onPointerLeave={(e) => {
              if (e.pointerType === "mouse") setAtivo(null);
            }}
            className="relative grid touch-pan-y touch-pinch-zoom grid-cols-[repeat(30,minmax(0,1fr))] gap-x-[2px] rounded-celula focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-tinta"
          >
            {dias.map((d, i) => (
              <div
                key={i}
                aria-hidden
                className={cn(
                  "flex flex-col items-center rounded-[2px] transition-colors duration-[120ms]",
                  ativo === i && "bg-realce",
                )}
              >
                <div className="flex h-[72px] w-full max-w-[24px] items-end bg-tinta/4 @3xl:h-[96px]">
                  <span
                    className="block w-full rounded-t-[2px] bg-tinta"
                    style={{ height: altura(d.recebidas, topo) }}
                  />
                </div>
                <div className="h-[3px]" />
                <div className="flex h-[72px] w-full max-w-[24px] items-start bg-tinta/4 @3xl:h-[96px]">
                  <span
                    className="block w-full rounded-b-[2px] bg-tinta/45"
                    style={{ height: altura(d.enviadas, topo) }}
                  />
                </div>
              </div>
            ))}
            {/* A linha de base, no meio do vão entre as metades. */}
            <span
              aria-hidden
              className="pointer-events-none absolute inset-x-0 top-[73px] h-px bg-fio-forte @3xl:top-[97px]"
            />
          </div>

          <div
            aria-hidden
            className="mt-0.5 grid h-[18px] grid-cols-[repeat(30,minmax(0,1fr))] tipo-legenda-2 whitespace-nowrap text-texto-2 tabular-nums"
          >
            {MARCAS.map((i) => (
              <span
                key={i}
                style={{ gridColumn: i + 1, gridRow: 1 }}
                className={i === 0 ? "justify-self-start" : "justify-self-center"}
              >
                {dias[i]?.rotulo}
              </span>
            ))}
            <span
              style={{ gridColumn: dias.length, gridRow: 1 }}
              className="justify-self-end"
            >
              hoje
            </span>
          </div>
        </div>
      </div>

      {/* O sr-only vai num div: tabela não encolhe para 1px (largura de
          tabela segue o conteúdo) e, solta, empurrava a página 14px para o
          lado no celular. */}
      <div className="sr-only">
        <table>
          <caption>Mensagens por dia nos últimos {dias.length} dias</caption>
          <thead>
            <tr>
              <th scope="col">Dia</th>
              <th scope="col">Recebidas</th>
              {temEnviadas ? <th scope="col">Enviadas pela equipe</th> : null}
            </tr>
          </thead>
          <tbody>
            {dias.map((d, i) => (
              <tr key={i}>
                <th scope="row">
                  {i === ultimo ? `hoje, até ${agoraHora}` : `${d.semana}, ${d.rotulo}`}
                </th>
                <td>{numero(d.recebidas)}</td>
                {temEnviadas ? (
                  <td>{d.enviadas === null ? "—" : numero(d.enviadas)}</td>
                ) : null}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}
