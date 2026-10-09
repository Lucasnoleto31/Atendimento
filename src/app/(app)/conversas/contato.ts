"use server";

import { createClient } from "@/lib/supabase/server";
import { idDaSessao } from "@/lib/auth";
import { donoOculto, donosOcultosParaMim } from "@/lib/privacidade";
import {
  canalDaResposta,
  recebidaPeloDirect,
} from "@/app/(app)/chat/mensagem";

export type EtiquetaDoContato = {
  id: string;
  nome: string;
  cor: string | null;
};

/** O painel lateral da conversa: quem é o contato e como falar com ele. */
export type ContatoConversa = {
  leadId: string;
  nome: string;
  /** Dígitos com DDI (E.164); a tela formata. */
  telefone: string | null;
  email: string | null;
  instagram: string | null;
  /** Por onde a resposta sai, pela mesma regra do envio (canalDaResposta):
   *  o canal em que o contato escreveu por último; sem mensagem recebida, o
   *  telefone. null = nenhum dos dois (contato sem canal). */
  canal: "whatsapp" | "instagram" | null;
  /** Como o contato entrou (valor cru de leads.entrada_motivo: "manual",
   *  "importacao", "webhook_meta", "webhook_instagram", "formulario"…); a
   *  tela traduz. */
  entradaMotivo: string;
  criadoEm: string;
  observacao: string | null;
  responsavelId: string | null;
  responsavelNome: string | null;
  /** Em ordem de nome, com a cor cadastrada. */
  etiquetas: EtiquetaDoContato[];
  /** Templates já disparados a este contato — cada um custa na Meta. */
  templates: {
    total: number;
    ultimoEm: string | null;
    ultimoNome: string | null;
    /** A contagem falhou: a tela avisa em vez de dizer que são zero. */
    falhou: boolean;
  };
};

/**
 * Os dados do contato para o painel lateral, estilo Chatwoot: uma consulta
 * em leads (com responsável e etiquetas embutidos), a contagem de
 * templates e a última mensagem recebida (que decide o canal), em paralelo
 * entre si e com a checagem da sessão — o RLS já decide o que a pessoa
 * enxerga, e sem sessão o resultado é descartado. Por cima do RLS vale a
 * privacidade entre pessoas da equipe (Administração > Privacidade), lida
 * na mesma onda: contato de um dono oculto é "não encontrado".
 */
export async function carregarContato(
  leadId: string,
): Promise<ContatoConversa | { erro: string }> {
  if (!leadId) return { erro: "Contato não informado." };

  const supabase = await createClient();
  const [quem, ocultos, leadR, templatesR, recebidaR] = await Promise.all([
    idDaSessao(),
    donosOcultosParaMim().catch(() => null),
    supabase
      .from("leads")
      .select(
        "id, nome, telefone_e164, email, instagram_usuario, instagram_id, observacao, criado_em, entrada_motivo, responsavel_id, responsavel:profiles(nome), etiquetas:lead_tags(tag:tags(id, nome, cor))",
      )
      .eq("id", leadId)
      .maybeSingle(),
    // Template disparado deixa metadados.template no histórico: é por aí
    // que se sabe quantas vezes já se pagou para falar com este contato.
    supabase
      .from("lead_interactions")
      .select("criado_em, metadados", { count: "exact" })
      .eq("lead_id", leadId)
      .eq("tipo", "mensagem_enviada")
      .not("metadados->>template", "is", null)
      // Recusado pela Meta não chegou e não foi cobrado. Sem recibo ainda
      // (status nulo) conta: foi disparado. O .not(eq) sozinho virava
      // NOT (nulo = 'failed'), que é nulo, e tirava esses da conta.
      .or("metadados->>status_envio.is.null,metadados->>status_envio.neq.failed")
      .order("criado_em", { ascending: false })
      .limit(1),
    // A última mensagem do contato decide o canal da resposta.
    supabase
      .from("lead_interactions")
      .select("metadados")
      .eq("lead_id", leadId)
      .eq("tipo", "mensagem_recebida")
      .order("criado_em", { ascending: false })
      .limit(1)
      .maybeSingle(),
  ]);
  if (!quem) return { erro: "Sessão expirada." };
  if (leadR.error || !ocultos) {
    return { erro: "Os dados do contato não carregaram." };
  }

  const lead = leadR.data as unknown as {
    id: string;
    nome: string;
    telefone_e164: string | null;
    email: string | null;
    instagram_usuario: string | null;
    instagram_id: string | null;
    observacao: string | null;
    criado_em: string;
    entrada_motivo: string;
    responsavel_id: string | null;
    responsavel: { nome: string } | null;
    etiquetas: { tag: EtiquetaDoContato | null }[] | null;
  } | null;
  if (!lead || donoOculto(lead.responsavel_id, ocultos)) {
    return { erro: "Contato não encontrado." };
  }

  const ultimo = (templatesR.data ?? [])[0] as
    | { criado_em: string; metadados: { template?: string | null } | null }
    | undefined;
  const recebida = recebidaR.data as {
    metadados: { canal?: string | null; igsid?: string | null } | null;
  } | null;

  return {
    leadId: lead.id,
    nome: lead.nome,
    telefone: lead.telefone_e164,
    email: lead.email,
    instagram: lead.instagram_usuario,
    canal: canalDaResposta(
      {
        temTelefone: Boolean(lead.telefone_e164),
        temDirect: Boolean(lead.instagram_id),
      },
      recebida ? recebidaPeloDirect(recebida.metadados) : null,
    ),
    entradaMotivo: lead.entrada_motivo,
    criadoEm: lead.criado_em,
    observacao: lead.observacao,
    responsavelId: lead.responsavel_id,
    responsavelNome: lead.responsavel?.nome ?? null,
    etiquetas: (lead.etiquetas ?? [])
      .flatMap((v) => (v.tag ? [v.tag] : []))
      .sort((a, b) => a.nome.localeCompare(b.nome, "pt-BR")),
    templates: {
      total: templatesR.error ? 0 : (templatesR.count ?? 0),
      ultimoEm: ultimo?.criado_em ?? null,
      ultimoNome: ultimo?.metadados?.template ?? null,
      falhou: Boolean(templatesR.error),
    },
  };
}
