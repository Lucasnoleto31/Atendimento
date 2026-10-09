"use server";

import { redirect } from "next/navigation";
import { revalidatePath } from "next/cache";
import { createServiceClient } from "@/lib/supabase/server";
import { normalizarTelefone, variantesTelefone } from "@/lib/telefone";
import { escolherVendedor } from "@/lib/distribuicao";
import { registrarAcesso } from "@/lib/auditoria";
import { chaveDaEtiqueta } from "@/lib/imports/etiqueta";
import { ipDoCliente, paraFiltro } from "@/app/entrar/freio";
import { lerRastreio, limpar } from "./rastreio";

/**
 * O envio do formulário público /captura. Aqui não existe sessão: o RLS de
 * leads só aceita gravação de quem está logado, então tudo roda com a chave
 * de serviço, e por isso toda conferência mora neste arquivo, no servidor.
 *
 * Na ordem: honeypot (robô sai com a tela de sucesso e nada acontece), freio
 * de 5 envios em 15 minutos por IP ou telefone (captura_tentativas, 0056),
 * normalização, telefone que já é contato (as duas grafias do nono dígito)
 * e o contato novo, no modelo de hoje: sem etapa nem status de funil, com a
 * origem em leads.campanha e o responsável da carteira ou da distribuição
 * automática.
 *
 * Quem já é contato vê a mesma tela de sucesso: formulário público não
 * confirma para estranhos quem está na base.
 */

export type EstadoCaptura = {
  /** O que foi digitado: o campo volta preenchido depois do erro. */
  nome?: string;
  telefone?: string;
  erroNome?: string;
  erroTelefone?: string;
  /** O erro que não é de um campo (freio, falha), acima do botão. */
  erro?: string;
};

const MAX_ENVIOS = 5;
const JANELA_MIN = 15;
/** O que passou disso sai da tabela no próprio envio (não há cron). */
const EXPURGO_MS = 24 * 3_600_000;

const ERRO_FALHA = "O envio falhou do nosso lado. Tente de novo em alguns instantes.";

/** O nome como padrão do LIKE: %, _ e \ valem como texto. */
function paraLike(texto: string): string {
  return texto.replace(/[\\%_]/g, (c) => `\\${c}`);
}

export async function capturarLead(
  _estado: EstadoCaptura,
  formData: FormData,
): Promise<EstadoCaptura> {
  // A volta leva os parâmetros de campanha: a página de sucesso fica com a
  // mesma atribuição do anúncio.
  const rastreio = new URLSearchParams(
    lerRastreio((chave) => formData.get(chave)).map(({ chave, valor }) => [
      chave,
      valor,
    ]),
  );
  // Declaração de função de propósito: só com a anotação explícita o
  // TypeScript entende que a chamada encerra o fluxo.
  function sucesso(): never {
    const query = rastreio.toString();
    redirect(`/captura?ok=1${query ? `&${query}` : ""}`);
  }

  // Honeypot: o campo "website" é invisível para gente; preenchido, é robô.
  if (limpar(formData.get("website")) !== "") sucesso();

  const nome = limpar(formData.get("nome"));
  const telefoneBruto = limpar(formData.get("telefone"));
  const digitado = { nome, telefone: telefoneBruto };
  if (!nome || !telefoneBruto) {
    return {
      ...digitado,
      ...(nome ? {} : { erroNome: "Escreva seu nome." }),
      ...(telefoneBruto ? {} : { erroTelefone: "Escreva seu WhatsApp com DDD." }),
    };
  }

  let service: ReturnType<typeof createServiceClient>;
  try {
    service = createServiceClient();
  } catch {
    return { ...digitado, erro: ERRO_FALHA };
  }
  const ip = paraFiltro(await ipDoCliente());
  // Número digitado à mão, como no cadastro de contato: com "+" e outro
  // país, vale como veio; sem "+", é brasileiro e precisa do DDD.
  const telefone = normalizarTelefone(telefoneBruto, { aceitarExterior: true });

  // Freio antes de qualquer outra coisa, pelo mesmo IP ou pelo mesmo
  // telefone. A mensagem não diz o limite nem quanto falta. Sem a tabela
  // (0056), o formulário segue sem o freio e o honeypot continua de pé.
  const corte = new Date(Date.now() - JANELA_MIN * 60_000).toISOString();
  const eixos = telefone
    ? `ip.eq.${ip},telefone.eq.${paraFiltro(telefone)}`
    : `ip.eq.${ip}`;
  const { count: recentes, error: erroFreio } = await service
    .from("captura_tentativas")
    .select("id", { count: "exact", head: true })
    .or(eixos)
    .gte("criado_em", corte);
  if (erroFreio) {
    console.warn(`[captura] sem freio: ${erroFreio.message}`);
  } else {
    if ((recentes ?? 0) >= MAX_ENVIOS) {
      registrarAcesso(null, "captura_bloqueada", {
        ip,
        telefone: telefone ?? telefoneBruto,
      });
      return {
        ...digitado,
        erro: "Muitos envios em sequência. Espere alguns minutos e tente de novo.",
      };
    }
    await Promise.all([
      service.from("captura_tentativas").insert({ ip, telefone }),
      service
        .from("captura_tentativas")
        .delete()
        .lt("criado_em", new Date(Date.now() - EXPURGO_MS).toISOString()),
    ]);
  }

  if (!telefone) {
    return {
      ...digitado,
      erroTelefone: "Confira o número: DDD e número, como (11) 91234-5678.",
    };
  }

  // Já é contato, em qualquer das duas grafias do nono dígito? Não cria
  // nada e agradece igual: o atendimento segue no contato que existe. Já é
  // cliente da carteira com dono? O dono atende: sem isso, o gatilho da
  // carteira (0031) passaria o cliente para quem a distribuição escolheu, e
  // um formulário público mudaria o dono de um cliente.
  const variantes = variantesTelefone(telefone);
  const [{ data: existentes, error: erroBusca }, { data: clientes }] =
    await Promise.all([
      service.from("leads").select("id").in("telefone_e164", variantes).limit(1),
      service
        .from("customers")
        .select("responsavel_id")
        .in("telefone_e164", variantes)
        .not("responsavel_id", "is", null)
        .limit(1),
    ]);
  if (erroBusca) {
    console.error(`[captura] busca do contato: ${erroBusca.message}`);
    return { ...digitado, erro: ERRO_FALHA };
  }
  if ((existentes ?? []).length > 0) sucesso();

  const donoCarteira =
    ((clientes ?? [])[0] as { responsavel_id: string } | undefined)
      ?.responsavel_id ?? null;
  const atendente = donoCarteira ? null : await escolherVendedor(service);
  const responsavelId = donoCarteira ?? atendente?.id ?? null;

  const { data: lead, error } = await service
    .from("leads")
    .insert({
      nome,
      telefone_e164: telefone,
      // A origem: a campanha do link e, sem ela, o utm_campaign (a mesma
      // equivalência da importação, que lê utm_campaign como campanha).
      campanha: rastreio.get("campanha") ?? rastreio.get("utm_campaign"),
      utm_source: rastreio.get("utm_source"),
      utm_medium: rastreio.get("utm_medium"),
      utm_campaign: rastreio.get("utm_campaign"),
      utm_content: rastreio.get("utm_content"),
      entrada_motivo: "formulario",
      responsavel_id: responsavelId,
    })
    .select("id")
    .single();

  if (error || !lead) {
    // Dois envios ao mesmo tempo: o índice único do telefone barra o
    // segundo, e o contato do primeiro já existe.
    if (error?.code === "23505") sucesso();
    console.error(`[captura] contato não gravado: ${error?.message}`);
    return { ...digitado, erro: ERRO_FALHA };
  }

  // A etiqueta do link entra só se já existir e estiver ativa: link público
  // não cria etiqueta, senão qualquer um encheria a lista. A comparação é a
  // da importação (sem olhar maiúscula, com acento).
  const nomeEtiqueta = rastreio.get("etiqueta");
  const [etiquetas, quemAtende] = await Promise.all([
    nomeEtiqueta
      ? service
          .from("tags")
          .select("id, nome")
          .ilike("nome", paraLike(nomeEtiqueta))
          .eq("ativo", true)
      : null,
    responsavelId
      ? service
          .from("profiles")
          .select("nome")
          .eq("id", responsavelId)
          .maybeSingle()
      : null,
  ]);
  const etiqueta = nomeEtiqueta
    ? ((etiquetas?.data ?? []) as { id: string; nome: string }[]).find(
        (t) => chaveDaEtiqueta(t.nome) === chaveDaEtiqueta(nomeEtiqueta),
      )
    : undefined;

  // O fio não nasce mudo: quem recebeu o contato fica registrado.
  const nomeAtendente =
    (quemAtende?.data as { nome: string | null } | null)?.nome ??
    atendente?.nome ??
    null;
  const gravacoes = await Promise.all([
    etiqueta
      ? service
          .from("lead_tags")
          .insert({ lead_id: lead.id, tag_id: etiqueta.id })
      : null,
    responsavelId
      ? service.from("lead_interactions").insert({
          lead_id: lead.id,
          tipo: "atribuicao",
          conteudo: `Atendimento atribuído a ${nomeAtendente ?? "alguém da equipe"} (formulário do site)`,
          metadados: { via: "captura" },
        })
      : null,
  ]);
  for (const r of gravacoes) {
    if (r?.error) console.warn(`[captura] ${lead.id}: ${r.error.message}`);
  }

  revalidatePath("/contatos");
  sucesso();
}
