"use server";

import { createClient } from "@/lib/supabase/server";
import { perfilQueEscreve } from "@/lib/auth";
import { donoOculto, donosOcultosParaMim } from "@/lib/privacidade";
import { ehUuid } from "@/app/(app)/chat/mensagem";

/*
 * As ações em massa da fila que o chat/actions.ts não tem: marcar lida ou
 * não lida e pôr e tirar várias etiquetas de uma vez. Gravam só nas colunas
 * e tabelas de sempre (leads.chat_lido_em, lead_tags), com as policies de
 * sempre: o RLS decide em quais conversas a pessoa mexe, e a privacidade
 * entre a equipe tira as dos donos ocultos antes da escrita, como nas
 * outras ações em massa. Transferir, adiar e resolver em massa continuam em
 * chat/actions.ts.
 */

/** O mesmo teto das outras ações em massa (MAX_EM_MASSA, chat/actions.ts).
 *  A tela manda em lotes deste tamanho. */
const MAX_EM_MASSA = 200;

// O mesmo texto de chat/actions.ts.
const SEM_PERMISSAO =
  "Sem permissão para alterar: o perfil é só de leitura ou a sessão expirou.";

type Resultado = { ok?: true; total?: number; erro?: string };

type Cliente = Awaited<ReturnType<typeof createClient>>;

function idsValidos(valor: unknown, teto: number): string[] {
  return Array.isArray(valor)
    ? [...new Set(valor.filter((v) => ehUuid(v)))].slice(0, teto)
    : [];
}

/**
 * Das conversas pedidas, só as que a pessoa vê: o RLS decide quais voltam e
 * a privacidade tira as dos donos ocultos. É o idsVisiveis de
 * chat/actions.ts, repetido aqui porque lá ele não sai do arquivo (num
 * "use server", exportar vira action). null = a leitura falhou e nada é
 * feito.
 */
async function idsVisiveis(
  supabase: Cliente,
  ids: string[],
): Promise<string[] | null> {
  try {
    const [ocultos, { data, error }] = await Promise.all([
      donosOcultosParaMim(),
      supabase.from("leads").select("id, responsavel_id").in("id", ids),
    ]);
    if (error) return null;
    return ((data ?? []) as { id: string; responsavel_id: string | null }[])
      .filter((l) => !donoOculto(l.responsavel_id, ocultos))
      .map((l) => l.id);
  } catch {
    return null;
  }
}

/**
 * Marca as conversas como lidas (a leitura vira agora) ou não lidas (a
 * leitura some, como o "Marcar como não lida" de uma conversa só). O total
 * é o de conversas que o update gravou.
 */
export async function marcarLidasEmMassa(
  leadIds: string[],
  lidas: boolean,
): Promise<Resultado> {
  const perfil = await perfilQueEscreve();
  if (!perfil) return { erro: SEM_PERMISSAO };
  const pedidos = idsValidos(leadIds, MAX_EM_MASSA);
  if (pedidos.length === 0) return { erro: "Nenhuma conversa selecionada." };

  const supabase = await createClient();
  // Conversa de dono oculto sai do lote (a privacidade vale também aqui).
  const ids = await idsVisiveis(supabase, pedidos);
  if (!ids) return { erro: "As conversas não carregaram. Tente de novo." };
  if (ids.length === 0) return { erro: "Nenhuma conversa selecionada." };
  const { data, error } = await supabase
    .from("leads")
    .update({ chat_lido_em: lidas ? new Date().toISOString() : null })
    .in("id", ids)
    .select("id");
  if (error) return { erro: error.message };
  return { ok: true, total: (data ?? []).length };
}

/**
 * Põe e tira etiquetas de várias conversas numa ida: um upsert para as que
 * entram (quem já tinha não vira erro de duplicidade) e um delete para as
 * que saem. Etiqueta nas duas listas fica só em "pôr". O total é o de
 * conversas em que o upsert ou o delete gravou alguma linha.
 */
export async function etiquetasEmMassa(
  leadIds: string[],
  por: string[],
  tirar: string[],
): Promise<Resultado> {
  const perfil = await perfilQueEscreve();
  if (!perfil) return { erro: SEM_PERMISSAO };
  const pedidos = idsValidos(leadIds, MAX_EM_MASSA);
  if (pedidos.length === 0) return { erro: "Nenhuma conversa selecionada." };
  const entram = idsValidos(por, 50);
  const saem = idsValidos(tirar, 50).filter((t) => !entram.includes(t));
  if (entram.length === 0 && saem.length === 0) {
    return { erro: "Escolha uma etiqueta para pôr ou tirar." };
  }

  const supabase = await createClient();
  // Conversa de dono oculto sai do lote (a privacidade vale também aqui).
  const ids = await idsVisiveis(supabase, pedidos);
  if (!ids) return { erro: "As conversas não carregaram. Tente de novo." };
  if (ids.length === 0) return { erro: "Nenhuma conversa selecionada." };

  const gravadas = new Set<string>();
  if (entram.length > 0) {
    const { data, error } = await supabase
      .from("lead_tags")
      .upsert(
        ids.flatMap((lead_id) => entram.map((tag_id) => ({ lead_id, tag_id }))),
        { onConflict: "lead_id,tag_id" },
      )
      .select("lead_id");
    if (error) return { erro: error.message };
    for (const l of (data ?? []) as { lead_id: string }[]) gravadas.add(l.lead_id);
  }
  if (saem.length > 0) {
    const { data, error } = await supabase
      .from("lead_tags")
      .delete()
      .in("lead_id", ids)
      .in("tag_id", saem)
      .select("lead_id");
    if (error) return { erro: error.message };
    for (const l of (data ?? []) as { lead_id: string }[]) gravadas.add(l.lead_id);
  }
  return { ok: true, total: gravadas.size };
}
