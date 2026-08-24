"use server";

import { redirect } from "next/navigation";
import { revalidatePath } from "next/cache";
import { createClient } from "@/lib/supabase/server";
import { perfilAtual } from "@/lib/auth";

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
  const perfil = await perfilAtual();
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
    supabase.from("profiles").select("id, nome").eq("ativo", true).order("nome"),
    supabase
      .from("leads")
      .select("id")
      .is("responsavel_id", null)
      .limit(LIMITE),
  ]);

  const pessoas = (equipe ?? []) as { id: string; nome: string }[];
  const leads = ((semDono ?? []) as { id: string }[]).map((l) => l.id);

  if (pessoas.length === 0) terminar("Nenhuma pessoa ativa na equipe.");
  if (leads.length === 0) terminar("Nenhum lead sem responsável para distribuir.");

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
  enviarTemplate,
  iniciarConversaWhatsapp,
} from "@/lib/chatwoot";
import { enviarTemplateMeta } from "@/lib/whatsapp";
import { canalAtivo, listarTemplatesCanal } from "@/lib/canal";

const LIMITE_MS_DISPARO = 100_000;
const MAX_POR_EXECUCAO = 30; // ritmo por leva — respeita os limites da Meta

const LISTAS_DISPARO = new Set([
  "esfriando",
  "sem_contato_30",
  "sem_contato_60",
  "sem_contato_nunca",
  "nunca_respondeu",
]);

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
  const perfil = await perfilAtual();
  if (!perfil || (perfil.papel !== "admin" && perfil.papel !== "gestor")) {
    return { erro: "Só administração e gestão disparam em massa." };
  }

  const lista = String(formData.get("lista") ?? "");
  const nome = String(formData.get("template_nome") ?? "");
  const idioma = String(formData.get("template_idioma") ?? "");
  const iniciadoEm =
    String(formData.get("iniciado_em") ?? "") || new Date().toISOString();

  if (!LISTAS_DISPARO.has(lista)) return { erro: "Fila inválida para disparo." };
  if (!nome) return { erro: "Escolha um template." };

  let template;
  try {
    const templates = await listarTemplatesCanal();
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

  // Quem desligou marketing no WhatsApp não recebe template dessa categoria:
  // insistir só gera falha e derruba a reputação do número. Checagem única —
  // sem a migração 0019 a coluna não existe e o filtro é ignorado.
  const { error: erroColunaBloqueio } = await service
    .from("leads")
    .select("marketing_bloqueado_em")
    .limit(1);
  const podeFiltrarBloqueio = !erroColunaBloqueio;

  function consultaFila(modo: "dados" | "contagem") {
    const d7 = new Date(Date.parse(iniciadoEm) - 7 * 86_400_000).toISOString();
    const d30 = new Date(Date.parse(iniciadoEm) - 30 * 86_400_000).toISOString();
    const d60 = new Date(Date.parse(iniciadoEm) - 60 * 86_400_000).toISOString();

    let q =
      modo === "contagem"
        ? service.from("leads").select("id", { count: "exact", head: true })
        : service
            .from("leads")
            .select(
              "id, nome, telefone_e164, chatwoot_contact_id, chatwoot_conversation_id",
            );

    q = q
      .not("status", "in", "(ganho,perdido)")
      .not("telefone_e164", "is", null);
    if (podeFiltrarBloqueio) q = q.is("marketing_bloqueado_em", null);

    if (lista === "esfriando")
      q = q.lt("ultima_interacao_em", d7).gte("ultima_interacao_em", d30);
    if (lista === "sem_contato_30")
      q = q.lt("ultima_interacao_em", d30).gte("ultima_interacao_em", d60);
    if (lista === "sem_contato_60") q = q.lt("ultima_interacao_em", d60);
    if (lista === "sem_contato_nunca") q = q.is("ultima_interacao_em", null);
    if (lista === "nunca_respondeu")
      q = q
        .is("primeira_resposta_em", null)
        .or(`ultima_interacao_em.is.null,ultima_interacao_em.lt.${iniciadoEm}`);

    return q;
  }

  const inicio = Date.now();
  let enviados = 0;
  let pulados = 0;
  const contatados: string[] = [];

  while (
    enviados + pulados < MAX_POR_EXECUCAO &&
    Date.now() - inicio < LIMITE_MS_DISPARO
  ) {
    const { data: lote } = await consultaFila("dados")
      .order("criado_em", { ascending: true })
      .limit(Math.min(10, MAX_POR_EXECUCAO - enviados - pulados));

    const leads = (lote ?? []) as {
      id: string;
      nome: string;
      telefone_e164: string;
      chatwoot_contact_id: number | null;
      chatwoot_conversation_id: number | null;
    }[];
    if (leads.length === 0) break;

    const canal = canalAtivo();
    for (const lead of leads) {
      const agora = new Date().toISOString();
      try {
        const valores = Object.fromEntries(
          Object.entries(valoresBase).map(([token, valor]) => [
            token,
            valor.replaceAll("{nome}", lead.nome),
          ]),
        );

        let idMensagem: string | number | null = null;

        if (canal === "meta") {
          idMensagem = await enviarTemplateMeta(
            lead.telefone_e164,
            template,
            valores,
          );
        } else {
          let conversaId = lead.chatwoot_conversation_id;
          if (!conversaId) {
            const criada = await iniciarConversaWhatsapp({
              nome: lead.nome,
              telefone: lead.telefone_e164,
              contatoId: lead.chatwoot_contact_id,
            });
            conversaId = criada.conversaId;
            await service
              .from("leads")
              .update({
                chatwoot_contact_id: criada.contatoId,
                chatwoot_conversation_id: conversaId,
              })
              .eq("id", lead.id);
          }

          const resposta = await enviarTemplate(conversaId, template, valores);
          idMensagem = resposta?.id ?? null;

          if (typeof idMensagem === "number") {
            await service.from("webhook_events").insert({
              origem: "chatwoot",
              evento_id: `cw-msg-${idMensagem}`,
              payload: { via: "disparo", lead_id: lead.id },
              processado: true,
            });
          }
        }

        const conteudo = template.corpo.replace(
          /\{\{\s*([^{}]+?)\s*\}\}/g,
          (bloco, token: string) => valores[token] ?? bloco,
        );

        await service.from("lead_interactions").insert({
          lead_id: lead.id,
          tipo: "mensagem_enviada",
          conteudo,
          autor_id: perfil.id,
          metadados: {
            ...(canal === "meta"
              ? { message_id: idMensagem }
              : { chatwoot_message_id: idMensagem }),
            via: "disparo",
            template: template.nome,
            lista,
          },
        });

        enviados++;
        contatados.push(lead.id);
      } catch {
        pulados++;
      }
      // Sucesso ou falha, o lead sai da fila desta rodada — sem loop infinito.
      await service
        .from("leads")
        .update({ ultima_interacao_em: agora, chat_lido_em: agora })
        .eq("id", lead.id);
    }
  }

  // Quem recebeu template saiu de "Novo": vai para "Em Contato".
  await avancarAposDisparo(service, contatados);

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
