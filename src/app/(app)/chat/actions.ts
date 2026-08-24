"use server";

import { revalidatePath } from "next/cache";
import { createClient, createServiceClient } from "@/lib/supabase/server";
import { avancarAposDisparo } from "@/lib/kanban";
import { perfilAtual } from "@/lib/auth";
import {
  alterarStatusConversa,
  atribuirConversaPorEmail,
  definirEtiquetasConversa,
  enviarMensagem,
  enviarMensagemComAnexos,
  enviarNotaPrivada,
  enviarTemplate,
  iniciarConversaWhatsapp,
} from "@/lib/chatwoot";
import {
  enviarMidiaMeta,
  enviarTemplateMeta,
  enviarTextoMeta,
} from "@/lib/whatsapp";
import { canalAtivo, listarTemplatesCanal } from "@/lib/canal";
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

export type ResultadoEnvio = { ok?: boolean; erro?: string };

async function leadComConversa(leadId: string) {
  const supabase = await createClient();
  const { data: lead } = await supabase
    .from("leads")
    .select(
      "id, nome, telefone_e164, instagram_id, instagram_usuario, chatwoot_contact_id, chatwoot_conversation_id",
    )
    .eq("id", leadId)
    .maybeSingle();
  return lead as {
    id: string;
    nome: string;
    telefone_e164: string | null;
    instagram_id: string | null;
    instagram_usuario: string | null;
    chatwoot_contact_id: number | null;
    chatwoot_conversation_id: number | null;
  } | null;
}

/**
 * Registra o eco do webhook como processado ANTES de ele chegar — assim a
 * mensagem que o próprio CRM enviou não entra duas vezes no histórico.
 */
async function marcarEcoProcessado(
  mensagemId: number,
  leadId: string,
): Promise<void> {
  const service = createServiceClient();
  await service.from("webhook_events").insert({
    origem: "chatwoot",
    evento_id: `cw-msg-${mensagemId}`,
    payload: { via: "crm", lead_id: leadId },
    processado: true,
  });
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

  // Nota privada: só equipe vê. Fica no histórico e espelha no Chatwoot.
  if (modo === "nota") {
    const lead = await leadComConversa(leadId);
    if (!lead) return { erro: "Lead não encontrado." };

    let notaId: number | null = null;
    if (canalAtivo() === "chatwoot" && lead.chatwoot_conversation_id) {
      try {
        const resposta = await enviarNotaPrivada(
          lead.chatwoot_conversation_id,
          textoBruto,
        );
        notaId = resposta?.id ?? null;
      } catch {
        // sem Chatwoot a nota ainda vale localmente
      }
    }

    const supabase = await createClient();
    await supabase.from("lead_interactions").insert({
      lead_id: leadId,
      tipo: "nota",
      conteudo: textoBruto,
      autor_id: perfil.id,
      metadados: {
        via: "crm",
        ...(notaId !== null ? { chatwoot_message_id: notaId } : {}),
      },
    });

    revalidatePath("/chat");
    revalidatePath(`/leads/${leadId}`);
    return { ok: true };
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

  const canal = canalAtivo();
  let mensagemId: string | number | null = null;
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
  } else if (canal === "meta") {
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
  } else {
    if (!lead.chatwoot_conversation_id) {
      return {
        erro: "Este lead não tem conversa vinculada no Chatwoot — ele precisa mandar a primeira mensagem no WhatsApp.",
      };
    }
    try {
      if (arquivos.length > 0) {
        const resposta = await enviarMensagemComAnexos(
          lead.chatwoot_conversation_id,
          texto,
          arquivos,
        );
        mensagemId = resposta?.id ?? null;
        anexos = (resposta?.attachments ?? []).flatMap((a) =>
          a.data_url ? [{ tipo: a.file_type ?? "file", url: a.data_url }] : [],
        );
      } else {
        const resposta = await enviarMensagem(
          lead.chatwoot_conversation_id,
          texto,
        );
        mensagemId = resposta?.id ?? null;
      }
    } catch (e) {
      return {
        erro: `O Chatwoot recusou o envio: ${e instanceof Error ? e.message : String(e)}. Fora da janela de 24h só template aprovado chega — use o botão Template.`,
      };
    }

    if (typeof mensagemId === "number") {
      await marcarEcoProcessado(mensagemId, leadId);
    }
  }

  // No canal Meta os anexos ficam no histórico com a URL pública do Storage
  // (o navegador subiu direto para lá) — antes o envio sumia da conversa.
  if (!viaInstagram && canal === "meta" && anexosRemotos.length > 0) {
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
    : canal === "meta" && arquivos.length > 0
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

  await supabase.from("lead_interactions").insert({
    lead_id: leadId,
    tipo: "mensagem_enviada",
    conteudo,
    autor_id: perfil.id,
    metadados: {
      via: "crm",
      ...(canal === "meta"
        ? {
            message_id: mensagemId,
            // Recibos (✓✓/falhou) casam por qualquer wamid do envio, não só
            // o do último arquivo.
            ...(wamids.length > 1 ? { message_ids: wamids } : {}),
            ...(falhaParcial ? { falha_parcial: falhaParcial } : {}),
          }
        : {
            chatwoot_message_id: mensagemId,
            chatwoot_conversation_id: lead.chatwoot_conversation_id,
          }),
      ...(anexos.length > 0 ? { anexos } : {}),
    },
  });

  await supabase
    .from("leads")
    .update({ ultima_interacao_em: agora, chat_lido_em: agora })
    .eq("id", leadId);

  // Template disparado é contato feito: sai de "Novo" para "Em Contato".
  await avancarAposDisparo(createServiceClient(), [leadId]);

  revalidatePath("/chat");
  // A carteira mostra "último contato": sem isto ela seguia no valor velho.
  revalidatePath("/carteira");
  revalidatePath("/atendimento");
  revalidatePath(`/leads/${leadId}`);

  if (falhaParcial) {
    return {
      erro: `Atenção: ${enviados} de ${arquivos.length} anexos e o texto JÁ chegaram ao lead (registrados no histórico). Falhou ${falhaParcial} — reenvie SÓ esse arquivo.`,
    };
  }
  return { ok: true };
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

  const valores: Record<string, string> = {};
  for (const token of template.parametros) {
    const valor = String(formData.get(`param_${token}`) ?? "").trim();
    if (!valor) return { erro: `Preencha a variável {{${token}}}.` };
    valores[token] = valor;
  }

  const lead = await leadComConversa(leadId);
  if (!lead) return { erro: "Lead não encontrado." };

  const supabase = await createClient();
  const canal = canalAtivo();
  let mensagemId: string | number | null = null;
  let conversaId: number | null = lead.chatwoot_conversation_id;

  if (canal === "meta") {
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
  } else {
    // Sem conversa? Template é justamente o jeito certo de puxar assunto:
    // cria contato + conversa no Chatwoot e vincula ao lead.
    if (!conversaId) {
      if (!lead.telefone_e164) {
        return {
          erro: "Este lead não tem telefone — não dá para iniciar conversa no WhatsApp. Se ele é cliente da carteira, preencha o número na ficha dele em Carteira.",
        };
      }
      try {
        const inicio = await iniciarConversaWhatsapp({
          nome: lead.nome,
          telefone: lead.telefone_e164,
          contatoId: lead.chatwoot_contact_id,
        });
        conversaId = inicio.conversaId;
        await supabase
          .from("leads")
          .update({
            chatwoot_contact_id: inicio.contatoId,
            chatwoot_conversation_id: conversaId,
          })
          .eq("id", leadId);
      } catch (e) {
        return {
          erro: `Não deu para abrir a conversa no Chatwoot: ${e instanceof Error ? e.message : String(e)}`,
        };
      }
    }

    try {
      const resposta = await enviarTemplate(conversaId, template, valores);
      mensagemId = resposta?.id ?? null;
    } catch (e) {
      return {
        erro: `O Chatwoot recusou o template: ${e instanceof Error ? e.message : String(e)}`,
      };
    }

    if (typeof mensagemId === "number") {
      await marcarEcoProcessado(mensagemId, leadId);
    }
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
      ...(canal === "meta"
        ? { message_id: mensagemId }
        : {
            chatwoot_message_id: mensagemId,
            chatwoot_conversation_id: conversaId,
          }),
    },
  });

  await supabase
    .from("leads")
    .update({ ultima_interacao_em: agora, chat_lido_em: agora })
    .eq("id", leadId);

  revalidatePath("/chat");
  // A carteira mostra "último contato": sem isto ela seguia no valor velho.
  revalidatePath("/carteira");
  revalidatePath(`/leads/${leadId}`);
  return { ok: true };
}

/** Define (ou remove, com null) o atendente do lead e espelha no Chatwoot. */
export async function definirResponsavelChat(
  leadId: string,
  responsavelId: string | null,
): Promise<ResultadoEnvio> {
  const perfil = await perfilAtual();
  if (!perfil) return { erro: "Sessão expirada. Entre novamente." };
  if (!leadId) return { erro: "Lead não informado." };

  const supabase = await createClient();

  let responsavel: { nome: string; email: string } | null = null;
  if (responsavelId) {
    const { data } = await supabase
      .from("profiles")
      .select("nome, email")
      .eq("id", responsavelId)
      .maybeSingle();
    if (!data) return { erro: "Atendente não encontrado." };
    responsavel = data as { nome: string; email: string };
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
    metadados: { via: "crm" },
  });

  // Espelho no Chatwoot é melhor esforço: falha lá não desfaz o CRM.
  if (canalAtivo() === "chatwoot") {
    const lead = await leadComConversa(leadId);
    if (lead?.chatwoot_conversation_id) {
      try {
        await atribuirConversaPorEmail(
          lead.chatwoot_conversation_id,
          responsavel?.email ?? null,
        );
      } catch {
        // segue o jogo — o CRM é a fonte de verdade
      }
    }
  }

  revalidatePath("/chat");
  revalidatePath(`/leads/${leadId}`);
  return { ok: true };
}

/** Marca ou desmarca uma etiqueta do lead e espelha as labels no Chatwoot. */
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

  if (canalAtivo() === "chatwoot") {
    const lead = await leadComConversa(leadId);
    if (lead?.chatwoot_conversation_id) {
      const { data: linhas } = await supabase
        .from("lead_tags")
        .select("tag:tags(nome)")
        .eq("lead_id", leadId);
      const nomes = ((linhas ?? []) as unknown as { tag: { nome: string } }[])
        .map((l) => l.tag?.nome)
        .filter(Boolean);
      try {
        await definirEtiquetasConversa(lead.chatwoot_conversation_id, nomes);
      } catch {
        // melhor esforço
      }
    }
  }

  revalidatePath("/chat");
  revalidatePath(`/leads/${leadId}`);
  return { ok: true };
}

/** Resolve ou reabre a conversa no Chatwoot e registra no histórico. */
export async function alterarStatusConversaChat(
  leadId: string,
  status: "open" | "resolved",
): Promise<ResultadoEnvio> {
  const perfil = await perfilAtual();
  if (!perfil) return { erro: "Sessão expirada. Entre novamente." };

  const lead = await leadComConversa(leadId);
  if (!lead) return { erro: "Lead não encontrado." };

  // No canal Meta o status é controle interno do CRM (vira nota); no
  // Chatwoot ele também resolve/reabre a conversa de lá.
  if (canalAtivo() === "chatwoot") {
    if (!lead.chatwoot_conversation_id) {
      return { erro: "Este lead não tem conversa vinculada no Chatwoot." };
    }
    try {
      await alterarStatusConversa(lead.chatwoot_conversation_id, status);
    } catch (e) {
      return {
        erro: `O Chatwoot recusou a mudança de status: ${e instanceof Error ? e.message : String(e)}`,
      };
    }
  }

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
    metadados: { via: "crm" },
  });

  revalidatePath("/chat");
  revalidatePath(`/leads/${leadId}`);
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

  revalidatePath("/chat");
  revalidatePath(`/leads/${leadId}`);
  revalidatePath("/atendimento");
  return { ok: true };
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
  const ehMeta = canalAtivo() === "meta";

  // Conversa existente: telefone com histórico (Meta) ou vínculo (Chatwoot).
  // Adiadas não contam — voltam sozinhas quando o lead responder; sem a
  // migração 0017 a coluna não existe e a contagem segue sem esse filtro.
  async function buscarFila(ignorandoAdiadas: boolean) {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any -- corta a recursão de tipos do builder
    let q: any = supabase
      .from("leads")
      .select("ultima_interacao_em, chat_lido_em")
      .not("ultima_interacao_em", "is", null)
      .order("ultima_interacao_em", { ascending: false })
      .limit(500);
    if (!ehMeta) q = q.not("chatwoot_conversation_id", "is", null);
    // Adiadas e resolvidas saem da conta: o badge tem que zerar.
    if (ignorandoAdiadas) {
      q = q.is("chat_adiado_em", null).is("chat_resolvido_em", null);
    }

    const { data, error } = await q;
    return {
      data: data as
        | { ultima_interacao_em: string; chat_lido_em: string | null }[]
        | null,
      error,
    };
  }

  const [fila, { count: vencidas }] = await Promise.all([
    buscarFila(true).then((r) => (r.error ? buscarFila(false) : r)),
    // Tolerante: sem a migração 0013 a tabela não existe e o count vem null.
    supabase
      .from("lead_tasks")
      .select("id", { count: "exact", head: true })
      .is("concluida_em", null)
      .lt("vence_em", new Date().toISOString()),
  ]);

  const naoLidas = (fila.data ?? []).filter(
    (l) => l.chat_lido_em === null || l.ultima_interacao_em > l.chat_lido_em,
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

  revalidatePath("/chat");
  revalidatePath(`/leads/${leadId}`);
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

  revalidatePath("/chat");
  revalidatePath(`/leads/${leadId}`);
  return { ok: true };
}

/** Agenda o texto digitado para sair sozinho na data marcada. */
export async function agendarMensagemLead(
  leadId: string,
  texto: string,
  enviarIso: string,
): Promise<ResultadoEnvio> {
  const perfil = await perfilAtual();
  if (!perfil) return { erro: "Sessão expirada. Entre novamente." };

  const conteudo = texto.trim();
  if (!leadId) return { erro: "Lead não informado." };
  if (!conteudo) return { erro: "Escreva a mensagem antes de agendar." };
  if (conteudo.length > 4096) return { erro: "Mensagem longa demais." };
  const quando = Date.parse(enviarIso);
  if (Number.isNaN(quando)) return { erro: "Escolha data e hora." };
  if (quando < Date.now() - 60_000) {
    return { erro: "A data escolhida já passou." };
  }

  const supabase = await createClient();
  const { error } = await supabase.from("scheduled_messages").insert({
    lead_id: leadId,
    texto: conteudo,
    enviar_em: enviarIso,
    autor_id: perfil.id,
  });
  if (error) {
    return {
      erro: error.message.includes("scheduled_messages")
        ? "Agendamento depende da migração 0014 — rode supabase/migrations/0014_tempo_real_agendadas.sql no SQL Editor."
        : error.message,
    };
  }

  revalidatePath("/chat");
  return { ok: true };
}

export async function cancelarMensagemAgendada(
  agendadaId: string,
  leadId: string,
): Promise<ResultadoEnvio> {
  const perfil = await perfilAtual();
  if (!perfil) return { erro: "Sessão expirada. Entre novamente." };
  if (!agendadaId) return { erro: "Agendamento não informado." };

  const supabase = await createClient();
  // Remove pendentes e também registros de falha (para limpar o aviso).
  const { error } = await supabase
    .from("scheduled_messages")
    .delete()
    .eq("id", agendadaId)
    .or("enviado_em.is.null,erro.not.is.null");
  if (error) return { erro: error.message };

  revalidatePath("/chat");
  revalidatePath(`/leads/${leadId}`);
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

/**
 * Adia a conversa: sai da caixa de entrada até o lead responder (o webhook
 * de mensagem recebida limpa a marca), ou até alguém trazer de volta à mão.
 */
export async function adiarConversa(leadId: string): Promise<ResultadoEnvio> {
  const perfil = await perfilAtual();
  if (!perfil) return { erro: "Sessão expirada. Entre novamente." };
  if (!leadId) return { erro: "Lead não informado." };

  const supabase = await createClient();
  const agora = new Date().toISOString();
  const { error } = await supabase
    .from("leads")
    .update({ chat_adiado_em: agora, chat_lido_em: agora })
    .eq("id", leadId);
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
    conteudo: "Conversa adiada até a próxima resposta do lead",
    autor_id: perfil.id,
    metadados: { via: "crm" },
  });

  revalidatePath("/chat");
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
  const { error } = await supabase
    .from("leads")
    .update({ chat_adiado_em: null })
    .eq("id", leadId);
  if (error) return { erro: error.message };

  revalidatePath("/chat");
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

  revalidatePath("/chat");
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
        metadados: { via: "crm", em_massa: true },
      })),
    );
  }

  revalidatePath("/chat");
  return { ok: true, total: ids.length };
}

export async function adiarConversasEmMassa(leadIds: string[]) {
  const agora = new Date().toISOString();
  return emMassa(
    leadIds,
    { chat_adiado_em: agora, chat_lido_em: agora },
    "Conversa adiada até a próxima resposta do lead",
  );
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

  revalidatePath("/chat");
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
