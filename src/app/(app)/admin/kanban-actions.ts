"use server";

import { redirect } from "next/navigation";
import { revalidatePath } from "next/cache";
import { createClient } from "@/lib/supabase/server";
import { perfilAtual } from "@/lib/auth";

/**
 * Ações da gestão de kanbans. Formulários simples de servidor: sucesso
 * revalida a página; falha redireciona com a mensagem em ?aviso=.
 */

async function exigirGestor() {
  const perfil = await perfilAtual();
  if (!perfil || (perfil.papel !== "admin" && perfil.papel !== "gestor")) {
    redirect("/hoje");
  }
}

function terminar(aviso?: string): never {
  revalidatePath("/admin");
  revalidatePath("/atendimento");
  redirect(aviso ? `/admin?aviso=${encodeURIComponent(aviso)}` : "/admin");
}

export async function criarKanban(formData: FormData) {
  await exigirGestor();
  const nome = String(formData.get("nome") ?? "").trim();
  if (!nome) terminar("Dê um nome ao kanban.");

  const supabase = await createClient();
  const { data, error } = await supabase
    .from("pipelines")
    .insert({ nome })
    .select("id")
    .single();

  if (error) {
    terminar(
      error.code === "23505"
        ? `Já existe um kanban chamado “${nome}”. Escolha outro nome.`
        : `Não deu para criar o kanban: ${error.message}`,
    );
  }

  // Todo kanban nasce com uma etapa inicial — sem etapa não há coluna.
  await supabase
    .from("pipeline_stages")
    .insert({ pipeline_id: data.id, nome: "Novo", ordem: 1 });

  terminar();
}

export async function renomearKanban(formData: FormData) {
  await exigirGestor();
  const id = String(formData.get("id") ?? "");
  const nome = String(formData.get("nome") ?? "").trim();
  if (!id || !nome) terminar("Nome inválido.");

  const supabase = await createClient();
  const { error } = await supabase
    .from("pipelines")
    .update({ nome })
    .eq("id", id);

  if (error) {
    terminar(
      error.code === "23505"
        ? `Já existe um kanban chamado “${nome}”. Escolha outro nome.`
        : `Não deu para renomear: ${error.message}`,
    );
  }
  terminar();
}

export async function definirKanbanPadrao(formData: FormData) {
  await exigirGestor();
  const id = String(formData.get("id") ?? "");
  if (!id) terminar("Kanban inválido.");

  const supabase = await createClient();
  // Índice único exige tirar o padrão atual antes de definir o novo.
  await supabase.from("pipelines").update({ padrao: false }).eq("padrao", true);
  const { error } = await supabase
    .from("pipelines")
    .update({ padrao: true })
    .eq("id", id);

  if (error) terminar(`Não deu para definir o padrão: ${error.message}`);
  terminar();
}

export async function excluirKanban(formData: FormData) {
  await exigirGestor();
  const id = String(formData.get("id") ?? "");
  if (!id) terminar("Kanban inválido.");

  const supabase = await createClient();

  const { data: pipeline } = await supabase
    .from("pipelines")
    .select("padrao")
    .eq("id", id)
    .single();

  if (pipeline?.padrao) {
    terminar(
      "O kanban padrão não pode ser excluído. Defina outro como padrão antes.",
    );
  }

  const { data: stages } = await supabase
    .from("pipeline_stages")
    .select("id")
    .eq("pipeline_id", id);

  const stageIds = (stages ?? []).map((s: { id: string }) => s.id);

  if (stageIds.length > 0) {
    const { count } = await supabase
      .from("leads")
      .select("id", { count: "exact", head: true })
      .in("stage_id", stageIds);

    if ((count ?? 0) > 0) {
      terminar(
        `Este kanban tem ${count} lead(s). Mova-os para outro kanban antes de excluir.`,
      );
    }
  }

  const { error } = await supabase.from("pipelines").delete().eq("id", id);
  if (error) terminar(`Não deu para excluir: ${error.message}`);
  terminar();
}

export async function criarEtapa(formData: FormData) {
  await exigirGestor();
  const pipelineId = String(formData.get("pipeline_id") ?? "");
  const nome = String(formData.get("nome") ?? "").trim();
  if (!pipelineId || !nome) terminar("Dê um nome à etapa.");

  const supabase = await createClient();

  const { data: ultima } = await supabase
    .from("pipeline_stages")
    .select("ordem")
    .eq("pipeline_id", pipelineId)
    .order("ordem", { ascending: false })
    .limit(1)
    .maybeSingle();

  const { error } = await supabase.from("pipeline_stages").insert({
    pipeline_id: pipelineId,
    nome,
    ordem: (ultima?.ordem ?? 0) + 1,
  });

  if (error) terminar(`Não deu para criar a etapa: ${error.message}`);
  terminar();
}

export async function renomearEtapa(formData: FormData) {
  await exigirGestor();
  const id = String(formData.get("id") ?? "");
  const nome = String(formData.get("nome") ?? "").trim();
  if (!id || !nome) terminar("Nome inválido.");

  const supabase = await createClient();
  const { error } = await supabase
    .from("pipeline_stages")
    .update({ nome })
    .eq("id", id);

  if (error) terminar(`Não deu para renomear: ${error.message}`);
  terminar();
}

/** Prazo esperado (dias) da etapa — alimenta o semáforo dos cartões (0051). */
export async function definirPrazoEtapa(formData: FormData) {
  await exigirGestor();
  const id = String(formData.get("id") ?? "");
  const bruto = String(formData.get("prazo") ?? "").trim();
  const prazo = bruto === "" ? null : Number(bruto);

  if (!id) return terminar("Etapa não informada.");
  if (
    prazo !== null &&
    (!Number.isInteger(prazo) || prazo < 1 || prazo > 365)
  ) {
    return terminar(
      "Prazo inválido — dias inteiros de 1 a 365, ou vazio para o padrão (7).",
    );
  }

  const supabase = await createClient();
  const { error } = await supabase
    .from("pipeline_stages")
    .update({ prazo_dias: prazo })
    .eq("id", id);
  if (error) {
    // UPDATE em coluna ausente volta PGRST204 (schema cache do PostgREST),
    // não só o 42703 do Postgres — os dois significam "sem a 0051".
    return terminar(
      error.code === "42703" || error.code === "PGRST204"
        ? "Rode a migração 0051 para os prazos por etapa existirem."
        : `Não deu para salvar: ${error.message}`,
    );
  }
  return terminar();
}

export async function alternarEtapaFinal(formData: FormData) {
  await exigirGestor();
  const id = String(formData.get("id") ?? "");
  if (!id) terminar("Etapa inválida.");

  const supabase = await createClient();
  const { data: etapa } = await supabase
    .from("pipeline_stages")
    .select("is_final")
    .eq("id", id)
    .single();

  const { error } = await supabase
    .from("pipeline_stages")
    .update({ is_final: !etapa?.is_final })
    .eq("id", id);

  if (error) terminar(`Não deu para alterar: ${error.message}`);
  terminar();
}

export async function moverEtapa(formData: FormData) {
  await exigirGestor();
  const id = String(formData.get("id") ?? "");
  const direcao = Number(formData.get("direcao"));
  if (!id || (direcao !== -1 && direcao !== 1)) terminar("Movimento inválido.");

  const supabase = await createClient();

  const { data: etapa } = await supabase
    .from("pipeline_stages")
    .select("id, ordem, pipeline_id")
    .eq("id", id)
    .single();
  if (!etapa) terminar("Etapa não encontrada.");

  const { data: vizinha } = await supabase
    .from("pipeline_stages")
    .select("id, ordem")
    .eq("pipeline_id", etapa.pipeline_id)
    .eq("ordem", etapa.ordem + direcao)
    .maybeSingle();
  if (!vizinha) terminar();

  // Troca as ordens em três passos por causa do índice único.
  await supabase
    .from("pipeline_stages")
    .update({ ordem: -1 })
    .eq("id", etapa.id);
  await supabase
    .from("pipeline_stages")
    .update({ ordem: etapa.ordem })
    .eq("id", vizinha.id);
  const { error } = await supabase
    .from("pipeline_stages")
    .update({ ordem: vizinha.ordem })
    .eq("id", etapa.id);

  if (error) terminar(`Não deu para mover: ${error.message}`);
  terminar();
}

export async function excluirEtapa(formData: FormData) {
  await exigirGestor();
  const id = String(formData.get("id") ?? "");
  if (!id) terminar("Etapa inválida.");

  const supabase = await createClient();

  const { count } = await supabase
    .from("leads")
    .select("id", { count: "exact", head: true })
    .eq("stage_id", id);

  if ((count ?? 0) > 0) {
    terminar(`Esta etapa tem ${count} lead(s). Mova-os antes de excluir.`);
  }

  const { data: etapa } = await supabase
    .from("pipeline_stages")
    .select("pipeline_id")
    .eq("id", id)
    .single();

  if (etapa) {
    const { count: totalEtapas } = await supabase
      .from("pipeline_stages")
      .select("id", { count: "exact", head: true })
      .eq("pipeline_id", etapa.pipeline_id);

    if ((totalEtapas ?? 0) <= 1) {
      terminar("O kanban precisa de pelo menos uma etapa.");
    }
  }

  const { error } = await supabase
    .from("pipeline_stages")
    .delete()
    .eq("id", id);
  if (error) terminar(`Não deu para excluir: ${error.message}`);
  terminar();
}
