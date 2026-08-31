"use server";

import { revalidatePath } from "next/cache";
import { createClient, createServiceClient } from "@/lib/supabase/server";
import { perfilAtual } from "@/lib/auth";
import { templateBloqueadoAte } from "@/lib/perda";
import { variantesTelefone } from "@/lib/csv";
import { listarTemplatesMeta, metaConfigurada } from "@/lib/whatsapp";
import { dispararTemplate } from "@/lib/cadencia";
import { avancarAposDisparo } from "@/lib/kanban";

/**
 * Ações que a carteira executa sobre VÁRIOS clientes de uma vez: etiquetar
 * (para virar público de campanha) e disparar um template aprovado.
 *
 * Teto do disparo imediato: a Meta limita conversas iniciadas por dia e
 * bloqueio em massa derruba a qualidade do número — que é o canal de TODO o
 * atendimento. Lista maior é trabalho de campanha, que escoa no ritmo certo.
 */
const MAX_DISPARO_MASSA = 50;
const MAX_ETIQUETA_MASSA = 200;
/** Modo "filtro inteiro": a carteira toda cabe com folga aqui. */
const MAX_ETIQUETA_FILTRO = 5000;

type LeadDoCliente = {
  id: string;
  nome: string | null;
  telefone_e164: string | null;
  marketing_bloqueado_em: string | null;
  ultima_interacao_em: string | null;
  status?: string | null;
  perdido_em?: string | null;
};

type ClienteAlvo = {
  id: string;
  nome_completo: string;
  telefone_e164: string | null;
  responsavel_id: string | null;
};

type Servico = ReturnType<typeof createServiceClient>;

const CAMPOS_LEAD_BASE =
  "id, nome, telefone_e164, marketing_bloqueado_em, ultima_interacao_em";
const CAMPOS_LEAD = `${CAMPOS_LEAD_BASE}, status, perdido_em`;

/** Banco ainda sem a 0038 (coluna perdido_em ausente): refaz sem as colunas
 *  novas e o bloqueio de perdido fica inativo — melhor do que engolir o erro
 *  e tratar cliente com lead como "sem lead". */
function faltaColuna(erro: { code?: string } | null): boolean {
  return erro?.code === "42703" || erro?.code === "PGRST204";
}

export type ResultadoMassa = { ok?: boolean; erro?: string; aviso?: string };

/** Conversa mais viva primeiro — o mesmo critério da v_carteira. */
function maisVivo(linhas: LeadDoCliente[]): LeadDoCliente | null {
  return (
    linhas
      .slice()
      .sort((a, b) =>
        (b.ultima_interacao_em ?? "").localeCompare(
          a.ultima_interacao_em ?? "",
        ),
      )[0] ?? null
  );
}

async function padroesDeLead(
  service: Servico,
): Promise<{ canalId: string | null; etapaId: string | null }> {
  const [{ data: canal }, { data: etapa }] = await Promise.all([
    service.from("channels").select("id").eq("slug", "whatsapp").maybeSingle(),
    service
      .from("pipeline_stages")
      .select("id, pipeline:pipelines!inner(padrao)")
      .eq("pipeline.padrao", true)
      .order("ordem")
      .limit(1)
      .maybeSingle(),
  ]);
  return { canalId: canal?.id ?? null, etapaId: etapa?.id ?? null };
}

/**
 * O lead por onde se fala com este cliente. Quem veio da importação e nunca
 * teve lead ganha um agora — sem lead a etiqueta não serviria para campanha
 * nenhuma, porque o motor de campanha varre `lead_tags`.
 */
async function resolverLeadDoCliente(
  service: Servico,
  cliente: ClienteAlvo,
  padroes: { canalId: string | null; etapaId: string | null },
  autorId: string,
): Promise<{ lead: LeadDoCliente | null; criado: boolean }> {
  const vinculadosCheio = await service
    .from("leads")
    .select(CAMPOS_LEAD)
    .eq("customer_id", cliente.id);
  const vinculados = faltaColuna(vinculadosCheio.error)
    ? (
        await service
          .from("leads")
          .select(CAMPOS_LEAD_BASE)
          .eq("customer_id", cliente.id)
      ).data
    : vinculadosCheio.data;

  const existente = maisVivo((vinculados ?? []) as LeadDoCliente[]);
  if (existente) return { lead: existente, criado: false };

  if (!cliente.telefone_e164) return { lead: null, criado: false };

  // Pode haver lead com esse número ainda sem vínculo — as duas grafias do
  // nono dígito, porque o WhatsApp registra sem o 9 e o cadastro vem com.
  const soltosCheio = await service
    .from("leads")
    .select(CAMPOS_LEAD)
    .in("telefone_e164", variantesTelefone(cliente.telefone_e164));
  const soltos = faltaColuna(soltosCheio.error)
    ? (
        await service
          .from("leads")
          .select(CAMPOS_LEAD_BASE)
          .in("telefone_e164", variantesTelefone(cliente.telefone_e164))
      ).data
    : soltosCheio.data;

  const solto = maisVivo((soltos ?? []) as LeadDoCliente[]);
  if (solto) {
    await service
      .from("leads")
      .update({
        customer_id: cliente.id,
        cliente_confirmado_em: new Date().toISOString(),
      })
      .eq("id", solto.id);
    return { lead: solto, criado: false };
  }

  const dadosNovoLead = {
    nome: cliente.nome_completo,
    telefone_e164: cliente.telefone_e164,
    customer_id: cliente.id,
    cliente_confirmado_em: new Date().toISOString(),
    channel_id: padroes.canalId,
    stage_id: padroes.etapaId,
    status: "em_atendimento",
    entrada_motivo: "importacao",
    responsavel_id: cliente.responsavel_id ?? autorId,
  };
  // RETURNING com coluna ausente falha ANTES de inserir — dá para repetir.
  const novoCheio = await service
    .from("leads")
    .insert(dadosNovoLead)
    .select(CAMPOS_LEAD)
    .single();
  const novo = faltaColuna(novoCheio.error)
    ? (
        await service
          .from("leads")
          .insert(dadosNovoLead)
          .select(CAMPOS_LEAD_BASE)
          .single()
      ).data
    : novoCheio.data;

  return { lead: (novo as LeadDoCliente) ?? null, criado: Boolean(novo) };
}

type Etiqueta = { id?: string; novoNome?: string };

/** Resolve a etiqueta escolhida na lista, ou cria a de nome novo. */
async function resolverEtiqueta(
  service: Servico,
  etiqueta: Etiqueta,
): Promise<{ tagId?: string; erro?: string }> {
  if (etiqueta.id) return { tagId: etiqueta.id };

  const nome = (etiqueta.novoNome ?? "").trim();
  if (!nome) return { erro: "Escolha uma etiqueta ou dê um nome à nova." };

  const { data: existente } = await service
    .from("tags")
    .select("id")
    .ilike("nome", nome)
    // limit(1): dois nomes que só diferem no caixa fariam maybeSingle
    // devolver erro e a tela diria "não deu para criar" sem motivo.
    .limit(1)
    .maybeSingle();
  if (existente) return { tagId: existente.id as string };

  const { data: criada, error } = await service
    .from("tags")
    .insert({ nome })
    .select("id")
    .single();
  if (error || !criada) {
    return { erro: `Não deu para criar a etiqueta: ${error?.message ?? ""}` };
  }
  return { tagId: criada.id as string };
}

type Contagem = { etiquetados: number; criados: number; semTelefone: number };

/**
 * Núcleo do etiquetar. Trabalha em fatias e busca os leads de uma fatia
 * inteira numa consulta só: a carteira em churn tem mais de mil clientes, e
 * uma ida ao banco por cliente estouraria o tempo da ação.
 */
async function aplicarEtiqueta(
  service: Servico,
  clienteIds: string[],
  tagId: string,
  autorId: string,
): Promise<Contagem> {
  const conta: Contagem = { etiquetados: 0, criados: 0, semTelefone: 0 };
  let padroes: { canalId: string | null; etapaId: string | null } | null = null;

  for (let i = 0; i < clienteIds.length; i += 200) {
    const fatia = clienteIds.slice(i, i + 200);

    const [{ data: clientes }, { data: leads }] = await Promise.all([
      service
        .from("customers")
        .select("id, nome_completo, telefone_e164, responsavel_id")
        .in("id", fatia),
      service
        .from("leads")
        .select(`${CAMPOS_LEAD}, customer_id`)
        .in("customer_id", fatia),
    ]);

    // Agrupa os leads por cliente e fica com a conversa mais viva de cada um.
    const porCliente = new Map<string, LeadDoCliente[]>();
    for (const lead of (leads ?? []) as (LeadDoCliente & {
      customer_id: string;
    })[]) {
      const lista = porCliente.get(lead.customer_id) ?? [];
      lista.push(lead);
      porCliente.set(lead.customer_id, lista);
    }

    const vinculos: { lead_id: string; tag_id: string }[] = [];

    for (const cliente of (clientes ?? []) as ClienteAlvo[]) {
      const jaTem = maisVivo(porCliente.get(cliente.id) ?? []);
      if (jaTem) {
        vinculos.push({ lead_id: jaTem.id, tag_id: tagId });
        continue;
      }

      // Caminho raro: cliente da importação que nunca teve conversa.
      padroes ??= await padroesDeLead(service);
      const { lead, criado } = await resolverLeadDoCliente(
        service,
        cliente,
        padroes,
        autorId,
      );
      if (!lead) {
        conta.semTelefone++;
        continue;
      }
      if (criado) conta.criados++;
      vinculos.push({ lead_id: lead.id, tag_id: tagId });
    }

    // Dois clientes com o mesmo telefone podem cair no mesmo lead; linha
    // repetida no mesmo upsert não tem por que ir ao banco duas vezes.
    const unicos = [...new Map(vinculos.map((v) => [v.lead_id, v])).values()];

    if (unicos.length > 0) {
      const { error } = await service.from("lead_tags").upsert(unicos, {
        onConflict: "lead_id,tag_id",
        ignoreDuplicates: true,
      });
      if (!error) conta.etiquetados += unicos.length;
    }
  }

  return conta;
}

function resumoEtiqueta(conta: Contagem, nomeEtiqueta?: string): string {
  const partes = [`${conta.etiquetados} cliente(s) etiquetado(s)`];
  if (conta.criados > 0) partes.push(`${conta.criados} ganharam conversa nova`);
  if (conta.semTelefone > 0) {
    partes.push(`${conta.semTelefone} ficaram de fora por não ter telefone`);
  }
  const alvo = nomeEtiqueta ? ` apontando para "${nomeEtiqueta}"` : "";
  return `${partes.join(" · ")}. Agora crie a campanha${alvo}.`;
}

/**
 * Marca a etiqueta nos clientes escolhidos — o passo que transforma uma
 * seleção da carteira em público de campanha. Aceita etiqueta que já existe
 * ou um nome novo, criado na hora.
 */
export async function etiquetarClientesEmMassa(
  customerIds: string[],
  etiqueta: Etiqueta,
): Promise<ResultadoMassa> {
  const perfil = await perfilAtual();
  if (!perfil) return { erro: "Sessão expirada. Entre novamente." };

  const ids = [...new Set(customerIds.filter(Boolean))];
  if (ids.length === 0) return { erro: "Selecione pelo menos um cliente." };
  if (ids.length > MAX_ETIQUETA_MASSA) {
    return { erro: `Muitos de uma vez — no máximo ${MAX_ETIQUETA_MASSA}.` };
  }

  const service = createServiceClient();
  const { tagId, erro } = await resolverEtiqueta(service, etiqueta);
  if (!tagId) return { erro };

  const conta = await aplicarEtiqueta(service, ids, tagId, perfil.id);

  revalidatePath("/carteira");
  revalidatePath("/campanhas");
  return { ok: true, aviso: resumoEtiqueta(conta, etiqueta.novoNome?.trim()) };
}

export type FiltroCarteira = {
  escopo: "minha" | "todas";
  status: string;
  busca: string;
};

/**
 * Etiqueta TUDO o que está no filtro atual, não só a página visível — é o
 * caminho para listas como "todos os 1159 em churn", que jamais caberiam
 * numa seleção de 100 por página.
 */
export async function etiquetarPorFiltroCarteira(
  filtro: FiltroCarteira,
  etiqueta: Etiqueta,
): Promise<ResultadoMassa> {
  const perfil = await perfilAtual();
  if (!perfil) return { erro: "Sessão expirada. Entre novamente." };

  // Leitura pelo cliente do USUÁRIO: v_carteira é security_invoker, então o
  // filtro enxerga exatamente o que essa pessoa enxerga na tela.
  const supabase = await createClient();
  const ids: string[] = [];

  for (let de = 0; de < MAX_ETIQUETA_FILTRO; de += 1000) {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any -- corta a recursão de tipos do builder
    let consulta: any = supabase
      .from("v_carteira")
      .select("customer_id")
      .order("customer_id");
    if (filtro.escopo === "minha") {
      consulta = consulta.eq("responsavel_id", perfil.id);
    }
    if (filtro.status && filtro.status !== "todos") {
      consulta = consulta.eq("status", filtro.status);
    }
    if (filtro.busca) {
      const digitos = filtro.busca.replace(/\D/g, "");
      consulta =
        digitos.length >= 4
          ? consulta.or(
              `nome_completo.ilike.%${filtro.busca}%,telefone_e164.ilike.%${digitos}%`,
            )
          : consulta.ilike("nome_completo", `%${filtro.busca}%`);
    }

    const { data, error } = await consulta.range(de, de + 999);
    if (error) return { erro: `Não deu para ler o filtro: ${error.message}` };
    if (!data || data.length === 0) break;
    ids.push(...data.map((l: { customer_id: string }) => l.customer_id));
    if (data.length < 1000) break;
  }

  if (ids.length === 0) return { erro: "Nenhum cliente neste filtro." };

  const service = createServiceClient();
  const { tagId, erro } = await resolverEtiqueta(service, etiqueta);
  if (!tagId) return { erro };

  const conta = await aplicarEtiqueta(
    service,
    [...new Set(ids)],
    tagId,
    perfil.id,
  );

  revalidatePath("/carteira");
  revalidatePath("/campanhas");
  return { ok: true, aviso: resumoEtiqueta(conta, etiqueta.novoNome?.trim()) };
}

/**
 * Dispara o mesmo template aprovado para os clientes escolhidos, um a um.
 * Quem pediu descadastro fica de fora, e a falha de um não derruba os outros.
 */
export async function dispararTemplateEmMassa(
  customerIds: string[],
  templateNome: string,
  templateIdioma: string,
  valores: Record<string, string>,
): Promise<ResultadoMassa> {
  const perfil = await perfilAtual();
  if (!perfil) return { erro: "Sessão expirada. Entre novamente." };

  const ids = [...new Set(customerIds.filter(Boolean))];
  if (ids.length === 0) return { erro: "Selecione pelo menos um cliente." };
  if (ids.length > MAX_DISPARO_MASSA) {
    return {
      erro: `Disparo imediato vai até ${MAX_DISPARO_MASSA} por vez — a Meta limita conversas iniciadas por dia. Para uma lista maior, etiquete a seleção e crie uma campanha.`,
    };
  }
  if (!templateNome) return { erro: "Escolha um template." };

  // Canal único: sem a Meta configurada o disparo não tem por onde sair —
  // erro claro aqui, antes de tocar em qualquer lead.
  if (!metaConfigurada()) {
    return { erro: "WhatsApp (Meta) não configurado." };
  }

  let template;
  try {
    const templates = await listarTemplatesMeta();
    template = templates.find(
      (t) => t.nome === templateNome && t.idioma === templateIdioma,
    );
  } catch (e) {
    return {
      erro: `Não deu para carregar os templates: ${e instanceof Error ? e.message : String(e)}`,
    };
  }
  if (!template) return { erro: "Template não encontrado ou não aprovado." };

  for (const token of template.parametros) {
    if (!(valores[token] ?? "").trim()) {
      return { erro: `Preencha a variável {{${token}}}.` };
    }
  }

  const service = createServiceClient();
  const padroes = await padroesDeLead(service);

  const { data: clientes } = await service
    .from("customers")
    .select("id, nome_completo, telefone_e164, responsavel_id")
    .in("id", ids);

  let enviados = 0;
  let bloqueados = 0;
  let perdidos = 0;
  let semTelefone = 0;
  const falhas: string[] = [];

  for (const cliente of (clientes ?? []) as ClienteAlvo[]) {
    const { lead } = await resolverLeadDoCliente(
      service,
      cliente,
      padroes,
      perfil.id,
    );
    if (!lead || !lead.telefone_e164) {
      semTelefone++;
      continue;
    }
    if (lead.marketing_bloqueado_em) {
      bloqueados++;
      continue;
    }
    // Perdido há menos de 30 dias não recebe template nem pela carteira —
    // mesma régua do chat; reativar o lead destrava. Contador separado do
    // descadastro: quarentena de 30 dias não é opt-out.
    if (templateBloqueadoAte(lead.status, lead.perdido_em)) {
      perdidos++;
      continue;
    }

    // {nome} é o mesmo atalho que a equipe já usa nas campanhas.
    const primeiro = (lead.nome ?? cliente.nome_completo)
      .trim()
      .split(/\s+/)[0];
    const preenchidos: Record<string, string> = {};
    for (const token of template.parametros) {
      preenchidos[token] = (valores[token] ?? "").replace(
        /\{nome\}/gi,
        primeiro,
      );
    }

    try {
      const idMensagem = await dispararTemplate(
        service,
        {
          leadId: lead.id,
          nome: lead.nome ?? cliente.nome_completo,
          telefone: lead.telefone_e164,
        },
        template,
        preenchidos,
      );

      const conteudo = template.corpo.replace(
        /\{\{\s*([^{}]+?)\s*\}\}/g,
        (bloco, token: string) => preenchidos[token] ?? bloco,
      );
      const agora = new Date().toISOString();

      await service.from("lead_interactions").insert({
        lead_id: lead.id,
        tipo: "mensagem_enviada",
        conteudo,
        autor_id: perfil.id,
        metadados: {
          via: "carteira_massa",
          template: template.nome,
          message_id: idMensagem,
        },
      });

      await service
        .from("leads")
        .update({ ultima_interacao_em: agora, chat_lido_em: agora })
        .eq("id", lead.id);

      await avancarAposDisparo(service, [lead.id]);
      enviados++;
    } catch (e) {
      falhas.push(
        `${cliente.nome_completo}: ${e instanceof Error ? e.message : String(e)}`,
      );
    }
  }

  revalidatePath("/carteira");
  revalidatePath("/chat");

  if (enviados === 0 && falhas.length > 0) {
    return { erro: `Nenhum saiu. ${falhas[0]}` };
  }

  const partes = [`${enviados} template(s) enviado(s)`];
  if (bloqueados > 0) partes.push(`${bloqueados} pediram descadastro`);
  if (perdidos > 0)
    partes.push(`${perdidos} perdido(s) há menos de 30 dias (fora por regra)`);
  if (semTelefone > 0) partes.push(`${semTelefone} sem telefone`);
  if (falhas.length > 0)
    partes.push(`${falhas.length} falharam (${falhas[0]})`);
  return { ok: true, aviso: `${partes.join(" · ")}.` };
}
