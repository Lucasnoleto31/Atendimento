"use server";

import { redirect } from "next/navigation";
import { revalidatePath } from "next/cache";
import { createClient } from "@/lib/supabase/server";
import { perfilAtual } from "@/lib/auth";
import { normalizarNumero, normalizarTelefone } from "@/lib/csv";

const MAX_INSTANCIAS = 10;

async function exigirGestor() {
  const perfil = await perfilAtual();
  if (!perfil || (perfil.papel !== "admin" && perfil.papel !== "gestor")) {
    redirect("/atendimento");
  }
  return perfil;
}

function terminar(aviso?: string): never {
  revalidatePath("/configuracoes");
  redirect(
    aviso ? `/configuracoes?aviso=${encodeURIComponent(aviso)}` : "/configuracoes",
  );
}

function amigavel(codigo: string | undefined, mensagem: string) {
  if (codigo === "23505") return "Já existe um registro com esse valor único.";
  if (codigo === "23503")
    return "Este item está em uso (há registros ligados a ele). Desative em vez de excluir.";
  return mensagem;
}

// ===========================================================================
// Produtos
// ===========================================================================

function lerProduto(formData: FormData) {
  const codigo = String(formData.get("codigo") ?? "").trim().toUpperCase();
  const nome = String(formData.get("nome") ?? "").trim();
  const recorrencia = String(formData.get("recorrencia") ?? "unica");
  const valor = normalizarNumero(String(formData.get("valor") ?? ""));

  if (!codigo || !nome) return { erro: "Código e nome são obrigatórios." };
  if (valor === null || valor < 0)
    return { erro: "Valor de comissão inválido. Use algo como 15,00." };
  if (!["unica", "recorrente", "por_operacao"].includes(recorrencia))
    return { erro: "Recorrência inválida." };

  return {
    dados: {
      codigo,
      nome,
      recorrencia,
      valor_comissao_centavos: Math.round(valor * 100),
    },
  };
}

export async function criarProduto(formData: FormData) {
  await exigirGestor();
  const lido = lerProduto(formData);
  if ("erro" in lido) terminar(lido.erro);

  const supabase = await createClient();
  const { error } = await supabase.from("products").insert(lido.dados);
  if (error) terminar(amigavel(error.code, error.message));
  terminar();
}

export async function atualizarProduto(formData: FormData) {
  await exigirGestor();
  const id = String(formData.get("id") ?? "");
  const lido = lerProduto(formData);
  if ("erro" in lido) terminar(lido.erro);

  const supabase = await createClient();
  const { error } = await supabase
    .from("products")
    .update(lido.dados)
    .eq("id", id);
  if (error) terminar(amigavel(error.code, error.message));
  terminar();
}

export async function alternarProduto(formData: FormData) {
  await exigirGestor();
  const id = String(formData.get("id") ?? "");

  const supabase = await createClient();
  const { data } = await supabase
    .from("products")
    .select("ativo")
    .eq("id", id)
    .single();
  const { error } = await supabase
    .from("products")
    .update({ ativo: !data?.ativo })
    .eq("id", id);
  if (error) terminar(amigavel(error.code, error.message));
  terminar();
}

export async function excluirProduto(formData: FormData) {
  await exigirGestor();
  const id = String(formData.get("id") ?? "");

  const supabase = await createClient();
  const { error } = await supabase.from("products").delete().eq("id", id);
  if (error) terminar(amigavel(error.code, error.message));
  terminar();
}

// ===========================================================================
// Tags
// ===========================================================================

export async function criarTag(formData: FormData) {
  await exigirGestor();
  const nome = String(formData.get("nome") ?? "").trim();
  if (!nome) terminar("Dê um nome à tag.");

  const supabase = await createClient();
  const { error } = await supabase.from("tags").insert({ nome });
  if (error)
    terminar(
      error.code === "23505" ? `A tag “${nome}” já existe.` : error.message,
    );
  terminar();
}

export async function excluirTag(formData: FormData) {
  await exigirGestor();
  const id = String(formData.get("id") ?? "");

  const supabase = await createClient();
  const { error } = await supabase.from("tags").delete().eq("id", id);
  if (error) terminar(amigavel(error.code, error.message));
  terminar();
}

// ===========================================================================
// Mensagens padrão
// ===========================================================================

export async function criarMensagem(formData: FormData) {
  await exigirGestor();
  const titulo = String(formData.get("titulo") ?? "").trim();
  const corpo = String(formData.get("corpo") ?? "").trim();
  if (!titulo || !corpo) terminar("Título e mensagem são obrigatórios.");

  const supabase = await createClient();
  const { error } = await supabase
    .from("quick_replies")
    .insert({ titulo, corpo });
  if (error) terminar(amigavel(error.code, error.message));
  terminar();
}

export async function atualizarMensagem(formData: FormData) {
  await exigirGestor();
  const id = String(formData.get("id") ?? "");
  const titulo = String(formData.get("titulo") ?? "").trim();
  const corpo = String(formData.get("corpo") ?? "").trim();
  if (!id || !titulo || !corpo) terminar("Título e mensagem são obrigatórios.");

  const supabase = await createClient();
  const { error } = await supabase
    .from("quick_replies")
    .update({ titulo, corpo })
    .eq("id", id);
  if (error) terminar(amigavel(error.code, error.message));
  terminar();
}

export async function excluirMensagem(formData: FormData) {
  await exigirGestor();
  const id = String(formData.get("id") ?? "");

  const supabase = await createClient();
  const { error } = await supabase.from("quick_replies").delete().eq("id", id);
  if (error) terminar(amigavel(error.code, error.message));
  terminar();
}

// ===========================================================================
// Instâncias de WhatsApp
// ===========================================================================

export async function criarInstancia(formData: FormData) {
  await exigirGestor();
  const nome = String(formData.get("nome") ?? "").trim();
  const telefone = normalizarTelefone(String(formData.get("telefone") ?? ""));
  const vendedorId = String(formData.get("vendedor_id") ?? "");

  if (!nome) terminar("Dê um nome à instância.");
  if (!telefone) terminar("Telefone inválido. Use DDD + número, ex.: 11 98842-1170.");

  const supabase = await createClient();

  const { count } = await supabase
    .from("whatsapp_instances")
    .select("id", { count: "exact", head: true });
  if ((count ?? 0) >= MAX_INSTANCIAS) {
    terminar(`Limite de ${MAX_INSTANCIAS} instâncias atingido.`);
  }

  const phoneNumberId = String(formData.get("meta_phone_number_id") ?? "").trim();

  const { error } = await supabase.from("whatsapp_instances").insert({
    nome,
    telefone_e164: telefone,
    vendedor_id: vendedorId || null,
    meta_phone_number_id: phoneNumberId || null,
  });
  if (error)
    terminar(
      error.code === "23505"
        ? "Já existe uma instância com esse telefone."
        : error.message,
    );
  terminar();
}

export async function atualizarInstancia(formData: FormData) {
  await exigirGestor();
  const id = String(formData.get("id") ?? "");
  const nome = String(formData.get("nome") ?? "").trim();
  const vendedorId = String(formData.get("vendedor_id") ?? "");
  if (!id || !nome) terminar("Nome inválido.");

  const phoneNumberId = String(formData.get("meta_phone_number_id") ?? "").trim();

  const supabase = await createClient();
  const { error } = await supabase
    .from("whatsapp_instances")
    .update({
      nome,
      vendedor_id: vendedorId || null,
      meta_phone_number_id: phoneNumberId || null,
    })
    .eq("id", id);
  if (error) terminar(amigavel(error.code, error.message));
  terminar();
}

export async function alternarInstancia(formData: FormData) {
  await exigirGestor();
  const id = String(formData.get("id") ?? "");

  const supabase = await createClient();
  const { data } = await supabase
    .from("whatsapp_instances")
    .select("ativa")
    .eq("id", id)
    .single();
  const { error } = await supabase
    .from("whatsapp_instances")
    .update({ ativa: !data?.ativa })
    .eq("id", id);
  if (error) terminar(amigavel(error.code, error.message));
  terminar();
}

export async function excluirInstancia(formData: FormData) {
  await exigirGestor();
  const id = String(formData.get("id") ?? "");

  const supabase = await createClient();
  const { error } = await supabase
    .from("whatsapp_instances")
    .delete()
    .eq("id", id);
  if (error) terminar(amigavel(error.code, error.message));
  terminar();
}

// ===========================================================================
// Metas do mês (só admin — RLS de profiles exige)
// ===========================================================================

export async function salvarMeta(formData: FormData) {
  const perfil = await exigirGestor();
  if (perfil.papel !== "admin") terminar("Só o admin altera metas.");

  const id = String(formData.get("id") ?? "");
  const valor = normalizarNumero(String(formData.get("meta") ?? ""));
  if (!id || valor === null || valor < 0) {
    terminar("Meta inválida. Use algo como 5.000,00 (ou 0 para sem meta).");
  }

  const supabase = await createClient();
  const { error } = await supabase
    .from("profiles")
    .update({ meta_mensal_centavos: Math.round(valor * 100) })
    .eq("id", id);
  if (error) terminar(amigavel(error.code, error.message));
  terminar();
}

// ===========================================================================
// Parâmetros de reativação
// ===========================================================================

const PARAMETROS_VALIDOS = new Set([
  "queda_lotes_percentual",
  "dias_sem_giro",
  "dias_sem_resposta",
]);

export async function salvarParametro(formData: FormData) {
  await exigirGestor();
  const chave = String(formData.get("chave") ?? "");
  const valor = normalizarNumero(String(formData.get("valor") ?? ""));

  if (!PARAMETROS_VALIDOS.has(chave)) terminar("Parâmetro desconhecido.");
  if (valor === null || valor <= 0) terminar("Informe um número maior que zero.");

  const supabase = await createClient();
  const { error } = await supabase
    .from("settings")
    .update({ valor, atualizado_em: new Date().toISOString() })
    .eq("chave", chave);
  if (error) terminar(amigavel(error.code, error.message));
  terminar();
}
