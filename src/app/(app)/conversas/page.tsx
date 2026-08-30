import { redirect } from "next/navigation";

/**
 * O Chat da Mesa nasceu aqui enquanto o /chat antigo ainda vivia; no bloco D
 * ele assumiu o /chat de vez. Este redirect segura os links e favoritos do
 * período de transição — inclusive os deep links ?lead=.
 */
export default async function ConversasPage({
  searchParams,
}: PageProps<"/conversas">) {
  const params = await searchParams;
  const lead = typeof params.lead === "string" ? params.lead : null;
  redirect(lead ? `/chat?lead=${lead}` : "/chat");
}
