import { Coins, Columns3, PhoneCall } from "lucide-react";
import { Section, SectionHeading } from "@/components/ui/container";
import { Reveal } from "@/components/motion/reveal";

export function Features() {
  return (
    <Section id="recursos" aria-labelledby="recursos-titulo">
      <Reveal>
        <SectionHeading
          eyebrow="Recursos"
          id="recursos-titulo"
          title="O que a planilha e o WhatsApp não resolvem"
          description="Três problemas que a mesa enfrenta todo dia — e como o Zeve CRM trata cada um."
        />
      </Reveal>

      <ul className="mt-4 grid gap-3 md:grid-cols-3">
        <Reveal as="li">
          <FeatureCard
            icon={<PhoneCall size={20} strokeWidth={1.5} aria-hidden />}
            title="Cliente ou não, pelo telefone"
            description="Você sobe a base de clientes e os lotes do dia. O telefone do lead é cruzado na hora, e quem caiu mais de 25% em lotes volta para a fila sozinho."
          >
            <ListsPreview />
          </FeatureCard>
        </Reveal>

        <Reveal as="li" delay={0.06}>
          <FeatureCard
            icon={<Columns3 size={20} strokeWidth={1.5} aria-hidden />}
            title="Kanban com a origem junto"
            description="Cada lead novo entra na coluna com a campanha que o gerou. A equipe atende sabendo de onde veio, e você sabe qual canal paga a conta."
          >
            <KanbanPreview />
          </FeatureCard>
        </Reveal>

        <Reveal as="li" delay={0.12}>
          <FeatureCard
            icon={<Coins size={20} strokeWidth={1.5} aria-hidden />}
            title="Comissão calculada por produto"
            description="Cadastre produto, código, valor e recorrência. Quando o lead abre a conta, a comissão entra no extrato do vendedor que atendeu."
          >
            <CommissionPreview />
          </FeatureCard>
        </Reveal>
      </ul>
    </Section>
  );
}

function FeatureCard({
  icon,
  title,
  description,
  children,
}: {
  icon: React.ReactNode;
  title: string;
  description: string;
  children: React.ReactNode;
}) {
  return (
    <div className="flex h-full flex-col rounded-lg border border-neutral-200 bg-neutral-0 p-3 shadow-sm transition-colors duration-[120ms] hover:border-neutral-300">
      <span className="text-primary-600">{icon}</span>
      <h3 className="mt-1 text-h3 text-neutral-900">{title}</h3>
      <p className="mt-1 text-sm text-neutral-600">{description}</p>
      <div className="mt-3">{children}</div>
    </div>
  );
}

const LISTAS = [
  { label: "Não são clientes", total: "1.284", tone: "default" as const },
  { label: "Só abriram a conta", total: "412", tone: "default" as const },
  { label: "Giraram nos últimos 30 dias", total: "289", tone: "success" as const },
  { label: "Nunca giraram", total: "168", tone: "warning" as const },
  { label: "Sem giro há 60 dias", total: "94", tone: "warning" as const },
];

function ListsPreview() {
  return (
    <div className="overflow-hidden rounded-md border border-neutral-200">
      <p className="border-b border-neutral-200 bg-neutral-50 px-1.5 py-1 text-xs tracking-[0.06em] text-neutral-600 uppercase">
        Listas de atendimento
      </p>
      <ul className="divide-y divide-neutral-200">
        {LISTAS.map((lista) => (
          <li
            key={lista.label}
            className="flex items-center justify-between gap-1 px-1.5 py-1"
          >
            <span className="text-sm text-neutral-800">{lista.label}</span>
            <span
              className={
                lista.tone === "success"
                  ? "font-mono text-sm text-success tabular-nums"
                  : lista.tone === "warning"
                    ? "font-mono text-sm text-warning tabular-nums"
                    : "font-mono text-sm text-neutral-600 tabular-nums"
              }
            >
              {lista.total}
            </span>
          </li>
        ))}
      </ul>
    </div>
  );
}

const COLUNAS = [
  {
    nome: "Novos",
    total: 24,
    cards: [
      { nome: "Bruno Tavares", origem: "Meta Ads" },
      { nome: "Helena Prado", origem: "Indicação" },
    ],
  },
  {
    nome: "Em contato",
    total: 11,
    cards: [{ nome: "Igor Menezes", origem: "Site" }],
  },
];

function KanbanPreview() {
  return (
    <div className="grid grid-cols-2 gap-1.5">
      {COLUNAS.map((coluna) => (
        <div
          key={coluna.nome}
          className="rounded-md border border-neutral-200 bg-neutral-50 p-1"
        >
          <div className="flex items-center justify-between gap-0.5 px-0.5 pb-1">
            <span className="text-xs tracking-[0.06em] text-neutral-600 uppercase">
              {coluna.nome}
            </span>
            <span className="font-mono text-xs text-neutral-600 tabular-nums">
              {coluna.total}
            </span>
          </div>
          <ul className="flex flex-col gap-1">
            {coluna.cards.map((card) => (
              <li
                key={card.nome}
                className="rounded-sm border border-neutral-200 bg-neutral-0 px-1 py-1"
              >
                <p className="truncate text-sm font-medium text-neutral-800">
                  {card.nome}
                </p>
                <p className="mt-0.5 truncate text-xs text-neutral-600">
                  {card.origem}
                </p>
              </li>
            ))}
          </ul>
        </div>
      ))}
    </div>
  );
}

const PRODUTOS = [
  { codigo: "CT-PJ", nome: "Conta PJ", valor: "R$ 15,00", recorrencia: "Recorrente" },
  { codigo: "CT-PF", nome: "Conta PF", valor: "R$ 10,00", recorrencia: "Única" },
  { codigo: "CMB-01", nome: "Câmbio", valor: "R$ 25,00", recorrencia: "Por operação" },
];

function CommissionPreview() {
  return (
    <div className="overflow-hidden rounded-md border border-neutral-200">
      <table className="w-full border-collapse text-left">
        <caption className="sr-only">
          Exemplo de produtos cadastrados e comissão por venda
        </caption>
        <thead>
          <tr className="border-b border-neutral-200 bg-neutral-50">
            <th
              scope="col"
              className="px-1.5 py-1 text-xs tracking-[0.06em] text-neutral-600 uppercase"
            >
              Produto
            </th>
            <th
              scope="col"
              className="px-1.5 py-1 text-right text-xs tracking-[0.06em] text-neutral-600 uppercase"
            >
              Comissão
            </th>
          </tr>
        </thead>
        <tbody className="divide-y divide-neutral-200">
          {PRODUTOS.map((produto) => (
            <tr key={produto.codigo}>
              <td className="px-1.5 py-1">
                <span className="block text-sm text-neutral-800">
                  {produto.nome}
                </span>
                <span className="block font-mono text-xs text-neutral-400">
                  {produto.codigo} · {produto.recorrencia}
                </span>
              </td>
              <td className="px-1.5 py-1 text-right align-top font-mono text-sm text-neutral-900 tabular-nums">
                {produto.valor}
              </td>
            </tr>
          ))}
        </tbody>
        <tfoot>
          <tr className="border-t border-neutral-200 bg-neutral-50">
            <td className="px-1.5 py-1 text-sm text-neutral-600">
              Rafael Lima · agosto
            </td>
            <td className="px-1.5 py-1 text-right font-mono text-sm font-medium text-neutral-900 tabular-nums">
              R$ 1.340,00
            </td>
          </tr>
        </tfoot>
      </table>
    </div>
  );
}
