/**
 * O que as actions de Configurações e Administração devolvem para a tela.
 * Fora dos arquivos "use server" e do cliente: os dois lados importam daqui
 * (só o tipo e os textos; nenhuma função vira endpoint).
 *
 * `ok` é o aviso curto que aparece depois de gravar ("Mensagem salva");
 * `erro` fica no formulário, acima do botão, com o que foi digitado.
 */
export type ResultadoAcao = { ok?: string; erro?: string };

/** 1 contato · 1.234 contatos, no formato brasileiro. */
export function contagem(n: number, singular: string, plural: string): string {
  return `${n.toLocaleString("pt-BR")} ${n === 1 ? singular : plural}`;
}
