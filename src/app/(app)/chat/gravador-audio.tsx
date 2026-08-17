"use client";

import { useRef, useState } from "react";
import { Mic, Square } from "lucide-react";
// Fork do lamejs com o módulo MPEGMode corrigido — o original (1.2.1) lança
// "MPEGMode is not defined" em qualquer bundler e a conversão nunca funciona.
import lamejs from "@breezystack/lamejs";
import { cn } from "@/lib/utils";

const KBPS = 64;
const BLOCO = 1152; // tamanho de quadro do MP3

/** Converte a gravação (WebM/Opus ou MP4/AAC do iOS) para MP3, que o WhatsApp aceita. */
async function converterParaMp3(gravacao: Blob): Promise<File> {
  const contexto = new AudioContext();
  try {
    const audio = await contexto.decodeAudioData(await gravacao.arrayBuffer());
    const canal = audio.getChannelData(0); // mono basta para voz

    const amostras = new Int16Array(canal.length);
    for (let i = 0; i < canal.length; i++) {
      amostras[i] = Math.max(-1, Math.min(1, canal[i])) * 0x7fff;
    }

    const codificador = new lamejs.Mp3Encoder(1, audio.sampleRate, KBPS);
    const pedacos: Uint8Array[] = [];
    for (let i = 0; i < amostras.length; i += BLOCO) {
      const pedaco = codificador.encodeBuffer(amostras.subarray(i, i + BLOCO));
      if (pedaco.length > 0) pedacos.push(pedaco);
    }
    const final = codificador.flush();
    if (final.length > 0) pedacos.push(final);

    return new File(
      [new Blob(pedacos as BlobPart[], { type: "audio/mpeg" })],
      `voz-${Date.now()}.mp3`,
      { type: "audio/mpeg" },
    );
  } finally {
    // Fechar sempre — o iOS limita ~4 AudioContexts por página; vazar um a
    // cada erro esgotava o limite e silenciava o recurso.
    void contexto.close().catch(() => {});
  }
}

/**
 * Botão de voice note: grava do microfone, converte para MP3 e entrega o
 * arquivo para virar anexo — o atendente revisa antes de enviar.
 */
export function GravadorAudio({
  desabilitado,
  onGravado,
  onErro,
}: {
  desabilitado: boolean;
  onGravado: (arquivo: File) => void;
  onErro: (mensagem: string) => void;
}) {
  const [gravando, setGravando] = useState(false);
  const [convertendo, setConvertendo] = useState(false);
  const [segundos, setSegundos] = useState(0);
  const gravadorRef = useRef<MediaRecorder | null>(null);
  const relogios = useRef<number | null>(null);

  const pararRelogio = () => {
    if (relogios.current !== null) {
      clearInterval(relogios.current);
      relogios.current = null;
    }
  };

  const iniciar = async () => {
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      const mime = MediaRecorder.isTypeSupported("audio/webm;codecs=opus")
        ? "audio/webm;codecs=opus"
        : undefined;
      const gravador = new MediaRecorder(
        stream,
        mime ? { mimeType: mime } : undefined,
      );
      const pedacos: Blob[] = [];

      gravador.ondataavailable = (e) => {
        if (e.data.size > 0) pedacos.push(e.data);
      };
      gravador.onstop = async () => {
        stream.getTracks().forEach((t) => t.stop());
        pararRelogio();
        setGravando(false);
        setConvertendo(true);
        try {
          const arquivo = await converterParaMp3(
            new Blob(pedacos, { type: gravador.mimeType }),
          );
          onGravado(arquivo);
        } catch {
          onErro("Não deu para converter o áudio — tente de novo.");
        } finally {
          setConvertendo(false);
          setSegundos(0);
        }
      };

      gravadorRef.current = gravador;
      gravador.start();
      setGravando(true);
      setSegundos(0);
      relogios.current = window.setInterval(
        () => setSegundos((s) => s + 1),
        1000,
      );
    } catch {
      onErro("Sem acesso ao microfone — libere a permissão no navegador.");
    }
  };

  const parar = () => gravadorRef.current?.stop();

  return (
    <span className="inline-flex items-center gap-0.5">
      <button
        type="button"
        aria-label={gravando ? "Parar gravação" : "Gravar áudio"}
        title={gravando ? "Parar e anexar" : "Gravar áudio (voice note)"}
        disabled={desabilitado || convertendo}
        onClick={gravando ? parar : iniciar}
        className={cn(
          "inline-flex h-[40px] w-[40px] shrink-0 items-center justify-center rounded-md border transition-colors duration-[120ms] focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-primary-500 disabled:cursor-not-allowed disabled:text-neutral-300",
          gravando
            ? "border-danger bg-danger-bg text-danger"
            : "border-neutral-300 bg-neutral-0 text-neutral-600 hover:bg-neutral-100 hover:text-neutral-800",
        )}
      >
        {gravando ? (
          <Square size={16} strokeWidth={1.5} aria-hidden />
        ) : (
          <Mic size={16} strokeWidth={1.5} aria-hidden />
        )}
      </button>
      {gravando ? (
        <span
          aria-live="polite"
          className="font-mono text-xs text-danger tabular-nums"
        >
          {Math.floor(segundos / 60)}:{String(segundos % 60).padStart(2, "0")}
        </span>
      ) : convertendo ? (
        <span className="font-mono text-xs text-neutral-400">…</span>
      ) : null}
    </span>
  );
}
