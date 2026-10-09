import { dataEHoraEmTexto, partesEmBrasilia } from "./quando";

/**
 * O recontato: o atendente marca quando voltar a falar com o contato, por
 * quê e, se quiser, com qual template. Mora em lead_interactions, como nota
 * de sistema, sem tabela nova (o banco não muda):
 *
 *   agendar e reagendar  nota com metadados.recontato
 *                        { id, quando, motivo, template, idioma, variaveis, por }
 *                        (reagendar repete o id; vale a nota mais nova; o
 *                        Desfazer do Feito e do Cancelar grava id novo com
 *                        restaurado: true)
 *   feito e cancelado    nota com metadados.recontato_fim { id, como }
 *
 * Só se acrescenta: nada é editado. Pendente é o id que tem nota de
 * agendamento e nenhuma de fim. Agendar também adia a conversa até o
 * quando (o mesmo campo do adiar), para ela sair da Caixa; se a pessoa
 * escrever antes, o webhook limpa o adiamento e ela volta na hora. No dia
 * (e enquanto estiver atrasado) quem a põe na Caixa é o próprio recontato
 * (conversas/lista.ts), e não o adiamento, que outro gesto pode ter trocado
 * (outro recontato, o Adiar comum, o Resolver). Ele continua pendente até
 * alguém dar Feito, Cancelar ou mandar o template.
 *
 * Módulo puro: o servidor e a tela leem as notas com as mesmas funções.
 */

/** O motivo cabe numa linha da fila. */
export const MOTIVO_MAX = 140;

/** "Escolher data e hora" vai até aqui. Com a janela de leitura de um ano
 *  (JANELA_RECONTATOS_DIAS), o atrasado continua à vista por pelo menos
 *  185 dias depois do prazo. */
export const RECONTATO_MAX_DIAS = 180;

/** Quanto para trás a fila procura notas de recontato. */
export const JANELA_RECONTATOS_DIAS = 365;

export type TemplateDoRecontato = {
  nome: string;
  idioma: string;
  /** O valor de cada variável ({{1}}, {{nome}}), como ficou no agendamento. */
  variaveis: Record<string, string>;
};

/** O que a nota de agendamento guarda, já conferido. */
export type DadosRecontato = {
  id: string;
  /** ISO. */
  quando: string;
  motivo: string;
  template: TemplateDoRecontato | null;
  /** Id (profiles) de quem agendou. */
  por: string | null;
  /** A nota é de reagendamento (o id já existia). */
  reagendado: boolean;
  /** A nota é do Desfazer de um Feito ou Cancelar: o recontato voltou como
   *  estava, sem agendamento novo. */
  restaurado: boolean;
};

/** Como o recontato terminou. "template": saiu pelo template da faixa. */
export type ComoTermina = "feito" | "cancelado" | "template";

export type FimRecontato = { id: string; como: ComoTermina };

/** Um recontato pendente, do jeito que a conversa usa. */
export type Recontato = DadosRecontato & {
  leadId: string;
  /** Nome de quem agendou (ou reagendou por último). */
  porNome: string | null;
};

/** O pedaço que a linha da fila precisa. `dia` em "AAAA-MM-DD" (Brasília). */
export type RecontatoDaLinha = {
  id: string;
  quando: string;
  motivo: string;
  dia: string;
};

/** A nota que a action acabou de gravar, para a conversa já mostrar. */
export type NotaRecontato = {
  id: string;
  conteudo: string;
  criado_em: string;
  metadados: Record<string, unknown>;
  autor: string | null;
};

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

function objeto(v: unknown): Record<string, unknown> | null {
  return v && typeof v === "object" && !Array.isArray(v)
    ? (v as Record<string, unknown>)
    : null;
}

function texto(v: unknown): string | null {
  return typeof v === "string" && v.trim() ? v.trim() : null;
}

/** As variáveis guardadas, só as de texto. */
function lerVariaveis(v: unknown): Record<string, string> {
  const o = objeto(v);
  if (!o) return {};
  const saida: Record<string, string> = {};
  for (const [k, valor] of Object.entries(o)) {
    if (typeof valor === "string") saida[k] = valor;
  }
  return saida;
}

/** metadados.recontato → os dados, ou null quando não é nota de recontato
 *  (ou veio torta: sem id, sem data legível, sem motivo). */
export function lerRecontato(bruto: unknown): DadosRecontato | null {
  const r = objeto(bruto);
  if (!r) return null;
  const id = texto(r.id);
  const quando = texto(r.quando);
  const motivo = texto(r.motivo);
  if (!id || !UUID.test(id) || !quando || !motivo) return null;
  if (Number.isNaN(Date.parse(quando))) return null;
  const nome = texto(r.template);
  const idioma = texto(r.idioma);
  return {
    id,
    quando,
    motivo,
    template: nome && idioma ? { nome, idioma, variaveis: lerVariaveis(r.variaveis) } : null,
    por: texto(r.por),
    reagendado: r.reagendado === true,
    restaurado: r.restaurado === true,
  };
}

/** metadados.recontato_fim → { id, como }, ou null. */
export function lerFimRecontato(bruto: unknown): FimRecontato | null {
  const f = objeto(bruto);
  if (!f) return null;
  const id = texto(f.id);
  if (!id || !UUID.test(id)) return null;
  const como =
    f.como === "cancelado" ? "cancelado" : f.como === "template" ? "template" : "feito";
  return { id, como };
}

/** O que gravar em metadados.recontato. */
export function metadadosDoRecontato(d: DadosRecontato): Record<string, unknown> {
  return {
    id: d.id,
    quando: d.quando,
    motivo: d.motivo,
    template: d.template?.nome ?? null,
    idioma: d.template?.idioma ?? null,
    variaveis: d.template?.variaveis ?? {},
    por: d.por,
    ...(d.reagendado ? { reagendado: true } : {}),
    ...(d.restaurado ? { restaurado: true } : {}),
  };
}

/** Uma nota de agendamento lida do banco. */
export type NotaDeAgendamento = {
  leadId: string;
  criadoEm: string;
  dados: DadosRecontato;
  autor: string | null;
};

/**
 * Os pendentes, do mais cedo para o mais tarde: de cada id vale a nota mais
 * nova (o reagendamento passa na frente), e o id com nota de fim sai.
 */
export function recontatosPendentes(
  notas: NotaDeAgendamento[],
  idsEncerrados: ReadonlySet<string>,
): Recontato[] {
  const porId = new Map<string, NotaDeAgendamento>();
  for (const n of notas) {
    if (idsEncerrados.has(n.dados.id)) continue;
    const atual = porId.get(n.dados.id);
    if (!atual || n.criadoEm > atual.criadoEm) porId.set(n.dados.id, n);
  }
  return [...porId.values()]
    .map((n) => ({ ...n.dados, leadId: n.leadId, porNome: n.autor }))
    .sort((a, b) => Date.parse(a.quando) - Date.parse(b.quando));
}

/** O recontato no tamanho da linha da fila. */
export function paraLinha(r: Recontato): RecontatoDaLinha {
  return {
    id: r.id,
    quando: r.quando,
    motivo: r.motivo,
    dia: partesEmBrasilia(r.quando).dia,
  };
}

/** Em que grupo da visão Recontatos ele entra, pelo dia de Brasília. */
export type GrupoRecontato = "atrasados" | "hoje" | "proximos";

export function grupoDoRecontato(dia: string, hoje: string): GrupoRecontato {
  return dia < hoje ? "atrasados" : dia === hoje ? "hoje" : "proximos";
}

/** É do dia (ou já passou): a fila troca a prévia pelo motivo. */
export function recontatoDoDia(r: { dia: string }, hoje: string): boolean {
  return r.dia <= hoje;
}

/** O texto gravado na nota de agendamento (lido em outro dia: sem "amanhã"). */
export function textoDoAgendamento(d: DadosRecontato): string {
  const como = d.restaurado
    ? "restaurado"
    : d.reagendado
      ? "reagendado"
      : "agendado";
  return `Recontato ${como} para ${dataEHoraEmTexto(d.quando)}: ${d.motivo}`;
}

/** O texto gravado na nota de fim. */
export function textoDoFim(como: ComoTermina, motivo: string, template?: string | null): string {
  if (como === "cancelado") return `Recontato cancelado: ${motivo}`;
  if (como === "template" && template) {
    return `Recontato feito com o template ${template}: ${motivo}`;
  }
  return `Recontato feito: ${motivo}`;
}

/** O motivo limpo: uma linha só, sem espaço sobrando. */
export function limparMotivo(bruto: string): string {
  return bruto.replace(/\s+/g, " ").trim();
}
