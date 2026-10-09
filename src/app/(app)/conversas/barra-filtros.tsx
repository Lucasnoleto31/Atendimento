"use client";

import {
  useEffect,
  useId,
  useLayoutEffect,
  useRef,
  useState,
  type RefObject,
} from "react";
import {
  ChevronDown,
  ChevronLeft,
  ChevronRight,
  Funnel,
  Search,
  X,
} from "lucide-react";
import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import { Segmentado, type OpcaoSegmentada } from "@/components/ui/segmentado";
import { Spinner } from "@/components/ui/spinner";
import {
  BOTAO_ICONE,
  CAMPO,
  CAMPO_BASE,
  ERRO_CAMPO,
  ROTULO,
} from "@/components/app/form-styles";
import { pontoDaEtiqueta } from "@/app/(app)/contatos/cor-etiqueta";
import { Chip } from "@/components/ui/etiqueta";
import { IconeDaPessoa } from "@/app/(app)/chat/fotos";
import {
  ehDataFila,
  hojeEmBrasilia,
  MAX_IDS_FILTRO_FILA,
  rotuloDoPeriodo,
  SEM_DONO,
  somarDiasFila,
  valorDoFiltroEtiquetas,
  type AtalhoPeriodo,
  type CanalFila,
  type EtiquetaCatalogo,
  type FiltrosFila,
  type MembroEquipe,
  type ModoEtiquetas,
} from "@/app/(app)/chat/mensagem";
import {
  Folha,
  Grupo,
  ItemAcao,
  ItemSecao,
  ItensSecao,
  LinhaGrupo,
  MenuSuspenso,
  TituloSecao,
  useTelaMd,
  useToque,
} from "./folha";
import type { CampanhaDaFila } from "./lista";
import { ItemMarcavel, type EstadoCarga } from "./topo-fila";

/*
 * Os filtros da fila em duas metades. Na linha do título, o funil
 * (FunilFiltros): tocar abre a lista "Filtrar por", com as escolhas curtas
 * ali mesmo (período e canal em chips, "Só não lidas") e as longas
 * (Etiquetas, Atendentes, Campanha, Escolher datas) num menu ancorado no
 * funil, com "‹ Filtros" no topo para voltar. Filtros diferentes se somam,
 * e o "Ver N conversas" do pé fecha sobre a fila (desde 09/10/2026: antes,
 * cada escolha curta fechava tudo e somar três filtros abria o funil três
 * vezes). Embaixo do escopo, só os filtros ligados (BarraFiltros), como
 * pílulas: o valor na tinta ("Últimos 7 dias", "VIP +2") e o X que tira o
 * filtro ali mesmo; tocar na pílula abre o mesmo menu, ancorado nela. Sem
 * filtro ligado, essa linha não existe.
 *
 * Pedido do Artur em 09/10/2026 ("deixe apenas um funil como ícone, assim
 * aproveitamos esse espaço"): a barra com um botão por filtro, sempre à
 * vista, ocupava duas linhas no topo da fila. Os menus de cada filtro são os
 * mesmos de antes (folha presa no pé no celular), e o menu sem opções
 * continua dizendo por que está vazio.
 *
 * Só a apresentação mudou: os filtros, a URL e o servidor são os mesmos.
 */

export type MenuFiltro =
  | "periodo"
  | "etiquetas"
  | "atendentes"
  | "canal"
  | "campanha";

/**
 * O que está aberto: a lista do funil ("Filtrar por") ou o menu de um
 * filtro, ancorado no funil (escolhido na lista) ou na pílula dele.
 */
export type FiltroAberto =
  | { qual: "lista" }
  | { qual: MenuFiltro; ancora: "funil" | "pilula" };

/** "‹ Filtros" no topo do menu aberto pelo funil: volta à lista. */
export type VoltarMenu = { rotulo: string; aoVoltar: () => void };

/** Acima de tantos itens, o menu ganha a busca no topo. */
export const ITENS_SEM_BUSCA = 8;

const ATALHOS: { valor: AtalhoPeriodo; rotulo: string; dias: number }[] = [
  { valor: "hoje", rotulo: "Hoje", dias: 0 },
  { valor: "7d", rotulo: "Últimos 7 dias", dias: 6 },
  { valor: "30d", rotulo: "Últimos 30 dias", dias: 29 },
];

// O campo de data do Chrome passa por anos que existem enquanto se digita
// (0002, 0020, 0202, 2026). Data antes disto não vale como filtro.
const DATA_MINIMA = "2000-01-01";

/** Data inteira e plausível: ano de quatro dígitos a partir de 2000. */
function dataPronta(valor: string): boolean {
  return ehDataFila(valor) && valor >= DATA_MINIMA;
}

const ROTULO_STATUS_CAMPANHA: Record<CampanhaDaFila["status"], string> = {
  ativa: "Enviando",
  pausada: "Pausada",
  concluida: "Concluída",
};

/** Minúsculas e sem acento: "joao" acha "João". */
export function normalizarBusca(texto: string): string {
  return texto
    .normalize("NFD")
    .replace(/\p{Diacritic}/gu, "")
    .toLocaleLowerCase("pt-BR")
    .trim();
}

/** Os itens cujo nome contém o termo (já normalizado). */
export function filtrarPorNome<T extends { nome: string }>(
  itens: T[],
  termo: string,
): T[] {
  const t = normalizarBusca(termo);
  if (!t) return itens;
  return itens.filter((i) => normalizarBusca(i.nome).includes(t));
}

/**
 * O foco vai para o painel aberto em volta (o menu, ou a folha no celular).
 * Item que some com o foco deixaria o foco no body com o painel aberto: Esc
 * não fecharia, as setas não andariam e a próxima letra viraria atalho do
 * chat (E resolve a conversa).
 */
export function focarPainel(de: HTMLElement | null) {
  de?.closest<HTMLElement>('[data-popover], [role="dialog"]')?.focus({
    preventScroll: true,
  });
}

/* ── Peças dos menus ──────────────────────────────────────────────────── */

/**
 * A busca no topo de um menu comprido. Com mouse e teclado ela recebe o
 * foco ao abrir e entra nas setas do menu (↓ desce para os itens); no toque
 * fica fora delas, para o menu não abrir o teclado a cada toque. Enter vai
 * ao primeiro item; Esc com texto limpa antes de fechar.
 */
export function CampoBuscaMenu({
  valor,
  aoMudar,
  rotulo,
  placeholder,
  aoEnter,
}: {
  valor: string;
  aoMudar: (valor: string) => void;
  /** O nome do campo para o leitor de tela ("Buscar etiqueta"). */
  rotulo: string;
  placeholder: string;
  /** Enter antes do padrão (ir ao primeiro item): devolve true quando
   *  resolveu sozinho (a busca sobrou com uma pessoa só e ela é escolhida). */
  aoEnter?: () => boolean;
}) {
  const toque = useToque();
  return (
    <label className="relative block">
      <span className="sr-only">{rotulo}</span>
      <Search
        size={16}
        strokeWidth={1.75}
        aria-hidden
        className="pointer-events-none absolute top-1/2 left-1 -translate-y-1/2 text-texto-3"
      />
      <input
        type="search"
        data-item={toque ? undefined : ""}
        value={valor}
        onChange={(e) => aoMudar(e.target.value)}
        onKeyDown={(e) => {
          // Home e End movem o cursor no campo, não o foco do menu.
          if (e.key === "Home" || e.key === "End") e.stopPropagation();
          if (e.key === "Escape" && valor) {
            e.preventDefault();
            e.stopPropagation();
            aoMudar("");
          }
          if (e.key === "Enter") {
            e.preventDefault();
            if (aoEnter?.()) return;
            const campo = e.currentTarget;
            const painel = campo.closest<HTMLElement>(
              '[data-popover], [role="dialog"]',
            );
            const primeiro = Array.from(
              painel?.querySelectorAll<HTMLElement>(
                '[data-item]:not([disabled]):not([aria-disabled="true"])',
              ) ?? [],
            ).find((el) => el !== campo);
            primeiro?.focus();
          }
        }}
        placeholder={placeholder}
        autoComplete="off"
        autoCorrect="off"
        spellCheck={false}
        enterKeyHint="search"
        className={cn(
          CAMPO_BASE,
          "tipo-corpo w-full border-transparent bg-cartao pr-1 pl-3.5 hover:border-transparent [&::-webkit-search-cancel-button]:hidden",
        )}
      />
    </label>
  );
}

/** A frase do menu sem itens: vazio, sem resultado na busca ou falha. */
export function MensagemMenu({
  menu,
  erro = false,
  children,
}: {
  menu: boolean;
  erro?: boolean;
  children: React.ReactNode;
}) {
  return (
    <p
      className={cn(
        menu ? "tipo-nota px-1 py-1" : "tipo-corpo px-1.5 py-1.5",
        erro ? "text-erro" : "text-texto-2",
      )}
    >
      {children}
    </p>
  );
}

/** A linha que diz que a lista chegou ao teto do filtro. Fica montada
 *  vazia (e escondida) para o leitor de tela ouvir quando o texto entra. */
function AvisoDoTeto({
  menu,
  children,
}: {
  menu: boolean;
  children: string;
}) {
  return (
    <p
      role="status"
      className={cn(
        "tipo-nota text-texto-2 empty:sr-only",
        menu ? "px-1 pt-0.5 pb-1" : "px-1.5 pt-1",
      )}
    >
      {children}
    </p>
  );
}

/**
 * "‹ Filtros": volta do menu de um filtro à lista do funil. Fica fora das
 * setas do menu (sem data-item), para o foco de entrada cair no primeiro
 * item e não nele; chega-se a ele pelo Shift+Tab, e o Esc faz o mesmo. Na
 * folha, 44px no alto da rolagem, com a seta na margem do texto.
 *
 * `papel`: dentro de um role="menu" (o Canal), "menuitem". Botão comum não
 * é filho válido de menu, e o leitor de tela no modo menu pode nem anunciá-lo.
 */
function BotaoVoltar({
  menu,
  voltar,
  papel,
}: {
  menu: boolean;
  voltar: VoltarMenu;
  papel?: "menuitem";
}) {
  return (
    <button
      type="button"
      role={papel}
      onClick={voltar.aoVoltar}
      aria-label={`Voltar: ${voltar.rotulo}`}
      title="Voltar (Esc)"
      className={cn(
        "inline-flex items-center gap-0.5 justify-self-start rounded-controle pr-1 transition-[background-color,color] duration-[120ms] hover:bg-realce active:bg-pressionado focus-visible:outline-2 focus-visible:-outline-offset-2 focus-visible:outline-tinta",
        menu
          ? "tipo-nota h-[32px] pl-0.5 text-texto-2 hover:text-tinta pointer-coarse:h-[44px]"
          : "tipo-corpo -ml-1 h-[44px] text-tinta",
      )}
    >
      <ChevronLeft size={menu ? 16 : 20} strokeWidth={1.75} aria-hidden />
      {voltar.rotulo}
    </button>
  );
}

/**
 * O que flutua de um botão: menu suspenso do tablet para cima, folha presa
 * no pé no celular. No menu, `topo` (a busca) e `pe` (Limpar, Aplicar)
 * ficam parados e só a lista do meio rola, com a barra de rolagem à vista
 * na borda do menu. Na folha, a busca vai no alto da rolagem; o Limpar vai
 * ao lado do título (`acaoFolha`) e o botão de fechar sobre o resultado, no
 * pé (`rodapeFolha`).
 *
 * `alturaPelaTela`: a altura acompanha o espaço que sobra entre o botão e o
 * pé da janela (--espaco-menu, medido enquanto o menu está aberto). A barra
 * de filtros ficava a uns 240px do alto; com a altura padrão, o fim do menu
 * passava da tela.
 *
 * `voltar`: aberto pelo funil, o menu ganha no topo o "‹ Filtros" e, ao
 * lado, o nome do filtro (o funil não diz qual menu é este; a pílula dizia).
 * Na folha, o nome já está no título e o voltar vai no alto da rolagem.
 *
 * `aviso`: uma linha de ajuda acima da busca, parada ("Entra a conversa com
 * qualquer uma das marcadas.").
 */
export function PainelEscolha({
  menu,
  aberta,
  aoFechar,
  titulo,
  gatilho,
  papel = "dialog",
  alinhar = "inicio",
  largura,
  alturaPelaTela = false,
  voltar,
  aviso,
  topo,
  pe,
  acaoFolha,
  rodapeFolha,
  children,
}: {
  menu: boolean;
  aberta: boolean;
  aoFechar: () => void;
  titulo: string;
  gatilho: RefObject<HTMLButtonElement | null>;
  /** "menu" só com itens; "dialog" com busca, caixa de marcar ou campo. */
  papel?: "menu" | "dialog";
  alinhar?: "inicio" | "fim";
  /** A largura do menu (w-[...]); a folha vai na largura toda. */
  largura?: string;
  alturaPelaTela?: boolean;
  voltar?: VoltarMenu;
  aviso?: React.ReactNode;
  topo?: React.ReactNode;
  pe?: React.ReactNode;
  acaoFolha?: React.ReactNode;
  rodapeFolha?: React.ReactNode;
  children: React.ReactNode;
}) {
  if (!menu) {
    return (
      <Folha
        aberta={aberta}
        aoFechar={aoFechar}
        titulo={titulo}
        retorno={gatilho}
        acao={acaoFolha}
        rodape={rodapeFolha}
      >
        {voltar ? (
          <div className="pb-1">
            <BotaoVoltar menu={false} voltar={voltar} />
          </div>
        ) : null}
        {aviso ? (
          <p className="tipo-nota px-1.5 pb-0.5 text-texto-2">{aviso}</p>
        ) : null}
        {topo ? <div className="pt-1 pb-0.5">{topo}</div> : null}
        {children}
      </Folha>
    );
  }
  return (
    <MenuSuspenso
      aberto={aberta}
      aoFechar={aoFechar}
      gatilho={gatilho}
      rotulo={titulo}
      papel={papel}
      alinhar={alinhar}
      className={cn(
        largura,
        alturaPelaTela &&
          "max-h-[min(480px,var(--espaco-menu,440px))]",
      )}
    >
      {voltar ? (
        // Três colunas: o voltar à esquerda e o nome no meio do menu.
        <div className="-mx-0.5 mb-0.5 grid shrink-0 grid-cols-[1fr_auto_1fr] items-center gap-1 border-b border-fio px-0.5 pb-0.5">
          <BotaoVoltar
            menu
            voltar={voltar}
            papel={papel === "menu" ? "menuitem" : undefined}
          />
          {/* O menu já se chama assim para o leitor de tela (aria-label). */}
          <p aria-hidden className="tipo-nota truncate font-semibold text-tinta">
            {titulo}
          </p>
          <span aria-hidden />
        </div>
      ) : null}
      {aviso ? (
        <p className="tipo-nota shrink-0 px-1 pt-0.5 pb-1 text-texto-2">
          {aviso}
        </p>
      ) : null}
      {topo ? <div className="shrink-0 pb-0.5">{topo}</div> : null}
      <div className="-mx-0.5 min-h-0 flex-1 overflow-y-auto overscroll-contain px-0.5">
        {children}
      </div>
      {pe ? (
        <div className="-mx-0.5 -mb-0.5 mt-0.5 shrink-0 border-t border-fio p-0.5">
          {pe}
        </div>
      ) : null}
    </MenuSuspenso>
  );
}

/**
 * Quanto cabe entre o pé do botão e o pé da área visível, gravado na
 * variável --espaco-menu da caixa do botão (o menu herda). 6px de vão até o
 * menu e 16px de folga embaixo. Mede de novo a cada render com o menu
 * aberto e quando a área visível muda (o teclado do iPad sobe com a busca
 * do menu): medido só na abertura, o max-h ficava velho.
 */
function medirEspaco(caixa: HTMLElement | null) {
  if (!caixa) return;
  const vv = window.visualViewport;
  const fundoDaTela = vv ? vv.height + vv.offsetTop : window.innerHeight;
  const espaco = Math.floor(
    fundoDaTela - caixa.getBoundingClientRect().bottom - 6 - 16,
  );
  caixa.style.setProperty("--espaco-menu", `${Math.max(espaco, 160)}px`);
}

/* ── A pílula de cada filtro ──────────────────────────────────────────── */

/**
 * Ligado: o valor na tinta, com ▾ e o X que tira o filtro. São dois botões
 * numa pílula só (botão dentro de botão é HTML inválido); o X some com a
 * pílula e passa o foco antes à vizinha (ou ao funil). ↓ também abre o
 * menu. Desligado (só com o menu aberto, o filtro esvaziado lá
 * dentro): o nome do filtro com ▾, só com o fio.
 *
 * `escondida`: a pílula fica montada, sem aparecer, com o filtro desligado.
 * A folha do celular desce à vista depois de fechar (ela mora aqui), e a
 * pílula volta com o menu sem perder o lugar.
 */
function BotaoFiltro({
  nome,
  valor,
  rotulo,
  escondida,
  aberto,
  aoAlternar,
  aoLimpar,
  botaoRef,
  popup,
  children,
}: {
  nome: string;
  /** O que o filtro tem agora; null desligado. */
  valor: string | null;
  /** O nome para o leitor de tela, quando "nome: valor" não serve
   *  ("Com todas as etiquetas: VIP, Frio"). */
  rotulo?: string | null;
  escondida: boolean;
  aberto: boolean;
  aoAlternar: () => void;
  aoLimpar: () => void;
  botaoRef: RefObject<HTMLButtonElement | null>;
  popup: "menu" | "dialog";
  /** O menu (ou a folha) do filtro. */
  children: React.ReactNode;
}) {
  const caixaRef = useRef<HTMLDivElement>(null);
  const ativo = valor !== null;
  // "Campanha: Black Friday" já diz o nome do filtro; o leitor de tela não
  // ouve "Campanha" duas vezes.
  const nomeAcessivel =
    valor === null
      ? undefined
      : (rotulo ?? (valor.startsWith(nome) ? valor : `${nome}: ${valor}`));

  // Com o menu aberto, a pílula não troca de lugar: o menu mora dentro
  // dela. Marcar um nome em Atendentes alargava a pílula, ela descia para a
  // linha de baixo levando o menu junto, e o próximo clique caía sobre
  // outra pessoa. Na abertura, a largura de agora vira o mínimo (desmarcar
  // não a faz subir de linha) e o que sobra até o fim da linha vira o
  // máximo (marcar não a faz descer); o valor que não cabe corta dentro
  // dela. Solta ao fechar.
  useLayoutEffect(() => {
    const caixa = caixaRef.current;
    if (!aberto || !caixa) return;
    const largura = caixa.offsetWidth;
    const barra = caixa.parentElement;
    const ateOFim = barra
      ? Math.floor(
          barra.getBoundingClientRect().right -
            caixa.getBoundingClientRect().left,
        )
      : largura;
    caixa.style.minWidth = `${largura}px`;
    caixa.style.maxWidth = `${Math.max(largura, ateOFim)}px`;
    const medir = () => medirEspaco(caixa);
    const vv = window.visualViewport;
    vv?.addEventListener("resize", medir);
    window.addEventListener("resize", medir);
    return () => {
      caixa.style.minWidth = "";
      caixa.style.maxWidth = "";
      vv?.removeEventListener("resize", medir);
      window.removeEventListener("resize", medir);
    };
  }, [aberto]);

  // O espaço até o pé da janela, antes de pintar: na abertura e em todo
  // render com o menu aberto (o filtro mudou, a barra ganhou linha).
  useLayoutEffect(() => {
    if (aberto) medirEspaco(caixaRef.current);
  });

  // Na pílula ligada (fundo na tinta) o anel do foco vai por dentro, no
  // tom do fundo: por fora, na tinta, ele sumia no lado que encosta.
  const foco = ativo
    ? "focus-visible:outline-2 focus-visible:-outline-offset-2 focus-visible:outline-fundo"
    : "focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-tinta";
  return (
    <div
      ref={caixaRef}
      data-pilula=""
      className={cn("relative min-w-0 max-w-full", escondida && "hidden")}
    >
      <div
        className={cn(
          // O toque encolhe a pílula inteira, não só o lado tocado.
          "flex h-[32px] max-w-full items-stretch rounded-chip border transition-[background-color,border-color,color,scale] duration-[120ms] motion-safe:has-[button:active]:scale-[.97]",
          ativo
            ? "border-tinta bg-tinta text-fundo"
            : "border-fio-forte bg-transparent text-tinta",
        )}
      >
        <button
          ref={botaoRef}
          type="button"
          aria-haspopup={popup}
          aria-expanded={aberto}
          aria-label={nomeAcessivel}
          title={nomeAcessivel}
          onClick={aoAlternar}
          onKeyDown={(e) => {
            if (e.key === "ArrowDown" && !aberto) {
              e.preventDefault();
              aoAlternar();
            }
          }}
          // grow: com a largura presa e o valor mais curto, o X fica na
          // ponta da pílula e a sobra vai para o lado do nome.
          className={cn(
            "relative inline-flex min-w-0 grow items-center gap-0.5 rounded-chip pl-1 text-sm whitespace-nowrap select-none transition-colors duration-[120ms]",
            "pointer-coarse:after:absolute pointer-coarse:after:inset-x-0 pointer-coarse:after:-inset-y-[7px]",
            foco,
            ativo
              ? "pr-0.5 hover:bg-tinta-hover"
              : "pr-1 hover:bg-realce active:bg-pressionado",
          )}
        >
          {/* 160px: "Campanha: Black Fr…" e "Não lidas" cabem na mesma
              linha da fila de 360px. */}
          <span className="max-w-[160px] min-w-0 truncate">
            {valor ?? nome}
          </span>
          <ChevronDown
            size={14}
            strokeWidth={2}
            aria-hidden
            className={cn(
              "shrink-0 motion-safe:transition-transform motion-safe:duration-[150ms]",
              ativo ? "text-fundo" : "text-texto-2",
              aberto && "rotate-180",
            )}
          />
        </button>
        {ativo ? (
          <button
            type="button"
            aria-label={`Tirar o filtro: ${nome}`}
            title={`Tirar o filtro: ${nome}`}
            onClick={(e) => {
              // O X some com a pílula: o foco passa antes à vizinha.
              focarVizinha(e.currentTarget);
              aoLimpar();
            }}
            // No toque, 32px de desenho e 6px de área estendida para cada
            // lado: 44×44. Com 28px dava 40 de largura, e quem mirava o X
            // abria a folha do filtro.
            className={cn(
              "relative inline-flex w-[28px] shrink-0 items-center justify-center rounded-chip transition-colors duration-[120ms] hover:bg-tinta-hover pointer-coarse:w-[32px]",
              "pointer-coarse:after:absolute pointer-coarse:after:-inset-x-[6px] pointer-coarse:after:-inset-y-[7px]",
              foco,
            )}
          >
            <X size={14} strokeWidth={2} aria-hidden />
          </button>
        ) : null}
      </div>
      {children}
    </div>
  );
}

/* ── O que vai em cada menu ───────────────────────────────────────────── */

type BaseMenu = {
  menu: boolean;
  aberta: boolean;
  aoFechar: () => void;
  gatilho: RefObject<HTMLButtonElement | null>;
  filtros: FiltrosFila;
  aoMudar: (mudanca: Partial<FiltrosFila>) => void;
  /** Aberto pelo funil: o "‹ Filtros" no topo volta à lista. */
  voltar?: VoltarMenu;
  /** O lado do gatilho em que o menu se alinha (padrão: o início). */
  alinhar?: "inicio" | "fim";
};

/** "Limpar" no pé do menu (desktop) ou ao lado do título da folha. */
function limparDoFiltro(
  menu: boolean,
  papelItem: "menuitem" | "button",
  aoLimpar: (alvo: HTMLElement) => void,
): { pe: React.ReactNode; acaoFolha: React.ReactNode } {
  return menu
    ? {
        pe: (
          <ItemAcao
            variante="menu"
            papel={papelItem}
            onClick={(e) => aoLimpar(e.currentTarget)}
          >
            Limpar
          </ItemAcao>
        ),
        acaoFolha: null,
      }
    : {
        pe: null,
        acaoFolha: (
          <Button
            variant="ghost"
            size="sm"
            onClick={(e) => aoLimpar(e.currentTarget)}
          >
            Limpar
          </Button>
        ),
      };
}

/**
 * Depois de uma escolha que conclui o menu (um atalho do período, o Aplicar
 * das datas, uma campanha): aberto pelo funil, volta à lista "Filtrar por",
 * para somar outro filtro sem abrir o funil de novo; aberto pela pílula,
 * fecha.
 */
function concluirDe({ voltar, aoFechar }: BaseMenu): () => void {
  return voltar ? voltar.aoVoltar : aoFechar;
}

/**
 * "Ver 12 conversas": fecha os filtros sobre a fila como ficou. No pé das
 * escolhas múltiplas (Etiquetas, Atendentes) e da lista do funil. Entra nas
 * setas do menu (data-item).
 */
function BotaoResultado({
  menu,
  rotulo,
  aoVer,
}: {
  menu: boolean;
  rotulo: string;
  aoVer: () => void;
}) {
  return (
    <Button
      data-item=""
      size={menu ? "sm" : "md"}
      className={cn(
        "pointer-coarse:h-[44px]",
        menu ? "min-w-0 flex-1" : "w-full",
      )}
      onClick={aoVer}
    >
      <span className="truncate">{rotulo}</span>
    </Button>
  );
}

/**
 * O pé de quem combina várias escolhas: no menu, "Limpar" (com algo
 * escolhido) e "Ver N conversas" lado a lado; na folha, o "Limpar" vai ao
 * lado do título e o "Ver N conversas" fica no pé, fora da rolagem.
 */
function peComResultado({
  menu,
  ativo,
  aoLimpar,
  rotuloResultado,
  aoVer,
}: {
  menu: boolean;
  ativo: boolean;
  aoLimpar: (alvo: HTMLElement) => void;
  rotuloResultado: string;
  aoVer: () => void;
}): { pe: React.ReactNode; acaoFolha: React.ReactNode; rodapeFolha: React.ReactNode } {
  const limpar = (tamanho: "sm" | "md") => (
    <Button
      data-item=""
      variant="ghost"
      size={tamanho}
      className={cn("shrink-0 px-1", tamanho === "sm" && "pointer-coarse:h-[44px]")}
      onClick={(e) => aoLimpar(e.currentTarget)}
    >
      Limpar
    </Button>
  );
  return menu
    ? {
        pe: (
          <div className="flex items-center gap-1 pointer-coarse:gap-1.5">
            {ativo ? limpar("sm") : null}
            <BotaoResultado menu rotulo={rotuloResultado} aoVer={aoVer} />
          </div>
        ),
        acaoFolha: null,
        rodapeFolha: null,
      }
    : {
        pe: null,
        acaoFolha: ativo ? limpar("sm") : null,
        rodapeFolha: (
          <BotaoResultado menu={false} rotulo={rotuloResultado} aoVer={aoVer} />
        ),
      };
}

/**
 * Hoje, Últimos 7 dias, Últimos 30 dias e, à vista no mesmo menu, De e Até
 * com o Aplicar. O atalho aplica e conclui (pela pílula fecha; pelo funil
 * volta à lista). As datas nascem do filtro de agora
 * (vindo de um atalho, as datas dele, para ajustar) e só valem no Aplicar
 * (ou Enter num dos campos): o ano pela metade não recarrega a fila.
 */
function FiltroPeriodo(base: BaseMenu) {
  const { menu, aberta, aoFechar, gatilho, filtros, aoMudar, voltar, alinhar } =
    base;
  const concluir = concluirDe(base);
  const variante = menu ? "menu" : "folha";
  const hoje = hojeEmBrasilia();
  const atalho = ATALHOS.find((a) => a.valor === filtros.de) ?? null;
  const [rascunho, setRascunho] = useState(() =>
    atalho
      ? { de: somarDiasFila(hoje, -atalho.dias), ate: hoje }
      : {
          de: ehDataFila(filtros.de) ? filtros.de : "",
          ate: ehDataFila(filtros.ate) ? filtros.ate : "",
        },
  );
  // Data fora do aceito só acusa no Aplicar: acusar enquanto se digita o
  // ano piscaria o aviso a cada tecla.
  const [errosEnvio, setErrosEnvio] = useState<{ de: boolean; ate: boolean }>(
    { de: false, ate: false },
  );
  const idDe = useId();
  const idAte = useId();
  const idErro = useId();
  const deRef = useRef<HTMLInputElement>(null);
  const ateRef = useRef<HTMLInputElement>(null);

  const de = dataPronta(rascunho.de) ? rascunho.de : "";
  const ate = dataPronta(rascunho.ate) ? rascunho.ate : "";
  const invertidas = de !== "" && ate !== "" && de > ate;
  const algumaEscrita = rascunho.de !== "" || rascunho.ate !== "";
  const dataRuim = errosEnvio.de || errosEnvio.ate;
  const ativo = Boolean(filtros.de || filtros.ate);

  const mudarData = (ponta: "de" | "ate", valor: string) => {
    setRascunho((r) => ({ ...r, [ponta]: valor }));
    setErrosEnvio((e) => ({ ...e, [ponta]: false }));
  };

  const aplicar = (e: React.FormEvent) => {
    e.preventDefault();
    // O campo pela metade (só o dia, no Chrome) tem value "" e badInput.
    // Sem olhar o badInput, De inteiro com Até pela metade aplicava só
    // "Desde 01/10" e o Até digitado sumia calado.
    const ruins = {
      de:
        Boolean(deRef.current?.validity.badInput) ||
        (rascunho.de !== "" && !dataPronta(rascunho.de)),
      ate:
        Boolean(ateRef.current?.validity.badInput) ||
        (rascunho.ate !== "" && !dataPronta(rascunho.ate)),
    };
    if (ruins.de || ruins.ate) {
      setErrosEnvio(ruins);
      return;
    }
    if (invertidas || (de === "" && ate === "")) return;
    if (de !== filtros.de || ate !== filtros.ate) aoMudar({ de, ate });
    concluir();
  };

  // As setas são do campo de data (trocam o dia), não do menu.
  const teclaNaData = (e: React.KeyboardEvent<HTMLInputElement>) => {
    if (
      e.key === "ArrowUp" ||
      e.key === "ArrowDown" ||
      e.key === "Home" ||
      e.key === "End"
    ) {
      e.stopPropagation();
    }
  };

  const campoData = cn(
    CAMPO,
    // O campo de data do iOS ignora a largura recebida (kit, bloco 8).
    "mt-0.5 w-full min-w-0 appearance-none px-1 text-left tabular-nums",
  );
  const limpar = limparDoFiltro(menu, "button", () => {
    aoMudar({ de: "", ate: "" });
    concluir();
  });

  return (
    <PainelEscolha
      menu={menu}
      aberta={aberta}
      aoFechar={aoFechar}
      titulo="Período"
      gatilho={gatilho}
      voltar={voltar}
      alinhar={alinhar}
      // 340px: o campo de data do navegador precisa de uns 150px para
      // mostrar "dd/mm/aaaa" e o ícone sem cortar.
      largura="w-[340px]"
      alturaPelaTela
      pe={ativo ? limpar.pe : null}
      acaoFolha={ativo ? limpar.acaoFolha : null}
    >
      <ItensSecao menu={menu}>
        {ATALHOS.map((a) => (
          <ItemSecao key={a.valor} menu={menu}>
            <ItemAcao
              variante={variante}
              papel="button"
              marcado={filtros.de === a.valor}
              aria-pressed={filtros.de === a.valor}
              onClick={() => {
                if (filtros.de !== a.valor) aoMudar({ de: a.valor, ate: "" });
                concluir();
              }}
            >
              {a.rotulo}
            </ItemAcao>
          </ItemSecao>
        ))}
      </ItensSecao>

      <TituloSecao menu={menu}>Escolher datas</TituloSecao>
      <form
        noValidate
        onSubmit={aplicar}
        className={cn("pb-1", menu && "px-1")}
      >
        <div className="grid grid-cols-2 gap-1">
          <div className="min-w-0">
            <label htmlFor={idDe} className={ROTULO}>
              De
            </label>
            <input
              ref={deRef}
              id={idDe}
              type="date"
              value={rascunho.de}
              min={DATA_MINIMA}
              max={dataPronta(rascunho.ate) ? rascunho.ate : hoje}
              aria-invalid={invertidas || errosEnvio.de || undefined}
              aria-describedby={
                invertidas || errosEnvio.de ? idErro : undefined
              }
              onChange={(e) => mudarData("de", e.target.value)}
              onKeyDown={teclaNaData}
              className={campoData}
            />
          </div>
          <div className="min-w-0">
            <label htmlFor={idAte} className={ROTULO}>
              Até
            </label>
            <input
              ref={ateRef}
              id={idAte}
              type="date"
              value={rascunho.ate}
              min={dataPronta(rascunho.de) ? rascunho.de : DATA_MINIMA}
              max={hoje}
              aria-invalid={invertidas || errosEnvio.ate || undefined}
              aria-describedby={
                invertidas || errosEnvio.ate ? idErro : undefined
              }
              onChange={(e) => mudarData("ate", e.target.value)}
              onKeyDown={teclaNaData}
              className={campoData}
            />
          </div>
        </div>
        {invertidas || dataRuim ? (
          <p id={idErro} role="alert" className={cn(ERRO_CAMPO, "mt-0.5")}>
            {invertidas
              ? "A data inicial passa da final."
              : "Confira a data: dia, mês e ano a partir de 2000."}
          </p>
        ) : null}
        <Button
          type="submit"
          className="mt-1 w-full pointer-coarse:h-[44px]"
          disabled={!algumaEscrita || invertidas}
        >
          Aplicar
        </Button>
      </form>
    </PainelEscolha>
  );
}

/** O id do item "Sem etiqueta" na lista do menu (não é uuid: nunca colide
 *  com uma etiqueta). */
const SEM_ETIQUETA = "sem-etiqueta";

const MODOS_ETIQUETAS: OpcaoSegmentada<ModoEtiquetas>[] = [
  { valor: "qualquer", rotulo: "Qualquer uma" },
  { valor: "todas", rotulo: "Todas" },
];

/**
 * Setas e Home/End dentro do segmentado são dele (trocam a opção): sem isto
 * o menu em volta as tomava para andar entre os itens.
 */
function prenderSetas(e: React.KeyboardEvent<HTMLElement>) {
  if (
    e.key === "ArrowUp" ||
    e.key === "ArrowDown" ||
    e.key === "ArrowLeft" ||
    e.key === "ArrowRight" ||
    e.key === "Home" ||
    e.key === "End"
  ) {
    e.stopPropagation();
  }
}

/**
 * As etiquetas, com caixas de marcar. No topo, o segmentado "Qualquer uma ·
 * Todas" (como as marcadas se somam; o aviso embaixo diz em palavras) e, no
 * começo da lista, "Sem etiqueta", que exclui as outras: marcá-lo desmarca
 * as etiquetas, e marcar uma etiqueta o desmarca. É o mesmo contrato do
 * filtro de Contatos (nomes, textos e URL). Entram as ativas e a arquivada
 * que já estava no filtro ao abrir (senão não haveria como tirá-la); ela
 * fica até o menu fechar, para o toque que a desmarca não deixar o foco no
 * body. O menu fica aberto para combinar, e o "Ver N conversas" do pé fecha
 * sobre a fila.
 */
function FiltroEtiquetas({
  menu,
  aberta,
  aoFechar,
  gatilho,
  filtros,
  aoMudar,
  voltar,
  alinhar,
  etiquetas,
  rotuloResultado,
}: BaseMenu & {
  /** O catálogo inteiro; null = a leitura falhou. */
  etiquetas: EtiquetaCatalogo[] | null;
  rotuloResultado: string;
}) {
  const [arquivadasNoFiltro] = useState(() => new Set(filtros.etiquetas));
  const [termo, setTermo] = useState("");
  const naLista = (etiquetas ?? []).filter(
    (t) => t.ativo || arquivadasNoFiltro.has(t.id),
  );
  // "Sem etiqueta" encabeça a lista e passa pela mesma busca.
  const itens = [
    { id: SEM_ETIQUETA, nome: "Sem etiqueta", cor: null, ativo: true },
    ...naLista,
  ];
  const visiveis = filtrarPorNome(itens, termo);
  const cheias = filtros.etiquetas.length >= MAX_IDS_FILTRO_FILA;
  const ativo = filtros.etiquetas.length > 0 || filtros.semEtiqueta;
  const pe = peComResultado({
    menu,
    ativo,
    aoLimpar: (alvo) => {
      focarPainel(alvo);
      aoMudar(DESLIGAR.etiquetas);
    },
    rotuloResultado,
    aoVer: aoFechar,
  });
  // O contrato de Contatos: "Todas" só quer dizer algo com duas etiquetas
  // para marcar; escolhido num link guardado, fica à vista para poder
  // voltar. Sem etiqueta cadastrada, o menu só diz isso. Com "Sem
  // etiqueta" ligado o modo não muda nada e fica parado.
  const comModo =
    naLista.length > 0 &&
    (naLista.length > 1 || filtros.etiquetasModo === "todas");
  const comBusca = naLista.length > 0 && itens.length > ITENS_SEM_BUSCA;
  const frase = filtros.semEtiqueta
    ? "Entra só a conversa sem etiqueta nenhuma."
    : filtros.etiquetas.length === 0
      ? "Nenhuma marcada: a fila não filtra por etiqueta."
      : filtros.etiquetasModo === "todas"
        ? "Entra só a conversa com todas as marcadas."
        : "Entra a conversa com qualquer uma das marcadas.";

  return (
    <PainelEscolha
      menu={menu}
      aberta={aberta}
      aoFechar={aoFechar}
      titulo="Etiquetas"
      gatilho={gatilho}
      voltar={voltar}
      alinhar={alinhar}
      alturaPelaTela
      // O segmentado vem no alto do menu; a frase embaixo dele diz em
      // palavras o que entra na fila.
      topo={
        comModo || comBusca ? (
          <div className="flex flex-col gap-1">
            {comModo ? (
              <>
                <div onKeyDown={prenderSetas}>
                  <Segmentado<ModoEtiquetas>
                    rotulo="Como as etiquetas marcadas se somam"
                    valor={filtros.etiquetasModo}
                    onMudar={(modo) => {
                      if (modo !== filtros.etiquetasModo) {
                        aoMudar({ etiquetasModo: modo });
                      }
                    }}
                    larguraTotal
                    opcoes={MODOS_ETIQUETAS.map((o) => ({
                      ...o,
                      desativada: filtros.semEtiqueta,
                    }))}
                  />
                </div>
                <p
                  className={cn(
                    "tipo-nota text-texto-2",
                    menu ? "px-1" : "px-1.5",
                  )}
                >
                  {frase}
                </p>
              </>
            ) : null}
            {comBusca ? (
              <CampoBuscaMenu
                valor={termo}
                aoMudar={setTermo}
                rotulo="Buscar etiqueta"
                placeholder="Buscar etiqueta"
              />
            ) : null}
          </div>
        ) : null
      }
      pe={pe.pe}
      acaoFolha={pe.acaoFolha}
      rodapeFolha={pe.rodapeFolha}
    >
      {etiquetas === null ? (
        <MensagemMenu menu={menu} erro>
          Não deu para carregar as etiquetas.
        </MensagemMenu>
      ) : naLista.length === 0 ? (
        <MensagemMenu menu={menu}>Nenhuma etiqueta cadastrada.</MensagemMenu>
      ) : visiveis.length === 0 ? (
        <MensagemMenu menu={menu}>
          Nenhuma etiqueta com “{termo.trim()}”.
        </MensagemMenu>
      ) : (
        <>
          <ItensSecao menu={menu}>
            {visiveis.map((t) => {
              if (t.id === SEM_ETIQUETA) {
                return (
                  <ItemSecao key={t.id} menu={menu}>
                    <ItemMarcavel
                      menu={menu}
                      estado={filtros.semEtiqueta}
                      onClick={() =>
                        aoMudar({
                          semEtiqueta: !filtros.semEtiqueta,
                          etiquetas: [],
                        })
                      }
                    >
                      {t.nome}
                    </ItemMarcavel>
                  </ItemSecao>
                );
              }
              const marcada = filtros.etiquetas.includes(t.id);
              return (
                <ItemSecao key={t.id} menu={menu}>
                  <ItemMarcavel
                    menu={menu}
                    estado={marcada}
                    disabled={cheias && !marcada}
                    ponto={pontoDaEtiqueta(t.cor)}
                    detalhe={t.ativo ? undefined : "Arquivada"}
                    onClick={() =>
                      aoMudar({
                        etiquetas: marcada
                          ? filtros.etiquetas.filter((x) => x !== t.id)
                          : [...filtros.etiquetas, t.id],
                        semEtiqueta: false,
                      })
                    }
                  >
                    {t.nome}
                  </ItemMarcavel>
                </ItemSecao>
              );
            })}
          </ItensSecao>
          <AvisoDoTeto menu={menu}>
            {cheias
              ? `Até ${MAX_IDS_FILTRO_FILA.toLocaleString("pt-BR")} etiquetas no filtro. Desmarque uma para escolher outra.`
              : ""}
          </AvisoDoTeto>
        </>
      )}
    </PainelEscolha>
  );
}

/** A coluna à direita dos itens (as conversas abertas de cada pessoa). */
function CabecalhoColuna({
  menu,
  children,
}: {
  menu: boolean;
  children: React.ReactNode;
}) {
  return (
    <div
      className={cn(
        "tipo-nota flex min-h-[24px] items-center justify-end text-texto-2",
        menu ? "px-1" : "px-1.5 pt-0.5",
      )}
    >
      {children}
    </div>
  );
}

/**
 * "Sem dono" no topo e a equipe embaixo, com caixas de marcar. Na gestão,
 * as conversas abertas de cada pessoa à direita (a carga, relida a cada
 * minuto com o menu aberto). Escolher atendentes é um recorte de "Todas":
 * quem chama já troca o escopo, e o topo do menu avisa antes, quando a fila
 * está em "Minhas" ou em "Sem dono".
 */
function FiltroAtendentes({
  menu,
  aberta,
  aoFechar,
  gatilho,
  filtros,
  aoMudar,
  voltar,
  alinhar,
  equipe,
  carga,
  aoLerCarga,
  rotuloResultado,
}: BaseMenu & {
  /** A equipe do filtro (sem o dono oculto); null = a leitura falhou. */
  equipe: MembroEquipe[] | null;
  carga: EstadoCarga;
  aoLerCarga: () => void;
  rotuloResultado: string;
}) {
  const [termo, setTermo] = useState("");
  const listaRef = useRef<HTMLDivElement>(null);

  // O aviso do erro sai quando a carga relê (no intervalo, ou numa leitura
  // que outra tela pediu). Se o foco estava nele, caiu no body junto: volta
  // ao painel.
  const tipoAntesRef = useRef(carga.tipo);
  useLayoutEffect(() => {
    const antes = tipoAntesRef.current;
    tipoAntesRef.current = carga.tipo;
    if (antes !== "erro" || carga.tipo === "erro") return;
    const focado = document.activeElement;
    if (focado && focado !== document.body && focado.isConnected) return;
    focarPainel(listaRef.current);
  }, [carga.tipo]);

  const pessoas = [{ id: SEM_DONO, nome: "Sem dono" }, ...(equipe ?? [])];
  const visiveis = filtrarPorNome(pessoas, termo);
  const cheios = filtros.atendentes.length >= MAX_IDS_FILTRO_FILA;
  const ativo = filtros.atendentes.length > 0;
  const porPessoa =
    carga.tipo === "pronta"
      ? new Map(carga.equipe.map((p) => [p.id, p]))
      : null;
  const coluna =
    carga.tipo === "pronta" ? (
      "Abertas"
    ) : carga.tipo === "lendo" ? (
      <Spinner tamanho={14} rotulo="Lendo a carga da equipe" />
    ) : null;
  const pe = peComResultado({
    menu,
    ativo,
    aoLimpar: (alvo) => {
      focarPainel(alvo);
      aoMudar({ atendentes: [] });
    },
    rotuloResultado,
    aoVer: aoFechar,
  });
  // Marcar alguém leva a fila para "Todas" (mudarFiltros, no chat): o aviso
  // vem antes do toque, enquanto ninguém está marcado.
  const trocaEscopo =
    !ativo && filtros.escopo !== "todas"
      ? ` Marcar alguém troca ${filtros.escopo === "minhas" ? "Minhas" : "Sem dono"} por Todas.`
      : "";

  return (
    <PainelEscolha
      menu={menu}
      aberta={aberta}
      aoFechar={aoFechar}
      titulo="Atendentes"
      gatilho={gatilho}
      voltar={voltar}
      alinhar={alinhar}
      alturaPelaTela
      aviso={`Entra a conversa de qualquer uma das pessoas marcadas.${trocaEscopo}`}
      topo={
        pessoas.length > ITENS_SEM_BUSCA ? (
          <CampoBuscaMenu
            valor={termo}
            aoMudar={setTermo}
            rotulo="Buscar pessoa"
            placeholder="Buscar pessoa"
          />
        ) : null
      }
      pe={pe.pe}
      acaoFolha={pe.acaoFolha}
      rodapeFolha={pe.rodapeFolha}
    >
      <div ref={listaRef}>
        {coluna && visiveis.length > 0 ? (
          <CabecalhoColuna menu={menu}>{coluna}</CabecalhoColuna>
        ) : null}
        {carga.tipo === "erro" ? (
          <ItensSecao menu={menu}>
            <ItemSecao menu={menu}>
              <ItemAcao
                variante={menu ? "menu" : "folha"}
                papel="button"
                // A frase do servidor que já manda tentar de novo não
                // ganha o detalhe repetido ao lado.
                detalhe={
                  /de novo\.?$/i.test(carga.texto) ? undefined : "Tentar de novo"
                }
                onClick={(e) => {
                  // O aviso sai enquanto relê: o foco passa ao painel
                  // antes, para não cair no body.
                  focarPainel(e.currentTarget);
                  aoLerCarga();
                }}
              >
                <span className="text-erro">{carga.texto}</span>
              </ItemAcao>
            </ItemSecao>
          </ItensSecao>
        ) : null}
        {visiveis.length === 0 ? (
          <MensagemMenu menu={menu}>
            Ninguém com “{termo.trim()}”.
          </MensagemMenu>
        ) : (
          <ItensSecao menu={menu}>
            {visiveis.map((p) => {
              const daPessoa =
                p.id !== SEM_DONO ? porPessoa?.get(p.id) : undefined;
              const marcado = filtros.atendentes.includes(p.id);
              return (
                <ItemSecao key={p.id} menu={menu}>
                  <ItemMarcavel
                    menu={menu}
                    estado={marcado}
                    disabled={cheios && !marcado}
                    icone={
                      <IconeDaPessoa
                        id={p.id === SEM_DONO ? null : p.id}
                        nome={p.nome}
                      />
                    }
                    title={
                      daPessoa && !daPessoa.noRodizio
                        ? "Fora do rodízio"
                        : undefined
                    }
                    detalhe={
                      daPessoa ? (
                        <>
                          {daPessoa.abertas.toLocaleString("pt-BR")}
                          <span className="sr-only">
                            {daPessoa.abertas === 1 ? " aberta" : " abertas"}
                          </span>
                        </>
                      ) : undefined
                    }
                    onClick={() =>
                      aoMudar({
                        atendentes: marcado
                          ? filtros.atendentes.filter((x) => x !== p.id)
                          : [...filtros.atendentes, p.id],
                      })
                    }
                  >
                    {p.nome}
                  </ItemMarcavel>
                </ItemSecao>
              );
            })}
          </ItensSecao>
        )}
        {equipe === null ? (
          <MensagemMenu menu={menu} erro>
            Não deu para carregar a equipe.
          </MensagemMenu>
        ) : null}
        <AvisoDoTeto menu={menu}>
          {cheios
            ? `Até ${MAX_IDS_FILTRO_FILA.toLocaleString("pt-BR")} atendentes no filtro. Desmarque um para escolher outro.`
            : ""}
        </AvisoDoTeto>
      </div>
    </PainelEscolha>
  );
}

/** WhatsApp ou Direct, pela pílula (no funil, o canal são dois chips na
 *  própria lista): escolher aplica e fecha. */
function FiltroCanal(base: BaseMenu) {
  const { menu, aberta, aoFechar, gatilho, filtros, aoMudar, voltar, alinhar } =
    base;
  const concluir = concluirDe(base);
  const limpar = limparDoFiltro(menu, "menuitem", () => {
    aoMudar({ canal: "" });
    concluir();
  });
  const opcoes = [
    { valor: "whatsapp", rotulo: "WhatsApp" },
    { valor: "direct", rotulo: "Direct" },
  ] as const;
  return (
    <PainelEscolha
      menu={menu}
      aberta={aberta}
      aoFechar={aoFechar}
      titulo="Canal"
      gatilho={gatilho}
      voltar={voltar}
      alinhar={alinhar}
      papel="menu"
      largura="w-[220px]"
      pe={filtros.canal ? limpar.pe : null}
      acaoFolha={filtros.canal ? limpar.acaoFolha : null}
    >
      <ItensSecao menu={menu}>
        {opcoes.map((o) => (
          <ItemSecao key={o.valor} menu={menu}>
            <ItemAcao
              variante={menu ? "menu" : "folha"}
              papel="menuitemradio"
              marcado={filtros.canal === o.valor}
              onClick={() => {
                if (filtros.canal !== o.valor) aoMudar({ canal: o.valor });
                concluir();
              }}
            >
              {o.rotulo}
            </ItemAcao>
          </ItemSecao>
        ))}
      </ItensSecao>
    </PainelEscolha>
  );
}

/** Quem recebeu a campanha, da mais recente para trás, com o status ao
 *  lado. Escolher aplica e conclui: pela pílula fecha; pelo funil volta à
 *  lista, para somar outro filtro. */
function FiltroCampanha({
  campanhas,
  ...base
}: BaseMenu & {
  /** null = a leitura falhou. */
  campanhas: CampanhaDaFila[] | null;
}) {
  const { menu, aberta, aoFechar, gatilho, filtros, aoMudar, voltar, alinhar } =
    base;
  const concluir = concluirDe(base);
  const [termo, setTermo] = useState("");
  const visiveis = filtrarPorNome(campanhas ?? [], termo);
  const limpar = limparDoFiltro(menu, "button", () => {
    aoMudar({ campanhaId: "" });
    concluir();
  });
  return (
    <PainelEscolha
      menu={menu}
      aberta={aberta}
      aoFechar={aoFechar}
      titulo="Campanha"
      gatilho={gatilho}
      voltar={voltar}
      alinhar={alinhar}
      largura="w-[300px]"
      alturaPelaTela
      topo={
        campanhas && campanhas.length > ITENS_SEM_BUSCA ? (
          <CampoBuscaMenu
            valor={termo}
            aoMudar={setTermo}
            rotulo="Buscar campanha"
            placeholder="Buscar campanha"
          />
        ) : null
      }
      pe={filtros.campanhaId ? limpar.pe : null}
      acaoFolha={filtros.campanhaId ? limpar.acaoFolha : null}
    >
      {campanhas === null ? (
        <MensagemMenu menu={menu} erro>
          Não deu para carregar as campanhas.
        </MensagemMenu>
      ) : campanhas.length === 0 ? (
        <MensagemMenu menu={menu}>Nenhuma campanha ainda.</MensagemMenu>
      ) : visiveis.length === 0 ? (
        <MensagemMenu menu={menu}>
          Nenhuma campanha com “{termo.trim()}”.
        </MensagemMenu>
      ) : (
        <ItensSecao menu={menu}>
          {visiveis.map((c) => {
            const escolhida = filtros.campanhaId === c.id;
            return (
              <ItemSecao key={c.id} menu={menu}>
                <ItemAcao
                  variante={menu ? "menu" : "folha"}
                  papel="button"
                  marcado={escolhida}
                  aria-pressed={escolhida}
                  detalhe={ROTULO_STATUS_CAMPANHA[c.status]}
                  onClick={() => {
                    if (!escolhida) aoMudar({ campanhaId: c.id });
                    concluir();
                  }}
                >
                  <span className="block truncate">{c.nome}</span>
                </ItemAcao>
              </ItemSecao>
            );
          })}
        </ItensSecao>
      )}
    </PainelEscolha>
  );
}

/* ── O funil e as pílulas ─────────────────────────────────────────────── */

/** O valor do período: "Últimos 7 dias", "01/10 a 07/10". */
function valorDoPeriodo(f: FiltrosFila): string | null {
  const atalho = ATALHOS.find((a) => a.valor === f.de);
  if (atalho) return atalho.rotulo;
  return rotuloDoPeriodo(f.de, f.ate) || null;
}

/** "VIP", "VIP +2": o primeiro nome e quantos mais. */
function primeiroEMais(nomes: string[]): string | null {
  if (nomes.length === 0) return null;
  return nomes.length === 1
    ? nomes[0]
    : `${nomes[0]} +${(nomes.length - 1).toLocaleString("pt-BR")}`;
}

/** Um filtro que se liga: os cinco com menu e o "Só não lidas". */
type Ligado = MenuFiltro | "naoLidas";

/** A ordem das pílulas, a mesma da lista do funil. */
const ORDEM: Ligado[] = [
  "periodo",
  "etiquetas",
  "atendentes",
  "canal",
  "campanha",
  "naoLidas",
];

/** O que o X de cada pílula manda ao chat. Tirar as etiquetas volta o modo
 *  a "Qualquer uma" e desliga o "Sem etiqueta". */
const DESLIGAR: Record<Ligado, Partial<FiltrosFila>> = {
  periodo: { de: "", ate: "" },
  etiquetas: { etiquetas: [], etiquetasModo: "qualquer", semEtiqueta: false },
  atendentes: { atendentes: [] },
  canal: { canal: "" },
  campanha: { campanhaId: "" },
  naoLidas: { naoLidas: false },
};

/**
 * Os filtros ligados agora, na ordem das pílulas. O selo do funil conta
 * estes, e não os ids de contarFiltrosFila: Etiquetas com três marcadas é
 * um filtro, uma pílula.
 */
function filtrosLigados(f: FiltrosFila): Ligado[] {
  const ligado: Record<Ligado, boolean> = {
    periodo: Boolean(f.de || f.ate),
    etiquetas: f.etiquetas.length > 0 || f.semEtiqueta,
    atendentes: f.atendentes.length > 0,
    canal: f.canal !== "",
    campanha: f.campanhaId !== "",
    naoLidas: f.naoLidas,
  };
  return ORDEM.filter((q) => ligado[q]);
}

/** As categorias da lista do funil que abrem um menu (o período e o canal
 *  são chips na própria lista). Atendentes só para quem vê a base inteira. */
const CATEGORIAS: {
  qual: "etiquetas" | "atendentes" | "campanha";
  rotulo: string;
}[] = [
  { qual: "etiquetas", rotulo: "Etiquetas" },
  { qual: "atendentes", rotulo: "Atendentes" },
  { qual: "campanha", rotulo: "Campanha" },
];

/** Os menus que o funil abre: as três categorias e o "Escolher datas". O
 *  canal, pelo funil, é chip; o menu dele só abre pela pílula. */
const MENUS_DO_FUNIL: MenuFiltro[] = [
  "periodo",
  "etiquetas",
  "atendentes",
  "campanha",
];

/** Os atalhos do período como chips na lista do funil. */
const CHIPS_PERIODO: { valor: AtalhoPeriodo; rotulo: string }[] = [
  { valor: "hoje", rotulo: "Hoje" },
  { valor: "7d", rotulo: "7 dias" },
  { valor: "30d", rotulo: "30 dias" },
];

const CHIPS_CANAL: { valor: CanalFila; rotulo: string }[] = [
  { valor: "whatsapp", rotulo: "WhatsApp" },
  { valor: "direct", rotulo: "Direct" },
];

const ZERADO: Record<MenuFiltro, number> = {
  periodo: 0,
  etiquetas: 0,
  atendentes: 0,
  canal: 0,
  campanha: 0,
};

/** O que o chat passa às duas metades dos filtros: o funil e as pílulas. O
 *  menu aberto mora no chat (`aberto`), que relê a carga da equipe enquanto
 *  o de Atendentes estiver aberto, venha ele do funil ou da pílula. */
export type PropsFiltros = {
  filtros: FiltrosFila;
  aberto: FiltroAberto | null;
  /** Abre a lista ou um menu; null fecha o que estiver aberto. */
  aoAbrir: (aberto: FiltroAberto | null) => void;
  /** Quem vê a base inteira filtra por atendente. */
  mostrarAtendentes: boolean;
  /** As opções de atendente (sem o dono oculto); null = não carregou. */
  equipe: MembroEquipe[] | null;
  /** A equipe inteira, para dar nome ao filtro que veio pela URL. */
  nomesEquipe: MembroEquipe[] | null;
  carga: EstadoCarga;
  /** O catálogo inteiro (ativas e arquivadas); null = não carregou. */
  etiquetas: EtiquetaCatalogo[] | null;
  /** null = não carregou. */
  campanhas: CampanhaDaFila[] | null;
  aoMudar: (mudanca: Partial<FiltrosFila>) => void;
  aoLimpar: () => void;
  /** Ler a carga de novo, depois de uma falha. Não fecha o menu. */
  aoLerCarga: () => void;
  /** O botão do funil: âncora da lista e dos menus abertos por ela, e
   *  para onde o foco vai quando a pílula que o tinha some. */
  funilRef: RefObject<HTMLButtonElement | null>;
  /** O que a fila mostra com os filtros de agora ("Ver 12 conversas",
   *  "Filtrando…"): o botão que fecha os filtros sobre ela, no pé da lista
   *  do funil e das escolhas múltiplas. */
  rotuloResultado: string;
};

/** O que basta para dar nome aos filtros ligados. */
type DadosNomes = Pick<
  PropsFiltros,
  "filtros" | "etiquetas" | "nomesEquipe" | "campanhas"
>;

/** O valor de cada filtro com menu, à direita na lista do funil; null
 *  desligado. A pílula da campanha leva o nome do filtro na frente
 *  ("Campanha: Black Friday"): o nome solto não diz o que é. A das
 *  etiquetas tem nome próprio para o leitor de tela, o mesmo de Contatos. */
function valoresDosFiltros({
  filtros,
  etiquetas,
  nomesEquipe,
  campanhas,
}: DadosNomes): Record<MenuFiltro, string | null> & {
  etiquetasNome: string | null;
  campanhaNaPilula: string | null;
} {
  const nomeCampanha = filtros.campanhaId
    ? (campanhas?.find((c) => c.id === filtros.campanhaId)?.nome ?? null)
    : null;
  // O contrato comum com Contatos: "Sem etiqueta"; no modo Todas, os nomes
  // somados ("Todas: VIP + Frio"); em Qualquer uma, "VIP +2".
  const etiquetasLigadas = valorDoFiltroEtiquetas(
    filtros,
    filtros.etiquetas.map(
      (id) => etiquetas?.find((t) => t.id === id)?.nome ?? "Etiqueta",
    ),
  );
  return {
    periodo: valorDoPeriodo(filtros),
    etiquetas: etiquetasLigadas?.valor ?? null,
    etiquetasNome: etiquetasLigadas?.rotulo ?? null,
    atendentes: primeiroEMais(
      filtros.atendentes.map((id) =>
        id === SEM_DONO
          ? "Sem dono"
          : (nomesEquipe?.find((p) => p.id === id)?.nome ?? "Atendente"),
      ),
    ),
    canal:
      filtros.canal === "whatsapp"
        ? "WhatsApp"
        : filtros.canal === "direct"
          ? "Direct"
          : null,
    campanha: filtros.campanhaId ? (nomeCampanha ?? "Escolhida") : null,
    campanhaNaPilula: filtros.campanhaId
      ? nomeCampanha
        ? `Campanha: ${nomeCampanha}`
        : "Campanha escolhida"
      : null,
  };
}

/**
 * Os filtros ligados em palavras, na ordem das pílulas ("Últimos 7 dias",
 * "VIP +1", "WhatsApp", "Não lidas"). A barra da seleção em massa diz assim
 * de que recorte são as conversas marcadas.
 */
export function resumoDosFiltros(dados: DadosNomes): string[] {
  const v = valoresDosFiltros(dados);
  return [
    v.periodo,
    v.etiquetas,
    v.atendentes,
    v.canal,
    v.campanhaNaPilula,
    dados.filtros.naoLidas ? "Não lidas" : null,
  ].filter((x): x is string => Boolean(x));
}

/** O que cada menu recebe além do básico, igual no funil e na pílula. */
type DadosMenus = Pick<
  PropsFiltros,
  | "equipe"
  | "carga"
  | "etiquetas"
  | "campanhas"
  | "aoLerCarga"
  | "rotuloResultado"
>;

/** O menu de um filtro. Quem chama põe a chave (cada abertura monta o
 *  conteúdo de novo: a busca, as datas e a arquivada que fica até fechar
 *  nascem do filtro de agora). */
function MenuDoFiltro({
  qual,
  base,
  dados,
}: {
  qual: MenuFiltro;
  base: BaseMenu;
  dados: DadosMenus;
}) {
  switch (qual) {
    case "periodo":
      return <FiltroPeriodo {...base} />;
    case "etiquetas":
      return (
        <FiltroEtiquetas
          {...base}
          etiquetas={dados.etiquetas}
          rotuloResultado={dados.rotuloResultado}
        />
      );
    case "atendentes":
      return (
        <FiltroAtendentes
          {...base}
          equipe={dados.equipe}
          carga={dados.carga}
          aoLerCarga={dados.aoLerCarga}
          rotuloResultado={dados.rotuloResultado}
        />
      );
    case "canal":
      return <FiltroCanal {...base} />;
    case "campanha":
      return <FiltroCampanha {...base} campanhas={dados.campanhas} />;
  }
}

/** O id do botão do funil (um por tela): a pílula que some passa o foco a
 *  ele quando não sobra vizinha. */
export const ID_FUNIL = "funil-filtros";

/** Fora de vista: com display none em si ou num ancestral. */
function escondido(el: HTMLElement): boolean {
  return el.offsetParent === null && getComputedStyle(el).position !== "fixed";
}

/**
 * Antes de a pílula sair (o X): o foco vai à pílula vizinha, a seguinte ou,
 * na ponta, a anterior; sem nenhuma, ao funil. Pelo DOM, no clique: a linha
 * sabe quais pílulas estão à vista.
 */
function focarVizinha(de: HTMLElement) {
  const atual = de.closest<HTMLElement>("[data-pilula]");
  const linha = atual?.parentElement;
  if (!atual || !linha) return;
  const pilulas = Array.from(linha.children).filter(
    (el): el is HTMLElement =>
      el instanceof HTMLElement &&
      el.hasAttribute("data-pilula") &&
      (el === atual || !escondido(el)),
  );
  const i = pilulas.indexOf(atual);
  const vizinha = pilulas[i + 1] ?? pilulas[i - 1];
  const alvo = vizinha
    ? vizinha.matches("button")
      ? vizinha
      : vizinha.querySelector<HTMLElement>("button")
    : document.getElementById(ID_FUNIL);
  alvo?.focus({ preventScroll: true });
}

/** O foco ficou sem lugar: no body, fora do documento, num botão que saiu
 *  de vista (a pílula escondida) ou preso num elemento inerte. No celular a
 *  folha fica montada e inerte depois de fechar: o "Ver N conversas", o X
 *  ou o Esc deixam o foco num botão dela, que ainda tem offsetParent, e o
 *  Chrome o soltava no body logo depois. */
function focoPerdido(): boolean {
  const ativo = document.activeElement;
  if (!ativo || ativo === document.body || !ativo.isConnected) return true;
  return (
    ativo instanceof HTMLElement &&
    (escondido(ativo) || ativo.closest("[inert]") !== null)
  );
}

/**
 * Uma linha da lista do funil que abre o menu de um filtro: o nome, o valor
 * à direita quando o filtro está ligado e a seta. 40px no menu, 48px na
 * folha com o separador encaixado, como o ItemAcao. A lista é um diálogo
 * (tem chips), então a linha é botão comum, sem papel de item de menu.
 */
function ItemCategoria({
  menu,
  rotulo,
  valor,
  itemRef,
  onClick,
}: {
  menu: boolean;
  rotulo: string;
  valor: string | null;
  itemRef: (el: HTMLButtonElement | null) => void;
  onClick: () => void;
}) {
  return (
    <button
      ref={itemRef}
      type="button"
      data-item=""
      aria-haspopup="dialog"
      onClick={onClick}
      className={cn(
        "group/item flex w-full items-center text-left text-tinta transition-colors duration-[120ms] outline-none focus-visible:outline-2 focus-visible:-outline-offset-2 focus-visible:outline-tinta",
        menu
          ? "min-h-[40px] gap-1 rounded-controle px-1 hover:bg-realce focus:bg-realce active:bg-pressionado pointer-coarse:min-h-[44px]"
          : "min-h-[48px] gap-1.5 pl-1.5 hover:bg-realce active:bg-pressionado",
      )}
    >
      <span
        className={cn(
          "flex min-w-0 flex-1 items-center gap-1 self-stretch",
          menu
            ? "py-0.5"
            : "border-t border-fio py-1 pr-1.5 group-first/linha:border-t-0",
        )}
      >
        <span className="tipo-corpo shrink-0">{rotulo}</span>
        {/* O valor corta antes do nome: "Campanha" fica inteiro. */}
        <span className="tipo-nota min-w-0 flex-1 truncate text-right text-texto-2">
          {valor ? (
            <>
              <span className="sr-only">, </span>
              {valor}
            </>
          ) : null}
        </span>
        <ChevronRight
          size={18}
          strokeWidth={1.75}
          aria-hidden
          className="shrink-0 text-texto-3"
        />
      </span>
    </button>
  );
}

/** Uma fileira de chips da lista do funil (Período, Canal): o toque liga e
 *  desliga ali mesmo, sem abrir menu nem fechar a lista. Quebra de linha em
 *  vez de rolar de lado. */
function FileiraDeChips({
  menu,
  rotulo,
  children,
}: {
  menu: boolean;
  rotulo: string;
  children: React.ReactNode;
}) {
  return (
    <div
      role="group"
      aria-label={rotulo}
      className={cn(
        "flex flex-wrap gap-1 pointer-coarse:gap-1.5",
        menu ? "px-1 pb-1" : "px-1.5 py-1.5",
      )}
    >
      {children}
    </div>
  );
}

/**
 * O funil na linha do título, à esquerda do "Selecionar". Tocar abre a
 * lista "Filtrar por" (menu no tablet e no desktop, folha presa no pé no
 * celular). As escolhas curtas ficam na própria lista e não fecham nada: o
 * período em chips (Hoje, 7 dias, 30 dias) com "Escolher datas ›", o canal
 * em chips (WhatsApp, Direct) e "Só não lidas". Etiquetas, Atendentes e
 * Campanha abrem o menu daquele filtro ancorado no funil, com "‹ Filtros" no
 * topo; escolher a campanha ou as datas volta para a lista. No pé, "Limpar"
 * e o "Ver N conversas", que fecha sobre a fila. Filtros diferentes se
 * somam: 7 dias, WhatsApp e duas etiquetas saem com o funil aberto uma vez.
 *
 * Esc volta um nível: do menu do filtro para a lista, e da lista fecha. Ao
 * fechar, o foco volta ao funil (o menu e a folha o devolvem ao gatilho).
 * O selo no canto conta os filtros ligados, e o fundo marca o funil
 * enquanto a lista ou um menu dele estiver aberto.
 *
 * Do md para cima, na linha do título: 40px de largura, com área estendida
 * até 44 no toque (com 44 de desenho, "Aguardando" cortava na fila de 360px
 * do iPad: título de 28px, o funil e o "Selecionar" em 328px).
 *
 * Abaixo de md, dentro do campo de busca, à direita, com o selo junto
 * (pedido do Artur, 09/10/2026): na linha do título de 375px o funil cortava
 * "Aguardando" e "Resolvidas". O lugar sai só do CSS, sem medir a tela (o
 * primeiro quadro vem do servidor): quem chama põe a linha do título e a
 * busca numa caixa `relative` que termina na busca, e o funil se prende ao
 * canto de baixo à direita dela, com a altura do campo (40px, 44 no toque).
 * A busca reserva o lugar dele (o recuo à direita e o X da busca ao lado,
 * a 12px do funil no toque). Abaixo de md o funil não tem área estendida:
 * ela entraria no vão até o X.
 */
export function FunilFiltros(props: PropsFiltros) {
  const {
    filtros,
    aberto,
    aoAbrir,
    mostrarAtendentes,
    aoMudar,
    aoLimpar,
    funilRef,
    rotuloResultado,
  } = props;
  const menu = useTelaMd();
  const caixaRef = useRef<HTMLDivElement>(null);
  const itensRef = useRef<Partial<Record<MenuFiltro, HTMLButtonElement | null>>>(
    {},
  );
  // De qual filtro se voltou: a lista põe o foco nele, e não no primeiro.
  const voltouDeRef = useRef<MenuFiltro | null>(null);
  const [vezes, setVezes] = useState(ZERADO);

  const naLista = aberto?.qual === "lista";
  const doFunil =
    aberto && aberto.qual !== "lista" && aberto.ancora === "funil"
      ? aberto.qual
      : null;
  const expandido = naLista || doFunil !== null;
  const ligados = filtrosLigados(filtros).length;
  const valores = valoresDosFiltros(props);
  const categorias = CATEGORIAS.filter(
    (c) => c.qual !== "atendentes" || mostrarAtendentes,
  );
  const menus = MENUS_DO_FUNIL.filter(
    (q) => q !== "atendentes" || mostrarAtendentes,
  );
  // As datas escolhidas à mão aparecem no "Escolher datas"; o atalho já
  // aparece no chip ligado.
  const datasEscolhidas =
    ehDataFila(filtros.de) || ehDataFila(filtros.ate) ? valores.periodo : null;

  // O espaço até o pé da janela, como na pílula: os menus abertos pelo
  // funil acompanham a altura que sobra (e o teclado do iPad).
  useLayoutEffect(() => {
    if (expandido) medirEspaco(caixaRef.current);
  });
  useEffect(() => {
    if (!expandido) return;
    const medir = () => medirEspaco(caixaRef.current);
    const vv = window.visualViewport;
    vv?.addEventListener("resize", medir);
    window.addEventListener("resize", medir);
    return () => {
      vv?.removeEventListener("resize", medir);
      window.removeEventListener("resize", medir);
    };
  }, [expandido]);

  // Voltou de um filtro: o foco vai à linha de onde veio. Roda depois do
  // menu (filho), que já pôs o foco no primeiro item.
  useEffect(() => {
    if (!naLista) return;
    const de = voltouDeRef.current;
    voltouDeRef.current = null;
    if (de) itensRef.current[de]?.focus({ preventScroll: true });
  }, [naLista]);

  const fechar = () => aoAbrir(null);
  const abrirLista = () => aoAbrir({ qual: "lista" });
  const escolher = (qual: MenuFiltro) => {
    setVezes((v) => ({ ...v, [qual]: v[qual] + 1 }));
    aoAbrir({ qual, ancora: "funil" });
  };
  const voltar = (de: MenuFiltro) => {
    voltouDeRef.current = de;
    abrirLista();
  };

  // O Esc do menu de um filtro aberto pelo funil volta à lista, em vez de
  // fechar tudo. Na captura, antes do menu e da folha (que fechariam); a
  // folha mora num portal, mas o evento do React segue a árvore dos
  // componentes e passa por aqui. A busca com texto limpa antes.
  const aoTeclarAntes = (e: React.KeyboardEvent<HTMLDivElement>) => {
    if (e.key !== "Escape" || doFunil === null) return;
    const alvo = e.target;
    if (
      alvo instanceof HTMLInputElement &&
      alvo.type === "search" &&
      alvo.value !== ""
    ) {
      return;
    }
    e.preventDefault();
    e.stopPropagation();
    voltar(doFunil);
  };

  // Período: os três atalhos como chips (o toque liga e desliga, sem fechar)
  // e, embaixo, "Escolher datas", que abre De e Até.
  const chipsPeriodo = (
    <FileiraDeChips menu={menu} rotulo="Período">
      {CHIPS_PERIODO.map((a) => {
        const ligado = filtros.de === a.valor;
        return (
          <Chip
            key={a.valor}
            data-item=""
            ativo={ligado}
            onClick={() =>
              aoMudar(ligado ? { de: "", ate: "" } : { de: a.valor, ate: "" })
            }
          >
            {a.rotulo}
          </Chip>
        );
      })}
    </FileiraDeChips>
  );
  const escolherDatas = (
    <ItemCategoria
      menu={menu}
      rotulo="Escolher datas"
      valor={datasEscolhidas}
      itemRef={(el) => {
        itensRef.current.periodo = el;
      }}
      onClick={() => escolher("periodo")}
    />
  );
  const chipsCanal = (
    <FileiraDeChips menu={menu} rotulo="Canal">
      {CHIPS_CANAL.map((c) => {
        const ligado = filtros.canal === c.valor;
        return (
          <Chip
            key={c.valor}
            data-item=""
            ativo={ligado}
            onClick={() => aoMudar({ canal: ligado ? "" : c.valor })}
          >
            {c.rotulo}
          </Chip>
        );
      })}
    </FileiraDeChips>
  );
  const itensCategorias = categorias.map((c) => (
    <ItemSecao key={c.qual} menu={menu}>
      <ItemCategoria
        menu={menu}
        rotulo={c.rotulo}
        valor={valores[c.qual]}
        itemRef={(el) => {
          itensRef.current[c.qual] = el;
        }}
        onClick={() => escolher(c.qual)}
      />
    </ItemSecao>
  ));
  // Liga e desliga ali mesmo, sem fechar a lista. A lista é um diálogo: no
  // menu o item é botão com aria-pressed (na folha, o ItemAcao já faz isso).
  const soNaoLidas = (
    <ItemSecao menu={menu}>
      <ItemAcao
        variante={menu ? "menu" : "folha"}
        papel={menu ? "button" : "menuitemcheckbox"}
        marcado={filtros.naoLidas}
        // Só no menu: na folha, um aria-pressed indefinido apagaria o do
        // ItemAcao.
        {...(menu ? { "aria-pressed": filtros.naoLidas } : {})}
        onClick={() => aoMudar({ naoLidas: !filtros.naoLidas })}
      >
        Só não lidas
      </ItemAcao>
    </ItemSecao>
  );
  // O "Limpar" some com os filtros: o foco passa antes ao painel.
  const pe = peComResultado({
    menu,
    ativo: ligados > 0,
    aoLimpar: (alvo) => {
      focarPainel(alvo);
      aoLimpar();
    },
    rotuloResultado,
    aoVer: fechar,
  });

  // O que todo menu aberto pelo funil recebe.
  const base = (qual: MenuFiltro): BaseMenu => ({
    menu,
    aberta: doFunil === qual,
    aoFechar: fechar,
    gatilho: funilRef,
    filtros,
    aoMudar,
    voltar: { rotulo: "Filtros", aoVoltar: () => voltar(qual) },
    // O funil fica perto da borda direita da fila: o menu cresce para o
    // lado da conversa (e o MenuSuspenso troca de lado se não couber).
    alinhar: "inicio",
  });

  return (
    <div
      ref={caixaRef}
      onKeyDownCapture={aoTeclarAntes}
      className={cn(
        "shrink-0",
        // Abaixo de md: no canto direito da busca, por cima do campo.
        "max-md:absolute max-md:right-0 max-md:bottom-0 max-md:z-10",
        // Do md para cima, na linha do título. Sem o "Selecionar" (o
        // compliance), o funil encosta na borda da busca.
        "md:relative md:last:-mr-1",
      )}
    >
      <button
        ref={funilRef}
        id={ID_FUNIL}
        type="button"
        aria-haspopup="dialog"
        aria-expanded={expandido}
        aria-label={
          ligados > 0
            ? `Filtros, ${ligados.toLocaleString("pt-BR")} ${ligados === 1 ? "ativo" : "ativos"}`
            : "Filtros"
        }
        title="Filtros"
        onClick={() => (expandido ? fechar() : abrirLista())}
        onKeyDown={(e) => {
          if (e.key === "ArrowDown" && !expandido) {
            e.preventDefault();
            abrirLista();
          }
        }}
        className={cn(
          BOTAO_ICONE,
          // A altura do campo de busca (40px, 44 no toque), dentro dele no
          // celular e ao lado do "Selecionar" do md para cima. Na busca, 44
          // de largura no toque; na linha do título, 40 com a área
          // estendida até 44.
          "relative h-[40px] w-[40px] pointer-coarse:h-[44px] pointer-coarse:w-[40px] max-md:pointer-coarse:w-[44px]",
          "md:pointer-coarse:after:absolute md:pointer-coarse:after:inset-y-0 md:pointer-coarse:after:-inset-x-[2px]",
          ligados > 0 && "text-tinta",
          expandido && "bg-selecao text-tinta hover:bg-selecao",
        )}
      >
        <span className="relative flex">
          <Funnel
            size={20}
            strokeWidth={1.75}
            aria-hidden
            className="md:size-[18px]"
          />
          {ligados > 0 ? (
            // O número já está no nome do botão. Preso ao canto do ícone,
            // e não ao do botão (40 ou 44 de altura), e quase todo fora
            // dele: sobre o funil, cobria a boca e o desenho não se lia. O
            // anel no tom do que está atrás (a página, ou o campo de busca
            // no celular) separa o selo do traço.
            <span
              aria-hidden
              className="tipo-legenda-2 absolute -top-[8px] -right-[11px] flex h-[16px] min-w-[16px] items-center justify-center rounded-full bg-tinta px-0.5 leading-none font-semibold text-fundo tabular-nums ring-2 ring-fundo max-md:ring-cartao"
            >
              {ligados.toLocaleString("pt-BR")}
            </span>
          ) : null}
        </span>
      </button>

      {menu ? (
        // Só o miolo rola; o pé (Limpar, Ver N conversas) fica parado.
        <MenuSuspenso
          aberto={naLista}
          aoFechar={fechar}
          gatilho={funilRef}
          rotulo="Filtrar por"
          papel="dialog"
          alinhar="inicio"
          className="max-h-[min(560px,var(--espaco-menu,440px))] overflow-y-hidden"
        >
          <div className="-mx-0.5 min-h-0 flex-1 overflow-y-auto overscroll-contain px-0.5">
            <TituloSecao menu>Período</TituloSecao>
            {chipsPeriodo}
            {escolherDatas}
            <TituloSecao menu>Canal</TituloSecao>
            {chipsCanal}
            <div
              role="separator"
              className="-mx-0.5 my-0.5 border-t border-fio"
            />
            {itensCategorias}
            <div
              role="separator"
              className="-mx-0.5 my-0.5 border-t border-fio"
            />
            {soNaoLidas}
          </div>
          <div className="-mx-0.5 -mb-0.5 mt-0.5 shrink-0 border-t border-fio p-0.5">
            {pe.pe}
          </div>
        </MenuSuspenso>
      ) : (
        <Folha
          aberta={naLista}
          aoFechar={fechar}
          titulo="Filtrar por"
          retorno={funilRef}
          acao={pe.acaoFolha}
          rodape={pe.rodapeFolha}
        >
          <TituloSecao menu={false}>Período</TituloSecao>
          <Grupo>
            {chipsPeriodo}
            <LinhaGrupo>{escolherDatas}</LinhaGrupo>
          </Grupo>
          <TituloSecao menu={false}>Canal</TituloSecao>
          <Grupo>{chipsCanal}</Grupo>
          <div className="mt-2">
            <ItensSecao menu={false}>{itensCategorias}</ItensSecao>
          </div>
          <div className="mt-2">
            <ItensSecao menu={false}>{soNaoLidas}</ItensSecao>
          </div>
        </Folha>
      )}

      {menus.map((q) => (
        <MenuDoFiltro
          key={`${q}-${vezes[q]}`}
          qual={q}
          base={base(q)}
          dados={props}
        />
      ))}
    </div>
  );
}

/**
 * Pílula sem menu: o rótulo na tinta e o X, num botão só, que tira o
 * filtro. É a do "Não lidas" e a de Atendentes para quem não filtra por
 * atendente, quando o filtro veio pela URL: aparece para poder sair.
 */
function PilulaTirar({
  rotulo,
  aoTirar,
}: {
  rotulo: string;
  aoTirar: () => void;
}) {
  return (
    <button
      type="button"
      data-pilula=""
      aria-label={`Tirar o filtro: ${rotulo}`}
      title={`Tirar o filtro: ${rotulo}`}
      onClick={(e) => {
        focarVizinha(e.currentTarget);
        aoTirar();
      }}
      className={cn(
        "relative inline-flex h-[32px] max-w-full min-w-0 items-center rounded-chip border border-tinta bg-tinta pl-1 text-sm whitespace-nowrap text-fundo select-none transition-[background-color,scale] duration-[120ms] hover:bg-tinta-hover motion-safe:active:scale-[.97]",
        // Na pílula na tinta o anel do foco vai por dentro, no tom do fundo.
        "focus-visible:outline-2 focus-visible:-outline-offset-2 focus-visible:outline-fundo",
        "pointer-coarse:after:absolute pointer-coarse:after:inset-x-0 pointer-coarse:after:-inset-y-[7px]",
      )}
    >
      <span className="max-w-[160px] min-w-0 truncate">{rotulo}</span>
      <span
        aria-hidden
        className="inline-flex w-[28px] shrink-0 justify-center pointer-coarse:w-[32px]"
      >
        <X size={14} strokeWidth={2} />
      </span>
    </button>
  );
}

/**
 * Embaixo do escopo, só os filtros ligados, como pílulas: o valor na tinta
 * e o X que tira o filtro; tocar abre o menu dele ancorado na pílula. Com
 * dois ou mais, "Limpar filtros" no fim. Sem filtro ligado, a linha não
 * existe (altura zero). Quebra de linha em vez de rolar de lado.
 *
 * A pílula cujo menu está aberto fica até ele fechar, mesmo que o filtro se
 * esvazie lá dentro (desmarcar a última etiqueta): o menu mora nela. Ao
 * fechar, ela sai, e o foco que voltaria a ela vai ao funil.
 */
export function BarraFiltros(props: PropsFiltros) {
  const {
    filtros,
    aberto,
    aoAbrir,
    mostrarAtendentes,
    aoMudar,
    aoLimpar,
    funilRef,
  } = props;
  const menu = useTelaMd();
  const periodoRef = useRef<HTMLButtonElement>(null);
  const etiquetasRef = useRef<HTMLButtonElement>(null);
  const atendentesRef = useRef<HTMLButtonElement>(null);
  const canalRef = useRef<HTMLButtonElement>(null);
  const campanhaRef = useRef<HTMLButtonElement>(null);
  const refs: Record<MenuFiltro, RefObject<HTMLButtonElement | null>> = {
    periodo: periodoRef,
    etiquetas: etiquetasRef,
    atendentes: atendentesRef,
    canal: canalRef,
    campanha: campanhaRef,
  };
  // Cada abertura monta o conteúdo de novo. A folha do celular fica
  // montada entre uma abertura e outra (para descer à vista), por isso a
  // chave e não o desmontar do menu.
  const [vezes, setVezes] = useState(ZERADO);

  const daPilula =
    aberto && aberto.qual !== "lista" && aberto.ancora === "pilula"
      ? aberto.qual
      : null;
  const ligados = filtrosLigados(filtros);
  const valores = valoresDosFiltros(props);
  const visivel = (q: Ligado) => ligados.includes(q) || daPilula === q;

  // O menu de uma pílula fechou e ela saiu junto (o filtro ficou vazio):
  // o menu e a folha devolvem o foco a ela, escondida, e ele se perde. Vai
  // ao funil. Roda depois da devolução (o menu é filho).
  const pilulaAntesRef = useRef<MenuFiltro | null>(null);
  useEffect(() => {
    const antes = pilulaAntesRef.current;
    pilulaAntesRef.current = daPilula;
    if (antes === null || antes === daPilula || !focoPerdido()) return;
    funilRef.current?.focus({ preventScroll: true });
  }, [daPilula, funilRef]);

  const alternar = (qual: MenuFiltro) => {
    if (daPilula === qual) {
      aoAbrir(null);
      return;
    }
    setVezes((v) => ({ ...v, [qual]: v[qual] + 1 }));
    aoAbrir({ qual, ancora: "pilula" });
  };

  // O X: a pílula some com o filtro. O foco já foi à vizinha no clique
  // (focarVizinha).
  const tirar = (qual: Ligado) => aoMudar(DESLIGAR[qual]);

  const pilula = (
    qual: MenuFiltro,
    nome: string,
    valor: string | null,
    rotulo?: string | null,
  ) => (
    <BotaoFiltro
      nome={nome}
      valor={valor}
      rotulo={rotulo}
      escondida={!visivel(qual)}
      aberto={daPilula === qual}
      aoAlternar={() => alternar(qual)}
      aoLimpar={() => tirar(qual)}
      botaoRef={refs[qual]}
      popup={menu && qual === "canal" ? "menu" : "dialog"}
    >
      <MenuDoFiltro
        key={vezes[qual]}
        qual={qual}
        base={{
          menu,
          aberta: daPilula === qual,
          aoFechar: () => aoAbrir(null),
          gatilho: refs[qual],
          filtros,
          aoMudar,
        }}
        dados={props}
      />
    </BotaoFiltro>
  );

  return (
    <div
      role="group"
      aria-label="Filtros ligados"
      className={cn(
        "mt-1 flex flex-wrap items-center gap-1 pointer-coarse:gap-1.5",
        !ORDEM.some(visivel) && "hidden",
      )}
    >
      {pilula("periodo", "Período", valores.periodo)}
      {pilula(
        "etiquetas",
        "Etiquetas",
        valores.etiquetas,
        valores.etiquetasNome,
      )}
      {mostrarAtendentes ? (
        pilula("atendentes", "Atendentes", valores.atendentes)
      ) : valores.atendentes ? (
        <PilulaTirar
          rotulo={`Atendentes: ${valores.atendentes}`}
          aoTirar={() => tirar("atendentes")}
        />
      ) : null}
      {pilula("canal", "Canal", valores.canal)}
      {pilula("campanha", "Campanha", valores.campanhaNaPilula)}
      {filtros.naoLidas ? (
        <PilulaTirar rotulo="Não lidas" aoTirar={() => tirar("naoLidas")} />
      ) : null}

      {ligados.length >= 2 ? (
        <Button
          variant="ghost"
          size="sm"
          className="px-1"
          onClick={() => {
            // O botão some com as pílulas: o foco vai antes ao funil.
            funilRef.current?.focus({ preventScroll: true });
            aoLimpar();
          }}
        >
          Limpar filtros
        </Button>
      ) : null}
    </div>
  );
}
