"use server";

import { createClient, createServiceClient } from "@/lib/supabase/server";
import {
  idDaSessao,
  perfilAtivo,
  perfilQueEscreve,
  perfilAtual,
} from "@/lib/auth";
import { formatarData } from "@/lib/format";
import { ehGestao } from "@/lib/papeis";
import { registrarAcesso } from "@/lib/auditoria";
import {
  ehIdWhatsApp,
  enviarMidiaMeta,
  enviarTemplateMeta,
  enviarTextoMeta,
  listarTemplatesMeta,
  metaConfigurada,
  MetaSemResposta,
} from "@/lib/whatsapp";
import {
  descreverErroInstagram,
  enviarMidiaInstagram,
  enviarTextoInstagram,
} from "@/lib/instagram";
import {
  formaDeEnvio,
  tipoOficial,
  TETO_LEGENDA_WHATSAPP,
  type CanalDoAnexo,
  type FormaDeEnvio,
} from "@/lib/formato-anexo";
import {
  canalDaResposta,
  ehTipoMensagem,
  ehUuid,
  paraMensagem,
  recebidaPeloDirect,
  type RespostaCitada,
} from "./mensagem";
import {
  regravarInteracao,
  retratoDaCitada,
  type Gravacao,
  type InteracaoPorIdMeta,
  type LinhaParaGravar,
  type MetadadosBrutos,
  type RespostaAGravada,
} from "./metadados";
import type { LinhaRealtime } from "./tempo-real";
import { textoDoFim, type NotaRecontato } from "./recontato";
import { pendentesDoLead } from "./recontato-dados";
import {
  donoOculto,
  donosOcultosParaMim,
  podeVerLead,
} from "@/lib/privacidade";
import { filtroDonosOcultos } from "@/app/(app)/contatos/consulta";

/*
 * Nenhuma action deste arquivo chama revalidatePath: no Next 16, qualquer
 * revalidatePath dentro de uma action faz o servidor renderizar de novo a
 * página atual — o /chat inteiro — e mandar junto da resposta, seja qual
 * for o caminho pedido. A tela reconcilia o estado local com o que a action
 * devolve, e o Realtime cobre o resto.
 */

const MAX_ANEXOS = 5;
const MAX_TAMANHO_ANEXO = 16 * 1024 * 1024; // teto do WhatsApp para mídia
const BUCKET_MIDIA = "midia-whatsapp";

/** Compliance (só leitura) ou sessão vencida: as duas caem aqui. */
const SEM_PERMISSAO =
  "Sem permissão para alterar: o perfil é só de leitura ou a sessão expirou.";

/** A mesma resposta do contato que não existe: quem não pode ver a
 *  conversa (RLS ou privacidade entre a equipe) não fica sabendo dela. */
const NAO_ENCONTRADO = "Contato não encontrado.";

/**
 * A guarda de privacidade de toda action que lê ou grava num lead
 * (Administração > Privacidade, lib/privacidade.ts). Devolve o erro para a
 * tela, ou null quando a pessoa vê a conversa. Regra que não carregou é
 * erro, não passe livre: liberar mostraria o que ela esconde.
 */
async function acessoAoLead(leadId: string): Promise<string | null> {
  try {
    return (await podeVerLead(leadId)) ? null : NAO_ENCONTRADO;
  } catch {
    return "Não deu para conferir o acesso a esta conversa. Tente de novo.";
  }
}

/**
 * Das conversas pedidas (ações em massa), só as que a pessoa vê: o RLS
 * decide quais voltam e a privacidade tira as dos donos ocultos. null = a
 * leitura falhou e nada é feito.
 */
async function idsVisiveis(
  supabase: ClienteSupabase,
  ids: string[],
): Promise<string[] | null> {
  try {
    const [ocultos, { data, error }] = await Promise.all([
      donosOcultosParaMim(),
      supabase.from("leads").select("id, responsavel_id").in("id", ids),
    ]);
    if (error) return null;
    return ((data ?? []) as { id: string; responsavel_id: string | null }[])
      .filter((l) => !donoOculto(l.responsavel_id, ocultos))
      .map((l) => l.id);
  } catch {
    return null;
  }
}

type AnexoRemoto = {
  caminho: string;
  nome: string;
  tipo: string;
  tamanho: number;
  /** Escolhido em "Documento" no compositor: vai como arquivo, não foto. */
  documento?: boolean;
};

/**
 * URL assinada para o anexo subir DIRETO do navegador ao Storage — o corpo
 * da requisição na Vercel tem teto de ~4,5MB e derrubava a página; por aqui
 * vale o teto real do WhatsApp (16MB por arquivo).
 */
export async function prepararUploadAnexo(
  nome: string,
): Promise<{ caminho?: string; token?: string; erro?: string }> {
  const perfil = await perfilQueEscreve();
  if (!perfil) return { erro: SEM_PERMISSAO };

  const limpo = nome.replace(/[^\w.\-]+/g, "_").slice(-80);
  const caminho = `envios/${crypto.randomUUID()}-${limpo}`;
  const service = createServiceClient();
  const { data, error } = await service.storage
    .from(BUCKET_MIDIA)
    .createSignedUploadUrl(caminho);
  if (error) {
    return { erro: `O upload não começou: ${error.message}` };
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

/**
 * Como o anexo sai no canal, pela mesma regra que a prévia do compositor
 * mostra (lib/formato-anexo.ts). Mídia é lista exata, não prefixo: "qualquer
 * image/*" mandava o webp copiado do navegador como imagem, a Meta recusava
 * e a mensagem de erro culpava a janela de 24h.
 */
function formaDoAnexo(
  arquivo: File,
  anexo: AnexoRemoto,
  canal: CanalDoAnexo,
): FormaDeEnvio {
  return formaDeEnvio(
    {
      tipo: arquivo.type,
      nome: arquivo.name,
      tamanho: arquivo.size,
      documento: anexo.documento === true,
    },
    canal,
  );
}

/** O arquivo com o MIME oficial, que é o que a Meta confere no upload. */
function comTipoOficial(arquivo: File): File {
  const tipo = tipoOficial(arquivo.type, arquivo.name);
  return tipo === arquivo.type
    ? arquivo
    : new File([arquivo], arquivo.name, { type: tipo });
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
  /** O perfil de quem escreveu: a bolha confirmada já sai com a foto. */
  autorId?: string | null;
  anexos: { tipo: string; url: string; nome?: string | null }[];
  /** A mensagem citada pelo "responder", para a bolha confirmada já sair
   *  com a citação (sem esperar o tempo real). */
  respostaA?: RespostaCitada | null;
};

export type ResultadoEnvio = {
  ok?: boolean;
  erro?: string;
  interacao?: InteracaoCriada;
  /** Contato do envio (envio e template): a tela confere que a resposta é
   *  da conversa que ainda está em cena antes de resolver e seguir. */
  leadId?: string;
  /** Só na falha parcial (erro junto de interacao): quantos anexos, na
   *  ordem em que foram anexados, chegaram ao contato. O texto, se havia,
   *  chegou. Na caixa voltam só arquivos.slice(anexosEnviados). */
  anexosEnviados?: number;
  /** O envio tornou quem enviou o dono da conversa (ela estava sem dono). */
  assumiu?: boolean;
  /** Pedido com resolver=1 ("Enviar e resolver"): true = a conversa já
   *  saiu resolvida neste envio, e a tela só reflete e segue para a
   *  próxima, sem chamar alterarStatusConversaChat de novo (duplicaria a
   *  nota no histórico). false = a mensagem saiu e a marca não gravou: o
   *  motivo vem em `aviso`. Ausente quando não se pediu. */
  resolvida?: boolean;
  /** Algo DEPOIS do envio falhou (resolver). Não é erro do envio: a tela
   *  não devolve o texto para a caixa, só mostra o aviso. */
  aviso?: string;
  /** Template mandado pela faixa do recontato: a nota de fim que marcou o
   *  recontato como feito, para a conversa tirar a faixa na hora. */
  recontatoFeito?: NotaRecontato;
};

type ClienteSupabase = Awaited<ReturnType<typeof createClient>>;

/**
 * Envio que estourou o prazo sem resposta da Meta. Não é recusa: pode ter
 * chegado ao cliente sem o wamid voltar, e por isso não entra no histórico.
 * O texto não manda repetir nem trocar por template, o que duplicaria a
 * mensagem para o cliente.
 */
function semRespostaDoEnvio(doQue: string): string {
  return `A Meta não respondeu a tempo ao envio ${doQue}, que pode ter chegado ao cliente mesmo sem aparecer no histórico. Reenviar pode duplicar.`;
}

/**
 * Responder é tratar a conversa: além de marcar lida, ENCERRA o adiamento.
 *
 * chat_adiado_em nunca é limpo pelo tempo — só pela resposta do lead. Sem
 * isto, a conversa que voltou do adiamento e foi respondida continuava
 * marcada como "adiada · prazo venceu" e sedimentava na Caixa para sempre,
 * inflando o contador do trilho.
 */
async function encerrarAdiamentoAoResponder(
  supabase: ClienteSupabase,
  leadId: string,
  agora: string,
  /** "Enviar e resolver": a marca de resolvida sai no mesmo update. */
  resolver = false,
): Promise<boolean> {
  const { error } = await supabase
    .from("leads")
    .update({
      ultima_interacao_em: agora,
      chat_lido_em: agora,
      chat_adiado_em: null,
      chat_adiado_ate: null,
      ...(resolver ? { chat_resolvido_em: agora } : {}),
    })
    .eq("id", leadId);
  return !error;
}

/**
 * A última mensagem do contato veio pelo Direct? null quando ele nunca
 * escreveu ou a leitura falhou: o canal cai na regra do telefone.
 */
async function ultimaRecebidaPeloDirect(
  supabase: ClienteSupabase,
  leadId: string,
): Promise<boolean | null> {
  const { data } = await supabase
    .from("lead_interactions")
    .select("metadados")
    .eq("lead_id", leadId)
    .eq("tipo", "mensagem_recebida")
    .order("criado_em", { ascending: false })
    .limit(1)
    .maybeSingle();
  if (!data) return null;
  return recebidaPeloDirect(
    (data as { metadados: { canal?: string; igsid?: string } | null })
      .metadados,
  );
}

/** O que o envio precisa saber do contato: para onde mandar e se tem dono. */
async function leadComConversa(supabase: ClienteSupabase, leadId: string) {
  const { data } = await supabase
    .from("leads")
    .select(
      "id, nome, telefone_e164, instagram_id, instagram_usuario, responsavel_id",
    )
    .eq("id", leadId)
    .maybeSingle();
  return data as {
    id: string;
    nome: string;
    telefone_e164: string | null;
    instagram_id: string | null;
    instagram_usuario: string | null;
    responsavel_id: string | null;
  } | null;
}

/**
 * Quem fala com o lead, assume — quando ele não tem dono.
 *
 * Caixa compartilhada: sem isto, a conversa respondida por alguém seguia
 * "sem dono", e a resposta do contato caía numa fila de ninguém. Conversa
 * que JÁ tem dono não muda de mãos por uma mensagem: trocar o atendente é
 * gesto explícito (atribuir).
 *
 * O update é condicional (responsavel_id ainda nulo): dois atendentes
 * mandando ao mesmo tempo, só o primeiro assume. Devolve se ESTA chamada
 * assumiu. O mesmo update serve ao "Assumir" do cabeçalho (assumirConversa),
 * que grava o histórico sem a marca de automático.
 */
async function assumirSeSemDono(
  supabase: ClienteSupabase,
  leadId: string,
  perfil: { id: string; nome: string },
  automatico = true,
): Promise<boolean> {
  const { data } = await supabase
    .from("leads")
    .update({ responsavel_id: perfil.id })
    .eq("id", leadId)
    .is("responsavel_id", null)
    .select("id");
  if (!data?.length) return false;
  await supabase.from("lead_interactions").insert({
    lead_id: leadId,
    tipo: "atribuicao",
    conteudo: automatico
      ? `Atendimento assumido por ${perfil.nome} ao falar com o lead`
      : `Atendimento assumido por ${perfil.nome}`,
    autor_id: perfil.id,
    metadados: automatico
      ? { via: "crm", sistema: true, automatico: true }
      : { via: "crm", sistema: true },
  });
  return true;
}

/** Quem atende a conversa. */
export type DonoConversa = { id: string; nome: string };

/**
 * Resultado do "Assumir": `ok` com o dono (quem chamou, inclusive quando a
 * conversa já era dela), ou `erro`. Quando outra pessoa assumiu antes, o
 * erro diz o nome e `dono` traz quem é, para a tela refletir o dono real.
 */
export type ResultadoAssumir =
  | { ok: true; dono: DonoConversa }
  | { ok?: false; erro: string; dono?: DonoConversa };

/**
 * Assumir a conversa sem precisar responder: botão no cabeçalho, ação da
 * linha da fila e tecla A. O mesmo update condicional do assumir ao
 * responder: duas pessoas no mesmo segundo, o banco decide e a segunda
 * recebe "Ana assumiu antes." em vez de passar por cima.
 *
 * Quem não enxerga conversa sem dono (atendente, pelo RLS) não consegue o
 * update e recebe o erro de permissão.
 */
export async function assumirConversa(
  leadId: string,
): Promise<ResultadoAssumir> {
  const perfil = await perfilQueEscreve();
  if (!perfil) return { erro: SEM_PERMISSAO };
  if (!leadId) return { erro: "Conversa não informada." };
  const negado = await acessoAoLead(leadId);
  if (negado) return { erro: negado };

  const supabase = await createClient();
  const eu = { id: perfil.id, nome: perfil.nome };
  if (await assumirSeSemDono(supabase, leadId, perfil, false)) {
    return { ok: true, dono: eu };
  }

  // Não assumiu: ou alguém chegou antes, ou já era desta pessoa, ou o RLS
  // não deixa. A leitura do dono atual separa os três.
  const { data, error } = await supabase
    .from("leads")
    .select("responsavel_id, responsavel:profiles(nome)")
    .eq("id", leadId)
    .maybeSingle();
  if (error) return { erro: "A conversa não foi assumida. Tente de novo." };
  const lead = data as unknown as {
    responsavel_id: string | null;
    responsavel: { nome: string } | null;
  } | null;
  if (!lead) return { erro: "Contato não encontrado." };
  if (lead.responsavel_id === perfil.id) return { ok: true, dono: eu };
  if (lead.responsavel_id) {
    const nome = lead.responsavel?.nome ?? "Outra pessoa";
    return {
      erro: `${nome} assumiu antes.`,
      dono: { id: lead.responsavel_id, nome },
    };
  }
  // Segue sem dono: o update falhou no caminho (o RLS de quem não enxerga
  // conversa sem dono já parou na leitura acima).
  return { erro: "A conversa não foi assumida. Tente de novo." };
}

/**
 * Materializa os anexos do Storage (o navegador subiu direto) para os
 * canais de envio — todos ao mesmo tempo, não um atrás do outro.
 */
async function baixarAnexos(
  anexos: AnexoRemoto[],
): Promise<{ arquivos: File[] } | { erro: string }> {
  if (anexos.length === 0) return { arquivos: [] };
  const service = createServiceClient();
  const baixados = await Promise.all(
    anexos.map((anexo) =>
      service.storage.from(BUCKET_MIDIA).download(anexo.caminho),
    ),
  );
  const arquivos: File[] = [];
  for (const [i, { data, error }] of baixados.entries()) {
    const anexo = anexos[i];
    if (error || !data) {
      return {
        erro: `O anexo "${anexo.nome}" não está mais no armazenamento. Anexe de novo.`,
      };
    }
    arquivos.push(
      new File([data], anexo.nome, {
        type: anexo.tipo || "application/octet-stream",
      }),
    );
  }
  return { arquivos };
}

function ehObjeto(v: unknown): v is MetadadosBrutos {
  return typeof v === "object" && v !== null && !Array.isArray(v);
}

/** O id da Meta gravado na interação (wamid ou mid), ou null. */
function idMetaDe(metadados: MetadadosBrutos): string | null {
  const id = metadados.message_id;
  return typeof id === "string" && id ? id : null;
}

/**
 * A mensagem citada pelo "responder", lida com a sessão e só desta conversa.
 * A citação é ajuda, não condição: citada que sumiu, foi apagada ou é linha
 * de sistema deixa a mensagem sair sem ela.
 */
async function lerCitada(
  supabase: ClienteSupabase,
  leadId: string,
  citadaId: string,
): Promise<InteracaoPorIdMeta | null> {
  const { data } = await supabase
    .from("lead_interactions")
    .select("id, tipo, conteudo, criado_em, metadados, autor:profiles(nome)")
    .eq("id", citadaId)
    .eq("lead_id", leadId)
    .maybeSingle();
  if (!data) return null;
  const bruta = data as {
    id: string;
    tipo: string;
    conteudo: string | null;
    criado_em: string;
    metadados: unknown;
    autor: { nome: string } | { nome: string }[] | null;
  };
  if (!ehTipoMensagem(bruta.tipo)) return null;
  const metadados = ehObjeto(bruta.metadados) ? bruta.metadados : {};
  if (metadados.apagada || metadados.sistema === true) return null;
  const autor = Array.isArray(bruta.autor) ? (bruta.autor[0] ?? null) : bruta.autor;
  return {
    id: bruta.id,
    tipo: bruta.tipo,
    conteudo: bruta.conteudo,
    criado_em: bruta.criado_em,
    metadados,
    autor: autor ?? null,
  };
}

/** O retrato que vai em metadados.resposta_a, com o id da Meta da citada
 *  (sem ele, a tela acha a citada pela nossa linha). */
function retratoParaGravar(
  citada: InteracaoPorIdMeta,
  nomeContato: string | null,
): RespostaAGravada {
  const idMeta = idMetaDe(citada.metadados);
  return { ...retratoDaCitada(citada, idMeta ?? "", nomeContato), id: idMeta };
}

/** O retrato gravado no formato da tela, pela mesma leitura da bolha. */
function retratoParaTela(retrato: RespostaAGravada): RespostaCitada | null {
  return (
    paraMensagem({
      id: "",
      tipo: "nota",
      conteudo: null,
      criado_em: "",
      metadados: { resposta_a: retrato },
    }).respostaA ?? null
  );
}

export async function enviarMensagemLead(
  _estado: ResultadoEnvio,
  formData: FormData,
): Promise<ResultadoEnvio> {
  const perfil = await perfilQueEscreve();
  if (!perfil) return { erro: SEM_PERMISSAO };

  const leadId = String(formData.get("lead_id") ?? "");
  const textoBruto = String(formData.get("texto") ?? "").trim();
  const modo = formData.get("modo") === "nota" ? "nota" : "responder";
  const assinar = formData.get("assinar") === "1";
  // O "responder": a interação citada (a nossa linha, não o id da Meta).
  const citadaBruta = String(formData.get("responder_a") ?? "");
  const citadaId = ehUuid(citadaBruta) ? citadaBruta : null;
  // "Enviar e resolver": só resposta ao contato resolve; nota privada não.
  const resolver = modo === "responder" && formData.get("resolver") === "1";
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

  // Tudo o que se valida sem rede vem antes de baixar qualquer arquivo.
  if (!leadId) return { erro: "Conversa não informada." };
  if (!textoBruto && anexosRemotos.length === 0) {
    return {
      erro:
        modo === "nota"
          ? "Escreva a nota."
          : "Escreva a mensagem ou anexe um arquivo.",
    };
  }
  if (textoBruto.length > 4096) {
    return { erro: "Mensagem longa demais: o limite é 4.096 caracteres." };
  }
  if (anexosRemotos.length > MAX_ANEXOS) {
    return { erro: `No máximo ${MAX_ANEXOS} anexos por mensagem.` };
  }

  const supabase = await createClient();
  // A privacidade corre junto das leituras e é conferida antes de qualquer
  // gravação ou envio.
  const acesso = acessoAoLead(leadId);
  const citadaLida = citadaId
    ? lerCitada(supabase, leadId, citadaId).catch(() => null)
    : Promise.resolve(null);

  // Nota privada: só equipe vê. Vive apenas no histórico — não há para onde
  // espelhar (a Meta não tem nota privada). O insert já barra contato
  // inexistente ou fora do alcance (chave estrangeira e RLS).
  if (modo === "nota") {
    const [negado, citada] = await Promise.all([acesso, citadaLida]);
    if (negado) return { erro: negado };
    // A nota que cita a mensagem do contato leva o nome dele no retrato.
    let retrato: RespostaAGravada | null = null;
    if (citada) {
      let nomeContato: string | null = null;
      if (citada.tipo === "mensagem_recebida") {
        const { data } = await supabase
          .from("leads")
          .select("nome")
          .eq("id", leadId)
          .maybeSingle();
        nomeContato = (data as { nome: string } | null)?.nome ?? null;
      }
      retrato = retratoParaGravar(citada, nomeContato);
    }
    const { data: notaCriada, error } = await supabase
      .from("lead_interactions")
      .insert({
        lead_id: leadId,
        tipo: "nota",
        conteudo: textoBruto,
        autor_id: perfil.id,
        metadados: { via: "crm", ...(retrato ? { resposta_a: retrato } : {}) },
      })
      .select("id, criado_em")
      .maybeSingle();
    if (error) return { erro: "A nota não foi salva. Tente de novo." };

    // A Janela recebe a nota criada e coloca no histórico local. Sem a
    // linha de volta (não deveria acontecer), o eco do Realtime a mostra.
    return {
      ok: true,
      leadId,
      ...(notaCriada
        ? {
            interacao: {
              id: notaCriada.id as string,
              tipo: "nota" as const,
              conteudo: textoBruto,
              criado_em: notaCriada.criado_em as string,
              autor: perfil.nome,
              autorId: perfil.id,
              anexos: [],
              respostaA: retrato ? retratoParaTela(retrato) : null,
            },
          }
        : {}),
    };
  }

  // O contato, os arquivos do Storage e a última mensagem recebida (que
  // decide o canal) não dependem um do outro: chegam juntos.
  const [lead, baixados, pelaDirect, negado, citada] = await Promise.all([
    leadComConversa(supabase, leadId),
    baixarAnexos(anexosRemotos),
    ultimaRecebidaPeloDirect(supabase, leadId),
    acesso,
    citadaLida,
  ]);
  if (negado) return { erro: negado };
  if (!lead) return { erro: "Contato não encontrado." };
  if ("erro" in baixados) return { erro: baixados.erro };
  const arquivos = baixados.arquivos;
  const retrato = citada ? retratoParaGravar(citada, lead.nome) : null;

  // A assinatura vai no formato de negrito do WhatsApp.
  const texto =
    assinar && textoBruto ? `*${perfil.nome}:*\n${textoBruto}` : textoBruto;
  const grande = arquivos.find((a) => a.size > MAX_TAMANHO_ANEXO);
  if (grande) {
    return { erro: `"${grande.name}" passa de 16 MB, o limite do WhatsApp.` };
  }

  // Só wamid da Meta ou id do Direct — o id numérico do Chatwoot acabou.
  const wamids: string[] = [];
  // O que de fato chegou ao contato: o texto e quantos arquivos, na ordem.
  // Cada arquivo é um envio próprio; se um falha no meio, os anteriores JÁ
  // chegaram, e o registro conta o que foi em vez de fingir que nada saiu
  // (o reenvio duplicava texto e arquivos para o cliente).
  let textoEnviado = false;
  let arquivosEnviados = 0;
  let falhaParcial: string | null = null;
  // Arquivo cujo envio ficou sem resposta da Meta: pode ter chegado, então
  // o aviso não pode mandar reenviar.
  let semRespostaDe: string | null = null;
  const motivoDe = (e: unknown) => (e instanceof Error ? e.message : String(e));

  // O canal é decidido POR CONTATO, pela regra de canalDaResposta: a pessoa
  // é respondida onde escreveu por último. A mensagem do Direct sai pelo
  // perfil do Instagram do negócio, e o CRM guarda em autor_id quem de
  // fato respondeu.
  const viaInstagram =
    canalDaResposta(
      {
        temTelefone: Boolean(lead.telefone_e164),
        temDirect: Boolean(lead.instagram_id),
      },
      pelaDirect,
    ) === "instagram";

  if (viaInstagram && lead.instagram_id) {
    const igsid = lead.instagram_id;
    const service = createServiceClient();
    if (texto) {
      try {
        const id = await enviarTextoInstagram(igsid, texto);
        if (id) wamids.push(id);
        textoEnviado = true;
      } catch (e) {
        return { erro: descreverErroInstagram(motivoDe(e)) };
      }
    }
    for (const [i, anexo] of anexosRemotos.entries()) {
      const forma = formaDoAnexo(arquivos[i], anexo, "instagram");
      const url = service.storage
        .from(BUCKET_MIDIA)
        .getPublicUrl(anexo.caminho).data.publicUrl;
      try {
        // O Direct leva foto, vídeo e áudio nos formatos da doc da Meta
        // (o áudio gravado no compositor sai em wav); o resto vai como
        // link, do mesmo jeito que no WhatsApp.
        const id =
          forma === "foto"
            ? await enviarMidiaInstagram(igsid, url, "image")
            : forma === "video" || forma === "audio"
              ? await enviarMidiaInstagram(igsid, url, forma)
              : await enviarTextoInstagram(igsid, `📎 ${anexo.nome}\n${url}`);
        if (id) wamids.push(id);
        arquivosEnviados++;
      } catch (e) {
        const motivo = descreverErroInstagram(motivoDe(e));
        if (!textoEnviado && arquivosEnviados === 0) return { erro: motivo };
        falhaParcial = `"${anexo.nome}" (${motivo})`;
        break;
      }
    }
  } else {
    // A Meta é o único canal de WhatsApp: sem ela configurada não existe
    // fallback (o Chatwoot saiu) — erro claro em vez de exceção na tela.
    if (!metaConfigurada()) {
      return { erro: "WhatsApp (Meta) não configurado." };
    }
    if (!lead.telefone_e164) {
      return {
        erro: "Este contato não tem telefone para WhatsApp. Preencha o número na ficha do contato.",
      };
    }
    const telefone = lead.telefone_e164;
    // A citação vai no context da PRIMEIRA mensagem que sair (o texto ou o
    // primeiro anexo). Só wamid entra: citada do Direct ou sem id da Meta
    // fica só no Atendimento.
    let citarNoWhatsApp =
      retrato && ehIdWhatsApp(retrato.id) ? retrato.id : null;
    if (arquivos.length > 0) {
      const servicoLink = createServiceClient();
      const formas = arquivos.map((a, i) =>
        formaDoAnexo(a, anexosRemotos[i], "whatsapp"),
      );
      // O que o WhatsApp não entrega (null) vai como link.
      const prontos = arquivos.map((a, i) =>
        formas[i] === "link" ? null : comTipoOficial(a),
      );
      // O texto vai como legenda do primeiro anexo (o compositor põe na
      // frente a primeira foto ou vídeo, ou o documento). Áudio não leva
      // legenda (a Meta descarta calada) e a legenda tem teto de 1.024
      // caracteres: nesses casos o texto sai antes, sozinho. Antes ele
      // sumia e o histórico dizia que tinha ido.
      let legendaPendente: string | undefined = texto || undefined;
      if (
        legendaPendente &&
        prontos[0] &&
        (formas[0] === "audio" || legendaPendente.length > TETO_LEGENDA_WHATSAPP)
      ) {
        try {
          const id = await enviarTextoMeta(telefone, legendaPendente, {
            responderA: citarNoWhatsApp,
          });
          if (id) wamids.push(id);
          textoEnviado = true;
          legendaPendente = undefined;
          citarNoWhatsApp = null;
        } catch (e) {
          if (e instanceof MetaSemResposta) {
            return { erro: semRespostaDoEnvio("da mensagem") };
          }
          return { erro: `A Meta recusou o envio: ${motivoDe(e)}` };
        }
      }
      for (const [i, arquivo] of arquivos.entries()) {
        const legenda = legendaPendente;
        const pronto = prontos[i];
        try {
          if (pronto) {
            const id = await enviarMidiaMeta(telefone, pronto, legenda, {
              responderA: citarNoWhatsApp,
            });
            if (id) wamids.push(id);
          } else {
            // Formato que o WhatsApp não entrega como arquivo (indicador
            // .psf, webp, .mov, foto acima de 5 MB): manda o link de
            // download do Storage, que o cliente abre e baixa. O arquivo já
            // subiu para lá ao anexar, e a prévia avisou.
            const url = servicoLink.storage
              .from(BUCKET_MIDIA)
              .getPublicUrl(anexosRemotos[i].caminho).data.publicUrl;
            const corpo = `${legenda ? `${legenda}\n\n` : ""}📎 ${arquivo.name}\n${url}`;
            const id = await enviarTextoMeta(telefone, corpo, {
              responderA: citarNoWhatsApp,
            });
            if (id) wamids.push(id);
          }
          citarNoWhatsApp = null;
          arquivosEnviados++;
          if (legenda) {
            textoEnviado = true;
            legendaPendente = undefined;
          }
        } catch (e) {
          if (e instanceof MetaSemResposta) semRespostaDe = arquivo.name;
          falhaParcial = `"${arquivo.name}" (${motivoDe(e)})`;
          break;
        }
      }
      // Nada chegou: erro comum, a tela devolve texto e anexos à caixa. A
      // recusa por janela fechada não vem aqui (chega depois, pelo recibo
      // 131047): o aviso não manda usar template.
      if (falhaParcial && !textoEnviado && arquivosEnviados === 0) {
        if (semRespostaDe) {
          return {
            erro: `${semRespostaDoEnvio(`de "${semRespostaDe}"`)}${arquivos.length > 1 ? " Os outros anexos não foram enviados." : ""}`,
          };
        }
        return { erro: `A Meta recusou o envio de ${falhaParcial}.` };
      }
    } else {
      try {
        const id = await enviarTextoMeta(telefone, texto, {
          responderA: citarNoWhatsApp,
        });
        if (id) wamids.push(id);
        textoEnviado = true;
      } catch (e) {
        if (e instanceof MetaSemResposta) {
          return { erro: semRespostaDoEnvio("da mensagem") };
        }
        return { erro: `A Meta recusou o envio: ${motivoDe(e)}` };
      }
    }
  }

  const mensagemId = wamids[wamids.length - 1] ?? null;

  // Os anexos ficam no histórico com a URL pública do Storage (o navegador
  // subiu direto para lá), só os que chegaram.
  let anexos: { tipo: string; nome: string; url: string }[] = [];
  if (arquivosEnviados > 0) {
    const service = createServiceClient();
    anexos = anexosRemotos.slice(0, arquivosEnviados).map((a) => ({
      tipo: tipoDoArquivo(a.tipo || ""),
      nome: a.nome,
      url: service.storage.from(BUCKET_MIDIA).getPublicUrl(a.caminho).data
        .publicUrl,
    }));
  }

  // Sem texto, o histórico guarda o rótulo do primeiro anexo como prévia.
  // Envio parcial registra quantos arquivos de fato chegaram.
  const conteudo =
    texto ||
    (arquivos.length > 0
      ? (anexosRemotos[0]?.nome ??
          ROTULO_TIPO[tipoDoArquivo(arquivos[0].type)] ??
          "[arquivo]") +
        (arquivos.length > 1 ? ` (${arquivosEnviados}/${arquivos.length})` : "")
      : texto);

  const agora = new Date().toISOString();
  // Falha parcial nunca resolve: falta arquivo para o contato.
  const resolverAgora = resolver && !falhaParcial;

  // A Meta já aceitou: registrar, encerrar o adiamento (e resolver, no
  // "Enviar e resolver") e assumir a conversa sem dono não dependem um do
  // outro — saem juntos.
  const [{ data: criada }, marcou, assumiu] = await Promise.all([
    supabase
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
          ...(retrato ? { resposta_a: retrato } : {}),
        },
      })
      .select("id, criado_em")
      .maybeSingle(),
    encerrarAdiamentoAoResponder(supabase, leadId, agora, resolverAgora),
    // Mesma regra do template: quem escreve para um lead sem dono, assume.
    lead.responsavel_id
      ? Promise.resolve(false)
      : assumirSeSemDono(supabase, leadId, perfil),
  ]);

  // A nota de sistema entra DEPOIS da mensagem, para o histórico mostrar
  // a resposta e só então "Conversa resolvida".
  if (resolverAgora && marcou) {
    await supabase.from("lead_interactions").insert({
      lead_id: leadId,
      tipo: "nota",
      conteudo: "Conversa resolvida",
      autor_id: perfil.id,
      metadados: { via: "crm", sistema: true },
    });
  }

  // A Janela recebe a interação criada e reconcilia no estado local (o eco
  // do Realtime é ignorado pelo id). Se o insert não devolveu a linha (não
  // deveria), o próprio eco do Realtime põe a mensagem na tela.
  // A interação volta mesmo com falha parcial: os anexos que chegaram JÁ
  // estão no histórico — a tela precisa mostrá-los junto do aviso.
  const base: ResultadoEnvio = {
    leadId,
    ...(assumiu ? { assumiu: true } : {}),
    ...(criada
      ? {
          interacao: {
            id: criada.id as string,
            tipo: "mensagem_enviada" as const,
            conteudo,
            criado_em: criada.criado_em as string,
            autor: perfil.nome,
            autorId: perfil.id,
            anexos,
            respostaA: retrato ? retratoParaTela(retrato) : null,
          },
        }
      : {}),
  };

  if (falhaParcial) {
    const chegou = [
      textoEnviado ? "o texto" : null,
      arquivosEnviados > 0
        ? `${arquivosEnviados} de ${arquivos.length} anexos`
        : null,
    ]
      .filter(Boolean)
      .join(" e ");
    const depois = arquivos.length - arquivosEnviados - 1;
    const seguintes =
      depois > 0
        ? ` Depois dele, ${depois === 1 ? "1 anexo ficou" : `${depois} anexos ficaram`} sem enviar.`
        : "";
    return {
      ...base,
      erro: semRespostaDe
        ? `Já chegaram ao contato: ${chegou}. ${semRespostaDoEnvio(`de "${semRespostaDe}"`)}${seguintes}`
        : `Já chegaram ao contato: ${chegou}. Não saiu ${falhaParcial}.${seguintes}`,
      anexosEnviados: arquivosEnviados,
    };
  }
  if (resolver) {
    return {
      ...base,
      ok: true,
      resolvida: marcou,
      ...(marcou
        ? {}
        : {
            aviso:
              "A mensagem saiu, mas a conversa não ficou resolvida. Resolva de novo.",
          }),
    };
  }
  return { ...base, ok: true };
}

/**
 * Dispara um template aprovado do WhatsApp — o único canal permitido fora
 * da janela de 24h. As variáveis vêm como campos `param_<token>`.
 */
export async function enviarTemplateLead(
  _estado: ResultadoEnvio,
  formData: FormData,
): Promise<ResultadoEnvio> {
  const perfil = await perfilQueEscreve();
  if (!perfil) return { erro: SEM_PERMISSAO };

  const leadId = String(formData.get("lead_id") ?? "");
  const nome = String(formData.get("template_nome") ?? "");
  const idioma = String(formData.get("template_idioma") ?? "");
  // Aberto pela faixa do recontato: o envio marca o recontato como feito.
  const recontatoId = String(formData.get("recontato_id") ?? "");
  if (!leadId || !nome) return { erro: "Escolha um template." };

  // Guarda antes de listar: sem a Meta a lista viria vazia e o usuário veria
  // "template não encontrado" — o problema real é outro e merece nome.
  if (!metaConfigurada()) {
    return { erro: "WhatsApp (Meta) não configurado." };
  }

  // A lista de templates (com cache), o contato e a privacidade chegam
  // juntos.
  const supabase = await createClient();
  const [listagem, lead, negado] = await Promise.all([
    listarTemplatesMeta().then(
      (templates) => ({ templates, erro: null }),
      (e: unknown) => ({
        templates: [],
        erro: e instanceof Error ? e.message : String(e),
      }),
    ),
    leadComConversa(supabase, leadId),
    acessoAoLead(leadId),
  ]);
  if (negado) return { erro: negado };
  if (!lead) return { erro: "Contato não encontrado." };
  // Na Meta o template abre conversa direto: só precisa do telefone. O
  // Instagram não tem template: no contato só do Direct, a resposta espera
  // a pessoa escrever de novo (o mesmo texto da janela vencida do Direct).
  if (!lead.telefone_e164) {
    return {
      erro: lead.instagram_id
        ? "O Instagram não tem template: no Direct, só dá para responder quando a pessoa escrever de novo."
        : "Template só sai pelo WhatsApp, e este contato não tem telefone. Preencha o número na ficha do contato.",
    };
  }
  const telefone = lead.telefone_e164;
  if (listagem.erro !== null) {
    return { erro: `Os templates não carregaram: ${listagem.erro}` };
  }
  const template = listagem.templates.find(
    (t) => t.nome === nome && t.idioma === idioma,
  );
  if (!template) return { erro: "Template não encontrado ou não aprovado." };

  const valores: Record<string, string> = {};
  for (const token of template.parametros) {
    const valor = String(formData.get(`param_${token}`) ?? "").trim();
    if (!valor) return { erro: `Preencha a variável {{${token}}}.` };
    valores[token] = valor;
  }

  let mensagemId: string | null = null;
  try {
    mensagemId = await enviarTemplateMeta(telefone, template, valores);
  } catch (e) {
    if (e instanceof MetaSemResposta) {
      return { erro: semRespostaDoEnvio("do template") };
    }
    return {
      erro: `A Meta recusou o template: ${e instanceof Error ? e.message : String(e)}`,
    };
  }

  const conteudo = template.corpo.replace(
    /\{\{\s*([^{}]+?)\s*\}\}/g,
    (bloco, token: string) => valores[token] ?? bloco,
  );
  const agora = new Date().toISOString();

  // A Meta já cobrou: registrar, encerrar o adiamento e assumir saem
  // juntos. Template disparado para um contato sem dono passa a ser de
  // quem disparou — senão a resposta cai numa fila de ninguém.
  const [{ data: criada, error: erroRegistro }, , assumiu] = await Promise.all([
    supabase
      .from("lead_interactions")
      .insert({
        lead_id: leadId,
        tipo: "mensagem_enviada",
        conteudo,
        autor_id: perfil.id,
        metadados: {
          via: "crm",
          template: template.nome,
          message_id: mensagemId,
        },
      })
      .select("id, criado_em")
      .maybeSingle(),
    encerrarAdiamentoAoResponder(supabase, leadId, agora),
    lead.responsavel_id
      ? Promise.resolve(false)
      : assumirSeSemDono(supabase, leadId, perfil),
  ]);
  // Se o registro falhou, a conversa e o contador de templates ficam sem
  // essa linha — o atendente precisa saber.
  if (erroRegistro) {
    return {
      erro: "O template foi enviado, mas não entrou no histórico. Avise a administração antes de mandar outro.",
      leadId,
    };
  }

  // O template da faixa do recontato saiu: o recontato está feito. Falha
  // aqui não é erro do envio (a Meta já entregou): vira aviso, e a faixa
  // fica para o Feito.
  let recontatoFeito: NotaRecontato | null = null;
  if (ehUuid(recontatoId)) {
    recontatoFeito = await fecharRecontatoPeloTemplate(
      supabase,
      leadId,
      recontatoId,
      template.nome,
      perfil,
    );
  }

  return {
    ok: true,
    leadId,
    ...(assumiu ? { assumiu: true } : {}),
    ...(recontatoFeito ? { recontatoFeito } : {}),
    ...(ehUuid(recontatoId) && !recontatoFeito
      ? {
          aviso:
            "O template saiu, mas o recontato continua pendente. Marque como feito na faixa.",
        }
      : {}),
    ...(criada
      ? {
          interacao: {
            id: criada.id as string,
            tipo: "mensagem_enviada" as const,
            conteudo,
            criado_em: criada.criado_em as string,
            autor: perfil.nome,
            autorId: perfil.id,
            anexos: [],
          },
        }
      : {}),
  };
}

/**
 * A nota de fim do recontato que saiu pelo template ({ id, como:
 * "template" }). null quando o recontato já não está pendente ou a nota não
 * gravou.
 */
async function fecharRecontatoPeloTemplate(
  supabase: ClienteSupabase,
  leadId: string,
  id: string,
  template: string,
  perfil: { id: string; nome: string },
): Promise<NotaRecontato | null> {
  const pendentes = await pendentesDoLead(supabase, leadId).catch(() => null);
  const recontato = pendentes?.find((r) => r.id === id);
  if (!recontato) return null;
  const conteudo = textoDoFim("template", recontato.motivo, template);
  const metadados = {
    via: "crm",
    sistema: true,
    recontato_fim: { id, como: "template" },
  };
  const { data, error } = await supabase
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
  if (error || !data) return null;
  return {
    id: data.id as string,
    conteudo,
    criado_em: data.criado_em as string,
    metadados,
    autor: perfil.nome,
  };
}

/** Define (ou remove, com null) o atendente do lead. */
export async function definirResponsavelChat(
  leadId: string,
  responsavelId: string | null,
): Promise<ResultadoEnvio> {
  const perfil = await perfilQueEscreve();
  if (!perfil) return { erro: SEM_PERMISSAO };
  if (!leadId) return { erro: "Conversa não informada." };
  const negado = await acessoAoLead(leadId);
  if (negado) return { erro: negado };

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

  return { ok: true };
}

/** Marca ou desmarca uma etiqueta do lead. */
export async function alternarEtiquetaChat(
  leadId: string,
  tagId: string,
  marcar: boolean,
): Promise<ResultadoEnvio> {
  const perfil = await perfilQueEscreve();
  if (!perfil) return { erro: SEM_PERMISSAO };
  if (!leadId || !tagId) return { erro: "Etiqueta não informada." };
  const negado = await acessoAoLead(leadId);
  if (negado) return { erro: negado };

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

  return { ok: true };
}

/**
 * Motivos de perda (check leads_perda_motivo_chk, 0038 e 0061) em que o
 * próprio contato pediu para parar ou não é quem se procurava: reabrir a
 * conversa não autoriza o disparo em massa de novo.
 */
const MOTIVOS_SEM_MARKETING = ["sem_interesse", "contato_invalido"];

/**
 * Os rótulos dos motivos de perda, os mesmos que a equipe escolheu ao marcar
 * (lib/perda.ts do CRM). Slug fora da lista sai como veio.
 */
const ROTULO_MOTIVO_PERDA: Record<string, string> = {
  sumiu: "Sumiu, parou de responder",
  nunca_respondeu: "Nunca respondeu",
  concorrente: "Fechou com concorrente",
  sem_interesse: "Não quer abrir conta",
  sem_perfil: "Sem capital ou sem perfil agora",
  contato_invalido: "Número errado ou engano",
  outro: "Outro motivo",
};

type Perda = {
  status: string;
  perda_motivo: string | null;
  perda_detalhe: string | null;
  perdido_em: string | null;
};

/** "Saiu de perdido. Motivo: Não quer abrir conta (detalhe). Perdido em
 *  03/10/2026." Sem detalhe ou sem data, a parte some; sem motivo, sai
 *  "Motivo não registrado". */
function textoSaidaDePerdido(perda: Perda): string {
  const motivo = perda.perda_motivo
    ? (ROTULO_MOTIVO_PERDA[perda.perda_motivo] ?? perda.perda_motivo)
    : null;
  const detalhe =
    perda.perda_detalhe?.replace(/\s+/g, " ").trim().replace(/[.;,]+$/, "") ||
    null;
  const porque = motivo
    ? `Motivo: ${motivo}${detalhe ? ` (${detalhe})` : ""}.`
    : detalhe
      ? `Motivo não registrado (${detalhe}).`
      : "Motivo não registrado.";
  const quando = perda.perdido_em
    ? ` Perdido em ${formatarData(perda.perdido_em)}.`
    : "";
  return `Saiu de perdido. ${porque}${quando}`;
}

/**
 * Tira o contato de perdido. Sair de perdido apaga motivo, detalhe e data
 * da perda (gatilho t01, 0063): eles são lidos antes e ficam numa nota de
 * sistema na conversa (a linha fina do chat, com os valores também em
 * metadados.saiu_de_perdido), gravada antes do update. A nota não acende
 * "não lida" (é nota de sistema), não conta como resposta da equipe (o
 * Relatório conta só mensagem_enviada) e não mexe na fila nem na resposta
 * automática, que olham as mensagens. Sem a nota, o contato não sai de
 * perdido: a perda fica no banco e a pessoa tenta de novo.
 *
 * O disparo em massa só barra perdido e marketing_bloqueado_em: a trava de
 * marketing também é gravada antes, enquanto o motivo ainda está no banco.
 * Contato que não é perdido (ou fora do alcance do RLS) não ganha nota nem
 * update.
 */
async function sairDePerdido(
  supabase: ClienteSupabase,
  leadId: string,
  agora: string,
  autorId: string,
) {
  const { data, error: erroLeitura } = await supabase
    .from("leads")
    .select("status, perda_motivo, perda_detalhe, perdido_em")
    .eq("id", leadId)
    .maybeSingle();
  if (erroLeitura) return erroLeitura;
  const perda = data as Perda | null;
  if (perda?.status !== "perdido") return null;

  const trava = await supabase
    .from("leads")
    .update({ marketing_bloqueado_em: agora })
    .eq("id", leadId)
    .eq("status", "perdido")
    .in("perda_motivo", MOTIVOS_SEM_MARKETING)
    .is("marketing_bloqueado_em", null);
  // Sem a trava, sair de perdido devolveria o contato ao disparo.
  if (trava.error) return trava.error;

  // Depois da trava: se ela falha, a nova tentativa não repete a nota.
  const nota = await supabase.from("lead_interactions").insert({
    lead_id: leadId,
    tipo: "nota",
    conteudo: textoSaidaDePerdido(perda),
    autor_id: autorId,
    metadados: {
      via: "crm",
      sistema: true,
      saiu_de_perdido: {
        motivo: perda.perda_motivo,
        detalhe: perda.perda_detalhe,
        perdido_em: perda.perdido_em,
      },
    },
  });
  if (nota.error) return nota.error;

  const { error } = await supabase
    .from("leads")
    .update({ status: "em_atendimento" })
    .eq("id", leadId)
    .eq("status", "perdido");
  return error;
}

/**
 * Resolve ou reabre a conversa (marca local) e registra no histórico.
 *
 * Reabrir um contato marcado como perdido no banco também o devolve a
 * "em atendimento": a view da Caixa esconde perdido, e sem isto a conversa
 * reaberta não voltaria para fila nenhuma.
 */
export async function alterarStatusConversaChat(
  leadId: string,
  status: "open" | "resolved",
): Promise<ResultadoEnvio> {
  const perfil = await perfilQueEscreve();
  if (!perfil) return { erro: SEM_PERMISSAO };
  if (!leadId) return { erro: "Conversa não informada." };
  const negado = await acessoAoLead(leadId);
  if (negado) return { erro: negado };

  const supabase = await createClient();
  const agora = new Date().toISOString();

  // Resolvida sai da caixa de entrada; reabrir devolve. Guardado local porque
  // a Meta não tem status de conversa — e é o que a lista consulta. O
  // retorno do update diz se o contato existe (e está ao alcance do RLS).
  // A marca não mexe no status, então não apaga o motivo da perda que
  // sairDePerdido usa como filtro em paralelo.
  const [marca, erroPerdido] = await Promise.all([
    supabase
      .from("leads")
      .update(
        status === "resolved"
          ? { chat_resolvido_em: agora, chat_lido_em: agora }
          : { chat_resolvido_em: null },
      )
      .eq("id", leadId)
      .select("id"),
    status === "open"
      ? sairDePerdido(supabase, leadId, agora, perfil.id)
      : null,
  ]);
  if (marca.error) return { erro: marca.error.message };
  if (!marca.data?.length) return { erro: "Contato não encontrado." };
  if (erroPerdido) {
    return { erro: `A conversa não reabriu: ${erroPerdido.message}` };
  }

  await supabase.from("lead_interactions").insert({
    lead_id: leadId,
    tipo: "nota",
    conteudo:
      status === "resolved" ? "Conversa resolvida" : "Conversa reaberta",
    autor_id: perfil.id,
    metadados: { via: "crm", sistema: true },
  });

  return { ok: true };
}

export type Pendencias = { naoLidas: number };

/**
 * Conversas não lidas, para o badge do menu. O PostgREST não compara
 * coluna com coluna, então a conta fecha aqui, sobre as 500 conversas
 * mais recentes. A checagem da sessão corre junto da consulta: quem decide
 * o que entra na conta é o RLS e, por cima dele, a privacidade entre
 * pessoas da equipe (Administração > Privacidade): conversa de um dono
 * oculto não conta, nem no badge, nem no "(N)" do título da aba, nem no
 * bip, que compara uma contagem destas com a anterior.
 */
export async function contarNaoLidas(): Promise<Pendencias> {
  const supabase = await createClient();
  const agoraMs = Date.now();
  const agoraIso = new Date(agoraMs).toISOString();

  type LinhaFila = {
    ultima_interacao_em: string;
    chat_lido_em: string | null;
    chat_adiado_em: string | null;
    chat_adiado_ate: string | null;
  };

  // Conversa existente: houve interação (na Meta o thread é o telefone, então
  // basta o histórico). Resolvida e perdida não contam; adiada dentro do
  // prazo também não — volta sozinha quando o prazo vence ou o lead responde.
  // O filtro dos donos ocultos vai na consulta, antes do teto de 500. Sem a
  // regra lida, ou com a consulta em erro, a conta não sai: a action lança,
  // e o badge (nao-lidas.tsx) fica com o número de antes. Devolver zero
  // apagava o badge e, na recontagem seguinte, o número de volta tocava o
  // bip sem mensagem nova.
  const [quem, { data, error }] = await Promise.all([
    idDaSessao(),
    donosOcultosParaMim().then(
      (ocultos) => {
        let q = supabase
          .from("leads")
          .select(
            "ultima_interacao_em, chat_lido_em, chat_adiado_em, chat_adiado_ate",
          )
          .not("ultima_interacao_em", "is", null)
          .is("chat_resolvido_em", null)
          .neq("status", "perdido")
          .or(`chat_adiado_em.is.null,chat_adiado_ate.lte."${agoraIso}"`);
        const semOcultos = filtroDonosOcultos(ocultos);
        if (semOcultos) q = q.or(semOcultos);
        // A ordem do índice (desc, nulos por último): as 500 saem dele.
        return q
          .order("ultima_interacao_em", { ascending: false, nullsFirst: false })
          .limit(500);
      },
      () => ({ data: null, error: { message: "privacidade" } }),
    ),
  ]);
  // Sem sessão não há o que contar; é saída, não falha.
  if (!quem) return { naoLidas: 0 };
  if (error) throw new Error("A contagem de não lidas não carregou.");

  // Prazo de adiamento vencido e ninguém abriu desde então: pendente de novo.
  const adiadaVencida = (l: LinhaFila) =>
    l.chat_adiado_em != null &&
    l.chat_adiado_ate != null &&
    Date.parse(l.chat_adiado_ate) <= agoraMs &&
    (l.chat_lido_em === null ||
      Date.parse(l.chat_lido_em) < Date.parse(l.chat_adiado_ate));

  const naoLidas = ((data ?? []) as LinhaFila[]).filter(
    (l) =>
      l.chat_lido_em === null ||
      l.ultima_interacao_em > l.chat_lido_em ||
      adiadaVencida(l),
  ).length;

  return { naoLidas };
}

/**
 * Abrir a conversa grava a leitura (chat_lido_em) só quando quem abre é o
 * responsável dela, ou quando ela está sem dono (decisão do Artur,
 * 09/10/2026). Gestão, compliance e colegas abrem sem mexer na marca: a
 * conversa segue não lida para todos, quem abriu inclusive, e o badge e o
 * "(N)" do título a contam como antes. Responder, resolver, adiar e o
 * "Marcar como lida" explícito (marcarLidasEmMassa) continuam gravando para
 * quem pode, como sempre.
 *
 * A conferência do dono vai no próprio update (o or no responsável): o
 * banco decide com o dono de agora, mesmo que a conversa tenha mudado de
 * mãos entre a leitura da tela e este pedido. `gravou` diz à tela se pode
 * pintar a linha como lida.
 */
export async function marcarChatLido(
  leadId: string,
): Promise<{ gravou: boolean }> {
  const perfil = await perfilQueEscreve();
  if (!perfil || !ehUuid(leadId)) return { gravou: false };
  if (await acessoAoLead(leadId)) return { gravou: false };

  const supabase = await createClient();
  const { data, error } = await supabase
    .from("leads")
    .update({ chat_lido_em: new Date().toISOString() })
    .eq("id", leadId)
    .or(`responsavel_id.is.null,responsavel_id.eq.${perfil.id}`)
    .select("id");
  return { gravou: !error && (data?.length ?? 0) > 0 };
}

/**
 * Opções de prazo ao adiar: as rápidas o servidor calcula; "data" é o
 * "Escolher data e hora", que chega pronta (ISO) e é conferida aqui.
 */
export type PrazoAdiar =
  | "responder"
  | "1hora"
  | "amanha"
  | "3dias"
  | "1semana"
  | "data";

const MS_PRAZO: Record<"1hora" | "amanha" | "3dias" | "1semana", number> = {
  "1hora": 3_600_000,
  amanha: 86_400_000,
  "3dias": 3 * 86_400_000,
  "1semana": 7 * 86_400_000,
};

/** "Escolher data e hora" vai até um ano à frente. */
const ADIAR_MAX_MS = 366 * 86_400_000;

/**
 * "Até responder" é um prazo que nunca vence sozinho: sentinela no ano 9999.
 * Assim a view existente já faz tudo certo — fica fora da Caixa enquanto o
 * prazo não passou — e a volta é o caminho que sempre existiu: o webhook
 * limpa os carimbos em qualquer mensagem recebida. A tela reconhece o ano
 * e escreve "até responder" em vez da data.
 */
const ATE_RESPONDER_ISO = "9999-12-31T00:00:00.000Z";

/**
 * Data-limite do adiamento (ISO). As rápidas saem do relógio do servidor;
 * a escolhida (`ate`) tem de ser futura (pelo menos um minuto à frente) e
 * caber em um ano. null = prazo que não vale.
 */
function prazoParaIso(
  prazo: PrazoAdiar,
  agoraMs: number,
  ate?: string | null,
): string | null {
  if (prazo === "responder") return ATE_RESPONDER_ISO;
  if (prazo === "data") {
    const ms = Date.parse(String(ate ?? ""));
    if (Number.isNaN(ms) || ms <= agoraMs + 60_000) return null;
    if (ms > agoraMs + ADIAR_MAX_MS) return null;
    return new Date(ms).toISOString();
  }
  const ms = MS_PRAZO[prazo];
  return ms ? new Date(agoraMs + ms).toISOString() : null;
}

/**
 * Texto da nota no histórico, honesto para os dois tipos de prazo. Com a
 * hora: "Conversa adiada até 09/10/2026" não dizia nada do adiar por 1 hora.
 * Começa sempre por "Conversa adiada", que é como a Janela e a ficha
 * reconhecem a nota antiga sem a marca de sistema.
 */
function notaDeAdiamento(ate: string): string {
  return ate === ATE_RESPONDER_ISO
    ? "Conversa adiada até o lead responder"
    : `Conversa adiada até ${formatarData(ate)} às ${horaDoAdiamento(ate)}`;
}

const FORMATO_HORA_ADIAMENTO = new Intl.DateTimeFormat("pt-BR", {
  timeZone: "America/Sao_Paulo",
  hour: "numeric",
  minute: "2-digit",
  hourCycle: "h23",
});

/** "9h", "15h40", em Brasília. */
function horaDoAdiamento(iso: string): string {
  const partes = FORMATO_HORA_ADIAMENTO.formatToParts(new Date(iso));
  const h = Number(partes.find((p) => p.type === "hour")?.value ?? 0);
  const m = partes.find((p) => p.type === "minute")?.value ?? "00";
  return m === "00" ? `${h}h` : `${h}h${m}`;
}

/**
 * Adia a conversa: sai da caixa de entrada até o prazo escolhido. Ela volta
 * antes se o lead responder (o webhook limpa as marcas) e volta sozinha como
 * pendente quando o prazo vence — o filtro das consultas compara com now().
 */
export async function adiarConversa(
  leadId: string,
  prazo: PrazoAdiar,
  /** Só no prazo "data": o instante escolhido (ISO). */
  ateEscolhido?: string | null,
): Promise<ResultadoEnvio> {
  const perfil = await perfilQueEscreve();
  if (!perfil) return { erro: SEM_PERMISSAO };
  if (!leadId) return { erro: "Conversa não informada." };

  const agora = new Date().toISOString();
  const ate = prazoParaIso(prazo, Date.parse(agora), ateEscolhido);
  if (!ate) {
    return {
      erro:
        prazo === "data"
          ? "Escolha uma data e hora daqui para a frente, em até um ano."
          : "Escolha até quando adiar.",
    };
  }
  const negado = await acessoAoLead(leadId);
  if (negado) return { erro: negado };

  const supabase = await createClient();
  const { error } = await supabase
    .from("leads")
    .update({
      chat_adiado_em: agora,
      chat_adiado_ate: ate,
      chat_lido_em: agora,
    })
    .eq("id", leadId);
  if (error) return { erro: error.message };

  await supabase.from("lead_interactions").insert({
    lead_id: leadId,
    tipo: "nota",
    conteudo: notaDeAdiamento(ate),
    autor_id: perfil.id,
    metadados: { via: "crm", sistema: true },
  });

  return { ok: true };
}

/** Traz a conversa adiada de volta à caixa de entrada, sem esperar resposta. */
export async function reativarConversa(
  leadId: string,
): Promise<ResultadoEnvio> {
  const perfil = await perfilQueEscreve();
  if (!perfil) return { erro: SEM_PERMISSAO };
  if (!leadId) return { erro: "Conversa não informada." };
  const negado = await acessoAoLead(leadId);
  if (negado) return { erro: negado };

  const supabase = await createClient();
  const { error } = await supabase
    .from("leads")
    .update({ chat_adiado_em: null, chat_adiado_ate: null })
    .eq("id", leadId);
  if (error) return { erro: error.message };

  return { ok: true };
}

/** Devolve a conversa para a fila de não lidas. */
export async function marcarChatNaoLido(
  leadId: string,
): Promise<ResultadoEnvio> {
  const perfil = await perfilQueEscreve();
  if (!perfil) return { erro: SEM_PERMISSAO };
  if (!leadId) return { erro: "Conversa não informada." };
  const negado = await acessoAoLead(leadId);
  if (negado) return { erro: negado };

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
  const perfil = await perfilQueEscreve();
  if (!perfil) return { erro: SEM_PERMISSAO };

  const pedidos = [...new Set(leadIds)].filter(Boolean).slice(0, MAX_EM_MASSA);
  if (pedidos.length === 0) return { erro: "Nenhuma conversa selecionada." };

  const supabase = await createClient();
  // Conversa de dono oculto sai do lote (a privacidade vale também aqui).
  const ids = await idsVisiveis(supabase, pedidos);
  if (!ids) return { erro: "As conversas não carregaram. Tente de novo." };
  if (ids.length === 0) return { erro: "Nenhuma conversa selecionada." };
  const { error } = await supabase.from("leads").update(mudanca).in("id", ids);
  if (error) return { erro: error.message };

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
  /** Só no prazo "data": o instante escolhido (ISO). */
  ateEscolhido?: string | null,
) {
  const agora = new Date().toISOString();
  const ate = prazoParaIso(prazo, Date.parse(agora), ateEscolhido);
  if (!ate) {
    return {
      erro:
        prazo === "data"
          ? "Escolha uma data e hora daqui para a frente, em até um ano."
          : "Escolha até quando adiar.",
    };
  }

  return emMassa(
    leadIds,
    { chat_adiado_em: agora, chat_adiado_ate: ate, chat_lido_em: agora },
    notaDeAdiamento(ate),
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

/** Aplica (ou remove) uma etiqueta em todas as conversas selecionadas. */
export async function etiquetarEmMassa(
  leadIds: string[],
  tagId: string,
  marcar: boolean,
): Promise<ResultadoEnvio & { total?: number }> {
  const perfil = await perfilQueEscreve();
  if (!perfil) return { erro: SEM_PERMISSAO };
  if (!tagId) return { erro: "Etiqueta não informada." };

  const pedidos = [...new Set(leadIds)].filter(Boolean).slice(0, MAX_EM_MASSA);
  if (pedidos.length === 0) return { erro: "Nenhuma conversa selecionada." };

  const supabase = await createClient();
  const ids = await idsVisiveis(supabase, pedidos);
  if (!ids) return { erro: "As conversas não carregaram. Tente de novo." };
  if (ids.length === 0) return { erro: "Nenhuma conversa selecionada." };

  if (marcar) {
    // upsert: quem já tinha a etiqueta não vira erro de duplicidade.
    const { error } = await supabase.from("lead_tags").upsert(
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

/** Atribui (ou tira o dono de) várias conversas de uma vez. */
export async function atribuirEmMassa(
  leadIds: string[],
  responsavelId: string | null,
) {
  const perfil = await perfilQueEscreve();
  if (!perfil) return { erro: SEM_PERMISSAO };

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

/** Envio sem recibo de falha: status nulo (sem recibo ainda) ou outro. */
const SEM_RECUSA_DA_META =
  "metadados->>status_envio.is.null,metadados->>status_envio.neq.failed";

/**
 * Quantas vezes já se pagou para falar com este lead por template — o
 * número que evita queimar mais um (e desgastar o cliente) sem saber que
 * ontem já foram dois.
 */
export async function historicoTemplatesLead(leadId: string): Promise<{
  total: number;
  ultimoEm: string | null;
  ultimoNome: string | null;
  em30Dias: number;
  /** A consulta falhou: a tela avisa em vez de fingir que são zero. */
  falhou: boolean;
}> {
  const vazio = {
    total: 0,
    ultimoEm: null,
    ultimoNome: null,
    em30Dias: 0,
    falhou: false,
  };
  const perfil = await perfilAtual();
  if (!perfil || !leadId) return { ...vazio, falhou: true };
  // Conversa que a pessoa não vê não tem número nenhum para mostrar.
  if (await acessoAoLead(leadId)) return { ...vazio, falhou: true };

  const supabase = await createClient();
  const trintaDias = new Date(Date.now() - 30 * 86_400_000).toISOString();
  const [todos, recentes] = await Promise.all([
    supabase
      .from("lead_interactions")
      .select("criado_em, metadados", { count: "exact" })
      .eq("lead_id", leadId)
      .eq("tipo", "mensagem_enviada")
      .not("metadados->>template", "is", null)
      // Recusado pela Meta não chegou e não foi cobrado: não é disparo.
      // Sem recibo ainda (status nulo) conta: foi disparado. O .not(eq)
      // sozinho virava NOT (nulo = 'failed'), que é nulo, e tirava da conta
      // o template de um minuto atrás e os antigos sem recibo.
      .or(SEM_RECUSA_DA_META)
      .order("criado_em", { ascending: false })
      .limit(1),
    supabase
      .from("lead_interactions")
      .select("id", { count: "exact", head: true })
      .eq("lead_id", leadId)
      .eq("tipo", "mensagem_enviada")
      .not("metadados->>template", "is", null)
      .or(SEM_RECUSA_DA_META)
      .gte("criado_em", trintaDias),
  ]);

  const ultimo = (todos.data ?? [])[0] as
    | { criado_em: string; metadados: { template?: string | null } | null }
    | undefined;
  // Falha de UMA das consultas contamina o aviso inteiro: com total=0 e
  // em30Dias=7 a tela não pinta nada — justo o caso mais grave.
  const falhou = Boolean(todos.error || recentes.error);
  return {
    total: todos.count ?? 0,
    ultimoEm: ultimo?.criado_em ?? null,
    ultimoNome: ultimo?.metadados?.template ?? null,
    em30Dias: recentes.count ?? 0,
    falhou,
  };
}

// ===========================================================================
// Ações na mensagem: apagar para a equipe (responder é o envio com citação)
// ===========================================================================

/** Quem está usando o chat, para a bolha saber o que oferecer. Só ajuda a
 *  tela: cada action confere de novo no servidor. */
export type EuNoChat = {
  id: string;
  nome: string;
  /** Admin ou gestor: apaga qualquer mensagem e é quem oculta a do
   *  contato. */
  gestao: boolean;
  /** Compliance: só lê; a bolha não oferece nada que grave. */
  leitura: boolean;
};

export async function quemSouNoChat(): Promise<EuNoChat | null> {
  const perfil = await perfilAtivo();
  if (!perfil) return null;
  return {
    id: perfil.id,
    nome: perfil.nome,
    gestao: ehGestao(perfil.papel),
    leitura: perfil.papel === "compliance",
  };
}

/**
 * O desfecho das ações na mensagem. `linhas`: as interações regravadas, no
 * formato do UPDATE do tempo real, para a Janela emitir o eco local
 * (emitirAtualizacaoDaConversa) sem esperar o canal.
 */
export type ResultadoAcaoMensagem = {
  ok?: boolean;
  erro?: string;
  linhas?: LinhaRealtime[];
};

/** A interação como as ações leem, com a sessão (o RLS decide o que volta). */
type LinhaMensagem = {
  id: string;
  lead_id: string;
  tipo: string;
  conteudo: string | null;
  criado_em: string;
  autor_id: string | null;
  metadados: MetadadosBrutos;
};

/**
 * Teto de mensagens por ação. O álbum de fotos é uma linha só na tela e não
 * tem teto (montarDias): a tela manda em lotes deste tamanho, e o que passar
 * dele é recusado com erro, nunca cortado calado.
 */
const MAX_POR_ACAO = 50;

/**
 * As mensagens pedidas, em ordem, todas da mesma conversa, que são conversa
 * (não linha de sistema) e que a pessoa vê. O erro já vem no texto da tela.
 */
async function mensagensDaAcao(
  supabase: ClienteSupabase,
  idsBrutos: unknown,
): Promise<{ linhas: LinhaMensagem[]; leadId: string } | { erro: string }> {
  const ids = [...new Set(Array.isArray(idsBrutos) ? idsBrutos : [])].filter(
    ehUuid,
  );
  if (ids.length === 0) return { erro: "Mensagem não informada." };
  if (ids.length > MAX_POR_ACAO) {
    return {
      erro: `Até ${MAX_POR_ACAO.toLocaleString("pt-BR")} mensagens por vez. Nada foi alterado.`,
    };
  }
  const { data, error } = await supabase
    .from("lead_interactions")
    .select("id, lead_id, tipo, conteudo, criado_em, autor_id, metadados")
    .in("id", ids);
  if (error) return { erro: "A mensagem não carregou. Tente de novo." };
  const linhas = (
    (data ?? []) as (Omit<LinhaMensagem, "metadados"> & { metadados: unknown })[]
  )
    .map((l) => ({ ...l, metadados: ehObjeto(l.metadados) ? l.metadados : {} }))
    .sort((a, b) => Date.parse(a.criado_em) - Date.parse(b.criado_em));
  const leadId = linhas[0]?.lead_id;
  if (
    !leadId ||
    linhas.length !== ids.length ||
    linhas.some(
      (l) =>
        l.lead_id !== leadId ||
        !ehTipoMensagem(l.tipo) ||
        l.metadados.sistema === true,
    )
  ) {
    return { erro: "Mensagem não encontrada." };
  }
  const negado = await acessoAoLead(leadId);
  if (negado) return { erro: negado };
  return { linhas, leadId };
}

/**
 * regravarInteracao com o eco: devolve a linha como ficou gravada (os
 * metadados novos e o rev que a trava deu). null quando não havia nada a
 * gravar.
 */
async function regravarComEco(
  cliente: ReturnType<typeof createServiceClient>,
  linha: LinhaMensagem,
  mudar: (atual: LinhaParaGravar) => Gravacao | null,
): Promise<{ erro: string } | { linha: LinhaRealtime | null }> {
  const saida: { linha: LinhaRealtime | null } = { linha: null };
  const r = await regravarInteracao(
    cliente,
    linha.id,
    (atual) => {
      saida.linha = null;
      const proxima = mudar(atual);
      if (!proxima) return null;
      const rev =
        (typeof atual.metadados.rev === "number" ? atual.metadados.rev : 0) + 1;
      saida.linha = {
        id: linha.id,
        lead_id: linha.lead_id,
        tipo: linha.tipo,
        criado_em: linha.criado_em,
        conteudo:
          proxima.conteudo !== undefined ? proxima.conteudo : atual.conteudo,
        autor_id: linha.autor_id,
        metadados: { ...proxima.metadados, rev } as LinhaRealtime["metadados"],
      };
      return proxima;
    },
    // A primeira tentativa vai com o que a leitura da sessão já trouxe.
    { metadados: linha.metadados, conteudo: linha.conteudo },
  );
  if (!r.ok) return { erro: r.erro };
  return { linha: r.gravou ? saida.linha : null };
}

/* ── Apagar para a equipe ─────────────────────────────────────────────── */

/**
 * Apaga para a equipe (a nossa mensagem ou a nota) ou oculta (a do
 * contato). A Cloud API não apaga nada no aparelho do cliente: o texto e o
 * arquivo continuam no banco e no Storage, e a marca em metadados.apagada
 * tira a bolha da tela. Quem escreveu apaga a própria; a gestão apaga
 * qualquer uma e é a única que oculta a do contato. Fica no Log de acesso.
 */
export async function apagarMensagensParaEquipe(
  ids: string[],
): Promise<ResultadoAcaoMensagem> {
  return marcarApagada(ids, true);
}

/** O "Desfazer" do apagar: tira a marca da equipe (a do contato fica). */
export async function restaurarMensagens(
  ids: string[],
): Promise<ResultadoAcaoMensagem> {
  return marcarApagada(ids, false);
}

async function marcarApagada(
  ids: string[],
  apagar: boolean,
): Promise<ResultadoAcaoMensagem> {
  const perfil = await perfilQueEscreve();
  if (!perfil) return { erro: SEM_PERMISSAO };

  const supabase = await createClient();
  const lidas = await mensagensDaAcao(supabase, ids);
  if ("erro" in lidas) return { erro: lidas.erro };
  const { linhas, leadId } = lidas;
  const doContato = linhas.some((l) => l.tipo === "mensagem_recebida");
  if (!ehGestao(perfil.papel)) {
    if (doContato) return { erro: "Só a gestão oculta mensagem do contato." };
    if (linhas.some((l) => l.autor_id !== perfil.id)) {
      return { erro: "Só quem escreveu ou a gestão apaga esta mensagem." };
    }
  }

  const service = createServiceClient();
  const agora = new Date().toISOString();
  const eco: LinhaRealtime[] = [];
  let falha: string | null = null;
  for (const linha of linhas) {
    const r = await regravarComEco(service, linha, ({ metadados }) => {
      const marca = metadados.apagada;
      if (apagar) {
        // A do contato é fato e fica; a da equipe já está lá.
        if (marca) return null;
        return {
          metadados: {
            ...metadados,
            apagada: {
              por: "equipe",
              em: agora,
              autor_id: perfil.id,
              nome: perfil.nome,
            },
          },
        };
      }
      if (!ehObjeto(marca) || marca.por !== "equipe") return null;
      const semMarca = { ...metadados };
      delete semMarca.apagada;
      return { metadados: semMarca };
    });
    if ("erro" in r) {
      falha = apagar
        ? "A mensagem não foi apagada. Tente de novo."
        : "A mensagem não voltou. Tente de novo.";
      break;
    }
    if (r.linha) eco.push(r.linha);
  }

  if (eco.length > 0) {
    const { data } = await supabase
      .from("leads")
      .select("nome")
      .eq("id", leadId)
      .maybeSingle();
    registrarAcesso(
      perfil.id,
      !apagar
        ? "restaurou_mensagem"
        : doContato
          ? "ocultou_mensagem"
          : "apagou_mensagem",
      {
        lead_id: leadId,
        nome: (data as { nome: string } | null)?.nome ?? undefined,
        interacoes: eco.map((l) => l.id),
      },
    );
  }
  return falha ? { erro: falha, linhas: eco } : { ok: true, linhas: eco };
}
