import { cookies } from "next/headers";
import { createServerClient } from "@supabase/ssr";

/** Cliente para Server Components, Server Actions e Route Handlers. */
export async function createClient() {
  const cookieStore = await cookies();

  return createServerClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
    {
      cookies: {
        getAll() {
          return cookieStore.getAll();
        },
        setAll(cookiesToSet) {
          try {
            cookiesToSet.forEach(({ name, value, options }) =>
              cookieStore.set(name, value, options),
            );
          } catch {
            // Server Component não pode escrever cookie. O middleware renova a
            // sessão, então aqui é seguro ignorar.
          }
        },
      },
    },
  );
}

/**
 * Cliente com a chave secreta: ignora RLS.
 * Use SOMENTE em rota de servidor (webhook da Meta, importações em lote).
 */
export function createServiceClient() {
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!key) {
    throw new Error(
      "SUPABASE_SERVICE_ROLE_KEY não configurada em .env.local — veja docs/SETUP.md",
    );
  }

  return createServerClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, key, {
    cookies: { getAll: () => [], setAll: () => {} },
  });
}
