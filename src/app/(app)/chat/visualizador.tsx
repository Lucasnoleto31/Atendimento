"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import {
  ChevronLeft,
  ChevronRight,
  Download,
  X,
  ZoomIn,
  ZoomOut,
} from "lucide-react";
import { cn } from "@/lib/utils";
import { Spinner } from "@/components/ui/spinner";
import { urlParaBaixar } from "./midia";

/*
 * As imagens da conversa em tela cheia, como no WhatsApp: setas (e ← → no
 * teclado), deslizar para o lado no celular, Esc fecha, baixar e zoom
 * (botão, duplo clique ou toque duplo, roda do mouse e pinça). O fundo é
 * preto nos dois temas: é a moldura da foto, não uma superfície do app.
 *
 * Diálogo modal de verdade (role="dialog" + aria-modal): a casca esconde a
 * barra de abas e o chat desliga J, E e H enquanto ele está aberto. O foco
 * entra nele, fica preso nele e volta a quem abriu.
 */

export type ItemVisualizador = {
  url: string;
  nome: string | null;
  /** O texto que veio junto da imagem. */
  legenda: string | null;
  /** Quem mandou: o nome de quem da equipe ou "Contato". */
  autor: string;
  em: string;
};

const ZOOM_MAX = 4;
const ZOOM_DUPLO = 2.5;
/** Deslize que troca de imagem, e a faixa da borda que o gesto ignora
 *  (é do voltar do sistema; kit, bloco 6). */
const DESLIZE_PX = 60;
const BORDA_GESTO_PX = 24;

const FORMATO_DATA = new Intl.DateTimeFormat("pt-BR", {
  timeZone: "America/Sao_Paulo",
  day: "2-digit",
  month: "2-digit",
  year: "numeric",
});
const FORMATO_HORA = new Intl.DateTimeFormat("pt-BR", {
  timeZone: "America/Sao_Paulo",
  hour: "numeric",
  minute: "2-digit",
  hourCycle: "h23",
});

/** "07/10/2026 · 9h05" */
function quando(iso: string): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return "";
  const partes = FORMATO_HORA.formatToParts(d);
  const h = Number(partes.find((p) => p.type === "hour")?.value ?? 0);
  const m = partes.find((p) => p.type === "minute")?.value ?? "00";
  return `${FORMATO_DATA.format(d)} · ${h}h${m === "00" ? "" : m}`;
}

type Ponto = { x: number; y: number };

const BOTAO_ESCURO =
  "inline-flex h-[44px] w-[44px] shrink-0 items-center justify-center rounded-controle text-white transition-colors duration-[120ms] hover:bg-white/10 active:bg-white/20 disabled:opacity-40 disabled:hover:bg-transparent focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-white";

export function Visualizador({
  itens,
  inicial,
  aoFechar,
}: {
  itens: ItemVisualizador[];
  inicial: number;
  aoFechar: () => void;
}) {
  const [indice, setIndice] = useState(() =>
    Math.min(Math.max(inicial, 0), Math.max(itens.length - 1, 0)),
  );
  const [zoom, setZoom] = useState(1);
  const [desloc, setDesloc] = useState<Ponto>({ x: 0, y: 0 });
  // O arrasto do deslize sem zoom: a foto acompanha o dedo.
  const [arrasto, setArrasto] = useState(0);
  const [carregada, setCarregada] = useState(false);
  const [falhou, setFalhou] = useState(false);
  // Os gestos leem o zoom e o deslocamento do momento, não os do render.
  const zoomRef = useRef(1);
  const deslocRef = useRef<Ponto>({ x: 0, y: 0 });

  const raizRef = useRef<HTMLDivElement>(null);
  const palcoRef = useRef<HTMLDivElement>(null);
  const imagemRef = useRef<HTMLImageElement>(null);
  const aoFecharRef = useRef(aoFechar);
  useEffect(() => {
    aoFecharRef.current = aoFechar;
  });

  const item = itens[indice];
  const total = itens.length;

  const definirZoom = useCallback((z: number, d: Ponto) => {
    zoomRef.current = z;
    deslocRef.current = d;
    setZoom(z);
    setDesloc(d);
  }, []);

  // O foco entra no visualizador e volta a quem o abriu.
  useEffect(() => {
    const antes = document.activeElement as HTMLElement | null;
    raizRef.current?.focus({ preventScroll: true });
    return () => {
      if (antes && antes.isConnected && !antes.closest("[inert]")) {
        antes.focus({ preventScroll: true });
      }
    };
  }, []);

  // As vizinhas já baixam, para a troca não piscar.
  useEffect(() => {
    for (const i of [indice - 1, indice + 1]) {
      const url = itens[i]?.url;
      if (url) {
        const pre = new Image();
        pre.src = url;
      }
    }
  }, [indice, itens]);

  /** Troca de imagem: zera o zoom e o estado de carga da que entra. */
  const ir = useCallback(
    (passo: number) => {
      const proximo = Math.min(Math.max(indice + passo, 0), total - 1);
      if (proximo === indice) return;
      definirZoom(1, { x: 0, y: 0 });
      setArrasto(0);
      setCarregada(false);
      setFalhou(false);
      setIndice(proximo);
    },
    [indice, total, definirZoom],
  );

  /** O deslocamento que ainda mostra a imagem: não deixa a foto sair do
   *  quadro com o zoom. */
  const limitar = useCallback((d: Ponto, z: number): Ponto => {
    const img = imagemRef.current;
    const palco = palcoRef.current;
    if (!img || !palco || z <= 1) return { x: 0, y: 0 };
    const maxX = Math.max((img.clientWidth * z - palco.clientWidth) / 2, 0);
    const maxY = Math.max((img.clientHeight * z - palco.clientHeight) / 2, 0);
    return {
      x: Math.min(Math.max(d.x, -maxX), maxX),
      y: Math.min(Math.max(d.y, -maxY), maxY),
    };
  }, []);

  /** Zoom ancorado num ponto da tela (o dedo, o cursor ou o centro). */
  const aplicarZoom = useCallback(
    (novo: number, ancora?: Ponto) => {
      const palco = palcoRef.current;
      const z = Math.min(Math.max(novo, 1), ZOOM_MAX);
      if (z === 1) {
        definirZoom(1, { x: 0, y: 0 });
        return;
      }
      const zAtual = zoomRef.current;
      const d = deslocRef.current;
      if (!palco || !ancora) {
        definirZoom(z, limitar(d, z));
        return;
      }
      const caixa = palco.getBoundingClientRect();
      // O ponto relativo ao centro do palco fica parado sob a âncora.
      const p = {
        x: ancora.x - (caixa.left + caixa.width / 2),
        y: ancora.y - (caixa.top + caixa.height / 2),
      };
      const fator = z / zAtual;
      definirZoom(
        z,
        limitar({ x: p.x - (p.x - d.x) * fator, y: p.y - (p.y - d.y) * fator }, z),
      );
    },
    [limitar, definirZoom],
  );

  // A roda do mouse aproxima e afasta. Ouvinte nativo e não passivo: sem
  // ele, a roda rolaria a conversa por trás.
  useEffect(() => {
    const palco = palcoRef.current;
    if (!palco) return;
    const aoRolar = (e: WheelEvent) => {
      e.preventDefault();
      aplicarZoom(zoomRef.current * Math.exp(-e.deltaY * 0.002), {
        x: e.clientX,
        y: e.clientY,
      });
    };
    palco.addEventListener("wheel", aoRolar, { passive: false });
    return () => palco.removeEventListener("wheel", aoRolar);
  }, [aplicarZoom]);

  // Os gestos: um dedo arrasta (com zoom) ou desliza (sem zoom); dois
  // dedos fazem a pinça.
  const ponteiros = useRef(new Map<number, Ponto>());
  const gesto = useRef<{
    inicio: Ponto;
    deslocInicio: Ponto;
    zoomInicio: number;
    distanciaInicio: number;
    ignorar: boolean;
    moveu: boolean;
  } | null>(null);
  const ultimoToque = useRef<{ t: number; p: Ponto } | null>(null);

  const distancia = () => {
    const [a, b] = [...ponteiros.current.values()];
    return a && b ? Math.hypot(a.x - b.x, a.y - b.y) : 0;
  };

  /** Seta e link moram no palco: o gesto não começa neles. Com a captura
   *  do ponteiro no palco, o Chrome entrega o clique do mouse ao palco e
   *  o botão não recebe nada. */
  const ehControle = (alvo: EventTarget | null) =>
    alvo instanceof Element && alvo.closest("button, a") !== null;

  const aoApertar = (e: React.PointerEvent<HTMLDivElement>) => {
    if (e.pointerType === "mouse" && e.button !== 0) return;
    if (ehControle(e.target)) return;
    ponteiros.current.set(e.pointerId, { x: e.clientX, y: e.clientY });
    try {
      e.currentTarget.setPointerCapture(e.pointerId);
    } catch {
      // sem captura: o gesto vale enquanto o ponteiro estiver no palco
    }
    const largura = e.currentTarget.clientWidth;
    gesto.current = {
      inicio: { x: e.clientX, y: e.clientY },
      deslocInicio: deslocRef.current,
      zoomInicio: zoomRef.current,
      distanciaInicio: distancia(),
      ignorar:
        e.pointerType === "touch" &&
        ponteiros.current.size === 1 &&
        (e.clientX < BORDA_GESTO_PX || e.clientX > largura - BORDA_GESTO_PX),
      moveu: false,
    };
  };

  const aoMover = (e: React.PointerEvent<HTMLDivElement>) => {
    if (!ponteiros.current.has(e.pointerId)) return;
    ponteiros.current.set(e.pointerId, { x: e.clientX, y: e.clientY });
    const g = gesto.current;
    if (!g || g.ignorar) return;
    const dx = e.clientX - g.inicio.x;
    const dy = e.clientY - g.inicio.y;
    if (Math.abs(dx) > 4 || Math.abs(dy) > 4) g.moveu = true;
    if (ponteiros.current.size >= 2) {
      const d = distancia();
      if (g.distanciaInicio > 0 && d > 0) {
        const [a, b] = [...ponteiros.current.values()];
        aplicarZoom(g.zoomInicio * (d / g.distanciaInicio), {
          x: (a.x + b.x) / 2,
          y: (a.y + b.y) / 2,
        });
      }
      return;
    }
    if (zoomRef.current > 1) {
      const z = zoomRef.current;
      definirZoom(
        z,
        limitar({ x: g.deslocInicio.x + dx, y: g.deslocInicio.y + dy }, z),
      );
    } else if (total > 1 && Math.abs(dx) > Math.abs(dy)) {
      setArrasto(dx);
    }
  };

  const aoSoltar = (e: React.PointerEvent<HTMLDivElement>) => {
    // Ponteiro que não começou gesto (apertou a seta ou o link): nada a fazer.
    if (!ponteiros.current.delete(e.pointerId)) return;
    const g = gesto.current;
    if (ponteiros.current.size > 0) {
      // Saiu um dos dois dedos: o que ficou recomeça o arrasto dali.
      const [resto] = [...ponteiros.current.values()];
      if (g && resto) {
        gesto.current = {
          ...g,
          inicio: resto,
          deslocInicio: deslocRef.current,
          zoomInicio: zoomRef.current,
          distanciaInicio: 0,
        };
      }
      return;
    }
    gesto.current = null;
    setArrasto(0);
    if (!g || g.ignorar) return;
    const dx = e.clientX - g.inicio.x;
    const dy = e.clientY - g.inicio.y;
    if (
      zoomRef.current === 1 &&
      Math.abs(dx) > DESLIZE_PX &&
      Math.abs(dx) > Math.abs(dy)
    ) {
      ir(dx < 0 ? 1 : -1);
      return;
    }
    // Toque duplo no dedo (o duplo clique do mouse tem o próprio evento).
    if (e.pointerType === "touch" && !g.moveu) {
      const agora = e.timeStamp;
      const p = { x: e.clientX, y: e.clientY };
      const ultimo = ultimoToque.current;
      if (ultimo && agora - ultimo.t < 300 && Math.hypot(p.x - ultimo.p.x, p.y - ultimo.p.y) < 30) {
        ultimoToque.current = null;
        aplicarZoom(zoomRef.current > 1 ? 1 : ZOOM_DUPLO, p);
      } else {
        ultimoToque.current = { t: agora, p };
      }
    }
  };

  const aoTeclar = (e: React.KeyboardEvent<HTMLDivElement>) => {
    if (e.key === "Escape") {
      e.preventDefault();
      e.stopPropagation();
      aoFecharRef.current();
      return;
    }
    if (e.key === "ArrowRight" || e.key === "ArrowLeft") {
      // Seta num botão ou no link também troca: não há campo aqui dentro.
      e.preventDefault();
      e.stopPropagation();
      ir(e.key === "ArrowRight" ? 1 : -1);
      return;
    }
    if (e.key === "+" || e.key === "=") {
      e.preventDefault();
      aplicarZoom(zoomRef.current * 1.5);
      return;
    }
    if (e.key === "-") {
      e.preventDefault();
      aplicarZoom(zoomRef.current / 1.5);
      return;
    }
    if (e.key === "0") {
      e.preventDefault();
      aplicarZoom(1);
      return;
    }
    if (e.key !== "Tab") return;
    // O foco não sai do visualizador.
    const raiz = raizRef.current;
    if (!raiz) return;
    const focaveis = Array.from(
      raiz.querySelectorAll<HTMLElement>("a[href], button:not([disabled])"),
    );
    if (focaveis.length === 0) return;
    const primeiro = focaveis[0];
    const ultimo = focaveis[focaveis.length - 1];
    const ativo = document.activeElement;
    if (e.shiftKey && (ativo === primeiro || ativo === raiz)) {
      e.preventDefault();
      ultimo.focus();
    } else if (!e.shiftKey && ativo === ultimo) {
      e.preventDefault();
      primeiro.focus();
    }
  };

  if (!item || typeof document === "undefined") return null;

  const posicao = `${(indice + 1).toLocaleString("pt-BR")} de ${total.toLocaleString("pt-BR")}`;
  const nomeArquivo = item.nome?.trim() || `imagem-${indice + 1}`;

  return createPortal(
    <div
      ref={raizRef}
      role="dialog"
      aria-modal="true"
      aria-label={total > 1 ? `Imagem ${posicao}` : "Imagem"}
      tabIndex={-1}
      onKeyDown={aoTeclar}
      className="fixed inset-0 z-[60] flex animate-entrada flex-col bg-black text-white outline-none"
    >
      <div className="flex shrink-0 items-center gap-1 px-1 pt-[max(8px,env(safe-area-inset-top))] pb-1">
        <button
          type="button"
          onClick={() => aoFecharRef.current()}
          aria-label="Fechar"
          title="Fechar (Esc)"
          className={BOTAO_ESCURO}
        >
          <X size={22} strokeWidth={1.75} aria-hidden />
        </button>
        <div className="min-w-0 flex-1">
          <p className="tipo-destaque truncate">{item.autor}</p>
          <p className="tipo-nota truncate text-white/70 tabular-nums">
            {total > 1 ? `${posicao} · ` : ""}
            {quando(item.em)}
          </p>
        </div>
        <button
          type="button"
          onClick={() => aplicarZoom(zoom > 1 ? 1 : ZOOM_DUPLO)}
          aria-label={zoom > 1 ? "Afastar" : "Aproximar"}
          title={zoom > 1 ? "Afastar (0)" : "Aproximar (+)"}
          className={BOTAO_ESCURO}
        >
          {zoom > 1 ? (
            <ZoomOut size={22} strokeWidth={1.75} aria-hidden />
          ) : (
            <ZoomIn size={22} strokeWidth={1.75} aria-hidden />
          )}
        </button>
        <a
          href={urlParaBaixar(item.url, nomeArquivo)}
          download={nomeArquivo}
          target="_blank"
          rel="noreferrer"
          aria-label="Baixar a imagem"
          title="Baixar"
          className={BOTAO_ESCURO}
        >
          <Download size={22} strokeWidth={1.75} aria-hidden />
        </a>
      </div>

      <div
        ref={palcoRef}
        onPointerDown={aoApertar}
        onPointerMove={aoMover}
        onPointerUp={aoSoltar}
        onPointerCancel={aoSoltar}
        onDoubleClick={(e) => {
          // Dois cliques na seta trocam duas vezes, não dão zoom.
          if (ehControle(e.target)) return;
          aplicarZoom(zoom > 1 ? 1 : ZOOM_DUPLO, { x: e.clientX, y: e.clientY });
        }}
        className={cn(
          "relative min-h-0 flex-1 touch-none overflow-hidden select-none",
          zoom > 1 ? "cursor-grab active:cursor-grabbing" : "cursor-zoom-in",
        )}
      >
        {!carregada && !falhou ? (
          <span className="absolute inset-0 flex items-center justify-center">
            <Spinner tamanho={24} rotulo="Carregando a imagem" />
          </span>
        ) : null}
        {falhou ? (
          <p className="tipo-corpo absolute inset-x-2 top-1/2 -translate-y-1/2 text-center">
            A imagem não carregou.{" "}
            <a
              href={item.url}
              target="_blank"
              rel="noreferrer"
              className="font-semibold underline underline-offset-2 focus-visible:outline-2 focus-visible:outline-white"
            >
              Abrir em outra aba
            </a>
          </p>
        ) : null}
        {/* eslint-disable-next-line @next/next/no-img-element -- mídia do Storage, sem otimização do Next */}
        <img
          key={item.url}
          ref={imagemRef}
          src={item.url}
          alt={item.legenda ?? item.nome ?? `Imagem ${posicao}`}
          draggable={false}
          onLoad={() => setCarregada(true)}
          onError={() => setFalhou(true)}
          style={{
            transform: `translate(${desloc.x + arrasto}px, ${desloc.y}px) scale(${zoom})`,
          }}
          className={cn(
            "absolute inset-0 m-auto block max-h-full max-w-full object-contain will-change-transform",
            // Sem carregar, a imagem (ou a caixa do texto alternativo, que
            // ocupa o palco quando ela falha) não pode cobrir o aviso e o link.
            !carregada && "pointer-events-none opacity-0",
            // Solto, o deslize volta para o lugar; com o dedo, segue sem atraso.
            arrasto === 0 && "motion-safe:transition-transform motion-safe:duration-[180ms]",
          )}
        />

        {total > 1 ? (
          <>
            <button
              type="button"
              onClick={() => ir(-1)}
              disabled={indice === 0}
              aria-label="Imagem anterior"
              title="Anterior (←)"
              className={cn(BOTAO_ESCURO, "absolute top-1/2 left-1 -translate-y-1/2 bg-black/40")}
            >
              <ChevronLeft size={26} strokeWidth={1.75} aria-hidden />
            </button>
            <button
              type="button"
              onClick={() => ir(1)}
              disabled={indice === total - 1}
              aria-label="Próxima imagem"
              title="Próxima (→)"
              className={cn(BOTAO_ESCURO, "absolute top-1/2 right-1 -translate-y-1/2 bg-black/40")}
            >
              <ChevronRight size={26} strokeWidth={1.75} aria-hidden />
            </button>
          </>
        ) : null}
      </div>

      {item.legenda ? (
        <p className="tipo-corpo max-h-[30vh] shrink-0 overflow-y-auto px-2 pt-1 pb-[max(16px,env(safe-area-inset-bottom))] text-center break-words whitespace-pre-wrap">
          {item.legenda}
        </p>
      ) : (
        <div aria-hidden className="h-[max(16px,env(safe-area-inset-bottom))] shrink-0" />
      )}
    </div>,
    document.body,
  );
}
