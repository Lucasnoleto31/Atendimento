/**
 * Motivos de perda de lead. Slug no banco, rótulo na tela.
 *
 * A lista é curta de propósito: motivo serve para somar no relatório e
 * orientar a próxima campanha, não para contar a história do atendimento —
 * história é nota na conversa. "Não quer abrir conta" existe porque nem todo
 * mundo que chama quer virar cliente: sem esse motivo, o funil trata
 * curiosidade como derrota da equipe.
 */
export const MOTIVOS_PERDA = {
  sumiu: "Sumiu — parou de responder",
  nunca_respondeu: "Nunca respondeu",
  concorrente: "Fechou com concorrente",
  sem_interesse: "Não quer abrir conta",
  sem_perfil: "Sem capital ou sem perfil agora",
  contato_invalido: "Número errado ou engano",
  outro: "Outro motivo",
} as const;

export type MotivoPerda = keyof typeof MOTIVOS_PERDA;

export function ehMotivoPerda(valor: string): valor is MotivoPerda {
  return valor in MOTIVOS_PERDA;
}

/** Corte "últimos N dias" em ISO, para filtrar perdido_em no relatório. */
export function corteDiasAtras(dias: number): string {
  return new Date(Date.now() - dias * 86_400_000).toISOString();
}
