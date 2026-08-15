import { ArrowRight, Check } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Container } from "@/components/ui/container";
import { Reveal } from "@/components/motion/reveal";

const PROOF_POINTS = [
  "Telefone do lead cruzado com a sua base de clientes",
  "Origem rastreada até a campanha que gerou o contato",
  "Comissão calculada por produto e por vendedor",
];

export function Hero() {
  return (
    <section className="border-b border-neutral-200 bg-neutral-0 pt-6 pb-8 md:pt-10 md:pb-10">
      <Container>
        <div className="grid items-center gap-6 lg:grid-cols-12 lg:gap-8">
          <div className="lg:col-span-7">
            <Reveal>
              <p className="text-sm font-medium text-primary-600">
                CRM para mesa de vendas
              </p>
              <h1 className="mt-1 max-w-[20ch] text-h1 text-balance text-neutral-900 md:text-display">
                Saiba se o lead já é cliente antes de responder a primeira
                mensagem.
              </h1>
              <p className="mt-3 max-w-[62ch] text-lg text-neutral-600">
                O Zeve CRM cruza o telefone de cada lead com a sua base, mostra
                de onde ele veio, em que etapa do atendimento está e quanto o
                vendedor ganha quando a conta abre.
              </p>

              <div className="mt-4 flex flex-col gap-1 sm:flex-row">
                <Button href="/entrar" size="lg">
                  Entrar no sistema
                  <ArrowRight size={18} strokeWidth={1.5} aria-hidden />
                </Button>
                <Button href="#modulos" variant="secondary" size="lg">
                  Ver os módulos
                </Button>
              </div>

              <ul className="mt-4 flex flex-col gap-1">
                {PROOF_POINTS.map((point) => (
                  <li key={point} className="flex items-start gap-1 text-sm text-neutral-600">
                    <Check
                      size={18}
                      strokeWidth={1.5}
                      className="mt-0.5 shrink-0 text-success"
                      aria-hidden
                    />
                    {point}
                  </li>
                ))}
              </ul>
            </Reveal>
          </div>

          <div className="lg:col-span-5">
            <Reveal delay={0.06}>
              <LeadCard />
            </Reveal>
          </div>
        </div>
      </Container>
    </section>
  );
}

function LeadCard() {
  return (
    <figure className="rounded-lg border border-neutral-200 bg-neutral-0 shadow-md">
      <figcaption className="flex items-center justify-between gap-1 border-b border-neutral-200 px-3 py-2">
        <div>
          <p className="text-base font-semibold text-neutral-900">
            Marina Alves de Souza
          </p>
          <p className="font-mono text-sm text-neutral-600 tabular-nums">
            +55 11 98842-1170
          </p>
        </div>
        <span className="inline-flex h-[20px] shrink-0 items-center rounded-sm bg-success-bg px-1 text-xs text-success">
          Cliente desde 03/2023
        </span>
      </figcaption>

      <dl className="divide-y divide-neutral-200">
        <Row label="Origem" value="Meta Ads" detail="campanha conta-pj-abril" />
        <Row label="Etapa" value="Em negociação" detail="há 2 dias na coluna" />
        <Row label="Vendedor" value="Rafael Lima" detail="instância WhatsApp 04" />
        <Row
          label="Lotes (30d)"
          value="-38%"
          detail="queda acima do limite de 25%"
          tone="warning"
        />
      </dl>

      <div className="flex items-center justify-between gap-2 border-t border-neutral-200 bg-neutral-50 px-3 py-2">
        <div>
          <p className="text-xs tracking-[0.06em] text-neutral-600 uppercase">
            Comissão se abrir conta
          </p>
          <p className="font-mono text-base text-neutral-900 tabular-nums">
            R$ 15,00
          </p>
        </div>
        <span className="text-sm text-neutral-600">Conta PJ · recorrente</span>
      </div>
    </figure>
  );
}

function Row({
  label,
  value,
  detail,
  tone = "default",
}: {
  label: string;
  value: string;
  detail: string;
  tone?: "default" | "warning";
}) {
  return (
    <div className="flex items-baseline justify-between gap-2 px-3 py-1.5">
      <dt className="text-sm text-neutral-600">{label}</dt>
      <dd className="text-right">
        <span
          className={
            tone === "warning"
              ? "font-mono text-sm text-warning tabular-nums"
              : "text-sm font-medium text-neutral-800"
          }
        >
          {value}
        </span>
        <span className="block text-xs text-neutral-400">{detail}</span>
      </dd>
    </div>
  );
}
