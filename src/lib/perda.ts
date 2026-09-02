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

/**
 * Perdido não recebe template por 30 dias a contar da perda. Os motores
 * automáticos (cadência, campanha, disparo) já pulam perdido para sempre;
 * este prazo governa o envio manual — depois dele, a decisão de reengajar
 * volta ao humano. Reativar o lead limpa perdido_em (trigger da 0038) e
 * destrava na hora.
 */
export const DIAS_BLOQUEIO_TEMPLATE_PERDIDO = 30;

/** Até quando o template está bloqueado (ISO) — ou null se livre. */
export function templateBloqueadoAte(
  status: string | null | undefined,
  perdidoEm: string | null | undefined,
): string | null {
  if (status !== "perdido" || !perdidoEm) return null;
  const base = Date.parse(perdidoEm);
  if (Number.isNaN(base)) return null;
  const ate = base + DIAS_BLOQUEIO_TEMPLATE_PERDIDO * 86_400_000;
  return Date.now() < ate ? new Date(ate).toISOString() : null;
}

/**
 * Motivos que NUNCA voltam para a nutrição: o número não é da pessoa
 * ("contato_invalido") ou ela disse que não quer ("sem_interesse"). Insistir
 * com quem recusou é o caminho mais curto para virar spam na Meta.
 */
export const MOTIVOS_SEM_VOLTA = new Set<string>([
  "contato_invalido",
  "sem_interesse",
]);

/**
 * Lead perdido volta a receber cadência e campanha depois do prazo da régua
 * (settings.nutrir_perdido_apos_dias). Nunca antes do bloqueio de template
 * dos 30 dias — o mais longo dos dois manda, senão a nutrição dispararia um
 * template que o envio recusa logo em seguida.
 */
export function podeNutrirPerdido(
  status: string | null | undefined,
  perdidoEm: string | null | undefined,
  motivo: string | null | undefined,
  diasRegua: number,
): boolean {
  if (status !== "perdido") return true; // não é perdido: a regra não se aplica
  if (!perdidoEm) return false;
  if (motivo && MOTIVOS_SEM_VOLTA.has(motivo)) return false;
  if (templateBloqueadoAte(status, perdidoEm)) return false;
  const base = Date.parse(perdidoEm);
  if (Number.isNaN(base)) return false;
  return Date.now() >= base + diasRegua * 86_400_000;
}
