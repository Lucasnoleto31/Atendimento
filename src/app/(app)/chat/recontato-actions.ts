"use server";

import { createClient } from "@/lib/supabase/server";
import { perfilQueEscreve } from "@/lib/auth";
import { podeVerLead } from "@/lib/privacidade";
import { ehUuid } from "./mensagem";
import {
  JANELA_RECONTATOS_DIAS,
  limparMotivo,
  metadadosDoRecontato,
  MOTIVO_MAX,
  RECONTATO_MAX_DIAS,
  textoDoAgendamento,
  textoDoFim,
  type DadosRecontato,
  type NotaRecontato,
  type Recontato,
  type TemplateDoRecontato,
} from "./recontato";
import { pendentesDoLead } from "./recontato-dados";

/*
 * As actions do recontato (o modelo está em chat/recontato.ts). Quem pode
 * adiar pode agendar: a guarda é a mesma do adiar (perfilQueEscreve barra o
 * compliance e a conta desativada) e a privacidade entre a equipe vale como
 * em toda action que lê ou grava num lead (podeVerLead). Nada é editado: cada
 * gesto acrescenta uma nota.
 *
 * Sem revalidatePath, como em chat/actions.ts: a tela acerta o próprio
 * estado com o que volta daqui e o tempo real cobre o resto.
 */

const SEM_PERMISSAO =
  "Sem permissão para alterar: o perfil é só de leitura ou a sessão expirou.";
const NAO_ENCONTRADO = "Contato não encontrado.";

export type ResultadoRecontato = {
  ok?: boolean;
  erro?: string;
  /** O recontato como ficou (no agendar) ou como estava (no fim, para o
   *  Desfazer trazer de volta). */
  recontato?: Recontato;
  /** A nota gravada, para a conversa mostrar na hora. */
  nota?: NotaRecontato;
  /** O recontato gravou, mas a conversa não saiu da Caixa. */
  aviso?: string;
  /** Agendar: o contato está como perdido. A conversa fica onde está (em
   *  Resolvidas, fora da Caixa e de Adiadas) e entra na Caixa no dia, pelo
   *  recontato. */
  perdido?: boolean;
  /** Feito e Cancelar: a conversa continua adiada até aqui (ISO; o ano
   *  9999 é o "até a pessoa responder"), para o aviso dizer. */
  adiadaAte?: string;
};

async function acessoAoLead(leadId: string): Promise<string | null> {
  try {
    return (await podeVerLead(leadId)) ? null : NAO_ENCONTRADO;
  } catch {
    return "Não deu para conferir o acesso a esta conversa. Tente de novo.";
  }
}

/** O template como veio da tela, conferido; null sem template. */
function lerTemplate(
  bruto: TemplateDoRecontato | null | undefined,
): TemplateDoRecontato | null | { erro: string } {
  if (!bruto) return null;
  const nome = typeof bruto.nome === "string" ? bruto.nome.trim() : "";
  const idioma = typeof bruto.idioma === "string" ? bruto.idioma.trim() : "";
  if (!nome || nome.length > 512 || !idioma || idioma.length > 20) {
    return { erro: "O template escolhido veio incompleto. Escolha de novo." };
  }
  const variaveis: Record<string, string> = {};
  const entradas =
    bruto.variaveis && typeof bruto.variaveis === "object"
      ? Object.entries(bruto.variaveis)
      : [];
  if (entradas.length > 20) return { erro: "Variáveis demais no template." };
  for (const [token, valor] of entradas) {
    if (typeof valor !== "string" || token.length > 40) continue;
    const limpo = valor.trim();
    if (limpo.length > 1000) {
      return { erro: `A variável {{${token}}} passou de 1.000 caracteres.` };
    }
    if (limpo) variaveis[token] = limpo;
  }
  return { nome, idioma, variaveis };
}

/**
 * Agenda (ou reagenda, com `id`) o recontato e adia a conversa até o
 * quando, como o adiar: ela sai da Caixa e volta no dia, ou antes, se a
 * pessoa escrever. Conversa resolvida também volta a ficar em aberto: o
 * recontato é trabalho por fazer. No dia, quem a põe na Caixa é o próprio
 * recontato (conversas/lista.ts), qualquer que seja o adiamento até lá.
 *
 * Contato perdido: a conversa não muda (a view tira o perdido da Caixa e de
 * Adiadas de qualquer jeito) e o recontato a traz no dia.
 *
 * `restaurar` é o Desfazer do Feito e do Cancelar: o recontato volta como
 * estava (com id novo, porque o antigo já tem nota de fim, e a marca
 * restaurado na nota), sem mexer na conversa. O quando pode já ter passado,
 * mas não sai da janela que a fila lê nem passa do teto do agendar.
 */
export async function agendarRecontato(entrada: {
  leadId: string;
  quando: string;
  motivo: string;
  template?: TemplateDoRecontato | null;
  id?: string | null;
  restaurar?: boolean;
}): Promise<ResultadoRecontato> {
  const perfil = await perfilQueEscreve();
  if (!perfil) return { erro: SEM_PERMISSAO };
  const leadId = entrada.leadId;
  if (!ehUuid(leadId)) return { erro: "Conversa não informada." };

  const motivo = limparMotivo(String(entrada.motivo ?? ""));
  if (!motivo) return { erro: "Escreva o motivo do recontato." };
  if (motivo.length > MOTIVO_MAX) {
    return {
      erro: `O motivo passou de ${MOTIVO_MAX.toLocaleString("pt-BR")} caracteres.`,
    };
  }

  const agoraMs = Date.now();
  const quandoMs = Date.parse(String(entrada.quando ?? ""));
  if (Number.isNaN(quandoMs)) return { erro: "Escolha quando fazer o recontato." };
  const restaurar = entrada.restaurar === true;
  if (restaurar) {
    if (
      quandoMs < agoraMs - JANELA_RECONTATOS_DIAS * 86_400_000 ||
      quandoMs > agoraMs + RECONTATO_MAX_DIAS * 86_400_000
    ) {
      return { erro: "Este recontato não dá mais para restaurar. Agende um novo." };
    }
  } else {
    if (quandoMs <= agoraMs + 60_000) {
      return { erro: "Escolha um horário daqui para a frente." };
    }
    if (quandoMs > agoraMs + RECONTATO_MAX_DIAS * 86_400_000) {
      return {
        erro: `O recontato vai até ${RECONTATO_MAX_DIAS.toLocaleString("pt-BR")} dias à frente.`,
      };
    }
  }

  const template = lerTemplate(entrada.template);
  if (template && "erro" in template) return { erro: template.erro };

  const reagendar = !restaurar && Boolean(entrada.id);
  if (reagendar && !ehUuid(entrada.id)) return { erro: "Recontato não encontrado." };

  const negado = await acessoAoLead(leadId);
  if (negado) return { erro: negado };

  const supabase = await createClient();
  const [leadR, pendentes] = await Promise.all([
    supabase
      .from("leads")
      .select("id, telefone_e164, status")
      .eq("id", leadId)
      .maybeSingle(),
    reagendar ? pendentesDoLead(supabase, leadId) : Promise.resolve(null),
  ]);
  if (leadR.error) return { erro: "Não deu para ler o contato. Tente de novo." };
  if (!leadR.data) return { erro: NAO_ENCONTRADO };
  const lead = leadR.data as {
    telefone_e164: string | null;
    status: string | null;
  };
  const perdido = lead.status === "perdido";
  // Template só sai pelo WhatsApp: sem telefone, o recontato não leva um.
  if (template && !lead.telefone_e164) {
    return {
      erro: "Template só sai pelo WhatsApp, e este contato não tem telefone. Agende sem template ou preencha o número na ficha.",
    };
  }
  if (reagendar) {
    if (!pendentes) return { erro: "Não deu para ler o recontato. Tente de novo." };
    if (!pendentes.some((r) => r.id === entrada.id)) {
      return { erro: "Este recontato já foi feito ou cancelado." };
    }
  }

  const dados: DadosRecontato = {
    id: reagendar ? (entrada.id as string) : crypto.randomUUID(),
    quando: new Date(quandoMs).toISOString(),
    motivo,
    template,
    por: perfil.id,
    reagendado: reagendar,
    restaurado: restaurar,
  };
  const conteudo = textoDoAgendamento(dados);
  const metadados = {
    via: "crm",
    sistema: true,
    recontato: metadadosDoRecontato(dados),
  };

  // A nota primeiro: é o recontato. Sem ela, adiar a conversa a esconderia
  // sem nada que a trouxesse de volta com motivo.
  const { data: criada, error: erroNota } = await supabase
    .from("lead_interactions")
    .insert({
      lead_id: leadId,
      tipo: "nota",
      conteudo,
      autor_id: perfil.id,
      metadados,
    })
    .select("id, criado_em")
    .single();
  if (erroNota || !criada) {
    return { erro: "O recontato não foi gravado. Tente de novo." };
  }

  let aviso: string | undefined;
  if (!restaurar && !perdido) {
    const agora = new Date(agoraMs).toISOString();
    const { error } = await supabase
      .from("leads")
      .update({
        chat_adiado_em: agora,
        chat_adiado_ate: dados.quando,
        chat_lido_em: agora,
        chat_resolvido_em: null,
      })
      .eq("id", leadId);
    if (error) {
      aviso = "O recontato foi agendado, mas a conversa continua na Caixa.";
    }
  }

  return {
    ok: true,
    recontato: { ...dados, leadId, porNome: perfil.nome },
    nota: {
      id: criada.id as string,
      conteudo,
      criado_em: criada.criado_em as string,
      metadados,
      autor: perfil.nome,
    },
    ...(aviso ? { aviso } : {}),
    ...(perdido && !restaurar ? { perdido: true } : {}),
  };
}

/**
 * Feito ou Cancelar: uma nota nova com metadados.recontato_fim. A conversa
 * fica onde está. Se ela continua adiada (pelo próprio recontato, por outro
 * ou pelo Adiar comum), volta `adiadaAte`, e o aviso diz até quando: sem
 * isso, cancelar antes do dia deixava a conversa escondida sem nada à vista.
 */
export async function encerrarRecontato(
  leadId: string,
  id: string,
  como: "feito" | "cancelado",
): Promise<ResultadoRecontato> {
  const perfil = await perfilQueEscreve();
  if (!perfil) return { erro: SEM_PERMISSAO };
  if (!ehUuid(leadId) || !ehUuid(id)) return { erro: "Recontato não encontrado." };
  if (como !== "feito" && como !== "cancelado") {
    return { erro: "Escolha feito ou cancelar." };
  }
  const negado = await acessoAoLead(leadId);
  if (negado) return { erro: negado };

  const supabase = await createClient();
  const [pendentes, leadR] = await Promise.all([
    pendentesDoLead(supabase, leadId),
    supabase
      .from("leads")
      .select("status, chat_adiado_em, chat_adiado_ate, chat_resolvido_em")
      .eq("id", leadId)
      .maybeSingle(),
  ]);
  if (!pendentes) return { erro: "Não deu para ler o recontato. Tente de novo." };
  const recontato = pendentes.find((r) => r.id === id);
  if (!recontato) return { erro: "Este recontato já foi feito ou cancelado." };

  const conteudo = textoDoFim(como, recontato.motivo);
  const metadados = { via: "crm", sistema: true, recontato_fim: { id, como } };
  const { data: criada, error } = await supabase
    .from("lead_interactions")
    .insert({
      lead_id: leadId,
      tipo: "nota",
      conteudo,
      autor_id: perfil.id,
      metadados,
    })
    .select("id, criado_em")
    .single();
  if (error || !criada) return { erro: "Não deu para gravar. Tente de novo." };

  // Adiada no prazo, como a view decide (resolvida e perdida não contam:
  // essas o aviso não precisa explicar). A leitura que falhou só tira o
  // complemento do aviso.
  const lead = leadR.error
    ? null
    : (leadR.data as {
        status: string | null;
        chat_adiado_em: string | null;
        chat_adiado_ate: string | null;
        chat_resolvido_em: string | null;
      } | null);
  const ate = lead?.chat_adiado_ate ?? null;
  const adiadaAte =
    lead?.chat_adiado_em &&
    !lead.chat_resolvido_em &&
    lead.status !== "perdido" &&
    ate &&
    Date.parse(ate) > Date.now()
      ? ate
      : undefined;

  return {
    ok: true,
    ...(adiadaAte ? { adiadaAte } : {}),
    recontato,
    nota: {
      id: criada.id as string,
      conteudo,
      criado_em: criada.criado_em as string,
      metadados,
      autor: perfil.nome,
    },
  };
}
