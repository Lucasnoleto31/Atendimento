import {
  BarChart3,
  Columns3,
  CreditCard,
  Settings,
  ShieldCheck,
  Users,
} from "lucide-react";
import { Section, SectionHeading } from "@/components/ui/container";
import { Reveal } from "@/components/motion/reveal";

const MODULOS = [
  {
    icon: Columns3,
    nome: "Atendimento",
    rota: "/atendimento",
    descricao:
      "Kanban dos leads que estão chegando, com tags, mensagens padrão e a instância de WhatsApp de cada vendedor.",
  },
  {
    icon: Users,
    nome: "Leads",
    rota: "/leads",
    descricao:
      "Base completa com origem, situação de cliente, quanto gastamos por canal e quanto vendemos por produto.",
  },
  {
    icon: CreditCard,
    nome: "Pagamentos",
    rota: "/pagamentos",
    descricao:
      "Últimas operações de venda da equipe, produto por produto, com a comissão de cada vendedor.",
  },
  {
    icon: BarChart3,
    nome: "Relatórios",
    rota: "/relatorios",
    descricao:
      "Leads por etapa, total de clientes, taxa de conversão, distribuição de status, canal e desempenho por vendedor.",
  },
  {
    icon: ShieldCheck,
    nome: "Administração",
    rota: "/admin",
    descricao:
      "Usuários da equipe e webhooks do número oficial Meta, além dos uploads diários de clientes e lotes.",
  },
  {
    icon: Settings,
    nome: "Configurações",
    rota: "/configuracoes",
    descricao:
      "Produtos por código, valor e recorrência, tags de atendimento, mensagens padrão e metas de venda do mês.",
  },
];

export function Modules() {
  return (
    <Section id="modulos" aria-labelledby="modulos-titulo">
      <Reveal>
        <SectionHeading
          eyebrow="Módulos"
          id="modulos-titulo"
          title="As seis telas do sistema"
          description="Cada módulo abaixo vira uma página do CRM. Nenhuma está no ar ainda — a construção começa agora."
        />
      </Reveal>

      <ul className="mt-4 grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
        {MODULOS.map((modulo, index) => {
          const Icon = modulo.icon;
          return (
            <Reveal as="li" key={modulo.nome} delay={(index % 3) * 0.06}>
              <div className="flex h-full flex-col rounded-lg border border-neutral-200 bg-neutral-0 p-3 shadow-sm">
                <div className="flex items-center justify-between gap-1">
                  <Icon
                    size={20}
                    strokeWidth={1.5}
                    className="text-primary-600"
                    aria-hidden
                  />
                  <span className="inline-flex h-[20px] items-center rounded-sm bg-neutral-100 px-1 text-xs text-neutral-600">
                    a construir
                  </span>
                </div>
                <h3 className="mt-1 text-h3 text-neutral-900">{modulo.nome}</h3>
                <p className="mt-0.5 font-mono text-xs text-neutral-400">
                  {modulo.rota}
                </p>
                <p className="mt-1 text-sm text-neutral-600">
                  {modulo.descricao}
                </p>
              </div>
            </Reveal>
          );
        })}
      </ul>
    </Section>
  );
}
