"use client";

import { useId, useMemo, useRef, useState } from "react";

export type PontoLote = { data: string; quantidade: number };

const LARGURA = 640;
const ALTURA = 200;
const M = { topo: 8, direita: 8, base: 24, esquerda: 40 };

/**
 * Lotes girados por dia — série única.
 * Linha 2px em primary-500 (validada: contraste e croma ok sobre branco),
 * grade recessiva, crosshair com tooltip no hover e tabela de dados como
 * alternativa acessível.
 */
export function LotesChart({
  pontos,
  dias = 90,
}: {
  pontos: PontoLote[];
  dias?: number;
}) {
  const tituloId = useId();
  const svgRef = useRef<SVGSVGElement>(null);
  const [ativo, setAtivo] = useState<number | null>(null);

  const { caminho, area, escalaY, posicoes, maximo } = useMemo(() => {
    const larguraUtil = LARGURA - M.esquerda - M.direita;
    const alturaUtil = ALTURA - M.topo - M.base;
    const maximo = Math.max(1, ...pontos.map((p) => p.quantidade));

    const posicoes = pontos.map((p, i) => ({
      x:
        M.esquerda +
        (pontos.length === 1 ? larguraUtil / 2 : (i / (pontos.length - 1)) * larguraUtil),
      y: M.topo + alturaUtil - (p.quantidade / maximo) * alturaUtil,
      ...p,
    }));

    const caminho = posicoes
      .map((p, i) => `${i === 0 ? "M" : "L"}${p.x.toFixed(1)},${p.y.toFixed(1)}`)
      .join(" ");

    const baseY = M.topo + alturaUtil;
    const area =
      posicoes.length > 1
        ? `${caminho} L${posicoes[posicoes.length - 1].x.toFixed(1)},${baseY} L${posicoes[0].x.toFixed(1)},${baseY} Z`
        : "";

    const escalaY = [0, 0.5, 1].map((f) => ({
      valor: Math.round(maximo * f),
      y: M.topo + alturaUtil - f * alturaUtil,
    }));

    return { caminho, area, escalaY, posicoes, maximo };
  }, [pontos]);

  function aoMover(e: React.MouseEvent<SVGSVGElement>) {
    const svg = svgRef.current;
    if (!svg || posicoes.length === 0) return;
    const rect = svg.getBoundingClientRect();
    const x = ((e.clientX - rect.left) / rect.width) * LARGURA;
    let melhor = 0;
    let menor = Infinity;
    posicoes.forEach((p, i) => {
      const d = Math.abs(p.x - x);
      if (d < menor) {
        menor = d;
        melhor = i;
      }
    });
    setAtivo(melhor);
  }

  const dataCurta = (iso: string) =>
    new Date(`${iso}T12:00:00`).toLocaleDateString("pt-BR", {
      day: "2-digit",
      month: "2-digit",
    });

  if (pontos.length === 0 || maximo === 0) {
    return (
      <p className="rounded-md border border-neutral-200 bg-neutral-50 px-2 py-2 text-sm text-neutral-600">
        Nenhum lote registrado no período.
      </p>
    );
  }

  const pontoAtivo = ativo !== null ? posicoes[ativo] : null;

  return (
    <figure>
      <figcaption id={tituloId} className="text-sm font-medium text-neutral-800">
        Lotes girados por dia{" "}
        <span className="font-normal text-neutral-600">— últimos {dias} dias</span>
      </figcaption>

      <div className="relative mt-1">
        <svg
          ref={svgRef}
          viewBox={`0 0 ${LARGURA} ${ALTURA}`}
          role="img"
          aria-labelledby={tituloId}
          className="w-full"
          onMouseMove={aoMover}
          onMouseLeave={() => setAtivo(null)}
        >
          {/* grade recessiva */}
          {escalaY.map((linha) => (
            <g key={linha.y}>
              <line
                x1={M.esquerda}
                x2={LARGURA - M.direita}
                y1={linha.y}
                y2={linha.y}
                stroke="var(--color-neutral-200)"
                strokeWidth="1"
              />
              <text
                x={M.esquerda - 8}
                y={linha.y + 4}
                textAnchor="end"
                fontSize="11"
                fill="var(--color-neutral-600)"
                fontFamily="var(--font-mono)"
              >
                {linha.valor}
              </text>
            </g>
          ))}

          {/* eixo x: primeira, meio e última data */}
          {[0, Math.floor(posicoes.length / 2), posicoes.length - 1]
            .filter((v, i, arr) => arr.indexOf(v) === i)
            .map((i) => (
              <text
                key={i}
                x={posicoes[i].x}
                y={ALTURA - 6}
                textAnchor="middle"
                fontSize="11"
                fill="var(--color-neutral-600)"
                fontFamily="var(--font-mono)"
              >
                {dataCurta(posicoes[i].data)}
              </text>
            ))}

          {area ? (
            <path d={area} fill="var(--color-primary-50)" opacity="0.8" />
          ) : null}
          <path
            d={caminho}
            fill="none"
            stroke="var(--color-primary-500)"
            strokeWidth="2"
            strokeLinejoin="round"
            strokeLinecap="round"
          />

          {pontoAtivo ? (
            <g>
              <line
                x1={pontoAtivo.x}
                x2={pontoAtivo.x}
                y1={M.topo}
                y2={ALTURA - M.base}
                stroke="var(--color-neutral-300)"
                strokeWidth="1"
              />
              <circle
                cx={pontoAtivo.x}
                cy={pontoAtivo.y}
                r="4"
                fill="var(--color-primary-500)"
                stroke="var(--color-neutral-0)"
                strokeWidth="2"
              />
            </g>
          ) : null}
        </svg>

        {pontoAtivo ? (
          <div
            className="pointer-events-none absolute -translate-x-1/2 rounded-md border border-neutral-200 bg-neutral-0 px-1 py-0.5 shadow-md"
            style={{
              left: `${(pontoAtivo.x / LARGURA) * 100}%`,
              top: 0,
            }}
          >
            <p className="font-mono text-xs whitespace-nowrap text-neutral-600 tabular-nums">
              {dataCurta(pontoAtivo.data)}
            </p>
            <p className="font-mono text-sm font-medium whitespace-nowrap text-neutral-900 tabular-nums">
              {pontoAtivo.quantidade} lote(s)
            </p>
          </div>
        ) : null}
      </div>

      <details className="mt-1">
        <summary className="cursor-pointer text-xs text-neutral-600 hover:text-neutral-800">
          Ver dados em tabela
        </summary>
        <div className="mt-1 max-h-[200px] overflow-y-auto rounded-md border border-neutral-200">
          <table className="w-full border-collapse text-left">
            <thead>
              <tr className="border-b border-neutral-200 bg-neutral-50">
                <th className="px-1.5 py-0.5 text-xs tracking-[0.06em] text-neutral-600 uppercase">
                  Data
                </th>
                <th className="px-1.5 py-0.5 text-right text-xs tracking-[0.06em] text-neutral-600 uppercase">
                  Lotes
                </th>
              </tr>
            </thead>
            <tbody className="divide-y divide-neutral-200">
              {[...pontos]
                .reverse()
                .filter((p) => p.quantidade > 0)
                .map((p) => (
                  <tr key={p.data}>
                    <td className="px-1.5 py-0.5 font-mono text-xs text-neutral-600 tabular-nums">
                      {dataCurta(p.data)}
                    </td>
                    <td className="px-1.5 py-0.5 text-right font-mono text-xs text-neutral-800 tabular-nums">
                      {p.quantidade}
                    </td>
                  </tr>
                ))}
            </tbody>
          </table>
        </div>
      </details>
    </figure>
  );
}
