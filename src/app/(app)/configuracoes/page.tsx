import { redirect } from "next/navigation";

/**
 * Configurações virou parte da Administração em 09/10/2026 (uma entrada só
 * no menu). O desvio de /configuracoes para /admin mora no next.config.ts,
 * com a query junto; esta página só responde se aquele desvio sair, e faz o
 * mesmo: o ?abrir= de um link antigo continua abrindo o editor certo (o
 * /admin leva cada chave à subpágina dela).
 */
export default async function ConfiguracoesPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const params = await searchParams;
  const destino = new URLSearchParams();
  for (const [nome, valor] of Object.entries(params)) {
    const v = Array.isArray(valor) ? valor[0] : valor;
    if (typeof v === "string" && v) destino.set(nome, v);
  }
  const query = destino.toString();
  redirect(query ? `/admin?${query}` : "/admin");
}
