"use client";

/**
 * Última linha de defesa: erro no próprio layout raiz. Aqui o Next descarta
 * a árvore inteira, então o html/body são nossos, e o estilo vai junto, num
 * <style> próprio: o CSS do app pode não ter carregado. Os valores são os da
 * ficha padrão (fundo, tinta, texto-2, fio-forte; o botão principal na
 * tinta), com o tema escuro pelo sistema, já que o cookie do tema não chega
 * até aqui.
 */
const ESTILO = `
  .erro-global {
    margin: 0;
    min-height: 100vh;
    display: flex;
    align-items: center;
    justify-content: center;
    padding: 24px 16px;
    box-sizing: border-box;
    font-family: system-ui, -apple-system, "Segoe UI", sans-serif;
    background: #ffffff;
    color: #111111;
  }
  .erro-global .cartao {
    width: 100%;
    max-width: 440px;
    padding: 24px;
    border-radius: 12px;
    background: #f3f3f3;
    box-sizing: border-box;
  }
  .erro-global h1 { font-size: 20px; line-height: 25px; font-weight: 600; margin: 0; }
  .erro-global p { font-size: 14px; line-height: 20px; color: #555555; margin: 8px 0 0; }
  .erro-global .acoes { display: flex; flex-wrap: wrap; gap: 12px; margin-top: 20px; }
  .erro-global .botao {
    display: inline-flex;
    align-items: center;
    height: 40px;
    padding: 0 16px;
    border-radius: 10px;
    font: inherit;
    font-size: 14px;
    font-weight: 600;
    text-decoration: none;
    cursor: pointer;
    box-sizing: border-box;
  }
  .erro-global .principal { border: 0; background: #111111; color: #ffffff; }
  .erro-global .secundario { border: 1px solid #c4c4c4; background: transparent; color: #111111; }
  .erro-global .botao:focus-visible { outline: 2px solid #111111; outline-offset: 2px; }
  .erro-global code { font-family: ui-monospace, Menlo, Consolas, monospace; font-size: 12px; }
  @media (prefers-color-scheme: dark) {
    .erro-global { background: #0b0b0b; color: #f5f5f5; }
    .erro-global .cartao { background: #151515; }
    .erro-global p { color: #9e9e9e; }
    .erro-global .principal { background: #f5f5f5; color: #0b0b0b; }
    .erro-global .secundario { border-color: #3a3a3a; color: #f5f5f5; }
    .erro-global .botao:focus-visible { outline-color: #f5f5f5; }
  }
`;

export default function ErroGlobal({
  error,
}: {
  error: Error & { digest?: string };
}) {
  return (
    <html lang="pt-BR">
      <body className="erro-global">
        <style>{ESTILO}</style>
        <main className="cartao">
          <h1>O sistema não carregou</h1>
          <p>
            Ele pode ter sido atualizado com esta aba aberta. Recarregue para
            pegar a versão nova.
          </p>
          <div className="acoes">
            <button
              type="button"
              className="botao principal"
              onClick={() => window.location.reload()}
            >
              Recarregar a página
            </button>
            {/* Saída para o chat, sem depender da tela que quebrou. */}
            <a href="/chat" className="botao secundario">
              Ir para o chat
            </a>
          </div>
          {error.digest ? (
            <p>
              Se continuar, mande este código para a administração:{" "}
              <code>{error.digest}</code>
            </p>
          ) : null}
        </main>
      </body>
    </html>
  );
}
