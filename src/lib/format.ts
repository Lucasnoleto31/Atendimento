/**
 * Códigos de país de um e de dois dígitos (zonas do E.164 da UIT); o resto
 * do mundo usa três. Serve só para separar o código do número na exibição.
 */
const DDI_1 = new Set(["1", "7"]);
const DDI_2 = new Set([
  "20",
  "27",
  "30",
  "31",
  "32",
  "33",
  "34",
  "36",
  "39",
  "40",
  "41",
  "43",
  "44",
  "45",
  "46",
  "47",
  "48",
  "49",
  "51",
  "52",
  "53",
  "54",
  "55",
  "56",
  "57",
  "58",
  "60",
  "61",
  "62",
  "63",
  "64",
  "65",
  "66",
  "81",
  "82",
  "84",
  "86",
  "90",
  "91",
  "92",
  "93",
  "94",
  "95",
  "98",
]);

/**
 * +55 11 98842-1170 a partir de 5511988421170.
 *
 * Só é brasileiro o que começa com 55 e tem 12 ou 13 dígitos, que é o que
 * o normalizarTelefone grava. O wa_id de quem escreve de fora chega com o
 * código do país dele ("14155552671"), e tratar isso como DDD inventava um
 * "+55 14 15555-2671". Estrangeiro sai como +código e o número em blocos,
 * do fim para o começo (4, depois 3 em 3), sem fingir o formato do país.
 */
export function formatarTelefone(e164: string) {
  const d = e164.replace(/\D/g, "");
  if (!d) return e164;

  if (d.startsWith("55") && (d.length === 12 || d.length === 13)) {
    const ddd = d.slice(2, 4);
    const numero = d.slice(4);
    const corte = numero.length === 9 ? 5 : 4;
    return `+55 ${ddd} ${numero.slice(0, corte)}-${numero.slice(corte)}`;
  }

  const tamanhoDdi = DDI_1.has(d.slice(0, 1))
    ? 1
    : DDI_2.has(d.slice(0, 2))
      ? 2
      : 3;
  if (d.length <= tamanhoDdi + 4) return `+${d}`;
  const ddi = d.slice(0, tamanhoDdi);
  const resto = d.slice(tamanhoDdi);
  const blocos = [resto.slice(-4)];
  for (let fim = resto.length - 4; fim > 0; fim -= 3) {
    blocos.unshift(resto.slice(Math.max(0, fim - 3), fim));
  }
  return `+${ddi} ${blocos.join(" ")}`;
}

/** Centavos para R$ 1.340,00. */
export function formatarReais(centavos: number) {
  return new Intl.NumberFormat("pt-BR", {
    style: "currency",
    currency: "BRL",
  }).format(centavos / 100);
}

/** "hoje", "ontem", "há 4 dias". */
export function tempoDesde(iso: string | null) {
  if (!iso) return null;

  const dias = Math.floor(
    (Date.now() - new Date(iso).getTime()) / (1000 * 60 * 60 * 24),
  );

  if (dias <= 0) return "hoje";
  if (dias === 1) return "ontem";
  return `há ${dias} dias`;
}

// ===========================================================================
// Datas — sempre no fuso de Brasília
// ===========================================================================
// O banco guarda tudo em UTC (timestamptz), o que é o certo. Quem escolhe o
// fuso é a exibição — e "pt-BR" define só o formato (dd/mm/aaaa), não o
// fuso. Sem dizer timeZone, um Server Component renderiza no relógio do
// servidor: na Vercel isso é UTC, e a equipe vê hora 3h adiantada e o dia
// virando às 21h. Todo formato de data do CRM passa por aqui.

export const FUSO = "America/Sao_Paulo";

/** Brasil não tem mais horário de verão — o deslocamento é fixo. */
const DESLOCAMENTO = "-03:00";

const dia = new Intl.DateTimeFormat("pt-BR", { timeZone: FUSO });
const diaCurto = new Intl.DateTimeFormat("pt-BR", {
  timeZone: FUSO,
  day: "2-digit",
  month: "2-digit",
});
const hora = new Intl.DateTimeFormat("pt-BR", {
  timeZone: FUSO,
  hour: "2-digit",
  minute: "2-digit",
});
const diaHora = new Intl.DateTimeFormat("pt-BR", {
  timeZone: FUSO,
  day: "2-digit",
  month: "2-digit",
  hour: "2-digit",
  minute: "2-digit",
});

/**
 * Aceita instante (timestamptz) e data pura ("2026-08-18").
 * Data pura vira meio-dia: em qualquer fuso continua o mesmo dia.
 */
export function instante(valor: string | Date): Date {
  if (valor instanceof Date) return valor;
  return /^\d{4}-\d{2}-\d{2}$/.test(valor.trim())
    ? new Date(`${valor.trim()}T12:00:00`)
    : new Date(valor);
}

/** 18/08/2026 */
export function formatarData(valor: string | Date | null | undefined) {
  return valor ? dia.format(instante(valor)) : "—";
}

/** 18/08 */
export function formatarDataCurta(valor: string | Date | null | undefined) {
  return valor ? diaCurto.format(instante(valor)) : "—";
}

/** 18/08, 14:32 */
export function formatarDataHora(valor: string | Date | null | undefined) {
  return valor ? diaHora.format(instante(valor)) : "—";
}

const diaHoraCompleta = new Intl.DateTimeFormat("pt-BR", {
  timeZone: FUSO,
  day: "2-digit",
  month: "2-digit",
  year: "numeric",
  hour: "2-digit",
  minute: "2-digit",
});

/**
 * 07/10/2026 10:05, em Brasília e com o ano: para arquivo exportado, que é
 * lido fora da tela e cruza a virada do ano. Sem a vírgula do Intl, para o
 * Excel brasileiro ler a célula como data e hora.
 */
export function formatarDataHoraCompleta(
  valor: string | Date | null | undefined,
) {
  if (!valor) return "";
  const partes = diaHoraCompleta.formatToParts(instante(valor));
  const pegar = (tipo: Intl.DateTimeFormatPartTypes) =>
    partes.find((p) => p.type === tipo)?.value ?? "";
  return `${pegar("day")}/${pegar("month")}/${pegar("year")} ${pegar("hour")}:${pegar("minute")}`;
}

/** Hora no dia de hoje, data nos dias anteriores — para listas densas. */
export function horaOuData(valor: string | Date | null | undefined) {
  if (!valor) return "";
  const alvo = instante(valor);
  return dia.format(alvo) === dia.format(new Date())
    ? hora.format(alvo)
    : diaCurto.format(alvo);
}

/** Agora em Brasília: dia, hora cheia e se é fim de semana. */
export function agoraEmBrasilia(referencia = new Date()) {
  const partes = new Intl.DateTimeFormat("en-CA", {
    timeZone: FUSO,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
    weekday: "short",
  }).formatToParts(referencia);

  const pegar = (tipo: string) =>
    partes.find((p) => p.type === tipo)?.value ?? "";

  const data = `${pegar("year")}-${pegar("month")}-${pegar("day")}`;
  const semana = pegar("weekday");

  return {
    dia: data,
    hora: Number(pegar("hour")),
    // Campo aditivo (7.2): o resumo do gestor dispara às 18h30 — hora
    // inteira não bastava. Os campos existentes não mudam.
    minuto: Number(pegar("minute")),
    fimDeSemana: semana === "Sat" || semana === "Sun",
    inicioDoDia: `${data}T00:00:00${DESLOCAMENTO}`,
  };
}

/** Data de hoje em Brasília, em aaaa-mm-dd — para referências e filtros. */
export function hojeEmBrasilia(): string {
  return agoraEmBrasilia().dia;
}
