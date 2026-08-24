"use server";

import { redirect } from "next/navigation";
import { revalidatePath } from "next/cache";
import { createClient } from "@/lib/supabase/server";
import { perfilAtual } from "@/lib/auth";
import { normalizarTelefone, variantesTelefone } from "@/lib/csv";

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

  // Mesmo telefone, duas grafias: o WhatsApp registra celular antigo sem o
  // nono dígito e a planilha traz com ele. Cadastrar sem olhar as duas cria um
  // segundo card para quem já está sendo atendido — e a resposta do lead cai
  // sempre no card antigo, porque é o número que o WhatsApp usa.
  if (telefone) {
    const { data: existente } = await supabase
      .from("leads")
      .select("id, nome, responsavel:profiles(nome)")
      .in("telefone_e164", variantesTelefone(telefone))
      .limit(1)
      .maybeSingle();
    if (existente) {
      const dono = (
        existente as { responsavel?: { nome?: string } | null }
      ).responsavel?.nome;
      redirect(
        `/leads/${existente.id}?aviso=${encodeURIComponent(
          `Esse telefone já é o lead "${existente.nome}"${
            dono ? `, com ${dono}` : ""
          }. Continue o atendimento por aqui.`,
        )}`,
      );
    }
  }

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
