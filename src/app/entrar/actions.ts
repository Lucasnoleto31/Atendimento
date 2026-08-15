"use server";

import { redirect } from "next/navigation";
import { revalidatePath } from "next/cache";
import { createClient } from "@/lib/supabase/server";

export type EstadoLogin = { erro?: string };

export async function entrar(
  _estado: EstadoLogin,
  formData: FormData,
): Promise<EstadoLogin> {
  const email = String(formData.get("email") ?? "").trim();
  const senha = String(formData.get("senha") ?? "");
  const proximo = String(formData.get("proximo") ?? "/atendimento");

  if (!email || !senha) {
    return { erro: "Informe e-mail e senha." };
  }

  const supabase = await createClient();
  const { error } = await supabase.auth.signInWithPassword({
    email,
    password: senha,
  });

  if (error) {
    // Mensagem genérica de propósito: não revelamos se o e-mail existe.
    return { erro: "E-mail ou senha incorretos." };
  }

  revalidatePath("/", "layout");
  redirect(proximo.startsWith("/") ? proximo : "/atendimento");
}

export async function sair() {
  const supabase = await createClient();
  await supabase.auth.signOut();
  revalidatePath("/", "layout");
  redirect("/entrar");
}
