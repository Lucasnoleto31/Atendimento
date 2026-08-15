import type { Metadata } from "next";
import { ModulePlaceholder } from "@/components/app/module-placeholder";

export const metadata: Metadata = { title: "Administração · Zeve CRM" };

export default function AdminPage() {
  return (
    <ModulePlaceholder
      titulo="Administração"
      descricao="Usuários da equipe, integração com a Meta e as importações diárias."
      itens={[
        "Cadastro de usuários com papel e meta mensal",
        "Webhook do número oficial Meta, com token de verificação",
        "Upload da base de clientes: nome completo, telefone e demais campos",
        "Upload diário de lotes, com histórico de cada importação",
        "Regra de queda de lotes que devolve o cliente para a fila",
      ]}
    />
  );
}
