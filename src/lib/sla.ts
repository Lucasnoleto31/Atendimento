/**
 * SLA de primeiro contato: quanto tempo um lead novo esperou até alguém da
 * mesa falar com ele. Arquivo puro (sem imports de servidor) — a Caixa lê
 * daqui, e a conta roda por LINHA da lista: precisa ser O(1).
 *
 * O relógio conta em horário de atendimento quando a régua manda: lead que
 * chega 22h começa a contar às 9h, senão a mesa amanhece toda vermelha.
 *
 * Brasília não tem horário de verão desde 2019 — o fuso é -03:00 fixo, e é
 * o que esta conta assume. Se voltar, aqui é o lugar de arrumar.
 */
export const SLA_PADRAO = {
  atencaoMin: 5,
  alarmeMin: 15,
  horarioComercial: true,
};

export const HORA_ABRE = 9;
export const HORA_FECHA = 18;
/** Só entra na régua quem chegou há pouco: base importada não é atraso. */
export const IDADE_MAXIMA_DIAS = 7;

const MIN = 60_000;
const DIA_MIN = 24 * 60;
const OFFSET_BR_MIN = -3 * 60;
const JANELA_MIN = (HORA_FECHA - HORA_ABRE) * 60;

export type ReguaSla = {
  atencaoMin: number;
  alarmeMin: number;
  horarioComercial: boolean;
};

export type EstadoSla = {
  situacao: "ok" | "atencao" | "alarme" | "respondido";
  minutos: number;
  rotulo: string;
};

/** Minutos de expediente acumulados desde a epoch até este instante. */
function expedienteAcumulado(ms: number): number {
  const local = Math.floor(ms / MIN) + OFFSET_BR_MIN;
  const dia = Math.floor(local / DIA_MIN);
  const minutoDoDia = local - dia * DIA_MIN;

  // 1970-01-01 foi quinta-feira (4). Dias úteis inteiros ANTES de hoje.
  const semanas = Math.floor(dia / 7);
  const resto = dia - semanas * 7;
  let uteisAntes = semanas * 5;
  for (let i = 0; i < resto; i++) {
    const ds = (4 + semanas * 7 + i) % 7;
    if (ds >= 1 && ds <= 5) uteisAntes++;
  }

  const diaSemana = (4 + dia) % 7;
  const hoje =
    diaSemana >= 1 && diaSemana <= 5
      ? Math.max(0, Math.min(JANELA_MIN, minutoDoDia - HORA_ABRE * 60))
      : 0;
  return uteisAntes * JANELA_MIN + hoje;
}

export function minutosDeEspera(
  de: string | Date,
  ate: Date,
  horarioComercial: boolean,
): number {
  const inicio = new Date(de).getTime();
  const fim = ate.getTime();
  if (!Number.isFinite(inicio) || fim <= inicio) return 0;
  if (!horarioComercial) return Math.floor((fim - inicio) / MIN);
  return Math.max(0, expedienteAcumulado(fim) - expedienteAcumulado(inicio));
}

function comoTexto(min: number): string {
  if (min < 60) return `${min} min`;
  const h = Math.floor(min / 60);
  if (h < 24) return `${h}h`;
  return `${Math.floor(h / 24)}d`;
}

/**
 * O estado de um lead na régua. `primeiroContatoEm` preenchido = alguém já
 * falou com ele; o cronômetro para aí. Lead velho (mais de uma semana) sai
 * da régua: atraso de meses é backlog, não SLA — e um selo vermelho
 * permanente vira ruído que ninguém mais lê.
 */
export function estadoSla(
  criadoEm: string,
  primeiroContatoEm: string | null,
  regua: ReguaSla,
  agora: Date,
): EstadoSla {
  if (primeiroContatoEm) {
    return { situacao: "respondido", minutos: 0, rotulo: "respondido" };
  }
  const idadeMs = agora.getTime() - new Date(criadoEm).getTime();
  if (
    !Number.isFinite(idadeMs) ||
    idadeMs > IDADE_MAXIMA_DIAS * 24 * 60 * MIN
  ) {
    return { situacao: "ok", minutos: 0, rotulo: "" };
  }
  const minutos = minutosDeEspera(criadoEm, agora, regua.horarioComercial);
  if (minutos >= regua.alarmeMin) {
    return {
      situacao: "alarme",
      minutos,
      rotulo: `${comoTexto(minutos)} sem contato`,
    };
  }
  if (minutos >= regua.atencaoMin) {
    return {
      situacao: "atencao",
      minutos,
      rotulo: `${comoTexto(minutos)} sem contato`,
    };
  }
  return {
    situacao: "ok",
    minutos,
    rotulo: `aguardando há ${comoTexto(minutos)}`,
  };
}
