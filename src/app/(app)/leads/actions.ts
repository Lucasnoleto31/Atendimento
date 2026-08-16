"use server";

import { redirect } from "next/navigation";
import { revalidatePath } from "next/cache";
import { createClient } from "@/lib/supabase/server";
import { perfilAtual } from "@/lib/auth";

const BLOCO = 200;
const LIMITE = 5000;

function embaralhar<T>(lista: T[]): T[] {
  const copia = [...lista];
  for (let i = copia.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [copia[i], copia[j]] = [copia[j], copia[i]];
  }
  return copia;
}

/**
 * Distribui os leads SEM responsável entre a equipe ativa, aleatoriamente e
 * em partes iguais (diferença máxima de 1). Leads já atribuídos não mudam.
 */
export async function distribuirLeads() {
  const perfil = await perfilAtual();
  if (!perfil || (perfil.papel !== "admin" && perfil.papel !== "gestor")) {
    redirect("/leads");
  }

  function terminar(aviso: string): never {
    revalidatePath("/leads");
    revalidatePath("/atendimento");
    redirect(`/leads?aviso=${encodeURIComponent(aviso)}`);
  }

  const supabase = await createClient();

  const [{ data: equipe }, { data: semDono }] = await Promise.all([
    supabase.from("profiles").select("id, nome").eq("ativo", true).order("nome"),
    supabase
      .from("leads")
      .select("id")
      .is("responsavel_id", null)
      .limit(LIMITE),
  ]);

  const pessoas = (equipe ?? []) as { id: string; nome: string }[];
  const leads = ((semDono ?? []) as { id: string }[]).map((l) => l.id);

  if (pessoas.length === 0) terminar("Nenhuma pessoa ativa na equipe.");
  if (leads.length === 0) terminar("Nenhum lead sem responsável para distribuir.");

  // Sorteia a ordem dos leads e o ponto de partida do rodízio.
  const sorteados = embaralhar(leads);
  const inicio = Math.floor(Math.random() * pessoas.length);

  const porPessoa = new Map<string, string[]>();
  sorteados.forEach((leadId, i) => {
    const pessoa = pessoas[(inicio + i) % pessoas.length];
    if (!porPessoa.has(pessoa.id)) porPessoa.set(pessoa.id, []);
    porPessoa.get(pessoa.id)!.push(leadId);
  });

  let atribuidos = 0;

  for (const [pessoaId, ids] of porPessoa) {
    for (let i = 0; i < ids.length; i += BLOCO) {
      const parte = ids.slice(i, i + BLOCO);
      const { error } = await supabase
        .from("leads")
        .update({ responsavel_id: pessoaId })
        .in("id", parte);
      if (error) {
        terminar(
          `Distribuição interrompida após ${atribuidos} lead(s): ${error.message}`,
        );
      }
      atribuidos += parte.length;

      // Auditoria: cada atribuição vira uma interação no histórico do lead.
      const pessoa = pessoas.find((p) => p.id === pessoaId);
      await supabase.from("lead_interactions").insert(
        parte.map((leadId) => ({
          lead_id: leadId,
          tipo: "atribuicao",
          conteudo: `Distribuição automática para ${pessoa?.nome ?? "equipe"}`,
          autor_id: perfil.id,
          metadados: { responsavel_id: pessoaId },
        })),
      );
    }
  }

  terminar(
    `${atribuidos} lead(s) distribuídos entre ${porPessoa.size} pessoa(s).`,
  );
}
