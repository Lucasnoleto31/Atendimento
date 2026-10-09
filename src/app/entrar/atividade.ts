/**
 * O carimbo da última atividade, que o middleware usa para derrubar sessão
 * parada há mais de 24h. Mora num arquivo puro porque dois lados precisam do
 * nome: o middleware, que grava e lê, e as actions de entrada e saída, que
 * apagam. Carimbo velho de um login anterior derrubava a sessão que tinha
 * acabado de nascer: quem saía na sexta e entrava na segunda digitava a
 * senha, recebia o código e voltava ao /entrar no primeiro clique.
 */
export const COOKIE_ATIVIDADE = "za_atividade";
