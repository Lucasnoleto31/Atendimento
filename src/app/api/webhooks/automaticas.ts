import { after } from "next/server";
import type { createServiceClient } from "@/lib/supabase/server";
import { enviarTextoMeta, MetaSemResposta } from "@/lib/whatsapp";
import { descreverErroInstagram, enviarTextoInstagram } from "@/lib/instagram";
import {
  CHAVE_HORARIO,
  CHAVE_RESPOSTA,
  dentroDoHorario,
  INTERVALO_ENTRE_AUTOMATICAS_MS,
  lerHorario,
  lerResposta,
  textoDaResposta,
  VIA_AUTOMATICA,
  type HorarioAtendimento,
  type RespostaAutomatica,
  type TipoAutomatica,
} from "@/lib/automaticas";

/**
 * A resposta automática dos webhooks (fora do horário e boas-vindas), regra
 * em lib/automaticas.ts. A rota chama `agendarRespostaAutomatica` depois de
 * gravar a mensagem recebida, e o envio sai depois do 200 para a Meta
 * (after), sem atrasar a resposta.
 *
 * Quem decide se a mensagem conta é a rota: só a primeira tentativa de uma
 * mensagem do contato (nem recibo, nem reação, nem eco nosso). A nova
 * tentativa do reprocessamento (webhooks/eventos.ts) não chama, e a mensagem
 * antiga que volta da fila não ganha resposta horas depois.
 *
 * A resposta fica em lead_interactions como nota, com autor nulo e
 * metadados { automatica, via, sistema, canal, message_id, status_envio,
 * erro_envio }.
 * Nota, e não mensagem_enviada: a Caixa e o relatório leem mensagem_enviada
 * como resposta da equipe, e a conversa iria para Aguardando e contaria como
 * 1ª resposta. Como nota, ela continua esperando um atendente. O message_id
 * é o wamid (WhatsApp) ou o mid (Direct), na mesma chave das mensagens
 * enviadas, para o recibo da Meta achar a nota (acharEnvio, em meta/route).
 */

type Service = ReturnType<typeof createServiceClient>;

export type ChegadaParaResposta = {
  leadId: string;
  canal: "whatsapp" | "instagram";
  /** wa_id (só dígitos) no WhatsApp; IGSID no Direct. */
  destino: string;
  /** Contato criado agora pelo webhook, com esta primeira mensagem. */
  contatoNovo: boolean;
  /** Quando a mensagem chegou: decide dentro ou fora do horário. */
  chegouEm: Date;
  /** WhatsApp: o phone_number_id que recebeu a mensagem. */
  numeroQueRecebeu?: string | null;
};

type Configuracao = {
  horario: HorarioAtendimento;
  respostas: Record<TipoAutomatica, RespostaAutomatica>;
};

/**
 * A configuração fica um minuto em memória: quase toda mensagem chegaria
 * com as duas respostas desligadas, e cada uma seria uma ida ao banco.
 * Ligar, desligar ou mudar o texto em Configurações leva até um minuto para
 * valer aqui. Falha de leitura não entra no cache.
 */
const TTL_CONFIGURACAO_MS = 60_000;
let cacheConfiguracao: { dados: Configuracao; expira: number } | null = null;

async function lerConfiguracao(service: Service): Promise<Configuracao | null> {
  if (cacheConfiguracao && Date.now() < cacheConfiguracao.expira) {
    return cacheConfiguracao.dados;
  }
  const { data, error } = await service
    .from("settings")
    .select("chave, valor")
    .in("chave", [
      CHAVE_HORARIO,
      CHAVE_RESPOSTA.fora_do_horario,
      CHAVE_RESPOSTA.boas_vindas,
    ]);
  if (error) {
    console.error(
      `[resposta automática] configuração não lida: ${error.message}`,
    );
    return null;
  }
  const valorDe = new Map(
    ((data ?? []) as { chave: string; valor: unknown }[]).map((l) => [
      l.chave,
      l.valor,
    ]),
  );
  const dados: Configuracao = {
    horario: lerHorario(valorDe.get(CHAVE_HORARIO)),
    respostas: {
      fora_do_horario: lerResposta(
        valorDe.get(CHAVE_RESPOSTA.fora_do_horario),
        "fora_do_horario",
      ),
      boas_vindas: lerResposta(
        valorDe.get(CHAVE_RESPOSTA.boas_vindas),
        "boas_vindas",
      ),
    },
  };
  cacheConfiguracao = { dados, expira: Date.now() + TTL_CONFIGURACAO_MS };
  return dados;
}

/**
 * Uma resposta por vez para o mesmo contato nesta instância da função. Uma
 * rajada de mensagens fora do horário chega em seguida (no mesmo POST ou em
 * POSTs paralelos), e cada uma agenda a sua resposta: sem a fila, todas
 * conferiam "nenhuma resposta nas últimas 12h" antes de a primeira ser
 * gravada, e o contato recebia o aviso repetido. Na fila, a segunda já acha
 * a nota da primeira.
 */
const filaPorContato = new Map<string, Promise<void>>();

function naFilaDoContato(
  leadId: string,
  tarefa: () => Promise<void>,
): Promise<void> {
  const anterior = filaPorContato.get(leadId) ?? Promise.resolve();
  const atual = anterior.then(tarefa);
  const guardada = atual.catch(() => {});
  filaPorContato.set(leadId, guardada);
  void guardada.then(() => {
    if (filaPorContato.get(leadId) === guardada) filaPorContato.delete(leadId);
  });
  return atual;
}

/**
 * Qual resposta vale para esta mensagem, ou null. Fora do horário, só a de
 * fora do horário (nunca as duas); dentro, as boas-vindas, e só para o
 * contato que acabou de nascer.
 */
function respostaDaVez(
  config: Configuracao,
  chegada: ChegadaParaResposta,
): TipoAutomatica | null {
  if (!dentroDoHorario(config.horario, chegada.chegouEm)) {
    return config.respostas.fora_do_horario.ativo ? "fora_do_horario" : null;
  }
  return chegada.contatoNovo && config.respostas.boas_vindas.ativo
    ? "boas_vindas"
    : null;
}

/**
 * Já houve resposta automática para o contato? No máximo uma a cada 12h,
 * de qualquer tipo: as boas-vindas das 17h59 seguram a de fora do horário
 * das 18h01. As boas-vindas olham também a vida inteira do contato atrás
 * de outras boas-vindas. Conta a nota que falhou ou ficou sem confirmação
 * também: senão cada mensagem de uma rajada tentaria de novo, e a conversa
 * se encheria de falhas iguais. Falha na leitura conta como "já houve": na
 * dúvida, não manda.
 */
async function jaRespondeu(
  service: Service,
  leadId: string,
  tipo: TipoAutomatica,
): Promise<boolean> {
  const desde = new Date(
    Date.now() - INTERVALO_ENTRE_AUTOMATICAS_MS,
  ).toISOString();
  const consulta = service
    .from("lead_interactions")
    .select("id")
    .eq("lead_id", leadId)
    .eq("tipo", "nota")
    .not("metadados->>automatica", "is", null);
  const { data, error } = await (
    tipo === "boas_vindas"
      ? consulta.or(
          `criado_em.gte."${desde}",metadados->>automatica.eq.boas_vindas`,
        )
      : consulta.gte("criado_em", desde)
  ).limit(1);
  if (error) {
    console.error(
      `[resposta automática] conversa ${leadId} sem conferência das 12h: ${error.message}`,
    );
    return true;
  }
  return (data?.length ?? 0) > 0;
}

function motivoDe(e: unknown): string {
  return e instanceof Error ? e.message : String(e);
}

/**
 * O que fica na nota quando a Meta não respondeu no prazo. Não é falha: o
 * envio pode ter chegado, e a bolha mostra só isto, sem o "Não entregue".
 */
const ERRO_SEM_CONFIRMACAO = "Envio sem confirmação da Meta";

/**
 * Manda pelo canal em que a pessoa escreveu. Devolve o wamid ou o mid; sem
 * resposta da Meta a tempo (MetaSemResposta no WhatsApp, o prazo estourado
 * no Direct), volta o erro com semConfirmacao.
 */
async function enviar(
  chegada: ChegadaParaResposta,
  texto: string,
): Promise<
  { id: string | null } | { erro: string; semConfirmacao?: boolean }
> {
  try {
    const id =
      chegada.canal === "whatsapp"
        ? await enviarTextoMeta(chegada.destino, texto)
        : await enviarTextoInstagram(chegada.destino, texto);
    return { id };
  } catch (e) {
    if (
      e instanceof MetaSemResposta ||
      (chegada.canal === "instagram" && /sem resposta a tempo/.test(motivoDe(e)))
    ) {
      return { erro: ERRO_SEM_CONFIRMACAO, semConfirmacao: true };
    }
    return {
      erro:
        chegada.canal === "instagram"
          ? descreverErroInstagram(motivoDe(e))
          : motivoDe(e),
    };
  }
}

async function responder(
  service: Service,
  chegada: ChegadaParaResposta,
): Promise<void> {
  // O envio sai pelo número padrão (lib/whatsapp, o mesmo da resposta do
  // chat). Mensagem que chegou por outro número ficaria sem resposta no
  // número em que a pessoa escreveu, e a Meta recusaria pela janela.
  const remetente = process.env.META_PHONE_NUMBER_ID;
  if (
    chegada.canal === "whatsapp" &&
    remetente &&
    chegada.numeroQueRecebeu &&
    chegada.numeroQueRecebeu !== remetente
  ) {
    return;
  }

  const config = await lerConfiguracao(service);
  if (!config) return;
  const tipo = respostaDaVez(config, chegada);
  if (!tipo) return;

  await naFilaDoContato(chegada.leadId, async () => {
    if (await jaRespondeu(service, chegada.leadId, tipo)) return;

    const texto = textoDaResposta(config.respostas[tipo].texto, config.horario);
    if (!texto) return;
    const envio = await enviar(chegada, texto);
    const resultado =
      "erro" in envio
        ? envio.semConfirmacao
          ? "ficou sem confirmação"
          : "falhou"
        : "saiu";
    if ("erro" in envio) {
      console.error(
        `[resposta automática] ${tipo} para ${chegada.leadId} ${resultado}: ${envio.erro}`,
      );
    }

    // Sem recibo ainda, o status fica nulo (o do WhatsApp chega pelo
    // webhook, como nas mensagens do chat); falha já nasce com o motivo.
    // Sem confirmação não é falha (pode ter chegado): status nulo, só o
    // aviso em erro_envio. sistema: nota que a equipe não escreveu, fora
    // das notas internas da ficha do contato (o chat a reconhece antes,
    // pelo via).
    const { error } = await service.from("lead_interactions").insert({
      lead_id: chegada.leadId,
      tipo: "nota",
      conteudo: texto,
      metadados: {
        automatica: tipo,
        via: VIA_AUTOMATICA[tipo],
        sistema: true,
        canal: chegada.canal,
        message_id: "id" in envio ? envio.id : null,
        ...("erro" in envio
          ? envio.semConfirmacao
            ? { erro_envio: envio.erro }
            : { status_envio: "failed", erro_envio: envio.erro }
          : {}),
      },
    });
    if (error) {
      // A resposta pode ter saído sem ficar no histórico: o log é o rastro,
      // e a próxima mensagem do contato pode mandar de novo.
      console.error(
        `[resposta automática] ${tipo} para ${chegada.leadId} ${resultado} e não entrou no histórico: ${error.message}`,
      );
    }
  });
}

/**
 * Agenda a resposta para depois do 200. Falha aqui só vai para o log: a
 * mensagem do contato já está gravada, e o evento já está fechado.
 */
export function agendarRespostaAutomatica(
  service: Service,
  chegada: ChegadaParaResposta,
) {
  after(() =>
    responder(service, chegada).catch((e: unknown) =>
      console.error(
        `[resposta automática] conversa ${chegada.leadId}: ${motivoDe(e)}`,
      ),
    ),
  );
}
