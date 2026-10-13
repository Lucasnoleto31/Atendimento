"use client";

import {
  memo,
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from "react";
import { createPortal } from "react-dom";
import { Copy, EyeOff, Reply, Trash2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  Folha,
  ItemAcao,
  ItemSecao,
  ItensSecao,
} from "@/app/(app)/conversas/folha";
import {
  apagarMensagensParaEquipe,
  quemSouNoChat,
  restaurarMensagens,
  type EuNoChat,
  type ResultadoAcaoMensagem,
} from "./actions";
import { horaDaBolha, textoVisivel } from "./bolha";
import { emitirAtualizacaoDaConversa, type LinhaRealtime } from "./tempo-real";
import type {
  ApagadaMensagem,
  CanalConversa,
  Mensagem,
  RespostaCitada,
} from "./mensagem";

/*
 * As ações na mensagem, só as do WhatsApp que valem aqui: responder, copiar
 * e apagar para a equipe. Reagir, encaminhar e informações saíram em
 * 08/10/2026 (o chat não é um WhatsApp novo; nada além do pedido). No mouse
 * e no teclado abrem num menu ao lado da bolha; no toque, numa folha presa
 * no pé. Os gestos que abrem (a seta ao lado da bolha, o botão direito, o
 * toque longo, o arrasto para responder) moram em gestos-bolha.tsx.
 *
 * A apagada aparece na hora (eco local com rev fracionário: o rev inteiro
 * que o servidor grava passa por cima) e volta atrás se a action falhar.
 */

export type Retangulo = {
  top: number;
  bottom: number;
  left: number;
  right: number;
};

/** A linha de bolha que a pessoa escolheu, e de onde. */
export type AlvoMensagem = {
  /** As mensagens da linha, em ordem (o álbum de fotos tem várias). A
   *  primeira é a que responder e copiar usam. */
  mensagens: Mensagem[];
  linha: HTMLElement | null;
  /** O histórico que rola: o menu acompanha a bolha dentro dele. */
  caixa: HTMLElement | null;
  /** O gatilho (seta, bolha) ou o ponto do clique. */
  ancora: Retangulo;
  /** Toque abre folha; mouse e teclado, o menu ao lado da bolha. */
  forma: "menu" | "folha";
};

/** O aviso que aparece embaixo da conversa, com uma ação opcional
 *  ("Desfazer"). */
export type AvisoDaLista = {
  texto: string;
  acao?: { rotulo: string; fazer: () => void };
};

/* ── Quem está usando ─────────────────────────────────────────────────── */

let euPedido: Promise<EuNoChat | null> | null = null;

/** Quem está logado, uma leitura por página (a Janela remonta a cada
 *  conversa). Sessão que não respondeu é perguntada de novo depois. */
export function lerEuNoChat(): Promise<EuNoChat | null> {
  if (!euPedido) {
    euPedido = quemSouNoChat()
      .catch(() => null)
      .then((eu) => {
        if (!eu) euPedido = null;
        return eu;
      });
  }
  return euPedido;
}

/* ── Regras que a tela e o servidor dividem ───────────────────────────── */

/** O teto de mensagens por chamada (MAX_POR_ACAO em actions.ts). O álbum
 *  não tem teto na tela: vai em lotes deste tamanho. */
const LOTE_ACAO = 50;

/** O retrato da mensagem como citação (a barra de resposta e a bolha
 *  otimista). */
export function retratoDaMensagem(
  m: Mensagem,
  nomeContato: string | null,
): RespostaCitada {
  const texto = textoVisivel(m);
  return {
    idMeta: m.idMeta ?? null,
    interacaoId: m.id,
    em: m.criado_em,
    de: m.tipo === "mensagem_recebida" ? "contato" : "equipe",
    autor: m.tipo === "mensagem_recebida" ? nomeContato : m.autor,
    trecho: texto ? texto.slice(0, 200) : null,
    midia: m.anexos?.[0]?.tipo ?? null,
    story: null,
  };
}

/** A citação aparece para o contato? Só no WhatsApp, citando mensagem com
 *  wamid. No Direct o campo não foi confirmado na API que usamos. */
export function citacaoChegaAoContato(
  citada: Mensagem,
  canal: CanalConversa,
): boolean {
  return canal === "whatsapp" && (citada.idMeta ?? "").startsWith("wamid.");
}

/** Quem escreveu, como a tela fala. */
function autorDe(
  m: Mensagem,
  nomeContato: string | null,
  eu: EuNoChat | null,
): string {
  if (m.tipo === "mensagem_recebida") return nomeContato ?? "Contato";
  if (eu && m.autor === eu.nome) return "Você";
  return m.autor ?? "Equipe";
}

/**
 * A linha no formato do UPDATE do tempo real, montada da bolha que está na
 * tela, para o eco local. Só leva o que a Janela lê do UPDATE (as reações
 * do contato, a apagada, a edição e o rev).
 */
function linhaLocal(
  leadId: string,
  m: Mensagem,
  apagada: ApagadaMensagem | null,
  rev: number,
): LinhaRealtime {
  return {
    id: m.id,
    lead_id: leadId,
    tipo: m.tipo,
    conteudo: m.conteudo,
    criado_em: m.criado_em,
    metadados: {
      reacoes: (m.reacoes ?? []).map((r) => ({
        de: r.de,
        emoji: r.emoji,
        em: r.em,
        nome: r.nome,
      })),
      ...(apagada
        ? {
            apagada: {
              por: apagada.por,
              em: apagada.em,
              autor_id: apagada.autorId,
              nome: apagada.nome,
            },
          }
        : {}),
      ...(m.editada
        ? {
            editada: {
              em: m.editada.em,
              original: m.editada.original,
              sem_texto: m.editada.semTexto,
            },
          }
        : {}),
      rev,
    },
  };
}

/**
 * Chama a action em lotes do teto do servidor, um depois do outro. Para no
 * primeiro erro e devolve o que já foi gravado, para a tela voltar só o
 * resto.
 */
async function emLotes(
  ids: string[],
  acao: (lote: string[]) => Promise<ResultadoAcaoMensagem>,
): Promise<ResultadoAcaoMensagem> {
  const linhas: LinhaRealtime[] = [];
  for (let i = 0; i < ids.length; i += LOTE_ACAO) {
    const r = await acao(ids.slice(i, i + LOTE_ACAO));
    linhas.push(...(r.linhas ?? []));
    if (r.erro) return { erro: r.erro, linhas };
  }
  return { ok: true, linhas };
}

/* ── O menu ao lado da bolha ──────────────────────────────────────────── */

const SELETOR_ITENS = '[data-item]:not([disabled]):not([aria-disabled="true"])';

/** Põe o menu ao lado da âncora: cabe abaixo, ou vai para cima; nunca passa
 *  da borda. */
function colocar(el: HTMLElement, ancora: Retangulo, alinharFim: boolean) {
  const larguraTela = document.documentElement.clientWidth;
  const alturaTela = window.visualViewport?.height ?? window.innerHeight;
  const w = el.offsetWidth;
  const h = el.offsetHeight;
  const esquerda = Math.min(
    Math.max(alinharFim ? ancora.right - w : ancora.left, 8),
    Math.max(larguraTela - w - 8, 8),
  );
  let topo = ancora.bottom + 6;
  if (topo + h > alturaTela - 8) topo = ancora.top - h - 6;
  topo = Math.min(Math.max(topo, 8), Math.max(alturaTela - h - 8, 8));
  el.style.left = `${esquerda}px`;
  el.style.top = `${topo}px`;
}

/**
 * O menu do mouse e do teclado, solto na tela (fixo), ao lado do gatilho.
 * Foco no item inicial, setas andam, Esc e Tab fecham e devolvem o foco à
 * linha da mensagem. Clique fora, rolagem feita pela pessoa (roda do mouse,
 * dedo, barra de rolagem) e mudança de tamanho fecham, como no WhatsApp
 * Web. A rolagem que a tela faz sozinha (mensagem nova no fim, foto que
 * terminou de carregar) só leva o menu junto com a bolha; ele fecha quando
 * a bolha sai do histórico. Antes, essa rolagem fechava o menu e o clique
 * em "Responder" caía na bolha de baixo.
 */
function MenuFlutuante({
  ancora,
  alinharFim,
  rotulo,
  aoFechar,
  linha,
  caixa,
  children,
}: {
  ancora: Retangulo;
  /** A bolha nossa (à direita): o menu alinha pela borda direita. */
  alinharFim: boolean;
  rotulo: string;
  aoFechar: () => void;
  /** A linha da mensagem: o foco volta para ela, e o menu anda com ela. */
  linha: HTMLElement | null;
  caixa: HTMLElement | null;
  children: ReactNode;
}) {
  const painel = useRef<HTMLDivElement>(null);
  const aoFecharRef = useRef(aoFechar);
  // Onde a linha estava quando o menu foi posto: a rolagem da tela anda a
  // âncora pela diferença.
  const topoDaLinha = useRef<number | null>(null);
  const seguirRef = useRef<() => void>(() => {});
  useEffect(() => {
    aoFecharRef.current = aoFechar;
    seguirRef.current = () => {
      const el = painel.current;
      if (!el) return;
      if (!linha?.isConnected || topoDaLinha.current === null) {
        aoFecharRef.current();
        return;
      }
      const r = linha.getBoundingClientRect();
      const c = caixa?.isConnected ? caixa.getBoundingClientRect() : null;
      if (c && (r.bottom <= c.top || r.top >= c.bottom)) {
        aoFecharRef.current();
        return;
      }
      const dy = r.top - topoDaLinha.current;
      colocar(
        el,
        { ...ancora, top: ancora.top + dy, bottom: ancora.bottom + dy },
        alinharFim,
      );
    };
  });

  // Antes da pintura: o tamanho real decide o lado.
  useLayoutEffect(() => {
    const el = painel.current;
    if (!el) return;
    topoDaLinha.current = linha?.isConnected
      ? linha.getBoundingClientRect().top
      : null;
    colocar(el, ancora, alinharFim);
  }, [ancora, alinharFim, linha]);

  useEffect(() => {
    const el = painel.current;
    const inicial =
      el?.querySelector<HTMLElement>("[data-inicial]:not([disabled])") ??
      el?.querySelector<HTMLElement>(SELETOR_ITENS);
    (inicial ?? el)?.focus({ preventScroll: true });
  }, []);

  useEffect(() => {
    const el = painel.current;
    const dentro = (alvo: EventTarget | null) =>
      alvo instanceof Node && Boolean(el?.contains(alvo));
    // O pointerdown fora pega também a barra de rolagem arrastada.
    const fora = (e: PointerEvent) => {
      if (!dentro(e.target)) aoFecharRef.current();
    };
    const rolouAMao = (e: Event) => {
      if (!dentro(e.target)) aoFecharRef.current();
    };
    const rolou = (e: Event) => {
      if (!dentro(e.target)) seguirRef.current();
    };
    const mudouTamanho = () => aoFecharRef.current();
    document.addEventListener("pointerdown", fora, true);
    document.addEventListener("wheel", rolouAMao, { capture: true, passive: true });
    document.addEventListener("touchmove", rolouAMao, { capture: true, passive: true });
    document.addEventListener("scroll", rolou, true);
    window.addEventListener("resize", mudouTamanho);
    return () => {
      document.removeEventListener("pointerdown", fora, true);
      document.removeEventListener("wheel", rolouAMao, true);
      document.removeEventListener("touchmove", rolouAMao, true);
      document.removeEventListener("scroll", rolou, true);
      window.removeEventListener("resize", mudouTamanho);
      // Fechou com o foco dentro (ou solto no body): ele volta para a linha
      // da mensagem; solto, a próxima letra viraria atalho da fila.
      const ativo = document.activeElement;
      if (!ativo || ativo === document.body || el?.contains(ativo)) {
        if (linha?.isConnected) linha.focus({ preventScroll: true });
      }
    };
  }, [linha]);

  if (typeof document === "undefined") return null;

  return createPortal(
    <div
      ref={painel}
      role="dialog"
      aria-label={rotulo}
      data-popover="mensagem"
      tabIndex={-1}
      onKeyDown={(e) => {
        if (e.key === "Escape" || e.key === "Tab") {
          e.preventDefault();
          e.stopPropagation();
          aoFecharRef.current();
          return;
        }
        const setas = ["ArrowDown", "ArrowUp", "ArrowLeft", "ArrowRight", "Home", "End"];
        if (!setas.includes(e.key)) return;
        const itens = Array.from(
          painel.current?.querySelectorAll<HTMLElement>(SELETOR_ITENS) ?? [],
        );
        if (itens.length === 0) return;
        e.preventDefault();
        e.stopPropagation();
        const i = itens.indexOf(document.activeElement as HTMLElement);
        if (e.key === "Home" || e.key === "End" || i === -1) {
          const alvo =
            e.key === "End" || e.key === "ArrowUp" ? itens.length - 1 : 0;
          itens[alvo]?.focus();
          return;
        }
        const delta = e.key === "ArrowDown" || e.key === "ArrowRight" ? 1 : -1;
        itens[(i + delta + itens.length) % itens.length]?.focus();
      }}
      className="fixed top-0 left-0 z-50 flex max-h-[min(440px,calc(var(--vv-altura,100dvh)-16px))] w-[296px] max-w-[calc(100vw-16px)] animate-entrada flex-col overflow-y-auto overscroll-contain rounded-painel border border-fio bg-flutuante p-0.5 shadow-lg outline-none"
    >
      {children}
    </div>,
    document.body,
  );
}

/* ── Os painéis ───────────────────────────────────────────────────────── */

type Painel = "acoes" | "apagar";

/**
 * O menu da mensagem e a confirmação de apagar. Fica montado na Janela;
 * `alvo` diz qual linha está em cena. Memoizado pelo mesmo motivo da camada
 * dos gestos: as props são estáveis.
 */
export const PaineisDaMensagem = memo(function PaineisDaMensagem({
  alvo,
  aoFechar,
  leadId,
  eu,
  nomeContato,
  mensagens,
  temConversa,
  aoResponder,
  aoAvisar,
}: {
  alvo: AlvoMensagem | null;
  aoFechar: () => void;
  leadId: string;
  eu: EuNoChat | null;
  nomeContato: string | null;
  /** A lista que está na tela: o painel lê a versão mais nova da bolha. */
  mensagens: Mensagem[];
  temConversa: boolean;
  aoResponder: (m: Mensagem) => void;
  aoAvisar: (aviso: AvisoDaLista) => void;
}) {
  const [painel, setPainel] = useState<Painel | null>(null);
  // O último alvo fica para a folha descer com o conteúdo à vista.
  const [ultimo, setUltimo] = useState<AlvoMensagem | null>(null);
  const [alvoVisto, setAlvoVisto] = useState<AlvoMensagem | null>(null);
  const [apagando, setApagando] = useState(false);
  const [erroApagar, setErroApagar] = useState<string | null>(null);
  if (alvo !== alvoVisto) {
    setAlvoVisto(alvo);
    if (alvo) {
      setUltimo(alvo);
      setPainel("acoes");
      setErroApagar(null);
      setApagando(false);
    } else {
      setPainel(null);
    }
  }

  const porId = useMemo(
    () => new Map(mensagens.map((m) => [m.id, m])),
    [mensagens],
  );
  const listaRef = useRef(porId);
  useEffect(() => {
    listaRef.current = porId;
  });

  // A linha em cena fica marcada enquanto o menu ou o diálogo está aberto.
  useEffect(() => {
    const linha = alvo?.linha;
    if (!linha) return;
    linha.setAttribute("data-acoes", "");
    return () => linha.removeAttribute("data-acoes");
  }, [alvo]);

  // Para onde o foco volta ao fechar a folha ou o diálogo. Antes dos
  // efeitos da Folha, que leem o retorno ao abrir.
  const retornoRef = useRef<HTMLElement | null>(null);
  useLayoutEffect(() => {
    if (alvo?.linha) retornoRef.current = alvo.linha;
  }, [alvo]);

  const ms = ultimo ? ultimo.mensagens.map((m) => porId.get(m.id) ?? m) : [];
  const principal = ms[0] ?? null;
  const forma = ultimo?.forma ?? "menu";
  const leitura = eu?.leitura ?? true;
  const doContato = ms.some((m) => m.tipo === "mensagem_recebida");

  const textoCopiavel =
    principal && ms.length === 1 && !principal.apagada
      ? textoVisivel(principal)
      : null;
  const respondivel =
    Boolean(principal) &&
    temConversa &&
    !leitura &&
    !principal!.apagada &&
    !principal!.pendente;
  const apagavel =
    Boolean(eu) &&
    !leitura &&
    ms.length > 0 &&
    ms.every((m) => !m.apagada) &&
    (eu!.gestao ||
      ms.every((m) => m.tipo !== "mensagem_recebida" && m.autor === eu!.nome));
  const rotuloApagar = doContato
    ? "Ocultar para a equipe"
    : principal?.tipo === "nota"
      ? "Apagar a nota"
      : "Apagar para a equipe";

  /* ── as ações ── */

  const emitir = (linhas: LinhaRealtime[] | undefined) =>
    linhas?.forEach(emitirAtualizacaoDaConversa);

  const copiar = (texto: string) => {
    aoFechar();
    if (!navigator.clipboard) {
      aoAvisar({ texto: "Não deu para copiar neste navegador." });
      return;
    }
    navigator.clipboard.writeText(texto).then(
      () => aoAvisar({ texto: "Mensagem copiada." }),
      () => aoAvisar({ texto: "Não deu para copiar." }),
    );
  };

  /** Desfaz o apagar: a marca da equipe sai e a bolha volta. */
  const restaurar = (ids: string[]) => {
    const atuais = ids
      .map((id) => listaRef.current.get(id))
      .filter((m): m is Mensagem => Boolean(m));
    for (const m of atuais) {
      emitirAtualizacaoDaConversa(linhaLocal(leadId, m, null, (m.rev ?? 0) + 0.5));
    }
    const voltar = (exceto: Set<string>) => {
      for (const m of atuais) {
        if (exceto.has(m.id)) continue;
        emitirAtualizacaoDaConversa(
          linhaLocal(leadId, m, m.apagada ?? null, (m.rev ?? 0) + 0.75),
        );
      }
    };
    emLotes(ids, restaurarMensagens).then(
      (r) => {
        emitir(r.linhas);
        if (r.erro) {
          voltar(new Set((r.linhas ?? []).map((l) => l.id)));
          aoAvisar({ texto: r.erro });
        } else {
          aoAvisar({ texto: "A mensagem voltou." });
        }
      },
      () => {
        voltar(new Set());
        aoAvisar({ texto: "A conexão não respondeu. Tente de novo." });
      },
    );
  };

  const apagar = async () => {
    if (!eu || ms.length === 0 || apagando) return;
    const lista = ms;
    const ids = lista.map((m) => m.id);
    const ocultar = doContato;
    setApagando(true);
    setErroApagar(null);
    const marca: ApagadaMensagem = {
      por: "equipe",
      em: new Date().toISOString(),
      autorId: eu.id,
      nome: eu.nome,
    };
    for (const m of lista) {
      emitirAtualizacaoDaConversa(linhaLocal(leadId, m, marca, (m.rev ?? 0) + 0.5));
    }
    const voltar = (exceto: Set<string>) => {
      for (const m of lista) {
        if (exceto.has(m.id)) continue;
        emitirAtualizacaoDaConversa(
          linhaLocal(leadId, m, m.apagada ?? null, (m.rev ?? 0) + 0.75),
        );
      }
    };
    let erro: string | null = null;
    try {
      const r = await emLotes(ids, apagarMensagensParaEquipe);
      emitir(r.linhas);
      if (r.erro) {
        voltar(new Set((r.linhas ?? []).map((l) => l.id)));
        erro = r.erro;
      }
    } catch {
      voltar(new Set());
      erro = "A conexão não respondeu. Tente de novo.";
    }
    setApagando(false);
    if (erro) {
      setErroApagar(erro);
      return;
    }
    aoFechar();
    aoAvisar({
      texto: ocultar
        ? "Mensagem oculta para a equipe."
        : "Mensagem apagada para a equipe.",
      acao: { rotulo: "Desfazer", fazer: () => restaurar(ids) },
    });
  };

  /* ── o conteúdo do menu (o mesmo no menu e na folha) ── */

  const itensAcoes = (): ReactNode => {
    if (!principal) return null;
    const menu = forma === "menu";
    const variante = menu ? "menu" : "folha";
    if (!respondivel && !textoCopiavel && !apagavel) {
      return (
        <p className="tipo-corpo px-1 py-1 text-texto-2">
          Nenhuma ação para esta mensagem.
        </p>
      );
    }
    return (
      <ItensSecao menu={menu}>
        {respondivel ? (
          <ItemSecao menu={menu}>
            <ItemAcao
              variante={variante}
              papel="button"
              data-inicial=""
              icone={<Reply size={18} strokeWidth={1.75} />}
              onClick={() => {
                aoFechar();
                aoResponder(principal);
              }}
            >
              Responder
            </ItemAcao>
          </ItemSecao>
        ) : null}
        {textoCopiavel ? (
          <ItemSecao menu={menu}>
            <ItemAcao
              variante={variante}
              papel="button"
              icone={<Copy size={18} strokeWidth={1.75} />}
              onClick={() => copiar(textoCopiavel)}
            >
              Copiar
            </ItemAcao>
          </ItemSecao>
        ) : null}
        {apagavel ? (
          <>
            {menu && (respondivel || textoCopiavel) ? (
              <div role="separator" className="my-0.5 border-t border-fio" />
            ) : null}
            <ItemSecao menu={menu}>
              <ItemAcao
                variante={variante}
                papel="button"
                perigo
                icone={
                  doContato ? (
                    <EyeOff size={18} strokeWidth={1.75} className="text-erro" />
                  ) : (
                    <Trash2 size={18} strokeWidth={1.75} className="text-erro" />
                  )
                }
                onClick={() => {
                  setErroApagar(null);
                  setPainel("apagar");
                }}
              >
                {rotuloApagar}
              </ItemAcao>
            </ItemSecao>
          </>
        ) : null}
      </ItensSecao>
    );
  };

  const menuAberto = painel === "acoes";

  const tituloFolha = principal
    ? `${autorDe(principal, nomeContato, eu)} · ${horaDaBolha(principal.criado_em)}`
    : "Mensagem";

  const tituloApagar = (() => {
    const varias = ms.length > 1;
    const n = ms.length.toLocaleString("pt-BR");
    if (doContato) {
      return varias ? `Ocultar ${n} mensagens para a equipe?` : "Ocultar para a equipe?";
    }
    if (principal?.tipo === "nota") return "Apagar a nota?";
    return varias ? `Apagar ${n} mensagens para a equipe?` : "Apagar para a equipe?";
  })();
  const comMidia = ms.some((m) => (m.anexos?.length ?? 0) > 0);

  return (
    <>
      {menuAberto && ultimo && forma === "menu" && principal ? (
        <MenuFlutuante
          ancora={ultimo.ancora}
          alinharFim={principal.tipo !== "mensagem_recebida"}
          rotulo="Ações da mensagem"
          aoFechar={aoFechar}
          linha={ultimo.linha}
          caixa={ultimo.caixa}
        >
          {itensAcoes()}
        </MenuFlutuante>
      ) : null}

      <Folha
        aberta={menuAberto && forma === "folha"}
        aoFechar={aoFechar}
        titulo={tituloFolha}
        retorno={retornoRef}
      >
        {forma === "folha" ? itensAcoes() : null}
      </Folha>

      <Folha
        aberta={painel === "apagar"}
        aoFechar={() => {
          if (!apagando) aoFechar();
        }}
        titulo={tituloApagar}
        forma="centro"
        retorno={retornoRef}
        rodape={
          <div className="flex flex-col-reverse gap-1 md:flex-row md:justify-end">
            <Button
              type="button"
              variant="secondary"
              disabled={apagando}
              onClick={aoFechar}
              className="pointer-coarse:h-[44px]"
            >
              Cancelar
            </Button>
            <Button
              type="button"
              variant="danger"
              carregando={apagando}
              onClick={() => void apagar()}
              className="pointer-coarse:h-[44px]"
            >
              {apagando
                ? doContato
                  ? "Ocultando…"
                  : "Apagando…"
                : doContato
                  ? "Ocultar"
                  : "Apagar"}
            </Button>
          </div>
        }
      >
        <div className="flex flex-col gap-1 pt-0.5">
          <p className="tipo-corpo text-tinta">
            {principal?.tipo === "nota" && !doContato
              ? "A nota some da conversa para toda a equipe."
              : doContato
                ? "A mensagem some da conversa para toda a equipe. O cliente continua vendo no aparelho dele."
                : "O cliente continua vendo esta mensagem."}
          </p>
          {comMidia ? (
            <p className="tipo-corpo text-texto-2">
              O arquivo continua guardado; só sai da tela.
            </p>
          ) : null}
          <p className="tipo-nota text-texto-2">Fica registrado no Log de acesso.</p>
          {erroApagar ? (
            <p role="alert" className="tipo-nota text-erro">
              {erroApagar}
            </p>
          ) : null}
        </div>
      </Folha>
    </>
  );
});
