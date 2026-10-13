"use server";

import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { autenticadorLiberado } from "./liberado";

export type EstadoAutenticador = { erro?: string };

/**
 * Só no computador de desenvolvimento: sobe a sessão para o nível do app
 * autenticador (aal2). O banco de produção ainda exige esse nível em toda
 * tabela (settings.exigir_2fa = "1", policy exige_segundo_fator) enquanto o
 * Lucas não desliga; sem isto, o sistema local abre vazio. No ar, esta
 * action não faz nada (ver liberado.ts).
 */
export async function confirmarAutenticador(
  _estado: EstadoAutenticador,
  formData: FormData,
): Promise<EstadoAutenticador> {
  if (!autenticadorLiberado()) {
    return { erro: "Indisponível." };
  }
  const codigo = String(formData.get("codigo") ?? "").replace(/\D/g, "");
  if (codigo.length !== 6) return { erro: "Digite os 6 números do app." };

  const supabase = await createClient();
  const { data: fatores, error: erroFatores } =
    await supabase.auth.mfa.listFactors();
  if (erroFatores) return { erro: "A sessão não está ativa. Entre de novo." };
  const fator = fatores.totp.find((f) => f.status === "verified");
  if (!fator) {
    return { erro: "Esta conta não tem app autenticador cadastrado." };
  }

  const { error } = await supabase.auth.mfa.challengeAndVerify({
    factorId: fator.id,
    code: codigo,
  });
  if (error) return { erro: "Código errado ou vencido. Tente o próximo." };

  redirect("/chat");
}
