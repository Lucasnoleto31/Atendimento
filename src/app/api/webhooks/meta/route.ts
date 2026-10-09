import { createHmac, timingSafeEqual } from "node:crypto";
import { after, NextResponse, type NextRequest } from "next/server";
import { createServiceClient } from "@/lib/supabase/server";
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
  eventoDoLeadAds,
  registrarLeadAds,
  type ValorLeadAds,
} from "@/app/api/webhooks/lead-ads";
import { variantesTelefone } from "@/lib/telefone";
import { escolherVendedor } from "@/lib/distribuicao";
import { formatarData } from "@/lib/format";
import { hospedarMidiaMeta } from "@/lib/whatsapp";
import {
  acharInteracaoPorIdMeta,
  comReacao,
  regravarInteracao,
  retratoDaCitada,
  type ContatoGravado,
  type EdicaoGravada,
  type LinhaParaGravar,
  type LocalizacaoGravada,
  type RespostaAGravada,
} from "@/app/(app)/chat/metadados";

/**
 * Webhook do WhatsApp Cloud API (Meta).
 *
 * GET  — verificação do endpoint: a Meta manda hub.verify_token e espera o
 *        hub.challenge de volta.
 * POST — eventos. A assinatura X-Hub-Signature-256 é validada com o
 *        META_APP_SECRET; o evento bruto fica em webhook_events (deduplicado
 *        pelo id da mensagem), cada mensagem recebida vira contato +
 *        interação e cada recibo vira os ✓✓ da mensagem enviada. A
 *        mensagem que falhou ao gravar volta pela passada de
 *        reprocessamento (webhooks/eventos.ts), depois da resposta. A
 *        resposta automática (fora do horário, boas-vindas) também sai
 *        depois dela (webhooks/automaticas.ts). Reação, apagada e editada
 *        não viram linha: mexem nos metadados da mensagem a que se referem
 *        (chat/metadados.ts). O formulário de anúncio (field "leadgen")
 *        vira contato com etiqueta (webhooks/lead-ads.ts).
 *
 * Cada await é uma ida ao banco (ou à Meta): o que não depende de nada sai
 * junto (Promise.all) e o contato é atualizado uma vez só por mensagem.
 */

type Service = ReturnType<typeof createServiceClient>;

export async function GET(request: NextRequest) {
  const params = request.nextUrl.searchParams;
  const modo = params.get("hub.mode");
  const token = params.get("hub.verify_token");
  const challenge = params.get("hub.challenge");
  const esperado = process.env.META_WEBHOOK_VERIFY_TOKEN;

  if (modo === "subscribe" && esperado && token === esperado && challenge) {
    return new Response(challenge, { status: 200 });
  }

  return new Response("Forbidden", { status: 403 });
}

function assinaturaValida(corpo: string, assinatura: string | null): boolean {
  const segredo = process.env.META_APP_SECRET;
  // Sem segredo: aceita só em desenvolvimento. Em produção o endpoint é
  // público e escreve com service role — sem validação, recusa tudo.
  if (!segredo) return process.env.NODE_ENV !== "production";
  if (!assinatura?.startsWith("sha256=")) return false;

  const esperada = createHmac("sha256", segredo).update(corpo).digest("hex");
  const recebida = assinatura.slice("sha256=".length);

  if (esperada.length !== recebida.length) return false;
  return timingSafeEqual(Buffer.from(esperada), Buffer.from(recebida));
}

type MidiaMeta = {
  id?: string;
  mime_type?: string;
  caption?: string;
  filename?: string;
  /** Áudio gravado na hora no app (a mensagem de voz). */
  voice?: boolean;
};

/** O contato compartilhado (type "contacts"): só o nome é garantido. */
type ContatoMeta = {
  name?: { formatted_name?: string; first_name?: string; last_name?: string };
  phones?: { phone?: string; wa_id?: string; type?: string }[];
  emails?: { email?: string }[];
  org?: { company?: string };
};

/** O conteúdo novo de uma edição (o mesmo formato de uma mensagem). */
type ConteudoEditado = {
  type?: string;
  text?: { body?: string };
  image?: { caption?: string };
  video?: { caption?: string };
  document?: { caption?: string };
};

type MensagemMeta = {
  id: string;
  from: string;
  type: string;
  timestamp?: string;
  text?: { body?: string };
  image?: MidiaMeta;
  audio?: MidiaMeta;
  video?: MidiaMeta;
  document?: MidiaMeta;
  sticker?: MidiaMeta;
  // Reação a uma mensagem: emoji vazio = o cliente removeu a reação.
  reaction?: { message_id?: string; emoji?: string };
  button?: { text?: string; payload?: string };
  interactive?: {
    button_reply?: { title?: string };
    list_reply?: { title?: string };
  };
  /** Resposta citando (id = wamid da citada, nossa ou do cliente) e o selo
   *  de encaminhada. */
  context?: {
    from?: string;
    id?: string;
    forwarded?: boolean;
    frequently_forwarded?: boolean;
  };
  location?: {
    latitude?: number | string;
    longitude?: number | string;
    name?: string;
    address?: string;
    url?: string;
  };
  contacts?: ContatoMeta[];
  /** O cliente apagou para todos (só número em Coexistence, até 2 dias). */
  revoke?: { original_message_id?: string };
  /** O cliente editou (só Coexistence, até 15 minutos). */
  edit?: { original_message_id?: string; message?: ConteudoEditado };
  /** Tipo que a API não entrega; a edição chega assim enquanto a Meta não
   *  a suporta (unsupported.type "edit"). */
  unsupported?: { type?: string };
};

type StatusMeta = {
  id?: string;
  status?: string;
  errors?: {
    code?: number;
    title?: string;
    message?: string;
    error_data?: { details?: string };
  }[];
};

/** Tradução dos códigos de falha mais comuns da Graph API. */
function descreverErroMeta(erro: NonNullable<StatusMeta["errors"]>[number]) {
  switch (erro.code) {
    case 131047:
      return "Janela de 24h fechada. Fora dela só template aprovado chega.";
    case 131030:
      return "Número fora da lista de destinatários de teste (app em modo desenvolvimento).";
    case 190:
      return "Token da Meta inválido ou expirado.";
    case 131026:
      return "Não entregue. O número pode não ter WhatsApp ou bloqueou a empresa.";
    case 131050:
      return "O cliente desativou mensagens de marketing da sua empresa no WhatsApp. Template de utilidade e resposta na janela de 24h ainda chegam.";
    case 131049:
      return "A Meta segurou o envio para preservar o engajamento (limite de marketing por usuário). Tente mais tarde ou por outro caminho.";
    case 130472:
      // Grupo de controle da Meta: ~1% dos usuários não recebe template de
      // marketing de empresa nenhuma. Repetir dá o mesmo erro.
      return "Este número está no grupo de teste da Meta e não recebe template de marketing de nenhuma empresa. Fale por outro caminho (ligação, e-mail) ou espere ele te mandar mensagem primeiro.";
    default:
      return (
        erro.error_data?.details ??
        erro.title ??
        erro.message ??
        "Falha no envio."
      );
  }
}

type ValorMeta = {
  metadata?: { phone_number_id?: string };
  contacts?: { wa_id?: string; profile?: { name?: string } }[];
  messages?: MensagemMeta[];
  statuses?: StatusMeta[];
  // field "phone_number_quality_update": a qualidade do número É o canal
  // inteiro da mesa (incidente de 24/08). O formato varia por versão da API:
  // às vezes vem event (FLAGGED/UNFLAGGED), às vezes quality_score/rating.
  display_phone_number?: string;
  event?: string;
  current_limit?: string;
  quality_score?: { score?: string } | string;
  quality_rating?: string;
};

const ROTULO_TIPO_META: Record<string, string> = {
  image: "[imagem]",
  audio: "[áudio]",
  video: "[vídeo]",
  document: "[arquivo]",
  sticker: "[figurinha]",
  location: "[localização]",
  contacts: "[contato]",
  unsupported: "[formato não suportado]",
};

/**
 * Chegam como mensagem, mas não são o contato escrevendo uma: o aviso do
 * sistema (troca de número) e o formato que a API não entrega (enquete,
 * visualização única, a edição enquanto a Meta não a suporta). Entram no
 * histórico e não ganham resposta automática. Reação, apagada e editada nem
 * chegam a virar linha (ehEventoSobreMensagem).
 */
const SEM_RESPOSTA_AUTOMATICA = new Set([
  "reaction",
  "system",
  "unsupported",
  "revoke",
  "edit",
]);

export async function POST(request: NextRequest) {
  const corpo = await request.text();

  if (!assinaturaValida(corpo, request.headers.get("x-hub-signature-256"))) {
    return new Response("Invalid signature", { status: 401 });
  }

  let payload: {
    entry?: {
      time?: number;
      changes?: { field?: string; value?: ValorMeta }[];
    }[];
  };
  try {
    payload = JSON.parse(corpo);
  } catch {
    return new Response("Bad request", { status: 400 });
  }

  const service = createServiceClient();

  for (const entry of payload.entry ?? []) {
    for (const change of entry.changes ?? []) {
      const valor = change.value;
      if (!valor) continue;

      // Mudança de qualidade do número: registra e segue — nunca pode
      // atrapalhar o processamento de mensagens. Field que esta rota não
      // trata chega sem statuses nem messages e passa reto pelos laços.
      if (change.field === "phone_number_quality_update") {
        await registrarQualidadeNumero(service, valor, entry.time);
        continue;
      }

      // Formulário do Facebook/Instagram (Lead Ads): a Meta manda só os
      // ids, e as respostas vêm de uma leitura na Graph API.
      if (change.field === "leadgen") {
        await registrarLeadAds(service, valor as ValorLeadAds);
        continue;
      }

      // Recibos: sent/delivered/read/failed viram os ✓✓ do chat.
      for (const status of valor.statuses ?? []) {
        await processarRecibo(service, status);
      }

      for (const mensagem of valor.messages ?? []) {
        await receberMensagem(service, valor, mensagem);
      }
    }
  }

  // Mensagem que falhou ao gravar não volta pela Meta (ela só reenvia o que
  // não recebeu 200): volta pela passada, depois da resposta.
  if (passadaLiberada("meta")) {
    after(() =>
      reprocessarPendentes(service).catch((e: unknown) =>
        console.error(
          `[webhook meta] passada de reprocessamento: ${e instanceof Error ? e.message : String(e)}`,
        ),
      ),
    );
  }

  // Sempre 200 rápido: a Meta corta webhooks que falham repetidamente.
  return NextResponse.json({ ok: true });
}

/**
 * Nova tentativa das mensagens e dos formulários de anúncio que falharam, a
 * partir do payload guardado em webhook_events. A qualidade do número fica
 * de fora: rodada fora de ordem, gravaria um estado velho por cima do atual
 * (e o painel busca a qualidade ao vivo de qualquer jeito).
 *
 * O Lead Ads volta pela passada: a leitura na Meta e as gravações falham
 * por um instante, a Meta não reenvia o que recebeu 200, e o payload
 * guardado (leadgen_id, form_id, ad_id) basta para ler o formulário de
 * novo. Sem token, as tentativas só repetem o motivo; com o token posto
 * dentro das duas horas e meia delas, o contato entra sozinho. O formulário
 * sem um telefone que sirva não chega aqui: fecha na primeira tentativa
 * (FalhaDefinitiva, em eventos.ts), porque as respostas não mudam.
 */
async function reprocessarPendentes(service: Service) {
  const pendentes = await reivindicarPendentes(service, "meta", ["quality-"]);
  for (const { eventoId, payload, registro } of pendentes) {
    if (eventoId.startsWith("leadgen-")) {
      const formulario = payload as ValorLeadAds;
      if (eventoDoLeadAds(formulario) !== eventoId) {
        await concluirEvento(
          service,
          "meta",
          eventoId,
          registro,
          new Error("O formulário não está no payload guardado."),
        );
        continue;
      }
      await registrarLeadAds(service, formulario, registro);
      continue;
    }
    const valor = payload as ValorMeta;
    const mensagem = valor.messages?.find((m) => m.id === eventoId);
    if (!mensagem) {
      await concluirEvento(
        service,
        "meta",
        eventoId,
        registro,
        new Error("A mensagem não está no payload guardado."),
      );
      continue;
    }
    await receberMensagem(service, valor, mensagem, registro);
  }
}

/** Ordem dos recibos: um atrasado não rebaixa o ✓✓. Falha é final.
 *  "played" é a mensagem de voz ouvida (o microfone azul do app). */
const ORDEM_RECIBO = new Map<string, number>([
  ["sent", 1],
  ["delivered", 2],
  ["read", 3],
  ["played", 4],
  ["failed", 5],
]);

type Envio = {
  id: string;
  lead_id: string | null;
  metadados: Record<string, unknown> | null;
};

/**
 * Até quando o recibo de uma resposta automática é procurado. Ela fica como
 * nota, e a busca anda pelas notas desse intervalo: o "lida" pode chegar
 * dias depois, mas não meses.
 */
const JANELA_RECIBO_AUTOMATICA_MS = 30 * 86_400_000;

/**
 * A mensagem enviada a que o recibo se refere. O wamid vive dentro do
 * jsonb, sem índice próprio: a busca anda pelo índice (tipo, criado_em) da
 * mensagem enviada mais nova para a mais antiga e para na primeira que
 * casa — recibo é quase sempre de mensagem recente.
 */
async function acharEnvio(
  service: Service,
  wamid: string,
): Promise<Envio | null> {
  const { data } = await service
    .from("lead_interactions")
    .select("id, lead_id, metadados")
    .eq("tipo", "mensagem_enviada")
    .eq("metadados->>message_id", wamid)
    .order("criado_em", { ascending: false })
    .limit(1)
    .maybeSingle();
  if (data) return data as Envio;

  // Envio com vários anexos: cada arquivo tem um wamid próprio, guardados
  // em metadados.message_ids — o recibo casa por qualquer um. A resposta
  // automática (fora do horário, boas-vindas) é nota com o wamid em
  // message_id (webhooks/automaticas.ts). As duas buscas não dependem uma
  // da outra: saem juntas.
  const [{ data: porAnexo }, { data: automatica }] = await Promise.all([
    service
      .from("lead_interactions")
      .select("id, lead_id, metadados")
      .eq("tipo", "mensagem_enviada")
      .contains("metadados", { message_ids: [wamid] })
      .order("criado_em", { ascending: false })
      .limit(1)
      .maybeSingle(),
    service
      .from("lead_interactions")
      .select("id, lead_id, metadados")
      .eq("tipo", "nota")
      .eq("metadados->>message_id", wamid)
      .not("metadados->>automatica", "is", null)
      .gte(
        "criado_em",
        new Date(Date.now() - JANELA_RECIBO_AUTOMATICA_MS).toISOString(),
      )
      .order("criado_em", { ascending: false })
      .limit(1)
      .maybeSingle(),
  ]);
  return ((porAnexo ?? automatica) as Envio | null) ?? null;
}

async function processarRecibo(service: Service, status: StatusMeta) {
  if (!status.id || !status.status || !ORDEM_RECIBO.has(status.status)) {
    return;
  }
  const envio = await acharEnvio(service, status.id);
  if (!envio) return;

  const falha = status.errors?.[0];
  const erro = falha ? descreverErroMeta(falha) : null;
  const metadados = envio.metadados ?? {};

  // Recusou marketing: marca o contato para o disparo em massa pular —
  // falha repetida derruba a reputação do número.
  const recusouMarketing =
    falha?.code === 131050 ||
    /stop receiving marketing/i.test(
      `${falha?.title ?? ""} ${falha?.message ?? ""} ${falha?.error_data?.details ?? ""}`,
    );

  // As três escritas não dependem uma da outra: saem juntas.
  await Promise.all([
    gravarRecibo(service, envio.id, metadados, status.status, erro),
    recusouMarketing && envio.lead_id
      ? service
          .from("leads")
          .update({ marketing_bloqueado_em: new Date().toISOString() })
          .eq("id", envio.lead_id)
      : null,
    // A Meta aceita o envio e só depois avisa que não entregou. Sem devolver
    // isso para campanha_envios, a tela da campanha mostraria zero recusa
    // enquanto o número apanha na prática.
    erro && envio.lead_id && typeof metadados.campanha_id === "string"
      ? service
          .from("campanha_envios")
          .update({ erro })
          .eq("campanha_id", metadados.campanha_id)
          .eq("lead_id", envio.lead_id)
          .is("erro", null)
      : null,
  ]);
}

/**
 * Grava o recibo sem rebaixar o ✓✓ e sem atropelar outra gravação da mesma
 * mensagem: sent, delivered e read podem chegar em POSTs simultâneos (e a
 * reação do cliente também mexe nos metadados), e o update reescreve o
 * jsonb inteiro. A trava do rev (chat/metadados.ts) relê e decide de novo
 * quando outra gravação entrou no meio, preservando o que ela escreveu.
 */
async function gravarRecibo(
  service: Service,
  id: string,
  lido: Record<string, unknown>,
  novo: string,
  erro: string | null,
) {
  const r = await regravarInteracao(
    service,
    id,
    ({ metadados }) => {
      const atual =
        typeof metadados.status_envio === "string"
          ? metadados.status_envio
          : null;
      if (
        novo !== "failed" &&
        atual &&
        (ORDEM_RECIBO.get(atual) ?? 0) >= (ORDEM_RECIBO.get(novo) ?? 0)
      ) {
        return null;
      }
      return {
        metadados: {
          ...metadados,
          status_envio: novo,
          ...(erro ? { erro_envio: erro } : {}),
        },
      };
    },
    // Recibo não muda o texto: a primeira tentativa vai com os metadados que
    // a busca do envio já leu.
    { metadados: lido, conteudo: null },
  );
  if (!r.ok) console.error(`[webhook meta] recibo de ${id}: ${r.erro}`);
}

/**
 * Evento de qualidade do número (phone_number_quality_update): grava o estado
 * em settings.numero_qualidade para o painel de Campanhas mostrar. No
 * incidente de 24/08 a qualidade caiu para amarelo e ninguém viu no CRM —
 * souberam pelo painel da Meta.
 */
async function registrarQualidadeNumero(
  service: Service,
  valor: ValorMeta,
  entryTime?: number,
) {
  // O timestamp do entry é estável entre as tentativas de reenvio da Meta.
  const eventoId = `quality-${entryTime ?? Date.now()}`;
  const registro = await registrarEvento(service, "meta", eventoId, valor, {
    retomar: false,
  });
  if (registro.tipo === "duplicado") return;

  try {
    const bruto =
      typeof valor.quality_score === "string"
        ? valor.quality_score
        : (valor.quality_score?.score ?? valor.quality_rating);
    // Sem score explícito, o event ainda diz a direção: FLAGGED = caiu.
    const rating =
      bruto?.trim().toUpperCase() ||
      (valor.event === "FLAGGED"
        ? "RED"
        : valor.event === "UNFLAGGED"
          ? "GREEN"
          : null);

    const { error } = await service.from("settings").upsert({
      chave: "numero_qualidade",
      valor: {
        rating,
        limite: valor.current_limit ?? null,
        evento: valor.event ?? null,
        telefone: valor.display_phone_number ?? null,
        em: new Date().toISOString(),
      },
      atualizado_em: new Date().toISOString(),
    });
    if (error) throw new Error(error.message);

    await concluirEvento(service, "meta", eventoId, registro);
  } catch (e) {
    await concluirEvento(service, "meta", eventoId, registro, e);
  }
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
  telefone_e164: string | null;
  primeira_resposta_em: string | null;
  whatsapp_instance_id: string | null;
};

const CAMPOS_PERDA =
  "status, perda_motivo, perda_detalhe, perdido_em, marketing_bloqueado_em";

const CAMPOS_CONTATO =
  `id, nome, telefone_e164, primeira_resposta_em, whatsapp_instance_id, ${CAMPOS_PERDA}`;

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
 * A busca do contato é do começo da mensagem, antes da mídia: para quem
 * estava perdido, a perda é relida perto do update. Numa rajada, a mensagem
 * que chega depois acha o contato já fora de perdido e não repete a nota.
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
 * Contas WhatsApp BR antigas chegam da Meta sem o nono dígito (55+DDD+8).
 * A busca considera as duas grafias para não duplicar o contato. A perda e
 * a trava de marketing vêm para o caso do lead marcado perdido, e a
 * primeira resposta, para gravá-la só se estiver vazia (ver
 * reabrirConversa).
 */
async function buscarContato(
  service: Service,
  telefone: string,
): Promise<{ contato: Contato | null; erro: string | null }> {
  const { data, error } = await service
    .from("leads")
    .select(CAMPOS_CONTATO)
    .in("telefone_e164", variantesTelefone(telefone));
  if (error) return { contato: null, erro: error.message };
  const candidatos = (data ?? []) as Contato[];
  return {
    contato:
      candidatos.find((l) => l.telefone_e164 === telefone) ??
      candidatos[0] ??
      null,
    erro: null,
  };
}

/**
 * A instância que recebeu: o contato novo nasce ligado a ela
 * (whatsapp_instance_id) e o dono dela é o responsável. Quase toda mensagem
 * chega pelo mesmo número, então a resposta fica um minuto em memória
 * (inclusive a de "sem instância" e a de "sem dono"): trocar o dono em
 * Configurações leva até um minuto para valer aqui.
 */
type Instancia = { id: string | null; vendedorId: string | null };

const SEM_INSTANCIA: Instancia = { id: null, vendedorId: null };
const TTL_INSTANCIA_MS = 60_000;
const cacheInstancia = new Map<string, Instancia & { expira: number }>();

async function instanciaQueRecebeu(
  service: Service,
  phoneNumberId: string | null,
): Promise<Instancia> {
  if (!phoneNumberId) return SEM_INSTANCIA;
  const guardada = cacheInstancia.get(phoneNumberId);
  if (guardada && Date.now() < guardada.expira) return guardada;

  const { data, error } = await service
    .from("whatsapp_instances")
    .select("id, vendedor_id")
    .eq("meta_phone_number_id", phoneNumberId)
    .maybeSingle();
  const instancia: Instancia = {
    id: (data?.id as string | null | undefined) ?? null,
    vendedorId: (data?.vendedor_id as string | null | undefined) ?? null,
  };
  // Falha de leitura não entra no cache: a próxima mensagem tenta de novo.
  if (!error) {
    cacheInstancia.set(phoneNumberId, {
      ...instancia,
      expira: Date.now() + TTL_INSTANCIA_MS,
    });
  }
  return instancia;
}

/** O anexo como fica em metadados.anexos, que a tela lê (paraMensagem). */
type AnexoGravado = {
  tipo: string;
  url: string;
  mime: string;
  tamanho: number;
  nome?: string;
  voz?: true;
};

/**
 * Mídia recebida: baixa da Meta (a URL deles expira) e hospeda no Storage.
 * A figurinha tem tipo próprio (a tela a mostra sem bolha); o documento
 * leva o nome do arquivo e o áudio gravado no app, a marca de voz.
 */
async function hospedarAnexo(
  mediaId: string,
  mensagem: MensagemMeta,
  midia: MidiaMeta,
): Promise<AnexoGravado[]> {
  try {
    const hospedada = await hospedarMidiaMeta(mediaId);
    if (!hospedada) return [];
    const prefixo = hospedada.mime.split("/")[0];
    const nome = midia.filename?.trim();
    return [
      {
        tipo:
          mensagem.type === "sticker"
            ? "sticker"
            : prefixo === "image" || prefixo === "audio" || prefixo === "video"
              ? prefixo
              : "file",
        url: hospedada.url,
        mime: hospedada.mime,
        tamanho: hospedada.tamanho,
        ...(nome ? { nome } : {}),
        ...(mensagem.type === "audio" && midia.voice
          ? { voz: true as const }
          : {}),
      },
    ];
  } catch (e) {
    // Sem a mídia, a mensagem ainda entra com o rótulo ([imagem], [áudio]…).
    console.error(
      `[webhook meta] mídia ${mediaId} não hospedada: ${e instanceof Error ? e.message : String(e)}`,
    );
    return [];
  }
}

/**
 * Cliente escreveu: a conversa resolvida ou adiada volta para a caixa de
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
 * gatilho limpá-lo.
 *
 * A primeira resposta (respondeuEm, ver receberMensagem) só é gravada se
 * estava vazia: vai num update à parte, condicionado a ela continuar
 * vazia, e só quando a busca a leu vazia. Assim nenhuma mensagem
 * sobrescreve a de outra, nem numa rajada. O número que recebeu
 * (whatsapp_instance_id) segue a mesma regra, como no sistema original:
 * só preenche o vazio.
 *
 * Na nova tentativa, chat_lido_em também zera (o efeito de "marcar não
 * lida"): a mensagem entra com a hora original, e quem abriu a conversa
 * depois dela não a viu, porque ela ainda não estava gravada.
 *
 * Falha nos updates não derruba a mensagem: ela entra no histórico do
 * mesmo jeito e o motivo fica no log. A nota da perda, sim (ver
 * anotarSaidaDePerdido).
 */
async function reabrirConversa(
  service: Service,
  lido: Contato,
  agora: string,
  respondeuEm: string,
  marcarNaoLida: boolean,
  instanciaId: string | null,
) {
  const contato =
    lido.status === "perdido" ? await relerPerda(service, lido) : lido;
  const perdido = contato.status === "perdido";
  if (perdido) await anotarSaidaDePerdido(service, contato);
  const travarMarketing =
    perdido &&
    contato.marketing_bloqueado_em === null &&
    MOTIVOS_SEM_MARKETING.has(contato.perda_motivo ?? "");

  const [{ error }, primeira, numero] = await Promise.all([
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
    contato.whatsapp_instance_id === null && instanciaId
      ? service
          .from("leads")
          .update({ whatsapp_instance_id: instanciaId })
          .eq("id", contato.id)
          .is("whatsapp_instance_id", null)
      : null,
  ]);
  if (error) {
    console.error(
      `[webhook meta] conversa ${contato.id} não reabriu: ${error.message}`,
    );
  }
  if (primeira?.error) {
    console.error(
      `[webhook meta] primeira resposta de ${contato.id} não gravada: ${primeira.error.message}`,
    );
  }
  if (numero?.error) {
    console.error(
      `[webhook meta] número que recebeu ${contato.id} não gravado: ${numero.error.message}`,
    );
  }
}

/**
 * Contato novo. O responsável é o dono da instância; sem dono nela, cai na
 * distribuição automática, e a atribuição fica registrada no fio. Nasce no
 * canal WhatsApp, ligado à instância que recebeu, e com a primeira
 * resposta: foi ele quem escreveu. Etapa e status ficam com o gatilho
 * lead_respondeu_avanca (0040), que roda quando a mensagem entra.
 *
 * Quando outro POST criou o mesmo contato no meio do caminho, devolve o
 * contato dele em `existente`: quem chamou reabre a conversa na hora certa,
 * como faz com qualquer contato que já existia.
 */
async function criarContato(
  service: Service,
  dados: {
    telefone: string;
    nomePerfil: string | undefined;
    instancia: Instancia;
    agora: string;
    respondeuEm: string;
  },
): Promise<{ id: string; existente: Contato | null }> {
  // O canal e quem atende não dependem um do outro: saem juntos. Sem a
  // leitura do canal, o contato nasce sem ele em vez de perder a mensagem.
  const [canal, atendente] = await Promise.all([
    service.from("channels").select("id").eq("slug", "whatsapp").maybeSingle(),
    dados.instancia.vendedorId ? null : escolherVendedor(service),
  ]);

  const { data: novo, error } = await service
    .from("leads")
    .insert({
      nome: dados.nomePerfil || `WhatsApp ${dados.telefone.slice(-4)}`,
      telefone_e164: dados.telefone,
      channel_id: (canal.data?.id as string | undefined) ?? null,
      whatsapp_instance_id: dados.instancia.id,
      entrada_motivo: "webhook_meta",
      responsavel_id: dados.instancia.vendedorId ?? atendente?.id ?? null,
      primeira_resposta_em: dados.respondeuEm,
      ultima_interacao_em: dados.agora,
    })
    .select("id")
    .single();

  if (error) {
    // Corrida: duas mensagens do MESMO contato novo em POSTs paralelos — o
    // perdedor do índice único de telefone reaproveita o contato do outro,
    // em vez de perder a mensagem para sempre.
    if (error.code !== "23505") throw new Error(error.message);
    const { data: corrida } = await service
      .from("leads")
      .select(CAMPOS_CONTATO)
      .eq("telefone_e164", dados.telefone)
      .maybeSingle();
    if (!corrida) throw new Error(error.message);
    const existente = corrida as Contato;
    return { id: existente.id, existente };
  }

  if (atendente) {
    await service.from("lead_interactions").insert({
      lead_id: novo.id,
      tipo: "atribuicao",
      conteudo: `Atendimento atribuído a ${atendente.nome} (distribuição automática)`,
      metadados: { via: "distribuicao_automatica" },
    });
  }
  return { id: novo.id as string, existente: null };
}

/** A hora do evento pela Meta (segundos), ou agora. */
function horaDaMeta(timestamp: string | undefined): string {
  const ms = Number(timestamp) * 1000;
  return Number.isFinite(ms) && ms > 0
    ? new Date(ms).toISOString()
    : new Date().toISOString();
}

/** As coordenadas que a Meta manda (número; às vezes texto). */
function lerLocalizacaoMeta(mensagem: MensagemMeta): LocalizacaoGravada | null {
  const l = mensagem.location;
  if (mensagem.type !== "location" || !l) return null;
  const latitude = Number(l.latitude);
  const longitude = Number(l.longitude);
  if (!Number.isFinite(latitude) || !Number.isFinite(longitude)) return null;
  return {
    latitude,
    longitude,
    nome: l.name?.trim() || null,
    endereco: l.address?.trim() || null,
    url: l.url?.trim() || null,
  };
}

/** O cartão de contato compartilhado: nome, telefones, e-mails e empresa. */
function lerContatosMeta(mensagem: MensagemMeta): ContatoGravado[] {
  if (mensagem.type !== "contacts") return [];
  return (mensagem.contacts ?? []).flatMap((c) => {
    const nome =
      c.name?.formatted_name?.trim() ||
      [c.name?.first_name, c.name?.last_name].filter(Boolean).join(" ").trim();
    if (!nome) return [];
    return [
      {
        nome,
        telefones: (c.phones ?? []).flatMap((t) =>
          t.phone?.trim()
            ? [
                {
                  numero: t.phone.trim(),
                  wa_id: t.wa_id ?? null,
                  tipo: t.type ?? null,
                },
              ]
            : [],
        ),
        emails: (c.emails ?? []).flatMap((e) =>
          e.email?.trim() ? [e.email.trim()] : [],
        ),
        empresa: c.org?.company?.trim() || null,
      },
    ];
  });
}

/** Até quando a mensagem de origem de uma reação pode estar chegando. */
const ESPERA_PELA_ORIGEM_MS = 3 * 60_000;

/** Reação, apagada ou editada: um aviso sobre uma mensagem que já existe. */
function ehEventoSobreMensagem(mensagem: MensagemMeta): boolean {
  return (
    mensagem.type === "reaction" ||
    mensagem.type === "revoke" ||
    mensagem.type === "edit" ||
    (mensagem.type === "unsupported" && mensagem.unsupported?.type === "edit")
  );
}

/** O texto novo de uma edição: o corpo ou a legenda. */
function textoEditado(conteudo: ConteudoEditado | undefined): string | null {
  return (
    conteudo?.text?.body?.trim() ||
    conteudo?.image?.caption?.trim() ||
    conteudo?.video?.caption?.trim() ||
    conteudo?.document?.caption?.trim() ||
    null
  );
}

/**
 * Grava a reação, a apagada ou a edição na mensagem a que ela se refere,
 * achada pelo id da Meta entre as deste contato. Sem contato ou sem a
 * mensagem no histórico (mandada pelo aparelho, antes do sistema), fica só
 * o aviso no log: não há bolha onde mostrar.
 */
async function aplicarEventoSobreMensagem(
  service: Service,
  contato: Contato | null,
  mensagem: MensagemMeta,
) {
  const em = horaDaMeta(mensagem.timestamp);
  const alvoId =
    mensagem.type === "reaction"
      ? mensagem.reaction?.message_id
      : mensagem.type === "revoke"
        ? mensagem.revoke?.original_message_id
        : (mensagem.edit?.original_message_id ?? mensagem.context?.id);
  if (!contato || !alvoId) {
    console.warn(
      `[webhook meta] ${mensagem.type} ${mensagem.id} sem ${contato ? "a mensagem de origem" : "contato"}: ignorado.`,
    );
    return;
  }
  const alvo = await acharInteracaoPorIdMeta(service, contato.id, alvoId);
  if (!alvo) {
    // A reação a uma mensagem que acabou de chegar pode vencer a corrida
    // contra ela (POSTs em paralelo): enquanto o evento é recente, a falha
    // manda para a passada, que tenta de novo em um minuto.
    if (Date.now() - Date.parse(em) < ESPERA_PELA_ORIGEM_MS) {
      throw new Error(`A mensagem ${alvoId} ainda não está no histórico.`);
    }
    console.warn(
      `[webhook meta] ${mensagem.type} ${mensagem.id}: a mensagem ${alvoId} não está no histórico.`,
    );
    return;
  }

  const mudar = ({ metadados, conteudo }: LinhaParaGravar) => {
    if (mensagem.type === "reaction") {
      const reacoes = comReacao(metadados.reacoes, {
        de: "contato",
        // Sem emoji = o cliente tirou a reação.
        emoji: mensagem.reaction?.emoji?.trim() ?? "",
        em,
      });
      return reacoes ? { metadados: { ...metadados, reacoes } } : null;
    }
    if (mensagem.type === "revoke") {
      // O texto fica no banco (é o registro do que chegou); a tela mostra
      // "Mensagem apagada".
      return metadados.apagada
        ? null
        : { metadados: { ...metadados, apagada: { por: "contato", em } } };
    }
    // Edição: a mais nova vence; o original é o de antes da primeira.
    const anterior = (metadados.editada ?? null) as EdicaoGravada | null;
    if (anterior?.em && Date.parse(anterior.em) > Date.parse(em)) return null;
    const novo = textoEditado(mensagem.edit?.message);
    const editada: EdicaoGravada = {
      em,
      original: anterior ? anterior.original : conteudo,
      vezes: (anterior?.vezes ?? 0) + 1,
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
  // Falha de gravação volta pela passada (o evento fica com o erro).
  if (!r.ok) throw new Error(`Falha ao gravar ${mensagem.type}: ${r.erro}`);
}

/**
 * `reivindicado` vem da passada de reprocessamento, que já tomou a linha do
 * evento para esta nova tentativa.
 */
async function receberMensagem(
  service: Service,
  valor: ValorMeta,
  mensagem: MensagemMeta,
  reivindicado?: Registro,
) {
  const telefone = (valor.contacts?.[0]?.wa_id ?? mensagem.from ?? "").replace(
    /\D/g,
    "",
  );
  const phoneNumberId = valor.metadata?.phone_number_id ?? null;

  // O registro do evento (dedup), a instância que recebeu e o contato não
  // dependem um do outro: uma ida ao banco em vez de três em fila.
  const [registro, instancia, busca] = await Promise.all([
    reivindicado ?? registrarEvento(service, "meta", mensagem.id, valor),
    instanciaQueRecebeu(service, phoneNumberId),
    telefone ? buscarContato(service, telefone) : null,
  ]);
  if (registro.tipo === "duplicado") return;

  try {
    const novaTentativa = registro.tipo === "novo" && registro.tentativa > 1;

    // Nova tentativa de mensagem que já está no histórico (só o desfecho se
    // perdeu): fecha o evento sem reabrir a conversa nem gravar de novo.
    if (novaTentativa && (await mensagemJaGravada(service, mensagem.id))) {
      await concluirEvento(service, "meta", mensagem.id, registro);
      return;
    }

    if (!telefone || !busca) throw new Error("Mensagem sem telefone.");
    if (busca.erro) throw new Error(`Falha ao buscar o contato: ${busca.erro}`);
    const contato = busca.contato;

    // Reação, apagada e editada mexem numa mensagem que já está no
    // histórico: não viram linha, não reabrem a conversa, não a marcam como
    // não lida e não ganham resposta automática.
    if (ehEventoSobreMensagem(mensagem)) {
      await aplicarEventoSobreMensagem(service, contato, mensagem);
      await concluirEvento(service, "meta", mensagem.id, registro);
      return;
    }

    const midia =
      mensagem.image ??
      mensagem.audio ??
      mensagem.video ??
      mensagem.document ??
      mensagem.sticker ??
      null;

    // Resposta de botão e de lista têm o conteúdo em campos próprios; sem
    // tratá-los, a equipe não via o que o cliente quis dizer. Localização e
    // contato levam o nome junto do rótulo, para a prévia da fila dizer algo.
    const localizacao = lerLocalizacaoMeta(mensagem);
    const contatos = lerContatosMeta(mensagem);
    const textoEspecial =
      mensagem.type === "button"
        ? mensagem.button?.text?.trim() || null
        : mensagem.type === "interactive"
          ? (mensagem.interactive?.button_reply?.title?.trim() ??
            mensagem.interactive?.list_reply?.title?.trim() ??
            null)
          : localizacao && (localizacao.nome || localizacao.endereco)
            ? `[localização] ${localizacao.nome ?? localizacao.endereco}`
            : contatos.length > 0
              ? `[contato] ${contatos.map((c) => c.nome).join(", ")}`
              : null;

    const texto =
      mensagem.text?.body?.trim() ||
      midia?.caption?.trim() ||
      textoEspecial ||
      ROTULO_TIPO_META[mensagem.type] ||
      `[${mensagem.type ?? "mensagem"} recebida]`;

    // Resposta citando: o retrato da citada vai junto, para a tela mostrar o
    // trecho mesmo quando ela é antiga demais para estar carregada.
    const citadaId = mensagem.context?.id?.trim() || null;
    const encaminhada = mensagem.context?.frequently_forwarded
      ? "muitas"
      : mensagem.context?.forwarded
        ? "uma"
        : null;

    // Nova tentativa grava a mensagem com a hora em que o cliente mandou:
    // com a de agora, uma rajada que falhou entraria invertida no chat e a
    // janela de 24h contaria da nova tentativa. A primeira fica com a hora do
    // banco: com a do WhatsApp, quem abrisse a conversa entre o envio e a
    // chegada deixaria a mensagem como lida sem tê-la visto.
    const criadoEm = novaTentativa
      ? horaOriginal(Number(mensagem.timestamp) * 1000)
      : undefined;
    // A primeira resposta, se for esta: na nova tentativa, a hora original da
    // mensagem; na primeira, a hora em que o webhook a recebeu, tirada antes
    // da mídia e por isso alguns segundos antes do criado_em do banco.
    const respondeuEm = criadoEm ?? new Date().toISOString();

    // A mídia (Graph, CDN e Storage, em série) corre junto com a criação do
    // contato novo, que nasce sem chat_lido_em. Contato que já existe
    // (inclusive o que outro POST acabou de criar) só é carimbado depois da
    // hospedagem, com o horário daquele momento: carimbado antes, uma
    // leitura da conversa durante a hospedagem deixaria chat_lido_em à frente
    // de ultima_interacao_em, e a mensagem que entra em seguida não contaria
    // como não lida. O carimbo continua vindo antes do insert, que é o que o
    // tempo real escuta. A citada só existe para contato que já existia, e a
    // busca dela corre junto.
    const [anexos, alvo, citada] = await Promise.all([
      midia?.id ? hospedarAnexo(midia.id, mensagem, midia) : [],
      contato
        ? { id: contato.id, existente: contato }
        : criarContato(service, {
            telefone,
            nomePerfil: valor.contacts?.[0]?.profile?.name?.trim(),
            instancia,
            agora: new Date().toISOString(),
            respondeuEm,
          }),
      citadaId && contato
        ? acharInteracaoPorIdMeta(service, contato.id, citadaId).catch(
            (e: unknown) => {
              // Sem o retrato, a resposta entra com o id só: a tela ainda
              // acha a citada se ela estiver carregada.
              console.error(
                `[webhook meta] citada ${citadaId}: ${e instanceof Error ? e.message : String(e)}`,
              );
              return null;
            },
          )
        : null,
    ]);
    const respostaA: RespostaAGravada | null = citadaId
      ? citada
        ? retratoDaCitada(citada, citadaId, contato?.nome ?? null)
        : {
            id: citadaId,
            // Quem a escreveu, pelo número que a Meta diz: o do contato ou
            // o nosso.
            de:
              (mensagem.context?.from ?? "").replace(/\D/g, "") === telefone
                ? "contato"
                : "equipe",
          }
      : null;
    if (alvo.existente) {
      await reabrirConversa(
        service,
        alvo.existente,
        new Date().toISOString(),
        respondeuEm,
        novaTentativa,
        instancia.id,
      );
    }
    const leadId = alvo.id;

    const { error: erroInteracao } = await service
      .from("lead_interactions")
      .insert({
        lead_id: leadId,
        tipo: "mensagem_recebida",
        conteudo: texto,
        metadados: {
          message_id: mensagem.id,
          tipo: mensagem.type,
          phone_number_id: phoneNumberId,
          ...(anexos.length > 0 ? { anexos } : {}),
          ...(respostaA ? { resposta_a: respostaA } : {}),
          ...(encaminhada ? { encaminhada } : {}),
          ...(localizacao ? { localizacao } : {}),
          ...(contatos.length > 0 ? { contatos } : {}),
        },
        ...(criadoEm ? { criado_em: criadoEm } : {}),
      });

    if (erroInteracao) {
      // Sem a interação gravada, o evento não pode virar "processado": a
      // falha fica em webhook_events.erro e a passada tenta de novo.
      throw new Error(`Falha ao gravar a mensagem: ${erroInteracao.message}`);
    }

    // Fora do horário ou contato novo: a resposta automática sai depois do
    // 200 (webhooks/automaticas.ts). Só na primeira tentativa: a nova
    // tentativa traz uma mensagem antiga, e a resposta chegaria fora de hora.
    if (!novaTentativa && !SEM_RESPOSTA_AUTOMATICA.has(mensagem.type)) {
      agendarRespostaAutomatica(service, {
        leadId,
        canal: "whatsapp",
        destino: telefone,
        contatoNovo: alvo.existente === null,
        chegouEm: new Date(),
        numeroQueRecebeu: phoneNumberId,
      });
    }

    await concluirEvento(service, "meta", mensagem.id, registro);
  } catch (e) {
    await concluirEvento(service, "meta", mensagem.id, registro, e);
  }
}
