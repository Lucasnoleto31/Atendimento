import { createHmac, timingSafeEqual } from "node:crypto";
import { after, NextResponse, type NextRequest } from "next/server";
import { createServiceClient } from "@/lib/supabase/server";
import { escolherVendedor } from "@/lib/distribuicao";
import { formatarData } from "@/lib/format";
import {
  baixarFotoInstagram,
  baixarMidiaInstagram,
  perfilInstagram,
  regraAnexoDirect,
} from "@/lib/instagram";
import { BUCKET_MIDIA } from "@/lib/whatsapp";
import { BUCKET_FOTOS, caminhoFotoContato } from "@/lib/avatar";
import {
  concluirEvento,
  horaOriginal,
  mensagemJaGravada,
  passadaLiberada,
  registrarEvento,
  reivindicarPendentes,
  type Registro,
} from "@/app/api/webhooks/eventos";
import { agendarRespostaAutomatica } from "@/app/api/webhooks/automaticas";
import {
  acharInteracaoPorIdMeta,
  comReacao,
  regravarInteracao,
  retratoDaCitada,
  type EdicaoGravada,
  type Gravacao,
  type LinhaParaGravar,
  type RespostaAGravada,
} from "@/app/(app)/chat/metadados";

/**
 * Webhook do Direct do Instagram.
 *
 * Mesmo desenho do webhook do WhatsApp: GET responde o desafio de
 * verificação e POST recebe os eventos com assinatura HMAC.
 *
 * O app do Instagram costuma ser OUTRO — a conta do perfil pode viver numa
 * Business Manager diferente da do WhatsApp, e o caminho "Instagram Login"
 * nem exige página do Facebook. Por isso o segredo e o token de verificação
 * têm variáveis próprias, caindo nas do WhatsApp quando o app é o mesmo.
 *
 * O que muda: aqui a identidade do contato é o IGSID, não o telefone. Um
 * contato do Direct nasce SEM telefone — e isso é normal. Ele ganha telefone
 * se e quando a pessoa passar o número na conversa.
 *
 * O eco do que a própria equipe enviou vem marcado com is_echo: ignorar,
 * senão a mensagem entra duas vezes no histórico.
 *
 * Reação (message_reactions), mensagem apagada (is_deleted), editada
 * (message_edit) e lida (messaging_seen) não viram linha: mexem nos
 * metadados da mensagem a que se referem (chat/metadados.ts). Cada campo
 * precisa estar assinado no painel da Meta para chegar aqui.
 *
 * A foto do perfil e os anexos (foto, áudio, vídeo, arquivo) vão para o
 * Storage depois da resposta à Meta (after): o link do CDN da Meta expira, e
 * baixar antes de gravar a mensagem só atrasaria o chat.
 *
 * A mensagem que falhou ao gravar volta pela passada de reprocessamento
 * (webhooks/eventos.ts), também depois da resposta. A resposta automática
 * (fora do horário, boas-vindas) sai do mesmo jeito (webhooks/automaticas.ts).
 */

type Service = ReturnType<typeof createServiceClient>;

export async function GET(request: NextRequest) {
  const params = request.nextUrl.searchParams;
  const modo = params.get("hub.mode");
  const token = params.get("hub.verify_token");
  const challenge = params.get("hub.challenge");
  const esperado =
    process.env.INSTAGRAM_WEBHOOK_VERIFY_TOKEN ??
    process.env.META_WEBHOOK_VERIFY_TOKEN;

  if (modo === "subscribe" && esperado && token === esperado && challenge) {
    return new Response(challenge, { status: 200 });
  }
  return new Response("Forbidden", { status: 403 });
}

function assinaturaValida(corpo: string, assinatura: string | null): boolean {
  const segredo =
    process.env.INSTAGRAM_APP_SECRET ?? process.env.META_APP_SECRET;
  // Sem segredo o endpoint é público e escreve com service role: em produção,
  // recusa tudo.
  if (!segredo) return process.env.NODE_ENV !== "production";
  if (!assinatura?.startsWith("sha256=")) return false;

  const esperada = createHmac("sha256", segredo).update(corpo).digest("hex");
  const recebida = assinatura.slice("sha256=".length);
  if (esperada.length !== recebida.length) return false;
  return timingSafeEqual(Buffer.from(esperada), Buffer.from(recebida));
}

type AnexoIg = { type?: string; payload?: { url?: string; title?: string } };

/** Anexo como fica em metadados.anexos, que a tela lê (paraMensagem). */
type AnexoGravado = {
  tipo: string;
  url: string;
  nome?: string;
  mime?: string;
  tamanho?: number;
};

/**
 * Publicação, reel e story apontam para conteúdo do Instagram, não para um
 * arquivo da pessoa: ficam no link, com o nome do que são. O "share" saiu
 * em fevereiro de 2026; os tipos novos são ig_post, reel, story, ig_story e
 * media.
 */
const NOME_LINK_IG: Record<string, string> = {
  share: "Publicação compartilhada",
  ig_post: "Publicação do Instagram",
  ig_reel: "Reel do Instagram",
  reel: "Reel do Instagram",
  story: "Story do Instagram",
  ig_story: "Story do Instagram",
  story_mention: "Menção em story",
  media: "Mídia do Instagram",
};

function anexoGravado(bruto: AnexoIg): AnexoGravado {
  const tipo = bruto.type ?? "";
  const url = bruto.payload?.url ?? "";
  if (tipo === "image" || tipo === "video" || tipo === "audio") {
    return { tipo, url };
  }
  const link = NOME_LINK_IG[tipo];
  if (link) return { tipo: "link", url, nome: bruto.payload?.title?.trim() || link };
  return { tipo: "file", url };
}

type MensagemIg = {
  mid?: string;
  text?: string;
  attachments?: AnexoIg[];
  is_echo?: boolean;
  is_deleted?: boolean;
  /** Resposta citando uma mensagem (mid) ou um story. */
  reply_to?: { mid?: string; story?: { id?: string; url?: string } };
};

type EventoIg = {
  sender?: { id?: string };
  recipient?: { id?: string };
  timestamp?: number;
  message?: MensagemIg;
  /** message_reactions: o mid é o da mensagem que recebeu a reação. */
  reaction?: {
    mid?: string;
    action?: "react" | "unreact" | string;
    reaction?: string;
    emoji?: string;
  };
  /** message_edit: o texto novo e quantas vezes já foi editada. */
  message_edit?: { mid?: string; text?: string; num_edit?: number };
  /** messaging_seen: a pessoa viu até esta mensagem. */
  read?: { mid?: string };
};

const ROTULO_ANEXO: Record<string, string> = {
  image: "[imagem]",
  video: "[vídeo]",
  audio: "[áudio]",
  file: "[arquivo]",
  share: "[publicação compartilhada]",
  ig_post: "[publicação]",
  story_mention: "[menção em story]",
  ig_reel: "[reel]",
  reel: "[reel]",
  story: "[story]",
  ig_story: "[story]",
  media: "[mídia]",
};

/**
 * O que um evento do Direct é, e o id dele em webhook_events (o mesmo na
 * primeira vez e na passada de reprocessamento). A "lida" não entra no
 * livro: é idempotente e chega uma por mensagem vista.
 */
type ClasseEvento =
  | { tipo: "mensagem"; mid: string; eventoId: string }
  | { tipo: "reacao" | "apagada" | "edicao"; mid: string; eventoId: string }
  | { tipo: "lida"; mid: string };

function classificarEvento(evento: EventoIg): ClasseEvento | null {
  const mid = evento.message?.mid;
  if (mid && evento.message?.is_deleted) {
    return { tipo: "apagada", mid, eventoId: `ig-apagada-${mid}` };
  }
  if (mid) return { tipo: "mensagem", mid, eventoId: `ig-${mid}` };
  const reacao = evento.reaction;
  if (reacao?.mid) {
    return {
      tipo: "reacao",
      mid: reacao.mid,
      eventoId: `ig-reacao-${reacao.mid}-${reacao.action ?? ""}-${evento.timestamp ?? ""}`,
    };
  }
  const edicao = evento.message_edit;
  if (edicao?.mid) {
    return {
      tipo: "edicao",
      mid: edicao.mid,
      eventoId: `ig-edicao-${edicao.mid}-${edicao.num_edit ?? evento.timestamp ?? ""}`,
    };
  }
  if (evento.read?.mid) return { tipo: "lida", mid: evento.read.mid };
  return null;
}

export async function POST(request: NextRequest) {
  const corpo = await request.text();

  if (!assinaturaValida(corpo, request.headers.get("x-hub-signature-256"))) {
    return new Response("Invalid signature", { status: 401 });
  }

  let payload: {
    object?: string;
    entry?: { id?: string; messaging?: EventoIg[] }[];
  };
  try {
    payload = JSON.parse(corpo);
  } catch {
    return new Response("Bad request", { status: 400 });
  }

  const service = createServiceClient();

  for (const entry of payload.entry ?? []) {
    for (const evento of entry.messaging ?? []) {
      // Eco do que nós mesmos mandamos: não vira histórico.
      if (evento.message?.is_echo) continue;

      const igsid = evento.sender?.id;
      const classe = classificarEvento(evento);
      if (!igsid || !classe) continue;

      if (classe.tipo === "lida") {
        // O ✓✓ do Direct não precisa segurar a resposta à Meta.
        const mid = classe.mid;
        after(() =>
          marcarLidaNoDirect(service, igsid, mid).catch((e: unknown) =>
            console.error(
              `[webhook instagram] lida ${mid}: ${motivoDaFalha(e)}`,
            ),
          ),
        );
        continue;
      }
      await processarEvento(service, evento, igsid, classe);
    }
  }

  // Mensagem que falhou ao gravar não volta pela Meta (ela só reenvia o que
  // não recebeu 200): volta pela passada, depois da resposta.
  if (passadaLiberada("instagram")) {
    after(() =>
      reprocessarPendentes(service).catch((e: unknown) =>
        console.error(
          `[webhook instagram] passada de reprocessamento: ${motivoDaFalha(e)}`,
        ),
      ),
    );
  }

  // A Meta desliga o webhook que não devolve 200 — erro fica registrado na
  // linha do evento, não no status.
  return NextResponse.json({ ok: true });
}

/**
 * Nova tentativa das mensagens que falharam, a partir do evento guardado em
 * webhook_events.
 */
async function reprocessarPendentes(service: Service) {
  const pendentes = await reivindicarPendentes(service, "instagram");
  for (const { eventoId, payload, registro } of pendentes) {
    const evento = payload as EventoIg;
    const igsid = evento.sender?.id;
    const classe = classificarEvento(evento);
    if (!igsid || !classe || classe.tipo === "lida") {
      await concluirEvento(
        service,
        "instagram",
        eventoId,
        registro,
        new Error("O evento guardado não tem remetente ou mensagem."),
      );
      continue;
    }
    await processarEvento(service, evento, igsid, classe, registro);
  }
}

/** A mensagem nova vira linha; reação, apagada e edição mexem na antiga. */
async function processarEvento(
  service: Service,
  evento: EventoIg,
  igsid: string,
  classe: Exclude<ClasseEvento, { tipo: "lida" }>,
  reivindicado?: Registro,
) {
  if (classe.tipo === "mensagem") {
    await receberDirect(service, evento, igsid, classe.mid, reivindicado);
    return;
  }
  await aplicarEventoSobreMensagem(service, evento, igsid, classe, reivindicado);
}

/** A hora do evento (o Direct manda em milissegundos), ou agora. */
function horaDoEvento(evento: EventoIg): string {
  const ms = Number(evento.timestamp);
  return new Date(Number.isFinite(ms) && ms > 0 ? ms : Date.now()).toISOString();
}

/** O contato do Direct pelo IGSID, só o id e o nome. */
async function contatoDoDirect(service: Service, igsid: string) {
  const { data, error } = await service
    .from("leads")
    .select("id, nome")
    .eq("instagram_id", igsid)
    .maybeSingle();
  if (error) throw new Error(`Falha ao buscar o contato: ${error.message}`);
  return data as { id: string; nome: string | null } | null;
}

/**
 * Reação, apagada ou editada: grava na mensagem a que se refere, achada pelo
 * mid entre as deste contato. Não vira linha, não reabre a conversa nem a
 * marca como não lida. Sem a mensagem no histórico, fica só o aviso no log.
 */
async function aplicarEventoSobreMensagem(
  service: Service,
  evento: EventoIg,
  igsid: string,
  classe: { tipo: "reacao" | "apagada" | "edicao"; mid: string; eventoId: string },
  reivindicado?: Registro,
) {
  const [registro, contato] = await Promise.all([
    reivindicado ??
      registrarEvento(service, "instagram", classe.eventoId, evento),
    contatoDoDirect(service, igsid).catch((e: unknown) => e as Error),
  ]);
  if (registro.tipo === "duplicado") return;

  try {
    if (contato instanceof Error) throw contato;
    const alvo = contato
      ? await acharInteracaoPorIdMeta(service, contato.id, classe.mid)
      : null;
    const em = horaDoEvento(evento);
    if (!alvo) {
      // A reação à mensagem que acabou de chegar pode vencer a corrida
      // contra ela: enquanto o evento é recente, a falha manda para a
      // passada, que tenta de novo em um minuto.
      if (contato && Date.now() - Date.parse(em) < ESPERA_PELA_ORIGEM_MS) {
        throw new Error(`A mensagem ${classe.mid} ainda não está no histórico.`);
      }
      console.warn(
        `[webhook instagram] ${classe.tipo} de ${classe.mid}: a mensagem não está no histórico.`,
      );
      await concluirEvento(service, "instagram", classe.eventoId, registro);
      return;
    }

    const mudar =({ metadados, conteudo }: LinhaParaGravar): Gravacao | null => {
      if (classe.tipo === "reacao") {
        const r = evento.reaction;
        const emoji =
          r?.action === "unreact"
            ? ""
            : r?.emoji?.trim() || (r?.reaction === "love" ? "❤️" : "");
        // Reação sem emoji que não é remoção: nada que mostrar.
        if (!emoji && r?.action !== "unreact") return null;
        const reacoes = comReacao(metadados.reacoes, { de: "contato", emoji, em });
        return reacoes ? { metadados: { ...metadados, reacoes } } : null;
      }
      if (classe.tipo === "apagada") {
        // O texto fica no banco (o registro do que chegou); a tela mostra
        // "Mensagem apagada".
        return metadados.apagada
          ? null
          : { metadados: { ...metadados, apagada: { por: "contato", em } } };
      }
      const edicao = evento.message_edit;
      const anterior = (metadados.editada ?? null) as EdicaoGravada | null;
      const vezes = edicao?.num_edit ?? (anterior?.vezes ?? 0) + 1;
      // Edição atrasada não passa por cima da mais nova.
      if (anterior && (anterior.vezes ?? 0) >= vezes) return null;
      const novo = edicao?.text?.trim() || null;
      const editada: EdicaoGravada = {
        em,
        original: anterior ? anterior.original : conteudo,
        vezes,
        ...(novo ? {} : { sem_texto: true }),
      };
      return novo
        ? { metadados: { ...metadados, editada }, conteudo: novo }
        : { metadados: { ...metadados, editada } };
    };

    const r = await regravarInteracao(service, alvo.id, mudar, {
      metadados: alvo.metadados,
      conteudo: alvo.conteudo,
    });
    if (!r.ok) throw new Error(`Falha ao gravar ${classe.tipo}: ${r.erro}`);
    await concluirEvento(service, "instagram", classe.eventoId, registro);
  } catch (e) {
    await concluirEvento(service, "instagram", classe.eventoId, registro, e);
  }
}

/** Até quando a mensagem de origem de uma reação pode estar chegando. */
const ESPERA_PELA_ORIGEM_MS = 3 * 60_000;

/** Quantas enviadas anteriores sem recibo a "lida" do Direct alcança. */
const LIDAS_POR_AVISO = 10;
const JANELA_LIDA_MS = 7 * 86_400_000;

/**
 * A pessoa viu a conversa até esta mensagem (messaging_seen): a nossa
 * enviada ganha o ✓✓ de lida, e as anteriores sem recibo também (o Direct
 * não manda "enviada" nem "entregue"; o aviso de leitura é a marca d'água
 * do que ela viu). Só as do Direct e sem recibo: o envio pelo WhatsApp do
 * mesmo contato tem o recibo dele, e o que ainda não tem (o template de
 * segundos antes, ou o envio sem wamid, que nunca terá) não foi lido por
 * ninguém. Por isso fica de fora o id "wamid." e o envio sem id.
 */
async function marcarLidaNoDirect(service: Service, igsid: string, mid: string) {
  const contato = await contatoDoDirect(service, igsid);
  if (!contato) return;
  const alvo = await acharInteracaoPorIdMeta(service, contato.id, mid);
  if (!alvo || alvo.tipo === "mensagem_recebida") return;

  const desde = new Date(
    Date.parse(alvo.criado_em) - JANELA_LIDA_MS,
  ).toISOString();
  const { data: anteriores, error } = await service
    .from("lead_interactions")
    .select("id, metadados, conteudo")
    .eq("lead_id", contato.id)
    .eq("tipo", "mensagem_enviada")
    .lt("criado_em", alvo.criado_em)
    .gte("criado_em", desde)
    .is("metadados->>status_envio", null)
    .not("metadados->>message_id", "is", null)
    .not("metadados->>message_id", "like", "wamid.%")
    .order("criado_em", { ascending: false })
    .limit(LIDAS_POR_AVISO);
  if (error) throw new Error(error.message);

  const lida = ({ metadados }: LinhaParaGravar): Gravacao | null =>
    metadados.status_envio === "read" || metadados.status_envio === "failed"
      ? null
      : { metadados: { ...metadados, status_envio: "read" } };

  const linhas = [
    { id: alvo.id, metadados: alvo.metadados, conteudo: alvo.conteudo },
    ...((anteriores ?? []) as {
      id: string;
      metadados: Record<string, unknown> | null;
      conteudo: string | null;
    }[]).map((l) => ({ ...l, metadados: l.metadados ?? {} })),
  ];
  const resultados = await Promise.all(
    linhas.map((l) =>
      regravarInteracao(service, l.id, lida, {
        metadados: l.metadados,
        conteudo: l.conteudo,
      }),
    ),
  );
  const falha = resultados.find((r) => !r.ok);
  if (falha && !falha.ok) throw new Error(falha.erro);
}

/** O motivo de uma falha de download, legível no log. */
function motivoDaFalha(e: unknown): string {
  if ((e as { name?: string } | null)?.name === "TimeoutError") {
    return "o CDN da Meta não respondeu a tempo";
  }
  return e instanceof Error ? e.message : String(e);
}

/** O que o contato perdido carrega até sair de perdido (gatilho t01). */
type Perda = {
  status: string;
  perda_motivo: string | null;
  perda_detalhe: string | null;
  perdido_em: string | null;
  marketing_bloqueado_em: string | null;
};

type Contato = Perda & {
  id: string;
  nome: string | null;
  primeira_resposta_em: string | null;
};

const CAMPOS_PERDA =
  "status, perda_motivo, perda_detalhe, perdido_em, marketing_bloqueado_em";

const CAMPOS_CONTATO = `id, nome, primeira_resposta_em, ${CAMPOS_PERDA}`;

/**
 * Motivos de perda (check leads_perda_motivo_chk, 0038 e 0061) em que o
 * próprio contato pediu para parar ou não é quem se procurava: voltar a
 * escrever não autoriza o disparo em massa de novo.
 */
const MOTIVOS_SEM_MARKETING = new Set(["sem_interesse", "contato_invalido"]);

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
 * A busca do contato é do começo da mensagem: para quem estava perdido, a
 * perda é relida perto do update. Numa rajada, a mensagem que chega depois
 * acha o contato já fora de perdido e não repete a nota.
 */
async function relerPerda(
  service: Service,
  contato: Contato,
): Promise<Contato> {
  const { data, error } = await service
    .from("leads")
    .select(CAMPOS_PERDA)
    .eq("id", contato.id)
    .maybeSingle();
  if (error) throw new Error(`Falha ao reler a perda: ${error.message}`);
  return data ? { ...contato, ...(data as Perda) } : contato;
}

/**
 * Sair de perdido apaga motivo, detalhe e data da perda (gatilho t01, 0063).
 * Antes do update, a perda vira nota de sistema na conversa (a linha fina
 * do chat), no formato da reabertura automática do CRM, e os valores vão
 * também em metadados.saiu_de_perdido. A nota não acende "não lida" (é
 * nota de sistema), não conta como resposta da equipe (o Relatório conta
 * só mensagem_enviada), não mexe na fila (a vez e a ordem são das
 * mensagens) e não dispara resposta automática.
 *
 * Sem a nota, o contato não sai de perdido: a falha manda a mensagem para
 * a passada, que tenta de novo com a perda ainda no banco.
 */
async function anotarSaidaDePerdido(service: Service, perda: Contato) {
  const { error } = await service.from("lead_interactions").insert({
    lead_id: perda.id,
    tipo: "nota",
    conteudo: textoSaidaDePerdido(perda),
    metadados: {
      via: "webhook",
      sistema: true,
      reabertura: true,
      saiu_de_perdido: {
        motivo: perda.perda_motivo,
        detalhe: perda.perda_detalhe,
        perdido_em: perda.perdido_em,
      },
    },
  });
  if (error) {
    throw new Error(`Falha ao guardar o motivo da perda: ${error.message}`);
  }
}

/**
 * Pessoa escreveu: a conversa resolvida ou adiada volta para a caixa de
 * entrada (o prazo do adiamento também zera) e ultima_interacao_em acende o
 * aviso de não lida. Um update só por mensagem (fora a primeira resposta,
 * abaixo).
 *
 * Lead marcado perdido aparece como resolvido no chat — a v_leads_listas o
 * tira da Caixa pelo status. Para a conversa voltar, o status sai de
 * perdido no mesmo update.
 *
 * Sair de perdido apaga motivo, detalhe e data da perda (gatilho t01): a
 * perda é relida e vira nota antes do update (anotarSaidaDePerdido). O
 * disparo em massa só barra perdido e marketing_bloqueado_em: quem foi
 * perdido por pedir para parar ou por número errado ganha a trava de
 * marketing neste mesmo update, decidida pelo motivo relido antes de o
 * gatilho limpá-lo — o contato do Direct pode ter telefone e estar no
 * público de uma campanha.
 *
 * A primeira resposta (respondeuEm, ver receberDirect) só é gravada se
 * estava vazia: vai num update à parte, condicionado a ela continuar
 * vazia, e só quando a busca a leu vazia. Assim nenhuma mensagem
 * sobrescreve a de outra, nem numa rajada.
 *
 * Na nova tentativa, chat_lido_em também zera (o efeito de "marcar não
 * lida"): a mensagem entra com a hora original, e quem abriu a conversa
 * depois dela não a viu, porque ela ainda não estava gravada.
 *
 * Falha nos updates não derruba a mensagem, só fica no log. A nota da
 * perda, sim (ver anotarSaidaDePerdido).
 */
async function reabrirConversa(
  service: Service,
  lido: Contato,
  agora: string,
  respondeuEm: string,
  marcarNaoLida = false,
) {
  const contato =
    lido.status === "perdido" ? await relerPerda(service, lido) : lido;
  const perdido = contato.status === "perdido";
  if (perdido) await anotarSaidaDePerdido(service, contato);
  const travarMarketing =
    perdido &&
    contato.marketing_bloqueado_em === null &&
    MOTIVOS_SEM_MARKETING.has(contato.perda_motivo ?? "");

  const [{ error }, primeira] = await Promise.all([
    service
      .from("leads")
      .update({
        ultima_interacao_em: agora,
        chat_resolvido_em: null,
        chat_adiado_em: null,
        chat_adiado_ate: null,
        ...(marcarNaoLida ? { chat_lido_em: null } : {}),
        ...(perdido ? { status: "em_atendimento" } : {}),
        ...(travarMarketing ? { marketing_bloqueado_em: agora } : {}),
      })
      .eq("id", contato.id),
    contato.primeira_resposta_em === null
      ? service
          .from("leads")
          .update({ primeira_resposta_em: respondeuEm })
          .eq("id", contato.id)
          .is("primeira_resposta_em", null)
      : null,
  ]);
  if (error) {
    console.error(
      `[webhook instagram] conversa ${contato.id} não reabriu: ${error.message}`,
    );
  }
  if (primeira?.error) {
    console.error(
      `[webhook instagram] primeira resposta de ${contato.id} não gravada: ${primeira.error.message}`,
    );
  }
}

/**
 * Contatos cuja foto esta instância da função já copiou ou renovou. A foto
 * muda pouco e cada renovação custa uma leitura na Graph e um download: uma
 * vez por instância basta. O teto só segura a memória de uma instância que
 * fica de pé por muito tempo.
 */
const fotosEmDia = new Set<string>();
const TETO_FOTOS_EM_DIA = 5_000;

/** true = ainda não tinha sido feita nesta instância (e fica marcada). */
function marcarFotoEmDia(leadId: string): boolean {
  if (fotosEmDia.has(leadId)) return false;
  if (fotosEmDia.size >= TETO_FOTOS_EM_DIA) fotosEmDia.clear();
  fotosEmDia.add(leadId);
  return true;
}

/**
 * Copia a foto para avatares/<leadId>.jpg, por cima da anterior: a tela monta
 * o endereço pelo id, sem consulta. Roda depois da resposta; falha fica só no
 * log, e o contato segue com as iniciais.
 */
async function guardarFoto(service: Service, leadId: string, link: string) {
  try {
    const foto = await baixarFotoInstagram(link);
    const { error } = await service.storage
      .from(BUCKET_FOTOS)
      .upload(caminhoFotoContato(leadId), foto.conteudo, {
        contentType: foto.tipo,
        upsert: true,
      });
    if (error) throw new Error(`Storage: ${error.message}`);
  } catch (e) {
    console.error(
      `[webhook instagram] foto do contato ${leadId} não foi copiada: ${motivoDaFalha(e)}`,
    );
  }
}

const EXTENSOES: Record<string, string> = {
  "image/jpeg": "jpg",
  "video/quicktime": "mov",
  "audio/mpeg": "mp3",
  "audio/mp4": "m4a",
  "audio/x-m4a": "m4a",
};

function extensaoDoTipo(tipo: string): string {
  return (
    EXTENSOES[tipo] ??
    ((tipo.split("/")[1] ?? "").replace(/[^a-z0-9]/g, "").slice(0, 8) || "bin")
  );
}

/**
 * Copia os anexos do Direct para o Storage (midia-whatsapp/instagram/): o
 * link do CDN da Meta expira, e a foto, o áudio ou o comprovante que a pessoa
 * mandou sumiriam do histórico. Roda depois da resposta à Meta, uma vez por
 * mensagem (o dedup de webhook_events garante). Anexo que falhar (prazo,
 * tipo, teto) fica com o link original e o motivo vai para o log.
 *
 * Se algum foi copiado, UM update troca a lista. O metadados vai inteiro: o
 * update substitui o jsonb, e sem canal, message_id e igsid a conversa
 * perderia o canal. A tela troca o anexo sozinha pelo UPDATE do tempo real.
 */
async function hospedarAnexosDirect(
  service: Service,
  interacaoId: string,
  mid: string,
  metadados: Record<string, unknown>,
  brutos: AnexoIg[],
  anexos: AnexoGravado[],
) {
  // O mid é base64 da Meta; no nome do arquivo, só o que o Storage aceita sem
  // escape.
  const base = `instagram/${mid.replace(/[^A-Za-z0-9_-]/g, "_")}`;
  const copias = await Promise.all(
    anexos.map(async (anexo, i): Promise<AnexoGravado> => {
      const regra = regraAnexoDirect(brutos[i]?.type);
      if (!regra) return anexo;
      try {
        const midia = await baixarMidiaInstagram(anexo.url, regra);
        const caminho = `${base}-${i}.${extensaoDoTipo(midia.tipo)}`;
        const { error } = await service.storage
          .from(BUCKET_MIDIA)
          .upload(caminho, midia.conteudo, {
            contentType: midia.tipo,
            upsert: true,
          });
        if (error) throw new Error(`Storage: ${error.message}`);
        const { data } = service.storage
          .from(BUCKET_MIDIA)
          .getPublicUrl(caminho);
        return {
          ...anexo,
          url: data.publicUrl,
          mime: midia.tipo,
          tamanho: midia.conteudo.byteLength,
        };
      } catch (e) {
        console.error(
          `[webhook instagram] anexo ${i + 1} da mensagem ${mid} não foi copiado: ${motivoDaFalha(e)}`,
        );
        return anexo;
      }
    }),
  );
  if (copias.every((copia, i) => copia === anexos[i])) return;

  // Pela trava do rev: uma reação que chegou enquanto o anexo baixava não
  // some debaixo da lista nova.
  const r = await regravarInteracao(
    service,
    interacaoId,
    (atual) => ({ metadados: { ...atual.metadados, anexos: copias } }),
    { metadados, conteudo: null },
  );
  if (!r.ok) {
    console.error(
      `[webhook instagram] anexos da mensagem ${mid} copiados, mas o histórico segue com o link da Meta: ${r.erro}`,
    );
  }
}

/**
 * Contato que já existia: a foto se renova uma vez por instância, depois da
 * resposta. Pede o perfil de novo porque o link da foto expira e não fica
 * guardado em lugar nenhum.
 */
function renovarFoto(service: Service, leadId: string, igsid: string) {
  if (!marcarFotoEmDia(leadId)) return;
  after(async () => {
    const perfil = await perfilInstagram(igsid);
    if (perfil.foto) await guardarFoto(service, leadId, perfil.foto);
  });
}

/**
 * Contato novo do Direct, com quem atende escolhido pela distribuição, e
 * com a primeira resposta: foi ele quem escreveu. `criado` = nasceu aqui;
 * falso quando outro POST o criou no meio do caminho (as boas-vindas são de
 * quem criou).
 */
async function criarContato(
  service: Service,
  igsid: string,
  agora: string,
  respondeuEm: string,
): Promise<{ id: string; criado: boolean }> {
  // Nome e @ para o contato não nascer como um número opaco. A busca do
  // perfil (Graph) corre junto com a escolha de quem atende e com o canal
  // (banco), como no sistema original. Sem a leitura do canal, o contato
  // nasce sem ele em vez de perder a mensagem.
  const [perfil, atendente, canal] = await Promise.all([
    perfilInstagram(igsid),
    escolherVendedor(service),
    service.from("channels").select("id").eq("slug", "instagram").maybeSingle(),
  ]);

  const { data: novo, error } = await service
    .from("leads")
    .insert({
      nome:
        perfil.nome ??
        (perfil.usuario ? `@${perfil.usuario}` : "Direct do Instagram"),
      instagram_id: igsid,
      instagram_usuario: perfil.usuario,
      // Contato do Direct não tem telefone — e não precisa ter para ser
      // atendido.
      telefone_e164: null,
      channel_id: (canal.data?.id as string | undefined) ?? null,
      entrada_motivo: "webhook_instagram",
      responsavel_id: atendente?.id ?? null,
      primeira_resposta_em: respondeuEm,
      ultima_interacao_em: agora,
    })
    .select("id")
    .single();

  if (error) {
    // Corrida: duas mensagens do MESMO perfil novo em POSTs paralelos — o
    // perdedor do índice único de instagram_id reaproveita o contato do
    // outro, em vez de perder a mensagem.
    if (error.code !== "23505") {
      throw new Error(`Não deu para criar o contato do Direct: ${error.message}`);
    }
    const { data: corrida } = await service
      .from("leads")
      .select(CAMPOS_CONTATO)
      .eq("instagram_id", igsid)
      .maybeSingle();
    if (!corrida) {
      throw new Error(`Não deu para criar o contato do Direct: ${error.message}`);
    }
    await reabrirConversa(service, corrida as Contato, agora, respondeuEm);
    return { id: corrida.id as string, criado: false };
  }

  // Contato criado: a foto sai depois do 200, com o link que veio agora. No
  // caminho da corrida acima, quem criou o contato é que copia.
  const leadId = novo.id as string;
  const foto = perfil.foto;
  if (foto) {
    marcarFotoEmDia(leadId);
    after(() => guardarFoto(service, leadId, foto));
  }
  return { id: leadId, criado: true };
}

/**
 * `reivindicado` vem da passada de reprocessamento, que já tomou a linha do
 * evento para esta nova tentativa.
 */
async function receberDirect(
  service: Service,
  evento: EventoIg,
  igsid: string,
  mid: string,
  reivindicado?: Registro,
) {
  const eventoId = `ig-${mid}`;

  // O registro do evento (dedup) e a busca do contato não dependem um do
  // outro: saem juntos.
  const [registro, busca] = await Promise.all([
    reivindicado ?? registrarEvento(service, "instagram", eventoId, evento),
    service
      .from("leads")
      .select(CAMPOS_CONTATO)
      .eq("instagram_id", igsid)
      .maybeSingle(),
  ]);
  if (registro.tipo === "duplicado") return;

  try {
    const novaTentativa = registro.tipo === "novo" && registro.tentativa > 1;

    // Nova tentativa de mensagem que já está no histórico (só o desfecho se
    // perdeu): fecha o evento sem reabrir a conversa nem gravar de novo.
    if (novaTentativa && (await mensagemJaGravada(service, mid))) {
      await concluirEvento(service, "instagram", eventoId, registro);
      return;
    }

    if (busca.error) {
      throw new Error(`Falha ao buscar o contato: ${busca.error.message}`);
    }
    const contato = busca.data as Contato | null;

    const brutos = (evento.message?.attachments ?? []).filter(
      (a) => a.payload?.url,
    );
    const anexos: AnexoGravado[] = brutos.map(anexoGravado);

    const texto =
      evento.message?.text?.trim() ||
      ROTULO_ANEXO[evento.message?.attachments?.[0]?.type ?? ""] ||
      "[mensagem do Direct]";

    // Resposta citando: o retrato da citada (contato que já existia) ou o
    // story a que a pessoa respondeu.
    const replyTo = evento.message?.reply_to;
    const citadaId = replyTo?.mid?.trim() || null;
    const citada =
      citadaId && contato
        ? await acharInteracaoPorIdMeta(service, contato.id, citadaId).catch(
            (e: unknown) => {
              console.error(
                `[webhook instagram] citada ${citadaId}: ${motivoDaFalha(e)}`,
              );
              return null;
            },
          )
        : null;
    const respostaA: RespostaAGravada | null = citadaId
      ? citada
        ? retratoDaCitada(citada, citadaId, contato?.nome ?? null)
        : { id: citadaId }
      : replyTo?.story?.url || replyTo?.story?.id
        ? {
            story: {
              id: replyTo.story.id ?? null,
              url: replyTo.story.url ?? null,
            },
          }
        : null;

    // Nova tentativa usa a hora de agora na conversa: a hora do evento,
    // minutos ou horas atrás, puxaria ultima_interacao_em para trás de
    // mensagens que entraram depois.
    const agora = new Date(
      novaTentativa ? Date.now() : (evento.timestamp ?? Date.now()),
    ).toISOString();

    // A mensagem da nova tentativa, essa sim, entra com a hora do evento:
    // com a de agora, uma rajada que falhou ficaria invertida no chat e a
    // janela de 24h contaria da nova tentativa. A primeira fica com a hora
    // do banco: com a do evento, quem abrisse a conversa entre o envio e a
    // chegada deixaria a mensagem como lida sem tê-la visto.
    const criadoEm = novaTentativa ? horaOriginal(evento.timestamp) : undefined;
    // A primeira resposta, se for esta: na nova tentativa, a hora original da
    // mensagem; na primeira, a hora do evento (a mensagem fica com a do banco).
    const respondeuEm = criadoEm ?? agora;

    let leadId: string;
    let contatoNovo = false;
    if (contato) {
      await reabrirConversa(
        service,
        contato,
        agora,
        respondeuEm,
        novaTentativa,
      );
      leadId = contato.id;
      renovarFoto(service, leadId, igsid);
    } else {
      const criado = await criarContato(service, igsid, agora, respondeuEm);
      leadId = criado.id;
      contatoNovo = criado.criado;
    }

    const metadados: Record<string, unknown> = {
      canal: "instagram",
      message_id: mid,
      igsid,
      ...(anexos.length > 0 ? { anexos } : {}),
      ...(respostaA ? { resposta_a: respostaA } : {}),
    };
    const { data: interacao, error: erroInteracao } = await service
      .from("lead_interactions")
      .insert({
        lead_id: leadId,
        tipo: "mensagem_recebida",
        conteudo: texto,
        metadados,
        ...(criadoEm ? { criado_em: criadoEm } : {}),
      })
      .select("id")
      .single();

    if (erroInteracao) {
      // Sem a interação gravada, o evento não pode virar "processado": a
      // falha fica em webhook_events.erro e a passada tenta de novo.
      throw new Error(`Falha ao gravar a mensagem: ${erroInteracao.message}`);
    }

    // Fora do horário ou contato novo: a resposta automática sai depois do
    // 200 (webhooks/automaticas.ts). O eco do que nós mandamos nem chega
    // aqui (is_echo, no POST). Só na primeira tentativa: a nova tentativa
    // traz uma mensagem antiga, e a resposta chegaria fora de hora.
    if (!novaTentativa) {
      agendarRespostaAutomatica(service, {
        leadId,
        canal: "instagram",
        destino: igsid,
        contatoNovo,
        chegouEm: new Date(),
      });
    }

    // O link dos anexos expira: a cópia sai depois da resposta à Meta, e a
    // mensagem já aparece no chat com o link original enquanto isso.
    if (brutos.some((a) => regraAnexoDirect(a.type))) {
      const interacaoId = interacao.id as string;
      after(() =>
        hospedarAnexosDirect(
          service,
          interacaoId,
          mid,
          metadados,
          brutos,
          anexos,
        ),
      );
    }

    await concluirEvento(service, "instagram", eventoId, registro);
  } catch (e) {
    await concluirEvento(service, "instagram", eventoId, registro, e);
  }
}
