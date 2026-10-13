"use client";

import { medirEspaco } from "./medir-espaco";
export { medirEspaco };

import {
  useEffect,
  useId,
  useLayoutEffect,
  useRef,
  useState,
  type RefObject,
} from "react";
import { ChevronDown, ChevronRight, Funnel, X } from "lucide-react";
import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import { Segmentado } from "@/components/ui/segmentado";
import {
  BOTAO_ICONE,
  CAMPO,
  ERRO_CAMPO,
  ROTULO,
} from "@/components/app/form-styles";
import {
  ehDataFila,
  hojeEmBrasilia,
  rotuloDoPeriodo,
  somarDiasFila,
  valorDoFiltroEtiquetas,
  type AtalhoPeriodo,
} from "@/app/(app)/chat/mensagem";
import {
  CampoBuscaMenu,
  filtrarPorNome,
  focarPainel,
  ITENS_SEM_BUSCA,
  MensagemMenu,
  PainelEscolha,
  type VoltarMenu,
} from "../conversas/barra-filtros";
import {
  Folha,
  ItemAcao,
  ItemSecao,
  ItensSecao,
  MenuSuspenso,
  TituloSecao,
  useTelaMd,
} from "../conversas/folha";
import { ItemMarcavel } from "../conversas/topo-fila";
import { pontoDaEtiqueta } from "./cor-etiqueta";
import {
  DATA_MINIMA,
  ehDataDoPeriodo,
  MAX_IDS_FILTRO,
  SEM_DONO,
  type CampoData,
  type FiltrosContatos,
  type ModoEtiquetas,
} from "./filtros";
import type { EtiquetaCatalogo } from "./lista-contatos";

/*
 * Os filtros dos contatos, no mesmo desenho da fila do chat
 * (conversas/barra-filtros.tsx), em duas metades. À direita da busca, o
 * funil (FunilFiltrosContatos): tocar abre a lista curta "Filtrar por" e
 * cada categoria abre o menu daquele filtro ancorado no funil, com
 * "‹ Filtros" no topo para voltar. Embaixo da busca, só os filtros ligados
 * (PilulasFiltrosContatos), como pílulas: o valor na tinta ("Últimos 7
 * dias", "VIP +2") e o X que tira o filtro ali mesmo; tocar na pílula abre o
 * mesmo menu, ancorado nela. Sem filtro ligado, essa linha não existe.
 *
 * Antes, os cinco botões ficavam sempre à vista embaixo da busca e, no
 * telefone de 375px, quebravam em duas linhas. Na fila o Artur trocou isso
 * pelo funil em 09/10/2026 ("deixe apenas um funil como ícone"); aqui é o
 * mesmo jeito, para quem passa do chat para Contatos filtrar igual.
 *
 * O menu, a folha, a busca do menu e a linha de marcar vêm da fila. O botão
 * da pílula, a linha da categoria, o "Limpar" do menu e o aviso do teto não
 * são exportados de lá: a cópia mínima mora aqui. Só a apresentação mudou:
 * a URL, a consulta e o CSV são os mesmos.
 */

export type Opcao = { id: string; nome: string };

/** Quem dá nome ao filtro de responsável; `ativo` false é o desativado
 *  que veio num link guardado. */
export type MembroDoFiltro = Opcao & { ativo: boolean };

export type CampanhaDoFiltro = {
  id: string;
  nome: string;
  status: "ativa" | "pausada" | "concluida";
};

export type MenuFiltroContatos =
  | "periodo"
  | "etiquetas"
  | "responsaveis"
  | "campanha"
  | "canal";

/**
 * O que está aberto: a lista do funil ("Filtrar por") ou o menu de um
 * filtro, ancorado no funil (escolhido na lista) ou na pílula dele.
 */
export type FiltroAbertoContatos =
  | { qual: "lista" }
  | { qual: MenuFiltroContatos; ancora: "funil" | "pilula" };

/** O id do botão do funil (um por tela): a pílula que some passa o foco a
 *  ele quando não sobra vizinha. */
const ID_FUNIL = "funil-filtros-contatos";

const ATALHOS: { valor: AtalhoPeriodo; rotulo: string; dias: number }[] = [
  { valor: "hoje", rotulo: "Hoje", dias: 0 },
  { valor: "7d", rotulo: "Últimos 7 dias", dias: 6 },
  { valor: "30d", rotulo: "Últimos 30 dias", dias: 29 },
];

const ROTULO_STATUS_CAMPANHA: Record<CampanhaDoFiltro["status"], string> = {
  ativa: "Enviando",
  pausada: "Pausada",
  concluida: "Concluída",
};

const CANAIS = [
  { valor: "whatsapp", rotulo: "Tem WhatsApp" },
  { valor: "instagram", rotulo: "Tem Instagram" },
] as const;

const numero = new Intl.NumberFormat("pt-BR");

/** "Hoje" vira "hoje" depois dos dois pontos: "Cadastro: hoje". */
function minuscula(texto: string): string {
  return texto.charAt(0).toLocaleLowerCase("pt-BR") + texto.slice(1);
}

/** O texto do item exclusivo do topo da lista de etiquetas (o mesmo da
 *  fila do chat; a pílula com ele marcado sai de valorDoFiltroEtiquetas). */
const SEM_ETIQUETA = "Sem etiqueta";

/**
 * As setas são do segmentado (trocam a opção) e do campo de data (trocam o
 * dia), não do menu em volta, que andaria de item em item.
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

/* ── Peças copiadas da fila ───────────────────────────────────────────── */


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
    ? vizinha.querySelector<HTMLElement>("button")
    : document.getElementById(ID_FUNIL);
  alvo?.focus({ preventScroll: true });
}

/** O foco ficou sem lugar: no body, fora do documento, num botão que saiu
 *  de vista (a pílula escondida) ou preso num elemento inerte (a folha
 *  fechada do celular, que fica montada). */
function focoPerdido(): boolean {
  const ativo = document.activeElement;
  if (!ativo || ativo === document.body || !ativo.isConnected) return true;
  return (
    ativo instanceof HTMLElement &&
    (escondido(ativo) || ativo.closest("[inert]") !== null)
  );
}

/**
 * A pílula de um filtro ligado: o valor na tinta, com ▾ e o X que tira o
 * filtro. São dois botões numa pílula só (botão dentro de botão é HTML
 * inválido); o X some com a pílula e passa o foco antes à vizinha (ou ao
 * funil). ↓ também abre o menu. Desligado (só com o menu aberto, o filtro
 * esvaziado lá dentro): o nome do filtro com ▾, só com o fio. É o
 * BotaoFiltro da fila, com o nome acessível que o Período pede e o valor um
 * pouco mais largo.
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
  /** O nome para o leitor de tela com o filtro ligado, quando "Nome:
   *  valor" não diz tudo ("Período do cadastro: hoje"). */
  rotulo?: string;
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

  // Com o menu aberto, a pílula não troca de lugar (o menu mora dentro
  // dela): a largura de agora vira o mínimo e o que sobra até o fim da
  // linha vira o máximo. Marcar uma etiqueta alargava a pílula, ela descia
  // de linha levando o menu, e o próximo clique caía em outro item.
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
          // No toque, 7px de área estendida em cima e embaixo: o botão tem
          // 30px por dentro do fio da pílula, e com 6px dava 42.
          className={cn(
            "relative inline-flex min-w-0 grow items-center gap-0.5 rounded-chip pl-1 text-sm whitespace-nowrap select-none transition-colors duration-[120ms]",
            "pointer-coarse:after:absolute pointer-coarse:after:inset-x-0 pointer-coarse:after:-inset-y-[7px]",
            foco,
            ativo
              ? "pr-0.5 hover:bg-tinta-hover"
              : "pr-1 hover:bg-realce active:bg-pressionado",
          )}
        >
          {/* 200px: "Cadastro: 01/10 a 07/10" cabe inteiro, e a pílula
              ligada mais larga ainda cabe numa linha do telefone de 375px. */}
          <span className="max-w-[200px] min-w-0 truncate">
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
            // No toque, 32×30 de desenho, 6px de área estendida nos lados
            // e 7px em cima e embaixo: 44×44.
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

/* ── O que vai em cada menu ───────────────────────────────────────────── */

type BaseMenu = {
  menu: boolean;
  aberta: boolean;
  aoFechar: () => void;
  gatilho: RefObject<HTMLButtonElement | null>;
  filtros: FiltrosContatos;
  aoMudar: (mudanca: Partial<FiltrosContatos>) => void;
  /** Aberto pelo funil: o "‹ Filtros" no topo volta à lista. */
  voltar?: VoltarMenu;
  /** O lado do gatilho em que o menu se alinha (padrão: o início). */
  alinhar?: "inicio" | "fim";
};

/**
 * Qual data o período olha (Última interação ou Cadastro) no alto; embaixo,
 * Hoje, Últimos 7 dias, Últimos 30 dias e, à vista no mesmo menu, De e Até
 * com o Aplicar. Atalho aplica e fecha. As datas nascem do filtro de agora
 * (vindo de um atalho, as datas dele, para ajustar) e só valem no Aplicar
 * (ou Enter num dos campos): o ano pela metade não recarrega a lista.
 *
 * Sem período ligado, a troca da data fica no menu até o atalho ou o
 * Aplicar. Com período ligado, vale na hora e o menu fica aberto: a lista
 * atrás já mostra o recorte novo.
 */
function FiltroPeriodo({
  menu,
  aberta,
  aoFechar,
  gatilho,
  filtros,
  aoMudar,
  voltar,
  alinhar,
}: BaseMenu) {
  const variante = menu ? "menu" : "folha";
  const hoje = hojeEmBrasilia();
  const atalho = ATALHOS.find((a) => a.valor === filtros.de) ?? null;
  const ativo = Boolean(filtros.de || filtros.ate);
  const [campo, setCampo] = useState<CampoData>(filtros.data);
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

  const de = ehDataDoPeriodo(rascunho.de) ? rascunho.de : "";
  const ate = ehDataDoPeriodo(rascunho.ate) ? rascunho.ate : "";
  const invertidas = de !== "" && ate !== "" && de > ate;
  const algumaEscrita = rascunho.de !== "" || rascunho.ate !== "";
  const dataRuim = errosEnvio.de || errosEnvio.ate;

  const trocarCampo = (novo: CampoData) => {
    setCampo(novo);
    if (ativo && novo !== filtros.data) aoMudar({ data: novo });
  };

  const mudarData = (ponta: "de" | "ate", valor: string) => {
    setRascunho((r) => ({ ...r, [ponta]: valor }));
    setErrosEnvio((e) => ({ ...e, [ponta]: false }));
  };

  const aplicar = (e: React.FormEvent) => {
    e.preventDefault();
    // O campo pela metade (só o dia, no Chrome) tem value "" e badInput:
    // sem olhar o badInput, o Até digitado pela metade sumia calado.
    const ruins = {
      de:
        Boolean(deRef.current?.validity.badInput) ||
        (rascunho.de !== "" && !ehDataDoPeriodo(rascunho.de)),
      ate:
        Boolean(ateRef.current?.validity.badInput) ||
        (rascunho.ate !== "" && !ehDataDoPeriodo(rascunho.ate)),
    };
    if (ruins.de || ruins.ate) {
      setErrosEnvio(ruins);
      return;
    }
    if (invertidas || (de === "" && ate === "")) return;
    if (de !== filtros.de || ate !== filtros.ate || campo !== filtros.data) {
      aoMudar({ data: campo, de, ate });
    }
    aoFechar();
  };

  const campoData = cn(
    CAMPO,
    // O campo de data do iOS ignora a largura recebida (kit, bloco 8).
    "mt-0.5 w-full min-w-0 appearance-none px-1 text-left tabular-nums",
  );
  const limpar = limparDoFiltro(menu, "button", () => {
    aoMudar({ de: "", ate: "" });
    aoFechar();
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
      topo={
        <div onKeyDown={prenderSetas}>
          <Segmentado<CampoData>
            rotulo="Data que o período olha"
            valor={campo}
            onMudar={trocarCampo}
            // Na largura toda, cada segmento do tamanho do rótulo: em
            // metades iguais, "Última interação" cortava.
            className="flex w-full [&>*]:flex-auto"
            opcoes={[
              { valor: "interacao", rotulo: "Última interação" },
              { valor: "cadastro", rotulo: "Cadastro" },
            ]}
          />
        </div>
      }
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
                if (filtros.de !== a.valor || filtros.data !== campo) {
                  aoMudar({ data: campo, de: a.valor, ate: "" });
                }
                aoFechar();
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
              max={ehDataDoPeriodo(rascunho.ate) ? rascunho.ate : hoje}
              aria-invalid={invertidas || errosEnvio.de || undefined}
              aria-describedby={
                invertidas || errosEnvio.de ? idErro : undefined
              }
              onChange={(e) => mudarData("de", e.target.value)}
              onKeyDown={prenderSetas}
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
              min={ehDataDoPeriodo(rascunho.de) ? rascunho.de : DATA_MINIMA}
              max={hoje}
              aria-invalid={invertidas || errosEnvio.ate || undefined}
              aria-describedby={
                invertidas || errosEnvio.ate ? idErro : undefined
              }
              onChange={(e) => mudarData("ate", e.target.value)}
              onKeyDown={prenderSetas}
              className={campoData}
            />
          </div>
        </div>
        {invertidas || dataRuim ? (
          <p id={idErro} role="alert" className={cn(ERRO_CAMPO, "mt-0.5")}>
            {invertidas
              ? "A data inicial passa da final."
              : "Confira a data: dia, mês e ano a partir de 2020."}
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

/**
 * As etiquetas, com caixas de marcar. No alto, "Qualquer uma · Todas": como
 * as marcadas se somam (o padrão é qualquer uma), com a frase embaixo que diz
 * em palavras quem entra. O nome, a regra de quando o seletor aparece e o
 * seletor parado com "Sem etiqueta" ligado são os da fila do chat
 * (conversas/barra-filtros.tsx); a frase fala de contato, e não de conversa.
 * No topo da lista, "Sem etiqueta", exclusivo: marcá-lo desmarca as
 * etiquetas, e marcar uma etiqueta o desmarca.
 *
 * Entram as ativas e a arquivada que já estava no filtro ao abrir (senão
 * não haveria como tirá-la); ela fica até o menu fechar, para o toque que
 * a desmarca não deixar o foco no body. O menu fica aberto para combinar.
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
  rodapeFolha,
}: BaseMenu & {
  /** O catálogo inteiro; null = a leitura falhou. */
  etiquetas: EtiquetaCatalogo[] | null;
  rodapeFolha: React.ReactNode;
}) {
  const [arquivadasNoFiltro] = useState(() => new Set(filtros.etiquetas));
  const [termo, setTermo] = useState("");
  const naLista = (etiquetas ?? []).filter(
    (t) => t.ativo || arquivadasNoFiltro.has(t.id),
  );
  const visiveis = filtrarPorNome(naLista, termo);
  // "Sem etiqueta" segue a busca do menu, como os nomes.
  // Como na fila: o "Sem etiqueta" entra na lista só quando há etiqueta
  // cadastrada (sem catálogo, ou com a leitura falhando, a mensagem basta;
  // um "Sem etiqueta" vindo de link sai pelo X da pílula).
  const mostraSem =
    naLista.length > 0 &&
    filtrarPorNome([{ nome: SEM_ETIQUETA }], termo).length > 0;
  const cheias = filtros.etiquetas.length >= MAX_IDS_FILTRO;
  const ativo = filtros.etiquetas.length > 0 || filtros.semEtiqueta;
  // A regra da fila: "Todas" só quer dizer algo com duas etiquetas para
  // marcar; escolhido num link guardado, fica à vista para poder voltar.
  // Sem etiqueta cadastrada, não há o que somar. Com "Sem etiqueta" ligado
  // o modo não muda nada e fica parado.
  const comModo =
    naLista.length > 0 &&
    (naLista.length > 1 || filtros.etiquetasModo === "todas");
  // A busca conta o "Sem etiqueta", como na fila.
  const comBusca = naLista.length > 0 && naLista.length + 1 > ITENS_SEM_BUSCA;
  // A frase da fila, com contato no lugar de conversa: Contatos lista
  // contatos, e a etiqueta é do contato nas duas telas.
  const frase = filtros.semEtiqueta
    ? "Entra só o contato sem etiqueta nenhuma."
    : filtros.etiquetas.length === 0
      ? "Nenhuma marcada: a lista não filtra por etiqueta."
      : filtros.etiquetasModo === "todas"
        ? "Entra só o contato com todas as marcadas."
        : "Entra o contato com qualquer uma das marcadas.";
  const limpar = limparDoFiltro(menu, "button", (alvo) => {
    focarPainel(alvo);
    aoMudar(DESLIGAR.etiquetas);
  });

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
                    opcoes={[
                      {
                        valor: "qualquer",
                        rotulo: "Qualquer uma",
                        desativada: filtros.semEtiqueta,
                      },
                      {
                        valor: "todas",
                        rotulo: "Todas",
                        desativada: filtros.semEtiqueta,
                      },
                    ]}
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
      pe={ativo ? limpar.pe : null}
      acaoFolha={ativo ? limpar.acaoFolha : null}
      rodapeFolha={rodapeFolha}
    >
      {etiquetas === null ? (
        <MensagemMenu menu={menu} erro>
          Não deu para carregar as etiquetas.
        </MensagemMenu>
      ) : null}
      {mostraSem || visiveis.length > 0 ? (
        <ItensSecao menu={menu}>
          {mostraSem ? (
            <ItemSecao menu={menu}>
              <ItemMarcavel
                menu={menu}
                estado={filtros.semEtiqueta}
                onClick={() =>
                  aoMudar(
                    filtros.semEtiqueta
                      ? { semEtiqueta: false }
                      : { semEtiqueta: true, etiquetas: [] },
                  )
                }
              >
                {SEM_ETIQUETA}
              </ItemMarcavel>
            </ItemSecao>
          ) : null}
          {visiveis.map((t) => {
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
      ) : null}
      {/* A busca que só casa com o "Sem etiqueta" não diz "nenhuma": o
          item está logo acima. */}
      {etiquetas === null ? null : naLista.length === 0 ? (
        <MensagemMenu menu={menu}>Nenhuma etiqueta cadastrada.</MensagemMenu>
      ) : !mostraSem && visiveis.length === 0 ? (
        <MensagemMenu menu={menu}>
          Nenhuma etiqueta com “{termo.trim()}”.
        </MensagemMenu>
      ) : null}
      <AvisoDoTeto menu={menu}>
        {cheias
          ? `Até ${numero.format(MAX_IDS_FILTRO)} etiquetas no filtro. Desmarque uma para escolher outra.`
          : ""}
      </AvisoDoTeto>
    </PainelEscolha>
  );
}

/**
 * "Sem dono" no topo e a equipe embaixo, com caixas de marcar (o contato
 * entra com qualquer um). O menu fica aberto para combinar.
 *
 * Quem estava no filtro ao abrir e não é opção (desativado, dono oculto)
 * entra logo abaixo do "Sem dono", como a etiqueta arquivada: senão não
 * haveria como tirá-lo. Fica até o menu fechar, para o toque que o desmarca
 * não deixar o foco no body. `soDesmarcar` (o atendente, que não escolhe
 * responsável) lista só quem estava no filtro.
 */
function FiltroResponsaveis({
  menu,
  aberta,
  aoFechar,
  gatilho,
  filtros,
  aoMudar,
  voltar,
  alinhar,
  equipe,
  nomesEquipe,
  soDesmarcar,
  rodapeFolha,
}: BaseMenu & {
  /** Quem pode virar filtro (sem os donos ocultos); null = a leitura
   *  falhou. */
  equipe: Opcao[] | null;
  /** Os nomes de quem está no filtro e não é opção; null = não carregou. */
  nomesEquipe: MembroDoFiltro[] | null;
  soDesmarcar: boolean;
  rodapeFolha: React.ReactNode;
}) {
  const [termo, setTermo] = useState("");
  const [noFiltroAoAbrir] = useState(() => filtros.responsaveis);
  const opcoes = soDesmarcar ? [] : (equipe ?? []);
  const semDono = { id: SEM_DONO, nome: "Sem dono" };
  const fora = noFiltroAoAbrir
    .filter((id) => id !== SEM_DONO && !opcoes.some((p) => p.id === id))
    .map((id) => {
      const membro = nomesEquipe?.find((p) => p.id === id);
      return {
        id,
        nome: membro?.nome ?? "Responsável",
        detalhe: membro && !membro.ativo ? "Desativado" : undefined,
      };
    });
  const pessoas: (Opcao & { detalhe?: string })[] = soDesmarcar
    ? [...(noFiltroAoAbrir.includes(SEM_DONO) ? [semDono] : []), ...fora]
    : [semDono, ...fora, ...opcoes];
  const visiveis = filtrarPorNome(pessoas, termo);
  const cheios = filtros.responsaveis.length >= MAX_IDS_FILTRO;
  const ativo = filtros.responsaveis.length > 0;
  const limpar = limparDoFiltro(menu, "button", (alvo) => {
    focarPainel(alvo);
    aoMudar({ responsaveis: [] });
  });

  return (
    <PainelEscolha
      menu={menu}
      aberta={aberta}
      aoFechar={aoFechar}
      titulo="Responsáveis"
      gatilho={gatilho}
      voltar={voltar}
      alinhar={alinhar}
      alturaPelaTela
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
      pe={ativo ? limpar.pe : null}
      acaoFolha={ativo ? limpar.acaoFolha : null}
      rodapeFolha={rodapeFolha}
    >
      {pessoas.length === 0 ? (
        <MensagemMenu menu={menu}>Nenhum responsável no filtro.</MensagemMenu>
      ) : visiveis.length === 0 ? (
        <MensagemMenu menu={menu}>Ninguém com “{termo.trim()}”.</MensagemMenu>
      ) : (
        <ItensSecao menu={menu}>
          {visiveis.map((p) => {
            const marcado = filtros.responsaveis.includes(p.id);
            return (
              <ItemSecao key={p.id} menu={menu}>
                <ItemMarcavel
                  menu={menu}
                  estado={marcado}
                  disabled={cheios && !marcado}
                  detalhe={p.detalhe}
                  onClick={() =>
                    aoMudar({
                      responsaveis: marcado
                        ? filtros.responsaveis.filter((x) => x !== p.id)
                        : [...filtros.responsaveis, p.id],
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
      {equipe === null && !soDesmarcar ? (
        <MensagemMenu menu={menu} erro>
          Não deu para carregar a equipe.
        </MensagemMenu>
      ) : null}
      <AvisoDoTeto menu={menu}>
        {cheios
          ? `Até ${numero.format(MAX_IDS_FILTRO)} responsáveis no filtro. Desmarque um para escolher outro.`
          : ""}
      </AvisoDoTeto>
    </PainelEscolha>
  );
}

/** Quem recebeu a campanha, da mais recente para trás, com o status ao
 *  lado. Escolher aplica e fecha. */
function FiltroCampanha({
  menu,
  aberta,
  aoFechar,
  gatilho,
  filtros,
  aoMudar,
  voltar,
  alinhar,
  campanhas,
}: BaseMenu & {
  /** null = a leitura falhou. */
  campanhas: CampanhaDoFiltro[] | null;
}) {
  const [termo, setTermo] = useState("");
  const visiveis = filtrarPorNome(campanhas ?? [], termo);
  const limpar = limparDoFiltro(menu, "button", () => {
    aoMudar({ campanha: "" });
    aoFechar();
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
      pe={filtros.campanha ? limpar.pe : null}
      acaoFolha={filtros.campanha ? limpar.acaoFolha : null}
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
            const escolhida = filtros.campanha === c.id;
            return (
              <ItemSecao key={c.id} menu={menu}>
                <ItemAcao
                  variante={menu ? "menu" : "folha"}
                  papel="button"
                  marcado={escolhida}
                  aria-pressed={escolhida}
                  detalhe={ROTULO_STATUS_CAMPANHA[c.status]}
                  onClick={() => {
                    if (!escolhida) aoMudar({ campanha: c.id });
                    aoFechar();
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

/** Tem WhatsApp (telefone) ou tem Instagram (@ ou Direct): escolher aplica
 *  e fecha. */
function FiltroCanal({
  menu,
  aberta,
  aoFechar,
  gatilho,
  filtros,
  aoMudar,
  voltar,
  alinhar,
}: BaseMenu) {
  const limpar = limparDoFiltro(menu, "menuitem", () => {
    aoMudar({ canal: "" });
    aoFechar();
  });
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
        {CANAIS.map((o) => (
          <ItemSecao key={o.valor} menu={menu}>
            <ItemAcao
              variante={menu ? "menu" : "folha"}
              papel="menuitemradio"
              marcado={filtros.canal === o.valor}
              onClick={() => {
                if (filtros.canal !== o.valor) aoMudar({ canal: o.valor });
                aoFechar();
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

/* ── O funil e as pílulas ─────────────────────────────────────────────── */

/** O período sem a data que ele olha: "Últimos 7 dias", "01/10 a 07/10".
 *  "" sem período. */
function textoDoPeriodo(f: FiltrosContatos): string {
  const atalho = ATALHOS.find((a) => a.valor === f.de);
  return atalho ? atalho.rotulo : rotuloDoPeriodo(f.de, f.ate);
}

/**
 * O valor do período na pílula. A última interação é a data de sempre da
 * lista (é por ela que a lista se ordena) e vai sem prefixo; o cadastro diz
 * que é ele: "Cadastro: hoje". O leitor de tela ouve as duas por extenso.
 */
function valorDoPeriodo(
  f: FiltrosContatos,
): { valor: string; rotulo: string } | null {
  const texto = textoDoPeriodo(f);
  if (!texto) return null;
  return f.data === "cadastro"
    ? {
        valor: `Cadastro: ${minuscula(texto)}`,
        rotulo: `Período do cadastro: ${minuscula(texto)}`,
      }
    : {
        valor: texto,
        rotulo: `Período da última interação: ${minuscula(texto)}`,
      };
}

/** "VIP", "VIP +2": o primeiro nome e quantos mais. */
function primeiroEMais(nomes: string[]): string | null {
  if (nomes.length === 0) return null;
  return nomes.length === 1
    ? nomes[0]
    : `${nomes[0]} +${numero.format(nomes.length - 1)}`;
}

/**
 * O valor das etiquetas na pílula e na lista do funil, pela mesma função da
 * fila do chat (valorDoFiltroEtiquetas): "VIP +2" (qualquer uma), "Todas:
 * VIP + Frio" e "Sem etiqueta". O nome para o leitor de tela diz o modo por
 * extenso.
 */
function valorDasEtiquetas(
  f: FiltrosContatos,
  etiquetas: EtiquetaCatalogo[] | null,
): { valor: string; rotulo: string } | null {
  return valorDoFiltroEtiquetas(
    f,
    f.etiquetas.map(
      (id) => etiquetas?.find((t) => t.id === id)?.nome ?? "Etiqueta",
    ),
  );
}

/** A ordem das pílulas, a mesma da lista do funil. */
const ORDEM: MenuFiltroContatos[] = [
  "periodo",
  "etiquetas",
  "responsaveis",
  "campanha",
  "canal",
];

/** O que o X de cada pílula manda à lista. Nas etiquetas, o modo volta ao
 *  padrão junto. */
const DESLIGAR: Record<MenuFiltroContatos, Partial<FiltrosContatos>> = {
  periodo: { de: "", ate: "" },
  etiquetas: { etiquetas: [], semEtiqueta: false, etiquetasModo: "qualquer" },
  responsaveis: { responsaveis: [] },
  campanha: { campanha: "" },
  canal: { canal: "" },
};

/**
 * Os filtros ligados agora, na ordem das pílulas. O selo do funil conta
 * estes, e não os ids de contarFiltros: Etiquetas com três marcadas é um
 * filtro, uma pílula.
 */
function filtrosLigados(f: FiltrosContatos): MenuFiltroContatos[] {
  const ligado: Record<MenuFiltroContatos, boolean> = {
    periodo: Boolean(f.de || f.ate),
    etiquetas: f.etiquetas.length > 0 || f.semEtiqueta,
    responsaveis: f.responsaveis.length > 0,
    campanha: f.campanha !== "",
    canal: f.canal !== "",
  };
  return ORDEM.filter((q) => ligado[q]);
}

/** As categorias da lista do funil. Responsáveis só para quem vê contatos
 *  de outras pessoas. */
const CATEGORIAS: { qual: MenuFiltroContatos; rotulo: string }[] = [
  { qual: "periodo", rotulo: "Período" },
  { qual: "etiquetas", rotulo: "Etiquetas" },
  { qual: "responsaveis", rotulo: "Responsáveis" },
  { qual: "campanha", rotulo: "Campanha" },
  { qual: "canal", rotulo: "Canal" },
];

const ZERADO: Record<MenuFiltroContatos, number> = {
  periodo: 0,
  etiquetas: 0,
  responsaveis: 0,
  campanha: 0,
  canal: 0,
};

/** O que a lista passa às duas metades dos filtros: o funil e as pílulas.
 *  O menu aberto mora em quem chama (`aberto`), para o pé da folha poder
 *  fechá-lo e a paleta poder abrir a lista. */
export type PropsFiltrosContatos = {
  filtros: FiltrosContatos;
  aberto: FiltroAbertoContatos | null;
  /** Abre a lista ou um menu; null fecha o que estiver aberto. */
  aoAbrir: (aberto: FiltroAbertoContatos | null) => void;
  /** Quem vê contatos de outras pessoas escolhe responsáveis. Sem isso (o
   *  atendente), a pílula só aparece com responsáveis vindos na URL, e o
   *  menu dela só desmarca. */
  escolheResponsaveis: boolean;
  /** As opções de responsável (sem os donos ocultos); null = não carregou. */
  equipe: Opcao[] | null;
  /** Os nomes do filtro que veio pela URL: a equipe com os donos ocultos e
   *  os desativados do filtro; null = não carregou. */
  nomesEquipe: MembroDoFiltro[] | null;
  /** O catálogo inteiro (ativas e arquivadas); null = não carregou. */
  etiquetas: EtiquetaCatalogo[] | null;
  /** As campanhas mais recentes; null = não carregou. */
  campanhas: CampanhaDoFiltro[] | null;
  aoMudar: (mudanca: Partial<FiltrosContatos>) => void;
  aoLimpar: () => void;
  /** O botão do funil: âncora da lista e dos menus abertos por ela, e para
   *  onde o foco vai quando a pílula que o tinha some. */
  funilRef: RefObject<HTMLButtonElement | null>;
  /** O pé da folha das escolhas múltiplas no celular ("Ver 60+ contatos"). */
  rodapeFolha: React.ReactNode;
};

/** O valor de cada filtro: à direita na lista do funil e na pílula. A
 *  pílula da campanha leva o nome do filtro na frente ("Campanha: Black
 *  Friday"): o nome solto não diz o que é. */
function valoresDosFiltros({
  filtros,
  etiquetas,
  equipe,
  nomesEquipe,
  campanhas,
}: PropsFiltrosContatos) {
  const quemTemNome: Opcao[] | null = nomesEquipe ?? equipe;
  const nomeCampanha = filtros.campanha
    ? (campanhas?.find((c) => c.id === filtros.campanha)?.nome ?? null)
    : null;
  return {
    periodo: valorDoPeriodo(filtros),
    etiquetas: valorDasEtiquetas(filtros, etiquetas),
    responsaveis: primeiroEMais(
      filtros.responsaveis.map((id) =>
        id === SEM_DONO
          ? "Sem dono"
          : (quemTemNome?.find((p) => p.id === id)?.nome ?? "Responsável"),
      ),
    ),
    campanhaNaLista: filtros.campanha ? (nomeCampanha ?? "Escolhida") : null,
    campanhaNaPilula: filtros.campanha
      ? nomeCampanha
        ? `Campanha: ${nomeCampanha}`
        : "Campanha escolhida"
      : null,
    canal: CANAIS.find((c) => c.valor === filtros.canal)?.rotulo ?? null,
  };
}

/** O menu de um filtro. Quem chama põe a chave (cada abertura monta o
 *  conteúdo de novo: a busca, as datas e a arquivada que fica até fechar
 *  nascem do filtro de agora). */
function MenuDoFiltro({
  qual,
  base,
  props,
}: {
  qual: MenuFiltroContatos;
  base: BaseMenu;
  props: PropsFiltrosContatos;
}) {
  switch (qual) {
    case "periodo":
      return <FiltroPeriodo {...base} />;
    case "etiquetas":
      return (
        <FiltroEtiquetas
          {...base}
          etiquetas={props.etiquetas}
          rodapeFolha={props.rodapeFolha}
        />
      );
    case "responsaveis":
      return (
        <FiltroResponsaveis
          {...base}
          equipe={props.equipe}
          nomesEquipe={props.nomesEquipe}
          soDesmarcar={!props.escolheResponsaveis}
          rodapeFolha={props.rodapeFolha}
        />
      );
    case "campanha":
      return <FiltroCampanha {...base} campanhas={props.campanhas} />;
    case "canal":
      return <FiltroCanal {...base} />;
  }
}

/**
 * Uma categoria da lista do funil: o nome, o valor à direita quando o
 * filtro está ligado e a seta de quem abre outro menu. 40px no menu, 48px
 * na folha com o separador encaixado, como o ItemAcao. A mesma da fila.
 */
function ItemCategoria({
  menu,
  rotulo,
  valor,
  popup,
  itemRef,
  onClick,
}: {
  menu: boolean;
  rotulo: string;
  valor: string | null;
  popup: "menu" | "dialog";
  itemRef: (el: HTMLButtonElement | null) => void;
  onClick: () => void;
}) {
  return (
    <button
      ref={itemRef}
      type="button"
      data-item=""
      role={menu ? "menuitem" : undefined}
      aria-haspopup={popup}
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
        {/* O valor corta antes do nome: "Responsáveis" fica inteiro. */}
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

/**
 * O funil à direita da busca. Tocar abre a lista "Filtrar por" (menu no
 * tablet e no desktop, folha presa no pé no celular); a categoria abre o
 * menu daquele filtro ancorado no funil, com "‹ Filtros" no topo. Esc volta
 * um nível: do menu do filtro para a lista, e da lista fecha. Ao fechar, o
 * foco volta ao funil (o menu e a folha o devolvem ao gatilho). O selo no
 * canto conta os filtros ligados, e o fundo marca o funil enquanto a lista
 * ou um menu dele estiver aberto.
 *
 * 40px de desenho (44 no toque), como o funil da fila.
 */
export function FunilFiltrosContatos(props: PropsFiltrosContatos) {
  const { filtros, aberto, aoAbrir, escolheResponsaveis, funilRef } = props;
  const menu = useTelaMd();
  const caixaRef = useRef<HTMLDivElement>(null);
  const itensRef = useRef<
    Partial<Record<MenuFiltroContatos, HTMLButtonElement | null>>
  >({});
  // De qual filtro se voltou: a lista põe o foco nele, e não no primeiro.
  const voltouDeRef = useRef<MenuFiltroContatos | null>(null);
  const [vezes, setVezes] = useState(ZERADO);

  const naLista = aberto?.qual === "lista";
  const doFunil =
    aberto && aberto.qual !== "lista" && aberto.ancora === "funil"
      ? aberto.qual
      : null;
  const expandido = naLista || doFunil !== null;
  const ligados = filtrosLigados(filtros).length;
  const valores = valoresDosFiltros(props);
  const valorNaLista: Record<MenuFiltroContatos, string | null> = {
    periodo: valores.periodo?.valor ?? null,
    etiquetas: valores.etiquetas?.valor ?? null,
    responsaveis: valores.responsaveis,
    campanha: valores.campanhaNaLista,
    canal: valores.canal,
  };
  const categorias = CATEGORIAS.filter(
    (c) => c.qual !== "responsaveis" || escolheResponsaveis,
  );

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

  // Voltou de um filtro: o foco vai à categoria de onde veio. Roda depois
  // do menu (filho), que já pôs o foco no primeiro item.
  useEffect(() => {
    if (!naLista) return;
    const de = voltouDeRef.current;
    voltouDeRef.current = null;
    if (de) itensRef.current[de]?.focus({ preventScroll: true });
  }, [naLista]);

  const fechar = () => aoAbrir(null);
  const abrirLista = () => aoAbrir({ qual: "lista" });
  const escolher = (qual: MenuFiltroContatos) => {
    setVezes((v) => ({ ...v, [qual]: v[qual] + 1 }));
    aoAbrir({ qual, ancora: "funil" });
  };
  const voltar = (de: MenuFiltroContatos) => {
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

  const itensCategorias = categorias.map((c) => (
    <ItemSecao key={c.qual} menu={menu}>
      <ItemCategoria
        menu={menu}
        rotulo={c.rotulo}
        valor={valorNaLista[c.qual]}
        popup={menu && c.qual === "canal" ? "menu" : "dialog"}
        itemRef={(el) => {
          itensRef.current[c.qual] = el;
        }}
        onClick={() => escolher(c.qual)}
      />
    </ItemSecao>
  ));

  // O que todo menu aberto pelo funil recebe.
  const base = (qual: MenuFiltroContatos): BaseMenu => ({
    menu,
    aberta: doFunil === qual,
    aoFechar: fechar,
    gatilho: funilRef,
    filtros,
    aoMudar: props.aoMudar,
    voltar: { rotulo: "Filtros", aoVoltar: () => voltar(qual) },
    // O funil fica na ponta direita da linha da busca: o menu cresce para
    // a esquerda, para dentro da tela (o MenuSuspenso troca de lado se não
    // couber).
    alinhar: "fim",
  });

  return (
    <div
      ref={caixaRef}
      onKeyDownCapture={aoTeclarAntes}
      className="relative shrink-0"
    >
      <button
        ref={funilRef}
        id={ID_FUNIL}
        type="button"
        aria-haspopup={menu ? "menu" : "dialog"}
        aria-expanded={expandido}
        aria-label={
          ligados > 0
            ? `Filtros, ${numero.format(ligados)} ${ligados === 1 ? "ativo" : "ativos"}`
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
          "relative",
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
            // O número já está no nome do botão. Preso ao canto do ícone e
            // quase todo fora dele, para a boca do funil se ler; o anel no
            // tom da página separa o selo do traço.
            <span
              aria-hidden
              className="tipo-legenda-2 absolute -top-[8px] -right-[11px] flex h-[16px] min-w-[16px] items-center justify-center rounded-full bg-tinta px-0.5 leading-none font-semibold text-fundo tabular-nums ring-2 ring-fundo"
            >
              {numero.format(ligados)}
            </span>
          ) : null}
        </span>
      </button>

      {menu ? (
        <MenuSuspenso
          aberto={naLista}
          aoFechar={fechar}
          gatilho={funilRef}
          rotulo="Filtrar por"
          alinhar="fim"
        >
          <p aria-hidden className="tipo-nota px-1 pt-1 pb-0.5 text-texto-2">
            Filtrar por
          </p>
          {itensCategorias}
        </MenuSuspenso>
      ) : (
        <Folha
          aberta={naLista}
          aoFechar={fechar}
          titulo="Filtrar por"
          retorno={funilRef}
        >
          <ItensSecao menu={false}>{itensCategorias}</ItensSecao>
        </Folha>
      )}

      {categorias.map((c) => (
        <MenuDoFiltro
          key={`${c.qual}-${vezes[c.qual]}`}
          qual={c.qual}
          base={base(c.qual)}
          props={props}
        />
      ))}
    </div>
  );
}

/**
 * Embaixo da busca, só os filtros ligados, como pílulas: o valor na tinta e
 * o X que tira o filtro; tocar abre o menu dele ancorado na pílula. Com dois
 * ou mais, "Limpar filtros" no fim. Sem filtro ligado, a linha não existe
 * (altura zero). Quebra de linha em vez de rolar de lado: nada fica
 * escondido fora da faixa.
 *
 * A pílula cujo menu está aberto fica até ele fechar, mesmo que o filtro se
 * esvazie lá dentro (desmarcar a última etiqueta): o menu mora nela. Ao
 * fechar, ela sai, e o foco que voltaria a ela vai ao funil.
 *
 * Responsáveis vale também para o atendente quando o filtro veio pela URL
 * (um link de gestor, um ?voltar= de antes da troca de papel): a pílula
 * aparece para poder sair, e o menu dela só desmarca.
 */
export function PilulasFiltrosContatos(props: PropsFiltrosContatos) {
  const { filtros, aberto, aoAbrir, aoMudar, aoLimpar, funilRef } = props;
  const menu = useTelaMd();
  const periodoRef = useRef<HTMLButtonElement>(null);
  const etiquetasRef = useRef<HTMLButtonElement>(null);
  const responsaveisRef = useRef<HTMLButtonElement>(null);
  const campanhaRef = useRef<HTMLButtonElement>(null);
  const canalRef = useRef<HTMLButtonElement>(null);
  const refs: Record<
    MenuFiltroContatos,
    RefObject<HTMLButtonElement | null>
  > = {
    periodo: periodoRef,
    etiquetas: etiquetasRef,
    responsaveis: responsaveisRef,
    campanha: campanhaRef,
    canal: canalRef,
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
  const visivel = (q: MenuFiltroContatos) =>
    ligados.includes(q) || daPilula === q;

  // O menu de uma pílula fechou e ela saiu junto (o filtro ficou vazio): o
  // menu e a folha devolvem o foco a ela, escondida, e ele se perde. Vai ao
  // funil. Roda depois da devolução (o menu é filho).
  const pilulaAntesRef = useRef<MenuFiltroContatos | null>(null);
  useEffect(() => {
    const antes = pilulaAntesRef.current;
    pilulaAntesRef.current = daPilula;
    if (antes === null || antes === daPilula || !focoPerdido()) return;
    funilRef.current?.focus({ preventScroll: true });
  }, [daPilula, funilRef]);

  const alternar = (qual: MenuFiltroContatos) => {
    if (daPilula === qual) {
      aoAbrir(null);
      return;
    }
    setVezes((v) => ({ ...v, [qual]: v[qual] + 1 }));
    aoAbrir({ qual, ancora: "pilula" });
  };

  const pilula = (
    qual: MenuFiltroContatos,
    nome: string,
    valor: string | null,
    rotulo?: string,
  ) => (
    <BotaoFiltro
      nome={nome}
      valor={valor}
      rotulo={rotulo}
      escondida={!visivel(qual)}
      aberto={daPilula === qual}
      aoAlternar={() => alternar(qual)}
      // O X: a pílula some com o filtro. O foco já foi à vizinha no clique.
      aoLimpar={() => aoMudar(DESLIGAR[qual])}
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
        props={props}
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
      {pilula(
        "periodo",
        "Período",
        valores.periodo?.valor ?? null,
        valores.periodo?.rotulo,
      )}
      {pilula(
        "etiquetas",
        "Etiquetas",
        valores.etiquetas?.valor ?? null,
        valores.etiquetas?.rotulo,
      )}
      {pilula("responsaveis", "Responsáveis", valores.responsaveis)}
      {pilula("campanha", "Campanha", valores.campanhaNaPilula)}
      {pilula("canal", "Canal", valores.canal)}

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
