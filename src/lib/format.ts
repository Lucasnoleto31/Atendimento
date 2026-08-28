/** +55 11 98842-1170 a partir de 5511988421170. */
export function formatarTelefone(e164: string) {
  const d = e164.replace(/\D/g, "");
  const nacional = d.startsWith("55") ? d.slice(2) : d;
  const ddd = nacional.slice(0, 2);
  const numero = nacional.slice(2);

  if (numero.length === 9) {
    return `+55 ${ddd} ${numero.slice(0, 5)}-${numero.slice(5)}`;
  }
  if (numero.length === 8) {
    return `+55 ${ddd} ${numero.slice(0, 4)}-${numero.slice(4)}`;
  }
  return e164;
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
function instante(valor: string | Date): Date {
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
