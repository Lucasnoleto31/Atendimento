"use server";

import { headers } from "next/headers";
import { redirect } from "next/navigation";
import { revalidatePath } from "next/cache";
import { createServiceClient } from "@/lib/supabase/server";
import { normalizarTelefone, variantesTelefone } from "@/lib/csv";
import { escolherVendedor } from "@/lib/distribuicao";

/**
 * O POST público da /captura (Fase 7.1). Aqui não existe sessão: o RLS de
 * leads só aceita insert autenticado, então TUDO roda no service role — e
 * por isso TODA validação vive neste arquivo, nada no cliente.
 *
 * Camadas, na ordem: honeypot (robô burro sai com a tela de sucesso e nada
 * acontece) → rate limit 5/15min por IP ou telefone (0056) → normalização →
 * deduplicação pelas duas grafias do nono dígito (contrato da 0036: jamais
 * dois cards da mesma pessoa) → criação com dono via rodízio oficial.
 *
 * Quem já é lead ou já é cliente vê a MESMA tela de sucesso — formulário
 * público não confirma para estranhos o que existe na base.
 */

const MAX_ENVIOS = 5;
const JANELA_MIN = 15;
const MAX_TEXTO = 120;

/** O PostgREST quebra o filtro or= com vírgula/parêntese/aspas no valor. */
function paraFiltro(valor: string): string {
  return valor.replaceAll(/[,()"]/g, "");
}

/** Primeiro salto do x-forwarded-for — é o IP real do cliente na Vercel. */
async function ipDoCliente(): Promise<string> {
  const h = await headers();
  const encadeado = h.get("x-forwarded-for") ?? "";
  const primeiro = encadeado.split(",")[0]?.trim();
  return primeiro || h.get("x-real-ip") || "desconhecido";
}

/** Campo de URL/formulário: curto, sem caracteres de controle. */
function limpar(valor: unknown): string {
  return String(valor ?? "")
    .replaceAll(/[\u0000-\u001F\u007F]/g, "")
    .trim()
    .slice(0, MAX_TEXTO);
}

export async function capturarLead(formData: FormData) {
  // A volta (sucesso ou erro) preserva os parâmetros de campanha da URL —
  // quem errar o telefone reenvia sem perder a atribuição.
  const rastreio = new URLSearchParams();
  for (const chave of [
    "campanha",
    "etiqueta",
    "utm_source",
    "utm_medium",
    "utm_campaign",
    "utm_content",
  ]) {
    const valor = limpar(formData.get(chave));
    if (valor) rastreio.set(chave, valor);
  }
  // Function declaration de propósito: chamada com retorno never só encerra
  // o fluxo para o TypeScript quando o callee tem anotação explícita.
  function voltar(extra: string): never {
    const query = rastreio.toString();
    redirect(`/captura?${extra}${query ? `&${query}` : ""}`);
  }

  // Honeypot: o campo "website" é invisível para gente; preenchido, é robô.
  // Sai com a tela de sucesso e nenhum lead — descarte em silêncio.
  if (String(formData.get("website") ?? "").trim() !== "") {
    voltar("ok=1");
  }

  const nome = limpar(formData.get("nome"));
  const telefoneBruto = limpar(formData.get("telefone"));
  if (!nome) voltar(`erro=${encodeURIComponent("Informe seu nome.")}`);
  if (!telefoneBruto) {
    voltar(`erro=${encodeURIComponent("Informe seu WhatsApp com DDD.")}`);
  }

  const service = createServiceClient();
  const ip = paraFiltro(await ipDoCliente());
  const telefone = normalizarTelefone(telefoneBruto);

  // Rate limit ANTES de qualquer trabalho: 5 envios em 15min pelo mesmo IP
  // ou telefone. Mensagem genérica — não diz o limite nem o tempo restante.
  const corte = new Date(Date.now() - JANELA_MIN * 60_000).toISOString();
  const filtroEixos = telefone
    ? `ip.eq.${ip},telefone.eq.${paraFiltro(telefone)}`
    : `ip.eq.${ip}`;
  const { count: recentes, error: erroLimite } = await service
    .from("captura_tentativas")
    .select("id", { count: "exact", head: true })
    .or(filtroEixos)
    .gte("criado_em", corte);

  // Sem a 0056 a tabela não existe: o formulário segue funcionando sem o
  // limite (o honeypot continua de pé) — convenção da casa.
  if (!erroLimite && (recentes ?? 0) >= MAX_ENVIOS) {
    await service.from("auditoria").insert({
      quem: null,
      acao: "captura_bloqueada",
      detalhes: { ip, telefone: telefone ?? telefoneBruto },
    });
    voltar(
      `erro=${encodeURIComponent(
        "Muitos envios em sequência. Aguarde alguns minutos e tente de novo.",
      )}`,
    );
  }
  if (!erroLimite) {
    await service
      .from("captura_tentativas")
      .insert({ ip, telefone: telefone ?? null });
    // Expurgo do que passou de 24h — sem cron, a limpeza mora no caminho.
    await service
      .from("captura_tentativas")
      .delete()
      .lt("criado_em", new Date(Date.now() - 24 * 3600_000).toISOString());
  }

  if (!telefone) {
    voltar(
      `erro=${encodeURIComponent(
        "Telefone inválido. Use DDD + número, ex.: 62 98181-0004.",
      )}`,
    );
  }

  // Já é lead (em qualquer das duas grafias do nono dígito)? Não cria nada
  // e agradece do mesmo jeito — o atendimento continua no card que existe.
  const variantes = variantesTelefone(telefone);
  const { data: leadExistente } = await service
    .from("leads")
    .select("id")
    .in("telefone_e164", variantes)
    .limit(1)
    .maybeSingle();
  if (leadExistente) voltar("ok=1");

  // Já é CLIENTE da carteira? O dono do lead novo é o dono da carteira —
  // sem isso, o gatilho 0031 espelharia o vendedor do rodízio como novo
  // dono do cliente, e um formulário público roubaria carteira alheia.
  const { data: clienteExistente } = await service
    .from("customers")
    .select("id, responsavel_id")
    .in("telefone_e164", variantes)
    .limit(1)
    .maybeSingle();

  const vendedor = clienteExistente?.responsavel_id
    ? null
    : await escolherVendedor(service);
  const responsavelId = clienteExistente?.responsavel_id ?? vendedor?.id ?? null;

  // Primeira etapa do kanban padrão — igual ao cadastro manual.
  const { data: etapa } = await service
    .from("pipeline_stages")
    .select("id, pipeline:pipelines!inner(padrao)")
    .eq("pipeline.padrao", true)
    .order("ordem")
    .limit(1)
    .maybeSingle();

  const { data: canal } = await service
    .from("channels")
    .select("id")
    .eq("slug", "site")
    .maybeSingle();

  const { data: lead, error } = await service
    .from("leads")
    .insert({
      nome,
      telefone_e164: telefone,
      channel_id: canal?.id ?? null,
      campanha: rastreio.get("campanha") ?? null,
      utm_source: rastreio.get("utm_source") ?? null,
      utm_medium: rastreio.get("utm_medium") ?? null,
      utm_campaign: rastreio.get("utm_campaign") ?? null,
      utm_content: rastreio.get("utm_content") ?? null,
      stage_id: etapa?.id ?? null,
      status: "novo",
      entrada_motivo: "formulario",
      responsavel_id: responsavelId,
    })
    .select("id")
    .single();

  // Corrida entre dois envios (o índice único parcial não aceita ON
  // CONFLICT): o segundo perde e agradece igual — o lead vencedor já existe.
  if (error || !lead) {
    if (error?.code === "23505") voltar("ok=1");
    voltar(
      `erro=${encodeURIComponent(
        "Não deu para enviar agora. Tente de novo em instantes.",
      )}`,
    );
  }

  // Etiqueta da URL: vincula SÓ se ela já existir com aquele nome — URL
  // pública não cria etiqueta (vetor de lixo na base).
  const nomeEtiqueta = rastreio.get("etiqueta");
  if (nomeEtiqueta) {
    const { data: tag } = await service
      .from("tags")
      .select("id")
      .eq("nome", nomeEtiqueta)
      .eq("ativo", true)
      .maybeSingle();
    if (tag) {
      await service
        .from("lead_tags")
        .insert({ lead_id: lead.id, tag_id: tag.id });
    }
  }

  // O histórico não nasce mudo: registra quem recebeu o lead e por quê.
  if (responsavelId) {
    await service.from("lead_interactions").insert({
      lead_id: lead.id,
      tipo: "atribuicao",
      conteudo: clienteExistente?.responsavel_id
        ? "Atendimento atribuído ao dono da carteira (formulário do site)"
        : `Atendimento atribuído a ${vendedor?.nome ?? "vendedor"} (formulário do site)`,
      metadados: { via: "captura" },
    });
  }

  revalidatePath("/leads");
  revalidatePath("/atendimento");
  voltar("ok=1");
}
