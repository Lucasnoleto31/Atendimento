"use client";

import { useEffect, useRef } from "react";
import {
  assinarConexao,
  assinarConversa,
  assinarMensagens,
  canalConectado,
  type LinhaRealtime,
} from "@/app/(app)/chat/tempo-real";

/**
 * Tempo real da tela do chat. Os eventos viram CALLBACKS pontuais e quem
 * decide o que fazer é o app — e quase nada vai ao servidor:
 *
 *  - mensagem de qualquer contato (canal geral, compartilhado com o badge
 *    do menu): a linha daquele contato muda na hora (prévia, hora, não
 *    lida) e a fila inteira recarrega no máximo uma vez por respiro, para
 *    trazer quem ainda não estava nela e acertar a ordem e os contadores;
 *  - mensagem e recibo da conversa aberta (canal próprio, filtrado pelo
 *    contato): a bolha entra direto do payload; o ✓✓ chega ao vivo.
 *
 * O polling de reserva só liga com um dos canais fora do ar, e nunca com a
 * aba escondida. Voltar à aba, o canal subir pela primeira vez ou voltar
 * de uma queda pede uma ressincronização — eventos do intervalo podem ter
 * se perdido.
 */

const RESPIRO_MS = 12_000;
const INTERVALO_RESERVA_MS = 60_000;
// Escondida por mais que isto, o socket pode ter sido congelado pelo
// navegador: a conversa aberta também recarrega na volta.
const OCULTA_DEMAIS_MS = 60_000;

export type Ressincronizar = { lista: boolean; conversa: boolean };

type Callbacks = {
  /** Mensagem (recebida ou enviada) de qualquer contato. */
  aoMensagemNaFila: (linha: LinhaRealtime) => void;
  /** O respiro venceu: recarregar a fila em silêncio. */
  aoRespiroDaFila: () => void;
  /** INSERT na conversa aberta (qualquer tipo; quem recebe filtra). */
  aoMensagemDaAberta: (linha: LinhaRealtime) => void;
  /** UPDATE na conversa aberta — os recibos do WhatsApp. */
  aoAtualizacaoDaAberta: (linha: LinhaRealtime) => void;
  /** Volta da aba, volta de queda do canal ou polling de reserva. */
  aoRessincronizar: (oque: Ressincronizar) => void;
};

export function useTempoRealConversas(
  leadAbertoId: string | null,
  callbacks: Callbacks,
) {
  // Os canais são montados uma vez (o geral) ou por conversa (o da aberta)
  // e leem sempre as callbacks mais novas por aqui.
  const cbRef = useRef(callbacks);
  useEffect(() => {
    cbRef.current = callbacks;
  });
  const abertoRef = useRef(leadAbertoId);
  const conversaConectadaRef = useRef(false);
  useEffect(() => {
    abertoRef.current = leadAbertoId;
  }, [leadAbertoId]);

  useEffect(() => {
    let respiro: number | null = null;
    const limparRespiro = () => {
      if (respiro !== null) {
        window.clearTimeout(respiro);
        respiro = null;
      }
    };
    const agendarRespiro = () => {
      if (respiro !== null) return;
      respiro = window.setTimeout(() => {
        respiro = null;
        // Aba oculta não paga recarga: quem volta ressincroniza de uma vez.
        if (document.visibilityState === "visible") {
          cbRef.current.aoRespiroDaFila();
        }
      }, RESPIRO_MS);
    };

    const pararMensagens = assinarMensagens(
      (linha) => {
        cbRef.current.aoMensagemNaFila(linha);
        agendarRespiro();
      },
      { enviadas: true },
    );

    // A tela nasce com o que o servidor leu ao renderizar a página; o que
    // chegou entre essa leitura e o canal ficar de pé não veio por evento
    // nenhum. A primeira conexão com a aba à vista ressincroniza a fila e
    // também a conversa aberta (no deep link ela veio pronta do servidor).
    let sincronizouInicio = false;
    const ressincronizarAoConectar = () => {
      limparRespiro();
      cbRef.current.aoRessincronizar({
        lista: true,
        conversa: !sincronizouInicio,
      });
      sincronizouInicio = true;
    };
    // Toda entrada do canal pode ter perdido eventos: a primeira, a volta
    // de uma queda ou o canal refeito com outro filtro ao entrar no /chat.
    const pararConexao = assinarConexao((conectado) => {
      if (conectado && document.visibilityState === "visible") {
        ressincronizarAoConectar();
      }
    });
    // O canal pode já estar de pé (o badge o abriu antes) e seguir como
    // está: aí não vem aviso de conexão nenhum. O ajuste do canal sai num
    // microtask, e o timer só roda depois dele.
    const conferenciaInicial = window.setTimeout(() => {
      if (
        !sincronizouInicio &&
        canalConectado() &&
        document.visibilityState === "visible"
      ) {
        ressincronizarAoConectar();
      }
    }, 0);

    // A aba escondida perde eventos (o navegador congela o socket). Ao
    // voltar, a fila ressincroniza SEMPRE — depender de "chegou evento"
    // deixava quem voltou do almoço olhando a fila de duas horas atrás.
    let ocultaDesde: number | null =
      document.visibilityState === "visible" ? null : Date.now();
    const aoMudarVisibilidade = () => {
      if (document.visibilityState !== "visible") {
        ocultaDesde ??= Date.now();
        return;
      }
      if (ocultaDesde === null) return;
      const tempoOculta = Date.now() - ocultaDesde;
      ocultaDesde = null;
      // Aberta escondida (deep link num separador de fundo): a primeira
      // sincronização sai aqui. Com o canal ainda subindo, ela se repete
      // quando ele conectar.
      const inicio = !sincronizouInicio;
      if (canalConectado()) sincronizouInicio = true;
      // O respiro pendente seria uma segunda recarga logo atrás desta.
      limparRespiro();
      cbRef.current.aoRessincronizar({
        lista: true,
        conversa:
          inicio ||
          tempoOculta >= OCULTA_DEMAIS_MS ||
          !conversaConectadaRef.current,
      });
    };
    document.addEventListener("visibilitychange", aoMudarVisibilidade);

    // Rede de segurança: só com canal fora do ar. Sem publication (0014)
    // ou com o canal caído, é isto que mantém a fila e a conversa vivas.
    const intervalo = window.setInterval(() => {
      if (document.visibilityState !== "visible") return;
      const filaSemCanal = !canalConectado();
      const conversaSemCanal =
        abertoRef.current !== null && !conversaConectadaRef.current;
      if (!filaSemCanal && !conversaSemCanal) return;
      cbRef.current.aoRessincronizar({
        lista: filaSemCanal,
        conversa: conversaSemCanal,
      });
    }, INTERVALO_RESERVA_MS);

    return () => {
      limparRespiro();
      window.clearTimeout(conferenciaInicial);
      window.clearInterval(intervalo);
      document.removeEventListener("visibilitychange", aoMudarVisibilidade);
      pararMensagens();
      pararConexao();
    };
  }, []);

  useEffect(() => {
    conversaConectadaRef.current = false;
    if (!leadAbertoId) return;
    return assinarConversa(leadAbertoId, {
      aoInserir: (linha) => cbRef.current.aoMensagemDaAberta(linha),
      aoAtualizar: (linha) => cbRef.current.aoAtualizacaoDaAberta(linha),
      aoMudarConexao: (conectado, voltou) => {
        conversaConectadaRef.current = conectado;
        if (voltou && document.visibilityState === "visible") {
          cbRef.current.aoRessincronizar({ lista: false, conversa: true });
        }
      },
    });
  }, [leadAbertoId]);
}
