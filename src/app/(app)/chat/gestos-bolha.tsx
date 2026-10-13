"use client";

import { memo, useEffect, useRef, useState, type RefObject } from "react";
import { ChevronDown, Reply } from "lucide-react";
import type { Mensagem } from "./mensagem";
import type { AlvoMensagem, Retangulo } from "./menu-mensagem";

/*
 * Os gestos que abrem as ações da mensagem, sem mexer na bolha (bolha.tsx):
 * tudo por delegação no histórico, achando a linha pelo data-msg.
 *
 * - Mouse: ao passar, a seta de ações aparece ao lado da bolha; o botão
 *   direito abre o menu no ponteiro (com texto selecionado, link ou mídia
 *   sob o ponteiro, fica o menu do navegador).
 * - Toque: o toque longo abre a folha; arrastar a bolha para a direita
 *   responde. Rolar a conversa cancela os dois (a linha só aceita o arrasto
 *   na horizontal: touch-action pan-y pinch-zoom, posto pela Janela). O
 *   toque que começa num controle (a barra do áudio, o vídeo, um campo) é
 *   dele: não vira arrasto nem toque longo.
 * - Teclado: com o foco no histórico, as setas andam entre as mensagens e
 *   Enter (ou a tecla de menu) abre as ações.
 * - Bolha apagada não tem ação: nem seta, nem menu.
 */

const TOQUE_LONGO_MS = 450;
/** Até onde o dedo pode tremer sem virar rolagem ou arrasto. */
const TOLERANCIA_PX = 10;
/** Quanto arrastar para responder, e o máximo que a bolha anda. */
const ARRASTO_RESPONDE_PX = 56;
const ARRASTO_MAX_PX = 80;
/** A borda esquerda é do gesto de voltar do sistema. */
const BORDA_SISTEMA_PX = 24;
/** A seta ao lado da bolha. */
const LARGURA_BOTOES = 32;
/** Onde o toque é do controle, não da bolha. O vídeo fica de fora: ele
 *  ocupa a bolha inteira, e segurar parado nele ainda abre as ações. */
const CONTROLES = "input, select, textarea, audio, [role=slider]";

type Foco = {
  ids: string[];
  topo: number;
  esquerda: number;
  nossa: boolean;
  origem: "mouse" | "teclado";
};

type Toque = {
  id: number;
  x0: number;
  y0: number;
  linha: HTMLElement;
  ms: Mensagem[];
  estado: "indeciso" | "arrastando" | "rolando" | "longo";
  timer: number;
  dx: number;
  vibrou: boolean;
  /** Começou num vídeo: mexer nos controles dele nunca vira resposta. */
  semArrasto: boolean;
};

/** A bolha dentro da linha: o primeiro bloco da coluna. */
function corpoDa(linha: HTMLElement): HTMLElement {
  return (linha.firstElementChild?.firstElementChild as HTMLElement | null) ?? linha;
}

function retangulo(r: DOMRect): Retangulo {
  return { top: r.top, bottom: r.bottom, left: r.left, right: r.right };
}

function vibrar(ms: number) {
  try {
    navigator.vibrate?.(ms);
  } catch {
    // sem vibração neste aparelho
  }
}

/** Memoizada: a Janela desenha de novo a cada tecla do compositor, e as
 *  props daqui são estáveis (refs, a lista e callbacks fixos). */
export const CamadaDaBolha = memo(function CamadaDaBolha({
  caixaRef,
  conteudoRef,
  mensagens,
  podeResponder,
  aoAbrir,
  aoResponder,
}: {
  /** O histórico que rola (onde os gestos são ouvidos). */
  caixaRef: RefObject<HTMLDivElement | null>;
  /** O conteúdo que rola dentro dele, `relative`: a camada se posiciona
   *  nele e anda junto com a bolha. */
  conteudoRef: RefObject<HTMLDivElement | null>;
  mensagens: Mensagem[];
  /** Há compositor e a pessoa escreve: o arrasto responde. */
  podeResponder: boolean;
  aoAbrir: (alvo: AlvoMensagem) => void;
  aoResponder: (m: Mensagem) => void;
}) {
  const [foco, setFoco] = useState<Foco | null>(null);
  const camadaRef = useRef<HTMLDivElement>(null);
  const iconeRef = useRef<HTMLSpanElement>(null);

  // Os ouvintes são do DOM e vivem enquanto a camada vive: leem o mais
  // novo por aqui.
  const porIdRef = useRef(new Map<string, Mensagem>());
  const aoAbrirRef = useRef(aoAbrir);
  const aoResponderRef = useRef(aoResponder);
  const podeResponderRef = useRef(podeResponder);
  useEffect(() => {
    porIdRef.current = new Map(mensagens.map((m) => [m.id, m]));
  }, [mensagens]);
  useEffect(() => {
    aoAbrirRef.current = aoAbrir;
    aoResponderRef.current = aoResponder;
    podeResponderRef.current = podeResponder;
  });

  /** As mensagens da linha, ou null quando ela não aceita ações (a bolha
   *  otimista ainda não tem id do banco). */
  const mensagensDa = (linha: HTMLElement): Mensagem[] | null => {
    const ids = (linha.dataset.msg ?? "").split(" ").filter(Boolean);
    const ms = ids
      .map((id) => porIdRef.current.get(id))
      .filter((m): m is Mensagem => Boolean(m));
    if (ms.length === 0 || ms.length !== ids.length) return null;
    return ms.some((m) => m.pendente) ? null : ms;
  };

  /** A apagada (pela equipe ou pelo contato) não responde, não copia e não
   *  apaga de novo: não abre nada. */
  const temAcoes = (ms: Mensagem[]) => ms.some((m) => !m.apagada);

  const abrir = (
    linha: HTMLElement,
    ms: Mensagem[],
    forma: AlvoMensagem["forma"],
    ancora: Retangulo,
  ) => {
    if (!temAcoes(ms)) return;
    // A linha recebe o foco de volta quando o menu fecha.
    linha.tabIndex = -1;
    aoAbrirRef.current({
      mensagens: ms,
      linha,
      caixa: caixaRef.current,
      ancora,
      forma,
    });
  };

  /** Onde a seta fica: ao lado da bolha, por fora, no meio dela (ou
   *  no alto, se for alta). */
  const posicionar = (
    linha: HTMLElement,
    ms: Mensagem[],
    origem: Foco["origem"],
  ): Foco | null => {
    const conteudo = conteudoRef.current;
    if (!conteudo) return null;
    const c = conteudo.getBoundingClientRect();
    const b = corpoDa(linha).getBoundingClientRect();
    const nossa = ms[0].tipo !== "mensagem_recebida";
    const topo =
      b.height < 56 ? b.top - c.top + b.height / 2 - 16 : b.top - c.top + 4;
    const esquerda = nossa
      ? b.left - c.left - LARGURA_BOTOES - 4
      : b.right - c.left + 4;
    return {
      ids: ms.map((m) => m.id),
      topo,
      esquerda: Math.min(Math.max(esquerda, 0), Math.max(c.width - LARGURA_BOTOES, 0)),
      nossa,
      origem,
    };
  };

  useEffect(() => {
    const caixa = caixaRef.current;
    if (!caixa) return;

    const linhaDe = (alvo: EventTarget | null): HTMLElement | null => {
      if (!(alvo instanceof Element)) return null;
      if (camadaRef.current?.contains(alvo)) return null;
      const linha = alvo.closest<HTMLElement>("div[data-msg]");
      return linha && caixa.contains(linha) ? linha : null;
    };

    let ultimoPonteiro = "mouse";
    let toque: Toque | null = null;
    // Depois do toque longo e do arrasto, o clique que o MESMO dedo solta
    // não vale (abriria a foto, ou fecharia a folha que acabou de abrir).
    // Qualquer toque novo zera a marca: o próximo gesto vale inteiro.
    let engolir = false;
    let fimDoToque = 0;

    /* ── mouse: a seta ao lado da bolha ── */

    const aoPassar = (e: PointerEvent) => {
      if (e.pointerType !== "mouse") return;
      if (camadaRef.current?.contains(e.target as Node)) return;
      const linha = linhaDe(e.target);
      const ms = linha ? mensagensDa(linha) : null;
      if (!linha || !ms || !temAcoes(ms)) {
        setFoco((f) => (f?.origem === "mouse" ? null : f));
        return;
      }
      const chave = ms.map((m) => m.id).join(" ");
      setFoco((f) =>
        f && f.ids.join(" ") === chave ? f : posicionar(linha, ms, "mouse"),
      );
    };
    const aoSairDaCaixa = (e: PointerEvent) => {
      if (e.pointerType !== "mouse") return;
      setFoco((f) => (f?.origem === "mouse" ? null : f));
    };
    const aoRolar = () => {
      setFoco((f) => (f?.origem === "mouse" ? null : f));
    };

    /* ── teclado ── */

    const aoFocar = (e: FocusEvent) => {
      const alvo = e.target as HTMLElement;
      if (!alvo.matches?.("div[data-msg]")) return;
      const ms = mensagensDa(alvo);
      setFoco(ms && temAcoes(ms) ? posicionar(alvo, ms, "teclado") : null);
    };
    const aoDesfocar = (e: FocusEvent) => {
      const para = e.relatedTarget as Node | null;
      if (para && camadaRef.current?.contains(para)) return;
      if (para instanceof Element && para.matches("div[data-msg]")) return;
      setFoco((f) => (f?.origem === "teclado" ? null : f));
    };
    const aoTeclar = (e: KeyboardEvent) => {
      if (e.metaKey || e.ctrlKey || e.altKey) return;
      const alvo = e.target as HTMLElement;
      const naLinha = alvo.matches?.("div[data-msg]") ? alvo : null;
      if (alvo !== caixa && !naLinha) return;
      if (
        e.key === "ArrowUp" ||
        e.key === "ArrowDown" ||
        e.key === "Home" ||
        e.key === "End"
      ) {
        const linhas = Array.from(
          caixa.querySelectorAll<HTMLElement>("div[data-msg]"),
        ).filter((l) => mensagensDa(l) !== null);
        if (linhas.length === 0) return;
        e.preventDefault();
        e.stopPropagation();
        let destino: HTMLElement | undefined;
        if (e.key === "Home") destino = linhas[0];
        else if (e.key === "End") destino = linhas[linhas.length - 1];
        else if (naLinha) {
          const i = linhas.indexOf(naLinha);
          destino =
            linhas[
              e.key === "ArrowUp"
                ? Math.max(i - 1, 0)
                : Math.min(i + 1, linhas.length - 1)
            ];
        } else {
          // Do histórico para a primeira (ou a última) mensagem à vista.
          const cr = caixa.getBoundingClientRect();
          const visiveis = linhas.filter((l) => {
            const r = l.getBoundingClientRect();
            return r.bottom > cr.top && r.top < cr.bottom;
          });
          destino =
            e.key === "ArrowUp"
              ? (visiveis[visiveis.length - 1] ?? linhas[linhas.length - 1])
              : (visiveis[0] ?? linhas[0]);
        }
        if (destino) {
          destino.tabIndex = -1;
          destino.focus({ preventScroll: true });
          destino.scrollIntoView({ block: "nearest" });
        }
        return;
      }
      if (naLinha && e.key === "Enter") {
        const ms = mensagensDa(naLinha);
        if (!ms) return;
        e.preventDefault();
        e.stopPropagation();
        abrir(naLinha, ms, "menu", retangulo(corpoDa(naLinha).getBoundingClientRect()));
      }
    };

    /* ── botão direito, tecla de menu e o toque longo do Android ── */

    const aoMenuDeContexto = (e: MouseEvent) => {
      const linha = linhaDe(e.target);
      if (!linha) return;
      const ms = mensagensDa(linha);
      if (!ms) return;
      // O toque longo do Android também dispara este evento: vale o nosso.
      if (toque || ultimoPonteiro === "touch") {
        e.preventDefault();
        if (toque && toque.estado === "indeciso") {
          window.clearTimeout(toque.timer);
          toque.estado = "longo";
          engolir = true;
          abrir(linha, ms, "folha", retangulo(corpoDa(linha).getBoundingClientRect()));
        }
        return;
      }
      // Pela tecla de menu (Shift+F10) não há ponteiro: abre na bolha.
      const doTeclado = e.clientX === 0 && e.clientY === 0;
      if (!doTeclado) {
        const el = e.target as Element;
        if (el.closest("a, img, video, audio, input, textarea")) return;
        const selecao = window.getSelection();
        if (
          selecao &&
          !selecao.isCollapsed &&
          selecao.anchorNode &&
          linha.contains(selecao.anchorNode)
        ) {
          return;
        }
      }
      if (!temAcoes(ms)) return;
      e.preventDefault();
      abrir(
        linha,
        ms,
        "menu",
        doTeclado
          ? retangulo(corpoDa(linha).getBoundingClientRect())
          : { top: e.clientY, bottom: e.clientY, left: e.clientX, right: e.clientX },
      );
    };

    /* ── toque: longo abre, arrasto responde ── */

    const icone = () => iconeRef.current;
    const colunaDa = (t: Toque) => t.linha.firstElementChild as HTMLElement | null;

    const comecarArrasto = (t: Toque) => {
      const coluna = colunaDa(t);
      if (coluna) coluna.style.transition = "none";
      const conteudo = conteudoRef.current;
      const i = icone();
      if (!conteudo || !i) return;
      const c = conteudo.getBoundingClientRect();
      const b = corpoDa(t.linha).getBoundingClientRect();
      i.style.transition = "none";
      i.style.top = `${b.top - c.top + b.height / 2 - 16}px`;
      i.style.left = `${Math.max(b.left - c.left - 40, 4)}px`;
      i.style.opacity = "0";
    };

    const moverArrasto = (t: Toque, dx: number) => {
      const anda =
        dx <= ARRASTO_RESPONDE_PX
          ? dx
          : Math.min(
              ARRASTO_RESPONDE_PX + (dx - ARRASTO_RESPONDE_PX) * 0.3,
              ARRASTO_MAX_PX,
            );
      const coluna = colunaDa(t);
      if (coluna) coluna.style.transform = `translateX(${Math.max(anda, 0)}px)`;
      const fracao = Math.min(Math.max(dx / ARRASTO_RESPONDE_PX, 0), 1);
      const i = icone();
      if (i) {
        i.style.opacity = String(fracao);
        i.style.transform = `scale(${0.6 + 0.4 * fracao})`;
      }
      const passou = dx >= ARRASTO_RESPONDE_PX;
      if (passou && !t.vibrou) vibrar(8);
      t.vibrou = passou;
    };

    const encerrarArrasto = (t: Toque) => {
      const coluna = colunaDa(t);
      const i = icone();
      if (coluna) {
        coluna.style.transition = "transform 200ms var(--ease-padrao)";
        coluna.style.transform = "translateX(0px)";
      }
      if (i) {
        i.style.transition = "opacity 120ms";
        i.style.opacity = "0";
      }
      window.setTimeout(() => {
        if (coluna) {
          coluna.style.transition = "";
          coluna.style.transform = "";
        }
        if (i) {
          i.style.transition = "";
          i.style.transform = "";
        }
      }, 220);
    };

    const aoApertar = (e: PointerEvent) => {
      ultimoPonteiro = e.pointerType;
      if (e.pointerType !== "touch" || toque) return;
      // Arrastar a barra do áudio ou mexer no vídeo não é gesto da bolha:
      // virava resposta (e o teclado subia) ou abria a folha.
      if ((e.target as Element | null)?.closest?.(CONTROLES)) return;
      const linha = linhaDe(e.target);
      if (!linha) return;
      const ms = mensagensDa(linha);
      if (!ms || !temAcoes(ms)) return;
      const novo: Toque = {
        id: e.pointerId,
        x0: e.clientX,
        y0: e.clientY,
        linha,
        ms,
        estado: "indeciso",
        timer: 0,
        dx: 0,
        vibrou: false,
        semArrasto: Boolean((e.target as Element | null)?.closest?.("video")),
      };
      novo.timer = window.setTimeout(() => {
        if (toque !== novo || novo.estado !== "indeciso") return;
        novo.estado = "longo";
        vibrar(10);
        engolir = true;
        abrir(linha, ms, "folha", retangulo(corpoDa(linha).getBoundingClientRect()));
      }, TOQUE_LONGO_MS);
      toque = novo;
    };

    const aoMover = (e: PointerEvent) => {
      const t = toque;
      if (!t || e.pointerId !== t.id) return;
      const dx = e.clientX - t.x0;
      const dy = e.clientY - t.y0;
      if (t.estado === "indeciso") {
        if (
          Math.abs(dy) > TOLERANCIA_PX ||
          dx < -TOLERANCIA_PX ||
          (t.semArrasto && Math.abs(dx) > TOLERANCIA_PX)
        ) {
          t.estado = "rolando";
          window.clearTimeout(t.timer);
          return;
        }
        if (dx <= TOLERANCIA_PX || dx < Math.abs(dy) * 1.5) return;
        window.clearTimeout(t.timer);
        if (
          !podeResponderRef.current ||
          t.x0 < BORDA_SISTEMA_PX ||
          t.ms[0].apagada
        ) {
          t.estado = "rolando";
          return;
        }
        t.estado = "arrastando";
        engolir = true;
        comecarArrasto(t);
      }
      if (t.estado !== "arrastando") return;
      t.dx = dx;
      moverArrasto(t, dx);
    };

    const aoSoltar = (e: PointerEvent) => {
      const t = toque;
      if (!t || e.pointerId !== t.id) return;
      toque = null;
      fimDoToque = Date.now();
      window.clearTimeout(t.timer);
      if (t.estado !== "arrastando") return;
      encerrarArrasto(t);
      if (t.dx >= ARRASTO_RESPONDE_PX) aoResponderRef.current(t.ms[0]);
    };

    const aoCancelar = (e: PointerEvent) => {
      const t = toque;
      if (!t || e.pointerId !== t.id) return;
      toque = null;
      fimDoToque = Date.now();
      window.clearTimeout(t.timer);
      if (t.estado === "arrastando") encerrarArrasto(t);
    };

    // O dedo que abriu a folha ou arrastou não vira clique. O touchend vai
    // sempre para onde o toque começou, mesmo com a folha por cima; o
    // clique que escapar dele é barrado antes de chegar à tela.
    const aoTirarDedo = (e: TouchEvent) => {
      if (engolir && e.cancelable) e.preventDefault();
    };
    const aoClicarAntes = (e: MouseEvent) => {
      if (!engolir) return;
      engolir = false;
      if (Date.now() - fimDoToque > 600) return;
      e.preventDefault();
      e.stopPropagation();
    };
    // Um toque novo (na folha, em qualquer lugar) vale inteiro.
    const aoApertarEmQualquerLugar = (e: PointerEvent) => {
      if (toque && e.pointerId === toque.id) return;
      engolir = false;
    };

    caixa.addEventListener("pointerover", aoPassar);
    caixa.addEventListener("pointerleave", aoSairDaCaixa);
    caixa.addEventListener("scroll", aoRolar, { passive: true });
    caixa.addEventListener("focusin", aoFocar);
    caixa.addEventListener("focusout", aoDesfocar);
    caixa.addEventListener("keydown", aoTeclar);
    caixa.addEventListener("contextmenu", aoMenuDeContexto);
    caixa.addEventListener("pointerdown", aoApertar);
    caixa.addEventListener("pointermove", aoMover);
    caixa.addEventListener("pointerup", aoSoltar);
    caixa.addEventListener("pointercancel", aoCancelar);
    caixa.addEventListener("touchend", aoTirarDedo, { passive: false });
    window.addEventListener("click", aoClicarAntes, true);
    window.addEventListener("pointerdown", aoApertarEmQualquerLugar, true);
    return () => {
      caixa.removeEventListener("pointerover", aoPassar);
      caixa.removeEventListener("pointerleave", aoSairDaCaixa);
      caixa.removeEventListener("scroll", aoRolar);
      caixa.removeEventListener("focusin", aoFocar);
      caixa.removeEventListener("focusout", aoDesfocar);
      caixa.removeEventListener("keydown", aoTeclar);
      caixa.removeEventListener("contextmenu", aoMenuDeContexto);
      caixa.removeEventListener("pointerdown", aoApertar);
      caixa.removeEventListener("pointermove", aoMover);
      caixa.removeEventListener("pointerup", aoSoltar);
      caixa.removeEventListener("pointercancel", aoCancelar);
      caixa.removeEventListener("touchend", aoTirarDedo);
      window.removeEventListener("click", aoClicarAntes, true);
      window.removeEventListener("pointerdown", aoApertarEmQualquerLugar, true);
      if (toque) {
        window.clearTimeout(toque.timer);
        if (toque.estado === "arrastando") encerrarArrasto(toque);
      }
    };
    // As funções acima leem tudo por ref: os ouvintes nascem uma vez.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [caixaRef, conteudoRef]);

  /** O clique na seta ao lado da bolha. */
  const abrirPeloBotao = (e: React.MouseEvent<HTMLButtonElement>) => {
    if (!foco) return;
    const caixa = caixaRef.current;
    const linha = caixa?.querySelector<HTMLElement>(
      `div[data-msg="${CSS.escape(foco.ids.join(" "))}"]`,
    );
    const ms = linha ? mensagensDa(linha) : null;
    if (!linha || !ms) return;
    abrir(linha, ms, "menu", retangulo(e.currentTarget.getBoundingClientRect()));
  };

  return (
    <div ref={camadaRef} className="contents">
      {foco ? (
        <div
          className="pointer-events-none absolute z-[5] flex animate-entrada items-center"
          style={{ top: foco.topo, left: foco.esquerda }}
        >
          <button
            type="button"
            tabIndex={-1}
            aria-label="Ações da mensagem"
            title="Ações da mensagem"
            onClick={abrirPeloBotao}
            className="pointer-events-auto inline-flex h-[32px] w-[32px] items-center justify-center rounded-controle border border-fio bg-flutuante text-texto-2 transition-colors duration-[120ms] hover:border-fio-forte hover:text-tinta focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-tinta"
          >
            <ChevronDown size={18} strokeWidth={1.75} aria-hidden />
          </button>
        </div>
      ) : null}
      <span
        ref={iconeRef}
        aria-hidden
        className="pointer-events-none absolute z-[5] inline-flex h-[32px] w-[32px] items-center justify-center rounded-controle bg-cartao text-texto-2 opacity-0"
      >
        <Reply size={18} strokeWidth={1.75} />
      </span>
    </div>
  );
});
