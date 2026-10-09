"use client";

import { useEffect, useRef, useState } from "react";
import { Headphones, Mic, Pause, Play, TriangleAlert } from "lucide-react";
import { cn } from "@/lib/utils";
import { Spinner } from "@/components/ui/spinner";
import { anelDeFoco, useQuaseVisivel } from "./midia";

/*
 * O áudio do jeito do WhatsApp: tocar e pausar, a barra que arrasta, a
 * duração (a posição enquanto toca) e a velocidade 1x, 1,5x e 2x. Um áudio
 * por vez: dar o play em outro pausa o que tocava. A velocidade escolhida
 * vale para os próximos, como no app.
 */

const VELOCIDADES = [1, 1.5, 2] as const;

/** A velocidade que a pessoa escolheu por último, nesta aba. */
let velocidadeEscolhida: number = 1;
/** O áudio que está tocando agora, para o próximo play pausá-lo. */
let tocandoAgora: HTMLAudioElement | null = null;

/** "0:07", "1:23", "1:02:05". */
function tempo(segundos: number): string {
  const s = Math.max(0, Math.floor(segundos));
  const h = Math.floor(s / 3600);
  const m = Math.floor((s % 3600) / 60);
  const resto = String(s % 60).padStart(2, "0");
  return h > 0 ? `${h}:${String(m).padStart(2, "0")}:${resto}` : `${m}:${resto}`;
}

/** "1x", "1,5x", "2x". */
function rotuloVelocidade(v: number): string {
  return `${v.toLocaleString("pt-BR")}x`;
}

/** O tempo por extenso para o leitor de tela: "1 minuto e 5 segundos". */
function tempoPorExtenso(segundos: number): string {
  const s = Math.max(0, Math.floor(segundos));
  const m = Math.floor(s / 60);
  const resto = s % 60;
  const partes = [
    m > 0 ? `${m.toLocaleString("pt-BR")} ${m === 1 ? "minuto" : "minutos"}` : null,
    resto > 0 || m === 0
      ? `${resto.toLocaleString("pt-BR")} ${resto === 1 ? "segundo" : "segundos"}`
      : null,
  ].filter(Boolean);
  return partes.join(" e ");
}

export function PlayerAudio({
  url,
  voz = false,
  sobreTinta,
  ouvida = false,
  rodape,
}: {
  url: string;
  /** Gravado na hora no app (a mensagem de voz), não um arquivo. */
  voz?: boolean;
  sobreTinta: boolean;
  /** A mensagem de voz nossa que o contato já ouviu (recibo "played"). */
  ouvida?: boolean;
  /** A hora e o recibo da bolha, na linha da duração. */
  rodape?: React.ReactNode;
}) {
  const audioRef = useRef<HTMLAudioElement>(null);
  const caixaRef = useRef<HTMLDivElement>(null);
  const visivel = useQuaseVisivel(caixaRef);
  const [tocando, setTocando] = useState(false);
  const [esperando, setEsperando] = useState(false);
  const [duracao, setDuracao] = useState<number | null>(null);
  const [posicao, setPosicao] = useState(0);
  const [velocidade, setVelocidade] = useState(velocidadeEscolhida);
  const [falhou, setFalhou] = useState(false);
  // Começou a tocar alguma vez: a linha mostra a posição, não a duração.
  const [comecou, setComecou] = useState(false);

  // Saiu da tela tocando (trocou de conversa): para, em vez de seguir
  // falando sem player à vista.
  useEffect(() => {
    const audio = audioRef.current;
    return () => {
      if (!audio) return;
      audio.pause();
      if (tocandoAgora === audio) tocandoAgora = null;
    };
  }, []);

  const lerDuracao = () => {
    const d = audioRef.current?.duration;
    // WebM e Ogg gravados no navegador às vezes dizem Infinity até tocar.
    setDuracao(d !== undefined && Number.isFinite(d) && d > 0 ? d : null);
  };

  const alternar = () => {
    const audio = audioRef.current;
    if (!audio) return;
    if (!audio.paused) {
      audio.pause();
      return;
    }
    if (tocandoAgora && tocandoAgora !== audio) tocandoAgora.pause();
    tocandoAgora = audio;
    audio.playbackRate = velocidadeEscolhida;
    setVelocidade(velocidadeEscolhida);
    setFalhou(false);
    setComecou(true);
    audio.play().catch(() => {
      setFalhou(true);
      setEsperando(false);
    });
  };

  const trocarVelocidade = () => {
    const i = VELOCIDADES.indexOf(velocidade as (typeof VELOCIDADES)[number]);
    const proxima = VELOCIDADES[(i + 1) % VELOCIDADES.length];
    velocidadeEscolhida = proxima;
    setVelocidade(proxima);
    if (audioRef.current) audioRef.current.playbackRate = proxima;
  };

  const total = duracao ?? 0;
  const apoio = sobreTinta ? "text-primary-100" : "text-texto-2";
  const anel = anelDeFoco(sobreTinta);
  const IconeTipo = voz ? Mic : Headphones;

  return (
    <div ref={caixaRef} className="flex w-[264px] max-w-full items-center gap-1">
      <audio
        ref={audioRef}
        src={url}
        // Só os metadados (a duração) e só perto da tela; o arquivo baixa
        // no play.
        preload={visivel ? "metadata" : "none"}
        onLoadedMetadata={lerDuracao}
        onDurationChange={lerDuracao}
        onTimeUpdate={(e) => setPosicao(e.currentTarget.currentTime)}
        onPlay={() => setTocando(true)}
        onPause={() => setTocando(false)}
        onWaiting={() => setEsperando(true)}
        onPlaying={() => setEsperando(false)}
        onCanPlay={() => setEsperando(false)}
        onEnded={(e) => {
          setTocando(false);
          setPosicao(0);
          e.currentTarget.currentTime = 0;
          if (tocandoAgora === e.currentTarget) tocandoAgora = null;
        }}
        onError={() => {
          setFalhou(true);
          setTocando(false);
          setEsperando(false);
        }}
        className="hidden"
      />
      <button
        type="button"
        onClick={alternar}
        aria-label={tocando ? "Pausar o áudio" : "Tocar o áudio"}
        className={cn(
          "inline-flex h-[40px] w-[40px] shrink-0 items-center justify-center rounded-controle transition-[background-color,scale] duration-[120ms] motion-safe:active:scale-[.97] pointer-coarse:h-[44px] pointer-coarse:w-[44px]",
          sobreTinta
            ? "text-fundo hover:bg-fundo/10"
            : "text-tinta hover:bg-realce active:bg-pressionado",
          anel,
        )}
      >
        {esperando && tocando ? (
          <Spinner tamanho={20} rotulo="Carregando o áudio" />
        ) : tocando ? (
          <Pause size={22} strokeWidth={1.75} fill="currentColor" aria-hidden />
        ) : (
          <Play
            size={22}
            strokeWidth={1.75}
            fill="currentColor"
            aria-hidden
            className="translate-x-[1px]"
          />
        )}
      </button>

      <div className="min-w-0 flex-1">
        <input
          type="range"
          min={0}
          max={total || 1}
          step={0.1}
          value={Math.min(posicao, total || 1)}
          disabled={!total}
          onChange={(e) => {
            const v = Number(e.target.value);
            setPosicao(v);
            if (audioRef.current) audioRef.current.currentTime = v;
          }}
          aria-label="Posição do áudio"
          aria-valuetext={
            total
              ? `${tempoPorExtenso(posicao)} de ${tempoPorExtenso(total)}`
              : "Duração ainda não carregada"
          }
          className={cn(
            "block h-[24px] w-full cursor-pointer disabled:cursor-default pointer-coarse:h-[44px]",
            sobreTinta ? "accent-fundo" : "accent-tinta",
            anel,
          )}
        />
        <div className="flex items-center gap-0.5">
          <span
            className={cn(
              "tipo-legenda inline-flex min-w-0 flex-1 items-center gap-0.5 tabular-nums",
              apoio,
            )}
          >
            {falhou ? (
              <>
                <TriangleAlert size={12} strokeWidth={2} aria-hidden />
                <span>O áudio não tocou.</span>
                <a
                  href={url}
                  target="_blank"
                  rel="noreferrer"
                  className={cn("underline underline-offset-2", anel)}
                >
                  Abrir
                </a>
              </>
            ) : (
              <>
                <IconeTipo
                  size={12}
                  strokeWidth={ouvida ? 2.5 : 1.75}
                  aria-label={
                    voz ? (ouvida ? "Mensagem de voz ouvida" : "Mensagem de voz") : "Arquivo de áudio"
                  }
                  className={cn(ouvida && (sobreTinta ? "text-fundo" : "text-tinta"))}
                />
                <span>
                  {comecou || posicao > 0
                    ? tempo(posicao)
                    : duracao !== null
                      ? tempo(duracao)
                      : ""}
                </span>
              </>
            )}
          </span>
          {rodape}
        </div>
      </div>

      <button
        type="button"
        onClick={trocarVelocidade}
        aria-label={`Velocidade ${rotuloVelocidade(velocidade)}. Trocar`}
        title="Velocidade"
        className={cn(
          "tipo-legenda relative inline-flex h-[28px] min-w-[40px] shrink-0 items-center justify-center self-start rounded-chip px-0.5 font-semibold tabular-nums transition-colors duration-[120ms] pointer-coarse:after:absolute pointer-coarse:after:-inset-[8px] mt-[6px] pointer-coarse:mt-[8px]",
          sobreTinta
            ? "bg-tinta-hover text-fundo hover:bg-fundo/10"
            : "bg-fundo text-tinta hover:bg-realce",
          anel,
        )}
      >
        {rotuloVelocidade(velocidade)}
      </button>
    </div>
  );
}
