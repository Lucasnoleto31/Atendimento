/*
 * Regras das campanhas que valem dos dois lados: o motor (lib/campanhas.ts),
 * que manda, e a tela, que mostra a prévia e o ritmo antes de criar. Arquivo
 * puro, sem import de servidor: o assistente de nova campanha roda no
 * navegador e precisa fazer a MESMA conta que o motor faz na hora de mandar.
 */

/**
 * Chave reservada em campanhas.parametros: o que vai no lugar do {nome}
 * quando o contato não tem nome de verdade. Não é token de template (os
 * tokens são "1", "2"…) e o motor só percorre os tokens do template, então
 * ela nunca segue para a Meta como variável.
 */
export const CHAVE_SEM_NOME = "_sem_nome";

/** Padrão do campo "Para quem não tem nome" e da campanha antiga, criada
 *  antes de o campo existir. Nunca vazio: a Meta recusa variável vazia. */
export const SEM_NOME_PADRAO = "cliente";

/**
 * Nome que o próprio sistema inventou ao criar o contato: importação sem
 * nome ("Lead 1234", lib/imports/leads.ts), WhatsApp sem nome de perfil
 * ("WhatsApp 1234", webhook da Meta) e Direct sem perfil ("Direct do
 * Instagram" ou "@usuario", webhook do Instagram). Com ele no {nome}, o
 * template saía "Olá Lead, tudo bem?" para a lista inteira.
 */
export function nomeEhGenerico(nome: string): boolean {
  const n = nome.trim();
  return (
    !n ||
    /^(Lead|WhatsApp) \d{1,4}$/.test(n) ||
    n === "Direct do Instagram" ||
    n.startsWith("@")
  );
}

/** Primeiro nome, que é como a equipe chama o contato na mensagem. */
export function primeiroNome(nome: string, semNome: string): string {
  if (nomeEhGenerico(nome)) return semNome;
  const n = nome.trim();
  return n.split(/\s+/)[0] ?? n;
}

type Parametros = Record<string, string> | null | undefined;

/**
 * O que vai em cada variável antes de trocar o {nome}: o valor gravado ou,
 * em template de uma variável só, o próprio {nome} (o padrão desde a
 * primeira versão das campanhas).
 */
export function valorBruto(
  token: string,
  tokens: string[],
  parametros: Parametros,
): string {
  const gravado = parametros?.[token]?.trim();
  if (gravado) return gravado;
  return tokens.length === 1 ? "{nome}" : "";
}

/**
 * Variáveis do template sem valor. A Meta recusa o envio com variável vazia
 * e a linha do contato fica com erro, o que o tira da fila para sempre: com
 * uma variável em branco, a campanha queimava o público inteiro sem entregar
 * nada. O motor pula a campanha e a tela não deixa criar.
 */
export function variaveisEmBranco(
  tokens: string[],
  parametros: Parametros,
): string[] {
  return tokens.filter((t) => !valorBruto(t, tokens, parametros));
}

/** Alguma variável usa o {nome}? Só aí o "para quem não tem nome" vale. */
export function usaNome(tokens: string[], parametros: Parametros): boolean {
  return tokens.some((t) => /\{nome\}/i.test(valorBruto(t, tokens, parametros)));
}

/** O texto de quem não tem nome, com o padrão para campanha antiga. */
export function textoSemNome(parametros: Parametros): string {
  return parametros?.[CHAVE_SEM_NOME]?.trim() || SEM_NOME_PADRAO;
}

/** As variáveis prontas para um contato, com o {nome} já trocado. */
export function valoresParaContato(
  tokens: string[],
  parametros: Parametros,
  nomeDoContato: string,
): Record<string, string> {
  const nome = primeiroNome(nomeDoContato, textoSemNome(parametros));
  const valores: Record<string, string> = {};
  for (const token of tokens) {
    valores[token] = valorBruto(token, tokens, parametros).replace(
      /\{nome\}/gi,
      nome,
    );
  }
  return valores;
}

/** O corpo do template com as variáveis no lugar; a que falta fica como
 *  estava ({{2}}), para a falta aparecer em vez de sumir. */
export function preencherCorpo(
  corpo: string,
  valores: Record<string, string>,
): string {
  return corpo.replace(
    /\{\{\s*([^{}]+?)\s*\}\}/g,
    (bloco, token: string) => valores[token] || bloco,
  );
}

/**
 * A prévia do texto: o corpo com cada variável (a gravada ou, em template
 * de uma variável só, o {nome}) e o {nome} trocado por `nome`. É a conta da
 * nova campanha e a do editor de uma campanha já criada.
 */
export function montarPrevia(
  corpo: string,
  tokens: string[],
  parametros: Parametros,
  nome: string,
): string {
  const preenchidos: Record<string, string> = {};
  for (const token of tokens) {
    preenchidos[token] = valorBruto(token, tokens, parametros).replace(
      /\{nome\}/gi,
      nome,
    );
  }
  return preencherCorpo(corpo, preenchidos);
}

/** As variáveis gravadas numa campanha, sem a chave do "sem nome". */
export function variaveisGravadas(
  parametros: Parametros,
): Record<string, string> {
  const valores: Record<string, string> = {};
  for (const [chave, valor] of Object.entries(parametros ?? {})) {
    if (chave !== CHAVE_SEM_NOME && typeof valor === "string") {
      valores[chave] = valor;
    }
  }
  return valores;
}

/**
 * Um nome que nenhuma campanha usa: o pedido ou, se ele já existe, o mesmo
 * com "(2)", "(3)"… A trava de repetição do criarCampanha (mesmo nome,
 * público, template, variáveis e ritmo em 10 minutos) trata a cópia idêntica
 * de uma campanha recém-criada como a própria; com outro nome, é outra.
 */
export function nomeLivre(nome: string, usados: readonly string[]): string {
  const chave = (n: string) => n.trim().toLocaleLowerCase("pt-BR");
  const ocupados = new Set(usados.map(chave));
  if (!ocupados.has(chave(nome))) return nome;
  for (let n = 2; n < 1000; n++) {
    const candidato = `${nome} (${n})`;
    if (!ocupados.has(chave(candidato))) return candidato;
  }
  return nome;
}

/**
 * A consequência de excluir uma campanha, em frases curtas. O registro de
 * envios (campanha_envios) sai junto, em cascata: some quem recebeu (o
 * filtro Campanha do chat e de Contatos deixa de achar a pessoa) e some a
 * recusa (sai de "Ver as recusas"). A mensagem gravada na conversa fica.
 */
export function fraseExclusao(c: {
  nome: string;
  /** Envios sem erro. */
  recebidos: number;
  recusadas: number;
  /** Do público elegível, quem ainda não recebeu. */
  faltam: number;
  concluida: boolean;
}): string {
  const partes = [`Excluir ${c.nome}?`];
  if (c.recebidos > 0) {
    partes.push(
      c.recebidos === 1
        ? "Some também o registro de quem recebeu (1 pessoa): o filtro Campanha do chat e de Contatos deixa de achá-la."
        : `Some também o registro dos ${numero(c.recebidos)} que receberam: o filtro Campanha do chat e de Contatos deixa de achá-los.`,
    );
  }
  if (c.recusadas > 0) {
    partes.push(
      c.recusadas === 1
        ? "A recusa sai de Ver as recusas."
        : `As ${numero(c.recusadas)} recusas saem de Ver as recusas.`,
    );
  }
  if (!c.concluida && c.faltam > 0) {
    partes.push(
      c.faltam === 1
        ? "Quem falta não recebe."
        : `Os ${numero(c.faltam)} que faltam não recebem.`,
    );
  }
  partes.push(
    c.recebidos + c.recusadas > 0
      ? "As mensagens nas conversas ficam."
      : "Nenhum envio saiu desta campanha.",
  );
  return partes.join(" ");
}

/* ── Público ────────────────────────────────────────────────────────── */

/**
 * Uma etiqueta como público: quantos têm a etiqueta e quantos recebem de
 * fato, pelos mesmos filtros do motor (telefone, marketing não bloqueado,
 * status diferente de perdido). As quatro partes são disjuntas e somam o
 * total.
 */
export type PublicoEtiqueta = {
  id: string;
  nome: string;
  cor: string | null;
  total: number;
  recebem: number;
  semTelefone: number;
  bloquearam: number;
  perdidos: number;
};

/** "18 sem telefone · 4 bloquearam marketing · 3 perdidos", só com as
 *  partes que existem. */
export function partesDoPublico(p: PublicoEtiqueta): string[] {
  const partes: string[] = [];
  if (p.semTelefone > 0) partes.push(`${numero(p.semTelefone)} sem telefone`);
  if (p.bloquearam > 0) {
    partes.push(
      `${numero(p.bloquearam)} ${p.bloquearam === 1 ? "bloqueou" : "bloquearam"} marketing`,
    );
  }
  if (p.perdidos > 0) {
    partes.push(
      `${numero(p.perdidos)} ${p.perdidos === 1 ? "perdido" : "perdidos"}`,
    );
  }
  return partes;
}

/* ── Ritmo ──────────────────────────────────────────────────────────── */

/** O relógio de Brasília que a página lê no servidor e passa para a tela:
 *  a conta do "hoje saem" e da previsão sai no mesmo relógio do motor. */
export type Relogio = {
  /** aaaa-mm-dd em Brasília. */
  dia: string;
  hora: number;
};

export type Ritmo = {
  porDia: number;
  horaInicio: number;
  horaFim: number;
  diasUteis: boolean;
};

const DIAS_DA_SEMANA = [
  "domingo",
  "segunda",
  "terça",
  "quarta",
  "quinta",
  "sexta",
  "sábado",
];

const MESES = [
  "jan",
  "fev",
  "mar",
  "abr",
  "mai",
  "jun",
  "jul",
  "ago",
  "set",
  "out",
  "nov",
  "dez",
];

function diaDaSemana(dia: string): number {
  return new Date(`${dia}T12:00:00Z`).getUTCDay();
}

function somarDias(dia: string, n: number): string {
  const d = new Date(`${dia}T12:00:00Z`);
  d.setUTCDate(d.getUTCDate() + n);
  return d.toISOString().slice(0, 10);
}

function diaQueVale(dia: string, diasUteis: boolean): boolean {
  const semana = diaDaSemana(dia);
  return !diasUteis || (semana !== 0 && semana !== 6);
}

/** O que trava o ritmo, na mesma regra do banco (por_dia de 1 a 500, hora
 *  de 0 a 23 e de 1 a 24). A tela mostra embaixo do campo; a action recusa. */
export function erroDoRitmo(r: Ritmo): string | null {
  if (!Number.isInteger(r.porDia) || r.porDia < 1 || r.porDia > 500) {
    return "Envios por dia vai de 1 a 500.";
  }
  if (
    !Number.isInteger(r.horaInicio) ||
    !Number.isInteger(r.horaFim) ||
    r.horaInicio < 0 ||
    r.horaInicio > 23 ||
    r.horaFim < 1 ||
    r.horaFim > 24
  ) {
    return "Escolha o horário nas listas.";
  }
  if (r.horaFim <= r.horaInicio) {
    return "O fim do horário vem depois do começo.";
  }
  return null;
}

/** 1.234 */
export function numero(n: number): string {
  return n.toLocaleString("pt-BR");
}

/** 9 → "9h". */
export function rotuloHora(h: number): string {
  return `${h}h`;
}

/** "30 por dia · 9h às 18h · seg a sex" */
export function rotuloRitmo(r: Ritmo): string {
  return `${numero(r.porDia)} por dia · ${rotuloHora(r.horaInicio)} às ${rotuloHora(r.horaFim)} · ${r.diasUteis ? "seg a sex" : "todo dia"}`;
}

/** aaaa-mm-dd → 21/10/2026 (dia de calendário, sem fuso). */
export function dataPorExtenso(dia: string): string {
  const [ano, mes, d] = dia.split("-");
  return `${d}/${mes}/${ano}`;
}

/** Nome sugerido para a campanha: "VIP · out/2026". */
export function nomeSugerido(etiqueta: string, dia: string): string {
  const [ano, mes] = dia.split("-");
  return `${etiqueta} · ${MESES[Number(mes) - 1] ?? mes}/${ano}`;
}

/**
 * Quando a fila acaba no ritmo atual. Hoje entra na conta com o que ainda
 * cabe na cota do dia; o teto do número fica de fora (é do número, não da
 * campanha), por isso a tela diz "por volta de". Devolve o dia (aaaa-mm-dd)
 * e quantos dias de calendário faltam; acima de um ano a tela fala em
 * contagem, não em data.
 */
export function previsaoTermino(
  p: Ritmo & { faltam: number; jaHoje: number },
  r: Relogio,
): { dia: string; dias: number } | null {
  if (p.faltam <= 0 || p.porDia <= 0) return null;
  let resta = p.faltam;
  if (diaQueVale(r.dia, p.diasUteis) && r.hora < p.horaFim) {
    resta -= Math.max(p.porDia - p.jaHoje, 0);
    if (resta <= 0) return { dia: r.dia, dias: 0 };
  }
  let dia = r.dia;
  // Teto de dez anos: só uma rede contra ritmo absurdo, a conta acaba antes.
  for (let dias = 1; dias <= 3650; dias++) {
    dia = somarDias(dia, 1);
    if (!diaQueVale(dia, p.diasUteis)) continue;
    resta -= p.porDia;
    if (resta <= 0) return { dia, dias };
  }
  return null;
}

/** "termina por volta de 21/10/2026", "termina hoje", "leva mais de um ano". */
export function frasePrevisao(
  previsao: { dia: string; dias: number } | null,
): string | null {
  if (!previsao) return null;
  if (previsao.dias === 0) return "termina hoje";
  if (previsao.dias > 365) return "leva mais de um ano nesse ritmo";
  return `termina por volta de ${dataPorExtenso(previsao.dia)}`;
}

export type PrimeiroEnvio =
  | { tipo: "agora"; quantos: number; ate: number }
  | { tipo: "hoje"; quantos: number; as: number; ate: number }
  | {
      tipo: "depois";
      quando: string;
      as: number;
      motivo: "teto" | "cota" | null;
    }
  | { tipo: "nada" };

/**
 * Quando sai o próximo envio se a campanha ficar ativa agora, e quantos
 * cabem hoje: o menor entre o que resta da cota da campanha, o que resta do
 * teto do número e o que falta no público. É o que a confirmação do
 * "Começar" e a revisão da nova campanha dizem.
 */
export function primeiroEnvio(
  p: Ritmo & { jaHoje: number; restanteTeto: number; faltam: number },
  r: Relogio,
): PrimeiroEnvio {
  if (p.faltam <= 0) return { tipo: "nada" };
  const hojeVale = diaQueVale(r.dia, p.diasUteis) && r.hora < p.horaFim;
  const cabeHoje = Math.min(
    Math.max(p.porDia - p.jaHoje, 0),
    Math.max(p.restanteTeto, 0),
    p.faltam,
  );
  if (hojeVale && cabeHoje > 0) {
    return r.hora >= p.horaInicio
      ? { tipo: "agora", quantos: cabeHoje, ate: p.horaFim }
      : { tipo: "hoje", quantos: cabeHoje, as: p.horaInicio, ate: p.horaFim };
  }

  let dia = r.dia;
  let passados = 0;
  do {
    dia = somarDias(dia, 1);
    passados++;
  } while (!diaQueVale(dia, p.diasUteis) && passados < 8);

  return {
    tipo: "depois",
    quando: passados === 1 ? "amanhã" : DIAS_DA_SEMANA[diaDaSemana(dia)],
    as: p.horaInicio,
    motivo: hojeVale ? (p.restanteTeto <= 0 ? "teto" : "cota") : null,
  };
}

/** A frase do primeiro envio, com o tamanho do que falta quando ajuda. */
export function frasePrimeiroEnvio(e: PrimeiroEnvio, faltam?: number): string {
  const de = faltam !== undefined ? ` de ${numero(faltam)}` : "";
  switch (e.tipo) {
    case "agora":
      return `Hoje saem até ${numero(e.quantos)}${de}, até as ${rotuloHora(e.ate)}.`;
    case "hoje":
      return `Hoje saem até ${numero(e.quantos)}${de}, das ${rotuloHora(e.as)} às ${rotuloHora(e.ate)}.`;
    case "depois": {
      const antes =
        e.motivo === "teto"
          ? "O teto de envios de hoje já foi usado. "
          : e.motivo === "cota"
            ? "A cota de hoje já saiu. "
            : "";
      return `${antes}Os envios começam ${e.quando} às ${rotuloHora(e.as)}.`;
    }
    case "nada":
      return "Ninguém no público para receber.";
  }
}
