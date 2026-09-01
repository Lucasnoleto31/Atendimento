/**
 * O roteiro de ativação, na ordem em que acontece. Arquivo próprio (sem
 * imports de servidor) porque o painel do chat — client component — também
 * precisa da lista.
 *
 * `auto` marca os passos que NASCEM dos fatos e não aceitam marcação manual:
 *   · conta_aprovada    ← customers.conta_aberta_em (cruzamento da Genial)
 *   · primeira_operacao ← primeiro lote em customer_lots (a definição
 *                         canônica de ativação, ver src/lib/ativacao.ts)
 */
export const PASSOS_ATIVACAO = [
  { passo: "link_abertura", rotulo: "Link de abertura enviado", auto: false },
  { passo: "cadastro_iniciado", rotulo: "Cadastro iniciado", auto: false },
  { passo: "conta_aprovada", rotulo: "Conta aprovada", auto: true },
  {
    passo: "codigo_assessor",
    rotulo: "Código do assessor vinculado",
    auto: false,
  },
  { passo: "stvm_custodia", rotulo: "STVM / custódia", auto: false },
  { passo: "deposito", rotulo: "Depósito", auto: false },
  { passo: "plataforma", rotulo: "Plataforma configurada", auto: false },
  { passo: "primeira_operacao", rotulo: "1ª operação", auto: true },
  { passo: "grupo", rotulo: "Entrou no grupo", auto: false },
] as const;

export type PassoAtivacao = (typeof PASSOS_ATIVACAO)[number]["passo"];

export function ehPassoAtivacao(valor: string): valor is PassoAtivacao {
  return PASSOS_ATIVACAO.some((p) => p.passo === valor);
}
