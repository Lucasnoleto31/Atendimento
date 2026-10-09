import type { createClient } from "@/lib/supabase/server";
import {
  JANELA_RECONTATOS_DIAS,
  lerFimRecontato,
  lerRecontato,
  recontatosPendentes,
  type NotaDeAgendamento,
  type Recontato,
} from "./recontato";

/*
 * As leituras dos recontatos, para o servidor (a fila, a conversa e as
 * actions). Sem "use server": nada daqui é action, e todas recebem o
 * cliente com a sessão de quem pede. O RLS de lead_interactions decide o
 * que volta (vejo_lead); a privacidade entre pessoas da equipe fica com
 * quem chama, que já filtra pelos donos ocultos.
 *
 * As notas de agendamento e as de fim saem em duas leituras paralelas, cada
 * uma só com o pedaço de metadados que interessa. Na fila, a janela de
 * JANELA_RECONTATOS_DIAS usa o índice (tipo, criado_em) da 0058, e o filtro
 * por metadados corre linha a linha sobre um ano de notas: a fila inteira
 * (pendentesVisiveis) só é lida quando os contadores, a Caixa ou a visão
 * Recontatos precisam dela. O resto (a página seguinte, a carga sem
 * contador) lê só os contatos da página (pendentesDosLeads).
 */

type Cliente = Awaited<ReturnType<typeof createClient>>;

/** Teto de notas lidas por vez na fila: muito acima do uso da equipe. */
const TETO_NOTAS = 2000;

type LinhaAgendamento = {
  lead_id: string;
  criado_em: string;
  recontato: unknown;
  autor?: { nome: string } | null;
};

type LinhaFim = { fim: unknown };

function agendamentos(linhas: LinhaAgendamento[]): NotaDeAgendamento[] {
  return linhas.flatMap((l) => {
    const dados = lerRecontato(l.recontato);
    return dados
      ? [
          {
            leadId: l.lead_id,
            criadoEm: l.criado_em,
            dados,
            autor: l.autor?.nome ?? null,
          },
        ]
      : [];
  });
}

function encerrados(linhas: LinhaFim[]): Set<string> {
  const ids = new Set<string>();
  for (const l of linhas) {
    const fim = lerFimRecontato(l.fim);
    if (fim) ids.add(fim.id);
  }
  return ids;
}

/**
 * Os recontatos pendentes de um contato, do mais cedo para o mais tarde.
 * null = a leitura falhou (a conversa abre sem a faixa, em vez de dizer que
 * não há nenhum).
 */
export async function pendentesDoLead(
  supabase: Cliente,
  leadId: string,
): Promise<Recontato[] | null> {
  const [agendR, fimR] = await Promise.all([
    supabase
      .from("lead_interactions")
      .select("lead_id, criado_em, recontato:metadados->recontato, autor:profiles(nome)")
      .eq("lead_id", leadId)
      .eq("tipo", "nota")
      .not("metadados->>recontato", "is", null)
      .order("criado_em", { ascending: false })
      .limit(200),
    supabase
      .from("lead_interactions")
      .select("fim:metadados->recontato_fim")
      .eq("lead_id", leadId)
      .eq("tipo", "nota")
      .not("metadados->>recontato_fim", "is", null)
      .limit(400),
  ]);
  if (agendR.error || fimR.error) return null;
  return recontatosPendentes(
    agendamentos((agendR.data ?? []) as unknown as LinhaAgendamento[]),
    encerrados((fimR.data ?? []) as unknown as LinhaFim[]),
  );
}

/**
 * Os recontatos pendentes de todos os contatos que a pessoa vê, do mais
 * cedo para o mais tarde. null = a leitura falhou.
 */
export async function pendentesVisiveis(
  supabase: Cliente,
): Promise<Recontato[] | null> {
  const desde = new Date(
    Date.now() - JANELA_RECONTATOS_DIAS * 86_400_000,
  ).toISOString();
  const [agendR, fimR] = await Promise.all([
    supabase
      .from("lead_interactions")
      .select("lead_id, criado_em, recontato:metadados->recontato")
      .eq("tipo", "nota")
      .gte("criado_em", desde)
      .not("metadados->>recontato", "is", null)
      .order("criado_em", { ascending: false })
      .limit(TETO_NOTAS),
    supabase
      .from("lead_interactions")
      .select("fim:metadados->recontato_fim")
      .eq("tipo", "nota")
      .gte("criado_em", desde)
      .not("metadados->>recontato_fim", "is", null)
      .order("criado_em", { ascending: false })
      .limit(TETO_NOTAS),
  ]);
  if (agendR.error || fimR.error) return null;
  return recontatosPendentes(
    agendamentos((agendR.data ?? []) as unknown as LinhaAgendamento[]),
    encerrados((fimR.data ?? []) as unknown as LinhaFim[]),
  );
}

/**
 * Os recontatos pendentes só destes contatos (até 300, os de uma página da
 * fila), do mais cedo para o mais tarde. Vai pelo índice (lead_id,
 * criado_em) da 0001, na mesma janela da fila: é a leitura barata da página
 * seguinte e das cargas sem contador, que não precisam da fila inteira.
 * null = a leitura falhou.
 */
export async function pendentesDosLeads(
  supabase: Cliente,
  leadIds: string[],
): Promise<Recontato[] | null> {
  if (leadIds.length === 0) return [];
  const desde = new Date(
    Date.now() - JANELA_RECONTATOS_DIAS * 86_400_000,
  ).toISOString();
  const [agendR, fimR] = await Promise.all([
    supabase
      .from("lead_interactions")
      .select("lead_id, criado_em, recontato:metadados->recontato")
      .in("lead_id", leadIds)
      .eq("tipo", "nota")
      .gte("criado_em", desde)
      .not("metadados->>recontato", "is", null)
      .order("criado_em", { ascending: false })
      .limit(TETO_NOTAS),
    supabase
      .from("lead_interactions")
      .select("fim:metadados->recontato_fim")
      .in("lead_id", leadIds)
      .eq("tipo", "nota")
      .gte("criado_em", desde)
      .not("metadados->>recontato_fim", "is", null)
      .order("criado_em", { ascending: false })
      .limit(TETO_NOTAS),
  ]);
  if (agendR.error || fimR.error) return null;
  return recontatosPendentes(
    agendamentos((agendR.data ?? []) as unknown as LinhaAgendamento[]),
    encerrados((fimR.data ?? []) as unknown as LinhaFim[]),
  );
}

/** O mais cedo de cada contato, na ordem que veio (do mais cedo para o
 *  mais tarde). */
export function primeiroDeCada(pendentes: Recontato[]): Map<string, Recontato> {
  const mapa = new Map<string, Recontato>();
  for (const r of pendentes) {
    if (!mapa.has(r.leadId)) mapa.set(r.leadId, r);
  }
  return mapa;
}
