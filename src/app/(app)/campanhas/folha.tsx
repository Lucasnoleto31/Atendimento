"use client";

import { useEffect, useId, useRef, useState } from "react";
import { X } from "lucide-react";
import { cn } from "@/lib/utils";
import { BOTAO_ICONE } from "@/components/app/form-styles";

/*
 * A folha das campanhas (kit, bloco 8): no telefone, presa no pé, com pegador
 * e arrasto para fechar; do tablet para cima, janela centralizada de 560px
 * com X. É um <dialog> nativo aberto com showModal(): fica na camada de cima
 * (por cima da barra de abas e do menu lateral, sem disputa de z-index), o
 * resto da página fica inerte e o Esc chega como "cancel".
 *
 * Abrir põe o foco na própria folha, nunca num campo: no toque, focar campo
 * abriria o teclado sem ninguém pedir. Fechar devolve o foco a quem abriu.
 * Com o teclado do celular aberto, a folha sobe junto (--teclado, medido
 * pela casca).
 */

/** Quanto o arrasto precisa descer para fechar, e a velocidade que basta
 *  (kit, bloco 6). */
const ARRASTO_FECHA_PX = 120;
const ARRASTO_VELOCIDADE = 0.5;
/** Saída da folha (kit, bloco 6: fecha em 0,24s). Quem troca uma folha por
 *  outra espera este tempo, para a segunda abrir depois de a primeira
 *  devolver o foco e soltar a rolagem da página. */
export const SAIDA_MS = 240;

type Fase = "fechada" | "aberta" | "saindo";

export function Folha({
  aberta,
  aoFechar,
  titulo,
  apoio,
  topo,
  rodape,
  children,
}: {
  aberta: boolean;
  aoFechar: () => void;
  titulo: string;
  /** Linha curta sob o título ("Passo 2 de 4"). */
  apoio?: string;
  /** Faixa fixa entre o cabeçalho e o corpo (progresso, voltar). */
  topo?: React.ReactNode;
  /** Pé fixo (o botão largo do passo). */
  rodape?: React.ReactNode;
  children: React.ReactNode;
}) {
  const dialogo = useRef<HTMLDialogElement>(null);
  // Várias folhas na mesma tela (a nova campanha e o editor de cada cartão):
  // o id do título é de cada uma.
  const idTitulo = useId();
  const quemAbriu = useRef<HTMLElement | null>(null);
  // O toque que fecha pelo fundo precisa COMEÇAR e TERMINAR no fundo: apertar
  // de um lado e soltar do outro (seleção de texto arrastada de dentro do
  // painel para fora, ou de fora para dentro) dá um clique no próprio
  // <dialog>, o ancestral comum dos dois.
  const apertouNoFundo = useRef(false);
  const soltouNoFundo = useRef(false);
  const fechar = useRef(aoFechar);
  useEffect(() => {
    fechar.current = aoFechar;
  });
  const { painel, arrasto } = useArrasto(() => fechar.current());

  // A fase segue o "aberta" de quem usa, ajustada ainda na renderização: a
  // saída fica montada o tempo da animação e só então o <dialog> fecha.
  const [fase, setFase] = useState<Fase>("fechada");
  if (aberta && fase !== "aberta") setFase("aberta");
  if (!aberta && fase === "aberta") setFase("saindo");

  useEffect(() => {
    const el = dialogo.current;
    if (!el) return;
    if (fase === "aberta" && !el.open) {
      quemAbriu.current = document.activeElement as HTMLElement | null;
      el.showModal();
      painel.current?.focus({ preventScroll: true });
      // Página de trás parada enquanto a folha está aberta.
      document.documentElement.style.overflow = "hidden";
      return;
    }
    if (fase === "saindo") {
      const espera = window.setTimeout(() => {
        el.close();
        document.documentElement.style.overflow = "";
        painel.current?.style.setProperty("--arrasto", "0px");
        quemAbriu.current?.focus({ preventScroll: true });
        setFase("fechada");
      }, SAIDA_MS);
      return () => window.clearTimeout(espera);
    }
  }, [fase, painel]);

  // Desmontada aberta (troca de rota): a página volta a rolar.
  useEffect(
    () => () => {
      document.documentElement.style.overflow = "";
    },
    [],
  );

  const saindo = fase === "saindo";
  // Fechada, a folha não monta o conteúdo: cada cartão tem o seu editor, e
  // dezenas de formulários escondidos só pesariam na página.
  const montada = fase !== "fechada";

  return (
    <dialog
      ref={dialogo}
      aria-labelledby={idTitulo}
      // Esc: quem fecha é o estado, para a saída animar.
      onCancel={(e) => {
        e.preventDefault();
        fechar.current();
      }}
      // Fechado por fora (o navegador pode ignorar o preventDefault de um
      // segundo Esc seguido): o estado acompanha.
      onClose={() => {
        if (aberta) fechar.current();
      }}
      // Toque no fundo (o próprio <dialog>, fora do painel) fecha, se tanto o
      // apertar quanto o soltar foram no fundo.
      onPointerDown={(e) => {
        apertouNoFundo.current = e.target === e.currentTarget;
      }}
      onPointerUp={(e) => {
        soltouNoFundo.current = e.target === e.currentTarget;
      }}
      onClick={(e) => {
        const doFundo = apertouNoFundo.current && soltouNoFundo.current;
        apertouNoFundo.current = false;
        soltouNoFundo.current = false;
        if (doFundo && e.target === e.currentTarget) fechar.current();
      }}
      className={cn(
        "fixed inset-0 m-0 h-full max-h-none w-full max-w-none overflow-hidden border-0 p-0 text-tinta backdrop:bg-transparent",
        // Fundo escurecido no próprio <dialog>, com fade de 180ms.
        "bg-overlay transition-[background-color] duration-[180ms] starting:bg-transparent",
        saindo && "bg-transparent",
        // Telefone: a folha no pé, acima do teclado. Tablet e desktop: a
        // janela no meio, a 12px da borda.
        "flex-col justify-end pb-[var(--teclado,0px)] open:flex md:items-center md:justify-center md:p-1.5",
      )}
    >
      <div
        ref={painel}
        tabIndex={-1}
        data-saindo={saindo ? "" : undefined}
        // O arrasto mexe no transform (--arrasto); a entrada e a saída, no
        // translate do Tailwind. São propriedades separadas e se somam.
        style={{ transform: "translateY(var(--arrasto, 0px))" }}
        className={cn(
          "flex w-full flex-col overflow-hidden bg-flutuante shadow-flutuante outline-none",
          "max-h-[calc(100dvh-var(--teclado,0px)-24px)] rounded-t-folha",
          "md:max-h-[calc(100dvh-24px)] md:w-[560px] md:max-w-full md:rounded-folha",
          "transition-[translate,opacity,transform] duration-[280ms] ease-padrao data-saindo:duration-[240ms]",
          "starting:translate-y-full data-saindo:translate-y-full",
          "md:duration-[180ms] md:starting:translate-y-0 md:starting:opacity-0 md:data-saindo:translate-y-0 md:data-saindo:opacity-0",
        )}
      >
        <div
          {...arrasto}
          className="flex shrink-0 touch-none flex-col items-center pt-1 select-none md:touch-auto md:pt-1.5"
        >
          <span
            aria-hidden
            className="h-[5px] w-[36px] rounded-full bg-fio-forte md:hidden"
          />
          <div className="flex w-full items-start justify-between gap-1 pt-0.5 pr-1 pl-2 md:pt-0 md:pl-3">
            <div className="min-w-0 pt-[10px]">
              <h2
                id={idTitulo}
                className="tipo-titulo-3 truncate text-tinta"
              >
                {titulo}
              </h2>
              {apoio ? (
                <p className="tipo-nota text-texto-2 tabular-nums">{apoio}</p>
              ) : null}
            </div>
            <button
              type="button"
              onClick={() => fechar.current()}
              aria-label="Fechar"
              className={BOTAO_ICONE}
            >
              <X size={22} strokeWidth={1.75} aria-hidden />
            </button>
          </div>
        </div>

        {montada ? topo : null}

        <div className="min-h-0 flex-1 overflow-x-hidden overflow-y-auto overscroll-contain px-2 pt-1.5 pb-2 md:px-3">
          {montada ? children : null}
        </div>

        {montada && rodape ? (
          <div className="shrink-0 border-t border-fio px-2 pt-1.5 pb-[max(16px,env(safe-area-inset-bottom))] md:px-3 md:pb-2">
            {rodape}
          </div>
        ) : null}
      </div>
    </dialog>
  );
}

/**
 * Folha que desce com o dedo, como a do iOS: segue o dedo para baixo, resiste
 * para cima (um quinto do arrasto), fecha passando de 120px ou soltando
 * rápido. Só no toque; com mouse fecha no X, no fundo ou no Esc. O painel é
 * do próprio gancho: quem usa põe o `painel` no elemento.
 */
function useArrasto(fechar: () => void) {
  const painel = useRef<HTMLDivElement>(null);
  const gesto = useRef<{
    id: number;
    inicio: number;
    arrastando: boolean;
    amostras: { y: number; t: number }[];
  } | null>(null);

  const mover = (y: number, comTransicao: boolean) => {
    const el = painel.current;
    if (!el) return;
    el.style.transition = comTransicao ? "" : "none";
    el.style.setProperty("--arrasto", `${y}px`);
  };

  const soltar = (e: React.PointerEvent<HTMLElement>) => {
    const g = gesto.current;
    gesto.current = null;
    if (!g?.arrastando) return;
    const distancia = e.clientY - g.inicio;
    const a = g.amostras[0];
    const b = g.amostras[g.amostras.length - 1];
    const velocidade = (b.y - a.y) / Math.max(1, b.t - a.t);
    if (
      distancia > ARRASTO_FECHA_PX ||
      (distancia > 24 && velocidade > ARRASTO_VELOCIDADE)
    ) {
      // Sai de onde está: o translate vai a 100% com o --arrasto ainda
      // aplicado; ele zera quando a folha termina de sair.
      const el = painel.current;
      if (el) el.style.transition = "";
      fechar();
      return;
    }
    mover(0, true);
  };

  const arrasto = {
    onPointerDown(e: React.PointerEvent<HTMLElement>) {
      if (e.pointerType === "mouse") return;
      // O X fica dentro da faixa de arrasto e precisa do toque dele.
      if ((e.target as HTMLElement).closest("button")) return;
      gesto.current = {
        id: e.pointerId,
        inicio: e.clientY,
        arrastando: false,
        amostras: [{ y: e.clientY, t: e.timeStamp }],
      };
    },
    onPointerMove(e: React.PointerEvent<HTMLElement>) {
      const g = gesto.current;
      if (!g || g.id !== e.pointerId) return;
      const distancia = e.clientY - g.inicio;
      if (!g.arrastando) {
        if (Math.abs(distancia) < 6) return;
        g.arrastando = true;
        try {
          e.currentTarget.setPointerCapture(e.pointerId);
        } catch {
          // Ponteiro que o navegador já soltou: segue sem captura.
        }
      }
      mover(distancia > 0 ? distancia : distancia / 5, false);
      g.amostras = [...g.amostras.slice(-2), { y: e.clientY, t: e.timeStamp }];
    },
    onPointerUp: soltar,
    onPointerCancel: soltar,
  };
  return { painel, arrasto };
}
