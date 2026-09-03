"use client";

/**
 * Última linha de defesa: erro no próprio layout raiz. Aqui o Next descarta
 * a árvore inteira, então o html/body são nossos — estilo inline, sem
 * depender de CSS que pode não ter carregado.
 */
export default function ErroGlobal({
  error,
}: {
  error: Error & { digest?: string };
}) {
  return (
    <html lang="pt-BR">
      <body
        style={{
          margin: 0,
          minHeight: "100vh",
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
          fontFamily: "system-ui, sans-serif",
          background: "#FAFAF9",
          color: "#1C1917",
        }}
      >
        <div style={{ maxWidth: 440, padding: 24, textAlign: "center" }}>
          <h1 style={{ fontSize: 20, margin: 0 }}>Algo saiu do lugar</h1>
          <p style={{ fontSize: 14, color: "#57534E", lineHeight: 1.5 }}>
            O sistema pode ter sido atualizado enquanto esta aba estava
            aberta. Recarregue para pegar a versão nova.
          </p>
          <button
            type="button"
            onClick={() => window.location.reload()}
            style={{
              height: 40,
              padding: "0 16px",
              borderRadius: 6,
              border: 0,
              background: "#1D4ED8",
              color: "#fff",
              fontSize: 14,
              fontWeight: 500,
              cursor: "pointer",
            }}
          >
            Recarregar a página
          </button>
          {error.digest ? (
            <p style={{ fontSize: 12, color: "#A8A29E", fontFamily: "monospace" }}>
              código: {error.digest}
            </p>
          ) : null}
        </div>
      </body>
    </html>
  );
}
