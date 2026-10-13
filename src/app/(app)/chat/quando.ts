import { normalizarHora } from "@/lib/automaticas";

/**
 * Datas e horas do adiar e do recontato, sempre no fuso de Brasília. Módulo
 * puro: a tela monta as opções ("Amanhã às 9h") e o servidor confere o que
 * chegou com as mesmas funções. O Brasil não tem horário de verão desde
 * 2019: o -03:00 é fixo (a mesma conta de lib/format.ts).
 */

const DESLOCAMENTO = "-03:00";

const FORMATO_PARTES = new Intl.DateTimeFormat("en-CA", {
  timeZone: "America/Sao_Paulo",
  year: "numeric",
  month: "2-digit",
  day: "2-digit",
  hour: "2-digit",
  minute: "2-digit",
  hourCycle: "h23",
});

const SEMANA = ["dom", "seg", "ter", "qua", "qui", "sex", "sáb"];
const DIA_MS = 86_400_000;

// As duas de baixo repetem as de chat/mensagem.ts de propósito: mensagem.ts
// lê os recontatos por recontato.ts, que usa este módulo, e importar de lá
// fecharia um ciclo.

/** "AAAA-MM-DD" de hoje no fuso de Brasília. */
export function hojeEmBrasilia(agora: Date = new Date()): string {
  return partesEmBrasilia(agora).dia;
}

/** O dia `n` dias depois (ou antes, negativo) de "AAAA-MM-DD". */
export function somarDias(dia: string, n: number): string {
  return new Date(Date.parse(`${dia}T00:00:00Z`) + n * DIA_MS)
    .toISOString()
    .slice(0, 10);
}

/** O dia ("AAAA-MM-DD") e a hora ("HH:MM") de um instante, em Brasília. */
export function partesEmBrasilia(valor: string | number | Date): {
  dia: string;
  hora: string;
} {
  const partes = FORMATO_PARTES.formatToParts(new Date(valor));
  const pegar = (tipo: Intl.DateTimeFormatPartTypes) =>
    partes.find((p) => p.type === tipo)?.value ?? "00";
  return {
    dia: `${pegar("year")}-${pegar("month")}-${pegar("day")}`,
    hora: `${pegar("hour")}:${pegar("minute")}`,
  };
}

/**
 * O instante (ISO) de um dia e uma hora de Brasília. null quando o dia não
 * existe no calendário ou a hora está fora do formato.
 */
export function instanteEmBrasilia(dia: string, hora: string): string | null {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(dia)) return null;
  const h = normalizarHora(hora);
  if (!h) return null;
  const t = Date.parse(`${dia}T${h}:00${DESLOCAMENTO}`);
  if (Number.isNaN(t)) return null;
  // 2026-02-30 vira 02/03 no Date: o dia tem de voltar igual.
  if (partesEmBrasilia(t).dia !== dia) return null;
  return new Date(t).toISOString();
}

/** "9h", "9h05", "18h30" a partir de "HH:MM". */
export function horaEmTexto(hora: string): string {
  const [h, m] = hora.split(":");
  const horas = Number(h);
  return !m || m === "00" ? `${horas}h` : `${horas}h${m}`;
}

/** "12/10", com o ano quando não é o de `hoje` ("12/10/2027"). */
export function diaEmTexto(dia: string, hoje: string): string {
  const [a, m, d] = dia.split("-");
  return a === hoje.slice(0, 4) ? `${d}/${m}` : `${d}/${m}/${a}`;
}

/** "sex, 10/10": o dia da semana ajuda a ver que amanhã é sábado. */
export function diaComSemana(dia: string, hoje: string): string {
  const semana = SEMANA[new Date(`${dia}T12:00:00Z`).getUTCDay()];
  return `${semana}, ${diaEmTexto(dia, hoje)}`;
}

/**
 * "hoje às 9h", "amanhã às 15h30", "ontem às 9h" ou "12/10 às 9h": o
 * quando por extenso, para aviso, faixa e nota. `hoje` em "AAAA-MM-DD".
 */
export function quandoEmTexto(iso: string, hoje: string = hojeEmBrasilia()): string {
  const { dia, hora } = partesEmBrasilia(iso);
  const as = `às ${horaEmTexto(hora)}`;
  if (dia === hoje) return `hoje ${as}`;
  if (dia === somarDias(hoje, 1)) return `amanhã ${as}`;
  if (dia === somarDias(hoje, -1)) return `ontem ${as}`;
  return `${diaEmTexto(dia, hoje)} ${as}`;
}

/** "12/10 às 9h", sem hoje nem amanhã: para o que fica gravado no
 *  histórico, que vai ser lido em outro dia. */
export function dataEHoraEmTexto(iso: string, hoje: string = hojeEmBrasilia()): string {
  const { dia, hora } = partesEmBrasilia(iso);
  return `${diaEmTexto(dia, hoje)} às ${horaEmTexto(hora)}`;
}

/** "09/10/2026" (a chave de dia que o chat já carrega) → "2026-10-09". */
export function diaDaChave(chave: string): string {
  const m = /^(\d{2})\/(\d{2})\/(\d{4})$/.exec(chave);
  return m ? `${m[3]}-${m[2]}-${m[1]}` : hojeEmBrasilia();
}

/** A hora em "HH:MM" que vale, com a reserva quando a gravada veio torta. */
export function horaValida(hora: string | null | undefined, reserva = "09:00"): string {
  return (hora && normalizarHora(hora)) || reserva;
}
