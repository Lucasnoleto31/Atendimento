import type { Metadata } from "next";
import { ModulePlaceholder } from "@/components/app/module-placeholder";

export const metadata: Metadata = { title: "Configurações · Zeve CRM" };

export default function ConfiguracoesPage() {
  return (
    <ModulePlaceholder
      titulo="Configurações"
      descricao="O que a equipe usa no dia a dia: produtos, tags, mensagens e instâncias."
      itens={[
        "Produtos por código, nome, valor e recorrência",
        "Tags de atendimento para a troca de mensagens",
        "Mensagens padrão para disparar ao lead",
        "Até 10 instâncias de WhatsApp, uma por vendedor",
        "Metas de venda do mês por vendedor",
      ]}
    />
  );
}
