/**
 * Esqueleto dos Disparos, na forma da tela: título com o botão de criar, o
 * cartão do número do WhatsApp e os cartões das campanhas. A página conta o
 * público de cada etiqueta e o progresso de cada campanha no banco e, uma vez
 * por dia, pergunta a nota do número à Meta; sem isto, o toque na aba ficava
 * mudo até tudo voltar.
 */
const BARRA = "rounded-celula bg-fio motion-safe:animate-pulse";

export default function CarregandoDisparos() {
  return (
    <div
      role="status"
      aria-busy="true"
      aria-label="Carregando os disparos"
      className="@container mx-auto w-full max-w-[1120px] px-2 pt-2 pb-4 md:px-3 md:pt-3"
    >
      <header className="flex min-h-[48px] items-center justify-between gap-2">
        <h1 className="tipo-titulo-grande text-tinta">Disparos</h1>
        <div className="h-[44px] w-[44px] rounded-full bg-cartao md:h-[40px] md:w-[148px] md:rounded-controle" />
      </header>

      <div className="mt-3">
        <div className={`ml-2.5 h-[12px] w-[160px] ${BARRA}`} />
        {/* Como a tela: no telefone o teto na largura toda e as outras duas
            lado a lado; no contêiner largo, as três numa linha. */}
        <div className="mt-1 grid grid-cols-2 overflow-hidden rounded-painel bg-cartao @2xl:grid-cols-3">
          <div className="col-span-2 border-b border-fio px-2.5 py-2 @2xl:col-span-1 @2xl:border-b-0">
            <div className={`h-[24px] w-[88px] ${BARRA}`} />
            <div className={`mt-1 h-[12px] w-[160px] max-w-full ${BARRA}`} />
            <div className={`mt-1 h-[4px] w-full ${BARRA}`} />
          </div>
          {[0, 1].map((i) => (
            <div
              key={i}
              className={`border-fio px-2.5 py-2 @2xl:border-l ${i === 0 ? "border-r @2xl:border-r-0" : ""}`}
            >
              <div className={`h-[24px] w-[72px] ${BARRA}`} />
              <div className={`mt-1 h-[12px] w-[120px] max-w-full ${BARRA}`} />
            </div>
          ))}
        </div>
      </div>

      <div className="mt-4">
        <div className={`ml-2.5 h-[12px] w-[96px] ${BARRA}`} />
        <div className="mt-1 grid gap-1.5 @4xl:grid-cols-2">
          {[0, 1].map((i) => (
            <div key={i} className="rounded-painel bg-cartao p-2.5">
              <div className={`h-[18px] w-[180px] max-w-full ${BARRA}`} />
              <div className={`mt-0.5 h-[12px] w-[140px] max-w-full ${BARRA}`} />
              <div className={`mt-2 h-[24px] w-[120px] ${BARRA}`} />
              <div className={`mt-1 h-[4px] w-full ${BARRA}`} />
              <div className={`mt-1 h-[12px] w-[220px] max-w-full ${BARRA}`} />
              <div className="mt-2 flex gap-1.5">
                <div className={`h-[40px] w-[96px] ${BARRA}`} />
                <div className={`h-[40px] w-[80px] ${BARRA}`} />
              </div>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}
