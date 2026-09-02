import { createClient } from "@supabase/supabase-js";
const s = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY);
const anon = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL, process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY);

const { data: cfg, error: e1 } = await s.from("settings").select("chave, valor").in("chave", ["exigir_2fa"]);
console.log("0067 aplicada? settings.exigir_2fa =", e1 ? `ERRO ${e1.code}` : JSON.stringify(cfg));

const { count, error: e2 } = await s.from("v_leads_listas").select("lead_id", { count: "exact", head: true });
console.log("v_leads_listas (service role):", e2 ? `ERRO ${e2.code} ${e2.message}` : `${count} linhas`);

const { data: u } = await s.auth.admin.listUsers({ perPage: 50 });
for (const user of u?.users ?? []) {
  const { data: f } = await s.auth.admin.mfa.listFactors({ userId: user.id });
  const verificados = (f?.factors ?? []).filter((x) => x.status === "verified").length;
  console.log(`  ${user.email}: fatores verificados = ${verificados}`);
}
// papéis atuais
const { data: p } = await s.from("profiles").select("nome, papel, ativo").order("nome");
console.log("papéis:", (p ?? []).map((x) => `${x.nome}=${x.papel}${x.ativo ? "" : " (inativo)"}`).join(", "));
