/**
 * O que as actions de cadastro e edição devolvem quando não dá para gravar.
 * O formulário mostra o erro com tudo o que foi digitado ainda nos campos;
 * quando o problema é de um campo só, o erro vai embaixo dele e o foco
 * também. Gravar com sucesso não devolve nada: a action redireciona.
 */
export type CampoContato = "nome" | "telefone" | "email";

export type EstadoFormContato = {
  erro: string | null;
  campo: CampoContato | null;
  /** Muda a cada envio, para o foco voltar ao campo mesmo com o mesmo erro. */
  vez: number;
};
