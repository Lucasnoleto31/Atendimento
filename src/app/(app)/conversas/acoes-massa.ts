"use server";

import { createClient } from "@/lib/supabase/server";
import { perfilQueEscreve } from "@/lib/auth";
import { ehUuid } from "@/app/(app)/chat/mensagem";

/*
 * As ações em massa da fila que o chat/actions.ts não tem: marcar lida ou
 * não lida e pôr e tirar várias etiquetas de uma vez. Gravam só nas colunas
 * e tabelas de sempre (leads.chat_lido_em, lead_tags), com as policies de
 * sempre: o RLS decide em quais conversas a pessoa mexe. Transferir, adiar e
 * resolver em massa continuam em chat/actions.ts.
 */

/** O mesmo teto das outras ações em massa (MAX_EM_MASSA, chat/actions.ts).
 *  A tela manda em lotes deste tamanho. */
const MAX_EM_MASSA = 200;

// O mesmo texto de chat/actions.ts.
const SEM_PERMISSAO =
  "Sem permissão para alterar: o perfil é só de leitura ou a sessão expirou.";

type Resultado = { ok?: true; total?: number; erro?: string };

function idsValidos(valor: unknown, teto: number): string[] {
  return Array.isArray(valor)
    ? [...new Set(valor.filter((v) => ehUuid(v)))].slice(0, teto)
    : [];
}

/**
 * Marca as conversas como lidas (a leitura vira agora) ou não lidas (a
 * leitura some, como o "Marcar como não lida" de uma conversa só).
 */
export async function marcarLidasEmMassa(
  leadIds: string[],
  lidas: boolean,
): Promise<Resultado> {
  const perfil = await perfilQueEscreve();
  if (!perfil) return { erro: SEM_PERMISSAO };
  const ids = idsValidos(leadIds, MAX_EM_MASSA);
  if (ids.length === 0) return { erro: "Nenhuma conversa selecionada." };

  const supabase = await createClient();
  const { error } = await supabase
    .from("leads")
    .update({ chat_lido_em: lidas ? new Date().toISOString() : null })
    .in("id", ids);
  if (error) return { erro: error.message };
  return { ok: true, total: ids.length };
}

/**
 * Põe e tira etiquetas de várias conversas numa ida: um upsert para as que
 * entram (quem já tinha não vira erro de duplicidade) e um delete para as
 * que saem. Etiqueta nas duas listas fica só em "pôr".
 */
export async function etiquetasEmMassa(
  leadIds: string[],
  por: string[],
  tirar: string[],
): Promise<Resultado> {
  const perfil = await perfilQueEscreve();
  if (!perfil) return { erro: SEM_PERMISSAO };
  const ids = idsValidos(leadIds, MAX_EM_MASSA);
  if (ids.length === 0) return { erro: "Nenhuma conversa selecionada." };
  const entram = idsValidos(por, 50);
  const saem = idsValidos(tirar, 50).filter((t) => !entram.includes(t));
  if (entram.length === 0 && saem.length === 0) {
    return { erro: "Escolha uma etiqueta para pôr ou tirar." };
  }

  const supabase = await createClient();
  if (entram.length > 0) {
    const { error } = await supabase.from("lead_tags").upsert(
      ids.flatMap((lead_id) => entram.map((tag_id) => ({ lead_id, tag_id }))),
      { onConflict: "lead_id,tag_id" },
    );
    if (error) return { erro: error.message };
  }
  if (saem.length > 0) {
    const { error } = await supabase
      .from("lead_tags")
      .delete()
      .in("lead_id", ids)
      .in("tag_id", saem);
    if (error) return { erro: error.message };
  }
  return { ok: true, total: ids.length };
}
