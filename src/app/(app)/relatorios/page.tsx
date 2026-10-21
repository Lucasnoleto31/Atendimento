import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { perfilAtual } from "@/lib/auth";
import { ehGestao, veTudo } from "@/lib/papeis";
import { carregarRelatorio } from "./dados";
import { lerPeriodo } from "./periodo";
import { PainelRelatorio } from "./painel";
import { titulo } from "@/lib/marca";

export const metadata: Metadata = {
  title: titulo("Relatório"),
};

/**
 * Como o atendimento anda: quem espera agora e com quem estão as conversas,
 * e, nos últimos 30 dias, quanto chega, quanto sai, em quanto tempo a
 * equipe responde, em que horário e quem resolve. As leituras moram em
 * dados.ts; o desenho, em painel.tsx.
 */
export default async function RelatoriosPage({
  searchParams,
}: PageProps<"/relatorios">) {
  // O perfil vem antes das leituras: quem não vê a base inteira é mandado
  // embora sem disparar as quase 50 idas ao banco do relatório.
  const [perfil, { periodo }] = await Promise.all([
    perfilAtual(),
    searchParams,
  ]);

  // Relatório é da mesa inteira: gestão e compliance.
  if (!perfil || !veTudo(perfil.papel)) redirect("/chat");

  // A carga por pessoa segue a regra do chat: só gestão. O período
  // (?periodo=hoje|7d; sem ele, 30 dias) vale para os números de cima, a
  // Equipe e as Resolvidas.
  const dados = await carregarRelatorio({
    comCarga: ehGestao(perfil.papel),
    periodo: lerPeriodo(periodo),
  });

  return <PainelRelatorio dados={dados} />;
}
