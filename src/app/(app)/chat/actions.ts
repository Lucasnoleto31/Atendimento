"use server";

import { revalidatePath } from "next/cache";
import { createClient, createServiceClient } from "@/lib/supabase/server";
import { avancarAposDisparo } from "@/lib/kanban";
import { marcarRoteiroEnviado } from "@/lib/ativacao";
import { perfilAtual } from "@/lib/auth";
import { ehMotivoPerda } from "@/lib/perda";
import { formatarData } from "@/lib/format";
import {
  enviarMidiaMeta,
  enviarTemplateMeta,
  enviarTextoMeta,
  listarTemplatesMeta,
  metaConfigurada,
} from "@/lib/whatsapp";
import {
  descreverErroInstagram,
  enviarMidiaInstagram,
  enviarTextoInstagram,
} from "@/lib/instagram";

const MAX_ANEXOS = 5;
const MAX_TAMANHO_ANEXO = 16 * 1024 * 1024; // teto do WhatsApp para mídia
const BUCKET_MIDIA = "midia-whatsapp";

type AnexoRemoto = {
  caminho: string;
  nome: string;
  tipo: string;
  tamanho: number;
};

/**
 * URL assinada para o anexo subir DIRETO do navegador ao Storage — o corpo
 * da requisição na Vercel tem teto de ~4,5MB e derrubava a página; por aqui
 * vale o teto real do WhatsApp (16MB por arquivo).
 */
export async function prepararUploadAnexo(
  nome: string,
): Promise<{ caminho?: string; token?: string; erro?: string }> {
  const perfil = await perfilAtual();
  if (!perfil) return { erro: "Sessão expirada. Entre novamente." };

  const limpo = nome.replace(/[^\w.\-]+/g, "_").slice(-80);
  const caminho = `envios/${crypto.randomUUID()}-${limpo}`;
  const service = createServiceClient();
  const { data, error } = await service.storage
    .from(BUCKET_MIDIA)
    .createSignedUploadUrl(caminho);
  if (error) {
    return { erro: `Não deu para preparar o upload: ${error.message}` };
  }
  return { caminho, token: data.token };
}

const ROTULO_TIPO: Record<string, string> = {
  image: "[imagem]",
  audio: "[áudio]",
  video: "[vídeo]",
};

function tipoDoArquivo(mime: string): string {
  const prefixo = mime.split("/")[0];
  return prefixo === "image" || prefixo === "audio" || prefixo === "video"
    ? prefixo
    : "file";
}

// A Cloud API da Meta só entrega como arquivo estes tipos (pdf, office e
// texto) além de imagem/áudio/vídeo. Qualquer outro — .psf de indicador,
// .zip, binário — é recusado com erro 131053. Nesses casos mandamos o link.
const DOCS_WHATSAPP = new Set([
  "application/pdf",
  "application/msword",
  "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
  "application/vnd.ms-excel",
  "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
  "application/vnd.ms-powerpoint",
  "application/vnd.openxmlformats-officedocument.presentationml.presentation",
  "text/plain",
  "text/csv",
]);
const EXTS_WHATSAPP = new Set([
  "pdf",
  "doc",
  "docx",
  "xls",
  "xlsx",
  "ppt",
  "pptx",
  "txt",
  "csv",
]);

/** O WhatsApp consegue entregar este arquivo como mídia/documento? */
function suportadoWhatsApp(arquivo: File): boolean {
  const mime = (arquivo.type || "").toLowerCase();
  if (/^(image|audio|video)\//.test(mime)) return true;
  if (DOCS_WHATSAPP.has(mime)) return true;
  // Navegador nem sempre preenche o MIME — confere pela extensão também.
  const ext = arquivo.name.toLowerCase().match(/\.([a-z0-9]+)$/)?.[1] ?? "";
  return EXTS_WHATSAPP.has(ext);
}

/**
 * A interação recém-criada volta para a Janela reconciliar no estado local —
 * é o que dispensa o revalidatePath("/chat") no envio (que re-renderizava a
 * página inteira DUAS vezes: revalidate + eco do realtime).
 */
export type InteracaoCriada = {
  id: string;
  tipo: "mensagem_enviada" | "nota";
  conteudo: string | null;
  criado_em: string;
  autor: string | null;
  anexos: { tipo: string; url: string; nome?: string | null }[];
};

export type ResultadoEnvio = {
  ok?: boolean;
  erro?: string;
  interacao?: InteracaoCriada;
};

async function leadComConversa(leadId: string) {
  const supabase = await createClient();
  const { data: lead } = await supabase
    .from("leads")
    .select("id, nome, telefone_e164, instagram_id, instagram_usuario")
    .eq("id", leadId)
    .maybeSingle();
  return lead as {
    id: string;
    nome: string;
    telefone_e164: string | null;
    instagram_id: string | null;
    instagram_usuario: string | null;
  } | null;
}

export async function enviarMensagemLead(
  _estado: ResultadoEnvio,
  formData: FormData,
): Promise<ResultadoEnvio> {
  const perfil = await perfilAtual();
  if (!perfil) return { erro: "Sessão expirada. Entre novamente." };

  const leadId = String(formData.get("lead_id") ?? "");
  const textoBruto = String(formData.get("texto") ?? "").trim();
  const modo = formData.get("modo") === "nota" ? "nota" : "responder";
  const assinar = formData.get("assinar") === "1";
  // Anexos chegam como referências do Storage (o navegador subiu direto).
  let anexosRemotos: AnexoRemoto[] = [];
  if (modo !== "nota") {
    try {
      const brutos = JSON.parse(String(formData.get("anexos_remotos") ?? "[]"));
      if (Array.isArray(brutos)) {
        anexosRemotos = brutos.filter(
          (a): a is AnexoRemoto =>
            typeof a?.caminho === "string" && a.caminho.startsWith("envios/"),
        );
      }
    } catch {
      // JSON inválido = sem anexos
    }
  }

  // Materializa os arquivos do Storage para os canais de envio.
  const arquivos: File[] = [];
  if (anexosRemotos.length > 0) {
    const service = createServiceClient();
    for (const anexo of anexosRemotos) {
      const { data, error } = await service.storage
        .from(BUCKET_MIDIA)
        .download(anexo.caminho);
      if (error || !data) {
        return {
          erro: `O anexo "${anexo.nome}" não está mais no armazenamento — anexe de novo.`,
        };
      }
      arquivos.push(
        new File([data], anexo.nome, {
          type: anexo.tipo || "application/octet-stream",
        }),
      );
    }
  }

  if (!leadId) return { erro: "Lead não informado." };
  if (!textoBruto && arquivos.length === 0) {
    return {
      erro:
        modo === "nota"
          ? "Escreva a nota."
          : "Escreva a mensagem ou anexe um arquivo.",
    };
  }
  if (textoBruto.length > 4096) return { erro: "Mensagem longa demais." };

  // Nota privada: só equipe vê. Vive apenas no histórico do CRM — não há
  // mais para onde espelhar (a Meta não tem nota privada).
  if (modo === "nota") {
    const lead = await leadComConversa(leadId);
    if (!lead) return { erro: "Lead não encontrado." };

    const supabase = await createClient();
    const { data: notaCriada } = await supabase
      .from("lead_interactions")
      .insert({
        lead_id: leadId,
        tipo: "nota",
        conteudo: textoBruto,
        autor_id: perfil.id,
        metadados: { via: "crm" },
      })
      .select("id, criado_em")
      .maybeSingle();

    // Sem revalidatePath("/chat"): a Janela recebe a nota criada e coloca no
    // histórico local — a página não re-renderiza inteira por causa disso.
    // Se o insert não devolveu a linha (não deveria), revalida como antes.
    if (!notaCriada)    revalidatePath(`/leads/${leadId}`);
    return {
      ok: true,
      ...(notaCriada
        ? {
            interacao: {
              id: notaCriada.id as string,
              tipo: "nota" as const,
              conteudo: textoBruto,
              criado_em: notaCriada.criado_em as string,
              autor: perfil.nome,
              anexos: [],
            },
          }
        : {}),
    };
  }

  // A assinatura vai no formato de negrito do WhatsApp.
  const texto =
    assinar && textoBruto ? `*${perfil.nome}:*\n${textoBruto}` : textoBruto;
  if (arquivos.length > MAX_ANEXOS) {
    return { erro: `No máximo ${MAX_ANEXOS} anexos por mensagem.` };
  }
  const grande = arquivos.find((a) => a.size > MAX_TAMANHO_ANEXO);
  if (grande) {
    return { erro: `"${grande.name}" passa de 16MB — o WhatsApp não aceita.` };
  }

  const lead = await leadComConversa(leadId);
  if (!lead) return { erro: "Lead não encontrado." };

  // Só wamid da Meta ou id do Direct — o id numérico do Chatwoot acabou.
  let mensagemId: string | null = null;
  let anexos: { tipo: string; url: string }[] = [];
  const wamids: string[] = [];
  let falhaParcial: string | null = null;

  // O canal é decidido POR LEAD, não globalmente: quem chegou pelo Direct é
  // respondido pelo Direct (não tem telefone), quem chegou pelo WhatsApp pelo
  // WhatsApp. A mensagem sai pelo perfil do Instagram do negócio, e o CRM
  // guarda em autor_id quem de fato respondeu.
  const viaInstagram = Boolean(lead.instagram_id && !lead.telefone_e164);

  if (viaInstagram && lead.instagram_id) {
    const service = createServiceClient();
    try {
      if (texto) {
        const id = await enviarTextoInstagram(lead.instagram_id, texto);
        if (id) wamids.push(id);
      }
      for (const [i, anexo] of anexosRemotos.entries()) {
        const tipo = tipoDoArquivo(arquivos[i]?.type ?? "");
        const url = service.storage
          .from(BUCKET_MIDIA)
          .getPublicUrl(anexo.caminho).data.publicUrl;
        // O Direct só aceita imagem, vídeo e áudio como mídia; o resto vai
        // como link, do mesmo jeito que no WhatsApp.
        const id =
          tipo === "image" || tipo === "video" || tipo === "audio"
            ? await enviarMidiaInstagram(lead.instagram_id, url, tipo)
            : await enviarTextoInstagram(
                lead.instagram_id,
                `📎 ${anexo.nome}\n${url}`,
              );
        if (id) wamids.push(id);
      }
    } catch (e) {
      const bruto = e instanceof Error ? e.message : String(e);
      if (wamids.length === 0) {
        return { erro: descreverErroInstagram(bruto) };
      }
      falhaParcial = descreverErroInstagram(bruto);
    }
    mensagemId = wamids[wamids.length - 1] ?? null;

    anexos = anexosRemotos.slice(0, wamids.length).map((a) => ({
      tipo: tipoDoArquivo(a.tipo || ""),
      nome: a.nome,
      url: service.storage.from(BUCKET_MIDIA).getPublicUrl(a.caminho).data
        .publicUrl,
    }));
  } else {
    // A Meta é o único canal de WhatsApp: sem ela configurada não existe
    // fallback (o Chatwoot saiu) — erro claro em vez de exceção na tela.
    if (!metaConfigurada()) {
      return { erro: "WhatsApp (Meta) não configurado." };
    }
    if (!lead.telefone_e164) {
      return {
        erro: "Este lead não tem telefone para receber WhatsApp. Se ele é cliente da carteira, preencha o número na ficha dele em Carteira.",
      };
    }
    if (arquivos.length > 0) {
      const servicoLink = createServiceClient();
      // Texto vira legenda do primeiro anexo; áudio não aceita legenda.
      // Cada arquivo é um envio próprio: se um falhar no meio, os anteriores
      // JÁ chegaram ao lead — registra o que foi e avisa, em vez de fingir
      // que nada saiu (o reenvio duplicava texto e arquivos para o cliente).
      for (const [i, arquivo] of arquivos.entries()) {
        const legenda = i === 0 && texto ? texto : undefined;
        try {
          if (suportadoWhatsApp(arquivo)) {
            const id = await enviarMidiaMeta(
              lead.telefone_e164,
              arquivo,
              legenda,
            );
            if (id) wamids.push(id);
          } else {
            // Tipo que o WhatsApp não entrega como arquivo (ex.: indicador
            // .psf): manda o link de download do Storage, que o cliente abre
            // e baixa. O arquivo já subiu para lá quando foi anexado.
            const url = servicoLink.storage
              .from(BUCKET_MIDIA)
              .getPublicUrl(anexosRemotos[i].caminho).data.publicUrl;
            const corpo = `${legenda ? `${legenda}\n\n` : ""}📎 ${arquivo.name}\n${url}`;
            const id = await enviarTextoMeta(lead.telefone_e164, corpo);
            if (id) wamids.push(id);
          }
        } catch (e) {
          falhaParcial = `"${arquivo.name}" (${e instanceof Error ? e.message : String(e)})`;
          break;
        }
      }
      mensagemId = wamids[wamids.length - 1] ?? null;
      if (falhaParcial && wamids.length === 0) {
        return {
          erro: `A Meta recusou o envio de ${falhaParcial}. Fora da janela de 24h só template aprovado chega — use o botão Template.`,
        };
      }
    } else {
      try {
        mensagemId = await enviarTextoMeta(lead.telefone_e164, texto);
        if (mensagemId) wamids.push(mensagemId);
      } catch (e) {
        return {
          erro: `A Meta recusou o envio: ${e instanceof Error ? e.message : String(e)}. Fora da janela de 24h só template aprovado chega — use o botão Template.`,
        };
      }
    }
  }

  // No canal Meta os anexos ficam no histórico com a URL pública do Storage
  // (o navegador subiu direto para lá) — antes o envio sumia da conversa.
  if (!viaInstagram && anexosRemotos.length > 0) {
    const service = createServiceClient();
    anexos = anexosRemotos.slice(0, wamids.length).map((a) => ({
      tipo: tipoDoArquivo(a.tipo || ""),
      nome: a.nome,
      url: service.storage.from(BUCKET_MIDIA).getPublicUrl(a.caminho).data.publicUrl,
    }));
  }

  // Sem texto, o histórico guarda o rótulo do primeiro anexo como prévia.
  // Envio parcial registra quantos arquivos de fato chegaram.
  // Quantos ARQUIVOS chegaram de fato. No Direct o texto também devolve um
  // id, então descontá-lo evita dizer "2/1 enviados".
  const enviados = viaInstagram
    ? Math.max(wamids.length - (texto ? 1 : 0), 0)
    : arquivos.length > 0
      ? wamids.length
      : arquivos.length;
  const conteudo =
    texto ||
    (arquivos.length > 0
      ? (anexosRemotos[0]?.nome ??
          ROTULO_TIPO[tipoDoArquivo(arquivos[0].type)] ??
          "[arquivo]") +
        (arquivos.length > 1 ? ` (${enviados}/${arquivos.length})` : "")
      : texto);

  const agora = new Date().toISOString();
  const supabase = await createClient();

  const { data: criada } = await supabase
    .from("lead_interactions")
    .insert({
      lead_id: leadId,
      tipo: "mensagem_enviada",
      conteudo,
      autor_id: perfil.id,
      metadados: {
        via: "crm",
        message_id: mensagemId,
        // Recibos (✓✓/falhou) casam por qualquer wamid do envio, não só
        // o do último arquivo.
        ...(wamids.length > 1 ? { message_ids: wamids } : {}),
        ...(falhaParcial ? { falha_parcial: falhaParcial } : {}),
        ...(anexos.length > 0 ? { anexos } : {}),
      },
    })
    .select("id, criado_em")
    .maybeSingle();

  await supabase
    .from("leads")
    .update({ ultima_interacao_em: agora, chat_lido_em: agora })
    .eq("id", leadId);

  // Template disparado é contato feito: sai de "Novo" para "Em Contato".
  const servico = createServiceClient();
  await avancarAposDisparo(servico, [leadId]);
  await marcarRoteiroEnviado(servico, [leadId]);

  // Sem revalidatePath("/chat") no envio: a Janela recebe a interação criada
  // e reconcilia no estado local (o eco do realtime é ignorado pelo id). O
  // render duplo de cada envio — revalidate + eco 3s depois — deixa de
  // existir. Se o insert não devolveu a linha (não deveria), revalida como
  // antes para a mensagem não sumir da tela.
  if (!criada)  // A carteira mostra "último contato": sem isto ela seguia no valor velho.
  revalidatePath("/carteira");
  revalidatePath("/atendimento");
  revalidatePath(`/leads/${leadId}`);

  // A interação volta mesmo com falha parcial: os anexos que chegaram JÁ
  // estão no histórico — a tela precisa mostrá-los junto do aviso.
  const interacao = criada
    ? {
        interacao: {
          id: criada.id as string,
          tipo: "mensagem_enviada" as const,
          conteudo,
          criado_em: criada.criado_em as string,
          autor: perfil.nome,
          anexos,
        },
      }
    : {};

  if (falhaParcial) {
    return {
      erro: `Atenção: ${enviados} de ${arquivos.length} anexos e o texto JÁ chegaram ao lead (registrados no histórico). Falhou ${falhaParcial} — reenvie SÓ esse arquivo.`,
      ...interacao,
    };
  }
  return { ok: true, ...interacao };
}

/**
 * Dispara um template aprovado do WhatsApp — o único canal permitido fora
 * da janela de 24h. As variáveis vêm como campos `param_<token>`.
 */
export async function enviarTemplateLead(
  _estado: ResultadoEnvio,
  formData: FormData,
): Promise<ResultadoEnvio> {
  const perfil = await perfilAtual();
  if (!perfil) return { erro: "Sessão expirada. Entre novamente." };

  const leadId = String(formData.get("lead_id") ?? "");
  const nome = String(formData.get("template_nome") ?? "");
  const idioma = String(formData.get("template_idioma") ?? "");
  if (!leadId || !nome) return { erro: "Escolha um template." };

  // Guarda antes de listar: sem a Meta a lista viria vazia e o usuário veria
  // "template não encontrado" — o problema real é outro e merece nome.
  if (!metaConfigurada()) {
    return { erro: "WhatsApp (Meta) não configurado." };
  }

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

  const valores: Record<string, string> = {};
  for (const token of template.parametros) {
    const valor = String(formData.get(`param_${token}`) ?? "").trim();
    if (!valor) return { erro: `Preencha a variável {{${token}}}.` };
    valores[token] = valor;
  }

  const lead = await leadComConversa(leadId);
  if (!lead) return { erro: "Lead não encontrado." };

  const supabase = await createClient();
  let mensagemId: string | null = null;

  // Na Meta o template abre conversa direto: só precisa do telefone.
  if (!lead.telefone_e164) {
    return {
      erro: "Este lead não tem telefone — não dá para iniciar conversa no WhatsApp. Se ele é cliente da carteira, preencha o número na ficha dele em Carteira.",
    };
  }
  try {
    mensagemId = await enviarTemplateMeta(
      lead.telefone_e164,
      template,
      valores,
    );
  } catch (e) {
    return {
      erro: `A Meta recusou o template: ${e instanceof Error ? e.message : String(e)}`,
    };
  }

  const conteudo = template.corpo.replace(
    /\{\{\s*([^{}]+?)\s*\}\}/g,
    (bloco, token: string) => valores[token] ?? bloco,
  );
  const agora = new Date().toISOString();

  await supabase.from("lead_interactions").insert({
    lead_id: leadId,
    tipo: "mensagem_enviada",
    conteudo,
    autor_id: perfil.id,
    metadados: {
      via: "crm",
      template: template.nome,
      message_id: mensagemId,
    },
  });

  await supabase
    .from("leads")
    .update({ ultima_interacao_em: agora, chat_lido_em: agora })
    .eq("id", leadId);

  // A carteira mostra "último contato": sem isto ela seguia no valor velho.
  revalidatePath("/carteira");
  revalidatePath(`/leads/${leadId}`);
  return { ok: true };
}

/** Define (ou remove, com null) o atendente do lead. */
export async function definirResponsavelChat(
  leadId: string,
  responsavelId: string | null,
): Promise<ResultadoEnvio> {
  const perfil = await perfilAtual();
  if (!perfil) return { erro: "Sessão expirada. Entre novamente." };
  if (!leadId) return { erro: "Lead não informado." };

  const supabase = await createClient();

  // O e-mail saiu da consulta: só servia para achar o agente no Chatwoot.
  let responsavel: { nome: string } | null = null;
  if (responsavelId) {
    const { data } = await supabase
      .from("profiles")
      .select("nome")
      .eq("id", responsavelId)
      .maybeSingle();
    if (!data) return { erro: "Atendente não encontrado." };
    responsavel = data as { nome: string };
  }

  const { error } = await supabase
    .from("leads")
    .update({ responsavel_id: responsavelId })
    .eq("id", leadId);
  if (error) return { erro: error.message };

  await supabase.from("lead_interactions").insert({
    lead_id: leadId,
    tipo: "atribuicao",
    conteudo: responsavel
      ? `Atendimento atribuído a ${responsavel.nome}`
      : "Atendimento ficou sem atendente",
    autor_id: perfil.id,
    // sistema: log de ação, não nota escrita — a conversa mostra como linha
    // fina, não como bolha de "Nota privada".
    metadados: { via: "crm", sistema: true },
  });

  revalidatePath(`/leads/${leadId}`);
  return { ok: true };
}

/** Marca ou desmarca uma etiqueta do lead. */
export async function alternarEtiquetaChat(
  leadId: string,
  tagId: string,
  marcar: boolean,
): Promise<ResultadoEnvio> {
  const perfil = await perfilAtual();
  if (!perfil) return { erro: "Sessão expirada. Entre novamente." };
  if (!leadId || !tagId) return { erro: "Etiqueta não informada." };

  const supabase = await createClient();

  if (marcar) {
    const { error } = await supabase
      .from("lead_tags")
      .upsert({ lead_id: leadId, tag_id: tagId });
    if (error) return { erro: error.message };
  } else {
    const { error } = await supabase
      .from("lead_tags")
      .delete()
      .eq("lead_id", leadId)
      .eq("tag_id", tagId);
    if (error) return { erro: error.message };
  }

  revalidatePath(`/leads/${leadId}`);
  return { ok: true };
}

/** Resolve ou reabre a conversa (marca local) e registra no histórico. */
export async function alterarStatusConversaChat(
  leadId: string,
  status: "open" | "resolved",
): Promise<ResultadoEnvio> {
  const perfil = await perfilAtual();
  if (!perfil) return { erro: "Sessão expirada. Entre novamente." };

  const lead = await leadComConversa(leadId);
  if (!lead) return { erro: "Lead não encontrado." };

  const supabase = await createClient();
  const agora = new Date().toISOString();

  // Resolvida sai da caixa de entrada; reabrir devolve. Guardado local porque
  // a Meta não tem status de conversa — e é o que a lista consulta.
  const { error: erroMarca } = await supabase
    .from("leads")
    .update(
      status === "resolved"
        ? { chat_resolvido_em: agora, chat_lido_em: agora }
        : { chat_resolvido_em: null },
    )
    .eq("id", leadId);
  if (erroMarca) {
    return {
      erro: erroMarca.message.includes("chat_resolvido_em")
        ? "Resolver depende da migração 0018 — rode supabase/migrations/0018_resolver_conversa.sql no SQL Editor."
        : erroMarca.message,
    };
  }

  await supabase.from("lead_interactions").insert({
    lead_id: leadId,
    tipo: "nota",
    conteudo:
      status === "resolved" ? "Conversa resolvida" : "Conversa reaberta",
    autor_id: perfil.id,
    metadados: { via: "crm", sistema: true },
  });

  revalidatePath(`/leads/${leadId}`);
  // Resolver/reabrir muda as filas de /hoje e a caixa em /atendimento —
  // sem revalidar, as duas telas seguiam mostrando a conversa no lugar velho.
  revalidatePath("/hoje");
  revalidatePath("/atendimento");
  return { ok: true };
}

/** Move o lead de etapa no funil — o gatilho do banco registra no histórico. */
export async function alterarEtapaChat(
  leadId: string,
  stageId: string,
): Promise<ResultadoEnvio> {
  const perfil = await perfilAtual();
  if (!perfil) return { erro: "Sessão expirada. Entre novamente." };
  if (!leadId || !stageId) return { erro: "Etapa não informada." };

  const supabase = await createClient();
  const { error } = await supabase
    .from("leads")
    .update({ stage_id: stageId })
    .eq("id", leadId);
  if (error) return { erro: error.message };

  revalidatePath(`/leads/${leadId}`);
  revalidatePath("/atendimento");
  return { ok: true };
}

/**
 * Marcar perdido DIRETO DO CHAT (a equipe vive aqui, não no kanban): mesmo
 * contrato do quadro — motivo obrigatório, detalhe opcional — e o lead vai
 * para a última etapa final do kanban padrão (a coluna Perdido).
 */
export async function marcarPerdidoChat(
  leadId: string,
  motivo: string,
  detalhe: string,
): Promise<ResultadoEnvio> {
  const perfil = await perfilAtual();
  if (!perfil) return { erro: "Sessão expirada. Entre novamente." };
  if (!leadId) return { erro: "Lead não informado." };
  if (!ehMotivoPerda(motivo)) return { erro: "Escolha o motivo da perda." };

  const supabase = await createClient();
  let { data: etapaFinal } = await supabase
    .from("pipeline_stages")
    .select("id, pipeline:pipelines!inner(padrao)")
    .eq("pipeline.padrao", true)
    .eq("is_final", true)
    .order("ordem", { ascending: false })
    .limit(1)
    .maybeSingle();
  if (!etapaFinal) {
    // Kanban sem etapa marcada como final (config mexida no Admin): tenta
    // pelo nome antes de deixar o card parado numa coluna viva.
    const porNome = await supabase
      .from("pipeline_stages")
      .select("id, pipeline:pipelines!inner(padrao)")
      .eq("pipeline.padrao", true)
      .ilike("nome", "perdid%")
      .limit(1)
      .maybeSingle();
    etapaFinal = porNome.data;
  }

  const texto = detalhe.trim().slice(0, 280);
  const mudancas: Record<string, unknown> = {
    status: "perdido",
    perda_motivo: motivo,
    perda_detalhe: texto || null,
  };
  if (etapaFinal?.id) mudancas.stage_id = etapaFinal.id;

  const { error } = await supabase
    .from("leads")
    .update(mudancas)
    .eq("id", leadId);
  if (error) {
    // Banco ainda sem a 0038 (motivos): perde do jeito antigo.
    if (error.code === "42703" || error.code === "PGRST204") {
      const { error: erroSimples } = await supabase
        .from("leads")
        .update({
          status: "perdido",
          ...(etapaFinal?.id ? { stage_id: etapaFinal.id } : {}),
        })
        .eq("id", leadId);
      if (erroSimples) return { erro: "Não foi possível marcar como perdido." };
    } else if (error.code === "23514") {
      // Constraint da 0038 sem o motivo novo: aponta a migração certa.
      return { erro: "Rode a migração 0061 para este motivo existir." };
    } else {
      return { erro: error.message };
    }
  }

  revalidatePath("/atendimento");
  revalidatePath("/hoje");
  revalidatePath(`/leads/${leadId}`);
  return { ok: true };
}

/**
 * Reabrir um lead perdido a partir do chat: volta para "em atendimento",
 * limpa o motivo (o gatilho t01 cuida do carimbo) e devolve o card à
 * primeira etapa — quando o lead responder, o espelho o move sozinho.
 */
export async function reabrirLeadChat(leadId: string): Promise<ResultadoEnvio> {
  const perfil = await perfilAtual();
  if (!perfil) return { erro: "Sessão expirada. Entre novamente." };
  if (!leadId) return { erro: "Lead não informado." };

  const supabase = await createClient();

  // O destino segue o contrato do espelho (0040): lead comum volta para a
  // primeira etapa; CLIENTE não é lead frio — sem giro vive em Ativação,
  // girando vive fora do quadro (stage nulo).
  const { data: leadAtual } = await supabase
    .from("leads")
    .select("customer_id")
    .eq("id", leadId)
    .maybeSingle();

  let novaEtapa: string | null | undefined;
  if (leadAtual?.customer_id) {
    const { data: giro } = await supabase
      .from("v_customer_giro")
      .select("lotes_30d")
      .eq("customer_id", leadAtual.customer_id)
      .maybeSingle();
    if ((giro?.lotes_30d ?? 0) > 0) {
      novaEtapa = null; // girando: fora do quadro
    } else {
      const { data: ativacao } = await supabase
        .from("pipeline_stages")
        .select("id, pipeline:pipelines!inner(padrao)")
        .eq("pipeline.padrao", true)
        .ilike("nome", "ativa%")
        .limit(1)
        .maybeSingle();
      novaEtapa = ativacao?.id; // sem a coluna, não mexe na etapa
    }
  } else {
    const { data: primeira } = await supabase
      .from("pipeline_stages")
      .select("id, pipeline:pipelines!inner(padrao)")
      .eq("pipeline.padrao", true)
      .order("ordem")
      .limit(1)
      .maybeSingle();
    novaEtapa = primeira?.id;
  }

  const { error } = await supabase
    .from("leads")
    .update({
      status: "em_atendimento",
      perda_motivo: null,
      perda_detalhe: null,
      ...(novaEtapa !== undefined ? { stage_id: novaEtapa } : {}),
    })
    .eq("id", leadId);
  if (error) {
    if (error.code === "42703" || error.code === "PGRST204") {
      const { error: erroSimples } = await supabase
        .from("leads")
        .update({
          status: "em_atendimento",
          ...(novaEtapa !== undefined ? { stage_id: novaEtapa } : {}),
        })
        .eq("id", leadId);
      if (erroSimples) return { erro: "Não foi possível reabrir." };
    } else {
      return { erro: error.message };
    }
  }

  revalidatePath("/atendimento");
  revalidatePath("/hoje");
  revalidatePath(`/leads/${leadId}`);
  return { ok: true };
}

/**
 * Stand-by (do diálogo de perda do chat): o "vou pensar" NÃO é perda. O
 * lead ganha a etiqueta Stand-by (para o bolsão ficar visível nas listas) e
 * a conversa é adiada por 1 semana — se ele responder antes, o espelho traz
 * de volta à caixa sozinho.
 */
export async function marcarStandBy(leadId: string): Promise<ResultadoEnvio> {
  const perfil = await perfilAtual();
  if (!perfil) return { erro: "Sessão expirada. Entre novamente." };
  if (!leadId) return { erro: "Lead não informado." };

  const supabase = await createClient();

  // Etiqueta Stand-by: acha ou cria. A CRIAÇÃO vai pelo service role — o RLS
  // de tags é só de gestor, e o vendedor é justamente quem mais usa este
  // botão (a sessão já foi validada acima). Erro inesperado NÃO é engolido:
  // adiar sem a etiqueta enterraria o lead sem o bolsão prometido.
  let { data: tag } = await supabase
    .from("tags")
    .select("id")
    .eq("nome", "Stand-by")
    .maybeSingle();
  if (!tag) {
    const service = createServiceClient();
    const criada = await service
      .from("tags")
      .insert({ nome: "Stand-by", cor: "ambar" })
      .select("id")
      .maybeSingle();
    if (criada.error?.code === "42703" || criada.error?.code === "PGRST204") {
      // Sem a 0016 a cor não existe: cria sem.
      const semCor = await service
        .from("tags")
        .insert({ nome: "Stand-by" })
        .select("id")
        .maybeSingle();
      if (semCor.error) {
        return { erro: `Não deu para criar a etiqueta: ${semCor.error.message}` };
      }
      tag = semCor.data;
    } else if (criada.error?.code === "23505") {
      // Corrida: outra aba criou primeiro — relê.
      const releitura = await service
        .from("tags")
        .select("id")
        .eq("nome", "Stand-by")
        .maybeSingle();
      tag = releitura.data;
    } else if (criada.error) {
      return { erro: `Não deu para criar a etiqueta: ${criada.error.message}` };
    } else {
      tag = criada.data;
    }
  }
  if (!tag) return { erro: "Não deu para preparar a etiqueta Stand-by." };

  const { error: erroVinculo } = await supabase
    .from("lead_tags")
    .insert({ lead_id: leadId, tag_id: tag.id });
  // 23505 = já etiquetado — exatamente o que queríamos.
  if (erroVinculo && erroVinculo.code !== "23505") {
    return { erro: `Não deu para etiquetar: ${erroVinculo.message}` };
  }

  return adiarConversa(leadId, "1semana");
}

export type Pendencias = { naoLidas: number; tarefasVencidas: number };

/**
 * Pendências para o badge do menu: conversas não lidas e tarefas vencidas.
 * O PostgREST não compara coluna com coluna, então a conta fecha aqui.
 */
export async function contarNaoLidas(): Promise<Pendencias> {
  const perfil = await perfilAtual();
  if (!perfil) return { naoLidas: 0, tarefasVencidas: 0 };

  const supabase = await createClient();
  const agoraMs = Date.now();
  const agoraIso = new Date(agoraMs).toISOString();

  type LinhaFila = {
    ultima_interacao_em: string;
    chat_lido_em: string | null;
    chat_adiado_em?: string | null;
    chat_adiado_ate?: string | null;
  };

  // Conversa existente: houve interação (na Meta o thread é o telefone, então
  // basta o histórico). Adiada dentro do prazo não conta — volta sozinha
  // quando o prazo vence ou o lead responde. Sem a migração 0042 cai para
  // "adiada não conta nunca" (0017), e sem a 0017 segue sem esse filtro.
  async function buscarFila(nivel: "prazo" | "adiado" | "base") {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any -- corta a recursão de tipos do builder
    let q: any = supabase
      .from("leads")
      .select(
        nivel === "prazo"
          ? "ultima_interacao_em, chat_lido_em, chat_adiado_em, chat_adiado_ate"
          : "ultima_interacao_em, chat_lido_em",
      )
      .not("ultima_interacao_em", "is", null)
      .order("ultima_interacao_em", { ascending: false })
      .limit(500);
    // Adiadas (no prazo) e resolvidas saem da conta: o badge tem que zerar.
    if (nivel !== "base") {
      q = q.is("chat_resolvido_em", null);
      q =
        nivel === "prazo"
          ? q.or(`chat_adiado_em.is.null,chat_adiado_ate.lte."${agoraIso}"`)
          : q.is("chat_adiado_em", null);
    }

    const { data, error } = await q;
    return { data: data as LinhaFila[] | null, error };
  }

  const [fila, { count: vencidas }] = await Promise.all([
    buscarFila("prazo")
      .then((r) => (r.error ? buscarFila("adiado") : r))
      .then((r) => (r.error ? buscarFila("base") : r)),
    // Tolerante: sem a migração 0013 a tabela não existe e o count vem null.
    supabase
      .from("lead_tasks")
      .select("id", { count: "exact", head: true })
      .is("concluida_em", null)
      .lt("vence_em", agoraIso),
  ]);

  // Prazo de adiamento vencido e ninguém abriu desde então: pendente de novo.
  const adiadaVencida = (l: LinhaFila) =>
    l.chat_adiado_em != null &&
    l.chat_adiado_ate != null &&
    Date.parse(l.chat_adiado_ate) <= agoraMs &&
    (l.chat_lido_em === null ||
      Date.parse(l.chat_lido_em) < Date.parse(l.chat_adiado_ate));

  const naoLidas = (fila.data ?? []).filter(
    (l) =>
      l.chat_lido_em === null ||
      l.ultima_interacao_em > l.chat_lido_em ||
      adiadaVencida(l),
  ).length;

  return { naoLidas, tarefasVencidas: vencidas ?? 0 };
}

/** Cria um lembrete para voltar no lead na data marcada. */
export async function criarTarefaLead(
  _estado: ResultadoEnvio,
  formData: FormData,
): Promise<ResultadoEnvio> {
  const perfil = await perfilAtual();
  if (!perfil) return { erro: "Sessão expirada. Entre novamente." };

  const leadId = String(formData.get("lead_id") ?? "");
  const titulo = String(formData.get("titulo") ?? "").trim();
  const venceIso = String(formData.get("vence_iso") ?? "");

  if (!leadId) return { erro: "Lead não informado." };
  if (!titulo) return { erro: "Escreva a tarefa." };
  if (!venceIso || Number.isNaN(Date.parse(venceIso))) {
    return { erro: "Escolha data e hora." };
  }

  const supabase = await createClient();
  const { error } = await supabase.from("lead_tasks").insert({
    lead_id: leadId,
    titulo,
    vence_em: venceIso,
    autor_id: perfil.id,
    responsavel_id: perfil.id,
  });
  if (error) {
    return {
      erro: error.message.includes("lead_tasks")
        ? "Tarefas dependem da migração 0013 — rode supabase/migrations/0013_engajamento.sql no SQL Editor."
        : error.message,
    };
  }

  revalidatePath(`/leads/${leadId}`);
  // Tarefa nova entra na agenda do dia — /hoje e /agenda listam lead_tasks.
  revalidatePath("/hoje");
  revalidatePath("/agenda");
  return { ok: true };
}

export async function concluirTarefaLead(
  tarefaId: string,
  leadId: string,
): Promise<ResultadoEnvio> {
  const perfil = await perfilAtual();
  if (!perfil) return { erro: "Sessão expirada. Entre novamente." };
  if (!tarefaId) return { erro: "Tarefa não informada." };

  const supabase = await createClient();
  const { error } = await supabase
    .from("lead_tasks")
    .update({ concluida_em: new Date().toISOString() })
    .eq("id", tarefaId);
  if (error) return { erro: error.message };

  revalidatePath(`/leads/${leadId}`);
  // Tarefa concluída sai das pendências de /hoje e /agenda na hora.
  revalidatePath("/hoje");
  revalidatePath("/agenda");
  return { ok: true };
}

/**
 * Abrir a conversa zera o indicador de não lida. Roda DURANTE o render da
 * página, então não pode revalidar caminho aqui (o Next 16 proíbe) — a
 * atualização de 5s da própria tela reflete a mudança logo em seguida.
 */
export async function marcarChatLido(leadId: string) {
  const perfil = await perfilAtual();
  if (!perfil || !leadId) return;

  const supabase = await createClient();
  await supabase
    .from("leads")
    .update({ chat_lido_em: new Date().toISOString() })
    .eq("id", leadId);
}

/** Opções rápidas de prazo ao adiar — o servidor calcula a data. */
export type PrazoAdiar = "amanha" | "3dias" | "1semana";

const DIAS_PRAZO: Record<PrazoAdiar, number> = {
  amanha: 1,
  "3dias": 3,
  "1semana": 7,
};

/** Data-limite do adiamento (ISO) a partir da opção rápida escolhida. */
function prazoParaIso(prazo: PrazoAdiar, agoraMs: number): string | null {
  const dias = DIAS_PRAZO[prazo];
  return dias ? new Date(agoraMs + dias * 86_400_000).toISOString() : null;
}

/**
 * Adia a conversa: sai da caixa de entrada até o prazo escolhido. Ela volta
 * antes se o lead responder (o webhook limpa as marcas) e volta sozinha como
 * pendente quando o prazo vence — o filtro das consultas compara com now().
 * Sem a migração 0042 vale o comportamento antigo: adia até o lead responder.
 */
export async function adiarConversa(
  leadId: string,
  prazo: PrazoAdiar,
): Promise<ResultadoEnvio> {
  const perfil = await perfilAtual();
  if (!perfil) return { erro: "Sessão expirada. Entre novamente." };
  if (!leadId) return { erro: "Lead não informado." };

  const agora = new Date().toISOString();
  const ate = prazoParaIso(prazo, Date.parse(agora));
  if (!ate) return { erro: "Escolha até quando adiar." };

  const supabase = await createClient();
  let comPrazo = true;
  let { error } = await supabase
    .from("leads")
    .update({ chat_adiado_em: agora, chat_adiado_ate: ate, chat_lido_em: agora })
    .eq("id", leadId);
  if (error && error.message.includes("chat_adiado_ate")) {
    // Sem a coluna da 0042 a conversa ainda adia — só sem prazo de retorno.
    comPrazo = false;
    ({ error } = await supabase
      .from("leads")
      .update({ chat_adiado_em: agora, chat_lido_em: agora })
      .eq("id", leadId));
  }
  if (error) {
    return {
      erro: error.message.includes("chat_adiado_em")
        ? "Adiar depende da migração 0017 — rode supabase/migrations/0017_adiar_conversa.sql no SQL Editor."
        : error.message,
    };
  }

  await supabase.from("lead_interactions").insert({
    lead_id: leadId,
    tipo: "nota",
    conteudo: comPrazo
      ? `Conversa adiada até ${formatarData(ate)}`
      : "Conversa adiada até a próxima resposta do lead",
    autor_id: perfil.id,
    metadados: { via: "crm", sistema: true },
  });

  // Adiar tira a conversa das filas de /hoje e /atendimento até o prazo.
  revalidatePath("/hoje");
  revalidatePath("/atendimento");
  return { ok: true };
}

/** Traz a conversa adiada de volta à caixa de entrada, sem esperar resposta. */
export async function reativarConversa(
  leadId: string,
): Promise<ResultadoEnvio> {
  const perfil = await perfilAtual();
  if (!perfil) return { erro: "Sessão expirada. Entre novamente." };
  if (!leadId) return { erro: "Lead não informado." };

  const supabase = await createClient();
  let { error } = await supabase
    .from("leads")
    .update({ chat_adiado_em: null, chat_adiado_ate: null })
    .eq("id", leadId);
  if (error && error.message.includes("chat_adiado_ate")) {
    // Sem a migração 0042 não existe a coluna do prazo: limpa só a marca.
    ({ error } = await supabase
      .from("leads")
      .update({ chat_adiado_em: null })
      .eq("id", leadId));
  }
  if (error) return { erro: error.message };

  // Reativar devolve a conversa às filas de /hoje e /atendimento na hora.
  revalidatePath("/hoje");
  revalidatePath("/atendimento");
  return { ok: true };
}

/** Devolve a conversa para a fila de não lidas. */
export async function marcarChatNaoLido(
  leadId: string,
): Promise<ResultadoEnvio> {
  const perfil = await perfilAtual();
  if (!perfil) return { erro: "Sessão expirada. Entre novamente." };
  if (!leadId) return { erro: "Lead não informado." };

  const supabase = await createClient();
  const { error } = await supabase
    .from("leads")
    .update({ chat_lido_em: null })
    .eq("id", leadId);
  if (error) return { erro: error.message };

  return { ok: true };
}

// ===========================================================================
// Ações em massa na lista de conversas
// ===========================================================================

const MAX_EM_MASSA = 200;

async function emMassa(
  leadIds: string[],
  mudanca: Record<string, unknown>,
  nota: string | null,
): Promise<ResultadoEnvio & { total?: number }> {
  const perfil = await perfilAtual();
  if (!perfil) return { erro: "Sessão expirada. Entre novamente." };

  const ids = [...new Set(leadIds)].filter(Boolean).slice(0, MAX_EM_MASSA);
  if (ids.length === 0) return { erro: "Nenhuma conversa selecionada." };

  const supabase = await createClient();
  const { error } = await supabase.from("leads").update(mudanca).in("id", ids);
  if (error) {
    return {
      erro:
        error.message.includes("chat_adiado_em") ||
        error.message.includes("chat_resolvido_em")
          ? "Esta ação depende das migrações 0017/0018 — rode-as no SQL Editor."
          : error.message,
    };
  }

  // Uma linha no histórico de cada conversa: quem fez e o quê.
  if (nota) {
    await supabase.from("lead_interactions").insert(
      ids.map((id) => ({
        lead_id: id,
        tipo: "nota" as const,
        conteudo: nota,
        autor_id: perfil.id,
        metadados: { via: "crm", em_massa: true, sistema: true },
      })),
    );
  }

  return { ok: true, total: ids.length };
}

export async function adiarConversasEmMassa(
  leadIds: string[],
  prazo: PrazoAdiar,
) {
  const agora = new Date().toISOString();
  const ate = prazoParaIso(prazo, Date.parse(agora));
  if (!ate) return { erro: "Escolha até quando adiar." };

  const resultado = await emMassa(
    leadIds,
    { chat_adiado_em: agora, chat_adiado_ate: ate, chat_lido_em: agora },
    `Conversa adiada até ${formatarData(ate)}`,
  );
  // Sem a migração 0042 não existe a coluna do prazo: adia do jeito antigo.
  if (resultado.erro?.includes("chat_adiado_ate")) {
    return emMassa(
      leadIds,
      { chat_adiado_em: agora, chat_lido_em: agora },
      "Conversa adiada até a próxima resposta do lead",
    );
  }
  return resultado;
}

export async function resolverConversasEmMassa(leadIds: string[]) {
  const agora = new Date().toISOString();
  return emMassa(
    leadIds,
    { chat_resolvido_em: agora, chat_lido_em: agora },
    "Conversa resolvida",
  );
}

export async function marcarNaoLidasEmMassa(leadIds: string[]) {
  return emMassa(leadIds, { chat_lido_em: null }, null);
}

export async function marcarLidasEmMassa(leadIds: string[]) {
  return emMassa(leadIds, { chat_lido_em: new Date().toISOString() }, null);
}

/** Atribui (ou tira o dono de) várias conversas de uma vez. */
/** Aplica (ou remove) uma etiqueta em todas as conversas selecionadas. */
export async function etiquetarEmMassa(
  leadIds: string[],
  tagId: string,
  marcar: boolean,
): Promise<ResultadoEnvio & { total?: number }> {
  const perfil = await perfilAtual();
  if (!perfil) return { erro: "Sessão expirada. Entre novamente." };
  if (!tagId) return { erro: "Etiqueta não informada." };

  const ids = [...new Set(leadIds)].filter(Boolean).slice(0, MAX_EM_MASSA);
  if (ids.length === 0) return { erro: "Nenhuma conversa selecionada." };

  const supabase = await createClient();

  if (marcar) {
    // upsert: quem já tinha a etiqueta não vira erro de duplicidade.
    const { error } = await supabase
      .from("lead_tags")
      .upsert(
        ids.map((lead_id) => ({ lead_id, tag_id: tagId })),
        { onConflict: "lead_id,tag_id" },
      );
    if (error) return { erro: error.message };
  } else {
    const { error } = await supabase
      .from("lead_tags")
      .delete()
      .in("lead_id", ids)
      .eq("tag_id", tagId);
    if (error) return { erro: error.message };
  }

  return { ok: true, total: ids.length };
}

export async function atribuirEmMassa(
  leadIds: string[],
  responsavelId: string | null,
) {
  const perfil = await perfilAtual();
  if (!perfil) return { erro: "Sessão expirada. Entre novamente." };

  let nome = "ninguém";
  if (responsavelId) {
    const supabase = await createClient();
    const { data } = await supabase
      .from("profiles")
      .select("nome")
      .eq("id", responsavelId)
      .maybeSingle();
    if (!data) return { erro: "Atendente não encontrado." };
    nome = data.nome;
  }

  return emMassa(
    leadIds,
    { responsavel_id: responsavelId },
    responsavelId
      ? `Atendimento atribuído a ${nome}`
      : "Atendimento ficou sem atendente",
  );
}
