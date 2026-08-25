"use server";

import { redirect } from "next/navigation";
import { revalidatePath } from "next/cache";
import { createClient } from "@/lib/supabase/server";
import { perfilAtual } from "@/lib/auth";
import { executarCampanhas } from "@/lib/campanhas";

/**
 * Gestão das campanhas. Formulários de servidor: sucesso revalida a página,
 * falha volta com a mensagem em ?aviso=.
 */

async function exigirGestor() {
  const perfil = await perfilAtual();
  if (!perfil || (perfil.papel !== "admin" && perfil.papel !== "gestor")) {
    redirect("/atendimento");
  }
  return perfil;
}

function terminar(aviso?: string): never {
  revalidatePath("/campanhas");
  redirect(aviso ? `/campanhas?aviso=${encodeURIComponent(aviso)}` : "/campanhas");
}

export async function criarCampanha(formData: FormData) {
  const perfil = await exigirGestor();

  const nome = String(formData.get("nome") ?? "").trim();
  const template = String(formData.get("template") ?? "");
  const etiquetaId = String(formData.get("etiqueta_id") ?? "");
  const porDia = Number(formData.get("por_dia") ?? 30);
  const horaInicio = Number(formData.get("hora_inicio") ?? 9);
  const horaFim = Number(formData.get("hora_fim") ?? 18);
  const diasUteis = formData.get("dias_uteis") === "on";

  if (!nome) terminar("Dê um nome à campanha.");
  if (!template) terminar("Escolha o template aprovado que será enviado.");
  if (!etiquetaId) terminar("Escolha a etiqueta que define o público.");
  if (!Number.isFinite(porDia) || porDia < 1 || porDia > 500) {
    terminar("O ritmo diário precisa ficar entre 1 e 500.");
  }
  if (horaFim <= horaInicio) {
    terminar("A hora final precisa ser maior que a inicial.");
  }

  const [templateNome, templateIdioma] = template.split("|");

  // Valores fixos das variáveis do template, no formato param_<token>.
  const parametros: Record<string, string> = {};
  for (const [chave, valor] of formData.entries()) {
    if (chave.startsWith("param_") && typeof valor === "string" && valor.trim()) {
      parametros[chave.slice("param_".length)] = valor.trim();
    }
  }

  const supabase = await createClient();
  const { error } = await supabase.from("campanhas").insert({
    nome,
    template_nome: templateNome,
    template_idioma: templateIdioma || "pt_BR",
    parametros,
    etiqueta_id: etiquetaId,
    por_dia: porDia,
    dias_uteis: diasUteis,
    hora_inicio: horaInicio,
    hora_fim: horaFim,
    criado_por: perfil.id,
  });

  if (error) terminar(`Não deu para criar: ${error.message}`);
  terminar();
}

export async function alterarStatusCampanha(formData: FormData) {
  await exigirGestor();
  const id = String(formData.get("id") ?? "");
  const status = String(formData.get("status") ?? "");
  if (!id || !["ativa", "pausada"].includes(status)) terminar("Status inválido.");

  const supabase = await createClient();
  const { error } = await supabase
    .from("campanhas")
    .update({ status, ...(status === "ativa" ? { concluida_em: null } : {}) })
    .eq("id", id);
  if (error) terminar(`Não deu para atualizar: ${error.message}`);

  // Ativou dentro da janela: manda o primeiro lote agora, sem esperar o cron.
  if (status === "ativa") await executarCampanhas().catch(() => {});
  terminar();
}

/**
 * Edita o ritmo de uma campanha existente: envios por dia, janela de horário
 * e dias úteis. Template, etiqueta e variáveis ficam de fora de propósito —
 * trocar a mensagem ou o público no meio do envio faz o histórico mentir
 * ("enviados 300" de QUAL mensagem?); para isso, conclua e crie outra.
 */
export async function editarRitmoCampanha(formData: FormData) {
  await exigirGestor();

  const id = String(formData.get("id") ?? "");
  const porDia = Number(formData.get("por_dia") ?? NaN);
  const horaInicio = Number(formData.get("hora_inicio") ?? NaN);
  const horaFim = Number(formData.get("hora_fim") ?? NaN);
  const diasUteis = formData.get("dias_uteis") === "on";

  if (!id) terminar("Campanha não informada.");
  if (!Number.isInteger(porDia) || porDia < 1 || porDia > 500) {
    terminar("O ritmo diário precisa ficar entre 1 e 500.");
  }
  if (
    !Number.isInteger(horaInicio) ||
    !Number.isInteger(horaFim) ||
    horaInicio < 0 ||
    horaInicio > 23 ||
    horaFim < 1 ||
    horaFim > 24
  ) {
    terminar("Horário inválido.");
  }
  if (horaFim <= horaInicio) {
    terminar("A hora final precisa ser maior que a inicial.");
  }

  const supabase = await createClient();
  const { error } = await supabase
    .from("campanhas")
    .update({
      por_dia: porDia,
      hora_inicio: horaInicio,
      hora_fim: horaFim,
      dias_uteis: diasUteis,
    })
    .eq("id", id);
  if (error) terminar(`Não deu para salvar: ${error.message}`);

  // Subiu o ritmo dentro da janela: o motor completa a cota nova do dia já.
  await executarCampanhas().catch(() => {});
  terminar();
}

export async function excluirCampanha(formData: FormData) {
  await exigirGestor();
  const id = String(formData.get("id") ?? "");
  if (!id) terminar("Campanha não informada.");

  const supabase = await createClient();
  const { error } = await supabase.from("campanhas").delete().eq("id", id);
  if (error) terminar(`Não deu para excluir: ${error.message}`);
  terminar();
}
