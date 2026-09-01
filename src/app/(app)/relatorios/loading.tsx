/**
 * Esqueleto dos Relatórios. A página agrega o mês inteiro no servidor e
 * passa fácil de 300ms — sem isto, o clique no menu ficava mudo e parecia
 * que a página "não abria". A forma espelha a real: título, filtros de
 * período e os blocos de indicadores.
 */
export default function CarregandoRelatorios() {
  return (
    <div
      role="status"
      aria-busy="true"
      aria-label="Carregando os relatórios"
      className="p-2 md:p-3"
    >
      <header className="border-b border-neutral-200 pb-2">
        <h1 className="text-h1 text-neutral-900">Relatórios</h1>
        <p className="mt-1 max-w-[68ch] text-base text-neutral-600">
          Somando o período no banco — só um instante.
        </p>
      </header>

      <div className="mt-2 flex flex-wrap gap-1">
        {[0, 1, 2, 3].map((i) => (
          <div
            key={i}
            className="h-[32px] w-10 animate-pulse rounded-md bg-neutral-100"
          />
        ))}
      </div>

      {[0, 1, 2].map((secao) => (
        <section key={secao} className="mt-3">
          <div className="h-[24px] w-30 animate-pulse rounded-sm bg-neutral-100" />
          <div className="mt-2 grid gap-2 sm:grid-cols-2 lg:grid-cols-4">
            {[0, 1, 2, 3].map((carta) => (
              <div key={carta} className="border-y border-neutral-200 py-2">
                <div className="h-[16px] w-20 animate-pulse rounded-sm bg-neutral-100" />
                <div className="mt-2 h-[32px] w-14 animate-pulse rounded-sm bg-neutral-100" />
                <div className="mt-2 h-[12px] w-24 animate-pulse rounded-sm bg-neutral-100" />
              </div>
            ))}
          </div>
        </section>
      ))}
    </div>
  );
}
