/**
 * Respostas automáticas, no jeito do WhatsApp Business: quem escreve fora do
 * horário recebe um aviso, e o contato novo pode receber boas-vindas.
 *
 * A configuração mora em settings, em três chaves (jsonb):
 *   horario_atendimento       { dias: [1..5], inicio: "09:00", fim: "18:00" }
 *                             (0 é domingo; hora de Brasília)
 *   resposta_fora_do_horario  { ativo, texto }
 *   resposta_boas_vindas      { ativo, texto }
 * Sem linha na tabela, vale o padrão daqui: as duas respostas nascem
 * desligadas.
 *
 * Módulo puro, sem nada que só rode no servidor: Configurações monta a
 * prévia com as mesmas funções que o webhook usa para mandar
 * (webhooks/automaticas.ts), e o chat lê daqui a marca da bolha.
 */

export type TipoAutomatica = "fora_do_horario" | "boas_vindas";

export const TIPOS_AUTOMATICA: readonly TipoAutomatica[] = [
  "fora_do_horario",
  "boas_vindas",
];

export function ehTipoAutomatica(valor: unknown): valor is TipoAutomatica {
  return (TIPOS_AUTOMATICA as readonly unknown[]).includes(valor);
}

export type HorarioAtendimento = {
  /** Dias da semana do atendimento, 0 = domingo. */
  dias: number[];
  /** "09:00", em Brasília. */
  inicio: string;
  /** "18:00", em Brasília; sempre depois do início. */
  fim: string;
};

export type RespostaAutomatica = { ativo: boolean; texto: string };

export const CHAVE_HORARIO = "horario_atendimento";

export const CHAVE_RESPOSTA: Record<TipoAutomatica, string> = {
  fora_do_horario: "resposta_fora_do_horario",
  boas_vindas: "resposta_boas_vindas",
};

export const HORARIO_PADRAO: HorarioAtendimento = {
  dias: [1, 2, 3, 4, 5],
  inicio: "09:00",
  fim: "18:00",
};

/** O que vira o horário por extenso na hora de mandar. */
export const MARCADOR_HORARIO = "{horario}";

export const TEXTO_PADRAO: Record<TipoAutomatica, string> = {
  fora_do_horario:
    "Oi! Recebemos sua mensagem. Nosso atendimento é {horario}, e respondemos assim que voltarmos.",
  boas_vindas: "Oi! Recebemos sua mensagem e já vamos responder.",
};

/**
 * Teto do texto que sai, já com o horário trocado. O WhatsApp aceita 4.096,
 * mas o Direct do Instagram recusa texto acima de 1.000: vale o menor, para
 * a mesma resposta servir aos dois canais.
 */
export const LIMITE_TEXTO = 1000;

/**
 * No máximo uma resposta automática por contato nesse intervalo, somando as
 * duas: quem recebeu as boas-vindas às 17h59 não recebe a de fora do horário
 * às 18h01.
 */
export const INTERVALO_ENTRE_AUTOMATICAS_MS = 12 * 3_600_000;

/**
 * A resposta fica em lead_interactions como nota (e não mensagem_enviada,
 * que a Caixa e o relatório leem como resposta da equipe), com
 * metadados.automatica. O via vai junto porque é o campo que a bolha do
 * chat recebe dos metadados (paraMensagem, em chat/mensagem.ts).
 */
export const VIA_AUTOMATICA: Record<TipoAutomatica, string> = {
  fora_do_horario: "resposta_fora_do_horario",
  boas_vindas: "resposta_boas_vindas",
};

/** A resposta automática pelo via da nota; null para qualquer outro. */
export function tipoAutomaticaDaVia(
  via: string | null | undefined,
): TipoAutomatica | null {
  if (via === VIA_AUTOMATICA.fora_do_horario) return "fora_do_horario";
  if (via === VIA_AUTOMATICA.boas_vindas) return "boas_vindas";
  return null;
}

/** Como a marca da bolha chama cada uma ("Automático · fora do horário"). */
export const ROTULO_AUTOMATICA: Record<TipoAutomatica, string> = {
  fora_do_horario: "fora do horário",
  boas_vindas: "boas-vindas",
};

// ─────────────────────────── leitura de settings ───────────────────────────

const HORA = /^([01]\d|2[0-3]):([0-5]\d)$/;

/** "9:00", "09:00" ou "09:00:00" (o campo de hora com segundos) → "09:00". */
export function normalizarHora(bruta: string): string | null {
  const m = /^(\d{1,2}):(\d{2})(?::\d{2})?$/.exec(bruta.trim());
  if (!m) return null;
  const hora = `${m[1].padStart(2, "0")}:${m[2]}`;
  return HORA.test(hora) ? hora : null;
}

function minutosDe(hora: string): number {
  const [h, m] = hora.split(":").map(Number);
  return h * 60 + m;
}

/** Dias válidos, sem repetição, na ordem de 0 a 6. */
export function normalizarDias(brutos: unknown[]): number[] {
  const dias = new Set<number>();
  for (const bruto of brutos) {
    const n = typeof bruto === "number" ? bruto : Number(bruto);
    if (Number.isInteger(n) && n >= 0 && n <= 6) dias.add(n);
  }
  return [...dias].sort((a, b) => a - b);
}

/**
 * O horário gravado, ou o padrão quando falta ou veio torto (sem dia, hora
 * fora do formato, fim antes do início). Gravado torto não pode deixar o
 * webhook achando que é sempre fora do horário.
 */
export function lerHorario(valor: unknown): HorarioAtendimento {
  if (!valor || typeof valor !== "object") return HORARIO_PADRAO;
  const v = valor as { dias?: unknown; inicio?: unknown; fim?: unknown };
  const dias = Array.isArray(v.dias) ? normalizarDias(v.dias) : [];
  const inicio = typeof v.inicio === "string" ? normalizarHora(v.inicio) : null;
  const fim = typeof v.fim === "string" ? normalizarHora(v.fim) : null;
  if (dias.length === 0 || !inicio || !fim) return HORARIO_PADRAO;
  if (minutosDe(fim) <= minutosDe(inicio)) return HORARIO_PADRAO;
  return { dias, inicio, fim };
}

/**
 * A resposta gravada. Sem linha, desligada com o texto padrão; com linha, o
 * que estiver lá (texto vazio fica vazio: quem apagou não quer o padrão de
 * volta). Ligada só vale com texto.
 */
export function lerResposta(
  valor: unknown,
  tipo: TipoAutomatica,
): RespostaAutomatica {
  if (!valor || typeof valor !== "object") {
    return { ativo: false, texto: TEXTO_PADRAO[tipo] };
  }
  const v = valor as { ativo?: unknown; texto?: unknown };
  const texto = typeof v.texto === "string" ? v.texto : TEXTO_PADRAO[tipo];
  return { ativo: v.ativo === true && texto.trim() !== "", texto };
}

// ─────────────────────────── horário por extenso ───────────────────────────

const NOME_DIA = [
  "domingo",
  "segunda",
  "terça",
  "quarta",
  "quinta",
  "sexta",
  "sábado",
];

const NOME_DIA_CURTO = ["dom", "seg", "ter", "qua", "qui", "sex", "sáb"];

/** A semana como a equipe lê: começa na segunda. */
export const ORDEM_SEMANA = [1, 2, 3, 4, 5, 6, 0] as const;

/** "Segunda", "Terça"… para a lista de escolha. */
export function nomeDoDia(dia: number): string {
  const nome = NOME_DIA[dia] ?? "";
  return nome.charAt(0).toUpperCase() + nome.slice(1);
}

/** "a, b e c". */
function juntar(partes: string[]): string {
  if (partes.length <= 1) return partes[0] ?? "";
  return `${partes.slice(0, -1).join(", ")} e ${partes[partes.length - 1]}`;
}

/**
 * Os dias em trechos seguidos (na ordem da semana que começa na segunda):
 * três ou mais viram uma faixa ("de segunda a sexta", ou "seg a sex" no
 * curto); menos que isso, um por um. A semana é circular: o trecho que
 * fecha no domingo continua no que abre na segunda quando os dois juntos
 * viram faixa, e sexta, sábado, domingo e segunda saem "de sexta a
 * segunda". Domingo e segunda sozinhos seguem um por um, na ordem da
 * semana ("segunda e domingo").
 */
function trechosDosDias(
  dias: number[],
  nomes: string[],
  faixa: (primeiro: string, ultimo: string) => string,
): string[] {
  const trechos: number[][] = [];
  ORDEM_SEMANA.forEach((dia, posicao) => {
    if (!dias.includes(dia)) return;
    const ultimo = trechos[trechos.length - 1];
    if (ultimo && ultimo[ultimo.length - 1] === posicao - 1) {
      ultimo.push(posicao);
    } else {
      trechos.push([posicao]);
    }
  });
  const fim = trechos[trechos.length - 1];
  if (
    trechos.length > 1 &&
    trechos[0][0] === 0 &&
    fim[fim.length - 1] === ORDEM_SEMANA.length - 1 &&
    trechos[0].length + fim.length >= 3
  ) {
    fim.push(...(trechos.shift() ?? []));
  }
  return trechos.flatMap((trecho) => {
    const nomesDoTrecho = trecho.map((p) => nomes[ORDEM_SEMANA[p]]);
    return nomesDoTrecho.length >= 3
      ? [faixa(nomesDoTrecho[0], nomesDoTrecho[nomesDoTrecho.length - 1])]
      : nomesDoTrecho;
  });
}

/** "de segunda a sexta", "sábado e domingo", "todos os dias". */
export function diasPorExtenso(dias: number[]): string {
  if (dias.length === 7) return "todos os dias";
  return juntar(trechosDosDias(dias, NOME_DIA, (a, b) => `de ${a} a ${b}`));
}

/** "9h", "18h30". */
export function horaPorExtenso(hora: string): string {
  const [h, m] = hora.split(":");
  const horas = String(Number(h));
  return m === "00" ? `${horas}h` : `${horas}h${m}`;
}

/** "das 9h às 18h" (e "da 1h", "à 1h", no singular). */
function faixaDeHoras(inicio: string, fim: string): string {
  const de = Number(inicio.slice(0, 2)) === 1 ? "da" : "das";
  const ate = Number(fim.slice(0, 2)) === 1 ? "à" : "às";
  return `${de} ${horaPorExtenso(inicio)} ${ate} ${horaPorExtenso(fim)}`;
}

/** "de segunda a sexta, das 9h às 18h": o que entra no lugar de {horario}. */
export function horarioPorExtenso(h: HorarioAtendimento): string {
  return `${diasPorExtenso(h.dias)}, ${faixaDeHoras(h.inicio, h.fim)}`;
}

/** "Seg a sex, 9h às 18h": o resumo da linha em Configurações. */
export function horarioCurto(h: HorarioAtendimento): string {
  const dias =
    h.dias.length === 7
      ? "todos os dias"
      : juntar(trechosDosDias(h.dias, NOME_DIA_CURTO, (a, b) => `${a} a ${b}`));
  const texto = `${dias}, ${horaPorExtenso(h.inicio)} às ${horaPorExtenso(h.fim)}`;
  return texto.charAt(0).toUpperCase() + texto.slice(1);
}

/** O texto como sai para o contato: {horario} trocado, sem sobra nas pontas. */
export function textoDaResposta(texto: string, h: HorarioAtendimento): string {
  return texto.split(MARCADOR_HORARIO).join(horarioPorExtenso(h)).trim();
}

// ─────────────────────────── dentro ou fora ───────────────────────────

const RELOGIO_BRASILIA = new Intl.DateTimeFormat("en-US", {
  timeZone: "America/Sao_Paulo",
  weekday: "short",
  hour: "2-digit",
  minute: "2-digit",
  hourCycle: "h23",
});

const DIA_DA_SEMANA: Record<string, number> = {
  Sun: 0,
  Mon: 1,
  Tue: 2,
  Wed: 3,
  Thu: 4,
  Fri: 5,
  Sat: 6,
};

/** Dia da semana (0 = domingo) e minuto do dia, em Brasília. */
export function relogioBrasilia(quando: Date): { dia: number; minuto: number } {
  const partes = RELOGIO_BRASILIA.formatToParts(quando);
  const parte = (tipo: Intl.DateTimeFormatPartTypes) =>
    partes.find((p) => p.type === tipo)?.value ?? "";
  return {
    dia: DIA_DA_SEMANA[parte("weekday")] ?? 0,
    minuto: Number(parte("hour")) * 60 + Number(parte("minute")),
  };
}

/** Dentro do horário: dia marcado, do início (inclusive) até o fim (exclusive). */
export function dentroDoHorario(h: HorarioAtendimento, quando: Date): boolean {
  const { dia, minuto } = relogioBrasilia(quando);
  return (
    h.dias.includes(dia) &&
    minuto >= minutosDe(h.inicio) &&
    minuto < minutosDe(h.fim)
  );
}
