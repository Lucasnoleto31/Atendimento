"use client";

import type { RealtimeChannel } from "@supabase/supabase-js";
import { createClient } from "@/lib/supabase/client";
import type { LinhaBrutaInteracao } from "./mensagem";

/**
 * O tempo real do chat e do badge do menu, num canal só por aba.
 *
 * Antes eram dois canais escutando o mesmo INSERT (o do badge e o do chat),
 * cada um disparando a sua recarga. Aqui o canal é de módulo: quem precisa
 * de mensagens assina, e o canal se ajusta ao que os assinantes pedem — fora
 * do /chat só o badge escuta, e só mensagem RECEBIDA atravessa a rede; no
 * /chat entram também as enviadas, que mexem na prévia da fila.
 *
 * A conversa aberta tem um canal próprio, filtrado pelo contato
 * (assinarConversa): é por ele que a bolha nova entra direto do payload e
 * que os recibos (✓, ✓✓, lida, falhou) chegam ao vivo — o webhook grava o
 * recibo com UPDATE, que o canal geral não assina.
 *
 * Exige a publication da 0014. Sem ela, ou com o canal caído, quem assina
 * lê `canalConectado()` e liga o polling de reserva.
 */

/** A linha de lead_interactions como o Realtime entrega (sem o join do
 *  autor; só `autor_id`). O tipo chega cru: quem consome confere. */
export type LinhaRealtime = Omit<LinhaBrutaInteracao, "tipo"> & {
  tipo: string;
  lead_id: string;
};

type OuvinteMensagens = {
  aoInserir: (linha: LinhaRealtime) => void;
  /** Também as enviadas (a fila do chat); o badge só quer as recebidas. */
  enviadas: boolean;
};

const ouvintes = new Set<OuvinteMensagens>();
const ouvintesConexao = new Set<(conectado: boolean, voltou: boolean) => void>();

let canal: RealtimeChannel | null = null;
let canalComEnviadas = false;
let conectado = false;
// Tópico novo a cada canal: o cliente do Supabase devolve o canal EXISTENTE
// quando o nome se repete — inclusive um que ainda está sendo removido.
let serie = 0;

function mudarConexao(agora: boolean, voltou: boolean) {
  if (agora === conectado && !voltou) return;
  conectado = agora;
  for (const avisar of ouvintesConexao) avisar(agora, voltou);
}

let ajustePendente = false;

/**
 * O ajuste espera o fim da rodada: badge e chat montam no mesmo commit, e
 * assim o canal nasce uma vez só, já com o filtro dos dois — em vez de
 * nascer com o do primeiro e ser refeito logo em seguida.
 */
function agendarAjuste() {
  if (ajustePendente) return;
  ajustePendente = true;
  queueMicrotask(() => {
    ajustePendente = false;
    ajustarCanal();
  });
}

/**
 * Monta (ou remonta) o canal geral conforme o que os assinantes pedem. Só
 * remonta quando o filtro muda — entrar no /chat liga as enviadas; sair
 * desliga.
 */
function ajustarCanal() {
  const querEnviadas = [...ouvintes].some((o) => o.enviadas);
  if (canal && ouvintes.size > 0 && querEnviadas === canalComEnviadas) return;

  const supabase = createClient();
  if (canal) {
    void supabase.removeChannel(canal);
    canal = null;
    mudarConexao(false, false);
  }
  if (ouvintes.size === 0) return;

  canalComEnviadas = querEnviadas;
  let jaConectou = false;
  const novo = supabase
    .channel(`mensagens-${++serie}`)
    .on(
      "postgres_changes",
      {
        event: "INSERT",
        schema: "public",
        table: "lead_interactions",
        // Só mensagens: atribuição e os eventos que o banco grava por
        // gatilho nem chegam ao navegador.
        filter: querEnviadas
          ? "tipo=in.(mensagem_recebida,mensagem_enviada)"
          : "tipo=eq.mensagem_recebida",
      },
      (payload) => {
        const linha = payload.new as LinhaRealtime;
        if (!linha?.lead_id) return;
        for (const o of ouvintes) {
          if (o.enviadas || linha.tipo === "mensagem_recebida") {
            o.aoInserir(linha);
          }
        }
      },
    )
    .subscribe((status) => {
      if (canal !== novo) return; // canal já trocado: o aviso é velho
      if (status === "SUBSCRIBED") {
        // A segunda entrada é volta de queda: o que chegou no meio se
        // perdeu, e quem assina ressincroniza.
        mudarConexao(true, jaConectou);
        jaConectou = true;
      } else {
        mudarConexao(false, false);
      }
    });
  canal = novo;
}

/** Mensagens novas de qualquer contato. Devolve o cancelamento. */
export function assinarMensagens(
  aoInserir: (linha: LinhaRealtime) => void,
  { enviadas = false }: { enviadas?: boolean } = {},
): () => void {
  const ouvinte: OuvinteMensagens = { aoInserir, enviadas };
  ouvintes.add(ouvinte);
  agendarAjuste();
  return () => {
    ouvintes.delete(ouvinte);
    agendarAjuste();
  };
}

/**
 * Situação do canal geral. `voltou` = reconectou depois de cair: os eventos
 * do intervalo se perderam e quem assina deve ressincronizar.
 */
export function assinarConexao(
  avisar: (conectado: boolean, voltou: boolean) => void,
): () => void {
  ouvintesConexao.add(avisar);
  return () => {
    ouvintesConexao.delete(avisar);
  };
}

/** O canal geral está entregando? Sem ele, vale o polling de reserva. */
export function canalConectado(): boolean {
  return conectado;
}

/**
 * Quem mais quer os UPDATEs da conversa aberta. A fila (conversas/app.tsx)
 * aplica só o recibo e os anexos; a Janela também precisa de reação,
 * apagada e edição, que o webhook grava nos metadados da MESMA linha. Ela
 * escuta por aqui, sem abrir um segundo canal.
 */
type OuvinteAtualizacao = {
  leadId: string;
  avisar: (linha: LinhaRealtime) => void;
};

const ouvintesAtualizacao = new Set<OuvinteAtualizacao>();

function avisarAtualizacao(leadId: string, linha: LinhaRealtime) {
  for (const o of ouvintesAtualizacao) {
    if (o.leadId === leadId) o.avisar(linha);
  }
}

/** Os UPDATEs de lead_interactions deste contato, pelo canal da conversa
 *  aberta (só chegam enquanto ela está em cena). Devolve o cancelamento. */
export function ouvirAtualizacoesDaConversa(
  leadId: string,
  avisar: (linha: LinhaRealtime) => void,
): () => void {
  const ouvinte: OuvinteAtualizacao = { leadId, avisar };
  ouvintesAtualizacao.add(ouvinte);
  return () => {
    ouvintesAtualizacao.delete(ouvinte);
  };
}

/**
 * Eco local de uma linha regravada por uma action desta aba (a apagada da
 * equipe e o desfazer): a Janela mostra na hora, sem esperar o tempo real.
 * Mesmo formato do UPDATE do Realtime; vence pelo `rev`.
 */
export function emitirAtualizacaoDaConversa(linha: LinhaRealtime) {
  if (linha?.lead_id) avisarAtualizacao(linha.lead_id, linha);
}

/**
 * O canal da conversa aberta: INSERT e UPDATE de lead_interactions daquele
 * contato. O INSERT traz a bolha nova (inclusive nota de colega); o UPDATE,
 * os recibos que o webhook grava em metadados.
 */
export function assinarConversa(
  leadId: string,
  {
    aoInserir,
    aoAtualizar,
    aoMudarConexao,
  }: {
    aoInserir: (linha: LinhaRealtime) => void;
    aoAtualizar: (linha: LinhaRealtime) => void;
    aoMudarConexao: (conectado: boolean, voltou: boolean) => void;
  },
): () => void {
  const supabase = createClient();
  const filtro = `lead_id=eq.${leadId}`;
  let jaConectou = false;
  let vivo = true;
  const canalConversa = supabase
    .channel(`conversa-${leadId}-${++serie}`)
    .on(
      "postgres_changes",
      {
        event: "INSERT",
        schema: "public",
        table: "lead_interactions",
        filter: filtro,
      },
      (payload) => {
        if (vivo) aoInserir(payload.new as LinhaRealtime);
      },
    )
    .on(
      "postgres_changes",
      {
        event: "UPDATE",
        schema: "public",
        table: "lead_interactions",
        filter: filtro,
      },
      (payload) => {
        if (!vivo) return;
        const linha = payload.new as LinhaRealtime;
        aoAtualizar(linha);
        avisarAtualizacao(leadId, linha);
      },
    )
    .subscribe((status) => {
      if (!vivo) return;
      if (status === "SUBSCRIBED") {
        aoMudarConexao(true, jaConectou);
        jaConectou = true;
      } else {
        aoMudarConexao(false, false);
      }
    });

  return () => {
    vivo = false;
    void supabase.removeChannel(canalConversa);
  };
}
