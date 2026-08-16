"use server";

import { redirect } from "next/navigation";
import { revalidatePath } from "next/cache";
import { createClient } from "@/lib/supabase/server";
import { perfilAtual } from "@/lib/auth";
import { normalizarTelefone } from "@/lib/csv";

const STATUS_VALIDOS = new Set([
  "novo",
  "em_atendimento",
  "sem_resposta",
  "ganho",
  "perdido",
]);

export async function atualizarLead(formData: FormData) {
  const perfil = await perfilAtual();
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

  function falhar(aviso: string): never {
    redirect(`/leads/${id}/editar?aviso=${encodeURIComponent(aviso)}`);
  }

  if (!id) redirect("/leads");
  if (!nome) falhar("Informe o nome do lead.");
  if (!STATUS_VALIDOS.has(status)) falhar("Status inválido.");

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
    })
    .eq("id", id);

  if (error) {
    falhar(
      error.code === "23505"
        ? "Já existe outro lead com esse telefone."
        : `Não deu para salvar: ${error.message}`,
    );
  }

  revalidatePath("/leads");
  revalidatePath(`/leads/${id}`);
  revalidatePath("/atendimento");
  redirect(`/leads/${id}`);
}
