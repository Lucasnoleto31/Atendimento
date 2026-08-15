import type { Metadata } from "next";
import { createClient } from "@/lib/supabase/server";
import { KanbanBoard } from "@/components/app/kanban/board";
import type { LeadCard, Stage } from "@/lib/types";

export const metadata: Metadata = { title: "Atendimento · Zeve CRM" };

type LinhaLead = {
  id: string;
  nome: string;
  telefone_e164: string | null;
  customer_id: string | null;
  campanha: string | null;
  stage_id: string | null;
  status: LeadCard["status"];
  entrou_na_etapa_em: string;
  primeira_resposta_em: string | null;
  channel: { nome: string } | null;
  responsavel: { nome: string } | null;
};

export default async function AtendimentoPage() {
  const supabase = await createClient();

  const [{ data: stages }, { data: leads, error }] = await Promise.all([
    supabase
      .from("pipeline_stages")
      .select("id, nome, ordem, is_final")
      .order("ordem"),
    supabase
      .from("leads")
      .select(
        `id, nome, telefone_e164, customer_id, campanha, stage_id, status,
         entrou_na_etapa_em, primeira_resposta_em,
         channel:channels(nome),
         responsavel:profiles(nome)`,
      )
      .order("entrou_na_etapa_em", { ascending: false }),
  ]);

  const cards: LeadCard[] = ((leads ?? []) as unknown as LinhaLead[]).map(
    (l) => ({
      id: l.id,
      nome: l.nome,
      telefone_e164: l.telefone_e164,
      customer_id: l.customer_id,
      campanha: l.campanha,
      stage_id: l.stage_id,
      status: l.status,
      entrou_na_etapa_em: l.entrou_na_etapa_em,
      primeira_resposta_em: l.primeira_resposta_em,
      canal: l.channel?.nome ?? null,
      responsavel: l.responsavel?.nome ?? null,
    }),
  );

  const clientes = cards.filter((c) => c.customer_id !== null).length;
  const semResposta = cards.filter((c) => c.primeira_resposta_em === null).length;

  return (
    <div className="flex min-h-full flex-col">
      <header className="px-2 pt-2 pb-2 md:px-3 md:pt-3">
        <h1 className="text-h1 text-neutral-900">Atendimento</h1>
        <p className="mt-1 text-sm text-neutral-600">
          <span className="font-mono tabular-nums">{cards.length}</span> leads no
          funil · <span className="font-mono tabular-nums">{clientes}</span> já
          são clientes ·{" "}
          <span className="font-mono tabular-nums">{semResposta}</span> nunca
          responderam
        </p>
      </header>

      {error ? (
        <p
          role="alert"
          className="mx-2 rounded-md border border-danger bg-danger-bg px-1.5 py-1 text-sm text-danger md:mx-3"
        >
          Não foi possível carregar os leads.
        </p>
      ) : null}

      {cards.length === 0 && !error ? (
        <div className="mx-2 max-w-[68ch] rounded-lg border border-neutral-200 bg-neutral-0 p-3 shadow-sm md:mx-3">
          <h2 className="text-h3 text-neutral-900">Nenhum lead ainda</h2>
          <p className="mt-1 text-sm text-neutral-600">
            Os leads entram por webhook da Meta, por importação ou por cadastro
            manual. Para ver a tela funcionando agora, rode o arquivo{" "}
            <code className="font-mono text-xs">
              supabase/seeds/dados_exemplo.sql
            </code>{" "}
            no SQL Editor do Supabase.
          </p>
        </div>
      ) : (
        <KanbanBoard stages={(stages ?? []) as Stage[]} leads={cards} />
      )}
    </div>
  );
}
