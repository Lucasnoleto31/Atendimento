"use client";

import {
  useEffect,
  useId,
  useLayoutEffect,
  useRef,
  useState,
  useSyncExternalStore,
  type RefObject,
} from "react";
import { createPortal } from "react-dom";
import { Check, X } from "lucide-react";
import { cn } from "@/lib/utils";
import { BOTAO_ICONE } from "@/components/app/form-styles";

/*
 * As peças que flutuam no chat: a folha presa no pé (celular), a gaveta da
 * direita (tablet e desktop estreito) e o menu suspenso do desktop. Todas
 * seguem o design system: folha com pegador, X de 44px, arrasto para fechar,
 * foco na folha (nunca num campo: abriria o teclado), Esc fecha e devolve o
 * foco; menu com fio, sombra de quem flutua e setas entre os itens.
 */

/* ── Tamanho da tela ──────────────────────────────────────────────────── */

function assinarConsulta(consulta: string) {
  return (avisar: () => void) => {
    const mq = window.matchMedia(consulta);
    mq.addEventListener("change", avisar);
    return () => mq.removeEventListener("change", avisar);
  };
}

const CONSULTA_MD = "(min-width: 48rem)";
const CONSULTA_XL = "(min-width: 80rem)";
const CONSULTA_TOQUE = "(pointer: coarse)";
const assinarMd = assinarConsulta(CONSULTA_MD);
const assinarXl = assinarConsulta(CONSULTA_XL);
const assinarToque = assinarConsulta(CONSULTA_TOQUE);

/** De 768px para cima a fila fica ao lado da conversa. No servidor, falso. */
export function useTelaMd(): boolean {
  return useSyncExternalStore(
    assinarMd,
    () => window.matchMedia(CONSULTA_MD).matches,
    () => false,
  );
}

/** De 1280px para cima cabe a coluna dos dados do contato. */
export function useTelaXl(): boolean {
  return useSyncExternalStore(
    assinarXl,
    () => window.matchMedia(CONSULTA_XL).matches,
    () => false,
  );
}

/** Tela de toque: Enter quebra linha, nada recebe foco sozinho. Por evento,
 *  não lida uma vez só (aparelho híbrido troca no meio do uso). */
export function useToque(): boolean {
  return useSyncExternalStore(
    assinarToque,
    () => window.matchMedia(CONSULTA_TOQUE).matches,
    () => false,
  );
}

/* ── Folha ────────────────────────────────────────────────────────────── */

/** Quanto o arrasto precisa descer para fechar, e a velocidade que basta
 *  (kit, bloco 6). Soltou e fecha em 0,24s; soltou e volta em 0,34s. */
const ARRASTO_FECHA_PX = 120;
const ARRASTO_VELOCIDADE = 0.5;
const ARRASTO_FECHA_MS = 240;
const ARRASTO_VOLTA_MS = 340;

/**
 * Folha do chat. `pe`: presa no pé em qualquer largura. `lado`: presa no pé
 * no celular e gaveta da direita a partir de 768px (os dados do contato).
 * `centro`: presa no pé no celular e janela centralizada a partir de 768px
 * (o envio de template, que tem formulário).
 * Fica acima do teclado (--teclado) e nunca passa da área visível.
 *
 * Monta só na primeira abertura e depois fica no DOM, inerte, para a saída
 * descer à vista. O papel de diálogo existe só enquanto aberta: o chat lê
 * [role="dialog"] para desligar J, E e H, e uma folha fechada não pode
 * calar o teclado.
 */
export function Folha({
  aberta,
  aoFechar,
  titulo,
  forma = "pe",
  retorno,
  acao,
  rodape,
  children,
}: {
  aberta: boolean;
  aoFechar: () => void;
  titulo: React.ReactNode;
  forma?: "pe" | "lado" | "centro";
  /** Para onde o foco volta ao fechar. Sem ele, para quem tinha o foco. */
  retorno?: RefObject<HTMLElement | null>;
  /** Controle à direita do título, antes do X. */
  acao?: React.ReactNode;
  /** Faixa fixa no pé (botão de confirmar), fora da rolagem. */
  rodape?: React.ReactNode;
  children: React.ReactNode;
}) {
  const idTitulo = useId();
  const painel = useRef<HTMLDivElement>(null);
  const aoFecharRef = useRef(aoFechar);
  useEffect(() => {
    aoFecharRef.current = aoFechar;
  });

  // Monta na primeira abertura (ajuste durante o render) e entra no quadro
  // seguinte, para a transição ter de onde partir.
  const [jaAbriu, setJaAbriu] = useState(aberta);
  if (aberta && !jaAbriu) setJaAbriu(true);
  const [entrou, setEntrou] = useState(false);
  useEffect(() => {
    if (!jaAbriu || entrou) return;
    const quadro = requestAnimationFrame(() => setEntrou(true));
    // Aba escondida não roda quadro: o tempo garante a entrada.
    const reserva = window.setTimeout(() => setEntrou(true), 60);
    return () => {
      cancelAnimationFrame(quadro);
      window.clearTimeout(reserva);
    };
  }, [jaAbriu, entrou]);
  const visivel = aberta && entrou;

  // Aberta: o foco vai para a folha. Fechada: o foco que estava dentro dela
  // (ou caiu no body) volta para quem abriu; solto no body, a próxima letra
  // viraria atalho do chat (E resolve a conversa).
  useEffect(() => {
    if (!aberta) return;
    const el = painel.current;
    const antes = document.activeElement as HTMLElement | null;
    // Quem abriu é lido agora: no fechamento, o gatilho é o mesmo elemento.
    const gatilho = retorno?.current ?? null;
    el?.focus({ preventScroll: true });
    return () => {
      const ativo = document.activeElement;
      if (ativo && ativo !== document.body && !el?.contains(ativo)) return;
      const alvo =
        gatilho && gatilho.isConnected
          ? gatilho
          : antes && antes.isConnected
            ? antes
            : null;
      if (alvo && !alvo.closest("[inert]")) alvo.focus({ preventScroll: true });
    };
  }, [aberta, retorno]);

  // Arrasto para fechar, só no dedo e só pela faixa do pegador.
  const gesto = useRef<{
    id: number;
    inicio: number;
    arrastando: boolean;
    amostras: { y: number; t: number }[];
  } | null>(null);

  const mover = (y: number) => {
    const el = painel.current;
    if (!el) return;
    el.style.transition = "none";
    el.style.setProperty("--arrasto", `${y}px`);
  };

  const soltar = (e: React.PointerEvent<HTMLElement>) => {
    const g = gesto.current;
    gesto.current = null;
    if (!g?.arrastando) return;
    const el = painel.current;
    if (!el) return;
    const distancia = e.clientY - g.inicio;
    const a = g.amostras[0];
    const b = g.amostras[g.amostras.length - 1];
    const velocidade = (b.y - a.y) / Math.max(1, b.t - a.t);
    const fecha =
      distancia > ARRASTO_FECHA_PX ||
      (distancia > 24 && velocidade > ARRASTO_VELOCIDADE);
    el.style.transition = "";
    el.style.transitionDuration = `${fecha ? ARRASTO_FECHA_MS : ARRASTO_VOLTA_MS}ms`;
    if (fecha) {
      aoFecharRef.current();
      window.setTimeout(() => {
        el.style.transition = "none";
        el.style.setProperty("--arrasto", "0px");
        el.style.transitionDuration = "";
        requestAnimationFrame(() => {
          el.style.transition = "";
        });
      }, ARRASTO_FECHA_MS);
    } else {
      el.style.setProperty("--arrasto", "0px");
      window.setTimeout(() => {
        el.style.transitionDuration = "";
      }, ARRASTO_VOLTA_MS);
    }
  };

  const arrasto = {
    onPointerDown: (e: React.PointerEvent<HTMLElement>) => {
      if (e.pointerType !== "touch") return;
      gesto.current = {
        id: e.pointerId,
        inicio: e.clientY,
        arrastando: false,
        amostras: [{ y: e.clientY, t: e.timeStamp }],
      };
    },
    onPointerMove: (e: React.PointerEvent<HTMLElement>) => {
      const g = gesto.current;
      if (!g || g.id !== e.pointerId) return;
      const d = e.clientY - g.inicio;
      if (!g.arrastando) {
        if (Math.abs(d) < 6) return;
        g.arrastando = true;
        try {
          e.currentTarget.setPointerCapture(e.pointerId);
        } catch {
          // sem captura: o gesto vale enquanto o dedo estiver no pegador
        }
      }
      g.amostras.push({ y: e.clientY, t: e.timeStamp });
      if (g.amostras.length > 5) g.amostras.shift();
      // Para cima resiste: um quinto do arrasto.
      mover(d > 0 ? d : d / 5);
    },
    onPointerUp: soltar,
    onPointerCancel: () => {
      gesto.current = null;
      mover(0);
      const el = painel.current;
      if (el) el.style.transition = "";
    },
  };

  const aoTeclar = (e: React.KeyboardEvent<HTMLDivElement>) => {
    if (e.key === "Escape") {
      e.preventDefault();
      e.stopPropagation();
      aoFecharRef.current();
      return;
    }
    if (e.key !== "Tab") return;
    const el = painel.current;
    if (!el) return;
    const focaveis = Array.from(
      el.querySelectorAll<HTMLElement>(
        'a[href], button:not([disabled]), input:not([disabled]):not([type="hidden"]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])',
      ),
    );
    if (focaveis.length === 0) return;
    const primeiro = focaveis[0];
    const ultimo = focaveis[focaveis.length - 1];
    const ativo = document.activeElement;
    if (e.shiftKey && (ativo === primeiro || ativo === el)) {
      e.preventDefault();
      ultimo.focus();
    } else if (!e.shiftKey && ativo === ultimo) {
      e.preventDefault();
      primeiro.focus();
    }
  };

  if (!jaAbriu || typeof document === "undefined") return null;

  const lado = forma === "lado";
  const centro = forma === "centro";

  return createPortal(
    <div
      inert={!aberta}
      className={cn(
        "fixed inset-0 z-50",
        aberta ? "visible" : "invisible transition-[visibility] duration-[280ms]",
      )}
    >
      {/* Fundo: toque fora fecha; arrastar nele não rola nada atrás. */}
      <div
        aria-hidden
        onClick={() => aoFecharRef.current()}
        className={cn(
          "absolute inset-0 touch-none bg-overlay transition-opacity duration-[180ms]",
          visivel ? "opacity-100" : "opacity-0",
        )}
      />
      <div
        ref={painel}
        role={aberta ? "dialog" : undefined}
        aria-modal={aberta ? true : undefined}
        aria-labelledby={aberta ? idTitulo : undefined}
        tabIndex={-1}
        onKeyDown={aoTeclar}
        // O arrasto mexe no transform (--arrasto); entrada e saída, no
        // translate do Tailwind. São propriedades separadas e se somam.
        style={{ transform: "translateY(var(--arrasto, 0px))" }}
        className={cn(
          "absolute inset-x-0 bottom-[var(--teclado,0px)] mx-auto flex max-h-[calc(var(--vv-altura,100dvh)-24px)] w-full max-w-[640px] flex-col rounded-t-folha bg-flutuante shadow-flutuante outline-none",
          "transition-[translate,transform] duration-[280ms] ease-padrao",
          visivel ? "translate-y-0" : "translate-y-full",
          lado &&
            "md:top-0 md:right-0 md:bottom-0 md:left-auto md:mx-0 md:h-full md:max-h-none md:w-[400px] md:max-w-[calc(100vw-48px)] md:rounded-none md:rounded-l-folha md:translate-y-0",
          lado && (visivel ? "md:translate-x-0" : "md:translate-x-full"),
          centro &&
            "md:top-1/2 md:bottom-auto md:left-1/2 md:mx-0 md:w-[min(560px,calc(100vw-24px))] md:-translate-x-1/2 md:-translate-y-1/2 md:rounded-folha md:transition-opacity md:duration-[180ms]",
          centro && (visivel ? "md:opacity-100" : "md:opacity-0"),
        )}
      >
        <div
          {...arrasto}
          className={cn(
            "flex shrink-0 touch-none flex-col items-center pt-1 select-none",
            (lado || centro) && "md:touch-auto md:pt-1.5",
          )}
        >
          <span
            aria-hidden
            className={cn(
              "h-[5px] w-[36px] rounded-full bg-fio-forte",
              (lado || centro) && "md:hidden",
            )}
          />
          <div className="flex w-full items-center gap-1 pt-0.5 pr-1 pl-2">
            <h2
              id={idTitulo}
              className="tipo-titulo-3 min-w-0 flex-1 truncate text-tinta"
            >
              {titulo}
            </h2>
            {acao}
            <button
              type="button"
              onClick={() => aoFecharRef.current()}
              aria-label="Fechar"
              title="Fechar (Esc)"
              className={BOTAO_ICONE}
            >
              <X size={22} strokeWidth={1.75} aria-hidden />
            </button>
          </div>
        </div>

        <div className="min-h-0 flex-1 overflow-x-hidden overflow-y-auto overscroll-contain px-2 pb-2">
          {children}
        </div>

        {rodape ? (
          <div className="shrink-0 border-t border-fio px-2 pt-1.5 pb-[max(16px,env(safe-area-inset-bottom))]">
            {rodape}
          </div>
        ) : (
          <div aria-hidden className="h-[env(safe-area-inset-bottom)] shrink-0" />
        )}
      </div>
    </div>,
    document.body,
  );
}

/* ── Grupos de linhas (iOS) ───────────────────────────────────────────── */

/** O rótulo do grupo, fora do cartão, alinhado ao texto de dentro. */
export function RotuloGrupo({
  children,
  acao,
  id,
}: {
  children: React.ReactNode;
  acao?: React.ReactNode;
  id?: string;
}) {
  return (
    <div className="flex min-h-[32px] items-end gap-1 px-1.5 pt-2 pb-0.5">
      <p id={id} className="tipo-nota min-w-0 flex-1 truncate text-texto-2">
        {children}
      </p>
      {acao}
    </div>
  );
}

/** O cartão do grupo: chapado, sem sombra, linhas com separador encaixado. */
export function Grupo({
  children,
  className,
  ...props
}: React.ComponentProps<"div">) {
  return (
    <div
      className={cn("overflow-hidden rounded-painel bg-cartao", className)}
      {...props}
    >
      {children}
    </div>
  );
}

/* ── Menu suspenso do desktop ─────────────────────────────────────────── */

const SELETOR_ITENS = '[data-item]:not([disabled]):not([aria-disabled="true"])';

/** Folga entre o menu e a borda que o corta. */
const FOLGA_BORDA_PX = 8;

/**
 * Até onde o menu pode ir na horizontal: a tela, recortada por todo
 * ancestral que não deixa o conteúdo vazar (o main do app corta).
 */
function limitesDeRecorte(el: HTMLElement): { esquerda: number; direita: number } {
  let esquerda = 0;
  let direita = document.documentElement.clientWidth;
  for (let p = el.parentElement; p && p !== document.body; p = p.parentElement) {
    if (getComputedStyle(p).overflowX === "visible") continue;
    const r = p.getBoundingClientRect();
    esquerda = Math.max(esquerda, r.left);
    direita = Math.min(direita, r.right);
  }
  return {
    esquerda: esquerda + FOLGA_BORDA_PX,
    direita: direita - FOLGA_BORDA_PX,
  };
}

/**
 * O menu que nasce de um botão (Adiar ▾, ⋯, Filtros, as ações em massa). Fica
 * dentro de um invólucro `relative` junto do gatilho. Abre com o foco no
 * primeiro item; setas andam, Esc fecha e devolve o foco ao gatilho; clique
 * fora, Tab para fora e ⌘K (a paleta) fecham. data-popover diz ao chat que a
 * tecla é do menu, não um atalho de conversa.
 */
export function MenuSuspenso({
  aberto,
  aoFechar,
  gatilho,
  rotulo,
  alinhar = "fim",
  direcao = "baixo",
  papel = "menu",
  className,
  children,
}: {
  aberto: boolean;
  aoFechar: () => void;
  gatilho: RefObject<HTMLElement | null>;
  rotulo: string;
  alinhar?: "inicio" | "fim";
  direcao?: "baixo" | "cima";
  /** "menu" só com itens; "dialog" quando há campo, chip ou link dentro. */
  papel?: "menu" | "dialog";
  className?: string;
  children: React.ReactNode;
}) {
  const painel = useRef<HTMLDivElement>(null);
  const aoFecharRef = useRef(aoFechar);
  useEffect(() => {
    aoFecharRef.current = aoFechar;
  });

  // Alinhado só pelo lado pedido, o menu passava da borda no celular e no
  // tablet, e o main cortava o que vazava. Ao abrir, antes de pintar: se
  // não cabe pelo lado pedido, alinha pelo outro lado do gatilho; sem lugar
  // em nenhum dos dois, encosta na borda que corta.
  useLayoutEffect(() => {
    if (!aberto) return;
    const el = painel.current;
    const base = el?.offsetParent;
    if (!el || !(base instanceof HTMLElement)) return;
    el.style.left = "";
    el.style.right = "";
    const ancora = base.getBoundingClientRect();
    // offsetWidth: a largura sem a escala da animação de entrada.
    const largura = el.offsetWidth;
    const { esquerda, direita } = limitesDeRecorte(el);
    const noInicio = ancora.left;
    const noFim = ancora.right - largura;
    const [pedido, outro] =
      alinhar === "inicio" ? [noInicio, noFim] : [noFim, noInicio];
    const cabe = (x: number) => x >= esquerda && x + largura <= direita;
    const x = cabe(pedido)
      ? pedido
      : cabe(outro)
        ? outro
        : Math.min(Math.max(pedido, esquerda), direita - largura);
    if (x === pedido) return;
    el.style.right = "auto";
    el.style.left = `${x - ancora.left - base.clientLeft}px`;
  }, [aberto, alinhar]);

  useEffect(() => {
    if (!aberto) return;
    const el = painel.current;
    const primeiro = el?.querySelector<HTMLElement>(SELETOR_ITENS);
    (primeiro ?? el)?.focus({ preventScroll: true });
    const aoApertar = (e: PointerEvent) => {
      const alvo = e.target as Node;
      if (el?.contains(alvo) || gatilho.current?.contains(alvo)) return;
      aoFecharRef.current();
    };
    const aoTeclar = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === "k") {
        aoFecharRef.current();
      }
    };
    document.addEventListener("pointerdown", aoApertar, true);
    document.addEventListener("keydown", aoTeclar, true);
    const botao = gatilho.current;
    return () => {
      document.removeEventListener("pointerdown", aoApertar, true);
      document.removeEventListener("keydown", aoTeclar, true);
      // Fechou com o foco dentro (um item que sumiu junto) ou solto no
      // body: ele volta ao gatilho. Solto, a próxima letra viraria atalho
      // do chat (E resolve a conversa).
      const ativo = document.activeElement;
      if (!ativo || ativo === document.body || el?.contains(ativo)) {
        botao?.focus({ preventScroll: true });
      }
    };
  }, [aberto, gatilho]);

  if (!aberto) return null;

  const fecharDevolvendo = () => {
    aoFecharRef.current();
    gatilho.current?.focus({ preventScroll: true });
  };

  return (
    <div
      ref={painel}
      role={papel}
      aria-label={rotulo}
      data-popover="menu"
      tabIndex={-1}
      onKeyDown={(e) => {
        if (e.key === "Escape") {
          e.preventDefault();
          e.stopPropagation();
          fecharDevolvendo();
          return;
        }
        if (
          e.key !== "ArrowDown" &&
          e.key !== "ArrowUp" &&
          e.key !== "Home" &&
          e.key !== "End"
        ) {
          return;
        }
        const itens = Array.from(
          painel.current?.querySelectorAll<HTMLElement>(SELETOR_ITENS) ?? [],
        );
        if (itens.length === 0) return;
        e.preventDefault();
        const i = itens.indexOf(document.activeElement as HTMLElement);
        // Foco no próprio painel (i = -1): seta para baixo vai ao primeiro
        // item e seta para cima ao último.
        const alvo =
          e.key === "Home" || (i === -1 && e.key === "ArrowDown")
            ? itens[0]
            : e.key === "End" || (i === -1 && e.key === "ArrowUp")
              ? itens[itens.length - 1]
              : itens[
                  (i + (e.key === "ArrowDown" ? 1 : -1) + itens.length) %
                    itens.length
                ];
        alvo?.focus();
      }}
      onBlur={(e) => {
        const para = e.relatedTarget as Node | null;
        if (!para) return;
        if (painel.current?.contains(para) || gatilho.current?.contains(para)) {
          return;
        }
        aoFecharRef.current();
      }}
      className={cn(
        "absolute z-40 flex max-h-[min(440px,calc(var(--vv-altura,100dvh)-160px))] w-[280px] max-w-[calc(100vw-32px)] animate-entrada flex-col overflow-y-auto overscroll-contain rounded-painel border border-fio bg-flutuante p-0.5 shadow-lg outline-none",
        direcao === "baixo"
          ? "top-[calc(100%+6px)]"
          : "bottom-[calc(100%+6px)]",
        alinhar === "fim" ? "right-0" : "left-0",
        className,
      )}
    >
      {children}
    </div>
  );
}

/**
 * Um item de menu ou de folha. No menu, 40px com raio de controle; na folha,
 * 48px dentro do Grupo, com o separador encaixado que começa no texto.
 */
export function ItemAcao({
  variante,
  icone,
  children,
  detalhe,
  marcado,
  papel = "menuitem",
  perigo = false,
  className,
  ...props
}: {
  variante: "menu" | "folha";
  icone?: React.ReactNode;
  children: React.ReactNode;
  /** Texto à direita: a tecla, a carga, a data. */
  detalhe?: React.ReactNode;
  /** Marca de escolhido (rádio): mostra o ✓ e anuncia aria-checked. */
  marcado?: boolean;
  papel?: "menuitem" | "menuitemradio" | "menuitemcheckbox" | "button";
  perigo?: boolean;
  className?: string;
} & Omit<React.ComponentProps<"button">, "className" | "children">) {
  const menu = variante === "menu";
  return (
    <button
      type="button"
      data-item=""
      // No menu, os papéis de menu; na folha (diálogo), botão comum, com o
      // escolhido anunciado como pressionado.
      role={menu && papel !== "button" ? papel : undefined}
      aria-checked={
        menu && (papel === "menuitemradio" || papel === "menuitemcheckbox")
          ? marcado
          : undefined
      }
      aria-pressed={
        !menu && (papel === "menuitemradio" || papel === "menuitemcheckbox")
          ? marcado
          : undefined
      }
      className={cn(
        "group/item flex w-full items-center text-left text-tinta transition-colors duration-[120ms] outline-none focus-visible:outline-2 focus-visible:-outline-offset-2 focus-visible:outline-tinta disabled:cursor-not-allowed disabled:text-texto-3",
        menu
          ? "min-h-[40px] gap-1 rounded-controle px-1 hover:bg-realce focus:bg-realce active:bg-pressionado pointer-coarse:min-h-[44px]"
          : "min-h-[48px] gap-1.5 pl-1.5 hover:bg-realce active:bg-pressionado",
        perigo && "text-erro",
        className,
      )}
      {...props}
    >
      {icone ? (
        <span
          aria-hidden
          className="flex w-[20px] shrink-0 justify-center text-texto-2 group-disabled/item:text-texto-3"
        >
          {icone}
        </span>
      ) : null}
      <span
        className={cn(
          "flex min-w-0 flex-1 items-center gap-1 self-stretch",
          menu
            ? "py-0.5"
            : "border-t border-fio py-1 pr-1.5 group-first/linha:border-t-0",
        )}
      >
        <span
          className={cn(
            "min-w-0 flex-1",
            "tipo-corpo",
            marcado && "font-semibold",
          )}
        >
          {children}
        </span>
        {detalhe !== undefined && detalhe !== null ? (
          <span className="tipo-nota shrink-0 text-texto-2 tabular-nums">
            {detalhe}
          </span>
        ) : null}
        {marcado !== undefined ? (
          <span
            aria-hidden
            className={cn(
              "flex w-[20px] shrink-0 justify-center text-tinta",
              !marcado && "invisible",
            )}
          >
            <Check size={18} strokeWidth={2.25} />
          </span>
        ) : null}
      </span>
    </button>
  );
}

/** A linha da folha precisa do grupo para o separador sumir na primeira. */
export function LinhaGrupo({ children }: { children: React.ReactNode }) {
  return <div className="group/linha">{children}</div>;
}

/* ── Seções que valem no menu e na folha ──────────────────────────────── */

/** Título de seção: pequeno dentro do menu, rótulo de grupo na folha. */
export function TituloSecao({
  menu,
  children,
}: {
  menu: boolean;
  children: React.ReactNode;
}) {
  return menu ? (
    <p className="tipo-nota px-1 pt-1 pb-0.5 text-texto-2">{children}</p>
  ) : (
    <RotuloGrupo>{children}</RotuloGrupo>
  );
}

/** No menu os itens vêm soltos; na folha, dentro do cartão do grupo. */
export function ItensSecao({
  menu,
  children,
}: {
  menu: boolean;
  children: React.ReactNode;
}) {
  return menu ? <>{children}</> : <Grupo>{children}</Grupo>;
}

/** Cada item na folha precisa do invólucro do separador encaixado. */
export function ItemSecao({
  menu,
  children,
}: {
  menu: boolean;
  children: React.ReactNode;
}) {
  return menu ? <>{children}</> : <LinhaGrupo>{children}</LinhaGrupo>;
}
