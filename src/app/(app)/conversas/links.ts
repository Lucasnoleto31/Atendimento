import { comVoltar } from "@/app/(app)/contatos/voltar";

/**
 * Endereço da ficha (ou da edição) do contato aberto a partir do chat, com o
 * caminho de volta para a mesma conversa E a mesma fila: `voltar` é o
 * hrefConversa da conversa em cena (lead, visão, escopo, busca, atendente e
 * etiqueta). A ficha lê o ?voltar= (validado por lerVoltar) e mostra
 * "← Voltar à conversa"; a volta reabre a fila como a pessoa a deixou, não a
 * Caixa crua.
 */
export function hrefContatoDoChat(
  leadId: string,
  voltar: string,
  pagina: "ficha" | "editar" = "ficha",
): string {
  const id = encodeURIComponent(leadId);
  return comVoltar(
    `/contatos/${id}${pagina === "editar" ? "/editar" : ""}`,
    voltar,
  );
}
