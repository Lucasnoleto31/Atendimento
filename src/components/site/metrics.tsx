import { Section, SectionHeading } from "@/components/ui/container";
import { Reveal } from "@/components/motion/reveal";

/** TODO: trocar pelos números reais da operação assim que a base for importada. */
const METRICAS = [
  {
    valor: "1.284",
    label: "leads na base",
    detalhe: "cruzados por telefone a cada upload",
  },
  {
    valor: "31%",
    label: "já eram clientes",
    detalhe: "identificados antes do primeiro contato",
  },
  {
    valor: "10",
    label: "instâncias de WhatsApp",
    detalhe: "uma por vendedor, no número oficial Meta",
  },
];

export function Metrics() {
  return (
    <Section
      id="numeros"
      aria-labelledby="numeros-titulo"
      className="border-y border-neutral-200 bg-neutral-0"
    >
      <Reveal>
        <SectionHeading
          eyebrow="Números da operação"
          id="numeros-titulo"
          title="O que a base mostra hoje"
        />
      </Reveal>

      <Reveal delay={0.06}>
        <dl className="mt-3 grid gap-3 sm:grid-cols-3">
          {METRICAS.map((metrica) => (
            <div key={metrica.label}>
              <dt className="sr-only">{metrica.label}</dt>
              <dd>
                <span className="block font-mono text-h1 text-neutral-900 tabular-nums">
                  {metrica.valor}
                </span>
                <span className="mt-0.5 block text-sm font-medium text-neutral-800">
                  {metrica.label}
                </span>
                <span className="mt-0.5 block text-sm text-neutral-600">
                  {metrica.detalhe}
                </span>
              </dd>
            </div>
          ))}
        </dl>
      </Reveal>
    </Section>
  );
}
