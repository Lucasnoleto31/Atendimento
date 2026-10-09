"use client";

import {
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
  useSyncExternalStore,
} from "react";
import { createPortal } from "react-dom";
import { useRouter } from "next/navigation";
import { Check, ChevronDown, Minus, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Spinner } from "@/components/ui/spinner";
import { useComandosDaTela } from "@/components/app/paleta-global";
import { cn } from "@/lib/utils";
import {
  CampoBuscaMenu,
  filtrarPorNome,
  ITENS_SEM_BUSCA,
  MensagemMenu,
  PainelEscolha,
} from "../conversas/barra-filtros";
import { ItemSecao, ItensSecao, useTelaMd } from "../conversas/folha";
import { ItemMarcavel } from "../conversas/topo-fila";
import { pontoDaEtiqueta } from "./cor-etiqueta";
import {
  contarDoFiltro,
  etiquetarContatos,
  transferirContatos,
  type ResultadoEmMassa,
} from "./acoes-lista";
import { baixarCsv, DOWNLOAD_CANCELADO } from "./baixar-csv";
import {
  BuscaResponsavel,
  ItensResponsavel,
  precisaBusca,
  useCargaEquipe,
  type Destino,
} from "./escolha-responsavel";
import {
  ListaCelular,
  TabelaContatos,
  type Contato,
  type EtiquetaCatalogo,
  type Selecao,
} from "./lista-contatos";
import type { ResultadoLista } from "./filtros-lista";
import {
  TETO_FILTRO,
  urlExportarFiltro,
  urlExportarSelecao,
  type AlcanceContatos,
} from "./selecao";
import { useAvisarSelecao } from "./selecao-na-tela";

/*
 * A lista de contatos com a seleção em massa, no jeito da fila do chat
 * (conversas/massa.tsx), que é o do Gmail: "Selecionar" fica na linha que
 * diz o tamanho da lista e, ligado, o topo da página (título, busca, funil e
 * pílulas) dá lugar à barra da seleção, presa no alto enquanto a lista rola.
 * Linha 1: a caixa de "Selecionar todos", quantos estão marcados e o
 * "Cancelar". Linha 2: Etiquetas, Transferir e Exportar, conforme o papel,
 * desativados com nenhum marcado. Escolher a ação vira a confirmação com o
 * destino escrito e o "Voltar", na própria barra. No celular, o toque longo
 * numa linha também entra, já com ela marcada (como no WhatsApp).
 *
 * Antes, as ações ficavam numa barra presa no pé, que escondia a barra de
 * abas, e a contagem e o Cancelar sumiam com a lista rolada (daí um segundo
 * X no pé). A barra de abas agora fica, como no chat. O resultado (quantos
 * mudaram, quantos já estavam assim, quantos o RLS recusou) continua num
 * aviso no pé.
 *
 * A seleção vale para a página que está na tela: mudou a página ou um
 * filtro, ela recomeça. Quem não tem ação nenhuma não vê o "Selecionar".
 * Com a página inteira marcada e mais contatos no filtro, a barra diz "Os
 * 60 desta página estão marcados." e oferece "Marcar os N deste filtro"
 * (o número é um count exato, pedido só nessa hora). Escolhido, as ações
 * vão ao servidor com os filtros em vez dos ids, e ele percorre a mesma
 * consulta da lista em lotes, até TETO_FILTRO (a barra avisa antes quando
 * o filtro passa disso).
 *
 * A lista vazia (e o erro da leitura) entra aqui como `vazio`, e este
 * componente fica montado nos dois casos: a ação que esvazia a lista
 * (transferir todos os sem dono filtrados, tirar a etiqueta do filtro)
 * levava junto o aviso do resultado, que mora aqui, e o foco caía no body.
 */

type Estado = "todos" | "alguns" | "nenhum";

type Aviso = { id: number; texto: string; tom: "normal" | "erro" };

/** O total do filtro, para o "Marcar os N deste filtro". `chave` é a lista
 *  em que foi pedido: outra lista não usa o número desta. */
type ContagemFiltro = { chave: string } & (
  | { estado: "lendo" }
  | { estado: "pronta"; total: number }
  | { estado: "erro"; erro: string }
);

/** O que a confirmação da barra vai fazer. */
type AcaoContatos =
  | { tipo: "transferir"; id: string | null; nome: string }
  | { tipo: "etiquetas"; por: EtiquetaCatalogo[]; tirar: EtiquetaCatalogo[] }
  | { tipo: "exportar" };

type MenuSelecao = "etiquetas" | "transferir";

const numero = new Intl.NumberFormat("pt-BR");

/** Quanto o aviso do resultado fica na tela. */
const AVISO_MS = 6000;

const SEM_CONEXAO = "A conexão não respondeu. Confira a internet e tente de novo.";

/** "1 contato", "12 contatos". */
function qtd(n: number): string {
  return n === 1 ? "1 contato" : `${numero.format(n)} contatos`;
}

/** "VIP", "VIP e Frio", "VIP, Frio e Quente", "VIP, Frio e mais 3". */
function listaDeNomes(nomes: string[]): string {
  if (nomes.length <= 1) return nomes[0] ?? "";
  if (nomes.length <= 3) {
    return `${nomes.slice(0, -1).join(", ")} e ${nomes[nomes.length - 1]}`;
  }
  return `${nomes.slice(0, 2).join(", ")} e mais ${numero.format(nomes.length - 2)}`;
}

/** A pergunta da confirmação, com o destino escrito. */
function pergunta(a: AcaoContatos, n: number): string {
  switch (a.tipo) {
    case "transferir":
      return a.id
        ? `Transferir ${qtd(n)} para ${a.nome}?`
        : `Deixar ${qtd(n)} sem dono?`;
    case "etiquetas": {
      const partes: string[] = [];
      if (a.por.length > 0) {
        partes.push(`pôr ${listaDeNomes(a.por.map((t) => t.nome))}`);
      }
      if (a.tirar.length > 0) {
        partes.push(`tirar ${listaDeNomes(a.tirar.map((t) => t.nome))}`);
      }
      return `Em ${qtd(n)}, ${partes.join(" e ")}?`;
    }
    case "exportar":
      return `Exportar ${qtd(n)} em CSV?`;
  }
}

/** O botão que confirma: o verbo e o número. */
function botaoConfirmar(a: AcaoContatos, n: number): string {
  const q = numero.format(n);
  switch (a.tipo) {
    case "transferir":
      return a.id ? `Transferir ${q} para ${a.nome}` : `Deixar ${q} sem dono`;
    case "etiquetas":
      return `Aplicar em ${q}`;
    case "exportar":
      return "Baixar CSV";
  }
}

const ENQUANTO: Record<AcaoContatos["tipo"], string> = {
  transferir: "Transferindo…",
  etiquetas: "Aplicando…",
  exportar: "Baixando…",
};

/**
 * O que um toque faz numa etiqueta do menu: põe em todos, tira de todos e,
 * se ela estava só em parte da seleção, volta a como estava. Arquivada não
 * entra em ninguém, só sai.
 */
function proximoEstado(original: Estado, atual: Estado, podePor: boolean): Estado {
  const ciclo: Estado[] =
    original === "alguns" ? ["alguns", "todos", "nenhum"] : ["todos", "nenhum"];
  const opcoes = ciclo.filter(
    (e) => e !== "todos" || podePor || original === "todos",
  );
  return opcoes[(opcoes.indexOf(atual) + 1) % opcoes.length];
}

/** O aviso do resultado, com o número de cada desfecho. */
function avisoDoResultado(
  r: Extract<ResultadoEmMassa, { ok: true }>,
  feito: (n: number) => string,
  recusa: (n: number) => string,
): Omit<Aviso, "id"> {
  const partes = [r.mudaram > 0 ? feito(r.mudaram) : "Nada mudou."];
  if (r.iguais > 0) {
    partes.push(
      r.iguais === 1
        ? "1 já estava assim."
        : `${numero.format(r.iguais)} já estavam assim.`,
    );
  }
  if (r.recusados > 0) partes.push(recusa(r.recusados));
  return {
    texto: partes.join(" "),
    tom: r.mudaram === 0 && r.recusados > 0 ? "erro" : "normal",
  };
}

/** O tamanho da lista na linha do "Selecionar": "60+ contatos". */
function tamanhoDaLista(r: ResultadoLista): string {
  const total = `${numero.format(r.total)}${r.mais ? "+" : ""}`;
  return r.total === 1 && !r.mais ? "1 contato" : `${total} contatos`;
}

/** A seta dos botões que abrem escolhas, como na barra do chat. */
function Seta() {
  return (
    <ChevronDown
      size={14}
      strokeWidth={2}
      aria-hidden
      className="-mr-0.5 shrink-0"
    />
  );
}

const assinarNada = () => () => {};

/** As linhas de contato à vista (a lista do celular ou a tabela, a que
 *  a largura mostra). */
function linhasAVista(raiz: HTMLElement | null): HTMLElement[] {
  return Array.from(
    raiz?.querySelectorAll<HTMLElement>("[data-contato]") ?? [],
  ).filter((l) => l.getClientRects().length > 0);
}

/** A linha que fica parada ao ligar ou desligar a seleção: a tocada, ou a
 *  primeira que aparece abaixo de `limite` (o pé da barra da seleção). */
function linhaDaAncora(
  raiz: HTMLElement | null,
  id: string | undefined,
  limite: number,
): HTMLElement | null {
  const linhas = linhasAVista(raiz);
  return (
    (id ? linhas.find((l) => l.dataset.contato === id) : undefined) ??
    linhas.find((l) => l.getBoundingClientRect().bottom > limite) ??
    null
  );
}

export function ListaSelecionavel({
  contatos,
  comDono,
  chave,
  consulta,
  filtrando,
  resultado,
  etiquetas,
  destinos,
  pode,
  gestao,
  vazio,
  children,
}: {
  contatos: Contato[];
  comDono: boolean;
  /** A lista como está (filtros e página): mudou, a seleção recomeça. */
  chave: string;
  /** Os filtros como query, sem a página (consultaDosFiltros): o que vai
   *  ao servidor depois do "Marcar os N deste filtro". */
  consulta: string;
  /** Algum filtro ou busca ligado: "deste filtro"; sem nenhum, "da lista". */
  filtrando: boolean;
  /** O tamanho da lista, para a linha do "Selecionar"; null sem saber. */
  resultado: ResultadoLista | null;
  /** O catálogo inteiro, arquivadas inclusive (elas só saem). */
  etiquetas: EtiquetaCatalogo[];
  /** Para quem transferir: a equipe ativa sem quem só lê, como no chat. */
  destinos: Destino[];
  pode: { etiquetar: boolean; transferir: boolean; exportar: boolean };
  /** Admin ou gestor: veem a carga de cada pessoa no Transferir e abrem
   *  Configurações, onde as etiquetas nascem. */
  gestao: boolean;
  /** O que vai no lugar da lista sem linhas: o estado vazio ou o erro. */
  vazio: React.ReactNode;
  /** O paginador, embaixo da lista. */
  children?: React.ReactNode;
}) {
  const router = useRouter();
  const menu = useTelaMd();
  const vazia = contatos.length === 0;
  const algumaAcao =
    !vazia && (pode.etiquetar || pode.transferir || pode.exportar);

  const [modo, setModo] = useState(false);
  const [marcados, setMarcados] = useState<ReadonlySet<string>>(
    () => new Set(),
  );
  // A última linha mexida: o Shift + clique leva o intervalo desde ela.
  const [ancora, setAncora] = useState<string | null>(null);

  // Outra página ou outro filtro: a seleção recomeça, e o modo fica (quem
  // está passando a base de página em página segue marcando). Ajuste na
  // renderização, sem efeito, para a barra não mostrar a contagem velha.
  const [aberto, setAberto] = useState<MenuSelecao | null>(null);
  const [confirmar, setConfirmar] = useState<AcaoContatos | null>(null);
  // "Marcar os N deste filtro": a contagem pedida e, escolhido, o total do
  // filtro (null: a seleção é a da página).
  const [contagemFiltro, setContagemFiltro] =
    useState<ContagemFiltro | null>(null);
  const [doFiltro, setDoFiltro] = useState<number | null>(null);
  const [chaveVista, setChaveVista] = useState(chave);
  if (chave !== chaveVista) {
    setChaveVista(chave);
    setMarcados(new Set());
    setAncora(null);
    // A confirmação era sobre as linhas da página que saiu.
    setAberto(null);
    setConfirmar(null);
    setDoFiltro(null);
  }

  const [pendente, setPendente] = useState(false);
  const [erro, setErro] = useState<string | null>(null);
  // Etiquetas: só as que mudaram, com o estado pedido.
  const [alvos, setAlvos] = useState<Record<string, Estado>>({});
  const [termoEtiqueta, setTermoEtiqueta] = useState("");
  const [termoPessoa, setTermoPessoa] = useState("");
  const { carga, ler: lerCarga } = useCargaEquipe(gestao);

  // A lista ficou vazia com a seleção ligada: não há o que marcar, e a
  // barra ficaria sem ação nenhuma.
  if (vazia && modo) {
    setModo(false);
    setMarcados(new Set());
    setAncora(null);
    setAberto(null);
    setConfirmar(null);
    setDoFiltro(null);
  }

  const [aviso, setAviso] = useState<Aviso | null>(null);
  const contadorAviso = useRef(0);
  const mostrarAviso = (a: Omit<Aviso, "id">) => {
    contadorAviso.current += 1;
    setAviso({ ...a, id: contadorAviso.current });
  };
  useEffect(() => {
    if (!aviso) return;
    const relogio = window.setTimeout(() => setAviso(null), AVISO_MS);
    return () => window.clearTimeout(relogio);
  }, [aviso]);

  const raiz = useRef<HTMLDivElement>(null);
  const caixaVazio = useRef<HTMLDivElement>(null);
  const botaoModo = useRef<HTMLButtonElement>(null);
  const todosRef = useRef<HTMLButtonElement>(null);
  const confirmarRef = useRef<HTMLButtonElement>(null);
  const gatilhoEtiquetas = useRef<HTMLButtonElement>(null);
  const gatilhoTransferir = useRef<HTMLButtonElement>(null);
  const gatilhoExportar = useRef<HTMLButtonElement>(null);
  // De qual botão saiu a confirmação: o "Voltar" devolve o foco a ele.
  const origemConfirmar = useRef<HTMLButtonElement | null>(null);
  // Entrou pela palavra "Selecionar" (ou pela paleta): o foco vai para a
  // caixa de "Selecionar todos", que é onde a barra começa.
  const focarTodosDepois = useRef(false);
  // O "Marcar os N deste filtro" some ao ser tocado (vira o aviso): o foco
  // vai para a caixa de "Selecionar todos", em vez de cair no body.
  const focarDepoisDoFiltro = useRef(false);
  const barraRef = useRef<HTMLDivElement>(null);

  // O topo da página (Exportar, busca, funil) sabe da seleção: os comandos
  // dele saem da paleta enquanto ela está ligada.
  useAvisarSelecao(modo);

  // Ligar a seleção tira o topo da página (título, busca, funil, pílulas e
  // a linha do "Selecionar", uns 150 a 200px no celular) de cima das
  // linhas; desligar devolve. Sem a âncora de rolagem do navegador (o
  // Safari do iPhone não tem), a linha que estava sob o dedo pulava esse
  // tanto. Antes da troca, guarda onde está a linha tocada (ou a primeira à
  // vista); depois de desenhar e antes de pintar, rola o que ela andou. A
  // âncora do Chrome fica desligada nesse quadro, para as duas não somarem.
  const ancoraRolagem = useRef<{ id: string; topo: number } | null>(null);
  const guardarRolagem = (id?: string) => {
    const limite = modo
      ? (barraRef.current?.getBoundingClientRect().bottom ?? 0)
      : 0;
    const linha = linhaDaAncora(raiz.current, id, limite);
    const qual = linha?.dataset.contato;
    if (!linha || !qual) return;
    ancoraRolagem.current = {
      id: qual,
      topo: linha.getBoundingClientRect().top,
    };
    document.documentElement.style.overflowAnchor = "none";
  };
  useLayoutEffect(() => {
    const ancora = ancoraRolagem.current;
    if (!ancora) return;
    ancoraRolagem.current = null;
    const linha = linhasAVista(raiz.current).find(
      (l) => l.dataset.contato === ancora.id,
    );
    if (linha) {
      const andou = linha.getBoundingClientRect().top - ancora.topo;
      if (Math.abs(andou) >= 1) window.scrollBy(0, andou);
    }
    // A âncora do navegador volta no quadro seguinte, com a página parada.
    const html = document.documentElement;
    requestAnimationFrame(() => {
      html.style.overflowAnchor = "";
    });
  }, [modo]);

  // Saiu da seleção com o foco no que some (a barra, as caixas das linhas,
  // a folha que fecha) ou solto no body: ele volta ao "Selecionar", de onde
  // ela se abre de novo. Com a lista vazia não há "Selecionar": vai para o
  // botão do estado vazio ("Limpar filtros", "Ir para a primeira página")
  // ou, sem botão, para o título dele.
  const focarBotaoDepois = useRef(false);
  const vaziaAntes = useRef(vazia);
  useEffect(() => {
    if (modo && focarTodosDepois.current) {
      focarTodosDepois.current = false;
      todosRef.current?.focus({ preventScroll: true });
    }
    const esvaziou = vazia && !vaziaAntes.current;
    vaziaAntes.current = vazia;
    const pedido = !modo && focarBotaoDepois.current;
    if (pedido) focarBotaoDepois.current = false;
    if (!pedido && !esvaziou) return;
    // A lista esvaziou sem a seleção ter pedido: só cuida do foco que ficou
    // solto (o que estava numa linha que saiu).
    const ativo = document.activeElement;
    if (
      !pedido &&
      ativo &&
      ativo !== document.body &&
      ativo.isConnected
    ) {
      return;
    }
    const noVazio =
      caixaVazio.current?.querySelector<HTMLElement>(
        "a[href], button:not([disabled])",
      ) ?? caixaVazio.current?.querySelector<HTMLElement>("h2");
    (botaoModo.current ?? noVazio)?.focus({ preventScroll: true });
  }, [modo, vazia]);

  // A confirmação abriu: o foco vai ao botão que confirma (o menu que a
  // pediu saiu de cena com o gatilho). Fechou pelo "Voltar" ou pelo Esc:
  // volta ao botão da ação, se o foco ficou sem lugar.
  const confirmandoAntes = useRef(false);
  useEffect(() => {
    const antes = confirmandoAntes.current;
    confirmandoAntes.current = confirmar !== null;
    if (confirmar && !antes) {
      confirmarRef.current?.focus({ preventScroll: true });
      return;
    }
    if (!confirmar && antes && modo) {
      const ativo = document.activeElement;
      if (ativo && ativo !== document.body && ativo.isConnected) return;
      (origemConfirmar.current?.isConnected
        ? origemConfirmar.current
        : todosRef.current
      )?.focus({ preventScroll: true });
    }
  }, [confirmar, modo]);

  const ids = useMemo(() => contatos.map((c) => c.id), [contatos]);
  // A ação vale para o que está marcado E na tela, na ordem da lista; com o
  // filtro inteiro marcado, para ele, até o teto.
  const selecionados = ids.filter((id) => marcados.has(id));
  const naTela = selecionados.length;
  const n = doFiltro !== null ? Math.min(doFiltro, TETO_FILTRO) : naTela;
  const nenhum = n === 0;
  const todos: boolean | "misto" =
    naTela === 0 ? false : naTela >= ids.length ? true : "misto";

  // O filtro tem mais que esta página (outra página antes ou depois): é aí
  // que o "Marcar os N deste filtro" faz sentido.
  const listaMaior =
    resultado !== null && (resultado.mais || resultado.total > ids.length);
  const contagemAqui =
    contagemFiltro?.chave === chave ? contagemFiltro : null;
  const recorte = filtrando ? "deste filtro" : "da lista";
  const oRecorte = filtrando ? "O filtro" : "A lista";

  /** Pede o total do filtro (count exato, sem linhas). A resposta que
   *  chega depois de a lista mudar fica com a chave velha e não vale. */
  async function pedirContagem() {
    const pedida = chave;
    setContagemFiltro({ chave: pedida, estado: "lendo" });
    let r: Awaited<ReturnType<typeof contarDoFiltro>>;
    try {
      r = await contarDoFiltro(consulta);
    } catch {
      r = { ok: false, erro: SEM_CONEXAO };
    }
    setContagemFiltro((atual) =>
      atual?.chave !== pedida
        ? atual
        : r.ok
          ? { chave: pedida, estado: "pronta", total: r.total }
          : { chave: pedida, estado: "erro", erro: r.erro },
    );
  }

  /** Troca o que está marcado na tela. Mexer numa linha desfaz o "filtro
   *  inteiro"; a página inteira marcada pede o total do filtro, uma vez. */
  const trocarMarcados = (novo: ReadonlySet<string>) => {
    setMarcados(novo);
    setDoFiltro(null);
    const paginaInteira = ids.length > 0 && ids.every((id) => novo.has(id));
    if (paginaInteira && listaMaior && contagemAqui === null) {
      void pedirContagem();
    }
  };

  /** "Marcar os N deste filtro": a página continua marcada, e as ações
   *  passam a valer para o filtro. */
  const marcarDoFiltro = (total: number) => {
    focarDepoisDoFiltro.current = true;
    setMarcados(new Set(ids));
    setDoFiltro(total);
  };

  useEffect(() => {
    if (doFiltro === null || !focarDepoisDoFiltro.current) return;
    focarDepoisDoFiltro.current = false;
    const ativo = document.activeElement;
    if (!ativo || ativo === document.body || !ativo.isConnected) {
      todosRef.current?.focus({ preventScroll: true });
    }
  }, [doFiltro]);

  /* ── marcar ──────────────────────────────────────────────────────────── */

  const alternar = (id: string, faixa = false) => {
    const marcar = !marcados.has(id);
    const novo = new Set(marcados);
    const de = ancora ? ids.indexOf(ancora) : -1;
    const ate = ids.indexOf(id);
    if (faixa && de >= 0 && ate >= 0 && de !== ate) {
      for (const x of ids.slice(Math.min(de, ate), Math.max(de, ate) + 1)) {
        if (marcar) novo.add(x);
        else novo.delete(x);
      }
    } else if (marcar) {
      novo.add(id);
    } else {
      novo.delete(id);
    }
    trocarMarcados(novo);
    setAncora(id);
  };

  const alternarTodos = () => {
    trocarMarcados(todos === true ? new Set() : new Set(ids));
    setAncora(null);
  };

  const limparAcoes = () => {
    setAberto(null);
    setConfirmar(null);
    setErro(null);
    setPendente(false);
  };

  /** Entra na seleção; com `id` (o toque longo), já com a linha marcada. */
  const entrar = (id?: string) => {
    if (!modo) guardarRolagem(id);
    limparAcoes();
    // O aviso do lote anterior sai.
    setAviso(null);
    setContagemFiltro(null);
    trocarMarcados(new Set(id ? [id] : []));
    setAncora(id ?? null);
    focarTodosDepois.current = !id;
    setModo(true);
  };

  const sair = () => {
    if (modo) guardarRolagem();
    const ativo = document.activeElement;
    if (
      !ativo ||
      ativo === document.body ||
      raiz.current?.contains(ativo) ||
      ativo.closest('[role="dialog"]')
    ) {
      focarBotaoDepois.current = true;
    }
    limparAcoes();
    setMarcados(new Set());
    setDoFiltro(null);
    // A lista pode ter mudado com a ação: o total do filtro se conta de
    // novo na próxima vez.
    setContagemFiltro(null);
    setAncora(null);
    setModo(false);
  };

  const selecao: Selecao | null = algumaAcao
    ? { ativa: modo, marcados, alternar, iniciar: entrar }
    : null;

  /** Escolheu a ação num menu (ou o Exportar): a barra vira a confirmação. */
  const pedir = (
    acao: AcaoContatos,
    origem: React.RefObject<HTMLButtonElement | null>,
  ) => {
    origemConfirmar.current = origem.current;
    setAberto(null);
    setErro(null);
    setConfirmar(acao);
  };

  const voltarDaConfirmacao = () => {
    if (pendente) return;
    setConfirmar(null);
    setErro(null);
  };

  // O download da seleção em curso. O Cancelar (e o Esc) param a busca; a
  // confirmação fica, e o aviso lembra que o log pode já ter o registro.
  const controleExportar = useRef<AbortController | null>(null);
  const cancelarExportar = () => {
    if (!controleExportar.current) return;
    controleExportar.current.abort();
    controleExportar.current = null;
    setPendente(false);
    mostrarAviso({ texto: DOWNLOAD_CANCELADO, tom: "normal" });
  };
  // Saiu da tela no meio do download: o arquivo não aparece depois.
  useEffect(() => {
    const c = controleExportar;
    return () => c.current?.abort();
  }, []);

  /* ── etiquetas ───────────────────────────────────────────────────────── */

  // Em quantos dos selecionados cada etiqueta está.
  const naSelecao = useMemo(() => {
    const mapa = new Map<string, number>();
    for (const c of contatos) {
      if (!marcados.has(c.id)) continue;
      for (const t of c.etiquetas) mapa.set(t.id, (mapa.get(t.id) ?? 0) + 1);
    }
    return mapa;
  }, [contatos, marcados]);

  const estadoOriginal = (id: string): Estado => {
    // Com o filtro inteiro, não se sabe em quais dos N cada etiqueta está:
    // toda etiqueta começa "como está", e o toque põe em todos ou tira.
    if (doFiltro !== null) return "alguns";
    const quantos = naSelecao.get(id) ?? 0;
    return quantos === 0 ? "nenhum" : quantos >= n ? "todos" : "alguns";
  };

  // Ativas, e as arquivadas que algum selecionado ainda tem (para tirar).
  // Com o filtro inteiro, naSelecao só conhece a página à vista, e a
  // arquivada pode estar nos outros: entram todas, só para tirar
  // (proximoEstado não deixa pôr arquivada).
  const opcoesEtiqueta = etiquetas.filter(
    (t) => t.ativo || doFiltro !== null || (naSelecao.get(t.id) ?? 0) > 0,
  );
  const etiquetasVisiveis = filtrarPorNome(opcoesEtiqueta, termoEtiqueta);
  const por = opcoesEtiqueta.filter((t) => alvos[t.id] === "todos");
  const tirar = opcoesEtiqueta.filter((t) => alvos[t.id] === "nenhum");
  const mudaEtiquetas = por.length + tirar.length > 0;

  const alternarMenu = (qual: MenuSelecao) => {
    if (aberto === qual) {
      setAberto(null);
      return;
    }
    setErro(null);
    if (qual === "etiquetas") {
      setAlvos({});
      setTermoEtiqueta("");
    } else {
      setTermoPessoa("");
      void lerCarga();
    }
    setAberto(qual);
  };

  const tocarEtiqueta = (t: EtiquetaCatalogo) => {
    const original = estadoOriginal(t.id);
    const proximo = proximoEstado(original, alvos[t.id] ?? original, t.ativo);
    setAlvos((atual) => {
      const novo = { ...atual };
      if (proximo === original) delete novo[t.id];
      else novo[t.id] = proximo;
      return novo;
    });
  };

  const aplicarEtiquetas = (
    <Button
      className="w-full pointer-coarse:h-[44px]"
      disabled={!mudaEtiquetas || nenhum}
      onClick={() =>
        pedir({ tipo: "etiquetas", por, tirar }, gatilhoEtiquetas)
      }
    >
      Aplicar
    </Button>
  );

  /* ── as ações ────────────────────────────────────────────────────────── */

  async function executar() {
    if (!confirmar || nenhum || pendente) return;
    const acao = confirmar;
    const quantos = n;
    setPendente(true);
    setErro(null);

    // Os ids da tela, ou o filtro inteiro (o servidor relê a consulta).
    const alcance: AlcanceContatos =
      doFiltro !== null ? { filtro: consulta } : selecionados;
    // O servidor disse que cortou no teto: o aviso do resultado lembra. O
    // número e o corte vêm dele, não da contagem que a barra fez antes (o
    // filtro pode ter mudado no meio).
    const aviseCorte = (cortado: boolean | undefined) =>
      cortado
        ? ` ${oRecorte} passava de ${numero.format(TETO_FILTRO)}: os seguintes ficaram de fora.`
        : "";

    if (acao.tipo === "exportar") {
      // Pela mesma rota da exportação (mesma trava de papel, mesmo log de
      // acesso), buscada e não por link: o erro aparece na barra. Durante o
      // download o Voltar vira Cancelar (cancelarExportar).
      const c = new AbortController();
      controleExportar.current = c;
      const r = await baixarCsv(
        Array.isArray(alcance)
          ? urlExportarSelecao(alcance)
          : urlExportarFiltro(alcance.filtro),
        c.signal,
      );
      // Cancelado: quem cancelou já arrumou a barra.
      if (controleExportar.current !== c) return;
      controleExportar.current = null;
      setPendente(false);
      if (!r.ok) {
        setErro(r.erro);
        return;
      }
      sair();
      mostrarAviso({
        texto: `CSV com ${qtd(r.linhas ?? quantos)} baixado.${aviseCorte(r.cortado)}`,
        tom: "normal",
      });
      return;
    }

    let r: ResultadoEmMassa;
    try {
      r =
        acao.tipo === "etiquetas"
          ? await etiquetarContatos(
              alcance,
              acao.por.map((t) => t.id),
              acao.tirar.map((t) => t.id),
            )
          : await transferirContatos(alcance, acao.id);
    } catch {
      r = { ok: false, erro: SEM_CONEXAO };
      // Sem resposta, a escrita pode ter acontecido: a lista recarrega.
      router.refresh();
    }
    setPendente(false);
    if (!r.ok) {
      setErro(r.erro);
      return;
    }
    sair();
    const corte = aviseCorte(r.cortado);

    if (acao.tipo === "etiquetas") {
      const a = avisoDoResultado(
        r,
        (q) => `Etiquetas atualizadas em ${qtd(q)}.`,
        (q) => `Você não pode alterar ${qtd(q)}.`,
      );
      mostrarAviso({ ...a, texto: a.texto + corte });
      return;
    }

    const para = acao.id ? acao.nome : null;
    // Passou para alguém cujos contatos esta pessoa não vê (Administração >
    // Privacidade): eles saem da lista, e o aviso diz por quê.
    const somem = r.saemDaVista
      ? ` Você não vê os contatos de ${para ?? "quem recebeu"}: ${r.mudaram === 1 ? "ele sai" : "eles saem"} da sua lista.`
      : "";
    // A troca valeu, mas a linha "Atendimento atribuído a…" não entrou no
    // histórico das conversas.
    const historico = r.semHistorico
      ? " O histórico das conversas não registrou a troca."
      : "";
    const a = avisoDoResultado(
      r,
      (q) =>
        para
          ? `${qtd(q)} ${q === 1 ? "passou" : "passaram"} para ${para}.${somem}${historico}`
          : `${qtd(q)} ${q === 1 ? "ficou" : "ficaram"} sem dono.${historico}`,
      (q) => `Você não pode transferir ${qtd(q)}.`,
    );
    mostrarAviso({ ...a, texto: a.texto + corte });
  }

  /* ── o filtro inteiro ────────────────────────────────────────────────── */

  // A página inteira marcada, mais contatos no filtro e nada a confirmar:
  // a linha do "Marcar os N deste filtro" (ou, já marcado, o aviso dele).
  const ofereceFiltro =
    modo &&
    !confirmar &&
    doFiltro === null &&
    listaMaior &&
    ids.length > 0 &&
    naTela === ids.length &&
    !(contagemAqui?.estado === "pronta" && contagemAqui.total <= ids.length);

  /** "Marcar os 1.234 deste filtro"; passou do teto, "Marcar os primeiros
   *  5.000". */
  const rotuloMarcarFiltro = (total: number) =>
    total > TETO_FILTRO
      ? `Marcar os primeiros ${numero.format(TETO_FILTRO)}`
      : `Marcar os ${numero.format(total)} ${recorte}`;

  const linhaDoFiltro =
    modo && !confirmar && doFiltro !== null ? (
      <p
        role="status"
        className="tipo-nota mt-0.5 rounded-controle bg-cartao px-1 py-0.5 text-texto-2"
      >
        {doFiltro > TETO_FILTRO
          ? `Marcados os primeiros ${numero.format(TETO_FILTRO)} dos ${numero.format(doFiltro)} ${recorte}, o limite por ação.`
          : `Os ${numero.format(doFiltro)} ${recorte} estão marcados.`}
      </p>
    ) : ofereceFiltro ? (
      <div className="mt-0.5 flex flex-wrap items-center gap-x-1 rounded-controle bg-cartao py-0.5 pr-0.5 pl-1">
        <p
          role={contagemAqui?.estado === "erro" ? "alert" : undefined}
          className={cn(
            "tipo-nota min-w-0 flex-1",
            contagemAqui?.estado === "erro" ? "text-erro" : "text-texto-2",
          )}
        >
          {contagemAqui?.estado === "erro"
            ? contagemAqui.erro
            : ids.length === 1
              ? "O contato desta página está marcado."
              : `Os ${numero.format(ids.length)} desta página estão marcados.`}
          {contagemAqui?.estado === "pronta" &&
          contagemAqui.total > TETO_FILTRO
            ? ` ${oRecorte} tem ${numero.format(contagemAqui.total)}, e cada ação vai até ${numero.format(TETO_FILTRO)}.`
            : null}
        </p>
        {/* Durante a contagem o botão não se desativa (desativado, largava
            o foco no body): fica aria-disabled, com o indicador, e o toque
            é ignorado, como na fila do chat. */}
        <Button
          variant="ghost"
          size="sm"
          className="shrink-0 px-1 font-semibold text-tinta pointer-coarse:h-[44px]"
          aria-disabled={contagemAqui?.estado === "lendo" || undefined}
          aria-busy={contagemAqui?.estado === "lendo" || undefined}
          icone={
            contagemAqui?.estado === "lendo" ? (
              <Spinner tamanho={16} />
            ) : undefined
          }
          onClick={() => {
            if (contagemAqui?.estado === "lendo") return;
            if (contagemAqui?.estado === "pronta") {
              marcarDoFiltro(contagemAqui.total);
              return;
            }
            void pedirContagem();
          }}
        >
          {contagemAqui?.estado === "lendo"
            ? "Contando…"
            : contagemAqui?.estado === "erro"
              ? "Tentar de novo"
              : contagemAqui?.estado === "pronta"
                ? rotuloMarcarFiltro(contagemAqui.total)
                : `Marcar todos ${recorte}`}
        </Button>
      </div>
    ) : null;

  /* ── teclado e paleta ────────────────────────────────────────────────── */

  // O Esc lê o sair(), o voltar e o cancelar mais novos.
  const sairRef = useRef(sair);
  const voltarRef = useRef(voltarDaConfirmacao);
  const cancelarRef = useRef(cancelarExportar);
  useEffect(() => {
    sairRef.current = sair;
    voltarRef.current = voltarDaConfirmacao;
    cancelarRef.current = cancelarExportar;
  });

  // Esc volta da confirmação ou sai da seleção. Folha, menu e a paleta
  // cuidam do próprio Esc; campo de texto também (a busca limpa).
  useEffect(() => {
    if (!modo) return;
    const aoTeclar = (e: KeyboardEvent) => {
      if (e.key !== "Escape" || e.defaultPrevented) return;
      if (document.querySelector('[aria-modal="true"], [data-popover]')) return;
      const alvo = e.target as HTMLElement | null;
      if (
        alvo &&
        (alvo.isContentEditable ||
          ["TEXTAREA", "SELECT"].includes(alvo.tagName) ||
          (alvo instanceof HTMLInputElement && alvo.type !== "checkbox"))
      ) {
        return;
      }
      if (pendente) {
        // No meio do download, o Esc cancela, como o botão.
        if (confirmar?.tipo === "exportar") {
          e.preventDefault();
          cancelarRef.current();
        }
        return;
      }
      e.preventDefault();
      if (confirmar) {
        voltarRef.current();
        return;
      }
      sairRef.current();
    };
    window.addEventListener("keydown", aoTeclar);
    return () => window.removeEventListener("keydown", aoTeclar);
  }, [modo, pendente, confirmar]);

  // Os comandos da seleção na paleta (⌘K / Ctrl+K).
  useComandosDaTela(
    !algumaAcao
      ? []
      : !modo
        ? [
            {
              id: "contatos-selecionar",
              rotulo: "Selecionar contatos",
              grupo: "Contatos",
              executar: () => entrar(),
            },
          ]
        : [
            {
              id: "contatos-selecionar-todos",
              rotulo:
                todos === true
                  ? "Desmarcar todos desta página"
                  : "Selecionar todos desta página",
              grupo: "Seleção",
              executar: alternarTodos,
            },
            ...(ofereceFiltro && contagemAqui?.estado === "pronta"
              ? [
                  {
                    id: "contatos-selecao-filtro",
                    rotulo: rotuloMarcarFiltro(contagemAqui.total),
                    grupo: "Seleção",
                    executar: () => marcarDoFiltro(contagemAqui.total),
                  },
                ]
              : []),
            ...(!nenhum && pode.etiquetar
              ? [
                  {
                    id: "contatos-selecao-etiquetas",
                    rotulo: "Pôr ou tirar etiquetas",
                    grupo: "Seleção",
                    executar: () => {
                      setConfirmar(null);
                      alternarMenu("etiquetas");
                    },
                  },
                ]
              : []),
            ...(!nenhum && pode.transferir
              ? [
                  {
                    id: "contatos-selecao-transferir",
                    rotulo: "Transferir responsável",
                    grupo: "Seleção",
                    executar: () => {
                      setConfirmar(null);
                      alternarMenu("transferir");
                    },
                  },
                ]
              : []),
            ...(!nenhum && pode.exportar
              ? [
                  {
                    id: "contatos-selecao-exportar",
                    rotulo: "Exportar seleção em CSV",
                    grupo: "Seleção",
                    executar: () =>
                      pedir({ tipo: "exportar" }, gatilhoExportar),
                  },
                ]
              : []),
            {
              id: "contatos-selecao-sair",
              rotulo: "Sair da seleção",
              grupo: "Seleção",
              atalho: "Esc",
              executar: sair,
            },
          ],
  );

  // O aviso mora fora do @container da página: com a contenção de layout
  // dele, um fixed dentro dele se prende à página, não à janela. No
  // [data-casca], ele lê o --casca-pe e fica acima da barra de abas.
  const noNavegador = useSyncExternalStore(
    assinarNada,
    () => true,
    () => false,
  );

  const comBuscaPessoa = precisaBusca(destinos);
  const baixandoSelecao = pendente && confirmar?.tipo === "exportar";

  /* ── desenho ─────────────────────────────────────────────────────────── */

  return (
    <div
      ref={raiz}
      data-selecionando={modo ? "" : undefined}
      className="flex flex-1 flex-col"
    >
      {modo ? (
        // Presa no alto enquanto a lista rola: a contagem, o Cancelar e as
        // ações ficam à vista em qualquer ponto da página. O fundo e o fio
        // vão na largura toda da coluna (a margem negativa come o recuo).
        <div
          ref={barraRef}
          role="region"
          aria-label="Contatos selecionados"
          className="sticky top-0 z-20 -mx-2 mb-1 border-b border-fio bg-fundo px-2 pt-1 pb-1.5 md:-mx-3 md:px-3"
        >
          {confirmar ? (
            <div className="flex flex-col gap-1 @2xl:flex-row @2xl:items-center @2xl:gap-2">
              <div className="min-w-0 @2xl:flex-1">
                <p className="tipo-corpo [overflow-wrap:anywhere] text-tinta">
                  {pergunta(confirmar, n)}
                </p>
                {doFiltro !== null && doFiltro > TETO_FILTRO ? (
                  <p className="tipo-nota mt-0.5 text-texto-2">
                    São os primeiros {numero.format(TETO_FILTRO)} dos{" "}
                    {numero.format(doFiltro)} {recorte}, na ordem da lista.
                  </p>
                ) : null}
              </div>
              <div className="flex gap-1.5">
                {/* No meio do download o Voltar vira Cancelar; nas outras
                    ações ele espera a resposta. */}
                <Button
                  variant="secondary"
                  disabled={pendente && !baixandoSelecao}
                  onClick={
                    baixandoSelecao ? cancelarExportar : voltarDaConfirmacao
                  }
                  className="pointer-coarse:h-[44px]"
                >
                  {baixandoSelecao ? "Cancelar" : "Voltar"}
                </Button>
                {/* Durante a ação o botão não se desativa (o carregando do
                    Button desativaria): desativado, ele largava o foco no
                    body, e o leitor de tela perdia o lugar. Fica
                    aria-disabled, com o indicador, e o toque é ignorado. */}
                <Button
                  ref={confirmarRef}
                  disabled={nenhum}
                  aria-disabled={pendente || undefined}
                  aria-busy={pendente || undefined}
                  icone={pendente ? <Spinner tamanho={16} /> : undefined}
                  onClick={() => void executar()}
                  className="min-w-0 flex-1 pointer-coarse:h-[44px] @2xl:flex-none"
                >
                  <span className="truncate">
                    {pendente
                      ? ENQUANTO[confirmar.tipo]
                      : botaoConfirmar(confirmar, n)}
                  </span>
                </Button>
              </div>
            </div>
          ) : (
            <>
              <div className="flex min-h-[48px] items-center gap-1">
                {/* A caixa fica na mesma coluna das caixas das linhas (16px
                    da borda): o -ml-1 com o pl-1 a põe lá, num alvo de 44px. */}
                <button
                  ref={todosRef}
                  type="button"
                  role="checkbox"
                  aria-checked={todos === "misto" ? "mixed" : todos}
                  aria-label={`Selecionar todos desta página (${numero.format(ids.length)})`}
                  title={`Selecionar todos desta página (${numero.format(ids.length)})`}
                  onClick={alternarTodos}
                  className="group/todos -ml-1 flex h-[44px] w-[44px] shrink-0 items-center rounded-controle pl-1 transition-colors duration-[120ms] hover:bg-realce active:bg-pressionado focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-tinta"
                >
                  <span
                    aria-hidden
                    className={cn(
                      "flex h-[20px] w-[20px] shrink-0 items-center justify-center rounded-celula border",
                      todos === false
                        ? "border-fio-forte bg-fundo"
                        : "border-tinta bg-tinta text-fundo",
                    )}
                  >
                    {todos === true ? (
                      <Check size={14} strokeWidth={2.5} />
                    ) : todos === "misto" ? (
                      <Minus size={14} strokeWidth={2.5} />
                    ) : null}
                  </span>
                </button>
                <p
                  role="status"
                  className={cn(
                    "min-w-0 flex-1",
                    nenhum
                      ? "tipo-corpo truncate text-texto-2"
                      : "tipo-destaque truncate text-tinta tabular-nums",
                  )}
                >
                  {nenhum
                    ? "Marque os contatos na lista"
                    : n === 1
                      ? "1 selecionado"
                      : `${numero.format(n)} selecionados`}
                </p>
                <Button
                  ref={botaoModo}
                  variant="ghost"
                  className="-mr-1 shrink-0 px-1 pointer-coarse:h-[44px]"
                  disabled={pendente}
                  onClick={sair}
                  title="Sair da seleção (Esc)"
                >
                  Cancelar
                </Button>
              </div>
              {linhaDoFiltro}
              <div className="mt-0.5 flex flex-wrap gap-1 pointer-coarse:gap-1.5">
                {pode.etiquetar ? (
                  <div className="relative">
                    <Button
                      ref={gatilhoEtiquetas}
                      variant="secondary"
                      size="sm"
                      className="gap-0.5"
                      aria-haspopup="dialog"
                      aria-expanded={aberto === "etiquetas"}
                      disabled={nenhum}
                      onClick={() => alternarMenu("etiquetas")}
                    >
                      Etiquetas
                      <Seta />
                    </Button>
                    <PainelEscolha
                      menu={menu}
                      aberta={aberto === "etiquetas"}
                      aoFechar={() => setAberto(null)}
                      titulo={`Etiquetas de ${qtd(n)}`}
                      gatilho={gatilhoEtiquetas}
                      aviso={
                        doFiltro !== null && opcoesEtiqueta.length > 0
                          ? "Um toque põe em todos; outro tira de todos."
                          : undefined
                      }
                      topo={
                        opcoesEtiqueta.length > ITENS_SEM_BUSCA ? (
                          <CampoBuscaMenu
                            valor={termoEtiqueta}
                            aoMudar={setTermoEtiqueta}
                            rotulo="Buscar etiqueta"
                            placeholder="Buscar etiqueta"
                          />
                        ) : null
                      }
                      pe={opcoesEtiqueta.length > 0 ? aplicarEtiquetas : null}
                      rodapeFolha={
                        opcoesEtiqueta.length > 0 ? aplicarEtiquetas : null
                      }
                    >
                      {opcoesEtiqueta.length === 0 ? (
                        // Configurações só abre para a gestão: para os
                        // outros, a dica mandaria para uma tela que não
                        // existe para eles.
                        <MensagemMenu menu={menu}>
                          {gestao
                            ? "Nenhuma etiqueta ativa. As etiquetas ficam em Configurações."
                            : "Nenhuma etiqueta ativa. Peça à gestão para criar etiquetas."}
                        </MensagemMenu>
                      ) : etiquetasVisiveis.length === 0 ? (
                        <MensagemMenu menu={menu}>
                          Nenhuma etiqueta com “{termoEtiqueta.trim()}”.
                        </MensagemMenu>
                      ) : (
                        <ItensSecao menu={menu}>
                          {etiquetasVisiveis.map((t) => {
                            const original = estadoOriginal(t.id);
                            const estado = alvos[t.id] ?? original;
                            const contagem =
                              estado === "todos"
                                ? n
                                : estado === "nenhum"
                                  ? 0
                                  : (naSelecao.get(t.id) ?? 0);
                            return (
                              <ItemSecao key={t.id} menu={menu}>
                                <ItemMarcavel
                                  menu={menu}
                                  estado={
                                    estado === "todos"
                                      ? true
                                      : estado === "nenhum"
                                        ? false
                                        : "misto"
                                  }
                                  ponto={pontoDaEtiqueta(t.cor)}
                                  detalhe={
                                    // Com o filtro inteiro, "como está" não
                                    // tem número.
                                    doFiltro !== null && estado === "alguns"
                                      ? undefined
                                      : `${numero.format(contagem)} de ${numero.format(n)}`
                                  }
                                  onClick={() => tocarEtiqueta(t)}
                                >
                                  {/* O que o toque mudou fica em 600. */}
                                  <span
                                    className={
                                      estado !== original
                                        ? "font-semibold"
                                        : undefined
                                    }
                                  >
                                    {t.nome}
                                  </span>
                                  {t.ativo ? null : (
                                    <span className="text-texto-2">
                                      {" "}
                                      (arquivada)
                                    </span>
                                  )}
                                </ItemMarcavel>
                              </ItemSecao>
                            );
                          })}
                        </ItensSecao>
                      )}
                    </PainelEscolha>
                  </div>
                ) : null}
                {pode.transferir ? (
                  <div className="relative">
                    <Button
                      ref={gatilhoTransferir}
                      variant="secondary"
                      size="sm"
                      className="gap-0.5"
                      aria-haspopup={
                        menu && !comBuscaPessoa ? "menu" : "dialog"
                      }
                      aria-expanded={aberto === "transferir"}
                      disabled={nenhum}
                      onClick={() => alternarMenu("transferir")}
                    >
                      Transferir
                      <Seta />
                    </Button>
                    <PainelEscolha
                      menu={menu}
                      aberta={aberto === "transferir"}
                      aoFechar={() => setAberto(null)}
                      titulo="Transferir para"
                      gatilho={gatilhoTransferir}
                      papel={comBuscaPessoa ? "dialog" : "menu"}
                      topo={
                        comBuscaPessoa ? (
                          <BuscaResponsavel
                            valor={termoPessoa}
                            aoMudar={setTermoPessoa}
                          />
                        ) : null
                      }
                    >
                      <ItensResponsavel
                        menu={menu}
                        destinos={destinos}
                        carga={carga}
                        termo={termoPessoa}
                        papel={comBuscaPessoa ? "button" : "menuitem"}
                        aoEscolher={(p) =>
                          pedir(
                            { tipo: "transferir", id: p.id, nome: p.nome },
                            gatilhoTransferir,
                          )
                        }
                      />
                    </PainelEscolha>
                  </div>
                ) : null}
                {pode.exportar ? (
                  <Button
                    ref={gatilhoExportar}
                    variant="secondary"
                    size="sm"
                    disabled={nenhum}
                    onClick={() =>
                      pedir({ tipo: "exportar" }, gatilhoExportar)
                    }
                  >
                    <span>
                      Exportar
                      <span className="hidden @xl:inline"> CSV</span>
                    </span>
                  </Button>
                ) : null}
              </div>
            </>
          )}
          {erro ? (
            <p role="alert" className="tipo-nota pt-1 text-erro">
              {erro}
            </p>
          ) : null}
        </div>
      ) : !vazia ? (
        // O tamanho da lista e, para quem tem ação em massa, o
        // "Selecionar", que liga a barra no lugar do topo.
        <div className="mb-1 flex min-h-[40px] items-center justify-between gap-1.5 pointer-coarse:min-h-[44px]">
          <p className="tipo-nota min-w-0 truncate text-texto-2 tabular-nums">
            {resultado ? tamanhoDaLista(resultado) : null}
          </p>
          {algumaAcao ? (
            <Button
              ref={botaoModo}
              variant="secondary"
              size="sm"
              disabled={pendente}
              onClick={() => entrar()}
              className="shrink-0"
            >
              Selecionar
            </Button>
          ) : null}
        </div>
      ) : null}

      {vazia ? (
        <div ref={caixaVazio}>{vazio}</div>
      ) : (
        <>
          <ListaCelular contatos={contatos} comDono={comDono} selecao={selecao} />
          <TabelaContatos
            contatos={contatos}
            comDono={comDono}
            selecao={selecao}
          />
        </>
      )}

      {children}

      {noNavegador
        ? createPortal(
            <div
              aria-live="polite"
              className="pointer-events-none fixed inset-x-2 bottom-[calc(var(--casca-pe,0px)+16px)] z-40 flex justify-center"
            >
              {aviso ? (
                <div
                  key={aviso.id}
                  role={aviso.tom === "erro" ? "alert" : "status"}
                  className="pointer-events-auto flex min-h-[48px] w-full max-w-[420px] animate-entrada items-center gap-1 rounded-controle bg-tinta py-0.5 pr-0.5 pl-1.5 text-fundo shadow-flutuante"
                >
                  <p
                    className={cn(
                      "tipo-corpo min-w-0 flex-1 py-0.5",
                      aviso.tom === "erro" && "font-semibold",
                    )}
                  >
                    {aviso.texto}
                  </p>
                  <button
                    type="button"
                    aria-label="Fechar o aviso"
                    onClick={() => setAviso(null)}
                    className="inline-flex h-[40px] w-[40px] shrink-0 items-center justify-center rounded-celula text-fundo transition-colors duration-[120ms] hover:bg-tinta-hover focus-visible:outline-2 focus-visible:outline-offset-1 focus-visible:outline-fundo pointer-coarse:h-[44px] pointer-coarse:w-[44px]"
                  >
                    <X size={18} strokeWidth={1.75} aria-hidden />
                  </button>
                </div>
              ) : null}
            </div>,
            document.querySelector("[data-casca]") ?? document.body,
          )
        : null}
    </div>
  );
}
