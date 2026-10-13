/** Classes repetidas nas telas de /entrar, na ficha padrão do kit. */

/** Link de texto sempre sublinhado, na tinta: o "Esqueci a senha" ao lado do
 *  "Lembrar meu e-mail". 32px de altura (44 no toque) para o dedo acertar
 *  sem esbarrar no vizinho. */
export const LINK_SUBLINHADO =
  "inline-flex min-h-[32px] items-center rounded-celula text-sm text-tinta underline underline-offset-[0.2em] transition-colors duration-[120ms] hover:text-texto-2 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-tinta pointer-coarse:min-h-[44px]";

/** "← Voltar ao login" acima do título, onde o iOS põe o voltar. O -ml
 *  alinha a seta com a borda do texto e deixa o fundo do hover sobrar. */
export const LINK_VOLTAR =
  "-ml-1 inline-flex h-[40px] items-center gap-0.5 rounded-controle px-1 text-sm text-texto-2 transition-colors duration-[120ms] hover:bg-realce hover:text-tinta focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-tinta pointer-coarse:h-[44px]";

/** Erro do envio, acima do botão: faixa no cartão sobre o fundo da página,
 *  com a semântica só no texto. */
export const CAIXA_ERRO =
  "rounded-controle bg-cartao px-1.5 py-1 text-sm text-erro";

/** Aviso de que deu certo ("Sua senha foi trocada…"). */
export const CAIXA_AVISO =
  "rounded-controle bg-cartao px-1.5 py-1 text-sm text-bom";

/** Rótulo dos campos de linha: pequeno e em cinza, acima da linha, sempre à
 *  vista (o placeholder não faz o papel dele). */
export const ROTULO_LINHA = "tipo-nota text-texto-2";

/**
 * Campo de linha: sem caixa, só o fio embaixo, como no desenho da entrada.
 * O foco engrossa o fio para 2px na tinta (a segunda linha é sombra, para a
 * altura não mudar), e esse é o indicador de foco do campo: o anel em volta
 * desenharia a caixa que o desenho tirou. outline-hidden, e não none: no
 * modo de alto contraste do sistema a sombra some, e o contorno transparente
 * vira visível. Com erro, o fio fica na semântica de erro, e o foco também
 * o engrossa (1px parado, 2px com o foco), para o foco continuar à vista.
 */
export const LINHA_CAMPO =
  "border-b border-fio-forte transition-[border-color,box-shadow] duration-[120ms]";
export const LINHA_FOCO =
  "hover:border-texto-3 has-[input:focus]:border-tinta has-[input:focus]:shadow-[inset_0_-1px_0_0_var(--color-tinta)]";
export const LINHA_ERRO =
  "border-erro has-[input:focus]:shadow-[inset_0_-1px_0_0_var(--color-erro)]";

/**
 * O preenchimento automático do navegador pinta o campo de azul ou amarelo
 * com !important no fundo, e no campo de linha isso vira uma caixa colorida.
 * A sombra interna cobre essa cor com o fundo da página, e a cor do texto
 * volta à tinta. As duas grafias: o Safari só conhece a com prefixo, e uma
 * pseudo-classe desconhecida numa lista invalidaria a regra inteira.
 */
export const SEM_COR_DE_AUTOFILL =
  "autofill:shadow-[inset_0_0_0_1000px_var(--color-fundo)] autofill:[-webkit-text-fill-color:var(--color-tinta)] [&:-webkit-autofill]:shadow-[inset_0_0_0_1000px_var(--color-fundo)] [&:-webkit-autofill]:[-webkit-text-fill-color:var(--color-tinta)]";

/**
 * Botão principal cinza enquanto falta preencher: o formulário leva
 * className="group/form", e qualquer campo :invalid (obrigatório vazio,
 * e-mail fora do formato) apaga o botão. Só a aparência: o botão continua
 * clicável, e o clique mostra o aviso do próprio navegador no campo que
 * falta. Desativar de verdade travaria quem tem a senha preenchida pelo
 * navegador, que o Chrome só entrega ao script depois do primeiro toque na
 * página: o botão ficaria morto com os dois campos cheios à vista. O
 * texto-2 no fio passa AA (5,9:1 no claro, 5,6:1 no escuro), porque o botão
 * continua sendo um controle ativo.
 */
export const BOTAO_ESPERA_PREENCHER =
  "group-has-[input:invalid]/form:bg-fio group-has-[input:invalid]/form:text-texto-2 group-has-[input:invalid]/form:hover:bg-fio";

/**
 * Campo do código de nova senha: grande, em algarismo tabular, dígitos
 * espaçados e centrados (o indent compensa o espaço que o tracking deixa
 * depois do último dígito), no mesmo desenho de linha dos outros campos.
 * Leva data-texto-grande no elemento, senão a regra do toque no globals.css
 * o encolheria para 16px. O erro pinta o fio pelo aria-invalid, que vence o
 * hover e o foco (o foco segue engrossando o fio, agora na cor do erro).
 */
export const CAMPO_CODIGO = `tipo-titulo-1 h-[56px] w-full rounded-none ${LINHA_CAMPO} bg-transparent px-1.5 text-center indent-[0.3em] tracking-[0.3em] text-tinta tabular-nums outline-hidden hover:border-texto-3 focus:border-tinta focus:shadow-[inset_0_-1px_0_0_var(--color-tinta)] aria-[invalid=true]:border-erro aria-[invalid=true]:hover:border-erro aria-[invalid=true]:focus:border-erro aria-[invalid=true]:focus:shadow-[inset_0_-1px_0_0_var(--color-erro)] ${SEM_COR_DE_AUTOFILL}`;
