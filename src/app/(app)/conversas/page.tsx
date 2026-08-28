import type { Metadata } from "next";
import { perfilAtual } from "@/lib/auth";
import { agoraEmBrasilia } from "@/lib/format";
import { carregarConversa } from "@/app/(app)/hoje/actions";
import { AppConversas } from "./app";
import { carregarListaConversas } from "./actions";

export const metadata: Metadata = { title: "Conversas · Zeve CRM" };

/**
 * O Chat da Mesa (redesign aprovado): este server component só monta o
 * PRIMEIRO quadro — a visão Caixa e, num deep link ?lead=, a conversa. Todo
 * gesto seguinte é uma action pontual a partir do cliente; a página nunca
 * mais se refaz inteira.
 *
 * Vive em /conversas enquanto o Bloco B não termina; aí assume o /chat.
 */
export default async function ConversasPage({
  searchParams,
}: PageProps<"/conversas">) {
  const params = await searchParams;
  const perfil = await perfilAtual();
  if (!perfil) return null; // o layout do grupo já redireciona sem sessão

  const leadPedido = typeof params.lead === "string" ? params.lead : null;

  const [carga, conversaInicial] = await Promise.all([
    carregarListaConversas("caixa", { escopo: "todas" }),
    leadPedido ? carregarConversa(leadPedido) : Promise.resolve(null),
  ]);

  const inicial =
    "erro" in (carga as { erro?: string })
      ? { linhas: [], contagens: { caixa: 0, aguardando: 0, adiadas: 0 }, temMais: false }
      : (carga as Exclude<typeof carga, { erro: string }>);

  let leadInicial = null;
  if (leadPedido && conversaInicial && !("erro" in conversaInicial)) {
    // O nome vem da própria carga da conversa (a action devolve).
    leadInicial = {
      leadId: leadPedido,
      nome: conversaInicial.nome,
      dados: conversaInicial,
    };
  }

  return (
    <AppConversas
      inicial={inicial}
      hojeChave={new Date(
        `${agoraEmBrasilia().dia}T12:00:00-03:00`,
      ).toLocaleDateString("pt-BR", { timeZone: "America/Sao_Paulo" })}
      leadInicial={leadInicial}
    />
  );
}
