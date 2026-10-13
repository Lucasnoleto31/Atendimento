"use server";

import { createClient } from "@/lib/supabase/server";
import { perfilAtivo } from "@/lib/auth";
import { donosOcultosParaMim } from "@/lib/privacidade";
import { aplicarFiltros } from "@/app/(app)/contatos/filtros";
import { semDonosOcultos } from "@/app/(app)/contatos/consulta";

/**
 * A busca única de pessoas: a paleta (⌘K) e quem mais quiser achar alguém
 * pelo nome, e-mail, @ ou telefone, com conversa ou sem. Roda em leads com a
 * mesma normalização da lista de Contatos (contatos/filtros.ts): @ sem a
 * arroba, telefone por dígitos a partir de 4. Quem cada papel enxerga
 * decide o RLS; por cima dele vale a privacidade entre pessoas da equipe
 * (Administração > Privacidade): o contato de um dono oculto não aparece.
 * O filtro vai na consulta, antes do limite, para a lista não sair curta.
 */

export type PessoaEncontrada = {
  leadId: string;
  nome: string;
  telefone: string | null;
  instagram: string | null;
  estado: "aberta" | "adiada" | "resolvida" | "sem_conversa";
  /** Até quando dorme, quando adiada (a hora marcada ou, sem ela, 3 dias
   *  depois de adiar, a mesma regra da Caixa). */
  adiadaAte: string | null;
  responsavelNome: string | null;
  ultimaEm: string | null;
};

const LIMITE = 8;
/** Uma letra casaria meia base; duas já separam. */
const MINIMO = 2;
const TRES_DIAS_MS = 3 * 86_400_000;

const CAMPOS =
  "id, nome, telefone_e164, instagram_usuario, status, ultima_interacao_em, chat_adiado_em, chat_adiado_ate, chat_resolvido_em, responsavel:profiles(nome)";

type Linha = {
  id: string;
  nome: string;
  telefone_e164: string | null;
  instagram_usuario: string | null;
  status: string | null;
  ultima_interacao_em: string | null;
  chat_adiado_em: string | null;
  chat_adiado_ate: string | null;
  chat_resolvido_em: string | null;
  responsavel: { nome: string } | null;
};

/**
 * O estado da conversa pelas mesmas regras da fila (conversas/lista.ts e a
 * view v_leads_listas): perdido conta como resolvida; adiada só enquanto o
 * prazo não venceu (vencida volta para a Caixa, logo "aberta"); sem nenhuma
 * interação é contato sem conversa.
 */
function estadoDa(
  l: Linha,
  agora: number,
): {
  estado: PessoaEncontrada["estado"];
  adiadaAte: string | null;
} {
  const resolvida = Boolean(l.chat_resolvido_em) || l.status === "perdido";
  if (!l.ultima_interacao_em && !l.chat_resolvido_em) {
    return { estado: "sem_conversa", adiadaAte: null };
  }
  if (resolvida) return { estado: "resolvida", adiadaAte: null };
  if (l.chat_adiado_em) {
    const ate =
      l.chat_adiado_ate ??
      new Date(Date.parse(l.chat_adiado_em) + TRES_DIAS_MS).toISOString();
    if (Date.parse(ate) > agora) return { estado: "adiada", adiadaAte: ate };
  }
  return { estado: "aberta", adiadaAte: null };
}

export async function buscarPessoas(
  termo: string,
): Promise<{ resultados: PessoaEncontrada[] } | { erro: string }> {
  const busca = String(termo ?? "")
    .trim()
    .slice(0, 120);
  if (busca.length < MINIMO) return { resultados: [] };

  // Conta desativada não procura ninguém (mesma guarda das actions). A
  // privacidade é lida junto; sem ela a busca não sai, porque mostraria o
  // que a regra esconde.
  const [perfil, ocultos] = await Promise.all([
    perfilAtivo(),
    donosOcultosParaMim().catch(() => null),
  ]);
  if (!perfil) return { erro: "Sua sessão terminou. Entre de novo." };
  if (!ocultos) return { erro: "A busca não respondeu. Tente de novo." };

  const supabase = await createClient();
  const { data, error } = await semDonosOcultos(
    aplicarFiltros(supabase.from("leads").select(CAMPOS), {
      busca,
      etiqueta: "",
      responsavel: "",
    }),
    ocultos,
  )
    // Quem falou por último primeiro: é quase sempre quem se procura.
    .order("ultima_interacao_em", { ascending: false, nullsFirst: false })
    .order("nome", { ascending: true })
    .limit(LIMITE);

  if (error) return { erro: "A busca não respondeu. Tente de novo." };

  const agora = Date.now();
  const resultados = ((data ?? []) as Linha[]).map((l) => ({
    leadId: l.id,
    nome: l.nome,
    telefone: l.telefone_e164,
    instagram: l.instagram_usuario,
    ...estadoDa(l, agora),
    responsavelNome: l.responsavel?.nome ?? null,
    ultimaEm: l.ultima_interacao_em,
  }));
  return { resultados };
}
