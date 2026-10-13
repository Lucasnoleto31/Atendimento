"use client";

import { useRef, useState } from "react";
import { cn } from "@/lib/utils";

/*
 * Horário de pico: mensagens recebidas por dia da semana × hora de
 * Brasília, nas 4 semanas inteiras até ontem (cada célula soma quatro
 * ocorrências, nenhuma soma cinco). Mapa de calor na tinta, uma cor só do
 * claro ao escuro em seis degraus (o primeiro é o zero, no trilho).
 *
 * É uma tabela de verdade (role grid): o leitor de tela lê dia, hora e
 * número de cada célula, e as setas andam entre elas com o foco. Mouse,
 * toque e foco mostram a célula na linha de cima; sem nada escolhido, ela
 * diz o pico. No toque, a célula sai de baixo do dedo ao arrastar e ao
 * soltar (o toque prende os eventos na célula onde começou, então a busca
 * é por elementFromPoint); a rolagem vertical cancela o toque e a leitura
 * volta ao que era.
 */

const DIAS = [
  ["seg", "segunda"],
  ["ter", "terça"],
  ["qua", "quarta"],
  ["qui", "quinta"],
  ["sex", "sexta"],
  ["sáb", "sábado"],
  ["dom", "domingo"],
] as const;

const HORAS = Array.from({ length: 24 }, (_, h) => h);

/** Degraus da tinta: zero no trilho e cinco faixas até o maior valor. */
const NIVEIS = [
  "bg-tinta/4",
  "bg-tinta/15",
  "bg-tinta/30",
  "bg-tinta/50",
  "bg-tinta/75",
  "bg-tinta",
] as const;

function numero(n: number) {
  return n.toLocaleString("pt-BR");
}

function nivel(valor: number, maior: number) {
  if (valor <= 0 || maior <= 0) return 0;
  return Math.min(5, Math.ceil((valor / maior) * 5));
}

/** "das 10h às 11h", "da 0h à 1h", "das 23h à 0h". */
function faixaHora(h: number) {
  const proxima = (h + 1) % 24;
  return `${h <= 1 ? "da" : "das"} ${h}h ${proxima <= 1 ? "à" : "às"} ${proxima}h`;
}

function recebidas(n: number) {
  return `${numero(n)} ${n === 1 ? "recebida" : "recebidas"}`;
}

export function MapaCalor({
  celulas,
  de,
  ate,
}: {
  /** 7 × 24, segunda primeiro. */
  celulas: number[];
  /** "10/09" e "07/10": o começo e o fim das 4 semanas. */
  de: string;
  ate: string;
}) {
  const maior = Math.max(0, ...celulas);
  const pico = celulas.indexOf(maior);
  const [ativo, setAtivo] = useState<number | null>(null);
  // A célula que recebe o Tab (grade com foco itinerante): a última visitada.
  const [foco, setFoco] = useState(pico >= 0 ? pico : 0);
  const refs = useRef<(HTMLTableCellElement | null)[]>([]);
  // O toque em andamento (dedo ou caneta) e a célula que estava na leitura
  // antes dele, para voltar se o navegador assumir a rolagem.
  const toque = useRef<{ id: number; antes: number | null } | null>(null);

  if (maior === 0) {
    return (
      <p className="tipo-corpo text-texto-2">
        Nenhuma mensagem recebida no período.
      </p>
    );
  }

  const leitura =
    ativo === null
      ? `Pico: ${DIAS[Math.floor(pico / 24)][1]}, ${faixaHora(pico % 24)}, com ${recebidas(maior)}`
      : (() => {
          const nome = DIAS[Math.floor(ativo / 24)][1];
          return `${nome[0].toUpperCase()}${nome.slice(1)}, ${faixaHora(ativo % 24)}: ${recebidas(celulas[ativo])}`;
        })();

  function irPara(i: number) {
    setFoco(i);
    setAtivo(i);
    refs.current[i]?.focus();
  }

  /** A célula sob o dedo, pelo ponto da tela: o alvo do evento é sempre a
   *  célula onde o toque começou. Fora das células (no vão, fora da
   *  tabela) devolve null e a leitura fica onde estava. */
  function celulaNoPonto(e: React.PointerEvent<HTMLTableElement>) {
    const alvo = document
      .elementFromPoint(e.clientX, e.clientY)
      ?.closest<HTMLElement>("[data-celula]");
    if (!alvo || !e.currentTarget.contains(alvo)) return null;
    return Number(alvo.dataset.celula);
  }

  function aoTeclar(e: React.KeyboardEvent) {
    const linha = Math.floor(foco / 24);
    const hora = foco % 24;
    const destino =
      e.key === "ArrowRight"
        ? linha * 24 + Math.min(23, hora + 1)
        : e.key === "ArrowLeft"
          ? linha * 24 + Math.max(0, hora - 1)
          : e.key === "ArrowDown"
            ? Math.min(6, linha + 1) * 24 + hora
            : e.key === "ArrowUp"
              ? Math.max(0, linha - 1) * 24 + hora
              : e.key === "Home"
                ? linha * 24
                : e.key === "End"
                  ? linha * 24 + 23
                  : undefined;
    if (destino === undefined) return;
    e.preventDefault();
    irPara(destino);
  }

  return (
    <div>
      <p className="min-h-[36px] tipo-nota text-tinta tabular-nums @xl:min-h-[18px]">
        {leitura}
      </p>

      <table
        role="grid"
        aria-label={`Mensagens recebidas por dia da semana e hora, de ${de} a ${ate}`}
        onKeyDown={aoTeclar}
        onPointerOver={(e) => {
          // No toque a célula não troca ao encostar: quem encosta para rolar
          // a página não muda a leitura. Ela sai ao arrastar e ao soltar.
          if (e.pointerType !== "mouse") return;
          const alvo = (e.target as HTMLElement).closest<HTMLElement>(
            "[data-celula]",
          );
          if (alvo) setAtivo(Number(alvo.dataset.celula));
        }}
        onPointerDown={(e) => {
          if (e.pointerType === "mouse") return;
          toque.current = { id: e.pointerId, antes: ativo };
        }}
        onPointerMove={(e) => {
          if (toque.current?.id !== e.pointerId) return;
          const i = celulaNoPonto(e);
          if (i !== null) setAtivo(i);
        }}
        onPointerUp={(e) => {
          if (toque.current?.id !== e.pointerId) return;
          toque.current = null;
          const i = celulaNoPonto(e);
          if (i !== null) setAtivo(i);
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
        onBlur={(e) => {
          if (!e.currentTarget.contains(e.relatedTarget as Node | null)) {
            setAtivo(null);
          }
        }}
        className="mt-1 -mx-[2px] w-[calc(100%+4px)] table-fixed touch-pan-y touch-pinch-zoom border-separate border-spacing-[2px]"
      >
        <colgroup>
          <col className="w-[32px]" />
          {HORAS.map((h) => (
            <col key={h} />
          ))}
        </colgroup>
        <thead>
          <tr>
            <td />
            {HORAS.map((h) => (
              <th
                key={h}
                scope="col"
                className="overflow-visible p-0 text-left align-bottom font-normal whitespace-nowrap tipo-legenda-2 text-texto-2 tabular-nums"
              >
                {/* Rótulo à vista de 6 em 6 horas (de 3 em 3 com espaço);
                    o leitor de tela lê todos. */}
                <span
                  className={
                    h % 6 === 0
                      ? undefined
                      : h % 3 === 0
                        ? "sr-only @3xl:not-sr-only"
                        : "sr-only"
                  }
                >
                  {h}h
                </span>
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {DIAS.map(([curto, nome], linha) => (
            <tr key={curto}>
              <th
                scope="row"
                className="p-0 pr-0.5 text-left font-normal tipo-legenda text-texto-2"
              >
                <span aria-hidden>{curto}</span>
                <span className="sr-only">{nome}</span>
              </th>
              {HORAS.map((h) => {
                const i = linha * 24 + h;
                const valor = celulas[i];
                return (
                  <td
                    key={h}
                    ref={(el) => {
                      refs.current[i] = el;
                    }}
                    data-celula={i}
                    tabIndex={i === foco ? 0 : -1}
                    onFocus={() => {
                      setFoco(i);
                      setAtivo(i);
                    }}
                    className="rounded-[2px] p-0 focus-visible:outline-2 focus-visible:outline-offset-1 focus-visible:outline-tinta"
                  >
                    <span
                      aria-hidden
                      className={cn(
                        "block h-[20px] rounded-[2px] @3xl:h-[28px]",
                        NIVEIS[nivel(valor, maior)],
                        ativo === i &&
                          "outline-2 outline-offset-1 outline-tinta",
                      )}
                    />
                    <span className="sr-only">{numero(valor)}</span>
                  </td>
                );
              })}
            </tr>
          ))}
        </tbody>
      </table>

      {/* A escala: do zero ao maior valor, nos seis degraus. */}
      <div
        aria-hidden
        className="mt-1 flex items-center justify-end gap-0.5 tipo-legenda-2 text-texto-2 tabular-nums"
      >
        <span>0</span>
        {NIVEIS.map((n) => (
          <span key={n} className={cn("h-[8px] w-[12px] rounded-[2px]", n)} />
        ))}
        <span>{numero(maior)}</span>
      </div>
    </div>
  );
}
