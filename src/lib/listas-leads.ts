/**
 * Filas da página Leads em que o disparo de template em massa faz sentido, e a
 * coluna de v_leads_listas que define cada uma.
 *
 * Vive aqui, e não dentro da página, porque tela e disparo têm de concordar.
 * Quando as listas foram refeitas (0032) só a página acompanhou: o botão de
 * disparo continuou reconhecendo as filas antigas e passou a responder "Fila
 * inválida para disparo" para todas as novas. Uma constante em dois arquivos
 * é uma constante que vai divergir.
 */
export const COLUNA_DISPARO: Record<string, string> = {
  primeiro_giro: "primeiro_giro_recente",
  sem_giro_ja_conversou: "sem_giro_ja_conversou",
  primeiro_giro_parado: "primeiro_giro_dormente",
  nunca_contatado: "nunca_contatado",
  giro_em_risco: "giro_em_risco",
};

export const LISTAS_DISPARO = new Set(Object.keys(COLUNA_DISPARO));

/** Coluna booleana de v_leads_listas para cada fila da tela. */
export const COLUNA_LISTA: Record<string, string> = {
  aguardando: "aguardando_resposta",
  janela_aberta: "janela_aberta",
  adiado_vencido: "adiado_vencido",
  responderam_sem_conta: "quente_sem_conta",
  primeiro_giro: "primeiro_giro_recente",
  sem_giro_ja_conversou: "sem_giro_ja_conversou",
  primeiro_giro_parado: "primeiro_giro_dormente",
  giro_em_risco: "giro_em_risco",
  girando: "girando",
  sem_dono: "sem_dono",
  nunca_contatado: "nunca_contatado",
  nao_contatavel: "nao_contatavel",
  // "todos" não tem coluna: é a base inteira.
};
