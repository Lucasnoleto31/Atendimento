export function ModulePlaceholder({
  titulo,
  descricao,
  itens,
}: {
  titulo: string;
  descricao: string;
  itens: string[];
}) {
  return (
    <div className="p-2 md:p-3">
      <header className="border-b border-neutral-200 pb-2">
        <h1 className="text-h1 text-neutral-900">{titulo}</h1>
        <p className="mt-1 max-w-[68ch] text-base text-neutral-600">
          {descricao}
        </p>
      </header>

      <section className="mt-3 max-w-[68ch] rounded-lg border border-neutral-200 bg-neutral-0 p-3 shadow-sm">
        <h2 className="text-h3 text-neutral-900">Ainda não construído</h2>
        <p className="mt-1 text-sm text-neutral-600">
          O que esta tela vai ter:
        </p>
        <ul className="mt-2 flex flex-col gap-1">
          {itens.map((item) => (
            <li
              key={item}
              className="flex gap-1 text-sm text-neutral-800 before:text-neutral-400 before:content-['—']"
            >
              {item}
            </li>
          ))}
        </ul>
      </section>
    </div>
  );
}
