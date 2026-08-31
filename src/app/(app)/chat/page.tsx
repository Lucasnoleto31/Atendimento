import type { Metadata } from "next";
import { perfilAtual } from "@/lib/auth";
import { agoraEmBrasilia } from "@/lib/format";
import { carregarConversa } from "@/app/(app)/hoje/actions";
import { AppConversas } from "@/app/(app)/conversas/app";
import { carregarListaConversas } from "@/app/(app)/conversas/actions";

export const metadata: Metadata = { title: "Chat · Zeve CRM" };

/**
 * O Chat da Mesa assumiu o /chat (bloco D do redesign). Este server
 * component só monta o PRIMEIRO quadro — a visão Caixa e, num deep link
 * ?lead=, a conversa. Todo gesto seguinte é uma action pontual a partir do
 * cliente; a página nunca se refaz inteira.
 *
 * Os componentes do app seguem em ../conversas (a Janela, que o palco
 * reusa, mora aqui em ./janela — mover seria churn sem ganho).
 */
export default async function ChatPage({
  searchParams,
}: PageProps<"/chat">) {
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
      ? {
          linhas: [],
          contagens: { caixa: 0, aguardando: 0, adiadas: 0, resolvidas: 0 },
          temMais: false,
          etiquetas: [],
        }
      : (carga as Exclude<typeof carga, { erro: string }>);

  let leadInicial = null;
  if (leadPedido && conversaInicial && !("erro" in conversaInicial)) {
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
