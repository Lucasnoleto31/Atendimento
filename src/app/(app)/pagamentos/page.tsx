import type { Metadata } from "next";
import { ModulePlaceholder } from "@/components/app/module-placeholder";

export const metadata: Metadata = { title: "Pagamentos · Zeve CRM" };

export default function PagamentosPage() {
  return (
    <ModulePlaceholder
      titulo="Pagamentos"
      descricao="As últimas operações de venda de toda a equipe, produto por produto."
      itens={[
        "Extrato de vendas com data, vendedor, produto e comissão",
        "Comissão congelada no valor que o produto tinha na data da venda",
        "Filtro por período, vendedor e produto",
        "Total por vendedor no mês, comparado com a meta",
        "Exportação para conferência do financeiro",
      ]}
    />
  );
}
