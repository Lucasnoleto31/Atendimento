"use server";

import { redirect } from "next/navigation";
import { revalidatePath } from "next/cache";
import { createClient } from "@/lib/supabase/server";
import { perfilQueEscreve } from "@/lib/auth";
import { normalizarTelefone } from "@/lib/csv";
import { ehMotivoPerda } from "@/lib/perda";

const STATUS_VALIDOS = new Set(["novo", "em_atendimento", "ganho", "perdido"]);

export async function atualizarLead(formData: FormData) {
  const perfil = await perfilQueEscreve();
  if (!perfil) redirect("/entrar");

  const id = String(formData.get("id") ?? "");
  const nome = String(formData.get("nome") ?? "").trim();
  const telefoneBruto = String(formData.get("telefone") ?? "").trim();
  const canalId = String(formData.get("channel_id") ?? "");
  const campanha = String(formData.get("campanha") ?? "").trim();
  const stageId = String(formData.get("stage_id") ?? "");
  const status = String(formData.get("status") ?? "");
  const responsavelId = String(formData.get("responsavel_id") ?? "");
  const observacao = String(formData.get("observacao") ?? "").trim();
  const perdaMotivo = String(formData.get("perda_motivo") ?? "");
  const perdaDetalhe = String(formData.get("perda_detalhe") ?? "").trim();

  function falhar(aviso: string): never {
    redirect(`/leads/${id}/editar?aviso=${encodeURIComponent(aviso)}`);
  }

  if (!id) redirect("/leads");
  if (!nome) falhar("Informe o nome do lead.");
  if (!STATUS_VALIDOS.has(status)) falhar("Status inválido.");
  if (status === "perdido" && !ehMotivoPerda(perdaMotivo)) {
    falhar("Diga o motivo da perda — é ele que o relatório soma.");
  }

  const telefone = telefoneBruto ? normalizarTelefone(telefoneBruto) : null;
  if (telefoneBruto && !telefone) {
    falhar("Telefone inválido. Use DDD + número, ex.: 11 98842-1170.");
  }

  const supabase = await createClient();

  // Zera o vínculo e deixa o gatilho refazer o cruzamento pelo telefone
  // atual: telefone novo religa ao cliente certo; sem telefone, desliga.
  const { error } = await supabase
    .from("leads")
    .update({
      nome,
      telefone_e164: telefone,
      customer_id: null,
      cliente_confirmado_em: null,
      channel_id: canalId || null,
      campanha: campanha || null,
      stage_id: stageId || null,
      status,
      responsavel_id: responsavelId || null,
      observacao: observacao || null,
      // Fora de "perdido" o gatilho da 0038 limpa os dois sozinho.
      perda_motivo: status === "perdido" ? perdaMotivo : null,
      perda_detalhe:
        status === "perdido" ? perdaDetalhe.slice(0, 280) || null : null,
    })
    .eq("id", id);

  if (error && error.code === "42703") {
    const { error: semPerda } = await supabase
      .from("leads")
      .update({
        nome,
        telefone_e164: telefone,
        customer_id: null,
        cliente_confirmado_em: null,
        channel_id: canalId || null,
        campanha: campanha || null,
        stage_id: stageId || null,
        status,
        responsavel_id: responsavelId || null,
        observacao: observacao || null,
      })
      .eq("id", id);
    if (semPerda) falhar(`Não deu para salvar: ${semPerda.message}`);
  } else if (error) {
    falhar(
      error.code === "23505"
        ? "Já existe outro lead com esse telefone."
        : error.code === "23514"
          ? "Rode a migração 0061 para este motivo de perda existir."
          : `Não deu para salvar: ${error.message}`,
    );
  }

  revalidatePath("/leads");
  revalidatePath(`/leads/${id}`);
  revalidatePath("/atendimento");
  redirect(`/leads/${id}`);
}
