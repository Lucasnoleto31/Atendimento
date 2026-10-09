import {
  ehDataFila,
  ehUuid,
  hojeEmBrasilia,
  somarDiasFila,
} from "@/app/(app)/chat/mensagem";
import { ACOES_ANTIGAS, GRUPOS_ACOES } from "./acoes";

/*
 * Os filtros do Log de acesso na URL, num lugar só. Arquivo puro: a página,
 * a exportação, a action do "Carregar mais" e a tela leem daqui.
 *
 * Desde 09/10/2026 (a pergunta do Artur: "os filtros eu consigo selecionar
 * múltiplos filtros?"), pessoas e ações são listas: ?quem=a,b&acao=x,y. O
 * link antigo, de um valor só, continua valendo. O período é um atalho
 * (?dias=1, 7 ou 30) ou datas (?de=AAAA-MM-DD&ate=AAAA-MM-DD, em Brasília);
 * com data, o atalho sai. ?contato= procura pelo nome gravado no registro ou
 * pelo contato (nome ou telefone); ?lead=<id> fica só com os registros de
 * um contato (o "Quem viu este contato" da ficha).
 */

export const JANELAS_LOG = [
  { dias: 1, rotulo: "24 horas" },
  { dias: 7, rotulo: "7 dias" },
  { dias: 30, rotulo: "30 dias" },
] as const;

export const DIAS_PADRAO = 7;

/** Teto de pessoas na lista (cada id ocupa 37 caracteres na URL). */
const MAX_PESSOAS = 40;

/**
 * Teto de ações, acima do total conhecido (65 em 09/10/2026, uns 20
 * caracteres cada). Com o teto de 40 de antes, marcar tudo menos "Conversas
 * e fichas" cortava 11 ações em silêncio, as de senha entre elas. Se a
 * lista um dia passar de 120, o teto acompanha.
 */
const MAX_ACOES = Math.max(
  120,
  GRUPOS_ACOES.reduce((n, g) => n + g.acoes.length, 0) + ACOES_ANTIGAS.length,
);

export type FiltrosLog = {
  /** O atalho do período (1, 7 ou 30); vale quando não há data. */
  dias: number;
  /** Período por datas, AAAA-MM-DD, ou "". */
  de: string;
  ate: string;
  /** ids de profiles. [] = todas as pessoas. */
  quem: string[];
  /** As ações (chaves de auditoria). [] = todas. */
  acoes: string[];
  /** Nome ou telefone do contato, ou "". */
  contato: string;
  /** O id de um contato (lead), ou "". */
  lead: string;
};

export const FILTROS_LOG_PADRAO: FiltrosLog = {
  dias: DIAS_PADRAO,
  de: "",
  ate: "",
  quem: [],
  acoes: [],
  contato: "",
  lead: "",
};

type Params =
  | Record<string, string | string[] | undefined>
  | URLSearchParams;

function valores(params: Params, nome: string): string[] {
  if (params instanceof URLSearchParams) return params.getAll(nome);
  const v = params[nome];
  return Array.isArray(v) ? v : typeof v === "string" ? [v] : [];
}

/** "a,b" (ou o parâmetro repetido) em lista, sem vazio nem repetido, em
 *  ordem fixa: a mesma escolha dá a mesma URL. */
function lista(
  params: Params,
  nome: string,
  valido: (v: string) => boolean,
  teto: number,
) {
  return [
    ...new Set(
      valores(params, nome)
        .flatMap((v) => v.split(","))
        .map((v) => v.trim())
        .filter((v) => v && valido(v)),
    ),
  ]
    .sort()
    .slice(0, teto);
}

const CHAVE_ACAO = /^[a-z0-9_]{1,60}$/;

export function lerFiltrosLog(params: Params): FiltrosLog {
  const diasBruto = Number(valores(params, "dias")[0]);
  const dias = JANELAS_LOG.some((j) => j.dias === diasBruto)
    ? diasBruto
    : DIAS_PADRAO;
  let de = valores(params, "de")[0]?.trim() ?? "";
  let ate = valores(params, "ate")[0]?.trim() ?? "";
  if (!ehDataFila(de)) de = "";
  if (!ehDataFila(ate)) ate = "";
  // Invertidas, as duas trocam de lugar.
  if (de && ate && de > ate) [de, ate] = [ate, de];
  const lead = valores(params, "lead")[0];
  return {
    dias,
    de,
    ate,
    quem: lista(params, "quem", ehUuid, MAX_PESSOAS),
    acoes: lista(params, "acao", (v) => CHAVE_ACAO.test(v), MAX_ACOES),
    contato: (valores(params, "contato")[0] ?? "").trim().slice(0, 80),
    lead: ehUuid(lead) ? lead : "",
  };
}

/**
 * O aviso que a exportação deixa na tela quando o CSV não sai (?aviso=):
 * "grande", o período passou do teto de um arquivo; "erro", um lote falhou
 * no meio. Não é filtro: mudar qualquer filtro tira o aviso da URL.
 */
export const AVISO_EXPORTACAO = "aviso";
export type AvisoExportacao = "grande" | "erro";

export function lerAvisoExportacao(valor: unknown): AvisoExportacao | null {
  const bruto = Array.isArray(valor) ? valor[0] : valor;
  return bruto === "grande" || bruto === "erro" ? bruto : null;
}

/** Os parâmetros, só os que não estão no padrão, na ordem de sempre. */
export function parametrosDoLog(f: FiltrosLog): URLSearchParams {
  const p = new URLSearchParams();
  if (f.de || f.ate) {
    if (f.de) p.set("de", f.de);
    if (f.ate) p.set("ate", f.ate);
  } else if (f.dias !== DIAS_PADRAO) {
    p.set("dias", String(f.dias));
  }
  if (f.quem.length > 0) p.set("quem", f.quem.join(","));
  if (f.acoes.length > 0) p.set("acao", f.acoes.join(","));
  if (f.contato) p.set("contato", f.contato);
  if (f.lead) p.set("lead", f.lead);
  return p;
}

/** O endereço do log com os filtros (o que está no padrão fica fora). */
export function urlDoLog(f: FiltrosLog): string {
  const q = parametrosDoLog(f).toString();
  return q ? `/admin/acessos?${q}` : "/admin/acessos";
}

// A meia-noite de Brasília em ISO (o -03:00 é fixo desde 2019).
function meiaNoite(dia: string): string {
  return new Date(`${dia}T00:00:00-03:00`).toISOString();
}

/**
 * O período em instantes: `desde` inclusive, `ateAntes` exclusivo (a
 * meia-noite do dia seguinte ao `ate`). Com o atalho, as últimas N vezes 24
 * horas, até agora. Só com "até", desde o começo.
 */
export function intervaloDoLog(
  f: FiltrosLog,
  agora: number = Date.now(),
): { desde: string | null; ateAntes: string | null } {
  if (f.de || f.ate) {
    return {
      desde: f.de ? meiaNoite(f.de) : null,
      ateAntes: f.ate ? meiaNoite(somarDiasFila(f.ate, 1)) : null,
    };
  }
  return {
    desde: new Date(agora - f.dias * 86_400_000).toISOString(),
    ateAntes: null,
  };
}

/** "07/10", com o ano só quando não é o de hoje. */
function diaCurto(dia: string, hoje: string): string {
  const [a, m, d] = dia.split("-");
  return a === hoje.slice(0, 4) ? `${d}/${m}` : `${d}/${m}/${a}`;
}

/** O nome do período: "Últimos 7 dias", "01/10 a 07/10", "Desde 01/10". */
export function rotuloDoPeriodoLog(f: FiltrosLog, agora = new Date()): string {
  const hoje = hojeEmBrasilia(agora);
  if (f.de && f.ate) {
    return f.de === f.ate
      ? diaCurto(f.de, hoje)
      : `${diaCurto(f.de, hoje)} a ${diaCurto(f.ate, hoje)}`;
  }
  if (f.de) return `Desde ${diaCurto(f.de, hoje)}`;
  if (f.ate) return `Até ${diaCurto(f.ate, hoje)}`;
  return f.dias === 1 ? "Últimas 24 horas" : `Últimos ${f.dias} dias`;
}

/** O período está no padrão (últimos 7 dias)? */
export function periodoPadrao(f: FiltrosLog): boolean {
  return !f.de && !f.ate && f.dias === DIAS_PADRAO;
}

/** Quantos filtros estão ligados: o período fora do padrão, as pessoas, as
 *  ações e o contato contam um cada. É o número do funil. */
export function contarFiltrosLog(f: FiltrosLog): number {
  return (
    (periodoPadrao(f) ? 0 : 1) +
    (f.quem.length > 0 ? 1 : 0) +
    (f.acoes.length > 0 ? 1 : 0) +
    (f.contato ? 1 : 0) +
    (f.lead ? 1 : 0)
  );
}
