import type { createServiceClient } from "@/lib/supabase/server";

/**
 * O livro de eventos dos webhooks (webhook_events) e o reprocessamento.
 *
 * Cada evento entra numa linha antes de ser processado, e o índice único
 * (origem, evento_id) barra a cópia que a Meta reenvia. A linha termina
 * processada ou com o erro que impediu. O erro não é o fim: a rota responde
 * 200 sempre (a Meta desliga o webhook que falha repetidamente), então a
 * Meta não reenvia a mensagem que falhou ao gravar. Quem a traz de volta é a
 * passada de reprocessamento, a partir do payload guardado na própria linha.
 *
 * Sem coluna nova, a tentativa mora no texto do erro:
 *   null                                   1ª tentativa em andamento
 *   "[tentativa 2 · <ISO>] em andamento"   nova tentativa em andamento
 *   "[tentativa N · <ISO>] <motivo>"       a tentativa N falhou
 * Uma nova tentativa reivindica a linha trocando o erro lido pelo de "em
 * andamento", num update condicionado ao valor lido: de duas tentativas
 * simultâneas (reenvio da Meta e passada), só uma grava a mensagem.
 *
 * Processada e com erro é a falha que repetir não muda (FalhaDefinitiva):
 * o motivo fica na linha para investigar, e ela não volta pela passada nem
 * pelo reenvio da Meta.
 */

type Service = ReturnType<typeof createServiceClient>;

export type OrigemEvento = "meta" | "instagram";

export type Registro =
  /** Linha própria em webhook_events; a primeira tentativa é a 1. */
  | { tipo: "novo"; tentativa: number }
  /** Já processado, ou outra tentativa em andamento: não mexer. */
  | { tipo: "duplicado" }
  /**
   * O insert falhou sem ser duplicata: processa sem linha. Se falhar de
   * novo, o payload vai junto para a linha nascer com o erro e entrar na
   * passada.
   */
  | { tipo: "sem_registro"; payload: unknown };

/**
 * Falha que nenhuma nova tentativa muda, porque depende só do payload (o
 * formulário de anúncio sem um telefone que sirva). concluirEvento fecha o
 * evento como processado, com o motivo no erro: sem isso ele voltaria mais
 * quatro vezes, cada uma com as leituras na Meta, e ocuparia vagas da
 * leitura da passada.
 */
export class FalhaDefinitiva extends Error {}

/** Tentativas por evento, contando a primeira. */
const TETO_TENTATIVAS = 5;

/**
 * Espera desde a falha antes da próxima tentativa, pelo número dela: falha
 * passageira do banco dura segundos, queda dura mais. As quatro novas
 * tentativas se espalham por umas duas horas e meia.
 */
function esperaAntes(tentativa: number): number {
  if (tentativa <= 2) return 60_000;
  if (tentativa === 3) return 5 * 60_000;
  if (tentativa === 4) return 30 * 60_000;
  return 2 * 3_600_000;
}

/**
 * Tentativa sem desfecho há mais que isso: a função caiu no meio (o teto de
 * duração da Vercel é menor), e o evento volta para a fila.
 */
const PRAZO_ABANDONO_MS = 15 * 60_000;

/** Evento mais velho que isso fica em webhook_events.erro, para investigar. */
const JANELA_REPROCESSO_MS = 2 * 24 * 3_600_000;

/** Uma passada por origem a cada 2 minutos em cada instância da função. */
const INTERVALO_PASSADA_MS = 2 * 60_000;
const EVENTOS_POR_PASSADA = 3;

/**
 * Linhas lidas por passada. A leitura não traz o payload: ler mais custa
 * pouco e sobra vaga para o evento pronto mesmo com muita linha em espera.
 */
const LINHAS_POR_LEITURA = 50;

/** O erro é gravado inteiro na linha; motivo longo só ocupa espaço. */
const MOTIVO_MAX = 500;

const EM_ANDAMENTO = "em andamento";
const MARCA = /^\[tentativa (\d+) · ([^\]]+)\] ?/;

/** Começo do erro da última tentativa, para o LIKE da passada. */
const MARCA_DO_TETO = `[tentativa ${TETO_TENTATIVAS} ·`;

type LinhaEvento = {
  id: string;
  evento_id: string;
  erro: string | null;
  recebido_em: string;
  processado: boolean;
};

const CAMPOS_LINHA = "id, evento_id, erro, recebido_em, processado";

function marcar(tentativa: number, texto: string): string {
  return `[tentativa ${tentativa} · ${new Date().toISOString()}] ${texto}`;
}

/** O aviso de quem esgotou as tentativas: o evento não volta mais sozinho. */
function avisarTeto(
  origem: OrigemEvento,
  eventoId: string,
  tentativa: number,
  motivo: string,
) {
  console.error(
    `[webhook ${origem}] ${eventoId} falhou ${tentativa} vezes e fica em webhook_events para investigar: ${motivo}`,
  );
}

/** Em que tentativa a linha está, desde quando e se ainda roda. */
function lerEstado(linha: LinhaEvento) {
  const recebido = Date.parse(linha.recebido_em);
  if (linha.erro === null) {
    return { tentativa: 1, desde: recebido, emAndamento: true };
  }
  const marca = MARCA.exec(linha.erro);
  // Erro gravado antes da marca existir: conta como a 1ª tentativa.
  if (!marca) return { tentativa: 1, desde: recebido, emAndamento: false };
  const desde = Date.parse(marca[2]);
  return {
    tentativa: Number(marca[1]),
    desde: Number.isNaN(desde) ? recebido : desde,
    emAndamento: linha.erro.slice(marca[0].length) === EM_ANDAMENTO,
  };
}

/**
 * O número da próxima tentativa, ou null se a linha não deve ser mexida:
 * processada, no teto, rodando agora ou, na passada, ainda dentro da espera.
 * O reenvio da Meta não espera: ele só vem quando o 200 não chegou.
 */
function proximaTentativa(linha: LinhaEvento, comEspera: boolean) {
  if (linha.processado) return null;
  const estado = lerEstado(linha);
  const proxima = estado.tentativa + 1;
  if (proxima > TETO_TENTATIVAS) return null;
  const passou = Date.now() - estado.desde;
  if (estado.emAndamento) return passou > PRAZO_ABANDONO_MS ? proxima : null;
  return !comEspera || passou >= esperaAntes(proxima) ? proxima : null;
}

/**
 * Troca o erro lido pelo "em andamento" da nova tentativa, só se ninguém
 * mexeu na linha desde a leitura. Devolve o payload quando ganhou.
 */
async function reivindicar(
  service: Service,
  linha: LinhaEvento,
  tentativa: number,
): Promise<{ evento_id: string; payload: unknown } | null> {
  const update = service
    .from("webhook_events")
    .update({ erro: marcar(tentativa, EM_ANDAMENTO) })
    .eq("id", linha.id)
    .eq("processado", false);
  const { data, error } = await (
    linha.erro === null ? update.is("erro", null) : update.eq("erro", linha.erro)
  ).select("evento_id, payload");
  if (error || !data?.length) return null;
  return data[0] as { evento_id: string; payload: unknown };
}

/**
 * Registra o evento antes de processar. O 23505 é a cópia que a Meta
 * reenviou: duplicata, a menos que a linha tenha ficado com erro ou
 * abandonada no meio. Aí este reenvio vira a nova tentativa.
 *
 * Só o 23505 prova que o evento já entrou. Outra falha do insert (rede,
 * PostgREST fora do ar) não prova nada: o evento é processado assim mesmo,
 * sem linha, e tratar isso como duplicata descartaria a mensagem sem rastro.
 *
 * `retomar: false` é para evento que não pode rodar fora de ordem (a
 * qualidade do número): uma nova tentativa atrasada gravaria um estado
 * velho por cima do atual.
 */
export async function registrarEvento(
  service: Service,
  origem: OrigemEvento,
  eventoId: string,
  payload: unknown,
  { retomar = true }: { retomar?: boolean } = {},
): Promise<Registro> {
  const { error } = await service.from("webhook_events").insert({
    origem,
    evento_id: eventoId,
    payload: payload as Record<string, unknown>,
  });
  if (!error) return { tipo: "novo", tentativa: 1 };

  if (error.code === "23505") {
    if (!retomar) return { tipo: "duplicado" };
    const { data } = await service
      .from("webhook_events")
      .select(CAMPOS_LINHA)
      .eq("origem", origem)
      .eq("evento_id", eventoId)
      .maybeSingle();
    const linha = data as LinhaEvento | null;
    const tentativa = linha ? proximaTentativa(linha, false) : null;
    if (!linha || tentativa === null) return { tipo: "duplicado" };
    return (await reivindicar(service, linha, tentativa))
      ? { tipo: "novo", tentativa }
      : { tipo: "duplicado" };
  }

  console.error(
    `[webhook ${origem}] ${eventoId} sem registro em webhook_events: ${error.message}`,
  );
  return { tipo: "sem_registro", payload };
}

/**
 * Fecha o evento: processado, ou o erro que impediu, marcado com a
 * tentativa. Sem linha (o insert do registro falhou), a falha tenta criar a
 * linha já com o erro, para a passada achar; se nem isso der, fica o log.
 * A FalhaDefinitiva fecha processada, com o motivo no erro.
 */
export async function concluirEvento(
  service: Service,
  origem: OrigemEvento,
  eventoId: string,
  registro: Registro,
  falha?: unknown,
) {
  const motivo =
    falha === undefined
      ? null
      : (falha instanceof Error ? falha.message : String(falha)).slice(
          0,
          MOTIVO_MAX,
        );
  const definitiva = motivo !== null && falha instanceof FalhaDefinitiva;

  if (registro.tipo === "duplicado") {
    if (motivo) console.error(`[webhook ${origem}] ${eventoId}: ${motivo}`);
    return;
  }

  if (definitiva) {
    console.warn(
      `[webhook ${origem}] ${eventoId} não volta (repetir não muda): ${motivo}`,
    );
  }

  if (registro.tipo === "sem_registro") {
    if (!motivo) return;
    if (!definitiva) console.error(`[webhook ${origem}] ${eventoId}: ${motivo}`);
    const { error } = await service.from("webhook_events").insert({
      origem,
      evento_id: eventoId,
      payload: registro.payload as Record<string, unknown>,
      erro: marcar(1, motivo),
      ...(definitiva ? { processado: true } : {}),
    });
    if (error && error.code !== "23505") {
      console.error(
        `[webhook ${origem}] ${eventoId} fica só no log: ${error.message}`,
      );
    }
    return;
  }

  if (motivo && !definitiva && registro.tentativa >= TETO_TENTATIVAS) {
    avisarTeto(origem, eventoId, registro.tentativa, motivo);
  }
  const { error } = await service
    .from("webhook_events")
    .update(
      motivo
        ? {
            erro: marcar(registro.tentativa, motivo),
            ...(definitiva ? { processado: true } : {}),
          }
        : { processado: true, erro: null },
    )
    .eq("origem", origem)
    .eq("evento_id", eventoId);
  // Sem o desfecho gravado, a linha fica "em andamento" e volta para a fila
  // depois do prazo de abandono.
  if (error) {
    console.error(
      `[webhook ${origem}] ${eventoId} sem desfecho gravado: ${error.message}`,
    );
  }
}

/**
 * Nova tentativa: a mensagem pode ter sido gravada e só o desfecho se
 * perdido (a função caiu antes de fechar o evento). O message_id fica no
 * jsonb sem índice próprio; a busca anda pelo índice (tipo, criado_em) e
 * só olha a janela de reprocessamento. Roda só em nova tentativa.
 *
 * Falha na conferência vira falha da tentativa: gravar sem saber poderia
 * duplicar a mensagem no histórico.
 */
export async function mensagemJaGravada(
  service: Service,
  messageId: string,
): Promise<boolean> {
  const { data, error } = await service
    .from("lead_interactions")
    .select("id")
    .eq("tipo", "mensagem_recebida")
    .eq("metadados->>message_id", messageId)
    .gte(
      "criado_em",
      new Date(Date.now() - JANELA_REPROCESSO_MS - 86_400_000).toISOString(),
    )
    .limit(1);
  if (error) throw new Error(`Falha ao conferir a mensagem: ${error.message}`);
  return (data?.length ?? 0) > 0;
}

/**
 * O criado_em de uma nova tentativa: a hora em que a mensagem foi mandada
 * (em ms), ou undefined para o banco pôr a de agora. Só vale dentro da
 * janela de reprocessamento: mensagemJaGravada procura um dia além dela, e
 * a mensagem gravada com essa hora continua achável na tentativa seguinte,
 * sem entrar duas vezes. Hora no futuro (relógio torto) também fica com a
 * de agora.
 */
export function horaOriginal(ms: number | undefined): string | undefined {
  const agora = Date.now();
  if (
    ms === undefined ||
    !Number.isFinite(ms) ||
    ms < agora - JANELA_REPROCESSO_MS ||
    ms > agora
  ) {
    return undefined;
  }
  return new Date(ms).toISOString();
}

const proximaPassada = new Map<OrigemEvento, number>();

/**
 * true = está na hora de uma passada desta origem nesta instância (e a
 * próxima fica agendada). A rota chama a cada POST; a passada roda depois
 * da resposta, com after().
 */
export function passadaLiberada(origem: OrigemEvento): boolean {
  const agora = Date.now();
  if (agora < (proximaPassada.get(origem) ?? 0)) return false;
  proximaPassada.set(origem, agora + INTERVALO_PASSADA_MS);
  return true;
}

/**
 * A última tentativa que a função largou no meio não tem próxima: sem
 * desfecho, a linha ficaria "em andamento" para sempre. Passado o prazo de
 * abandono, grava "abandonada no meio" como o motivo final, no update
 * condicionado ao valor lido (como em reivindicar), e avisa como o teto.
 * true = era uma dessas, e a passada não mexe mais nela.
 */
async function encerrarAbandonadaNoTeto(
  service: Service,
  origem: OrigemEvento,
  linha: LinhaEvento,
): Promise<boolean> {
  if (linha.processado || linha.erro === null) return false;
  const estado = lerEstado(linha);
  if (
    !estado.emAndamento ||
    estado.tentativa < TETO_TENTATIVAS ||
    Date.now() - estado.desde <= PRAZO_ABANDONO_MS
  ) {
    return false;
  }

  const motivo = "abandonada no meio";
  const { data, error } = await service
    .from("webhook_events")
    .update({ erro: marcar(estado.tentativa, motivo) })
    .eq("id", linha.id)
    .eq("processado", false)
    .eq("erro", linha.erro)
    .select("id");
  if (error) {
    console.error(
      `[webhook ${origem}] ${linha.evento_id} sem desfecho gravado: ${error.message}`,
    );
  } else if (data?.length) {
    avisarTeto(origem, linha.evento_id, estado.tentativa, motivo);
  }
  return true;
}

/**
 * Os eventos que falharam (ou ficaram abandonados) nos últimos 2 dias e já
 * podem rodar de novo, até 3 por passada, cada um já reivindicado.
 *
 * A leitura vem dos mais novos para os mais velhos. Na ordem crescente, as
 * linhas mais velhas de um incidente, paradas na espera entre tentativas
 * (30 min a 2 h), ocupavam todas as vagas da leitura e seguravam os eventos
 * prontos por até 2 h. Dentro dessa janela a reivindicação vai da mais velha
 * para a mais nova, e a rota trata a rajada na ordem em que foi mandada. A
 * nova tentativa grava a mensagem com a hora original; a ordem de gravação
 * só decide o empate de mensagens do mesmo segundo. A leitura anda pelo índice webhook_events_pendentes_idx
 * (recebido_em, só os não processados), de trás para a frente.
 *
 * O que não vai rodar sai já no SQL, senão ocupa as vagas da leitura: a
 * última tentativa que falhou e os eventos com os prefixos de
 * `ignorarPrefixos`, que a rota não reprocessa. A última tentativa ainda
 * "em andamento" continua na leitura, para ser encerrada se a função caiu
 * no meio dela.
 */
export async function reivindicarPendentes(
  service: Service,
  origem: OrigemEvento,
  ignorarPrefixos: string[] = [],
): Promise<{ eventoId: string; payload: unknown; registro: Registro }[]> {
  let leitura = service
    .from("webhook_events")
    .select(CAMPOS_LINHA)
    .eq("origem", origem)
    .eq("processado", false)
    .gte(
      "recebido_em",
      new Date(Date.now() - JANELA_REPROCESSO_MS).toISOString(),
    )
    // O erro null (1ª tentativa, talvez abandonada) entra à parte: NOT LIKE
    // sobre null não dá verdadeiro, e a linha sumiria da leitura.
    .or(
      `erro.is.null,erro.not.like."${MARCA_DO_TETO}%",erro.like."%] ${EM_ANDAMENTO}"`,
    );
  for (const prefixo of ignorarPrefixos) {
    leitura = leitura.not("evento_id", "like", `${prefixo}%`);
  }
  const { data, error } = await leitura
    .order("recebido_em", { ascending: false })
    .limit(LINHAS_POR_LEITURA);
  if (error) {
    console.error(
      `[webhook ${origem}] passada de reprocessamento sem leitura: ${error.message}`,
    );
    return [];
  }

  const prontos: { eventoId: string; payload: unknown; registro: Registro }[] =
    [];
  // A janela é a das linhas mais novas, mas dentro dela a reivindicação anda
  // da mais velha para a mais nova: mensagens do mesmo segundo (o WhatsApp
  // manda o timestamp em segundos) que caem em passadas diferentes ficariam
  // de trás para a frente no histórico, onde o empate se resolve pela ordem
  // de gravação.
  for (const linha of ((data ?? []) as LinhaEvento[]).slice().reverse()) {
    if (prontos.length >= EVENTOS_POR_PASSADA) break;
    if (!linha.evento_id) continue;
    if (await encerrarAbandonadaNoTeto(service, origem, linha)) continue;
    const tentativa = proximaTentativa(linha, true);
    if (tentativa === null) continue;
    const ganha = await reivindicar(service, linha, tentativa);
    if (ganha) {
      prontos.push({
        eventoId: ganha.evento_id,
        payload: ganha.payload,
        registro: { tipo: "novo", tentativa },
      });
    }
  }
  return prontos;
}
