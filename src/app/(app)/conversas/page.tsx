import { redirect } from "next/navigation";

/** O que o /chat lê da URL: a conversa, os filtros da fila e a volta. */
const REPASSADOS = [
  "lead",
  "visao",
  "escopo",
  "busca",
  "atendente",
  "etiqueta",
  "voltar",
] as const;

/**
 * O Chat da Mesa nasceu aqui enquanto o /chat antigo ainda vivia; no bloco D
 * ele assumiu o /chat de vez. Este redirect segura os links e favoritos do
 * período de transição: o ?lead= e, desde que o chat guarda a fila na URL,
 * os filtros e o ?voltar=. Cada valor sai codificado (cru, um
 * ?lead=x%26y%3D1 virava /chat?lead=x&y=1, parâmetro injetado no destino);
 * quem valida é o /chat.
 */
export default async function ConversasPage({
  searchParams,
}: PageProps<"/conversas">) {
  const params = await searchParams;
  const destino = new URLSearchParams();
  for (const chave of REPASSADOS) {
    const valor = params[chave];
    if (typeof valor === "string" && valor) destino.set(chave, valor);
  }
  const query = destino.toString();
  redirect(query ? `/chat?${query}` : "/chat");
}
