import type { Metadata } from "next";
import { CAMPO } from "@/components/app/form-styles";
import { capturarLead } from "./actions";

export const metadata: Metadata = {
  title: "Fale com a Zeve",
  description:
    "Deixe seu nome e WhatsApp e um assessor da Zeve fala com você.",
};

/**
 * A página pública de captura (Fase 7.1): nome + WhatsApp, nada mais — é a
 * página de destino de anúncio, aberta no celular. Campanha/etiqueta/origem
 * viajam pela URL (?campanha=&etiqueta=&utm_*) e atravessam o formulário em
 * campos escondidos. A action faz todo o resto (honeypot, rate limit,
 * dedupe, rodízio) — aqui não há nem um if de negócio.
 */
export default async function CapturaPage({
  searchParams,
}: PageProps<"/captura">) {
  const params = await searchParams;
  const ok = params.ok === "1";
  const erro = typeof params.erro === "string" ? params.erro : null;
  const rastreio = (
    [
      "campanha",
      "etiqueta",
      "utm_source",
      "utm_medium",
      "utm_campaign",
      "utm_content",
    ] as const
  )
    .map((chave) => ({
      chave,
      valor: typeof params[chave] === "string" ? (params[chave] as string) : "",
    }))
    .filter((c) => c.valor !== "");

  return (
    <main className="flex min-h-dvh flex-1 items-center justify-center bg-neutral-50 px-2 py-8">
      <div className="w-full max-w-[400px]">
        <p className="inline-flex items-center gap-1">
          <span
            aria-hidden
            className="flex h-[28px] w-[28px] items-center justify-center rounded-md bg-primary-600 font-mono text-sm text-neutral-0"
          >
            Z
          </span>
          <span className="text-base font-semibold text-neutral-900">Zeve</span>
        </p>

        <div className="mt-3 rounded-lg border border-neutral-200 bg-neutral-0 p-3 shadow-sm">
          {ok ? (
            <>
              <h1 className="text-h2 text-neutral-900">Recebemos seu contato</h1>
              <p className="mt-1 text-sm text-neutral-600">
                Um assessor da Zeve fala com você pelo WhatsApp em breve. Pode
                fechar esta página.
              </p>
            </>
          ) : (
            <>
              <h1 className="text-h2 text-neutral-900">Fale com a Zeve</h1>
              <p className="mt-1 text-sm text-neutral-600">
                Deixe seu nome e WhatsApp — um assessor fala com você.
              </p>

              {erro ? (
                <p
                  role="alert"
                  className="mt-2 rounded-md border border-warning bg-warning-bg px-1.5 py-1 text-sm text-warning"
                >
                  {erro}
                </p>
              ) : null}

              <form action={capturarLead} className="mt-3 flex flex-col gap-2">
                {rastreio.map((c) => (
                  <input
                    key={c.chave}
                    type="hidden"
                    name={c.chave}
                    value={c.valor}
                  />
                ))}

                {/* Honeypot: invisível para gente, irresistível para robô.
                    aria-hidden + tabIndex fora do fluxo — leitor de tela e
                    teclado nunca chegam aqui. */}
                <div aria-hidden className="absolute -left-[9999px] top-auto h-px w-px overflow-hidden">
                  <label htmlFor="captura-website">Website</label>
                  <input
                    id="captura-website"
                    name="website"
                    type="text"
                    tabIndex={-1}
                    autoComplete="off"
                  />
                </div>

                <div className="flex flex-col gap-1">
                  <label
                    htmlFor="captura-nome"
                    className="text-sm font-medium text-neutral-800"
                  >
                    Nome
                  </label>
                  <input
                    id="captura-nome"
                    name="nome"
                    required
                    maxLength={120}
                    autoComplete="name"
                    className={CAMPO}
                  />
                </div>

                <div className="flex flex-col gap-1">
                  <label
                    htmlFor="captura-telefone"
                    className="text-sm font-medium text-neutral-800"
                  >
                    WhatsApp (com DDD)
                  </label>
                  <input
                    id="captura-telefone"
                    name="telefone"
                    required
                    inputMode="tel"
                    autoComplete="tel"
                    placeholder="62 98181-0004"
                    maxLength={20}
                    className={CAMPO}
                  />
                </div>

                <button
                  type="submit"
                  className="inline-flex h-[48px] items-center justify-center rounded-md bg-primary-600 px-2 text-base font-medium text-neutral-0 transition-colors duration-[120ms] hover:bg-primary-700 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-primary-500"
                >
                  Quero falar com um assessor
                </button>
              </form>
            </>
          )}
        </div>

        <p className="mt-2 text-xs text-neutral-600">
          Seus dados são usados só para este contato — nada de lista de
          e-mail nem repasse a terceiros.
        </p>
      </div>
    </main>
  );
}
