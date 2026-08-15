import type { Metadata } from "next";
import { ModulePlaceholder } from "@/components/app/module-placeholder";

export const metadata: Metadata = { title: "Relatórios · Zeve CRM" };

export default function RelatoriosPage() {
  return (
    <ModulePlaceholder
      titulo="Relatórios"
      descricao="O quadro da operação: onde os leads estão, quanto convertem e quem está vendendo."
      itens={[
        "Leads por etapa e total de leads",
        "Total de clientes e taxa de conversão",
        "Quantos estão em andamento e distribuição de status",
        "Detalhamento por canal, com custo e retorno",
        "Desempenho por vendedor e detalhamento por etapa",
      ]}
    />
  );
}
