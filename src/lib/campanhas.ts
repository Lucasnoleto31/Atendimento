import { createServiceClient } from "@/lib/supabase/server";
import { listarTemplatesMeta, metaConfigurada } from "@/lib/whatsapp";
import { corpoPreenchido, dispararTemplate, type Alvo } from "@/lib/disparo";
import { agoraEmBrasilia } from "@/lib/format";
import { orcamentoEnviosRestante, VIA_DISPARO } from "@/lib/envios";
// As regras de variável e de nome moram com a tela das campanhas, num
// arquivo puro: a prévia do assistente e o motor fazem a mesma conta.
import {
  valoresParaContato,
  variaveisEmBranco,
} from "@/app/(app)/campanhas/regras";

/**
 * Disparo em massa com ritmo diário.
 *
 * Uma lista grande não pode sair de uma vez: a Meta limita conversas
 * iniciadas por dia e bloqueio em massa derruba a qualidade do número —
 * que é o canal de todo o atendimento. A campanha guarda o público
 * (uma etiqueta), o template e a cota diária; este motor manda até
 * `por_dia` por dia útil e encerra sozinho quando a lista acaba.
 *
 * Roda no batimento do layout (processarCampanhas), logo depois de ativar ou
 * editar uma campanha e na rota /api/cron/campanhas.
 */

const INTERVALO_HEARTBEAT_MS = 5 * 60_000;
/** Por rodada, para os envios se espalharem ao longo do expediente. */
const LOTE_POR_RODADA = 10;
/**
 * Rede contra laço sem fim (paginação que não anda, tabela crescendo durante a
 * varredura), não limite de público: a base inteira de contatos cabe com
 * folga. A varredura vai até o fim da lista, porque parar antes deixa a
 * campanha sem enviar e sem concluir. Bater no teto é anomalia: a rodada para
 * sem concluir e o caso fica no log com o nome da campanha.
 */
const VARREDURA_MAXIMA = 100_000;
const PAGINA = 200;

let ultimaExecucao = 0;

type Campanha = {
  id: string;
  nome: string;
  template_nome: string;
  template_idioma: string;
  parametros: Record<string, string>;
  etiqueta_id: string | null;
  por_dia: number;
  dias_uteis: boolean;
  hora_inicio: number;
  hora_fim: number;
};

export type ResultadoCampanhas = {
  enviados: number;
  falhas: number;
  campanhas: number;
};

/** Começo do dia em Brasília, para a tela contar no mesmo relógio do motor. */
export function inicioDoDiaSaoPaulo(): string {
  return agoraEmBrasilia().inicioDoDia;
}

export async function processarCampanhas(): Promise<void> {
  if (Date.now() - ultimaExecucao < INTERVALO_HEARTBEAT_MS) return;
  ultimaExecucao = Date.now();
  await executarCampanhas();
}

export async function executarCampanhas(): Promise<ResultadoCampanhas> {
  const service = createServiceClient();
  const vazio = { enviados: 0, falhas: 0, campanhas: 0 };

  const { data, error } = await service
    .from("campanhas")
    .select(
      "id, nome, template_nome, template_idioma, parametros, etiqueta_id, por_dia, dias_uteis, hora_inicio, hora_fim",
    )
    .eq("status", "ativa")
    .order("criado_em");

  // Migração 0021 ainda não rodou, ou nada ativo.
  if (error || !data || data.length === 0) return vazio;

  // Fora da janela de nenhuma campanha, a rodada acaba aqui: sem ir à Meta
  // buscar templates nem ao banco somar o dia.
  const relogio = agoraEmBrasilia();
  const naJanela = (data as Campanha[]).filter(
    (c) =>
      c.etiqueta_id &&
      !(c.dias_uteis && relogio.fimDeSemana) &&
      relogio.hora >= c.hora_inicio &&
      relogio.hora < c.hora_fim,
  );
  if (naJanela.length === 0) return vazio;

  // Canal único é a Meta: sem token a lista vem vazia, nenhum template casa
  // e a campanha fica parada (sem consumir público nem marcar erro).
  const [templates, orcamentoInicial] = await Promise.all([
    metaConfigurada() ? listarTemplatesMeta() : Promise.resolve([]),
    // Teto do número (lib/envios), lido uma vez por rodada e debitado aqui
    // a cada tentativa: duas campanhas ativas não passam juntas do limite.
    orcamentoEnviosRestante(service),
  ]);
  let orcamento = orcamentoInicial;

  let enviados = 0;
  let falhas = 0;
  let campanhasTocadas = 0;

  for (const campanha of naJanela) {
    if (orcamento <= 0) break;

    const template = templates.find(
      (t) =>
        t.nome === campanha.template_nome &&
        t.idioma === campanha.template_idioma,
    );
    if (!template) continue;

    // Variável sem valor: a Meta recusa cada envio, e cada recusa tira o
    // contato da fila para sempre. Antes de reservar qualquer linha, a
    // campanha fica parada (a tela mostra o motivo). Vale também para o
    // template editado na Meta depois de a campanha existir.
    const emBranco = variaveisEmBranco(template.parametros, campanha.parametros);
    if (emBranco.length > 0) {
      console.warn(
        `[campanhas] "${campanha.nome}" (${campanha.id}): sem valor para ${emBranco.map((t) => `{{${t}}}`).join(", ")}. A campanha não envia até ser recriada.`,
      );
      continue;
    }

    // Cota do dia: toda tentativa conta, inclusive a que falhou — a Meta
    // pode ter aberto a conversa mesmo devolvendo erro.
    const { count: jaHoje } = await service
      .from("campanha_envios")
      .select("lead_id", { count: "exact", head: true })
      .eq("campanha_id", campanha.id)
      .gte("enviado_em", relogio.inicioDoDia);

    const restaHoje = campanha.por_dia - (jaHoje ?? 0);
    if (restaHoje <= 0) continue;

    const quantos = Math.min(restaHoje, LOTE_POR_RODADA, orcamento);
    const { alvos, publicoAcabou } = await proximosAlvos(
      service,
      campanha,
      quantos,
    );

    if (alvos.length === 0) {
      if (publicoAcabou) {
        await service
          .from("campanhas")
          .update({
            status: "concluida",
            concluida_em: new Date().toISOString(),
          })
          .eq("id", campanha.id)
          .eq("status", "ativa");
      }
      continue;
    }

    campanhasTocadas++;

    for (const alvo of alvos) {
      // Reserva pela PK (campanha, contato): duas rodadas simultâneas não
      // mandam a mesma mensagem duas vezes.
      const { error: ocupado } = await service
        .from("campanha_envios")
        .insert({ campanha_id: campanha.id, lead_id: alvo.leadId });
      if (ocupado) continue;
      orcamento--;

      // {nome} vira o primeiro nome; nome que o sistema inventou ("Lead
      // 1234", "WhatsApp 1234") vira o texto de quem não tem nome.
      const valores = valoresParaContato(
        template.parametros,
        campanha.parametros,
        alvo.nome,
      );

      try {
        const idMensagem = await dispararTemplate(alvo, template, valores);
        const agora = new Date().toISOString();

        // As três escritas são independentes: o envio já saiu, e cada uma
        // vale sozinha (id do recibo, histórico da conversa, hora da última
        // mensagem). Juntas, custam uma ida ao banco em vez de três.
        await Promise.all([
          service
            .from("campanha_envios")
            .update({ message_id: idMensagem })
            .eq("campanha_id", campanha.id)
            .eq("lead_id", alvo.leadId),
          service.from("lead_interactions").insert({
            lead_id: alvo.leadId,
            tipo: "mensagem_enviada",
            conteudo: corpoPreenchido(template, valores),
            metadados: {
              message_id: idMensagem,
              via: VIA_DISPARO,
              campanha: campanha.nome,
              campanha_id: campanha.id,
              template: template.nome,
            },
          }),
          service
            .from("leads")
            .update({ ultima_interacao_em: agora, chat_lido_em: agora })
            .eq("id", alvo.leadId),
        ]);

        enviados++;
      } catch (e) {
        // A linha fica com o erro: a campanha não insiste sozinha num
        // número que a Meta recusou, e a falha aparece na tela.
        await service
          .from("campanha_envios")
          .update({ erro: e instanceof Error ? e.message : String(e) })
          .eq("campanha_id", campanha.id)
          .eq("lead_id", alvo.leadId);
        falhas++;
      }
    }
  }

  return { enviados, falhas, campanhas: campanhasTocadas };
}

type LinhaPublico = {
  lead_id: string;
  lead: {
    id: string;
    nome: string;
    telefone_e164: string | null;
  } | null;
};

/**
 * Próximos da fila: quem tem a etiqueta, ainda não recebeu esta campanha e
 * pode receber disparo. `publicoAcabou` distingue "a cota do lote encheu"
 * de "não sobrou mais ninguém" — só o segundo encerra a campanha.
 */
async function proximosAlvos(
  service: ReturnType<typeof createServiceClient>,
  campanha: Campanha,
  quantos: number,
): Promise<{ alvos: Alvo[]; publicoAcabou: boolean }> {
  // Paginação por range só é estável com ordem total: com empate, o Postgres
  // devolve os empatados em ordem diferente conforme o LIMIT, e uma linha
  // pode ficar fora de todas as páginas. Por isso as duas consultas abaixo
  // terminam a ordem numa chave única (lead_id).

  // Quem já recebeu (sucesso ou falha) sai da fila para sempre.
  const jaRecebeu = new Set<string>();
  for (let de = 0; ; de += 1000) {
    if (de >= VARREDURA_MAXIMA) {
      avisarTeto(campanha, "envios já feitos");
      return { alvos: [], publicoAcabou: false };
    }
    const { data, error } = await service
      .from("campanha_envios")
      .select("lead_id")
      .eq("campanha_id", campanha.id)
      .order("lead_id")
      .range(de, de + 999);
    // Lista de quem já recebeu pela metade faria a rodada escolher gente que
    // a reserva vai recusar. Mesma regra do erro de página do público.
    if (error) return { alvos: [], publicoAcabou: false };
    data.forEach((r: { lead_id: string }) => jaRecebeu.add(r.lead_id));
    if (data.length < 1000) break;
  }

  const alvos: Alvo[] = [];

  for (let de = 0; ; de += PAGINA) {
    if (de >= VARREDURA_MAXIMA) {
      avisarTeto(campanha, "público");
      return { alvos, publicoAcabou: false };
    }
    // Fora do público já na consulta: quem recusou marketing na Meta
    // (marketing_bloqueado_em, erro 131050) e quem tem status 'perdido' no
    // banco — no chat essa conversa conta como resolvida e fica sem disparo.
    // Uma importação grava o bloco inteiro com o mesmo criado_em; o lead_id
    // desempata (é único dentro da etiqueta, pela chave de lead_tags).
    const pagina = await service
      .from("lead_tags")
      .select("lead_id, lead:leads!inner(id, nome, telefone_e164)")
      .eq("tag_id", campanha.etiqueta_id!)
      .not("lead.telefone_e164", "is", null)
      .is("lead.marketing_bloqueado_em", null)
      .neq("lead.status", "perdido")
      .order("criado_em")
      .order("lead_id")
      .range(de, de + PAGINA - 1);

    // Erro de página (timeout, hiccup do PostgREST) NÃO é fim de lista: sair
    // com publicoAcabou=true encerraria a campanha ativa para sempre por um
    // soluço momentâneo. Aborta a rodada sem concluir; tenta de novo depois.
    if (pagina.error) {
      return { alvos, publicoAcabou: false };
    }

    const linhas = (pagina.data ?? []) as unknown as LinhaPublico[];

    for (const linha of linhas) {
      if (!linha.lead?.telefone_e164) continue;
      if (jaRecebeu.has(linha.lead_id)) continue;
      alvos.push({
        leadId: linha.lead_id,
        nome: linha.lead.nome,
        telefone: linha.lead.telefone_e164,
      });
      if (alvos.length >= quantos) return { alvos, publicoAcabou: false };
    }

    // Página curta (ou vazia) é o fim da lista.
    if (linhas.length < PAGINA) break;
  }

  // Varreu o público inteiro e não sobrou ninguém elegível.
  return { alvos, publicoAcabou: alvos.length === 0 };
}

function avisarTeto(campanha: Campanha, oQue: string) {
  console.warn(
    `[campanhas] "${campanha.nome}" (${campanha.id}): a leitura de ${oQue} passou de ${VARREDURA_MAXIMA.toLocaleString("pt-BR")} linhas sem terminar. A varredura parou ali e a campanha não foi concluída.`,
  );
}
