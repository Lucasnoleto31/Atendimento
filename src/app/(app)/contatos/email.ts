/**
 * Conferência mínima de e-mail: algo@algo.algo, sem espaço. Não tenta provar
 * que a caixa existe; só barra o erro de digitação que salvaria lixo na ficha.
 */
export function emailValido(email: string): boolean {
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email);
}
