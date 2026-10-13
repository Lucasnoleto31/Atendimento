/**
 * A tela do autenticador só existe no computador de quem testa: no
 * `next dev`, e no `next start` local (o sistema "como no ar") quando o
 * .env.local tem AUTENTICADOR_LOCAL="1". A Vercel não tem essa variável, e
 * lá a página não existe.
 */
export function autenticadorLiberado(): boolean {
  return (
    process.env.NODE_ENV !== "production" ||
    process.env.AUTENTICADOR_LOCAL === "1"
  );
}
