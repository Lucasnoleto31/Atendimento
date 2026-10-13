/**
 * Esqueleto do Relatório, na forma da tela: título, o bloco "Agora" (espera
 * e conversas abertas) e os últimos 30 dias (os três números, o gráfico por
 * dia, o mapa de calor e os dois rankings). A página soma o mês inteiro no
 * banco e passa fácil de 300ms; sem isto, o toque na aba ficava mudo e
 * parecia que a página "não abria".
 */
const BARRA = "rounded-celula bg-fio motion-safe:animate-pulse";

function Rotulo({ largura }: { largura: string }) {
  return <div className={`ml-2.5 h-[12px] ${largura} ${BARRA}`} />;
}

function Linhas({ quantas }: { quantas: number }) {
  return (
    <div className="mt-1 overflow-hidden rounded-painel bg-cartao">
      {Array.from({ length: quantas }, (_, i) => (
        <div key={i} className="group/linha flex min-h-[48px] pl-2.5">
          <div className="flex flex-1 items-center justify-between gap-2 border-t border-fio pr-2.5 group-first/linha:border-t-0">
            <div className={`h-[16px] w-[140px] max-w-full ${BARRA}`} />
            <div className={`h-[16px] w-[32px] ${BARRA}`} />
          </div>
        </div>
      ))}
    </div>
  );
}

function Ranking() {
  return (
    <div>
      <Rotulo largura="w-[72px]" />
      <div className="mt-1 rounded-painel bg-cartao px-2.5 pt-1 pb-1.5">
        <div className={`my-1 h-[12px] w-[64px] ${BARRA}`} />
        {[0, 1, 2].map((linha) => (
          <div
            key={linha}
            className="flex items-start justify-between gap-2 border-t border-fio py-1.5"
          >
            <div className="min-w-0 flex-1">
              <div className={`h-[16px] w-[160px] max-w-full ${BARRA}`} />
              <div className={`mt-0.5 h-[4px] w-full ${BARRA}`} />
            </div>
            <div className={`h-[16px] w-[48px] ${BARRA}`} />
          </div>
        ))}
      </div>
    </div>
  );
}

export default function CarregandoRelatorio() {
  return (
    <div
      role="status"
      aria-busy="true"
      aria-label="Carregando o relatório"
      className="@container mx-auto w-full max-w-[1120px] px-2 pt-2 pb-4 md:px-3 md:pt-3"
    >
      <header className="flex min-h-[48px] flex-col justify-center">
        <h1 className="tipo-titulo-grande text-tinta">Relatório</h1>
      </header>

      {/* Agora */}
      <div className="mt-3">
        <div className={`h-[22px] w-[72px] ${BARRA}`} />
        <div className="mt-1.5 grid grid-cols-[minmax(0,1fr)] gap-3 @3xl:grid-cols-2 @3xl:items-start">
          <div>
            <Rotulo largura="w-[136px]" />
            <div className="mt-1 rounded-painel bg-cartao">
              <div className="px-2.5 py-2">
                <div className={`h-[30px] w-[56px] ${BARRA}`} />
                <div className={`mt-1 h-[12px] w-[200px] max-w-full ${BARRA}`} />
              </div>
              <div className="border-t border-fio px-2.5 pt-1.5 pb-2">
                <div className={`h-[12px] w-full ${BARRA}`} />
                {[0, 1, 2, 3].map((i) => (
                  <div
                    key={i}
                    className="flex min-h-[32px] items-center justify-between"
                  >
                    <div className={`h-[14px] w-[96px] ${BARRA}`} />
                    <div className={`h-[14px] w-[24px] ${BARRA}`} />
                  </div>
                ))}
              </div>
            </div>
          </div>
          <div>
            <Rotulo largura="w-[136px]" />
            <Linhas quantas={4} />
          </div>
        </div>
      </div>

      {/* Últimos 30 dias */}
      <div className="mt-6">
        <div className={`h-[22px] w-[160px] ${BARRA}`} />

        <div className="mt-1.5">
          <Rotulo largura="w-[96px]" />
          <div className="mt-1 grid overflow-hidden rounded-painel bg-cartao @2xl:grid-cols-3">
            {[0, 1, 2].map((i) => (
              <div
                key={i}
                className="border-t border-fio px-2.5 py-2 first:border-t-0 @2xl:border-t-0 @2xl:border-l @2xl:first:border-l-0"
              >
                <div className={`h-[30px] w-[96px] ${BARRA}`} />
                <div className={`mt-1 h-[12px] w-[120px] ${BARRA}`} />
                <div className={`mt-1 h-[12px] w-[180px] max-w-full ${BARRA}`} />
              </div>
            ))}
          </div>
        </div>

        <div className="mt-4">
          <Rotulo largura="w-[56px]" />
          <div className="mt-1 rounded-painel bg-cartao px-2.5 py-2">
            <div className={`h-[12px] w-[260px] max-w-full ${BARRA}`} />
            <div className={`mt-1 h-[12px] w-[200px] max-w-full ${BARRA}`} />
            <div className="mt-1 h-[147px] rounded-celula bg-fio/50 motion-safe:animate-pulse @3xl:h-[195px]" />
            <div className="h-[22px]" />
          </div>
        </div>

        <div className="mt-4">
          <Rotulo largura="w-[112px]" />
          <div className="mt-1 rounded-painel bg-cartao px-2.5 py-2">
            <div className={`h-[12px] w-[240px] max-w-full ${BARRA}`} />
            <div className="mt-1 h-[166px] rounded-celula bg-fio/50 motion-safe:animate-pulse @3xl:h-[222px]" />
            <div className="h-[20px]" />
          </div>
        </div>

        <div className="mt-4 grid grid-cols-[minmax(0,1fr)] gap-4 @4xl:grid-cols-2 @4xl:items-start">
          <Ranking />
          <Ranking />
        </div>
      </div>
    </div>
  );
}
