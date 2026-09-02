/**
 * A jornada do cliente e a trilha de perfil — arquivo puro (sem imports de
 * servidor) porque o painel do chat, client component, também usa.
 *
 * A JORNADA não é tabela: cada estado nasce de um fato que já existe no
 * banco, com data e origem próprias. Quem monta a régua é montarJornada().
 */

export const TRILHAS = [
  { trilha: "iniciante", rotulo: "Iniciante", detalhe: "renda fixa" },
  { trilha: "renda_variavel", rotulo: "Renda Variável", detalhe: null },
  { trilha: "sala_ao_vivo", rotulo: "Sala ao Vivo", detalhe: null },
  { trilha: "apollo", rotulo: "Apollo", detalhe: null },
] as const;

export type Trilha = (typeof TRILHAS)[number]["trilha"];

export function ehTrilha(valor: string): valor is Trilha {
  return TRILHAS.some((t) => t.trilha === valor);
}

export function rotuloTrilha(trilha: string | null | undefined): string {
  return TRILHAS.find((t) => t.trilha === trilha)?.rotulo ?? "não definida";
}

/** Recorrente = operou em pelo menos N dias diferentes nos últimos 30. */
export const DIAS_GIRO_RECORRENTE = 3;

export type EstadoJornada =
  | "lead"
  | "contato"
  | "abrindo_conta"
  | "conta_aberta"
  | "ativado"
  | "recorrente"
  | "em_risco"
  | "inativo"
  | "reativado";

export const ESTADOS_JORNADA: { estado: EstadoJornada; rotulo: string }[] = [
  { estado: "lead", rotulo: "Lead" },
  { estado: "contato", rotulo: "Contato" },
  { estado: "abrindo_conta", rotulo: "Abrindo conta" },
  { estado: "conta_aberta", rotulo: "Conta aberta" },
  { estado: "ativado", rotulo: "Ativado" },
  { estado: "recorrente", rotulo: "Recorrente" },
  { estado: "em_risco", rotulo: "Em risco" },
  { estado: "inativo", rotulo: "Inativo" },
  { estado: "reativado", rotulo: "Reativado" },
];

export type FatosJornada = {
  /** leads.criado_em e por onde entrou (canal/motivo). */
  criadoEm: string;
  origemLead: string | null;
  /** leads.primeira_resposta_em — o lead falou com a gente. */
  primeiraRespostaEm: string | null;
  /** Primeiro passo do checklist de abertura marcado (link/cadastro). */
  abrindoContaEm: string | null;
  abrindoContaPor: string | null;
  /** customers.conta_aberta_em — cruzamento da Genial. */
  contaAbertaEm: string | null;
  /** Primeiro lote da vida (definição canônica de ativação). */
  primeiroLoteEm: string | null;
  /** Dias distintos com lote nos últimos 30 dias, e o último deles. */
  diasComGiro30d: number;
  ultimoGiroEm: string | null;
  /** customers.status da carteira e a data do último episódio de cada
   *  tipo (customer_events: reativacao = entrou em risco, churn, retomou_giro
   *  = voltou a girar). */
  cicloVida: "ativo" | "em_risco" | "churn" | "reativado" | null;
  emRiscoEm: string | null;
  inativoEm: string | null;
  reativadoEm: string | null;
};

export type PassoJornada = {
  estado: EstadoJornada;
  rotulo: string;
  situacao: "feito" | "atual" | "futuro";
  em: string | null;
  origem: string | null;
  /** O que falta para o próximo estado, quando dá para dizer. */
  detalhe: string | null;
};

/**
 * Monta a régua: os seis primeiros estados são um funil (cada um com seu
 * fato); os três últimos são o ciclo de vida da carteira, que só existe
 * depois da ativação e pode ir e voltar.
 */
export function montarJornada(f: FatosJornada): {
  passos: PassoJornada[];
  atual: EstadoJornada;
} {
  const recorrente = f.diasComGiro30d >= DIAS_GIRO_RECORRENTE;
  const funil: {
    estado: EstadoJornada;
    em: string | null;
    origem: string | null;
    detalhe?: string | null;
  }[] = [
    { estado: "lead", em: f.criadoEm, origem: f.origemLead },
    { estado: "contato", em: f.primeiraRespostaEm, origem: "lead" },
    {
      estado: "abrindo_conta",
      em: f.abrindoContaEm,
      origem: f.abrindoContaPor,
    },
    { estado: "conta_aberta", em: f.contaAbertaEm, origem: "Genial" },
    { estado: "ativado", em: f.primeiroLoteEm, origem: "Genial" },
    {
      estado: "recorrente",
      em: recorrente ? f.ultimoGiroEm : null,
      origem: "Genial",
      detalhe:
        recorrente || !f.primeiroLoteEm
          ? null
          : `faltam ${DIAS_GIRO_RECORRENTE - f.diasComGiro30d} dia${
              DIAS_GIRO_RECORRENTE - f.diasComGiro30d === 1 ? "" : "s"
            }`,
    },
  ];

  // Ciclo de vida da carteira manda quando existe: o motor de resgate marca
  // "em risco" até conta aberta SEM giro — esconder isso atrás de "Conta
  // aberta" seria mentir para quem atende.
  const cicloAtual: EstadoJornada | null =
    f.cicloVida === "em_risco"
      ? "em_risco"
      : f.cicloVida === "churn"
        ? "inativo"
        : f.cicloVida === "reativado"
          ? "reativado"
          : null;

  // No funil, o atual é o último estado com fato.
  let ultimoFeito = 0;
  funil.forEach((p, i) => {
    if (p.em) ultimoFeito = i;
  });
  const atual: EstadoJornada = cicloAtual ?? funil[ultimoFeito].estado;

  const passos: PassoJornada[] = funil.map((p, i) => {
    // Passo sem fato ATRÁS de um feito (cliente importado sem conversa):
    // aconteceu, só não ficou registrado — não é futuro.
    const semRegistro = !p.em && i < ultimoFeito;
    return {
      estado: p.estado,
      rotulo: ESTADOS_JORNADA[i].rotulo,
      situacao:
        cicloAtual === null && i === ultimoFeito
          ? "atual"
          : p.em || semRegistro
            ? "feito"
            : "futuro",
      em: p.em,
      origem: p.em ? p.origem : null,
      detalhe: semRegistro ? "sem registro" : (p.detalhe ?? null),
    };
  });

  const ciclo: { estado: EstadoJornada; em: string | null }[] = [
    { estado: "em_risco", em: f.emRiscoEm },
    { estado: "inativo", em: f.inativoEm },
    { estado: "reativado", em: f.reativadoEm },
  ];
  for (const c of ciclo) {
    const atualDoCiclo = cicloAtual === c.estado;
    passos.push({
      estado: c.estado,
      rotulo:
        ESTADOS_JORNADA.find((e) => e.estado === c.estado)?.rotulo ?? c.estado,
      // Episódio passado (já voltou a girar) fica como feito, com a data.
      situacao: atualDoCiclo ? "atual" : c.em ? "feito" : "futuro",
      em: c.em,
      origem: c.em ? "carteira" : null,
      detalhe: null,
    });
  }

  return { passos, atual };
}
