import type { createServiceClient } from "@/lib/supabase/server";

/**
 * DEFINIÇÃO CANÔNICA DE "ATIVAÇÃO" (decidida em 30/08/2026, Fase 2 do plano):
 *
 *   Ativação = o cliente fez o PRIMEIRO giro da vida — a primeira linha dele
 *   em customer_lots.
 *
 *   · O MÊS da ativação é o da `referencia_data` desse primeiro lote (o dia
 *     em que o cliente DE FATO operou). O arquivo da Genial chega um dia
 *     depois, então a operação de 31/08 importada em 01/09 conta em agosto —
 *     metas mensais e relatórios usam esta régua.
 *   · A exceção deliberada é o placar do dia da /hoje, que mostra "ativações
 *     REGISTRADAS hoje" (pela chegada do arquivo) para dar retorno no mesmo
 *     dia — o rótulo da tela diz isso.
 *   · A ativação conta para o dono ATUAL do cliente (responsavel_id no
 *     momento da contagem) — não existe histórico de posse no modelo, e é
 *     como o giro em risco já funciona.
 *
 * Toda conta nova de ativação (metas da 0050, funil de Pagamentos, tempo
 * médio até ativar) DEVE partir desta definição, não inventar outra.
 */

/**
 * Marcas automáticas do roteiro de ativação (Profit Pro → 1ª operação →
 * print). As etiquetas da 0034 dependiam de etiquetagem manual e tiveram
 * 0, 0 e 3 usos em 12 dias — etiqueta que depende de disciplina não mede
 * nada. Agora as marcas nascem dos fatos:
 *
 *   · template enviado a lead na coluna Ativação  → "roteiro enviado"
 *   · imagem recebida de lead na coluna Ativação  → "print recebido"
 *
 * O relatório por etiqueta (0031) passa a mostrar a conversão entre os
 * passos sem ninguém precisar lembrar de etiquetar.
 */

type Service = ReturnType<typeof createServiceClient>;

async function etiquetaId(service: Service, nome: string) {
  const { data } = await service
    .from("tags")
    .select("id")
    .eq("nome", nome)
    .maybeSingle();
  return (data?.id as string | undefined) ?? null;
}

async function leadsEmAtivacao(service: Service, leadIds: string[]) {
  if (leadIds.length === 0) return [];
  const { data } = await service
    .from("leads")
    .select("id, stage:pipeline_stages!inner(nome)")
    .in("id", leadIds)
    .eq("stage.nome", "Ativação");
  return ((data ?? []) as { id: string }[]).map((l) => l.id);
}

/** Template saiu para lead na fila de Ativação: carimba "roteiro enviado". */
export async function marcarRoteiroEnviado(
  service: Service,
  leadIds: string[],
): Promise<void> {
  try {
    const alvos = await leadsEmAtivacao(service, leadIds);
    if (alvos.length === 0) return;
    const tag = await etiquetaId(service, "Ativação · roteiro enviado");
    if (!tag) return;
    await service
      .from("lead_tags")
      .upsert(
        alvos.map((lead_id) => ({ lead_id, tag_id: tag })),
        { onConflict: "lead_id,tag_id" },
      );
  } catch {
    // Marca é métrica, não fluxo: falha aqui nunca derruba um envio.
  }
}

/** Lead na Ativação mandou imagem: quase sempre é o print da operação. */
export async function marcarPrintRecebido(
  service: Service,
  leadId: string,
): Promise<void> {
  try {
    const alvos = await leadsEmAtivacao(service, [leadId]);
    if (alvos.length === 0) return;
    const tag = await etiquetaId(service, "Ativação · print recebido");
    if (!tag) return;
    const { error } = await service
      .from("lead_tags")
      .insert({ lead_id: leadId, tag_id: tag });
    if (!error) {
      await service.from("lead_interactions").insert({
        lead_id: leadId,
        tipo: "nota",
        conteudo:
          "Imagem recebida na fila de Ativação — marcado como print recebido. Confira e libere o benefício.",
        metadados: { via: "automatico" },
      });
    }
  } catch {
    // idem: métrica nunca derruba o webhook.
  }
}
