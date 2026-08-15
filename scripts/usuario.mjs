/**
 * Cria ou promove um usuário da equipe enquanto a tela de Administração não existe.
 *
 *   node --env-file=.env.local scripts/usuario.mjs <email> "<Nome>" <papel>
 *
 * Papéis: admin | gestor | vendedor
 *
 * Se o usuário não existir, cria com senha aleatória e imprime a senha UMA vez.
 * Se já existir, apenas atualiza o papel.
 * Precisa de SUPABASE_SERVICE_ROLE_KEY preenchida — a chave ignora RLS, então
 * este script roda só na sua máquina, nunca no navegador.
 */
import { randomBytes } from "node:crypto";
import { createClient } from "@supabase/supabase-js";

const [email, nome, papel = "vendedor"] = process.argv.slice(2);

if (!email || !nome) {
  console.error(
    'Uso: node --env-file=.env.local scripts/usuario.mjs <email> "<Nome>" <papel>',
  );
  process.exit(1);
}

if (!["admin", "gestor", "vendedor"].includes(papel)) {
  console.error(`Papel inválido: ${papel}. Use admin, gestor ou vendedor.`);
  process.exit(1);
}

const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;

if (!url || !serviceKey) {
  console.error(
    "Faltam NEXT_PUBLIC_SUPABASE_URL ou SUPABASE_SERVICE_ROLE_KEY em .env.local.\n" +
      "A secret key está no painel: Project Settings > API Keys.",
  );
  process.exit(1);
}

const supabase = createClient(url, serviceKey, {
  auth: { autoRefreshToken: false, persistSession: false },
});

const { data: perfilExistente } = await supabase
  .from("profiles")
  .select("id, nome, papel")
  .eq("email", email)
  .maybeSingle();

if (perfilExistente) {
  const { error } = await supabase
    .from("profiles")
    .update({ papel, nome })
    .eq("id", perfilExistente.id);

  if (error) {
    console.error("Falha ao atualizar o perfil:", error.message);
    process.exit(1);
  }

  await supabase.auth.admin.updateUserById(perfilExistente.id, {
    user_metadata: { nome, papel },
  });

  console.log(
    `Perfil atualizado: ${email} agora é ${papel} (antes: ${perfilExistente.papel}).`,
  );
  process.exit(0);
}

const senha = randomBytes(12).toString("base64url");

const { error } = await supabase.auth.admin.createUser({
  email,
  password: senha,
  email_confirm: true,
  user_metadata: { nome, papel },
});

if (error) {
  console.error("Falha ao criar o usuário:", error.message);
  process.exit(1);
}

console.log(`Usuário criado: ${email} (${papel})`);
console.log(`Senha temporária: ${senha}`);
console.log("Anote agora — ela não é exibida de novo. Troque no primeiro acesso.");
