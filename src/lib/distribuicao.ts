import { createServiceClient } from "@/lib/supabase/server";

/** O cliente do webhook (chave secreta) e o da sessão têm o mesmo tipo. */
type ClienteSupabase = ReturnType<typeof createServiceClient>;

/**
 * Conversas abertas no nome de cada pessoa, a conta que decide o rodízio
 * (escolherVendedor) e a que a gestão vê ao distribuir (carregarCargaEquipe,
 * em conversas/lista.ts): as duas leem daqui, e a tela nunca mostra uma
 * carga enquanto o rodízio usa outra.
 *
 * Carga = do jeito que a caixa de entrada conta: não resolvida e com alguma
 * mensagem trocada (contato importado que nunca conversou não é trabalho de
 * ninguém). Adiada conta (volta para a mesma pessoa no prazo). Lead marcado
 * perdido aparece como resolvido na tela e por isso fica fora.
 *
 * Uma CONTAGEM por pessoa (head:true), não as linhas: trazer as linhas
 * esbarra no corte de 1000 do PostgREST e a carga sairia errada. A equipe
 * é pequena; N contagens em paralelo custam uma ida ao banco. A contagem
 * que falhou volta null: quem chama decide o que fazer com ela.
 */
export async function cargaDaEquipe(
  cliente: ClienteSupabase,
  ids: string[],
): Promise<Map<string, number | null>> {
  const contagens = await Promise.all(
    ids.map(async (id) => {
      const { count, error } = await cliente
        .from("leads")
        .select("id", { count: "exact", head: true })
        .eq("responsavel_id", id)
        .is("chat_resolvido_em", null)
        .not("ultima_interacao_em", "is", null)
        .neq("status", "perdido");
      return [id, error ? null : (count ?? 0)] as const;
    }),
  );
  return new Map(contagens);
}

/**
 * Distribuição automática de contato novo: com o parâmetro
 * `distribuicao_automatica` = 1, quem escreve pela primeira vez vai para
 * quem ATENDE (profiles.recebe_leads) com menos conversas abertas. Papel não
 * decide: o rodízio antigo filtrava papel = vendedor, só o Aikon passava, e
 * o "rodízio" era de uma pessoa só (1.022 contatos nas costas dele). Quem
 * entra na roda é decisão do gestor, no Admin. Usada pelos webhooks do
 * WhatsApp e do Instagram.
 */
export async function escolherVendedor(
  service: ClienteSupabase,
): Promise<{ id: string; nome: string; email: string } | null> {
  // O parâmetro e a equipe não dependem um do outro: saem juntos, e o
  // contato novo espera uma ida ao banco a menos para aparecer no chat.
  const [{ data: config }, { data: atendentes }] = await Promise.all([
    service
      .from("settings")
      .select("valor")
      .eq("chave", "distribuicao_automatica")
      .maybeSingle(),
    service
      .from("profiles")
      .select("id, nome, email")
      .eq("ativo", true)
      .eq("recebe_leads", true)
      .order("nome"),
  ]);
  if (Number(config?.valor ?? 0) !== 1) return null;

  const equipe = (atendentes ?? []) as {
    id: string;
    nome: string;
    email: string;
  }[];
  if (equipe.length === 0) return null;

  const carga = await cargaDaEquipe(
    service,
    equipe.map((p) => p.id),
  );

  return equipe.reduce((menor, pessoa) =>
    (carga.get(pessoa.id) ?? 0) < (carga.get(menor.id) ?? 0) ? pessoa : menor,
  );
}
