import type { Metadata } from "next";
import { ModulePlaceholder } from "@/components/app/module-placeholder";

export const metadata: Metadata = { title: "Leads · Zeve CRM" };

export default function LeadsPage() {
  return (
    <ModulePlaceholder
      titulo="Leads"
      descricao="A base completa, com filtro por origem, etapa, responsável e situação de cliente."
      itens={[
        "Tabela com telefone, origem, campanha, etapa e responsável",
        "Marcação de cliente feita pelo cruzamento de telefone",
        "Quanto gastamos por canal e por campanha",
        "Quanto vendemos por produto",
        "Ficha do lead com histórico de interações",
      ]}
    />
  );
}
