"use server";

import { redirect } from "next/navigation";
import { revalidatePath } from "next/cache";
import { createClient } from "@/lib/supabase/server";
import { perfilAtual } from "@/lib/auth";
import { normalizarTelefone } from "@/lib/csv";

export async function criarLead(formData: FormData) {
  const perfil = await perfilAtual();
  if (!perfil) redirect("/entrar");

  const nome = String(formData.get("nome") ?? "").trim();
  const telefoneBruto = String(formData.get("telefone") ?? "").trim();
  const canalId = String(formData.get("channel_id") ?? "");
  const campanha = String(formData.get("campanha") ?? "").trim();
  const pipelineId = String(formData.get("pipeline_id") ?? "");
  const responsavelId = String(formData.get("responsavel_id") ?? "");
  const observacao = String(formData.get("observacao") ?? "").trim();

  function falhar(aviso: string): never {
    redirect(`/leads/novo?aviso=${encodeURIComponent(aviso)}`);
  }

  if (!nome) falhar("Informe o nome do lead.");

  const telefone = telefoneBruto ? normalizarTelefone(telefoneBruto) : null;
  if (telefoneBruto && !telefone) {
    falhar("Telefone inválido. Use DDD + número, ex.: 11 98842-1170.");
  }

  const supabase = await createClient();

  // Primeira etapa do kanban escolhido (ou do padrão).
  let etapaId: string | null = null;
  if (pipelineId) {
    const { data } = await supabase
      .from("pipeline_stages")
      .select("id")
      .eq("pipeline_id", pipelineId)
      .order("ordem")
      .limit(1)
      .maybeSingle();
    etapaId = data?.id ?? null;
  }
  if (!etapaId) {
    const { data } = await supabase
      .from("pipeline_stages")
      .select("id, pipeline:pipelines!inner(padrao)")
      .eq("pipeline.padrao", true)
      .order("ordem")
      .limit(1)
      .maybeSingle();
    etapaId = data?.id ?? null;
  }

  const { data: lead, error } = await supabase
    .from("leads")
    .insert({
      nome,
      telefone_e164: telefone,
      channel_id: canalId || null,
      campanha: campanha || null,
      stage_id: etapaId,
      status: "novo",
      entrada_motivo: "manual",
      responsavel_id: responsavelId || perfil.id,
      observacao: observacao || null,
    })
    .select("id")
    .single();

  if (error) {
    falhar(
      error.code === "23505"
        ? "Já existe um lead com esse telefone."
        : `Não deu para cadastrar: ${error.message}`,
    );
  }

  revalidatePath("/leads");
  revalidatePath("/atendimento");
  redirect(`/leads/${lead.id}`);
}
