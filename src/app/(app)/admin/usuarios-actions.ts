"use server";

import { randomBytes } from "node:crypto";
import { redirect } from "next/navigation";
import { revalidatePath } from "next/cache";
import { PAPEIS } from "@/lib/papeis";
import { createClient, createServiceClient } from "@/lib/supabase/server";
import { perfilAtual } from "@/lib/auth";
import { registrarAcesso } from "@/lib/auditoria";

export type ResultadoUsuario = {
  ok?: boolean;
  erro?: string;
  senha?: string;
  email?: string;
};

const PAPEIS_VALIDOS = new Set<string>(PAPEIS.map((p) => p.papel));

async function exigirAdmin() {
  const perfil = await perfilAtual();
  if (!perfil || perfil.papel !== "admin") return null;
  return perfil;
}

/** Cria o usuário com senha temporária exibida uma única vez. */
export async function criarUsuario(
  _estado: ResultadoUsuario,
  formData: FormData,
): Promise<ResultadoUsuario> {
  const admin = await exigirAdmin();
  if (!admin) return { erro: "Só o admin cria usuários." };

  const nome = String(formData.get("nome") ?? "").trim();
  const email = String(formData.get("email") ?? "")
    .trim()
    .toLowerCase();
  const papel = String(formData.get("papel") ?? "vendedor");

  if (!nome || !email) return { erro: "Nome e e-mail são obrigatórios." };
  if (!PAPEIS_VALIDOS.has(papel)) return { erro: "Papel inválido." };

  const senha = randomBytes(9).toString("base64url");
  const service = createServiceClient();

  const { error } = await service.auth.admin.createUser({
    email,
    password: senha,
    email_confirm: true,
    user_metadata: { nome, papel },
  });

  if (error) {
    return {
      erro: error.message.includes("already")
        ? "Já existe um usuário com esse e-mail."
        : `Não deu para criar: ${error.message}`,
    };
  }

  revalidatePath("/admin");
  return { ok: true, senha, email };
}

/** Gera uma senha nova, exibida uma única vez. */
export async function resetarSenha(
  _estado: ResultadoUsuario,
  formData: FormData,
): Promise<ResultadoUsuario> {
  const admin = await exigirAdmin();
  if (!admin) return { erro: "Só o admin redefine senhas." };

  const id = String(formData.get("id") ?? "");
  const email = String(formData.get("email") ?? "");
  if (!id) return { erro: "Usuário não informado." };

  const senha = randomBytes(9).toString("base64url");
  const service = createServiceClient();

  const { error } = await service.auth.admin.updateUserById(id, {
    password: senha,
  });

  if (error) return { erro: `Não deu para redefinir: ${error.message}` };
  return { ok: true, senha, email };
}

export async function mudarPapel(formData: FormData) {
  const admin = await exigirAdmin();
  if (!admin) redirect("/hoje");

  const id = String(formData.get("id") ?? "");
  const papel = String(formData.get("papel") ?? "");

  function terminar(aviso?: string): never {
    revalidatePath("/admin");
    redirect(aviso ? `/admin?aviso=${encodeURIComponent(aviso)}` : "/admin");
  }

  if (!id || !PAPEIS_VALIDOS.has(papel)) terminar("Papel inválido.");
  if (id === admin.id && papel !== "admin") {
    terminar("Você não pode rebaixar o próprio papel.");
  }

  const supabase = await createClient();
  const { error } = await supabase
    .from("profiles")
    .update({ papel })
    .eq("id", id);

  if (error) terminar(`Não deu para alterar: ${error.message}`);
  terminar();
}

/** Entra ou sai do rodízio da distribuição automática (0041). */
export async function alternarRecebeLeads(formData: FormData) {
  const admin = await exigirAdmin();
  if (!admin) redirect("/hoje");

  const id = String(formData.get("id") ?? "");

  function terminar(aviso?: string): never {
    revalidatePath("/admin");
    redirect(aviso ? `/admin?aviso=${encodeURIComponent(aviso)}` : "/admin");
  }

  if (!id) terminar("Usuário não informado.");

  const supabase = await createClient();
  const { data, error: erroLeitura } = await supabase
    .from("profiles")
    .select("recebe_leads")
    .eq("id", id)
    .single();
  if (erroLeitura) {
    terminar("Rode a migração 0041 para controlar o rodízio por usuário.");
  }

  const { error } = await supabase
    .from("profiles")
    .update({ recebe_leads: !data?.recebe_leads })
    .eq("id", id);

  if (error) terminar(`Não deu para alterar: ${error.message}`);
  terminar();
}

export async function alternarUsuarioAtivo(formData: FormData) {
  const admin = await exigirAdmin();
  if (!admin) redirect("/hoje");

  const id = String(formData.get("id") ?? "");

  function terminar(aviso?: string): never {
    revalidatePath("/admin");
    redirect(aviso ? `/admin?aviso=${encodeURIComponent(aviso)}` : "/admin");
  }

  if (!id) terminar("Usuário não informado.");
  if (id === admin.id) terminar("Você não pode desativar a si mesmo.");

  const supabase = await createClient();
  const { data } = await supabase
    .from("profiles")
    .select("ativo")
    .eq("id", id)
    .single();

  const { error } = await supabase
    .from("profiles")
    .update({ ativo: !data?.ativo })
    .eq("id", id);

  if (error) terminar(`Não deu para alterar: ${error.message}`);
  terminar();
}

/**
 * Apaga os fatores de 2FA de alguém que perdeu o aparelho. No próximo login
 * a pessoa cadastra de novo — e o reset fica no log de acesso.
 */
export async function resetar2fa(formData: FormData) {
  const admin = await exigirAdmin();
  if (!admin) redirect("/hoje");
  const id = String(formData.get("id") ?? "");
  if (!id) redirect("/admin");

  const service = createServiceClient();
  const { data } = await service.auth.admin.mfa.listFactors({ userId: id });
  for (const fator of data?.factors ?? []) {
    await service.auth.admin.mfa.deleteFactor({ id: fator.id, userId: id });
  }
  registrarAcesso(admin.id, "resetou_2fa", { usuario_id: id });
  revalidatePath("/admin");
  redirect(
    `/admin?aviso=${encodeURIComponent("Segundo fator resetado — a pessoa cadastra de novo no próximo login.")}`,
  );
}
