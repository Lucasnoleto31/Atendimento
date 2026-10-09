import {
  FUSO,
  formatarData,
  formatarTelefone,
  instante,
  tempoDesde,
} from "@/lib/format";

/** Até quantos dias a interação aparece contada ("há 12 dias"). */
const DIAS_CONTADOS = 30;
const DIA_MS = 24 * 60 * 60 * 1000;

/**
 * "hoje", "ontem", "há 12 dias" no último mês; depois disso, a data
 * (12/03/2025): "há 1234 dias" não diz nada a ninguém. antesDaData entra só
 * na frente da data, para a frase da ficha ("última interação em 12/03/2025").
 */
export function desdeQuando(iso: string, antesDaData = ""): string {
  const dias = Math.floor((Date.now() - instante(iso).getTime()) / DIA_MS);
  if (dias > DIAS_CONTADOS) return `${antesDaData}${formatarData(iso)}`;
  return tempoDesde(iso) ?? formatarData(iso);
}

const horaEMinuto = new Intl.DateTimeFormat("pt-BR", {
  timeZone: FUSO,
  hour: "numeric",
  minute: "2-digit",
  hourCycle: "h23",
});

/**
 * "07/10/2026 às 14h32", "07/10/2026 às 9h": a hora em texto do kit (bloco
 * 3), no fuso de Brasília. Hora cheia sai sem os minutos.
 */
export function dataEHora(valor: string): string {
  const partes = horaEMinuto.formatToParts(instante(valor));
  const h = partes.find((p) => p.type === "hour")?.value ?? "";
  const m = partes.find((p) => p.type === "minute")?.value ?? "00";
  return `${formatarData(valor)} às ${h}h${m === "00" ? "" : m}`;
}

/** Telefone guardado ou @ do Instagram, o que a pessoa tiver. */
export function contatoDe(
  telefone: string | null,
  instagram: string | null,
): string | null {
  if (telefone) return formatarTelefone(telefone);
  if (instagram) return `@${instagram}`;
  return null;
}
