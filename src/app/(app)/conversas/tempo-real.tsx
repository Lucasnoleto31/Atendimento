"use client";

import { useEffect, useRef } from "react";
import { createClient } from "@/lib/supabase/client";
import { consumirEcoRealtime } from "@/app/(app)/chat/tempo-real";

/**
 * Tempo real do Chat da Mesa — a versão sem router.refresh(): o palco nunca
 * refaz a página, então aqui os eventos viram CALLBACKS pontuais e quem
 * decide o que recarregar é o app (conversa aberta na hora; lista num
 * respiro de 12s).
 *
 * Assina só mensagens (recebida/enviada) — mudanca_etapa e afins, que eram
 * 64% dos inserts, nem chegam ao navegador. Exige a publication da 0014;
 * sem ela não chega evento e o polling de 60s do app cobre.
 */
const RESPIRO_MS = 12_000;

type LinhaInteracao = { id?: string; lead_id?: string; tipo?: string };

export function TempoRealConversas({
  leadAbertoId,
  aoMensagemDoAberto,
  aoMudancaNaLista,
}: {
  leadAbertoId: string | null;
  /** Mensagem (recebida ou enviada por outra aba) na conversa aberta. */
  aoMensagemDoAberto: () => void;
  /** Qualquer movimento que mude a fila — agrupado no respiro. */
  aoMudancaNaLista: () => void;
}) {
  const timerRef = useRef<number | null>(null);
  // Pendências SEPARADAS: a conversa aberta só recarrega se chegou mensagem
  // NELA. Uma pendência só fazia o retorno à aba recarregar a conversa por
  // causa de mensagem de outro lead — e essa recarga marca lida, desfazendo
  // o "marcar como não lida" que a equipe tinha acabado de usar.
  const pendenteListaRef = useRef(false);
  const pendenteAbertoRef = useRef(false);
  const abertoRef = useRef(leadAbertoId);
  const cbAbertoRef = useRef(aoMensagemDoAberto);
  const cbListaRef = useRef(aoMudancaNaLista);
  // Espelha as props em refs FORA do render: o canal do Realtime é um só
  // (efeito de deps vazias) e lê sempre o valor mais novo por aqui.
  useEffect(() => {
    abertoRef.current = leadAbertoId;
    cbAbertoRef.current = aoMensagemDoAberto;
    cbListaRef.current = aoMudancaNaLista;
  }, [leadAbertoId, aoMensagemDoAberto, aoMudancaNaLista]);

  useEffect(() => {
    const supabase = createClient();

    const limparTimer = () => {
      if (timerRef.current !== null) {
        window.clearTimeout(timerRef.current);
        timerRef.current = null;
      }
    };

    const agendarLista = () => {
      if (timerRef.current !== null) return;
      timerRef.current = window.setTimeout(() => {
        timerRef.current = null;
        // Aba oculta não paga recarga: quem volta ressincroniza de uma vez.
        if (document.visibilityState !== "visible") {
          pendenteListaRef.current = true;
          return;
        }
        cbListaRef.current();
      }, RESPIRO_MS);
    };

    // A aba escondida perde eventos (o navegador congela o socket). Ao
    // voltar, ressincroniza SEMPRE — depender de "chegou evento" deixava
    // quem voltou do almoço olhando a fila de duas horas atrás.
    let estavaOculta = document.visibilityState !== "visible";
    const aoVoltar = () => {
      if (document.visibilityState !== "visible") {
        estavaOculta = true;
        return;
      }
      if (!estavaOculta) return;
      estavaOculta = false;
      // O respiro pendente seria uma segunda recarga logo atrás desta.
      limparTimer();
      pendenteListaRef.current = false;
      cbListaRef.current();
      // A conversa aberta só recarrega se chegou mensagem NELA.
      if (pendenteAbertoRef.current) {
        pendenteAbertoRef.current = false;
        cbAbertoRef.current();
      }
    };
    document.addEventListener("visibilitychange", aoVoltar);

    const aoEvento = (linha: LinhaInteracao) => {
      if (!linha.lead_id) return;
      // Eco do próprio envio: a Janela já colocou a mensagem na tela pelo
      // retorno da action. Recarregar aqui descartaria o estado local do
      // compositor por uma mensagem que já está lá.
      if (linha.id && consumirEcoRealtime(linha.id)) return;
      if (linha.lead_id === abertoRef.current) {
        if (document.visibilityState === "visible") {
          // A conversa na tela atualiza já — é o que o atendente olha.
          cbAbertoRef.current();
        } else {
          pendenteAbertoRef.current = true;
        }
      }
      agendarLista();
    };

    const canal = supabase
      .channel("conversas-tempo-real")
      .on(
        "postgres_changes",
        {
          event: "INSERT",
          schema: "public",
          table: "lead_interactions",
          filter: "tipo=eq.mensagem_recebida",
        },
        (payload) => aoEvento(payload.new as LinhaInteracao),
      )
      .on(
        "postgres_changes",
        {
          event: "INSERT",
          schema: "public",
          table: "lead_interactions",
          filter: "tipo=eq.mensagem_enviada",
        },
        (payload) => aoEvento(payload.new as LinhaInteracao),
      )
      .subscribe();

    return () => {
      document.removeEventListener("visibilitychange", aoVoltar);
      limparTimer();
      void supabase.removeChannel(canal);
    };
  }, []);

  return null;
}
