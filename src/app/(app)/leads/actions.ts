"use server";

import { redirect } from "next/navigation";
import { revalidatePath } from "next/cache";
import { createClient } from "@/lib/supabase/server";
import { perfilQueEscreve } from "@/lib/auth";

const BLOCO = 200;
const LIMITE = 5000;

function embaralhar<T>(lista: T[]): T[] {
  const copia = [...lista];
  for (let i = copia.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [copia[i], copia[j]] = [copia[j], copia[i]];
  }
  return copia;
}

/**
 * Distribui os leads SEM responsável entre a equipe ativa, aleatoriamente e
 * em partes iguais (diferença máxima de 1). Leads já atribuídos não mudam.
 */
export async function distribuirLeads() {
  const perfil = await perfilQueEscreve();
  if (!perfil || (perfil.papel !== "admin" && perfil.papel !== "gestor")) {
    redirect("/leads");
  }

  function terminar(aviso: string): never {
    revalidatePath("/leads");
    revalidatePath("/atendimento");
    redirect(`/leads?aviso=${encodeURIComponent(aviso)}`);
  }

  const supabase = await createClient();

  const [{ data: equipe }, { data: semDono }] = await Promise.all([
    supabase
      .from("profiles")
      .select("id, nome")
      .eq("ativo", true)
      .order("nome"),
    supabase
      .from("leads")
      .select("id")
      .is("responsavel_id", null)
      .limit(LIMITE),
  ]);

  const pessoas = (equipe ?? []) as { id: string; nome: string }[];
  const leads = ((semDono ?? []) as { id: string }[]).map((l) => l.id);

  if (pessoas.length === 0) terminar("Nenhuma pessoa ativa na equipe.");
  if (leads.length === 0)
    terminar("Nenhum lead sem responsável para distribuir.");

  // Sorteia a ordem dos leads e o ponto de partida do rodízio.
  const sorteados = embaralhar(leads);
  const inicio = Math.floor(Math.random() * pessoas.length);

  const porPessoa = new Map<string, string[]>();
  sorteados.forEach((leadId, i) => {
    const pessoa = pessoas[(inicio + i) % pessoas.length];
    if (!porPessoa.has(pessoa.id)) porPessoa.set(pessoa.id, []);
    porPessoa.get(pessoa.id)!.push(leadId);
  });

  let atribuidos = 0;

  for (const [pessoaId, ids] of porPessoa) {
    for (let i = 0; i < ids.length; i += BLOCO) {
      const parte = ids.slice(i, i + BLOCO);
      const { error } = await supabase
        .from("leads")
        .update({ responsavel_id: pessoaId })
        .in("id", parte);
      if (error) {
        terminar(
          `Distribuição interrompida após ${atribuidos} lead(s): ${error.message}`,
        );
      }
      atribuidos += parte.length;

      // Auditoria: cada atribuição vira uma interação no histórico do lead.
      const pessoa = pessoas.find((p) => p.id === pessoaId);
      await supabase.from("lead_interactions").insert(
        parte.map((leadId) => ({
          lead_id: leadId,
          tipo: "atribuicao",
          conteudo: `Distribuição automática para ${pessoa?.nome ?? "equipe"}`,
          autor_id: perfil.id,
          metadados: { responsavel_id: pessoaId },
        })),
      );
    }
  }

  terminar(
    `${atribuidos} lead(s) distribuídos entre ${porPessoa.size} pessoa(s).`,
  );
}

// ===========================================================================
// Disparo de template em massa para uma fila
// ===========================================================================

import { createServiceClient } from "@/lib/supabase/server";
import { avancarAposDisparo } from "@/lib/kanban";
import {
  enviarTemplateMeta,
  listarTemplatesMeta,
  metaConfigurada,
} from "@/lib/whatsapp";
import { COLUNA_DISPARO, LISTAS_DISPARO } from "@/lib/listas-leads";
import { orcamentoEnviosRestante } from "@/lib/envios";
import { marcarRoteiroEnviado } from "@/lib/ativacao";

const LIMITE_MS_DISPARO = 100_000;
const MAX_POR_EXECUCAO = 30; // ritmo por leva — respeita os limites da Meta

// As filas e suas colunas moram em lib/listas-leads para tela e disparo não
// divergirem de novo.

export type ResultadoDisparo = {
  ok?: boolean;
  erro?: string;
  enviados?: number;
  pulados?: number;
  restantes?: number;
  iniciadoEm?: string;
};

/**
 * Envia um template para todos os leads de uma fila, em levas de até 30 por
 * clique. O envio atualiza ultima_interacao_em, então o lead sai do filtro —
 * junto com a âncora iniciadoEm, isso garante que ninguém recebe duas vezes.
 * Variáveis aceitam o token {nome}, trocado pelo nome de cada lead.
 */
export async function dispararTemplateLista(
  _estado: ResultadoDisparo,
  formData: FormData,
): Promise<ResultadoDisparo> {
  const perfil = await perfilQueEscreve();
  if (!perfil || (perfil.papel !== "admin" && perfil.papel !== "gestor")) {
    return { erro: "Só administração e gestão disparam em massa." };
  }

  const lista = String(formData.get("lista") ?? "");
  const etiqueta = String(formData.get("etiqueta") ?? "");
  const nome = String(formData.get("template_nome") ?? "");
  const idioma = String(formData.get("template_idioma") ?? "");
  const iniciadoEm =
    String(formData.get("iniciado_em") ?? "") || new Date().toISOString();

  if (!LISTAS_DISPARO.has(lista))
    return { erro: "Fila inválida para disparo." };
  if (!nome) return { erro: "Escolha um template." };

  // O canal é só a Meta: sem ela configurada, avisa em vez de estourar no
  // meio do loop de envio.
  if (!metaConfigurada()) return { erro: "WhatsApp (Meta) não configurado." };

  let template;
  try {
    const templates = await listarTemplatesMeta();
    template = templates.find((t) => t.nome === nome && t.idioma === idioma);
  } catch (e) {
    return {
      erro: `Não deu para carregar os templates: ${e instanceof Error ? e.message : String(e)}`,
    };
  }
  if (!template) return { erro: "Template não encontrado ou não aprovado." };

  const valoresBase: Record<string, string> = {};
  for (const token of template.parametros) {
    const valor = String(formData.get(`param_${token}`) ?? "").trim();
    if (!valor) return { erro: `Preencha a variável {{${token}}}.` };
    valoresBase[token] = valor;
  }

  const service = createServiceClient();

  /**
   * A fila é a MESMA da tela: v_leads_listas com a coluna booleana da lista,
   * mais a etiqueta escolhida. Antes isto era um punhado de filtros por data
   * copiados à mão, que ficaram para trás quando as listas mudaram.
   *
   * Dois cuidados que o desenho antigo tinha de graça e este não:
   *
   * - `perdido` sai, mas `ganho` NÃO. As filas de primeiro giro são de gente
   *   que já abriu conta — filtrar ganho esvaziaria justamente as listas que
   *   mais precisam de disparo.
   * - ultimo_disparo_em segura o reenvio. As filas antigas eram por data de
   *   contato e o envio tirava o lead do filtro sozinho; "conta aberta e nunca
   *   girou" continua verdade depois do template, então sem esta trava cada
   *   clique repetiria o disparo nas mesmas pessoas.
   */
  function consultaFila(modo: "dados" | "contagem") {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any -- corta a recursão de tipos do builder
    let q: any =
      modo === "contagem"
        ? service
            .from("v_leads_listas")
            .select("lead_id", { count: "exact", head: true })
        : service.from("v_leads_listas").select("lead_id, nome, telefone_e164");

    q = q
      .eq(COLUNA_DISPARO[lista], true)
      .neq("status", "perdido")
      // nao_contatavel já cobre sem telefone E marketing recusado.
      .eq("nao_contatavel", false)
      .or(`ultimo_disparo_em.is.null,ultimo_disparo_em.lt.${iniciadoEm}`);

    if (etiqueta) q = q.contains("etiqueta_ids", [etiqueta]);

    return q;
  }

  // Disparo manual também debita do orçamento único do número (lib/envios):
  // foi a soma dos três motores que derrubou a qualidade em 24/08.
  const orcamento = await orcamentoEnviosRestante(service);
  if (orcamento <= 0) {
    return {
      erro: "O orçamento de envios de hoje acabou — o teto diário protege a qualidade do número. Ajuste em Configurações ou continue amanhã.",
    };
  }
  const maxDestaExecucao = Math.min(MAX_POR_EXECUCAO, orcamento);

  const inicio = Date.now();
  let enviados = 0;
  let pulados = 0;
  const contatados: string[] = [];

  while (
    enviados + pulados < maxDestaExecucao &&
    Date.now() - inicio < LIMITE_MS_DISPARO
  ) {
    // A view já traz tudo que a Meta precisa (o thread é o telefone) —
    // não há mais ida extra à tabela leads por ids de conversa.
    const { data: lote } = await consultaFila("dados")
      .order("criado_em", { ascending: true })
      .limit(Math.min(10, maxDestaExecucao - enviados - pulados));

    const leads = (lote ?? []) as {
      lead_id: string;
      nome: string;
      telefone_e164: string;
    }[];
    if (leads.length === 0) break;

    for (const lead of leads) {
      const agora = new Date().toISOString();
      try {
        const valores = Object.fromEntries(
          Object.entries(valoresBase).map(([token, valor]) => [
            token,
            valor.replaceAll("{nome}", lead.nome),
          ]),
        );

        const idMensagem = await enviarTemplateMeta(
          lead.telefone_e164,
          template,
          valores,
        );

        const conteudo = template.corpo.replace(
          /\{\{\s*([^{}]+?)\s*\}\}/g,
          (bloco, token: string) => valores[token] ?? bloco,
        );

        await service.from("lead_interactions").insert({
          lead_id: lead.lead_id,
          tipo: "mensagem_enviada",
          conteudo,
          autor_id: perfil.id,
          metadados: {
            message_id: idMensagem,
            via: "disparo",
            template: template.nome,
            lista,
          },
        });

        enviados++;
        contatados.push(lead.lead_id);
      } catch {
        pulados++;
      }
      // Sucesso ou falha, o lead sai da fila desta rodada — sem loop infinito.
      await service
        .from("leads")
        .update({ ultima_interacao_em: agora, chat_lido_em: agora })
        .eq("id", lead.lead_id);
    }
  }

  // Quem recebeu template saiu de "Novo": vai para "Em Contato".
  await avancarAposDisparo(service, contatados);
  await marcarRoteiroEnviado(service, contatados);

  const { count: restantes } = await consultaFila("contagem");

  revalidatePath("/leads");
  revalidatePath("/chat");
  revalidatePath("/atendimento");

  return {
    ok: true,
    enviados,
    pulados,
    restantes: restantes ?? 0,
    iniciadoEm,
  };
}
