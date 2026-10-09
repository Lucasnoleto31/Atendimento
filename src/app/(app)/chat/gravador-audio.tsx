"use client";

import { useEffect, useRef, useState } from "react";
import { Mic, Send } from "lucide-react";
import { cn } from "@/lib/utils";
import { Spinner } from "@/components/ui/spinner";
import { classesDoBotao } from "@/components/ui/button";
import { BOTAO_ICONE } from "@/components/app/form-styles";
import type { CanalConversa } from "./mensagem";

/** Menos que isso não é áudio: é toque rápido (vira a dica). */
const MINIMO_MS = 600;
/** Quanto o dedo anda para a esquerda até cancelar. */
const ARRASTO_CANCELA_PX = 96;
/** Voz em Opus: 24 kbps fica abaixo dos 512 KB em quase 3 minutos, o
 *  tamanho até o qual o WhatsApp mostra o play em vez de baixar. */
const BITS_OPUS = 24_000;
const DICA_MS = 2500;

type Fase = "parado" | "iniciando" | "gravando" | "convertendo";
type Jeito = "toque" | "clique";

/** O que o navegador grava, na ordem do que cada canal entrega melhor. */
function formatoDaGravacao(canal: CanalConversa): string | undefined {
  if (
    typeof MediaRecorder === "undefined" ||
    typeof MediaRecorder.isTypeSupported !== "function"
  ) {
    return undefined;
  }
  const ordem =
    canal === "instagram"
      ? ["audio/webm;codecs=opus", "audio/ogg;codecs=opus", "audio/mp4"]
      : [
          "audio/ogg;codecs=opus",
          "audio/webm;codecs=opus",
          "audio/mp4;codecs=mp4a.40.2",
          "audio/mp4",
        ];
  return ordem.find((tipo) => MediaRecorder.isTypeSupported(tipo));
}

function relogio(segundos: number) {
  return `${Math.floor(segundos / 60)}:${String(segundos % 60).padStart(2, "0")}`;
}

/**
 * O microfone do compositor, no lugar do Enviar com o campo vazio, como no
 * WhatsApp. No toque, segurar grava e soltar envia; arrastar para a
 * esquerda cancela. Com mouse ou teclado, clicar grava, e a barra mostra o
 * relógio, Cancelar e Enviar (Esc também cancela). Sem travar e sem pausar.
 * O áudio pronto vai direto para o envio (aoGravado).
 */
export function GravadorAudio({
  canal,
  toque,
  aoGravado,
  aoErro,
  aoOcupar,
}: {
  canal: CanalConversa;
  /** Tela de toque: o microfone ganha o desenho do botão principal. */
  toque: boolean;
  aoGravado: (arquivo: File) => void;
  aoErro: (mensagem: string) => void;
  /** Da largada até o áudio pronto, a barra do compositor é do gravador. */
  aoOcupar: (ocupado: boolean) => void;
}) {
  const [fase, setFase] = useState<Fase>("parado");
  const [jeito, setJeito] = useState<Jeito>("clique");
  const [segundos, setSegundos] = useState(0);
  const [arrasto, setArrasto] = useState(0);
  const [dica, setDica] = useState<string | null>(null);

  // Os manipuladores leem o estado pelos refs: o evento chega antes do
  // render seguinte.
  const faseRef = useRef<Fase>("parado");
  const gravadorRef = useRef<MediaRecorder | null>(null);
  const modulo = useRef<Promise<typeof import("./audio-gravado")> | null>(null);
  // Cada largada ganha um número. Soltar ou cancelar antes de o microfone
  // ligar (o pedido de permissão do navegador tira o dedo da tela) troca o
  // número, e a largada velha desliga o microfone quando ele chegar.
  const largadaRef = useRef(0);
  const jeitoRef = useRef<Jeito>("clique");
  const descartarRef = useRef(false);
  const dedoRef = useRef<{ id: number; x: number } | null>(null);
  // O clique que o navegador manda depois do toque não é um segundo gesto.
  const ignorarCliqueAte = useRef(0);
  const montadoRef = useRef(false);
  const botaoRef = useRef<HTMLButtonElement>(null);
  const avisos = useRef({ aoGravado, aoErro, aoOcupar });
  useEffect(() => {
    avisos.current = { aoGravado, aoErro, aoOcupar };
  });

  const mudarFase = (nova: Fase) => {
    const ocupado = nova !== "parado";
    if ((faseRef.current !== "parado") !== ocupado) {
      avisos.current.aoOcupar(ocupado);
    }
    faseRef.current = nova;
    setFase(nova);
  };
  const voltarAoInicio = () => {
    mudarFase("parado");
    setSegundos(0);
    setArrasto(0);
  };

  const iniciar = async (comoComecou: Jeito) => {
    if (faseRef.current !== "parado") return;
    const largada = ++largadaRef.current;
    descartarRef.current = false;
    setDica(null);
    jeitoRef.current = comoComecou;
    setJeito(comoComecou);
    mudarFase("iniciando");
    modulo.current ??= import("./audio-gravado");
    modulo.current.catch(() => {});

    let stream: MediaStream;
    try {
      stream = await navigator.mediaDevices.getUserMedia({
        audio: {
          channelCount: 1,
          echoCancellation: true,
          noiseSuppression: true,
          autoGainControl: true,
        },
      });
    } catch (e) {
      if (!montadoRef.current) return;
      // Na primeira vez, o dedo sai da tela para tocar em "Não permitir":
      // a largada já foi trocada (com a dica do gesto, ou calada pelo
      // pointercancel do iPhone). A recusa avisa mesmo assim, e a dica sai,
      // senão a tela culpava o gesto em vez da permissão.
      const negado =
        e instanceof DOMException &&
        (e.name === "NotAllowedError" || e.name === "SecurityError");
      if (largada !== largadaRef.current) {
        if (!negado) return;
        setDica(null);
      } else {
        voltarAoInicio();
      }
      avisos.current.aoErro(
        "Sem acesso ao microfone. Libere a permissão no navegador.",
      );
      return;
    }
    // Saiu da conversa, soltou ou cancelou enquanto o navegador pedia a
    // permissão: o microfone desliga sem gravar.
    if (!montadoRef.current || largada !== largadaRef.current) {
      stream.getTracks().forEach((t) => t.stop());
      return;
    }

    const formato = formatoDaGravacao(canal);
    const opus = formato?.includes("opus") ?? false;
    // A voz do WhatsApp só aceita mono. Microfone estéreo passa por um
    // contexto de áudio que mistura em um canal antes de gravar.
    let fonte = stream;
    let contexto: AudioContext | null = null;
    try {
      if (opus && (stream.getAudioTracks()[0]?.getSettings().channelCount ?? 1) > 1) {
        contexto = new AudioContext();
        const destino = contexto.createMediaStreamDestination();
        destino.channelCount = 1;
        destino.channelCountMode = "explicit";
        contexto.createMediaStreamSource(stream).connect(destino);
        void contexto.resume().catch(() => {});
        fonte = destino.stream;
      }
      const gravador = new MediaRecorder(fonte, {
        ...(formato ? { mimeType: formato } : {}),
        ...(opus ? { audioBitsPerSecond: BITS_OPUS } : {}),
      });
      const pedacos: Blob[] = [];
      let inicio = 0;
      let relogioId: number | null = null;
      gravador.ondataavailable = (e) => {
        if (e.data.size > 0) pedacos.push(e.data);
      };
      gravador.onstop = async () => {
        stream.getTracks().forEach((t) => t.stop());
        void contexto?.close().catch(() => {});
        if (relogioId !== null) window.clearInterval(relogioId);
        gravadorRef.current = null;
        if (!montadoRef.current) return;
        const curto = performance.now() - inicio < MINIMO_MS;
        if (descartarRef.current || curto) {
          voltarAoInicio();
          if (curto && !descartarRef.current && comoComecou === "toque") {
            setDica("Segure para gravar e solte para enviar.");
          }
          return;
        }
        mudarFase("convertendo");
        try {
          const { prepararGravacao } = await modulo.current!;
          const tipo = gravador.mimeType || pedacos[0]?.type || formato || "";
          const arquivo = await prepararGravacao(new Blob(pedacos, { type: tipo }), canal);
          if (montadoRef.current) avisos.current.aoGravado(arquivo);
        } catch {
          if (montadoRef.current) {
            avisos.current.aoErro("O áudio não converteu. Grave de novo.");
          }
        } finally {
          if (montadoRef.current) voltarAoInicio();
        }
      };
      gravadorRef.current = gravador;
      gravador.start();
      inicio = performance.now();
      setSegundos(0);
      relogioId = window.setInterval(() => {
        setSegundos(Math.floor((performance.now() - inicio) / 1000));
      }, 250);
      mudarFase("gravando");
    } catch {
      // O MediaRecorder recusou (ou não existe): o microfone já estava
      // ligado e desliga aqui.
      stream.getTracks().forEach((t) => t.stop());
      void contexto?.close().catch(() => {});
      voltarAoInicio();
      avisos.current.aoErro("Este navegador não grava áudio. Anexe um arquivo de áudio.");
    }
  };

  /** Para e manda: o onstop converte e entrega. */
  const enviar = () => {
    if (faseRef.current === "iniciando") {
      // Soltou antes de o microfone ligar: foi um toque, não um áudio.
      largadaRef.current++;
      voltarAoInicio();
      if (jeitoRef.current === "toque") {
        setDica("Segure para gravar e solte para enviar.");
      }
      return;
    }
    if (faseRef.current === "gravando") gravadorRef.current?.stop();
  };

  const cancelar = () => {
    descartarRef.current = true;
    setArrasto(0);
    if (faseRef.current === "iniciando") {
      largadaRef.current++;
      voltarAoInicio();
      if (jeitoRef.current === "clique") {
        botaoRef.current?.focus({ preventScroll: true });
      }
      return;
    }
    const gravador = gravadorRef.current;
    if (!gravador || gravador.state === "inactive") return;
    // O Cancelar some: o foco passa ao microfone (solto no body, a próxima
    // letra viraria atalho do palco, e E resolve a conversa).
    if (jeitoRef.current === "clique") {
      botaoRef.current?.focus({ preventScroll: true });
    }
    gravador.stop();
  };

  // Sair da conversa no meio (a Janela troca a chave por conversa, e o
  // gravador sai junto com o campo): o microfone desliga e o áudio vai fora.
  // O montadoRef liga aqui, e não no useRef, para o desmontar-e-montar do
  // StrictMode não deixá-lo falso.
  useEffect(() => {
    montadoRef.current = true;
    return () => {
      montadoRef.current = false;
      descartarRef.current = true;
      const gravador = gravadorRef.current;
      if (gravador && gravador.state !== "inactive") gravador.stop();
      if (faseRef.current !== "parado") {
        faseRef.current = "parado";
        avisos.current.aoOcupar(false);
      }
    };
  }, []);

  useEffect(() => {
    if (!dica) return;
    const t = window.setTimeout(() => setDica(null), DICA_MS);
    return () => window.clearTimeout(t);
  }, [dica]);

  const ocupado = fase !== "parado";
  const gravandoNoClique = ocupado && jeito === "clique" && fase !== "convertendo";
  const gravandoNoToque = ocupado && jeito === "toque" && fase !== "convertendo";

  return (
    <div
      // Gravando, as teclas são do gravador: com o foco no Enviar, o E não
      // pode resolver a conversa nem o J trocar de conversa no meio.
      data-popover={ocupado ? "gravador" : undefined}
      className={cn(
        "relative flex items-center",
        ocupado && "min-w-0 flex-1 gap-1",
      )}
      onKeyDown={(e) => {
        if (e.key !== "Escape" || (fase !== "gravando" && fase !== "iniciando")) {
          return;
        }
        e.preventDefault();
        e.stopPropagation();
        cancelar();
      }}
    >
      {gravandoNoClique ? (
        <button
          type="button"
          onClick={cancelar}
          className="tipo-nota inline-flex h-[40px] shrink-0 items-center rounded-controle px-1 font-semibold text-texto-2 transition-colors duration-[120ms] hover:bg-realce hover:text-tinta focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-tinta pointer-coarse:h-[44px]"
        >
          Cancelar
        </button>
      ) : null}
      {ocupado ? (
        <span className="tipo-nota inline-flex shrink-0 items-center gap-0.5 font-semibold text-tinta tabular-nums">
          <span
            aria-hidden
            className={cn(
              "h-[8px] w-[8px] rounded-full",
              fase === "gravando" ? "bg-erro motion-safe:animate-pulse" : "bg-texto-3",
            )}
          />
          {relogio(segundos)}
          <span className="sr-only" role="status">
            {fase === "gravando" ? "Gravando áudio" : ""}
          </span>
        </span>
      ) : null}
      {gravandoNoToque ? (
        <span
          aria-hidden
          className="tipo-nota min-w-0 flex-1 truncate text-right text-texto-2"
          style={{
            transform: `translateX(${arrasto}px)`,
            opacity: 1 + (arrasto / ARRASTO_CANCELA_PX) * 0.7,
          }}
        >
          ‹ Arraste para cancelar
        </span>
      ) : ocupado ? (
        <span aria-hidden className="flex-1" />
      ) : null}
      <button
        ref={botaoRef}
        type="button"
        // aria-disabled, e não disabled: o botão desativado perde o foco
        // para o body, e a próxima letra viraria atalho do palco. O clique
        // nesta fase não faz nada (enviar só age gravando).
        aria-disabled={fase === "convertendo" || undefined}
        aria-label={gravandoNoClique ? "Enviar o áudio" : "Gravar áudio"}
        title={
          gravandoNoClique
            ? "Enviar o áudio"
            : toque
              ? "Segure para gravar e solte para enviar"
              : "Gravar áudio"
        }
        onPointerDown={(e) => {
          if (e.pointerType !== "touch" || e.button !== 0) return;
          ignorarCliqueAte.current = performance.now() + 1000;
          if (faseRef.current !== "parado") return;
          e.currentTarget.setPointerCapture(e.pointerId);
          dedoRef.current = { id: e.pointerId, x: e.clientX };
          void iniciar("toque");
        }}
        onPointerMove={(e) => {
          const dedo = dedoRef.current;
          if (!dedo || e.pointerId !== dedo.id) return;
          const dx = Math.min(0, e.clientX - dedo.x);
          if (dx <= -ARRASTO_CANCELA_PX) {
            dedoRef.current = null;
            cancelar();
            return;
          }
          setArrasto(dx);
        }}
        onPointerUp={(e) => {
          const dedo = dedoRef.current;
          if (!dedo || e.pointerId !== dedo.id) return;
          dedoRef.current = null;
          ignorarCliqueAte.current = performance.now() + 500;
          setArrasto(0);
          enviar();
        }}
        onPointerCancel={(e) => {
          // O sistema tomou o gesto (chamada, notificação): na dúvida, o
          // áudio não sai.
          const dedo = dedoRef.current;
          if (!dedo || e.pointerId !== dedo.id) return;
          dedoRef.current = null;
          ignorarCliqueAte.current = performance.now() + 500;
          cancelar();
        }}
        onClick={() => {
          if (performance.now() < ignorarCliqueAte.current) return;
          if (faseRef.current === "parado") void iniciar("clique");
          else if (jeitoRef.current === "clique") enviar();
        }}
        onContextMenu={(e) => e.preventDefault()}
        className={cn(
          "shrink-0 touch-none select-none [-webkit-touch-callout:none]",
          toque || gravandoNoClique || gravandoNoToque
            ? classesDoBotao({
                variant: "primary",
                size: "md",
                className: cn(
                  "w-[40px] px-0 pointer-coarse:h-[44px] pointer-coarse:w-[44px]",
                  gravandoNoClique && "md:w-auto md:px-2",
                ),
              })
            : BOTAO_ICONE,
          // Segurando, o botão fica no tom do toque, como o principal
          // apertado.
          gravandoNoToque && "bg-tinta-hover",
        )}
      >
        {fase === "convertendo" ? (
          <Spinner tamanho={18} rotulo="Preparando o áudio" />
        ) : gravandoNoClique ? (
          <Send size={18} strokeWidth={1.75} aria-hidden />
        ) : (
          <Mic size={20} strokeWidth={1.75} aria-hidden />
        )}
        {gravandoNoClique ? <span className="hidden md:inline">Enviar</span> : null}
      </button>
      {dica ? (
        <p
          role="status"
          className="tipo-nota absolute right-0 bottom-[calc(100%+8px)] z-30 w-max max-w-[240px] animate-entrada rounded-controle border border-fio bg-flutuante px-1 py-0.5 text-tinta shadow-lg"
        >
          {dica}
        </p>
      ) : null}
    </div>
  );
}
