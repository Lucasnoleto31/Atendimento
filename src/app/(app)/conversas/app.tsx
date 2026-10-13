"use client";

import {
  Fragment,
  useCallback,
  useDeferredValue,
  useEffect,
  useMemo,
  useRef,
  useState,
  useSyncExternalStore,
} from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import {
  ArrowLeft,
  Check,
  PanelRight,
  PanelRightClose,
  Search,
  UserPlus,
  X,
} from "lucide-react";
import { cn } from "@/lib/utils";
import {
  ehAtendente,
  ehGestao,
  somenteLeitura,
  veTudo,
  type Papel,
} from "@/lib/papeis";
import { donoOculto } from "@/lib/privacidade-regra";
import { Button, classesDoBotao } from "@/components/ui/button";
import { Chip } from "@/components/ui/etiqueta";
import { Segmentado } from "@/components/ui/segmentado";
import { Spinner } from "@/components/ui/spinner";
import { AvatarContato } from "@/components/app/avatar-contato";
import { BOTAO_ICONE, CAMPO_BASE } from "@/components/app/form-styles";
import { EsconderAbas } from "@/components/app/app-shell";
import { useEhMac } from "@/components/app/paleta-global";
import {
  ajustarNaoLidas,
  definirConversaEmCena,
  recontarNaoLidas,
} from "@/components/app/nao-lidas";
import {
  Janela,
  type EnvioConcluido,
  type OrigemEnvio,
} from "@/app/(app)/chat/janela";
import {
  adiarConversa,
  adiarConversasEmMassa,
  alterarStatusConversaChat,
  assumirConversa,
  atribuirEmMassa,
  definirResponsavelChat,
  marcarChatLido,
  marcarChatNaoLido,
  reativarConversa,
  resolverConversasEmMassa,
  type DonoConversa,
  type PrazoAdiar,
  type ResultadoAssumir,
  type ResultadoEnvio,
} from "@/app/(app)/chat/actions";
import { carregarConversa } from "@/app/(app)/chat/conversa";
import {
  AvatarDaEquipe,
  ProvedorFotosDaEquipe,
} from "@/app/(app)/chat/fotos";
import { resumirConversa } from "@/app/(app)/chat/ia";
import { DialogoTemplate } from "@/app/(app)/chat/templates";
import {
  agendarRecontato,
  encerrarRecontato,
  type ResultadoRecontato,
} from "@/app/(app)/chat/recontato-actions";
import {
  grupoDoRecontato,
  paraLinha,
  recontatoDoDia,
  type GrupoRecontato,
  type NotaRecontato,
  type Recontato,
  type RecontatoDaLinha,
} from "@/app/(app)/chat/recontato";
import {
  diaDaChave,
  hojeEmBrasilia,
  quandoEmTexto,
} from "@/app/(app)/chat/quando";
import {
  canalDaResposta,
  casaComBusca,
  casaComEtiquetas,
  contarFiltrosFila,
  COOKIE_FILA,
  ehTipoMensagem,
  filaNaUrl,
  FILTROS_FILA_PADRAO,
  hrefConversa,
  lerCookieFila,
  lerFiltrosFila,
  mesmosFiltrosFila,
  paraMensagem,
  restanteJanela24h,
  SEM_DONO,
  SEM_FILTROS_FINOS,
  termosDaBusca,
  VALIDADE_COOKIE_FILA_S,
  valorCookieFila,
  type CatalogosChat,
  type ConversaDoPainel,
  type FiltrosFila,
  type LinhaBrutaInteracao,
  type Mensagem,
} from "@/app/(app)/chat/mensagem";
import type { LinhaRealtime } from "@/app/(app)/chat/tempo-real";
import {
  buscarPessoas,
  type PessoaEncontrada,
} from "@/app/(app)/busca/actions";
import { comVoltar, rotuloVoltar } from "@/app/(app)/contatos/voltar";
import { etiquetasEmMassa, marcarLidasEmMassa } from "./acoes-massa";
import {
  MenuAdiar,
  MenuConversa,
  PRAZOS_ADIAR,
  type PedidoMenuConversa,
} from "./ferramentas-palco";
import {
  DialogoAdiarData,
  DialogoRecontato,
  FaixaRecontato,
} from "./recontato";
import { Folha, useTelaMd, useTelaXl } from "./folha";
import {
  ateResponder,
  LinhaFila,
  LinhaPessoa,
  type OrigemAbertura,
} from "./linha-fila";
import { hrefContatoDoChat } from "./links";
import { avisoDaMassa, BarraSelecao, emLotes, type AcaoMassa } from "./massa";
import {
  BarraFiltros,
  FunilFiltros,
  resumoDosFiltros,
  type FiltroAberto,
  type PropsFiltros,
} from "./barra-filtros";
import { PainelContato } from "./painel-contato";
import { ComandosDoChat, type ContextoComandos } from "./paleta";
import { useTempoRealConversas, type Ressincronizar } from "./tempo-real";
import {
  BotaoSelecionar,
  NOME_DA_VISAO,
  TituloVisao,
  type EstadoCarga,
} from "./topo-fila";
import {
  carregarCargaEquipe,
  carregarIdsDaFila,
  carregarListaConversas,
  carregarQuemSoLe,
  type CampanhaDaFila,
  type CargaAtendente,
  type CargaConversas,
  type Contagens,
  type EscopoConversas,
  type LinhaConversa,
  type VisaoConversas,
} from "./lista";

/**
 * O chat, servido em /chat: a fila vive no NAVEGADOR. Trocar de visão é uma
 * chamada, abrir conversa é outra; mensagem que chega entra pelo tempo
 * real, direto do payload.
 *
 * Desktop: a fila de 360px com a visão no título, busca e escopo no alto
 * (topo-fila.tsx); a conversa no centro com o compositor no pé; os dados
 * do contato à direita a partir de
 * 1280px, recolhíveis (abaixo disso, folha). Celular e tablet em pé: a fila
 * na largura toda; a conversa entra por cima, sem a barra de abas, com o
 * "← Caixa" no alto e o voltar do sistema fechando-a (histórico).
 *
 * A URL guarda a conversa e os filtros da fila: quem volta da ficha do
 * contato, ou recarrega a página, reabre a fila como a deixou. A fila
 * (visão, escopo e filtros, sem a busca) também fica num cookie por pessoa
 * e aparelho: quem sai para Contatos e volta pelo menu, pela aba ou por
 * Alt+1 reencontra a fila como estava. Tocar em "Chat" dentro do chat fecha
 * a conversa e mantém a fila.
 */

const VAZIO_DA_VISAO: Record<VisaoConversas, string> = {
  // Só em "Todas" sem filtro: em "Minhas" e em "Sem dono" a frase diz o
  // escopo (vazioDaFila), senão "Caixa zerada." aparecia com 7 sem dono.
  caixa: "Caixa zerada.",
  aguardando: "Ninguém esperando resposta.",
  adiadas: "Nenhuma conversa adiada.",
  recontatos: "Nenhum recontato marcado.",
  resolvidas: "Nenhuma conversa resolvida.",
  tudo: "Nenhuma conversa.",
};

// Marcar lida grava em leads (e roda os gatilhos da tabela): numa rajada de
// mensagens na conversa aberta, no máximo uma gravação a cada 10s, com a
// última garantida no fim do intervalo.
const FREIO_LIDA_MS = 10_000;
/** Quanto tempo o "Desfazer" fica na tela depois de resolver ou adiar. */
const DESFAZER_MS = 6000;
/** A carga da equipe vale por um minuto: nunca entra no respiro da fila. */
const CARGA_VALE_MS = 60_000;
/** Mensagem de conversa que não está na fila (a adiada que volta, a
 *  resolvida que reabre): a fila relê depois deste respiro curto, que junta
 *  uma rajada numa leitura só... */
const ESPERA_RECARGA_RAPIDA_MS = 800;
/** ...e no máximo uma vez neste intervalo. */
const INTERVALO_RECARGA_RAPIDA_MS = 5_000;
/** O despertador da próxima volta (o fim de um adiamento com hora, um
 *  recontato) dorme no máximo isto: passado, relê e arma de novo. */
const TETO_DESPERTADOR_MS = 6 * 3_600_000;
/** Quantas vezes o despertador relê o mesmo instante: a releitura que volta
 *  com ele de novo é o relógio do aparelho adiantado em relação ao do
 *  servidor. Cada nova tentativa espera um múltiplo disto (5 s, 10 s, 15 s),
 *  o que cobre até uns 30 s de diferença. */
const TENTATIVAS_DESPERTADOR = 4;
const REPETIR_DESPERTADOR_MS = 5_000;

/** Os grupos da visão Recontatos, na ordem da tela. */
const GRUPOS_RECONTATO: { chave: GrupoRecontato; titulo: string }[] = [
  { chave: "atrasados", titulo: "Atrasados" },
  { chave: "hoje", titulo: "Hoje" },
  { chave: "proximos", titulo: "Próximos" },
];

/** O freio de "marcar lida" de uma conversa. `geracao` muda a cada
 *  "marcar não lida": a gravação que já viajava não pode repintar a linha
 *  depois dele. `pintouLida`: abrir a conversa tirou o negrito da linha
 *  antes da resposta; se a gravação seguinte disser que não gravou (a fila
 *  não sabia que o dono mudou), o negrito volta. */
type FreioLida = {
  ultima: number;
  timer: number | null;
  geracao: number;
  pintouLida: boolean;
};

/** O freio da conversa, criado na primeira vez. */
function freioDe(mapa: Map<string, FreioLida>, leadId: string): FreioLida {
  let freio = mapa.get(leadId);
  if (!freio) {
    freio = { ultima: 0, timer: null, geracao: 0, pintouLida: false };
    mapa.set(leadId, freio);
  }
  return freio;
}

/**
 * O carimbo de hora que veio pelo tempo real, garantido legível: data que
 * o navegador não entende derrubaria o formatador de hora da bolha e da
 * fila. A mensagem acabou de chegar: "agora" é a melhor aproximação.
 */
function comHoraValida(linha: LinhaRealtime): LinhaRealtime {
  return Number.isNaN(Date.parse(linha.criado_em))
    ? { ...linha, criado_em: new Date().toISOString() }
    : linha;
}

/** A conversa entra na conta do badge do menu? (a regra de contarNaoLidas) */
function contaNoBadge(l: LinhaConversa): boolean {
  return l.naoLida && !l.resolvida && !(l.adiadaAte && !l.adiadaVencida);
}

/** O recontato da linha é de hoje ou atrasado: ele põe a conversa na
 *  Caixa, qualquer que seja o estado dela (a regra de lista.ts). */
function voltaPeloRecontato(
  r: RecontatoDaLinha | null,
  hoje: string = hojeEmBrasilia(),
): boolean {
  return r !== null && recontatoDoDia(r, hoje);
}

/** Na Caixa agora: nem resolvida nem adiada no prazo, ou com recontato do
 *  dia. */
function naCaixa(l: LinhaConversa, hoje: string = hojeEmBrasilia()): boolean {
  return (
    voltaPeloRecontato(l.recontato, hoje) ||
    (!l.resolvida && !(l.adiadaAte && !l.adiadaVencida))
  );
}

/** A visão em uso perdeu uma conversa. Tudo não conta; Recontatos conta só
 *  os do dia, e a recarga acerta. */
function contagensSemUma(c: Contagens, visao: VisaoConversas): Contagens {
  if (visao === "tudo" || visao === "recontatos") return c;
  return { ...c, [visao]: Math.max(0, c[visao] - 1) };
}

/** O recontato que a linha mostra depois de agendar: o mais cedo entre o
 *  que ela tinha e o novo (o reagendado troca o próprio). */
function recontatoDaLinhaCom(
  atual: RecontatoDaLinha | null,
  novo: Recontato,
): RecontatoDaLinha {
  const n = paraLinha(novo);
  if (!atual || atual.id === novo.id) return n;
  return Date.parse(atual.quando) <= Date.parse(n.quando) ? atual : n;
}

/**
 * A nota de recontato que entrou na conversa (agendar, reagendar ou fim)
 * acerta a lista que a faixa mostra, sem ir ao servidor: pelo tempo real
 * vale também o que um colega fez.
 */
function recontatosComNota(
  lista: Recontato[] | null,
  m: Mensagem,
  leadId: string,
): Recontato[] | null {
  if (!lista) return lista;
  if (m.recontatoFim) {
    const id = m.recontatoFim.id;
    return lista.some((r) => r.id === id)
      ? lista.filter((r) => r.id !== id)
      : lista;
  }
  if (m.recontato) {
    const novo: Recontato = { ...m.recontato, leadId, porNome: m.autor };
    return [...lista.filter((r) => r.id !== novo.id), novo].sort(
      (a, b) => Date.parse(a.quando) - Date.parse(b.quando),
    );
  }
  return lista;
}

/**
 * A linha da fila depois de uma mensagem que chegou pelo tempo real. É o
 * reflexo imediato; a ordem e os contadores acertam na recarga do respiro.
 * Mensagem recebida também tira a conversa de resolvida/adiada: o webhook
 * limpa as duas marcas no banco.
 *
 * A nova tentativa do webhook grava a hora original: mensagem mais velha que
 * a última da linha não troca a prévia, a vez nem a hora (nem a espera, que
 * anda com a vez). Não lida, janela e as marcas valem igual.
 */
function linhaComMensagem(
  l: LinhaConversa,
  m: LinhaRealtime,
  emCena: boolean,
): LinhaConversa {
  const recebida = m.tipo === "mensagem_recebida";
  const ultima = l.ultimaEm ? Date.parse(l.ultimaEm) : Number.NaN;
  const maisNova = Number.isNaN(ultima) || Date.parse(m.criado_em) >= ultima;
  const base: LinhaConversa = maisNova
    ? {
        ...l,
        previa: m.conteudo ?? l.previa,
        vez: recebida ? "eles" : "nos",
        ultimaEm: m.criado_em,
        // Quem já esperava continua contando de antes; quem não esperava
        // começa a esperar agora.
        esperaHoras: recebida
          ? l.vez === "eles" && l.esperaHoras !== null
            ? l.esperaHoras
            : 0
          : null,
      }
    : l;
  if (!recebida) return base;
  return {
    ...base,
    naoLida: !emCena,
    janelaAberta: true,
    resolvida: false,
    adiadaAte: null,
    adiadaVencida: false,
    sub: null,
  };
}

/**
 * A linha que voltou igual da recarga mantém o MESMO objeto: a linha
 * memoizada só refaz o render de quem mudou de fato.
 */
function reaproveitarLinhas(
  antigas: LinhaConversa[],
  novas: LinhaConversa[],
): LinhaConversa[] {
  const porId = new Map(antigas.map((l) => [l.leadId, l]));
  return novas.map((n) => {
    const a = porId.get(n.leadId);
    if (!a) return n;
    for (const k of Object.keys(n) as (keyof LinhaConversa)[]) {
      if (k !== "etiquetas" && k !== "recontato" && a[k] !== n[k]) return n;
    }
    if (
      a.recontato?.id !== n.recontato?.id ||
      a.recontato?.quando !== n.recontato?.quando ||
      a.recontato?.motivo !== n.recontato?.motivo
    ) {
      return n;
    }
    const mesmasEtiquetas =
      a.etiquetas.length === n.etiquetas.length &&
      a.etiquetas.every(
        (e, i) => e.id === n.etiquetas[i].id && e.nome === n.etiquetas[i].nome,
      );
    return mesmasEtiquetas ? a : n;
  });
}

/** Bolha nova na conversa, na ordem do tempo e sem repetir (o mesmo id pode
 *  chegar pelos dois canais, pela action e pela recarga). */
function anexarMensagem(
  c: ConversaDoPainel,
  m: Mensagem,
  agoraMs: number,
): ConversaDoPainel {
  if (c.mensagens.some((x) => x.id === m.id)) return c;
  const mensagens = [...c.mensagens];
  const quando = Date.parse(m.criado_em);
  let i = mensagens.length;
  while (i > 0 && Date.parse(mensagens[i - 1].criado_em) > quando) i--;
  mensagens.splice(i, 0, m);
  const recebida = m.tipo === "mensagem_recebida";
  return {
    ...c,
    mensagens,
    temConversa: true,
    // Mensagem recebida reabre a janela de 24h e decide o canal da resposta:
    // quem escreveu pelo Direct é respondido pelo Direct.
    restanteJanela: recebida
      ? restanteJanela24h(mensagens, agoraMs)
      : c.restanteJanela,
    canal: recebida
      ? (canalDaResposta(
          { temTelefone: c.aceitaTemplate, temDirect: c.temDirect },
          m.metadados?.direct ?? false,
        ) ?? "whatsapp")
      : c.canal,
    recontatos:
      m.tipo === "nota"
        ? recontatosComNota(c.recontatos, m, c.leadId)
        : c.recontatos,
  };
}

type EstadoLista = {
  linhas: LinhaConversa[];
  contagens: Contagens | null;
  temMais: boolean;
  /** A Caixa veio cortada no teto: o título diz "N de M". */
  cortada: boolean;
  /** "Só não lidas" bateu no teto do filtro: vieram as N mais recentes
   *  (N é o teto; 0 quando coube tudo). */
  naoLidasNoTeto: number;
  /** "Só não lidas" procurou entre as N conversas que receberam mensagem
   *  por último e a janela encheu (0 quando coube tudo). */
  naoLidasJanela: number;
  /** Os filtros (e a busca) com que estas linhas vieram do servidor. */
  filtros: FiltrosFila;
  /** O próximo instante em que alguma conversa volta sozinha (o
   *  despertador da fila relê nessa hora). */
  proximaVolta: string | null;
};

/** Para onde o foco vai na conversa seguinte, depois de resolver ou adiar:
 *  a linha dela (o gesto veio da fila), o compositor dela (veio do
 *  compositor, no ⌘Enter) ou a linha só se o foco ficou solto. */
type FocoAoSeguir = "linha" | "compositor" | "se-solto";

/** O que a página entrega já carregado (a conversa num deep link ?lead=). */
export type LeadInicial = {
  leadId: string;
  nome: string;
  dados: ConversaDoPainel;
};

/** O aviso do pé da fila: confirmação com "Desfazer" ou erro de um gesto. */
type Aviso = {
  id: number;
  texto: string;
  tom: "normal" | "erro";
  desfazer?:
    | {
        leadId: string;
        acao: "resolver" | "adiar";
        /** Estava não lida antes: desfazer devolve o negrito também. */
        naoLidaAntes: boolean;
      }
    | {
        leadId: string;
        acao: "recontato";
        /** O recontato que Feito ou Cancelar fechou: volta como estava. */
        recontato: Recontato;
      }
    | {
        leadId: string;
        acao: "transferir";
        /** Quem atendia antes da transferência (null: estava sem dono). */
        dono: { id: string; nome: string } | null;
      };
};

/** "da Caixa", "de Tudo": a visão depois de "Marcar as 212". */
function daVisao(v: VisaoConversas): string {
  return v === "caixa" ? "da Caixa" : `de ${NOME_DA_VISAO[v]}`;
}

/** Um cookie do navegador pelo nome; "" sem ele (ou bloqueado). */
function lerCookie(nome: string): string {
  try {
    const par = document.cookie
      .split("; ")
      .find((c) => c.startsWith(`${nome}=`));
    return par ? par.slice(nome.length + 1) : "";
  } catch {
    return "";
  }
}

/** Grava a fila da pessoa no cookie que o /chat lê no servidor. */
function guardarFila(meuId: string | null, filtros: FiltrosFila) {
  if (!meuId) return;
  try {
    document.cookie = `${COOKIE_FILA}=${valorCookieFila(meuId, filtros)}; path=/; max-age=${VALIDADE_COOKIE_FILA_S}; samesite=lax`;
  } catch {
    // cookie bloqueado: a fila vale só nesta visita, pela URL
  }
}

/* ── Dados do contato recolhidos no desktop (preferência do navegador) ── */

const CHAVE_PAINEL = "chat_painel_recolhido";
const ouvintesPainel = new Set<() => void>();
function assinarPainel(avisar: () => void) {
  ouvintesPainel.add(avisar);
  return () => {
    ouvintesPainel.delete(avisar);
  };
}
function lerPainel(): boolean {
  try {
    return localStorage.getItem(CHAVE_PAINEL) === "1";
  } catch {
    return false;
  }
}
function gravarPainel(recolhido: boolean) {
  try {
    localStorage.setItem(CHAVE_PAINEL, recolhido ? "1" : "0");
  } catch {
    // armazenamento bloqueado: vale até recarregar
  }
  ouvintesPainel.forEach((avisar) => avisar());
}

/**
 * O sinal combinado com a casca: enquanto houver envio no ar em qualquer
 * conversa, o <html> leva data-envio-em-voo="1", e os atalhos de área e a
 * paleta global não navegam (haEnvioEmVoo, na paleta global).
 */
function sinalizarEnvioEmVoo(ligado: boolean) {
  const raiz = document.documentElement;
  if (ligado) raiz.setAttribute("data-envio-em-voo", "1");
  else raiz.removeAttribute("data-envio-em-voo");
}

/** O campo de busca da fila, para a paleta pôr o foco nele. */
const ID_BUSCA = "busca-fila";

/** Sem a prop, ninguém oculto: a mesma lista a cada render. */
const SEM_DONOS_OCULTOS: string[] = [];

/** Sem a prop, ninguém com foto: as iniciais em todo lugar. */
const SEM_FOTOS: Record<string, string> = {};

const CLASSE_VOLTAR =
  "tipo-corpo inline-flex h-[44px] shrink-0 items-center gap-0.5 rounded-controle pr-1 pl-0.5 text-tinta transition-colors duration-[120ms] hover:bg-realce active:bg-pressionado focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-tinta md:h-[40px]";

export function AppConversas({
  inicial,
  catalogos,
  campanhas = null,
  donosOcultos = SEM_DONOS_OCULTOS,
  fotos = SEM_FOTOS,
  meuId,
  papel,
  hojeChave,
  leadInicial,
  filtrosIniciais,
  filaGuardada = false,
  voltar = null,
  leadSemAbrir = null,
}: {
  /** A fila, ou o erro dela: a tela avisa em vez de mostrar fila vazia. */
  inicial: CargaConversas | { erro: string };
  catalogos: CatalogosChat;
  /** As campanhas do filtro de Campanha; null = a leitura falhou: o menu
   *  diz que não carregou. */
  campanhas?: CampanhaDaFila[] | null;
  /** Os responsáveis cujas conversas quem está logado não vê
   *  (donosOcultosParaMim, Administração > Privacidade). A fila do servidor
   *  já vem sem eles; aqui a lista descarta o evento do tempo real, tira o
   *  dono oculto das opções do filtro de atendente e tira da tela a conversa
   *  passada para ele. Vazia para o admin e sem regra. */
  donosOcultos?: string[];
  /** As fotos da equipe (fotosDaEquipe, lida uma vez pela página): id do
   *  perfil para a URL. Vão por contexto à bolha, à fila, ao cabeçalho e às
   *  listas da equipe; quem não está no mapa aparece com as iniciais. */
  fotos?: Record<string, string>;
  /** Quem está logado: a conversa atribuída a outra pessoa sai de "Minhas". */
  meuId: string | null;
  /** Quem assume conversa, quem vê a carga da equipe e o escopo. */
  papel: Papel | null;
  hojeChave: string;
  leadInicial: LeadInicial | null;
  /** Os filtros da URL (lerFiltrosFila), com que a fila já veio. */
  filtrosIniciais?: FiltrosFila;
  /** Os filtros vieram do cookie da fila guardada, não da URL: o que não
   *  existe mais (etiqueta apagada, campanha, pessoa) sai na montagem. */
  filaGuardada?: boolean;
  /** De onde abriram esta conversa por fora (a ficha, a lista de contatos). */
  voltar?: string | null;
  /** A conversa do link (?lead=) que não abriu: a fila avisa e oferece
   *  tentar de novo. */
  leadSemAbrir?: string | null;
}) {
  const router = useRouter();
  const mac = useEhMac();
  const telaMd = useTelaMd();
  const telaXl = useTelaXl();
  const gestao = ehGestao(papel);
  // O atendente só enxerga as conversas dele (RLS): escopo e filtro por
  // atendente sairiam sempre vazios.
  const soAsMinhas = ehAtendente(papel);
  const podeAssumirPapel = papel === "vendedor" || gestao;
  // O botão de Atendentes aparece para quem vê a base inteira, mesmo com a
  // equipe sem carregar (o menu diz que não carregou e oferece o "Sem
  // dono"); a carga da equipe só se lê com a equipe na mão.
  const veOsAtendentes = veTudo(papel);
  const mostrarFiltroAtendente = veOsAtendentes && catalogos.equipe !== null;
  // O compliance só lê: as ações em massa voltariam todas sem permissão, e
  // o compositor, os botões de escrita, a bandeja da linha, o arrasto e as
  // teclas E, H e A saem da tela (o servidor já recusa; muda o que aparece).
  const leitura = somenteLeitura(papel);
  const podeAgirEmMassa = !leitura;
  /**
   * Abrir a conversa conta como leitura? Só para o responsável dela ou, sem
   * dono, para quem pode escrever (decisão do Artur, 09/10/2026). Gestão,
   * compliance e colegas abrem sem mexer na marca: a linha segue em negrito
   * para todos, quem abriu inclusive, e o badge não desconta. Quem decide é
   * o servidor (marcarChatLido confere o dono no próprio update); isto só
   * impede a tela de pintar "lida" antes da resposta para quem não é dono.
   */
  const leAoAbrir = useCallback(
    (responsavelId: string | null) =>
      !leitura && (responsavelId === null || responsavelId === meuId),
    [leitura, meuId],
  );

  const inicio = filtrosIniciais ?? FILTROS_FILA_PADRAO;
  const [filtros, setFiltros] = useState<FiltrosFila>(inicio);
  const filtrosRef = useRef<FiltrosFila>(inicio);
  // O campo de busca responde na hora; a busca no servidor sai com respiro.
  const [busca, setBusca] = useState(inicio.busca);
  const buscaAdiada = useDeferredValue(busca);

  // Seleção em massa: modo explícito, para as caixas não brigarem com o
  // arrastar-para-resolver nem com o clique que abre a conversa.
  const [modoSelecao, setModoSelecao] = useState(false);
  const [selecionadas, setSelecionadas] = useState<Set<string>>(
    () => new Set(),
  );
  const [massaPendente, setMassaPendente] = useState(false);
  const [massaErro, setMassaErro] = useState<string | null>(null);
  // Lote segurado por um envio no ar: o aviso fica na própria barra (o
  // flutuante cairia em cima do Voltar e do botão da confirmação).
  const [massaEspera, setMassaEspera] = useState(false);
  const [massaConfirmar, setMassaConfirmar] = useState<AcaoMassa | null>(null);
  // "Marcar as 212 de Tudo": as conversas do recorte que a tela não
  // carregou entram na seleção pelos ids (carregarIdsDaFila). Com isto
  // ligado, a ação vale para todas as marcadas, à vista ou não; desligado,
  // só para as marcadas à vista.
  const [comFora, setComFora] = useState<{
    cortada: boolean;
    teto: number;
    /** Quantas o recorte tem (as à vista e as de fora). */
    total: number;
  } | null>(null);
  const [lendoFora, setLendoFora] = useState(false);
  const [erroFora, setErroFora] = useState<string | null>(null);
  const pedidoForaRef = useRef(0);

  const [lista, setLista] = useState<EstadoLista>(() =>
    "erro" in inicial
      ? {
          linhas: [],
          contagens: null,
          temMais: false,
          cortada: false,
          naoLidasNoTeto: 0,
          naoLidasJanela: 0,
          filtros: inicio,
          proximaVolta: null,
        }
      : {
          ...inicial,
          naoLidasNoTeto: inicial.naoLidasNoTeto ?? 0,
          naoLidasJanela: inicial.naoLidasJanela ?? 0,
          filtros: inicio,
          proximaVolta: inicial.proximaVolta ?? null,
        },
  );
  const [carregandoLista, setCarregandoLista] = useState(false);
  const [carregandoMais, setCarregandoMais] = useState(false);
  const [erroLista, setErroLista] = useState<string | null>(
    "erro" in inicial ? inicial.erro : null,
  );
  const [linkSemAbrir, setLinkSemAbrir] = useState(leadSemAbrir);

  // `instagram` é o `direct` da linha da fila, lido na hora de abrir: a foto
  // do cabeçalho não pode sumir quando a linha sai da visão.
  const [aberta, setAberta] = useState<{
    leadId: string;
    nome: string;
    instagram: boolean;
  } | null>(() =>
    leadInicial
      ? {
          leadId: leadInicial.leadId,
          nome: leadInicial.nome,
          instagram:
            !("erro" in inicial) &&
            inicial.linhas.some(
              (l) => l.leadId === leadInicial.leadId && l.direct,
            ),
        }
      : null,
  );
  const [conversa, setConversa] = useState<ConversaDoPainel | null>(
    leadInicial?.dados ?? null,
  );
  const [carregandoConversa, setCarregandoConversa] = useState(false);
  const [erroConversa, setErroConversa] = useState<string | null>(null);
  // Aberta por clique de mouse: o compositor ganha o foco ao carregar.
  const [focoCompositorPara, setFocoCompositorPara] = useState<string | null>(
    null,
  );
  // A paleta pediu as mensagens prontas: cada número novo abre o painel.
  const [pedidoProntas, setPedidoProntas] = useState(0);
  // Conjunto, não um slot só: duas linhas podem estar sendo resolvidas ao
  // mesmo tempo, e uma travada não pode calar a outra.
  const [acaoPendente, setAcaoPendente] = useState<ReadonlySet<string>>(
    () => new Set(),
  );
  const pendentesRef = useRef(new Set<string>());
  const [resumo, setResumo] = useState<{ texto?: string; erro?: string } | null>(
    null,
  );
  const [resumindo, setResumindo] = useState(false);

  // Dados do contato: coluna no desktop largo (recolhível, preferência do
  // navegador); abaixo de 1280px, folha.
  const painelRecolhido = useSyncExternalStore(
    assinarPainel,
    lerPainel,
    () => false,
  );
  const [painelAberto, setPainelAberto] = useState(false);
  // Cruzar os 1280px com a folha aberta a deixava pendurada: ajuste durante
  // o render, sem efeito.
  const [larguraAnterior, setLarguraAnterior] = useState(telaXl);
  if (telaXl !== larguraAnterior) {
    setLarguraAnterior(telaXl);
    if (telaXl && painelAberto) setPainelAberto(false);
  }

  // O que está aberto nos filtros (um por vez): a lista do funil ou o menu
  // de um filtro, no funil ou na pílula. O de Atendentes relê a carga da
  // equipe enquanto estiver aberto.
  const [filtroAberto, setFiltroAberto] = useState<FiltroAberto | null>(
    null,
  );
  const [carga, setCarga] = useState<{
    equipe: CargaAtendente[];
    lidaEm: number;
  } | null>(null);
  const [erroCarga, setErroCarga] = useState<string | null>(null);
  const [pessoas, setPessoas] = useState<
    | { termo: string; resultados: PessoaEncontrada[] }
    | { termo: string; erro: string }
    | null
  >(null);
  const [aviso, setAviso] = useState<Aviso | null>(null);
  // O "Escolher data e hora" do adiar: da conversa em cena ou da seleção.
  // O alvo fica depois de fechar, para a saída da folha não trocar o texto.
  const [adiarData, setAdiarData] = useState<{
    aberto: boolean;
    alvo: { tipo: "conversa"; leadId: string } | { tipo: "massa" };
  }>({ aberto: false, alvo: { tipo: "massa" } });
  // Agendar ou reagendar o recontato da conversa em cena.
  const [dialogoRecontato, setDialogoRecontato] = useState<{
    aberto: boolean;
    leadId: string;
    nome: string;
    reagendar: Recontato | null;
  }>({ aberto: false, leadId: "", nome: "", reagendar: null });
  // O template da faixa do recontato (o diálogo de envio, já preenchido).
  const [templateDoRecontato, setTemplateDoRecontato] = useState<{
    aberto: boolean;
    recontato: Recontato | null;
  }>({ aberto: false, recontato: null });
  // Feito ou Cancelar gravando: a faixa espera.
  const [recontatoGravando, setRecontatoGravando] = useState(false);
  const gatilhoReagendarRef = useRef<HTMLButtonElement>(null);
  // O painel do contato e a paleta abrem o ⋯ da conversa numa seção.
  const [pedidoMenu, setPedidoMenu] = useState<PedidoMenuConversa | null>(
    null,
  );

  const listaRef = useRef<HTMLDivElement>(null);
  // A caixa que rola a fila: tocar em "Chat" já no chat a sobe ao topo.
  const rolagemFilaRef = useRef<HTMLDivElement>(null);
  const buscaRef = useRef<HTMLInputElement>(null);
  const tituloVisaoRef = useRef<HTMLButtonElement>(null);
  const barraSelecaoRef = useRef<HTMLDivElement>(null);
  const funilRef = useRef<HTMLButtonElement>(null);
  const botaoSelecionarRef = useRef<HTMLButtonElement>(null);
  const selecionarTodasRef = useRef<HTMLButtonElement>(null);
  const gatilhoPainelRef = useRef<HTMLButtonElement>(null);
  const nomeRef = useRef<HTMLHeadingElement>(null);
  // Alvo que só existe, só aparece ou só destrava depois do próximo render
  // (a linha que reaparece no celular quando a conversa fecha, a barra da
  // seleção que entra). focus() antes disso não pega.
  const focoDepoisRef = useRef<(() => HTMLElement | null | undefined) | null>(
    null,
  );
  useEffect(() => {
    const alvo = focoDepoisRef.current;
    if (!alvo) return;
    focoDepoisRef.current = null;
    alvo()?.focus();
  });

  const pedidoRef = useRef(0);
  // Contadores de corrida: resposta que chega depois de outra troca é lixo.
  const pedidoConversaRef = useRef(0);
  const pedidoResumoRef = useRef(0);
  const acordeGRef = useRef(0);
  // Quem está EM CENA agora. O contador sozinho não basta para o que nasce
  // numa closure do lead antigo e só termina depois da troca.
  const abertaRef = useRef<{ leadId: string; nome: string } | null>(
    leadInicial ? { leadId: leadInicial.leadId, nome: leadInicial.nome } : null,
  );
  // De quem é a conversa carregada no estado (null enquanto abre): mensagem
  // que chega no meio da abertura espera aqui e entra junto.
  const conversaCarregadaRef = useRef<string | null>(
    leadInicial?.leadId ?? null,
  );
  const chegadasNaAberturaRef = useRef<Mensagem[]>([]);
  // A mesma mensagem chega pelo canal da conversa e pelo da fila: o efeito
  // (marcar lida, limpar o resumo) roda uma vez só.
  const vistasRef = useRef(new Set<string>());
  // Mensagem chegou com a aba escondida: marca lida quando ela voltar.
  const lidaPendenteRef = useRef<string | null>(null);
  const freioLidaRef = useRef(new Map<string, FreioLida>());
  // As conversas que esta tela adiou (o adiar, a seleção, o recontato):
  // quando uma delas recebe mensagem e não está na fila, a fila relê logo,
  // em qualquer escopo (pedirRecargaRapida).
  const adiadasAquiRef = useRef(new Set<string>());
  // A conversa entrou no histórico do navegador (celular): o "←" volta
  // nele, e o voltar do sistema fecha a conversa.
  const empurrouRef = useRef(false);
  // Conversas com envio no ar (a Janela avisa). Sair delas agora desmontaria
  // a Janela no meio do envio: o erro da Meta sumiria, o texto e os anexos
  // não voltariam para a caixa e o E resolveria a conversa sem a mensagem.
  // Por origem: o texto e o template podem voar juntos, e o fim de um não
  // solta o outro.
  const envioEmVooRef = useRef(new Map<string, Set<OrigemEnvio>>());
  // O ⌘Enter abriu a próxima e o foco vai para o compositor dela: até ele
  // chegar, letra digitada não é atalho (o "e" resolveria a que chega).
  const compositorPendenteRef = useRef<string | null>(null);
  const telaMdRef = useRef(telaMd);
  // A conversa carregada, para o teclado e o despachar consultarem.
  const conversaRef = useRef(conversa);
  useEffect(() => {
    conversaRef.current = conversa;
  }, [conversa]);
  const contadorAvisoRef = useRef(0);
  const pedindoCargaRef = useRef(false);
  const cargaRef = useRef(carga);
  useEffect(() => {
    telaMdRef.current = telaMd;
    cargaRef.current = carga;
  }, [telaMd, carga]);

  // Andar na fila (J/K, avanço) traz a linha para a vista: o realce sozinho
  // não serve se ela está fora da área visível.
  useEffect(() => {
    if (!aberta) return;
    listaRef.current
      ?.querySelector(`[data-lead="${CSS.escape(aberta.leadId)}"]`)
      ?.scrollIntoView({ block: "nearest" });
  }, [aberta]);

  // Enquanto a busca nova viaja, as linhas já carregadas são filtradas aqui
  // mesmo, com a normalização do servidor (dígitos do telefone, @); a
  // resposta do servidor, que acha também por e-mail, substitui o filtro.
  const linhasVisiveis = useMemo(() => {
    const t = termosDaBusca(buscaAdiada);
    const daLista = termosDaBusca(lista.filtros.busca);
    if (!t || t.termo === daLista?.termo) return lista.linhas;
    return lista.linhas.filter((l) => casaComBusca(l, t));
  }, [lista.linhas, lista.filtros.busca, buscaAdiada]);

  // A ação em massa vale para o que está selecionado E na tela; depois do
  // "Marcar as 212", para todas as marcadas (as de fora da tela vieram
  // pelos ids do recorte).
  const idsSelecionados = useMemo(
    () =>
      comFora
        ? [...selecionadas]
        : linhasVisiveis
            .filter((l) => selecionadas.has(l.leadId))
            .map((l) => l.leadId),
    [linhasVisiveis, selecionadas, comFora],
  );

  // As callbacks estáveis da lista (e o tempo real) leem o estado por aqui.
  const linhasRef = useRef(linhasVisiveis);
  const todasLinhasRef = useRef(lista.linhas);
  const filtrosDaListaRef = useRef(lista.filtros);
  useEffect(() => {
    linhasRef.current = linhasVisiveis;
    todasLinhasRef.current = lista.linhas;
    filtrosDaListaRef.current = lista.filtros;
  }, [linhasVisiveis, lista.linhas, lista.filtros]);

  const coresEtiquetas = useMemo(
    () => new Map((catalogos.etiquetas ?? []).map((e) => [e.id, e.cor])),
    [catalogos.etiquetas],
  );
  const etiquetasAtivas = useMemo(
    () => (catalogos.etiquetas ?? []).filter((e) => e.ativo),
    [catalogos.etiquetas],
  );
  const nomeNaEquipe = useCallback(
    (id: string) => catalogos.equipe?.find((p) => p.id === id)?.nome ?? null,
    [catalogos.equipe],
  );
  // O filtro de atendente não oferece o dono oculto (a fila dele sairia
  // vazia). Transferir, no ⋯ e na seleção, segue com a equipe inteira.
  const equipeDoFiltro = useMemo(
    () =>
      catalogos.equipe?.filter((p) => !donoOculto(p.id, donosOcultos)) ??
      null,
    [catalogos.equipe, donosOcultos],
  );
  // Os destinos de Transferir (no ⋯ e na seleção) sem quem só lê (o
  // compliance): a conversa passada para essa pessoa ficaria sem ninguém
  // que responda. Até a lista chegar, vai a equipe inteira; o servidor
  // continua decidindo quem pode receber.
  const [soLeitura, setSoLeitura] = useState<ReadonlySet<string> | null>(
    null,
  );
  // Lida uma vez por página (ou no ar): só a falha libera outra leitura.
  const soLeituraPedidaRef = useRef(false);
  const pedirSoLeitura = useCallback(() => {
    if (!podeAgirEmMassa || soLeituraPedidaRef.current) return;
    soLeituraPedidaRef.current = true;
    void carregarQuemSoLe()
      .catch(() => null)
      .then((ids) => {
        if (ids) setSoLeitura(new Set(ids));
        // Falhou: tenta de novo quando o Transferir abrir.
        else soLeituraPedidaRef.current = false;
      });
  }, [podeAgirEmMassa]);
  useEffect(() => {
    pedirSoLeitura();
  }, [pedirSoLeitura]);
  const equipeDestinos = useMemo(
    () =>
      soLeitura
        ? (catalogos.equipe?.filter((p) => !soLeitura.has(p.id)) ?? null)
        : catalogos.equipe,
    [catalogos.equipe, soLeitura],
  );
  // As callbacks estáveis (o tempo real, o dono que mudou) leem por aqui.
  const donosOcultosRef = useRef(donosOcultos);
  useEffect(() => {
    donosOcultosRef.current = donosOcultos;
  }, [donosOcultos]);

  /* ── URL ─────────────────────────────────────────────────────────────── */

  // O ?voltar= é da conversa que veio de fora; as outras não o levam.
  const leadDoVoltar = voltar ? (leadInicial?.leadId ?? null) : null;
  const escreverUrl = useCallback(
    (leadId: string | null, f: FiltrosFila, modo: "push" | "replace") => {
      const base = hrefConversa(leadId, f);
      const url =
        leadId && leadId === leadDoVoltar && voltar
          ? comVoltar(base, voltar)
          : base;
      if (window.location.pathname + window.location.search === url) return;
      if (modo === "push") window.history.pushState(null, "", url);
      else window.history.replaceState(null, "", url);
    },
    [leadDoVoltar, voltar],
  );

  /* ── avisos ──────────────────────────────────────────────────────────── */

  const mostrarAviso = useCallback((a: Omit<Aviso, "id">) => {
    contadorAvisoRef.current += 1;
    setAviso({ ...a, id: contadorAvisoRef.current });
  }, []);
  /** Envio no ar na conversa (a em cena, sem leadId): segura o gesto que a
   *  tiraria da tela e avisa. Devolve true quando segurou. */
  const segurarPeloEnvio = useCallback(
    (leadId?: string | null) => {
      const alvo = leadId ?? abertaRef.current?.leadId;
      if (!alvo || !envioEmVooRef.current.has(alvo)) return false;
      mostrarAviso({ texto: "Esperando o envio terminar.", tom: "normal" });
      return true;
    },
    [mostrarAviso],
  );
  const aoEnvioEmVoo = useCallback(
    (leadId: string, emVoo: boolean, origem: OrigemEnvio = "texto") => {
      const mapa = envioEmVooRef.current;
      const origens = mapa.get(leadId) ?? new Set<OrigemEnvio>();
      if (emVoo) origens.add(origem);
      else origens.delete(origem);
      if (origens.size > 0) mapa.set(leadId, origens);
      else mapa.delete(leadId);
      sinalizarEnvioEmVoo(mapa.size > 0);
      // O lote segurado pode seguir: o aviso da barra sai.
      if (mapa.size === 0) setMassaEspera(false);
    },
    [],
  );
  // Saiu da tela: nenhum envio daqui segura mais a casca.
  useEffect(() => {
    const mapa = envioEmVooRef.current;
    return () => {
      mapa.clear();
      sinalizarEnvioEmVoo(false);
    };
  }, []);

  useEffect(() => {
    if (!aviso) return;
    const t = window.setTimeout(
      () => setAviso((atual) => (atual?.id === aviso.id ? null : atual)),
      aviso.tom === "erro" ? 8000 : DESFAZER_MS,
    );
    return () => window.clearTimeout(t);
  }, [aviso]);

  /* ── fila ────────────────────────────────────────────────────────────── */

  /**
   * Recarrega a fila. `silenciosa` é para o que o atendente não pediu (o
   * tempo real e o polling): sem estado de carregamento e sem mexer no erro
   * que estiver na tela.
   */
  const recarregarLista = useCallback(
    async (f: FiltrosFila, { silenciosa = false }: { silenciosa?: boolean } = {}) => {
      const pedido = ++pedidoRef.current;
      if (!silenciosa) {
        setCarregandoLista(true);
        setErroLista(null);
      }
      // A recarga silenciosa relê tudo o que o atendente já carregou, não só
      // a primeira página, e só para a lista destes mesmos filtros. A Caixa
      // não pagina.
      const limite =
        silenciosa &&
        f.visao !== "caixa" &&
        mesmosFiltrosFila(filtrosDaListaRef.current, f)
          ? todasLinhasRef.current.length
          : undefined;
      let r: Awaited<ReturnType<typeof carregarListaConversas>>;
      try {
        r = await carregarListaConversas(f.visao, { ...f, limite });
      } catch {
        r = { erro: "A conexão não respondeu. Tente de novo." };
      }
      if (pedido !== pedidoRef.current) return; // resposta velha: descarta
      setCarregandoLista(false);
      if ("erro" in r) {
        // A silenciosa engole o erro, salvo quando a lista na tela é de
        // outros filtros: ela é a única resposta que essa troca vai ter.
        if (!silenciosa || !mesmosFiltrosFila(filtrosDaListaRef.current, f)) {
          setErroLista(r.erro);
        }
        return;
      }
      const nova = r;
      // A conversa aberta com a marca de lida agendada pelo freio já foi
      // vista: esta leitura saiu antes da gravação e não pode repintá-la.
      // Vale só para quem lê ao abrir (o dono de agora, pela linha que
      // acabou de chegar): para os outros a marca não sai, e a linha fica
      // como o servidor mandou.
      const emCena = abertaRef.current?.leadId;
      const lidaAgendada =
        emCena && freioLidaRef.current.get(emCena)?.timer != null
          ? emCena
          : null;
      const linhasNovas = lidaAgendada
        ? nova.linhas.map((l) =>
            l.leadId === lidaAgendada &&
            l.naoLida &&
            leAoAbrir(l.responsavelId)
              ? { ...l, naoLida: false }
              : l,
          )
        : nova.linhas;
      setLista((c) => ({
        linhas: reaproveitarLinhas(c.linhas, linhasNovas),
        contagens: nova.contagens ?? c.contagens,
        temMais: nova.temMais,
        cortada: nova.cortada,
        naoLidasNoTeto: nova.naoLidasNoTeto ?? 0,
        naoLidasJanela: nova.naoLidasJanela ?? 0,
        filtros: f,
        proximaVolta:
          nova.proximaVolta !== undefined ? nova.proximaVolta : c.proximaVolta,
      }));
    },
    [leAoAbrir],
  );

  /** Troca um ou mais filtros, recarrega na hora e grava na URL e na fila
   *  guardada (o cookie que o /chat lê na próxima visita). A troca que não
   *  muda o endereço não muda a fila (o modo das etiquetas sem etiqueta
   *  marcada): só a tela acompanha, sem recarga. */
  const aplicarFiltros = useCallback(
    (mudanca: Partial<FiltrosFila>) => {
      const antes = filtrosRef.current;
      const novos = { ...antes, ...mudanca };
      filtrosRef.current = novos;
      setFiltros(novos);
      if (mesmosFiltrosFila(antes, novos)) return;
      void recarregarLista(novos);
      escreverUrl(abertaRef.current?.leadId ?? null, novos, "replace");
      guardarFila(meuId, novos);
    },
    [recarregarLista, escreverUrl, meuId],
  );

  /** Um filtro fino do painel ou de um chip. Escolher atendentes é um
   *  recorte de "Todas": "Minhas" e "Sem dono" já dizem quem atende. */
  const mudarFiltros = useCallback(
    (mudanca: Partial<FiltrosFila>) => {
      aplicarFiltros(
        mudanca.atendentes && mudanca.atendentes.length > 0
          ? { ...mudanca, escopo: "todas" }
          : mudanca,
      );
    },
    [aplicarFiltros],
  );

  /** Página seguinte da fila, anexada ao fim. */
  const carregarMais = async () => {
    if (carregandoMais) return;
    setCarregandoMais(true);
    const marca = pedidoRef.current;
    const f = filtrosRef.current;
    let r: Awaited<ReturnType<typeof carregarListaConversas>>;
    try {
      r = await carregarListaConversas(f.visao, {
        ...f,
        offset: lista.linhas.length,
        comContagens: false,
      });
    } catch {
      r = { erro: "A conexão não respondeu. Tente de novo." };
    }
    setCarregandoMais(false);
    if (marca !== pedidoRef.current) return;
    if ("erro" in r) {
      setErroLista(r.erro);
      return;
    }
    const pagina = r;
    setLista((c) => {
      const vistos = new Set(c.linhas.map((l) => l.leadId));
      const novas = pagina.linhas.filter((l) => !vistos.has(l.leadId));
      return { ...c, linhas: [...c.linhas, ...novas], temMais: pagina.temMais };
    });
  };

  // Busca com respiro de 300ms; visão, escopo e filtros recarregam na hora.
  const timerBusca = useRef<number | null>(null);
  useEffect(
    () => () => {
      if (timerBusca.current !== null) clearTimeout(timerBusca.current);
    },
    [],
  );
  const aoBuscar = (valor: string) => {
    setBusca(valor);
    if (timerBusca.current !== null) clearTimeout(timerBusca.current);
    timerBusca.current = window.setTimeout(() => {
      timerBusca.current = null;
      aplicarFiltros({ busca: valor });
    }, 300);
  };
  const trocarVisao = useCallback(
    (v: VisaoConversas) => {
      if (v === filtrosRef.current.visao) return;
      aplicarFiltros({ visao: v });
    },
    [aplicarFiltros],
  );
  const limparBusca = () => {
    if (timerBusca.current !== null) {
      clearTimeout(timerBusca.current);
      timerBusca.current = null;
    }
    setBusca("");
    if (filtrosRef.current.busca !== "") aplicarFiltros({ busca: "" });
    buscaRef.current?.focus();
  };
  /** Tira todos os filtros finos. Visão e escopo ficam; a busca tem o X
   *  dela, à vista. */
  const limparFiltros = useCallback(() => {
    aplicarFiltros(SEM_FILTROS_FINOS);
  }, [aplicarFiltros]);

  /** Troca o escopo (o segmentado, o próximo passo da fila vazia). "Minhas"
   *  e "Sem dono" já dizem quem atende: o filtro por atendente sairia
   *  contraditório. */
  const trocarEscopo = useCallback(
    (escopo: EscopoConversas) => {
      if (escopo === filtrosRef.current.escopo) return;
      aplicarFiltros({
        escopo,
        ...(escopo !== "todas" ? { atendentes: [] } : {}),
      });
    },
    [aplicarFiltros],
  );

  /** Abre o ⋯ da conversa numa seção (o painel do contato, a paleta). A
   *  folha dos dados do contato fecha antes: duas folhas não se empilham. */
  const pedirMenu = (qual: PedidoMenuConversa["qual"]) => {
    setPainelAberto(false);
    setPedidoMenu((p) => ({ qual, n: (p?.n ?? 0) + 1 }));
  };

  // A busca única de pessoas acompanha o termo aplicado na fila: quem não
  // está na visão em uso (resolvida, adiada, sem conversa) aparece embaixo.
  const termoPessoas = filtros.busca.trim();
  useEffect(() => {
    if (termoPessoas.length < 2) return;
    let vivo = true;
    void buscarPessoas(termoPessoas)
      .catch(() => ({ erro: "A busca não respondeu." }))
      .then((r) => {
        if (vivo) setPessoas({ termo: termoPessoas, ...r });
      });
    return () => {
      vivo = false;
    };
  }, [termoPessoas]);

  /* ── carga da equipe (gestão) ────────────────────────────────────────── */

  const pedirCarga = useCallback(
    async (forcar = false) => {
      if (!gestao || pedindoCargaRef.current) return;
      const atual = cargaRef.current;
      if (!forcar && atual && Date.now() - atual.lidaEm < CARGA_VALE_MS) {
        return;
      }
      pedindoCargaRef.current = true;
      try {
        const r = await carregarCargaEquipe();
        if ("erro" in r) setErroCarga(r.erro);
        else {
          setErroCarga(null);
          setCarga({ equipe: r.equipe, lidaEm: Date.now() });
        }
      } catch {
        setErroCarga("A carga da equipe não carregou.");
      } finally {
        pedindoCargaRef.current = false;
      }
    },
    [gestao],
  );
  // Com o menu de Atendentes aberto (a gestão vê a carga ao lado de cada
  // pessoa), a carga relê a cada minuto. Carga que não está na tela não se
  // lê. O intervalo força a leitura: a validade conta de quando a leitura
  // voltou, e sem o forçar o tique de 60 s caía dentro dela e a carga relia
  // a cada 2 min.
  const filtrosComCarga =
    filtroAberto?.qual === "atendentes" && gestao && mostrarFiltroAtendente;
  useEffect(() => {
    if (!filtrosComCarga) return;
    const primeira = window.setTimeout(() => void pedirCarga(), 0);
    // Aba escondida não relê: ninguém está vendo a carga.
    const intervalo = window.setInterval(() => {
      if (document.visibilityState === "visible") void pedirCarga(true);
    }, CARGA_VALE_MS);
    return () => {
      window.clearTimeout(primeira);
      window.clearInterval(intervalo);
    };
  }, [filtrosComCarga, pedirCarga]);
  const cargaPorPessoa = useMemo(
    () =>
      carga ? new Map(carga.equipe.map((p) => [p.id, p.abertas])) : null,
    [carga],
  );

  /* ── marcar lida ─────────────────────────────────────────────────────── */

  /**
   * Marca lida no servidor com freio por conversa: a primeira sai na hora;
   * dentro dos 10s seguintes, uma só no fim do intervalo. Só pede o que
   * está na tela: conversa em cena, carregada e com a aba à vista. O
   * servidor grava só para o dono (ou na conversa sem dono), e a linha só
   * fica lida quando ele diz que gravou.
   */
  /** A linha que abrir pintou como lida volta ao negrito: o servidor não
   *  gravou a leitura. */
  const repintarNaoLida = useCallback((leadId: string) => {
    setLista((c) =>
      c.linhas.some((l) => l.leadId === leadId && !l.naoLida)
        ? {
            ...c,
            linhas: c.linhas.map((l) =>
              l.leadId === leadId ? { ...l, naoLida: true } : l,
            ),
          }
        : c,
    );
  }, []);

  const marcarLida = useCallback(
    (leadId: string) => {
      const f = freioDe(freioLidaRef.current, leadId);
      if (f.timer !== null) return; // já tem uma marcada para o fim
      const gravar = () => {
        f.timer = null;
        if (
          abertaRef.current?.leadId !== leadId ||
          conversaCarregadaRef.current !== leadId
        ) {
          return;
        }
        if (document.visibilityState !== "visible") {
          lidaPendenteRef.current = leadId;
          return;
        }
        f.ultima = Date.now();
        const geracao = f.geracao;
        // A pintura da abertura fica com esta gravação, que diz se valeu.
        const pintou = f.pintouLida;
        f.pintouLida = false;
        void marcarChatLido(leadId).then(
          ({ gravou }) => {
            recontarNaoLidas();
            // Quem abriu sem ser dono não grava: para o badge a conversa não
            // está em cena, e a mensagem nova dela reconta como as outras.
            if (abertaRef.current?.leadId === leadId) {
              definirConversaEmCena(gravou ? leadId : null);
            }
            if (!gravou) {
              if (pintou) repintarNaoLida(leadId);
              return;
            }
            if (
              f.geracao !== geracao ||
              abertaRef.current?.leadId !== leadId ||
              document.visibilityState !== "visible"
            ) {
              return;
            }
            setLista((c) =>
              c.linhas.some((l) => l.leadId === leadId && l.naoLida)
                ? {
                    ...c,
                    linhas: c.linhas.map((l) =>
                      l.leadId === leadId ? { ...l, naoLida: false } : l,
                    ),
                  }
                : c,
            );
          },
          () => {
            // Sem resposta, a leitura não conta como gravada: a conversa sai
            // de cena para o badge, que volta à conta do servidor.
            recontarNaoLidas();
            if (abertaRef.current?.leadId === leadId) {
              definirConversaEmCena(null);
            }
            if (pintou) repintarNaoLida(leadId);
          },
        );
      };
      const desde = Date.now() - f.ultima;
      if (desde >= FREIO_LIDA_MS) gravar();
      else f.timer = window.setTimeout(gravar, FREIO_LIDA_MS - desde);
    },
    [repintarNaoLida],
  );

  /**
   * A conversa saiu de cena com uma marca de lida agendada pelo freio: grava
   * agora. Até aqui o atendente viu tudo.
   */
  const descarregarLida = useCallback(
    (leadId: string) => {
      const f = freioLidaRef.current.get(leadId);
      if (!f || f.timer === null) return;
      window.clearTimeout(f.timer);
      f.timer = null;
      f.ultima = Date.now();
      const pintou = f.pintouLida;
      f.pintouLida = false;
      void marcarChatLido(leadId).then(
        ({ gravou }) => {
          recontarNaoLidas();
          if (!gravou && pintou) repintarNaoLida(leadId);
        },
        () => {
          recontarNaoLidas();
          if (pintou) repintarNaoLida(leadId);
        },
      );
    },
    [repintarNaoLida],
  );

  /** "Marcar como não lida" vence a marca de lida que estava agendada. */
  const cancelarMarcaLida = useCallback((leadId: string) => {
    const freio = freioLidaRef.current.get(leadId);
    if (freio) {
      freio.geracao++;
      if (freio.timer !== null) {
        window.clearTimeout(freio.timer);
        freio.timer = null;
      }
    }
    if (lidaPendenteRef.current === leadId) lidaPendenteRef.current = null;
  }, []);

  // Sair da tela grava as marcas de lida que o freio segurava; a conversa
  // em cena deixa de existir para o badge.
  useEffect(() => {
    const freios = freioLidaRef.current;
    return () => {
      for (const leadId of freios.keys()) descarregarLida(leadId);
      definirConversaEmCena(null);
    };
  }, [descarregarLida]);

  // Deep link ?lead=: a conversa veio pronta do servidor; marcar lida e
  // avisar o badge é aqui, uma vez, na montagem. Só se a URL de agora ainda
  // é dela: remontada com a árvore do primeiro quadro, a URL pode dizer
  // outra conversa (ou a fila), e quem abre essa é a conferência da URL,
  // abaixo. A conversa do quadro antigo não chegou a ser aberta na tela.
  // Para o badge, ela só fica em cena para quem lê ao abrir (o dono veio
  // com a conversa); a resposta da gravação confirma.
  const leadInicialId = leadInicial?.leadId ?? null;
  const leInicial = leadInicial
    ? leAoAbrir(leadInicial.dados.ferramentas.responsavelId)
    : false;
  useEffect(() => {
    if (!leadInicialId) return;
    const leadDaUrl =
      new URLSearchParams(window.location.search).get("lead") || null;
    if (leadDaUrl !== leadInicialId) return;
    definirConversaEmCena(leInicial ? leadInicialId : null);
    marcarLida(leadInicialId);
  }, [leadInicialId, leInicial, marcarLida]);

  /* ── abrir e fechar ──────────────────────────────────────────────────── */

  /** A linha da conversa na fila ou, com a fila escondida (celular, conversa
   *  aberta), o cabeçalho da conversa: o foco nunca fica solto no body. */
  const alvoDaLinha = useCallback((leadId: string): HTMLElement | null => {
    const linha = listaRef.current?.querySelector<HTMLElement>(
      `[data-lead="${CSS.escape(leadId)}"] button`,
    );
    if (linha && linha.getClientRects().length > 0) return linha;
    return gatilhoPainelRef.current ?? nomeRef.current;
  }, []);

  /**
   * Gesto da bandeja ou do arrasto numa linha que não está em cena: o botão
   * com o foco some com a linha (saiu da visão) ou dá lugar a outro
   * (Reabrir vira Adiar em Tudo), e o foco caía no body. Lido ANTES do
   * pedido, porque o botão se desativa durante ele. Devolve o que chamar no
   * sucesso: o foco vai para a própria linha, se ela ficou, ou para a
   * vizinha (a seguinte, senão a anterior); sem nenhuma, para o título da
   * visão. Foco que estava em outro lugar fica onde está.
   */
  const ampararFocoDaLinha = useCallback((leadId: string) => {
    const ativo = document.activeElement;
    const estavaNaLinha =
      !ativo ||
      ativo === document.body ||
      Boolean(ativo.closest(`[data-lead="${CSS.escape(leadId)}"]`));
    if (!estavaNaLinha) return () => {};
    return () => {
      const fila = linhasRef.current;
      const i = fila.findIndex((l) => l.leadId === leadId);
      const vizinha = i === -1 ? undefined : (fila[i + 1] ?? fila[i - 1]);
      const botaoDa = (id: string) => {
        const el = listaRef.current?.querySelector<HTMLElement>(
          `[data-lead="${CSS.escape(id)}"] button`,
        );
        return el && el.getClientRects().length > 0 ? el : null;
      };
      focoDepoisRef.current = () =>
        botaoDa(leadId) ??
        (vizinha ? botaoDa(vizinha.leadId) : null) ??
        tituloVisaoRef.current ??
        selecionarTodasRef.current;
    };
  }, []);

  const abrirConversa = useCallback(
    async (
      leadId: string,
      nome: string,
      {
        origem = "teclado",
        historia = "replace",
        foco,
      }: {
        origem?: OrigemAbertura;
        /** push: a conversa entra no histórico (abrir pela fila no
         *  celular); replace: troca a de cena (J, K, avanço); nenhuma: o
         *  próprio histórico pediu (voltar do sistema). */
        historia?: "push" | "replace" | "nenhuma";
        /** Para onde o foco vai: a linha da nova conversa (o foco estava
         *  na fila), o compositor dela (avanço pelo ⌘Enter; enquanto ela
         *  abre, a linha) ou a linha só se o foco ficou solto. */
        foco?: FocoAoSeguir;
      } = {},
    ) => {
      const saindo = abertaRef.current?.leadId;
      // Envio no ar na conversa em cena: trocar (ou reabrir) agora
      // desmontaria a Janela com ele.
      if (saindo && segurarPeloEnvio(saindo)) return;
      // A marca de lida da que sai vai antes de carregarConversa, para
      // entrar primeiro na fila de actions.
      if (saindo && saindo !== leadId) descarregarLida(saindo);
      const pedido = ++pedidoConversaRef.current;
      pedidoResumoRef.current++; // resumo em voo era da conversa anterior
      abertaRef.current = { leadId, nome };
      conversaCarregadaRef.current = null;
      chegadasNaAberturaRef.current = [];
      vistasRef.current = new Set();
      lidaPendenteRef.current = null;
      const linha = todasLinhasRef.current.find((l) => l.leadId === leadId);
      // Para o badge, a conversa só entra em cena para quem lê ao abrir: para
      // os outros, a mensagem nova dela reconta e bipa como as outras. Fora
      // da fila o dono só se sabe quando ela carrega, e quem confirma é a
      // resposta da gravação.
      definirConversaEmCena(
        !linha || leAoAbrir(linha.responsavelId) ? leadId : null,
      );
      if (historia !== "nenhuma") {
        escreverUrl(leadId, filtrosRef.current, historia);
        if (historia === "push") empurrouRef.current = true;
      }
      compositorPendenteRef.current = foco === "compositor" ? leadId : null;
      if (foco) {
        focoDepoisRef.current = () => {
          // "se-solto": quem tinha o foco saiu junto com a conversa (o ⋯ da
          // que foi adiada); o foco que ficou de pé fica onde está.
          const ativo = document.activeElement;
          if (foco === "se-solto" && ativo && ativo !== document.body) {
            return null;
          }
          return alvoDaLinha(leadId);
        };
      }
      setAberta({
        leadId,
        nome,
        instagram: linha !== undefined && linha.direct,
      });
      setFocoCompositorPara(
        origem === "ponteiro" || foco === "compositor" ? leadId : null,
      );
      setConversa(null);
      setErroConversa(null);
      setResumo(null);
      setResumindo(false);
      setCarregandoConversa(true);

      // Reflexo local, imediato, na linha da fila e no badge do menu. Só
      // para quem lê ao abrir (o dono, ou qualquer um na conversa sem
      // dono): para os outros a conversa segue não lida. A linha pode estar
      // velha (troca de dono não chega pelo tempo real): o freio guarda que
      // a tela pintou, e a gravação que disser "não gravou" desfaz.
      if (linha?.naoLida && leAoAbrir(linha.responsavelId)) {
        if (contaNoBadge(linha)) ajustarNaoLidas(-1);
        freioDe(freioLidaRef.current, leadId).pintouLida = true;
        setLista((c) => ({
          ...c,
          linhas: c.linhas.map((l) =>
            l.leadId === leadId ? { ...l, naoLida: false } : l,
          ),
        }));
      }
      /** A conversa não chegou à tela: a pintura da abertura não vale. Diz
       *  se havia pintura para desfazer. */
      const desfazerPintura = () => {
        const f = freioLidaRef.current.get(leadId);
        if (!f?.pintouLida) return false;
        f.pintouLida = false;
        repintarNaoLida(leadId);
        return true;
      };

      let r: Awaited<ReturnType<typeof carregarConversa>>;
      try {
        r = await carregarConversa(leadId, { registrarAcesso: true });
      } catch {
        r = { erro: "A conexão não respondeu. Tente de novo." };
      }
      // Dois cliques rápidos: só a resposta do ÚLTIMO conta. Se o último
      // foi outra conversa (ou fechar), esta nem carregou: a linha volta ao
      // negrito e o badge, à conta do servidor.
      if (pedido !== pedidoConversaRef.current) {
        if (abertaRef.current?.leadId !== leadId && desfazerPintura()) {
          recontarNaoLidas();
        }
        return;
      }
      setCarregandoConversa(false);
      if ("erro" in r) {
        setErroConversa(r.erro);
        // Sem compositor para receber o foco, as teclas voltam a valer.
        if (compositorPendenteRef.current === leadId) {
          compositorPendenteRef.current = null;
        }
        // Nada da conversa chegou à tela: ela volta a contar no badge, e a
        // linha, ao negrito.
        definirConversaEmCena(null);
        recontarNaoLidas();
        desfazerPintura();
        return;
      }
      // O que chegou pelo tempo real enquanto a conversa abria entra junto.
      const agora = Date.now();
      const completa = chegadasNaAberturaRef.current.reduce(
        (c, m) => anexarMensagem(c, m, agora),
        r,
      );
      chegadasNaAberturaRef.current = [];
      conversaCarregadaRef.current = leadId;
      setConversa(completa);
      // Quem abriu pelo histórico ou pela busca pode não ter o nome certo.
      if (completa.nome && completa.nome !== nome) {
        abertaRef.current = { leadId, nome: completa.nome };
        setAberta((a) =>
          a && a.leadId === leadId ? { ...a, nome: completa.nome } : a,
        );
      }
      // O dono veio com a conversa, mais novo que o da fila: o badge já
      // acerta aqui, sem esperar a gravação (que o freio pode segurar 10 s).
      definirConversaEmCena(
        leAoAbrir(completa.ferramentas.responsavelId) ? leadId : null,
      );
      marcarLida(leadId);
    },
    [
      marcarLida,
      descarregarLida,
      repintarNaoLida,
      escreverUrl,
      segurarPeloEnvio,
      alvoDaLinha,
      leAoAbrir,
    ],
  );

  /** Fecha a conversa na tela (o histórico é de quem chama). */
  const fecharConversa = useCallback(() => {
    const saindo = abertaRef.current?.leadId;
    if (saindo) {
      descarregarLida(saindo);
      // A lista volta no lugar da conversa: o foco vai para a linha que
      // fechou ou, se ela saiu da fila, para o título da visão (na seleção,
      // com o título fora da tela, para a caixa de "Selecionar todas"). A
      // busca não: no celular, focar o campo abriria o teclado.
      focoDepoisRef.current = () =>
        listaRef.current?.querySelector<HTMLElement>(
          `[data-lead="${CSS.escape(saindo)}"] button`,
        ) ??
        tituloVisaoRef.current ??
        selecionarTodasRef.current;
    }
    abertaRef.current = null;
    conversaCarregadaRef.current = null;
    compositorPendenteRef.current = null;
    pedidoConversaRef.current++;
    pedidoResumoRef.current++;
    definirConversaEmCena(null);
    setResumo(null);
    setResumindo(false);
    setAberta(null);
    setConversa(null);
    setErroConversa(null);
    setPainelAberto(false);
    setFocoCompositorPara(null);
  }, [descarregarLida]);

  /** O "←" da conversa: volta no histórico se ela entrou nele. */
  const sairDaConversa = useCallback(() => {
    if (segurarPeloEnvio()) return;
    if (empurrouRef.current) {
      empurrouRef.current = false;
      window.history.back();
      return;
    }
    fecharConversa();
    escreverUrl(null, filtrosRef.current, "replace");
  }, [fecharConversa, escreverUrl, segurarPeloEnvio]);

  // O voltar do sistema (borda do iPhone, botão do Android, ⌘[ ): a URL
  // decide. Sem ?lead=, a conversa fecha; com outro lead, ele abre.
  useEffect(() => {
    const aoVoltarNoHistorico = () => {
      // O voltar saiu do /chat (a ficha de onde a pessoa veio): a tela é do
      // Next agora. Nada de empurrar a URL de volta: a Janela desmonta e, se
      // o envio falhar, a rede dele devolve o texto ao rascunho.
      if (window.location.pathname !== "/chat") return;
      const lead = new URLSearchParams(window.location.search).get("lead");
      // Envio no ar na conversa em cena: o voltar a desmontaria com ele. A
      // URL volta para a conversa e o aviso explica.
      const emCena = abertaRef.current?.leadId;
      if (emCena && lead !== emCena && segurarPeloEnvio(emCena)) {
        escreverUrl(emCena, filtrosRef.current, "push");
        return;
      }
      empurrouRef.current = false;
      if (!lead) {
        if (abertaRef.current) fecharConversa();
        return;
      }
      if (lead !== abertaRef.current?.leadId) {
        const linha = todasLinhasRef.current.find((l) => l.leadId === lead);
        void abrirConversa(lead, linha?.nome ?? "Conversa", {
          historia: "nenhuma",
        });
      }
    };
    window.addEventListener("popstate", aoVoltarNoHistorico);
    return () => window.removeEventListener("popstate", aoVoltarNoHistorico);
  }, [abrirConversa, fecharConversa, segurarPeloEnvio, escreverUrl]);

  // O chat reescreve a URL por fora do Next (pushState e replaceState
  // nativos). No voltar do navegador vindo da ficha, o Next pode restaurar a
  // árvore do primeiro quadro: a tela remonta com os filtros e a conversa do
  // carregamento enquanto a URL diz outra coisa. Na montagem, a URL vence:
  // filtros aplicados e conversa aberta sem mexer no histórico.
  //
  // O /chat sem nada na URL é a fila guardada (o cookie que o servidor já
  // usou no primeiro quadro): a tela fica com ela e a URL passa a dizê-la,
  // para o voltar do navegador e a ficha do contato voltarem à mesma fila.
  const conferiuUrlRef = useRef(false);
  useEffect(() => {
    if (conferiuUrlRef.current) return;
    conferiuUrlRef.current = true;
    const params = new URLSearchParams(window.location.search);
    const brutos = Object.fromEntries(params);
    const leadDaUrl = params.get("lead") || null;
    const semFilaNaUrl = !filaNaUrl(brutos) && !leadDaUrl;
    const daUrl = semFilaNaUrl
      ? ((meuId ? lerCookieFila(lerCookie(COOKIE_FILA), meuId) : null) ??
        FILTROS_FILA_PADRAO)
      : lerFiltrosFila(brutos);
    if (!mesmosFiltrosFila(daUrl, filtrosRef.current)) {
      filtrosRef.current = daUrl;
      setFiltros(daUrl);
      setBusca(daUrl.busca);
      void recarregarLista(daUrl);
    }
    if (semFilaNaUrl) escreverUrl(null, filtrosRef.current, "replace");
    if (leadDaUrl === (leadInicialId ?? leadSemAbrir ?? null)) return;
    // O aviso do link era do primeiro quadro, não da URL de agora.
    // eslint-disable-next-line react-hooks/set-state-in-effect -- sincroniza com a URL (externa ao React), uma vez, na montagem
    setLinkSemAbrir(null);
    if (leadDaUrl) {
      const linha = todasLinhasRef.current.find((l) => l.leadId === leadDaUrl);
      void abrirConversa(leadDaUrl, linha?.nome ?? "Conversa", {
        historia: "nenhuma",
      });
    } else if (abertaRef.current) {
      fecharConversa();
    }
  }, [
    abrirConversa,
    fecharConversa,
    recarregarLista,
    escreverUrl,
    leadInicialId,
    leadSemAbrir,
    meuId,
  ]);

  // A fila guardada pode ter ficado velha (etiqueta apagada, campanha que
  // saiu da lista, pessoa que saiu da equipe ou ficou oculta): na montagem,
  // o que não existe mais sai do filtro, em vez de deixar a fila vazia a
  // cada visita. Catálogo que não carregou não tira nada.
  const conferiuGuardadaRef = useRef(false);
  useEffect(() => {
    if (!filaGuardada || conferiuGuardadaRef.current) return;
    conferiuGuardadaRef.current = true;
    const f = filtrosRef.current;
    const etiquetasOk = catalogos.etiquetas
      ? f.etiquetas.filter((id) => catalogos.etiquetas?.some((t) => t.id === id))
      : f.etiquetas;
    const atendentesOk = catalogos.equipe
      ? f.atendentes.filter(
          (id) =>
            id === SEM_DONO ||
            (catalogos.equipe?.some((p) => p.id === id) &&
              !donoOculto(id, donosOcultos)),
        )
      : f.atendentes;
    const campanhaOk =
      f.campanhaId && campanhas && !campanhas.some((c) => c.id === f.campanhaId)
        ? ""
        : f.campanhaId;
    if (
      etiquetasOk.length !== f.etiquetas.length ||
      atendentesOk.length !== f.atendentes.length ||
      campanhaOk !== f.campanhaId
    ) {
      aplicarFiltros({
        etiquetas: etiquetasOk,
        atendentes: atendentesOk,
        campanhaId: campanhaOk,
      });
    }
  }, [
    filaGuardada,
    catalogos.etiquetas,
    catalogos.equipe,
    campanhas,
    donosOcultos,
    aplicarFiltros,
  ]);

  /**
   * Anda na fila. Quando a conversa em cena NÃO está na lista (deep link,
   * busca, resolvida), J vai para a primeira e K para a ÚLTIMA.
   */
  const andarNaFila = useCallback(
    (passo: 1 | -1) => {
      const fila = linhasRef.current;
      if (fila.length === 0) return;
      const atual = abertaRef.current?.leadId;
      const i = fila.findIndex((l) => l.leadId === atual);
      const alvo =
        i === -1
          ? fila[passo === 1 ? 0 : fila.length - 1]
          : fila[(i + passo + fila.length) % fila.length];
      // Fila de um item só: a volta cai nela mesma. Reabrir descartaria o
      // que está no compositor por nada.
      if (!alvo || alvo.leadId === atual) return;
      const ativo = document.activeElement;
      void abrirConversa(alvo.leadId, alvo.nome, {
        historia: !abertaRef.current && !telaMdRef.current ? "push" : "replace",
        foco: listaRef.current?.contains(ativo) ? "linha" : undefined,
      });
    },
    [abrirConversa],
  );
  const proxima = useCallback(() => andarNaFila(1), [andarNaFila]);
  const anterior = useCallback(() => andarNaFila(-1), [andarNaFila]);

  /**
   * Depois de resolver ou adiar a conversa em cena: a seguinte da fila (com
   * volta ao começo) ou, sem nenhuma, a fila vazia. Lê a fila de antes da
   * remoção e pula a própria conversa.
   */
  const seguirDepoisDe = useCallback(
    (leadId: string, foco: FocoAoSeguir) => {
      const fila = linhasRef.current;
      const i = fila.findIndex((l) => l.leadId === leadId);
      const ordem = i === -1 ? fila : [...fila.slice(i + 1), ...fila.slice(0, i)];
      const alvo = ordem.find((l) => l.leadId !== leadId);
      if (!alvo) {
        sairDaConversa();
        return;
      }
      void abrirConversa(alvo.leadId, alvo.nome, {
        historia: "replace",
        foco,
      });
    },
    [abrirConversa, sairDaConversa],
  );

  /**
   * A nota que uma action do recontato gravou entra na conversa em cena na
   * hora (e a faixa acompanha, por anexarMensagem). O tempo real traz a
   * mesma linha depois e ela é ignorada pelo id.
   */
  const anexarNotaDeRecontato = useCallback(
    (leadId: string, nota: NotaRecontato) => {
      if (abertaRef.current?.leadId !== leadId) return;
      const m = paraMensagem(
        {
          id: nota.id,
          tipo: "nota",
          conteudo: nota.conteudo,
          criado_em: nota.criado_em,
          metadados: nota.metadados as LinhaBrutaInteracao["metadados"],
        },
        nota.autor,
      );
      vistasRef.current.add(nota.id);
      if (conversaCarregadaRef.current !== leadId) {
        chegadasNaAberturaRef.current.push(m);
        return;
      }
      const agora = Date.now();
      setConversa((c) =>
        c && c.leadId === leadId ? anexarMensagem(c, m, agora) : c,
      );
    },
    [],
  );

  /* ── resolver, adiar, reativar ───────────────────────────────────────── */

  // A linha sai da visão e o servidor confirma; erro devolve e avisa. Na
  // Caixa, a de recontato do dia fica (só o estado dela muda).
  const despachar = useCallback(
    async (
      leadId: string,
      acao: "resolver" | "adiar" | "reativar",
      opcoes: {
        prazo?: PrazoAdiar;
        /** Só no prazo "data": o instante escolhido (ISO). */
        ate?: string;
        /** O texto do aviso no lugar do do prazo (agendar recontato). */
        aviso?: string;
        /** Sem o "Desfazer": o recontato agendado se desfaz pela faixa. */
        semDesfazer?: boolean;
        /** O recontato que a linha leva depois do gesto (agendar recontato),
         *  antes de a lista acompanhar: decide se ela fica na Caixa. */
        recontato?: RecontatoDaLinha | null;
        jaNoServidor?: boolean;
        /** O gesto veio do compositor: o foco segue para o compositor da
         *  próxima (⌘Enter) ou para a linha dela ("Resolver e seguir"). */
        focoAoSeguir?: "linha" | "compositor";
        /** O gesto veio da linha (a bandeja, o arrasto): sem conversa a
         *  seguir, o foco é amparado na fila (ampararFocoDaLinha). */
        daFila?: boolean;
      } = {},
    ) => {
      const prazo = opcoes.prazo ?? "amanha";
      // Tecla presa ou E-E na MESMA conversa: a segunda espera. Outra
      // conversa segue livre.
      if (pendentesRef.current.has(leadId)) return;
      // Resolver ou adiar com o envio no ar desmontaria a Janela antes do
      // desfecho. O ⌘Enter (jaNoServidor) chega aqui depois dele.
      if (
        !opcoes.jaNoServidor &&
        acao !== "reativar" &&
        segurarPeloEnvio(leadId)
      ) {
        return;
      }
      const linhaAntes =
        todasLinhasRef.current.find((l) => l.leadId === leadId) ?? null;
      const nome =
        linhaAntes?.nome ??
        (abertaRef.current?.leadId === leadId ? abertaRef.current.nome : "");
      // Já estava resolvida (o ⌘Enter numa resolvida): o Desfazer reabriria
      // o que estava fechado, então não aparece.
      const conversaAntes =
        conversaRef.current?.leadId === leadId ? conversaRef.current : null;
      const estavaResolvida =
        linhaAntes?.resolvida ??
        conversaAntes?.ferramentas.conversaResolvida ??
        false;
      // Foco na fila (ou solto) vai para a linha da próxima; o gesto do
      // compositor diz o dele; o resto só é amparado se cair no body.
      const ativo = document.activeElement;
      const foco: FocoAoSeguir =
        listaRef.current?.contains(ativo) || ativo === document.body
          ? "linha"
          : (opcoes.focoAoSeguir ?? "se-solto");
      const ampararFoco = opcoes.daFila ? ampararFocoDaLinha(leadId) : null;
      let r: { ok?: boolean; erro?: string };
      if (opcoes.jaNoServidor) {
        r = { ok: true };
      } else {
        pendentesRef.current.add(leadId);
        setAcaoPendente(new Set(pendentesRef.current));
        try {
          r =
            acao === "resolver"
              ? await alterarStatusConversaChat(leadId, "resolved")
              : acao === "reativar"
                ? await reativarConversa(leadId)
                : await adiarConversa(leadId, prazo, opcoes.ate);
        } catch {
          r = { erro: "A conexão não respondeu. Tente de novo." };
        } finally {
          pendentesRef.current.delete(leadId);
          setAcaoPendente(new Set(pendentesRef.current));
        }
      }
      if (r.erro) {
        mostrarAviso({ texto: r.erro, tom: "erro" });
        return;
      }
      // A conversa em cena segue para a próxima (seguirDepoisDe, mais
      // abaixo), que leva o foco; a linha de fora da cena, ou a reativada,
      // não segue para nada: o foco fica na fila.
      if (abertaRef.current?.leadId !== leadId || acao === "reativar") {
        ampararFoco?.();
      }
      const visao = filtrosRef.current.visao;
      const hoje = hojeEmBrasilia();
      const estavaNaCaixa = linhaAntes
        ? naCaixa(linhaAntes, hoje)
        : visao === "caixa";
      // Com recontato do dia, resolver ou adiar não tira a conversa da
      // Caixa: o recontato é trabalho do dia até alguém dar Feito, Cancelar
      // ou mandar o template (a regra de lista.ts).
      const ficaNaCaixa =
        acao !== "reativar" &&
        voltaPeloRecontato(
          opcoes.recontato !== undefined
            ? opcoes.recontato
            : (linhaAntes?.recontato ?? null),
          hoje,
        );
      const semDono = linhaAntes ? !linhaAntes.responsavelId : false;
      // Reativar a adiada que o recontato do dia já punha na Caixa não soma.
      const deltaCaixa =
        acao === "reativar"
          ? linhaAntes && estavaNaCaixa
            ? 0
            : 1
          : estavaNaCaixa && !ficaNaCaixa
            ? -1
            : 0;
      // Em Tudo e em Recontatos a linha fica (o recontato continua
      // pendente), e na Caixa a do recontato do dia: só o estado dela muda.
      const linhaFica =
        visao === "tudo" ||
        visao === "recontatos" ||
        (visao === "caixa" && ficaNaCaixa);
      setLista((c) => ({
        ...c,
        linhas: linhaFica
          ? c.linhas.map((l) =>
              l.leadId !== leadId
                ? l
                : acao === "resolver"
                  ? { ...l, resolvida: true, naoLida: false }
                  : acao === "reativar"
                    ? { ...l, adiadaAte: null, adiadaVencida: false }
                    : opcoes.ate
                      ? {
                          ...l,
                          adiadaAte: opcoes.ate,
                          adiadaVencida: false,
                          sub: null,
                        }
                      : l,
            )
          : c.linhas.filter((l) => l.leadId !== leadId),
        contagens: c.contagens
          ? {
              ...c.contagens,
              caixa: Math.max(0, c.contagens.caixa + deltaCaixa),
              aguardando: Math.max(
                0,
                c.contagens.aguardando - (visao === "aguardando" ? 1 : 0),
              ),
              // Adiar já estando em Adiadas não soma: a linha só sai da
              // lista e voltaria a ser contada.
              adiadas: Math.max(
                0,
                c.contagens.adiadas +
                  (acao === "adiar" && visao !== "adiadas"
                    ? 1
                    : acao === "reativar"
                      ? -1
                      : 0),
              ),
              resolvidas: Math.max(
                0,
                c.contagens.resolvidas +
                  (acao === "resolver" && visao !== "resolvidas" ? 1 : 0),
              ),
              semDono:
                c.contagens.semDono === undefined
                  ? undefined
                  : Math.max(
                      0,
                      c.contagens.semDono + (semDono ? deltaCaixa : 0),
                    ),
            }
          : null,
      }));
      if (acao === "adiar") adiadasAquiRef.current.add(leadId);
      // A linha que ficou na Caixa pelo recontato traz o estado novo (o
      // prazo do adiar rápido sai do relógio do servidor) na recarga.
      if (visao === "caixa" && ficaNaCaixa) {
        void recarregarLista(filtrosRef.current, { silenciosa: true });
      }
      // Resolver e adiar marcam lida no servidor: o badge reconta.
      recontarNaoLidas();
      if (acao === "reativar") {
        mostrarAviso({ texto: `De volta à Caixa · ${nome}`, tom: "normal" });
      } else {
        const rotulo =
          acao === "resolver"
            ? "Resolvida"
            : (opcoes.aviso ??
              PRAZOS_ADIAR.find((p) => p.prazo === prazo)?.aviso ??
              (prazo === "data" && opcoes.ate
                ? `Adiada até ${quandoEmTexto(opcoes.ate)}`
                : "Adiada"));
        mostrarAviso({
          texto: nome ? `${rotulo} · ${nome}` : rotulo,
          tom: "normal",
          desfazer:
            (acao === "resolver" && estavaResolvida) || opcoes.semDesfazer
              ? undefined
              : {
                  leadId,
                  acao,
                  naoLidaAntes: linhaAntes?.naoLida ?? false,
                },
        });
      }
      if (abertaRef.current?.leadId === leadId) {
        if (acao === "resolver") {
          setConversa((c) =>
            c && c.leadId === leadId
              ? {
                  ...c,
                  ferramentas: { ...c.ferramentas, conversaResolvida: true },
                }
              : c,
          );
        }
        if (acao !== "reativar") seguirDepoisDe(leadId, foco);
      }
    },
    [
      mostrarAviso,
      seguirDepoisDe,
      segurarPeloEnvio,
      ampararFocoDaLinha,
      recarregarLista,
    ],
  );

  /** O "Desfazer" do aviso: reabre, tira do adiamento, devolve a conversa
   *  a quem atendia antes da transferência ou traz de volta o recontato que
   *  Feito ou Cancelar fechou. */
  const desfazer = async () => {
    const atual = aviso;
    if (!atual?.desfazer) return;
    setAviso(null);
    if (atual.desfazer.acao === "transferir") {
      const { leadId, dono } = atual.desfazer;
      let r: { ok?: boolean; erro?: string };
      try {
        r = await definirResponsavelChat(leadId, dono?.id ?? null);
      } catch {
        r = { erro: "A conexão não respondeu. Tente de novo." };
      }
      if (r.erro) {
        mostrarAviso({ texto: r.erro, tom: "erro" });
        return;
      }
      refletirDono(leadId, dono);
      // A linha pode ter saído do recorte com a transferência ("Minhas"):
      // a recarga a traz de volta, com as contagens certas.
      void recarregarLista(filtrosRef.current, { silenciosa: true });
      if (gestao) void pedirCarga(true);
      return;
    }
    if (atual.desfazer.acao === "recontato") {
      // O recontato volta como estava (id novo: o antigo já tem a nota de
      // fim), sem mexer na conversa.
      const { leadId, recontato } = atual.desfazer;
      let r: ResultadoRecontato;
      try {
        r = await agendarRecontato({
          leadId,
          quando: recontato.quando,
          motivo: recontato.motivo,
          template: recontato.template,
          restaurar: true,
        });
      } catch {
        r = { erro: "A conexão não respondeu. Tente de novo." };
      }
      if (r.erro) {
        mostrarAviso({ texto: r.erro, tom: "erro" });
        return;
      }
      if (r.nota) anexarNotaDeRecontato(leadId, r.nota);
      void recarregarLista(filtrosRef.current, { silenciosa: true });
      return;
    }
    const { leadId, acao, naoLidaAntes } = atual.desfazer;
    let r: { ok?: boolean; erro?: string };
    try {
      r =
        acao === "resolver"
          ? await alterarStatusConversaChat(leadId, "open")
          : await reativarConversa(leadId);
      // Resolver e adiar gravaram como lida: a que estava não lida volta.
      if (!r.erro && naoLidaAntes) await marcarChatNaoLido(leadId);
    } catch {
      r = { erro: "A conexão não respondeu. Tente de novo." };
    }
    if (r.erro) {
      mostrarAviso({ texto: r.erro, tom: "erro" });
      return;
    }
    if (acao === "resolver") {
      setConversa((c) =>
        c && c.leadId === leadId
          ? { ...c, ferramentas: { ...c.ferramentas, conversaResolvida: false } }
          : c,
      );
    }
    recontarNaoLidas();
    void recarregarLista(filtrosRef.current, { silenciosa: true });
  };

  /* ── dono da conversa ────────────────────────────────────────────────── */

  /** O dono de uma conversa mudou: a conversa em cena e a linha acertam. */
  const refletirDono = useCallback(
    (leadId: string, dono: DonoConversa | null) => {
      const responsavelId = dono?.id ?? null;
      const nome = dono?.nome ?? null;
      setConversa((c) =>
        c && c.leadId === leadId
          ? {
              ...c,
              ferramentas: {
                ...c.ferramentas,
                responsavelId,
                responsavelNome: nome,
              },
            }
          : c,
      );
      const linha = todasLinhasRef.current.find((l) => l.leadId === leadId);
      const f = filtrosRef.current;
      // Passar para um dono oculto para quem passou (Administração >
      // Privacidade) também tira a conversa da fila, em qualquer recorte.
      const saiDoRecorte =
        (f.escopo === "semDono" && responsavelId !== null) ||
        (f.escopo === "minhas" && responsavelId !== meuId) ||
        (f.atendentes.length > 0 &&
          !f.atendentes.includes(responsavelId ?? SEM_DONO)) ||
        donoOculto(responsavelId, donosOcultosRef.current);
      const deltaSemDono =
        linha && naCaixa(linha)
          ? !linha.responsavelId && responsavelId
            ? -1
            : linha.responsavelId && !responsavelId
              ? 1
              : 0
          : 0;
      setLista((c) => {
        const contagens: Contagens | null = c.contagens
          ? {
              ...c.contagens,
              semDono:
                c.contagens.semDono === undefined
                  ? undefined
                  : Math.max(0, c.contagens.semDono + deltaSemDono),
            }
          : null;
        if (saiDoRecorte && c.linhas.some((l) => l.leadId === leadId)) {
          const visao = f.visao;
          return {
            ...c,
            linhas: c.linhas.filter((l) => l.leadId !== leadId),
            contagens: contagens ? contagensSemUma(contagens, visao) : contagens,
          };
        }
        return {
          ...c,
          linhas: c.linhas.map((l) =>
            l.leadId === leadId
              ? { ...l, responsavelId, responsavelNome: nome }
              : l,
          ),
          contagens,
        };
      });
      // Passou a ser minha com ela na tela (transferi para mim, desfiz a
      // transferência): agora sou o dono que lê, e a leitura grava. Quem
      // abriu sem ser dono deixou a marca de não lida de pé até aqui.
      if (
        responsavelId !== null &&
        responsavelId === meuId &&
        abertaRef.current?.leadId === leadId &&
        conversaCarregadaRef.current === leadId &&
        document.visibilityState === "visible"
      ) {
        marcarLida(leadId);
      }
    },
    [meuId, marcarLida],
  );

  /** Assumir em um gesto (botão, ação da linha, tecla A). O banco decide
   *  quem chegou primeiro; quem perdeu vê o dono real. */
  const assumir = useCallback(
    async (leadId: string, opcoes: { daFila?: boolean } = {}) => {
      if (pendentesRef.current.has(leadId)) return;
      // O Assumir da bandeja some com a conversa assumida (e a linha sai de
      // "Sem dono"): o foco fica na fila.
      const ampararFoco = opcoes.daFila ? ampararFocoDaLinha(leadId) : null;
      pendentesRef.current.add(leadId);
      setAcaoPendente(new Set(pendentesRef.current));
      let r: ResultadoAssumir;
      try {
        r = await assumirConversa(leadId);
      } catch {
        r = { erro: "A conexão não respondeu. Tente de novo." };
      } finally {
        pendentesRef.current.delete(leadId);
        setAcaoPendente(new Set(pendentesRef.current));
      }
      if (r.ok) {
        ampararFoco?.();
        refletirDono(leadId, r.dono);
        return;
      }
      mostrarAviso({ texto: r.erro, tom: "erro" });
      if (r.dono) {
        // Outra pessoa chegou antes: o Assumir também some.
        ampararFoco?.();
        refletirDono(leadId, r.dono);
      }
    },
    [refletirDono, mostrarAviso, ampararFocoDaLinha],
  );

  // ── o que o menu ⋯ mudou: a conversa e a linha acertam aqui mesmo ──

  /** Uma linha saiu do recorte que a fila está mostrando. */
  const tirarDaFila = useCallback((leadId: string) => {
    const visao = filtrosRef.current.visao;
    setLista((c) => ({
      ...c,
      linhas: c.linhas.filter((l) => l.leadId !== leadId),
      contagens: c.contagens
        ? contagensSemUma(c.contagens, visao)
        : c.contagens,
    }));
  }, []);

  const aoAtribuirAberta = useCallback(
    (
      responsavelId: string | null,
      antes: { id: string; nome: string } | null,
    ) => {
      const leadId = abertaRef.current?.leadId;
      if (!leadId) return;
      const nomeNovo = responsavelId
        ? (nomeNaEquipe(responsavelId) ?? "Atendente")
        : null;
      refletirDono(
        leadId,
        responsavelId && nomeNovo ? { id: responsavelId, nome: nomeNovo } : null,
      );
      // Passou para alguém cujas conversas esta pessoa não vê: a linha já
      // saiu da fila (refletirDono) e a conversa sai da tela. Com envio no
      // ar ela fica até o envio terminar (fechar agora levaria a mensagem
      // junto); a fila, não. Ela saiu de TODAS as visões, e refletirDono só
      // desconta a atual: as contagens voltam certas do servidor, como na
      // seleção em massa (a troca de dono não gera evento no tempo real).
      if (responsavelId && donoOculto(responsavelId, donosOcultosRef.current)) {
        const nome = nomeNaEquipe(responsavelId) ?? "essa pessoa";
        if (!envioEmVooRef.current.has(leadId)) sairDaConversa();
        void recarregarLista(filtrosRef.current, { silenciosa: true });
        mostrarAviso({
          texto: `Conversa transferida para ${nome}. A conversa sai da sua fila: você não vê as conversas de ${nome}.`,
          tom: "normal",
        });
        return;
      }
      // Fora da gestão, o RLS (vejo_lead, 0067) só mostra as conversas da
      // própria pessoa e, ao assessor, também as sem dono. Passou para quem
      // tira a conversa da vista dela: o Desfazer voltaria "não encontrada",
      // então o aviso sai sem ele e a conversa fecha, como no dono oculto.
      const continuaVendo =
        gestao ||
        (responsavelId !== null && responsavelId === meuId) ||
        (responsavelId === null && papel === "vendedor");
      if (!continuaVendo) {
        if (!envioEmVooRef.current.has(leadId)) sairDaConversa();
        void recarregarLista(filtrosRef.current, { silenciosa: true });
        mostrarAviso({
          texto: nomeNovo
            ? `Transferida para ${nomeNovo}. A conversa sai da sua fila.`
            : "Conversa sem dono. A conversa sai da sua fila.",
          tom: "normal",
        });
        return;
      }
      // O aviso no pé, com Desfazer por 6 s: um toque na linha vizinha
      // passava a conversa para a pessoa errada sem nada na tela.
      mostrarAviso({
        texto: nomeNovo ? `Transferida para ${nomeNovo}` : "Conversa sem dono",
        tom: "normal",
        desfazer: { leadId, acao: "transferir", dono: antes },
      });
      if (gestao) void pedirCarga(true);
    },
    [
      refletirDono,
      nomeNaEquipe,
      sairDaConversa,
      recarregarLista,
      mostrarAviso,
      gestao,
      pedirCarga,
      meuId,
      papel,
    ],
  );

  const aoEtiquetarAberta = useCallback(
    (tagId: string, marcar: boolean) => {
      const leadId = abertaRef.current?.leadId;
      if (!leadId) return;
      const tag = catalogos.etiquetas?.find((t) => t.id === tagId);
      setConversa((c) => {
        if (!c || c.leadId !== leadId || !c.ferramentas.etiquetasLead) {
          return c;
        }
        const sem = c.ferramentas.etiquetasLead.filter((id) => id !== tagId);
        return {
          ...c,
          ferramentas: {
            ...c.ferramentas,
            etiquetasLead: marcar ? [...sem, tagId] : sem,
          },
        };
      });
      // Filtrando por etiquetas, a conversa que deixou de casar sai da fila:
      // tirou a última das marcadas (qualquer uma), uma delas (todas) ou
      // ganhou a primeira etiqueta (sem etiqueta).
      const f = filtrosRef.current;
      if (f.semEtiqueta || f.etiquetas.length > 0) {
        const linha = todasLinhasRef.current.find((l) => l.leadId === leadId);
        const depois = (linha?.etiquetas ?? [])
          .map((e) => e.id)
          .filter((id) => id !== tagId);
        if (marcar) depois.push(tagId);
        if (linha && !casaComEtiquetas(depois, f)) {
          tirarDaFila(leadId);
          return;
        }
      }
      setLista((c) => ({
        ...c,
        linhas: c.linhas.map((l) => {
          if (l.leadId !== leadId) return l;
          const sem = l.etiquetas.filter((e) => e.id !== tagId);
          return {
            ...l,
            etiquetas:
              marcar && tag
                ? [...sem, { id: tag.id, nome: tag.nome }].sort((a, b) =>
                    a.nome.localeCompare(b.nome, "pt-BR"),
                  )
                : sem,
          };
        }),
      }));
    },
    [catalogos.etiquetas, tirarDaFila],
  );

  /** O ⋯ marcou "não lida": a linha volta a ficar em negrito na hora. */
  const aoMarcarNaoLidaAberta = useCallback(() => {
    const leadId = abertaRef.current?.leadId;
    if (!leadId) return;
    cancelarMarcaLida(leadId);
    const linha = todasLinhasRef.current.find((l) => l.leadId === leadId);
    if (linha && !linha.naoLida && contaNoBadge({ ...linha, naoLida: true })) {
      ajustarNaoLidas(1);
    }
    recontarNaoLidas();
    setLista((c) => ({
      ...c,
      linhas: c.linhas.map((l) =>
        l.leadId === leadId ? { ...l, naoLida: true } : l,
      ),
    }));
  }, [cancelarMarcaLida]);

  // "Marcar não lida" suspende a marca de lida no clique, antes de a action
  // sair; se ela falhar, a marca volta.
  const aoAntesDeMarcarNaoLida = useCallback(
    (leadId: string) => cancelarMarcaLida(leadId),
    [cancelarMarcaLida],
  );
  const aoFalharMarcarNaoLida = useCallback(
    (leadId: string) => marcarLida(leadId),
    [marcarLida],
  );

  /** Reaberta: sai de Resolvidas e volta para a Caixa. */
  const refletirReaberta = useCallback((leadId: string) => {
    setConversa((c) =>
      c && c.leadId === leadId
        ? {
            ...c,
            ferramentas: { ...c.ferramentas, conversaResolvida: false },
          }
        : c,
    );
    const visao = filtrosRef.current.visao;
    const linha = todasLinhasRef.current.find((l) => l.leadId === leadId);
    setLista((c) => ({
      ...c,
      linhas:
        visao === "resolvidas"
          ? c.linhas.filter((l) => l.leadId !== leadId)
          : c.linhas.map((l) =>
              l.leadId === leadId ? { ...l, resolvida: false } : l,
            ),
      contagens: c.contagens
        ? {
            ...c.contagens,
            caixa: c.contagens.caixa + 1,
            resolvidas: Math.max(0, c.contagens.resolvidas - 1),
            semDono:
              c.contagens.semDono === undefined
                ? undefined
                : c.contagens.semDono + (linha && !linha.responsavelId ? 1 : 0),
          }
        : null,
    }));
    recontarNaoLidas();
  }, []);
  const aoReabrirAberta = useCallback(() => {
    const leadId = abertaRef.current?.leadId;
    if (leadId) refletirReaberta(leadId);
  }, [refletirReaberta]);

  /** Reabre uma conversa resolvida pela linha da fila (o arrasto para a
   *  esquerda, a bandeja) ou pela paleta. Não tem Desfazer: o gesto é o par
   *  do "Voltar à Caixa" das Adiadas. */
  const reabrir = useCallback(
    async (leadId: string, opcoes: { daFila?: boolean } = {}) => {
      if (pendentesRef.current.has(leadId)) return;
      const nome =
        todasLinhasRef.current.find((l) => l.leadId === leadId)?.nome ??
        (abertaRef.current?.leadId === leadId ? abertaRef.current.nome : "");
      // Em Resolvidas a linha sai da lista; em Tudo o Reabrir vira Adiar.
      // Nos dois, o foco do teclado ia para o body.
      const ampararFoco = opcoes.daFila ? ampararFocoDaLinha(leadId) : null;
      pendentesRef.current.add(leadId);
      setAcaoPendente(new Set(pendentesRef.current));
      let r: { ok?: boolean; erro?: string };
      try {
        r = await alterarStatusConversaChat(leadId, "open");
      } catch {
        r = { erro: "A conexão não respondeu. Tente de novo." };
      } finally {
        pendentesRef.current.delete(leadId);
        setAcaoPendente(new Set(pendentesRef.current));
      }
      if (r.erro) {
        mostrarAviso({ texto: r.erro, tom: "erro" });
        return;
      }
      ampararFoco?.();
      refletirReaberta(leadId);
      mostrarAviso({
        texto: nome ? `De volta à Caixa · ${nome}` : "De volta à Caixa",
        tom: "normal",
      });
    },
    [refletirReaberta, mostrarAviso, ampararFocoDaLinha],
  );

  /* ── tempo real ──────────────────────────────────────────────────────── */

  const equipeRef = useRef(catalogos.equipe);
  useEffect(() => {
    equipeRef.current = catalogos.equipe;
  }, [catalogos.equipe]);

  /** Mensagem na conversa aberta, vinda de qualquer um dos dois canais. */
  const aoMensagemDaAberta = useCallback(
    (bruta: LinhaRealtime) => {
      const linha = comHoraValida(bruta);
      const emCena = abertaRef.current;
      if (!emCena || linha.lead_id !== emCena.leadId) return;
      if (!ehTipoMensagem(linha.tipo) || !linha.id) return;
      if (vistasRef.current.has(linha.id)) return;
      vistasRef.current.add(linha.id);

      // Do Realtime vem só o autor_id: o nome sai da equipe do catálogo.
      const autorNome = linha.autor_id
        ? (equipeRef.current?.find((p) => p.id === linha.autor_id)?.nome ??
          null)
        : null;
      const mensagem = paraMensagem(linha as LinhaBrutaInteracao, autorNome);
      if (conversaCarregadaRef.current !== emCena.leadId) {
        chegadasNaAberturaRef.current.push(mensagem);
      } else {
        const agora = Date.now();
        setConversa((c) =>
          c && c.leadId === emCena.leadId
            ? anexarMensagem(c, mensagem, agora)
            : c,
        );
      }

      if (linha.tipo === "mensagem_recebida") {
        // O resumo descrevia a conversa até a mensagem de antes.
        setResumo(null);
        if (conversaCarregadaRef.current === emCena.leadId) {
          if (document.visibilityState === "visible") {
            marcarLida(emCena.leadId);
          } else {
            lidaPendenteRef.current = emCena.leadId;
          }
        }
      }
    },
    [marcarLida],
  );

  /** Recibo do WhatsApp (✓, ✓✓, lida, falhou) gravado pelo webhook. */
  const aoAtualizacaoDaAberta = useCallback((bruta: LinhaRealtime) => {
    const linha = comHoraValida(bruta);
    const emCena = abertaRef.current;
    if (!emCena || linha.lead_id !== emCena.leadId) return;
    if (!ehTipoMensagem(linha.tipo) || !linha.id) return;
    // UPDATE que não mexeu nos metadados pode chegar sem eles.
    if (!linha.metadados || typeof linha.metadados !== "object") return;
    const nova = paraMensagem(linha as LinhaBrutaInteracao, null);
    const agora = Date.now();
    setConversa((c) => {
      if (!c || c.leadId !== emCena.leadId) return c;
      const i = c.mensagens.findIndex((m) => m.id === linha.id);
      if (i === -1) {
        // Enviada antes de o canal subir: entra inteira, se o payload a
        // trouxe inteira e se é mais nova que o começo da tela.
        const primeira = c.mensagens[0];
        const cabe =
          typeof linha.conteudo === "string" &&
          (!primeira ||
            Date.parse(linha.criado_em) >= Date.parse(primeira.criado_em));
        if (!cabe) return c;
        const autor = linha.autor_id
          ? (equipeRef.current?.find((p) => p.id === linha.autor_id)?.nome ??
            null)
          : null;
        return anexarMensagem(c, { ...nova, autor }, agora);
      }
      const atual = c.mensagens[i];
      const anexos =
        nova.anexos && nova.anexos.length > 0 ? nova.anexos : atual.anexos;
      if (
        atual.statusEnvio === nova.statusEnvio &&
        atual.erroEnvio === nova.erroEnvio &&
        anexos === atual.anexos
      ) {
        return c;
      }
      const mensagens = c.mensagens.slice();
      mensagens[i] = {
        ...atual,
        statusEnvio: nova.statusEnvio,
        erroEnvio: nova.erroEnvio,
        anexos,
      };
      return { ...c, mensagens };
    });
  }, []);

  /**
   * Mensagem recebida de conversa que não está na fila: na Caixa ela pode
   * ser a adiada que volta (o webhook limpou o adiamento, qualquer que fosse
   * o prazo) ou a resolvida que reabre. Em vez do respiro de 12 s, a fila
   * relê logo, juntando a rajada e no máximo uma vez a cada
   * INTERVALO_RECARGA_RAPIDA_MS. Só onde a de fora quase sempre é desta
   * pessoa: a fila de Todas e a do atendente (o RLS só manda as dele), ou
   * a conversa que esta tela adiou (`conhecida`). Nos outros casos, em
   * Minhas e Sem dono da gestão, a de fora costuma ser de outro dono, e
   * fica o respiro.
   */
  const recargaRapidaRef = useRef<{ timer: number | null; ultima: number }>({
    timer: null,
    ultima: 0,
  });
  const pedirRecargaRapida = useCallback(
    (conhecida: boolean) => {
      const f = filtrosRef.current;
      if (f.visao !== "caixa" && f.visao !== "aguardando" && f.visao !== "tudo") {
        return;
      }
      if (!conhecida && f.escopo !== "todas" && !soAsMinhas) return;
      const r = recargaRapidaRef.current;
      if (r.timer !== null) return;
      const espera = Math.max(
        ESPERA_RECARGA_RAPIDA_MS,
        r.ultima + INTERVALO_RECARGA_RAPIDA_MS - Date.now(),
      );
      r.timer = window.setTimeout(() => {
        r.timer = null;
        r.ultima = Date.now();
        if (document.visibilityState === "visible") {
          void recarregarLista(filtrosRef.current, { silenciosa: true });
        }
      }, espera);
    },
    [recarregarLista, soAsMinhas],
  );
  useEffect(() => {
    const r = recargaRapidaRef.current;
    return () => {
      if (r.timer !== null) window.clearTimeout(r.timer);
    };
  }, []);

  /**
   * O despertador: quando algo volta sozinho (o fim de um adiamento com
   * hora, um recontato), a fila relê nessa hora, e o "Por 1 hora" volta à
   * Caixa sem ninguém recarregar a página. A releitura que volta com o
   * mesmo instante (o aparelho adiantado: o servidor ainda o vê no futuro)
   * tenta de novo em alguns segundos, até TENTATIVAS_DESPERTADOR vezes, e
   * para: nunca vira releitura em laço. Aba escondida não insiste: a volta
   * à aba relê de qualquer jeito.
   */
  const proximaVolta = lista.proximaVolta;
  const despertouRef = useRef<{ instante: string; vezes: number } | null>(
    null,
  );
  // Longe demais para um timer só: dorme o teto e arma de novo. Também
  // rearma depois de cada releitura, que pode não mudar a lista.
  const [rearmar, setRearmar] = useState(0);
  useEffect(() => {
    if (!proximaVolta) return;
    const antes = despertouRef.current;
    const vezes = antes?.instante === proximaVolta ? antes.vezes : 0;
    if (vezes >= TENTATIVAS_DESPERTADOR) return;
    const falta = Date.parse(proximaVolta) - Date.now() + 1500;
    if (Number.isNaN(falta)) return;
    const longe = falta > TETO_DESPERTADOR_MS;
    const espera = longe
      ? TETO_DESPERTADOR_MS
      : Math.max(vezes > 0 ? REPETIR_DESPERTADOR_MS * vezes : 1000, falta);
    const t = window.setTimeout(() => {
      if (longe) {
        setRearmar((n) => n + 1);
        return;
      }
      if (document.visibilityState !== "visible") {
        despertouRef.current = {
          instante: proximaVolta,
          vezes: TENTATIVAS_DESPERTADOR,
        };
        return;
      }
      despertouRef.current = { instante: proximaVolta, vezes: vezes + 1 };
      void recarregarLista(filtrosRef.current, { silenciosa: true }).then(
        () => setRearmar((n) => n + 1),
      );
    }, espera);
    return () => window.clearTimeout(t);
  }, [proximaVolta, recarregarLista, rearmar]);

  /** Mensagem de qualquer contato: só a linha dele muda, na hora. */
  const aoMensagemNaFila = useCallback(
    (bruta: LinhaRealtime) => {
      if (!ehTipoMensagem(bruta.tipo)) return;
      const linha = comHoraValida(bruta);
      const naFila = todasLinhasRef.current.find(
        (l) => l.leadId === linha.lead_id,
      );
      // Privacidade (Administração > Privacidade): o evento da conversa de um
      // dono oculto não mexe na linha, na não lida nem em contador. O evento
      // traz só o lead_id; quem decide pelo dono é a linha que está na fila.
      // O de quem não está nela só pede a recarga do respiro, e a fila do
      // servidor já vem sem os donos ocultos: também não aparece nem conta.
      if (naFila && donoOculto(naFila.responsavelId, donosOcultosRef.current)) {
        return;
      }
      const emCena =
        abertaRef.current?.leadId === linha.lead_id &&
        document.visibilityState === "visible";
      if (naFila) {
        // Em cena, a mensagem nova só nasce lida para quem lê ao abrir (o
        // dono, ou qualquer um na conversa sem dono).
        setLista((c) => ({
          ...c,
          linhas: c.linhas.map((l) =>
            l.leadId === linha.lead_id
              ? linhaComMensagem(
                  l,
                  linha,
                  emCena && leAoAbrir(l.responsavelId),
                )
              : l,
          ),
        }));
      }
      // Fora da fila: pode ser a adiada que volta para a Caixa agora.
      if (!naFila && linha.tipo === "mensagem_recebida") {
        pedirRecargaRapida(adiadasAquiRef.current.has(linha.lead_id));
      }
      // Reserva do canal da conversa: se ele estiver fora do ar, a bolha
      // chega por aqui (o id repetido é ignorado).
      if (abertaRef.current?.leadId === linha.lead_id) {
        aoMensagemDaAberta(linha);
      }
    },
    [aoMensagemDaAberta, leAoAbrir, pedirRecargaRapida],
  );

  /** Recarrega a conversa em cena em silêncio (volta da aba, canal que caiu). */
  const recarregarConversaAberta = useCallback(async () => {
    const leadId = abertaRef.current?.leadId;
    if (!leadId || conversaCarregadaRef.current !== leadId) return;
    let r: Awaited<ReturnType<typeof carregarConversa>>;
    try {
      r = await carregarConversa(leadId);
    } catch {
      return;
    }
    if (abertaRef.current?.leadId !== leadId || "erro" in r) return;
    const doServidor = r;
    setConversa((c) => {
      if (!c || c.leadId !== leadId) return c;
      // O que o tempo real trouxe depois da leitura do servidor fica.
      const ids = new Set(doServidor.mensagens.map((m) => m.id));
      const ultima = doServidor.mensagens.at(-1)?.criado_em;
      const limite = ultima ? Date.parse(ultima) : 0;
      const depois = c.mensagens.filter(
        (m) => !ids.has(m.id) && Date.parse(m.criado_em) > limite,
      );
      return depois.length > 0
        ? { ...doServidor, mensagens: [...doServidor.mensagens, ...depois] }
        : doServidor;
    });
  }, []);

  const aoRessincronizar = useCallback(
    ({ lista: daLista, conversa: daConversa }: Ressincronizar) => {
      // A mensagem que chegou com a aba escondida agora foi vista. Vem antes
      // das recargas: a leitura da lista tem de encontrar a marca gravada.
      const pendente = lidaPendenteRef.current;
      if (
        pendente &&
        pendente === abertaRef.current?.leadId &&
        pendente === conversaCarregadaRef.current &&
        document.visibilityState === "visible"
      ) {
        lidaPendenteRef.current = null;
        marcarLida(pendente);
        // O reflexo na hora só para quem lê ao abrir; para os outros o
        // servidor não grava e a linha segue não lida.
        setLista((c) => ({
          ...c,
          linhas: c.linhas.map((l) =>
            l.leadId === pendente && leAoAbrir(l.responsavelId)
              ? { ...l, naoLida: false }
              : l,
          ),
        }));
      }
      if (daLista) {
        void recarregarLista(filtrosRef.current, { silenciosa: true });
      }
      if (daConversa) void recarregarConversaAberta();
    },
    [recarregarLista, recarregarConversaAberta, marcarLida, leAoAbrir],
  );

  const aoRespiroDaFila = useCallback(
    () => void recarregarLista(filtrosRef.current, { silenciosa: true }),
    [recarregarLista],
  );

  useTempoRealConversas(aberta?.leadId ?? null, {
    aoMensagemNaFila,
    aoRespiroDaFila,
    aoMensagemDaAberta,
    aoAtualizacaoDaAberta,
    aoRessincronizar,
  });

  /* ── seleção em massa ────────────────────────────────────────────────── */

  const alternarSelecao = useCallback((leadId: string) => {
    setSelecionadas((atual) => {
      const novo = new Set(atual);
      if (novo.has(leadId)) novo.delete(leadId);
      else novo.add(leadId);
      return novo;
    });
  }, []);

  /** Toque longo, Shift/⌘ + clique, o botão "Selecionar" ou a paleta: entra
   *  no modo, já com a linha (quando veio de uma). Já no modo, a linha só
   *  alterna. `focarTodas` (o botão e a paleta) leva o foco à caixa de
   *  "Selecionar todas": o topo da fila sai e a barra de ações entra no
   *  lugar, e o botão que tinha o foco some junto. */
  const modoSelecaoRef = useRef(false);
  useEffect(() => {
    modoSelecaoRef.current = modoSelecao;
  }, [modoSelecao]);
  const iniciarSelecao = useCallback(
    (leadId?: string, { focarTodas = false }: { focarTodas?: boolean } = {}) => {
      if (!podeAgirEmMassa) return;
      if (modoSelecaoRef.current) {
        if (leadId) alternarSelecao(leadId);
        return;
      }
      modoSelecaoRef.current = true;
      setMassaErro(null);
      setMassaConfirmar(null);
      setSelecionadas(new Set(leadId ? [leadId] : []));
      pedidoForaRef.current++;
      setComFora(null);
      setLendoFora(false);
      setErroFora(null);
      setModoSelecao(true);
      // O funil e as pílulas saem com o topo: a lista ou o menu que
      // estivesse aberto fecha (e a carga da equipe para de reler).
      setFiltroAberto(null);
      // Pela linha (toque longo, Shift + clique), o foco fica onde a pessoa
      // está: a linha continua na tela.
      if (focarTodas) {
        // Com a fila vazia a caixa nasce desativada e não pega o foco: ele
        // vai ao "Cancelar", o primeiro botão ativo da barra.
        focoDepoisRef.current = () => {
          const todas = selecionarTodasRef.current;
          return todas && !todas.disabled
            ? todas
            : barraSelecaoRef.current?.querySelector<HTMLElement>(
                "button:not([disabled])",
              );
        };
      }
    },
    [alternarSelecao, podeAgirEmMassa],
  );
  const aoIniciarSelecaoLinha = useCallback(
    (leadId: string) => iniciarSelecao(leadId),
    [iniciarSelecao],
  );

  const sairDaSelecao = useCallback(() => {
    // A barra (com o "Selecionar todas") some com o modo e o topo da fila
    // volta. Se o foco estava nela (ou já tinha caído no body), ele vai
    // para o "Selecionar", que liga a seleção de novo.
    const ativo = document.activeElement;
    if (
      !ativo ||
      ativo === document.body ||
      ativo === selecionarTodasRef.current ||
      barraSelecaoRef.current?.contains(ativo)
    ) {
      focoDepoisRef.current = () =>
        botaoSelecionarRef.current ?? tituloVisaoRef.current;
    }
    modoSelecaoRef.current = false;
    setModoSelecao(false);
    setSelecionadas(new Set());
    pedidoForaRef.current++;
    setComFora(null);
    setLendoFora(false);
    setErroFora(null);
    setMassaErro(null);
    setMassaEspera(false);
    setMassaConfirmar(null);
  }, []);

  /** A ação em massa confirmada, sobre as selecionadas que estão na tela.
   *  Mais de LOTE_MASSA saem em lotes, um depois do outro. */
  const executarMassa = async (ids: string[], acao: AcaoMassa) => {
    // Resolver ou adiar uma conversa com envio no ar a tiraria da Caixa antes
    // do desfecho, como o E e o H: o lote espera.
    if (acao.tipo === "resolver" || acao.tipo === "adiar") {
      if (ids.some((id) => envioEmVooRef.current.has(id))) {
        setMassaErro(null);
        setMassaEspera(true);
        return;
      }
    }
    setMassaEspera(false);
    setMassaPendente(true);
    setMassaErro(null);
    const emCena = abertaRef.current?.leadId ?? null;
    // "Não lida" vence a marca de lida agendada da conversa em cena.
    if (acao.tipo === "lidas" && !acao.lidas && emCena && ids.includes(emCena)) {
      cancelarMarcaLida(emCena);
    }
    const r = await emLotes(ids, (lote) => {
      switch (acao.tipo) {
        case "transferir":
          return atribuirEmMassa(lote, acao.id);
        case "etiquetas":
          return etiquetasEmMassa(
            lote,
            acao.por.map((t) => t.id),
            acao.tirar.map((t) => t.id),
          );
        case "adiar":
          return adiarConversasEmMassa(lote, acao.prazo, acao.ate);
        case "resolver":
          return resolverConversasEmMassa(lote);
        case "lidas":
          return marcarLidasEmMassa(lote, acao.lidas);
      }
    });
    setMassaPendente(false);
    // Transferidas para alguém cujas conversas esta pessoa não vê
    // (Administração > Privacidade): saem da fila na recarga, e o aviso diz
    // por quê.
    const somemDaFila =
      acao.tipo === "transferir" &&
      acao.id !== null &&
      donoOculto(acao.id, donosOcultosRef.current)
        ? `. ${ids.length === 1 ? "A conversa sai" : "As conversas saem"} da sua fila: você não vê as conversas de ${acao.nome}.`
        : "";
    if (r.feitas > 0) {
      if (acao.tipo === "adiar") {
        for (const id of ids) adiadasAquiRef.current.add(id);
      }
      recontarNaoLidas();
      // Transferi para mim com a conversa aberta no lote: agora sou o dono
      // que lê, e a leitura grava, como no ⋯ (refletirDono). Quem decide é
      // o servidor (marcarChatLido confere o dono no próprio update): com o
      // lote pela metade, a que não passou para mim só grava se já gravaria
      // ao abrir (sem dono). Antes da recarga da fila, para ela já vir lida.
      if (
        acao.tipo === "transferir" &&
        acao.id !== null &&
        acao.id === meuId &&
        emCena &&
        ids.includes(emCena) &&
        abertaRef.current?.leadId === emCena &&
        conversaCarregadaRef.current === emCena &&
        document.visibilityState === "visible"
      ) {
        marcarLida(emCena);
      }
      void recarregarLista(filtrosRef.current, { silenciosa: Boolean(r.erro) });
      if (gestao && acao.tipo === "transferir") void pedirCarga(true);
      // A conversa aberta estava entre as escolhidas: dono, etiquetas ou
      // estado mudaram, e o cabeçalho, o ⋯ e o painel leem dela. Se foi para
      // um dono oculto (o lote inteiro deu certo), ela sai da tela, como no
      // ⋯; com envio no ar, fica até ele terminar.
      if (emCena && ids.includes(emCena)) {
        if (somemDaFila && !r.erro && !envioEmVooRef.current.has(emCena)) {
          sairDaConversa();
        } else {
          void recarregarConversaAberta();
        }
      }
    }
    if (r.erro) {
      setMassaErro(r.erro);
      return;
    }
    sairDaSelecao();
    mostrarAviso({
      texto: `${avisoDaMassa(acao, ids.length)}${somemDaFila}`,
      tom: "normal",
    });
  };

  /** Da confirmação de volta às ações (Esc ou "Voltar"). O botão que
   *  tinha o foco sai junto com a confirmação: o foco vai para a primeira
   *  ação da barra, nunca para o body. */
  const voltarDaConfirmacao = useCallback(() => {
    setMassaConfirmar(null);
    focoDepoisRef.current = () =>
      barraSelecaoRef.current?.querySelector<HTMLElement>(
        "[data-acoes-massa] button:not([disabled])",
      ) ??
      barraSelecaoRef.current?.querySelector<HTMLElement>(
        "button:not([disabled])",
      );
  }, []);

  /** Todas as linhas carregadas e à vista, ou nenhuma (já com todas, e
   *  então as de fora da tela saem junto). */
  const alternarTodas = () => {
    const todasNaTela =
      linhasVisiveis.length > 0 &&
      linhasVisiveis.every((l) => selecionadas.has(l.leadId));
    if (todasNaTela) {
      pedidoForaRef.current++;
      setComFora(null);
      setLendoFora(false);
      setErroFora(null);
      setSelecionadas(new Set());
      return;
    }
    setSelecionadas((atual) => {
      const novo = new Set(comFora ? atual : []);
      for (const l of linhasVisiveis) novo.add(l.leadId);
      return novo;
    });
  };

  /**
   * "Marcar as 212 de Tudo": busca só os ids do recorte (os mesmos filtros
   * da lista na tela, a busca inclusa) e os junta à seleção. A ação em
   * massa passa a valer para todas as marcadas, em lotes de LOTE_MASSA.
   */
  const marcarRestantes = async () => {
    const pedido = ++pedidoForaRef.current;
    const f = lista.filtros;
    setLendoFora(true);
    setErroFora(null);
    let r: Awaited<ReturnType<typeof carregarIdsDaFila>>;
    try {
      r = await carregarIdsDaFila(f.visao, f);
    } catch {
      r = { erro: "A conexão não respondeu. Tente de novo." };
    }
    if (pedido !== pedidoForaRef.current) return;
    setLendoFora(false);
    if ("erro" in r) {
      // O botão fica (vira "Tentar de novo") e, sem se desativar, segura o
      // foco: nada a mover.
      setErroFora(r.erro);
      return;
    }
    // Com tudo marcado, o botão dá lugar ao aviso "As 212 de Tudo estão
    // marcadas": quem estava nele (o teclado) vai para "Selecionar todas",
    // ou para a primeira ação da barra, em vez de cair no body.
    const ativo = document.activeElement;
    if (
      !ativo ||
      ativo === document.body ||
      ativo.closest("[data-marcar-restantes]")
    ) {
      focoDepoisRef.current = () =>
        selecionarTodasRef.current ??
        barraSelecaoRef.current?.querySelector<HTMLElement>(
          "[data-acoes-massa] button:not([disabled])",
        );
    }
    const doRecorte = r;
    const uniao = new Set([
      ...doRecorte.ids,
      ...linhasVisiveis.map((l) => l.leadId),
    ]);
    setSelecionadas((atual) => {
      const novo = new Set(atual);
      for (const id of uniao) novo.add(id);
      return novo;
    });
    setComFora({
      cortada: doRecorte.cortada,
      teto: doRecorte.teto,
      total: uniao.size,
    });
  };

  /* ── envio ───────────────────────────────────────────────────────────── */

  // Link para outra tela (o menu do app, a ficha, o "←" de quem veio de
  // fora) com o envio no ar também desmontaria a Janela: segura como o J e
  // o E. Nova aba e download não tiram ninguém daqui.
  useEffect(() => {
    const aoClicar = (e: MouseEvent) => {
      if (
        e.defaultPrevented ||
        e.button !== 0 ||
        e.metaKey ||
        e.ctrlKey ||
        e.shiftKey ||
        e.altKey
      ) {
        return;
      }
      const link = (e.target as Element | null)?.closest?.("a[href]");
      if (
        !(link instanceof HTMLAnchorElement) ||
        (link.target && link.target !== "_self") ||
        link.hasAttribute("download")
      ) {
        return;
      }
      if (segurarPeloEnvio()) {
        e.preventDefault();
        return;
      }
      // "Chat" (o menu, a aba, a marca) já no chat: sem ir ao servidor,
      // fecha a conversa e a fila fica como está; sem conversa aberta, a
      // fila sobe ao topo. Ir ao /chat cru remontaria a tela inteira.
      let destino: URL;
      try {
        destino = new URL(link.href, window.location.href);
      } catch {
        return;
      }
      if (
        destino.origin !== window.location.origin ||
        destino.pathname !== "/chat" ||
        destino.search !== "" ||
        window.location.pathname !== "/chat"
      ) {
        return;
      }
      e.preventDefault();
      if (abertaRef.current) sairDaConversa();
      else rolagemFilaRef.current?.scrollTo({ top: 0 });
    };
    document.addEventListener("click", aoClicar, true);
    return () => document.removeEventListener("click", aoClicar, true);
  }, [segurarPeloEnvio, sairDaConversa]);

  // Ao mudar a conversa (aberta, nova mensagem), só a Janela e o cabeçalho
  // mudam: as callbacks de envio são estáveis para a Janela memoizada.
  const aoEnviarComSucesso = useCallback(
    ({ leadId, assumiu: assumiuAgora }: EnvioConcluido) => {
      // Respondeu: a linha sai da espera local na hora. Responder grava a
      // leitura para qualquer um (o envio carimba chat_lido_em): quem não
      // é dono abriu sem apagar o negrito, e ele sai aqui.
      const antes = todasLinhasRef.current.find((l) => l.leadId === leadId);
      if (antes?.naoLida) {
        if (contaNoBadge(antes)) ajustarNaoLidas(-1);
        recontarNaoLidas();
      }
      setLista((c) => ({
        ...c,
        linhas: c.linhas.map((l) =>
          l.leadId === leadId
            ? { ...l, esperaHoras: null, vez: "nos", naoLida: false }
            : l,
        ),
      }));
      // O servidor diz se o envio assumiu a conversa (ela estava sem dono).
      if (assumiuAgora && meuId) {
        refletirDono(leadId, {
          id: meuId,
          nome: nomeNaEquipe(meuId) ?? "Você",
        });
      }
    },
    [meuId, refletirDono, nomeNaEquipe],
  );

  /** ⌘Enter saiu resolvido no servidor: só reflete e segue, com o foco no
   *  compositor da próxima (quem segue digitando não resolve nada). */
  const aoEnviarEResolver = useCallback(
    (leadId: string) =>
      void despachar(leadId, "resolver", {
        jaNoServidor: true,
        focoAoSeguir: "compositor",
      }),
    [despachar],
  );
  /** "Resolver e seguir" do celular: no toque o compositor não recebe foco
   *  (abriria o teclado); vai para a linha ou o cabeçalho da próxima. */
  const aoResolverESeguir = useCallback(
    (leadId: string) =>
      void despachar(leadId, "resolver", { focoAoSeguir: "linha" }),
    [despachar],
  );

  /* ── recontato ───────────────────────────────────────────────────────── */

  /** O recontato pendente mais cedo da conversa em cena (o da faixa). */
  const recontatoDaCena = useCallback((): Recontato | null => {
    const emCena = abertaRef.current;
    const c = conversaRef.current;
    return emCena && c && c.leadId === emCena.leadId
      ? (c.recontatos?.[0] ?? null)
      : null;
  }, []);

  /** "Agendar recontato…" (o ⋯ e a paleta), para a conversa em cena. */
  const abrirAgendarRecontato = useCallback(() => {
    const emCena = abertaRef.current;
    if (!emCena || leitura) return;
    setDialogoRecontato({
      aberto: true,
      leadId: emCena.leadId,
      nome: emCena.nome,
      reagendar: null,
    });
  }, [leitura]);

  /** "Reagendar" da faixa: o mesmo diálogo, com o motivo e o template. */
  const abrirReagendarRecontato = useCallback(() => {
    const emCena = abertaRef.current;
    const r = recontatoDaCena();
    if (!emCena || !r || leitura) return;
    setDialogoRecontato({
      aberto: true,
      leadId: emCena.leadId,
      nome: emCena.nome,
      reagendar: r,
    });
  }, [leitura, recontatoDaCena]);

  /** "Enviar <template>" da faixa: o envio de template já preenchido. */
  const abrirTemplateDoRecontato = useCallback(() => {
    const r = recontatoDaCena();
    if (!r?.template || leitura) return;
    setTemplateDoRecontato({ aberto: true, recontato: r });
  }, [leitura, recontatoDaCena]);

  /** O recontato saiu (Feito, Cancelar, o template). Na visão Recontatos a
   *  linha sai junto, e na Caixa também quando era ele que a mantinha lá
   *  (resolvida ou adiada no prazo); a recarga a traz de volta se houver
   *  outro. */
  const tirarRecontatoDaLinha = useCallback((leadId: string, id: string) => {
    const visao = filtrosRef.current.visao;
    setLista((c) => {
      const antes = c.linhas.find(
        (l) => l.leadId === leadId && l.recontato?.id === id,
      );
      if (!antes) return c;
      const depois: LinhaConversa = { ...antes, recontato: null };
      const saiDaCaixa = naCaixa(antes) && !naCaixa(depois);
      const sai =
        visao === "recontatos" || (visao === "caixa" && saiDaCaixa);
      return {
        ...c,
        linhas: sai
          ? c.linhas.filter((l) => l !== antes)
          : c.linhas.map((l) => (l === antes ? depois : l)),
        contagens:
          c.contagens && saiDaCaixa
            ? {
                ...c.contagens,
                caixa: Math.max(0, c.contagens.caixa - 1),
                semDono:
                  c.contagens.semDono === undefined || antes.responsavelId
                    ? c.contagens.semDono
                    : Math.max(0, c.contagens.semDono - 1),
              }
            : c.contagens,
      };
    });
  }, []);

  /**
   * Agendado ou reagendado. Como o adiar: a conversa sai da Caixa (até o
   * quando) e a tela segue para a próxima. A nota entra na conversa e a
   * linha leva o recontato, onde ela ficar (Tudo, Recontatos, a Caixa com
   * outro recontato do dia). Contato perdido: a conversa fica onde está.
   */
  const aoRecontatoAgendado = useCallback(
    (r: ResultadoRecontato) => {
      setDialogoRecontato((d) => ({ ...d, aberto: false }));
      const rec = r.recontato;
      if (!rec) return;
      const leadId = rec.leadId;
      if (r.nota) anexarNotaDeRecontato(leadId, r.nota);
      const linhaAntes = todasLinhasRef.current.find(
        (l) => l.leadId === leadId,
      );
      setLista((c) => ({
        ...c,
        linhas: c.linhas.map((l) =>
          l.leadId === leadId
            ? { ...l, recontato: recontatoDaLinhaCom(l.recontato, rec) }
            : l,
        ),
      }));
      const texto = `Recontato ${rec.reagendado ? "reagendado" : "agendado"} para ${quandoEmTexto(rec.quando)}`;
      if (r.perdido) {
        // Contato perdido: a conversa fica onde está (em Resolvidas) e o
        // recontato a traz para a Caixa no dia.
        mostrarAviso({
          texto: `${texto} · contato perdido, aparece na Caixa no dia`,
          tom: "normal",
        });
      } else {
        // Resolvida volta a ficar em aberto (agendarRecontato tira a marca).
        setConversa((c) =>
          c && c.leadId === leadId && c.ferramentas.conversaResolvida
            ? {
                ...c,
                ferramentas: { ...c.ferramentas, conversaResolvida: false },
              }
            : c,
        );
        if (r.aviso) {
          // O recontato gravou, mas a conversa ficou onde estava.
          mostrarAviso({ texto: r.aviso, tom: "erro" });
        } else {
          void despachar(leadId, "adiar", {
            jaNoServidor: true,
            prazo: "data",
            ate: rec.quando,
            aviso: texto,
            semDesfazer: true,
            // A lista ainda não acompanhou: o recontato do dia que a linha
            // já tinha a mantém na Caixa.
            recontato: recontatoDaLinhaCom(linhaAntes?.recontato ?? null, rec),
          });
        }
      }
      // O contador de Recontatos e a próxima volta acertam na recarga.
      void recarregarLista(filtrosRef.current, { silenciosa: true });
    },
    [anexarNotaDeRecontato, despachar, mostrarAviso, recarregarLista],
  );

  /** Feito e Cancelar da faixa: a conversa fica onde está; o aviso tem o
   *  Desfazer, que traz o recontato de volta, e diz até quando ela segue
   *  adiada, se seguir (cancelar antes do dia não a traz de volta). */
  const recontatoGravandoRef = useRef(false);
  const encerrarRecontatoDaCena = useCallback(
    async (como: "feito" | "cancelado") => {
      const emCena = abertaRef.current;
      const rec = recontatoDaCena();
      if (!emCena || !rec || leitura || recontatoGravandoRef.current) return;
      // O botão que tinha o foco sai com a faixa.
      const ativo = document.activeElement;
      const focoNaFaixa =
        !ativo ||
        ativo === document.body ||
        Boolean(ativo.closest("[data-faixa-recontato]"));
      recontatoGravandoRef.current = true;
      setRecontatoGravando(true);
      let r: ResultadoRecontato;
      try {
        r = await encerrarRecontato(emCena.leadId, rec.id, como);
      } catch {
        r = { erro: "A conexão não respondeu. Tente de novo." };
      } finally {
        recontatoGravandoRef.current = false;
        setRecontatoGravando(false);
      }
      if (r.erro) {
        mostrarAviso({ texto: r.erro, tom: "erro" });
        return;
      }
      if (focoNaFaixa) {
        // A faixa do recontato seguinte, se houver; senão, o nome da
        // conversa (nunca o body: a próxima letra viraria atalho).
        focoDepoisRef.current = () =>
          document.querySelector<HTMLElement>(
            "[data-faixa-recontato] button",
          ) ??
          nomeRef.current ??
          gatilhoPainelRef.current;
      }
      if (r.nota) anexarNotaDeRecontato(emCena.leadId, r.nota);
      tirarRecontatoDaLinha(emCena.leadId, rec.id);
      const segueAdiada = r.adiadaAte
        ? ` · a conversa segue adiada ${
            ateResponder(r.adiadaAte)
              ? "até a pessoa responder"
              : `até ${quandoEmTexto(r.adiadaAte)}`
          }`
        : "";
      mostrarAviso({
        texto: `${como === "feito" ? "Recontato feito" : "Recontato cancelado"} · ${emCena.nome}${segueAdiada}`,
        tom: "normal",
        desfazer: { leadId: emCena.leadId, acao: "recontato", recontato: rec },
      });
      void recarregarLista(filtrosRef.current, { silenciosa: true });
    },
    [
      leitura,
      recontatoDaCena,
      mostrarAviso,
      anexarNotaDeRecontato,
      tirarRecontatoDaLinha,
      recarregarLista,
    ],
  );

  /** O template da faixa saiu: o servidor marcou o recontato como feito. A
   *  conversa relê para a bolha do template chegar inteira (com o id da
   *  Meta, que a resposta e a reação usam). */
  const aoTemplateDoRecontatoEnviado = useCallback(
    (resultado: ResultadoEnvio) => {
      const leadId = resultado.leadId ?? abertaRef.current?.leadId;
      if (!leadId) return;
      // O botão que abriu o envio sai com a faixa: o foco vai para a faixa
      // seguinte ou para o nome da conversa, nunca para o body.
      focoDepoisRef.current = () =>
        document.querySelector<HTMLElement>("[data-faixa-recontato] button") ??
        nomeRef.current ??
        gatilhoPainelRef.current;
      aoEnviarComSucesso({ leadId, assumiu: resultado.assumiu === true });
      const feito = resultado.recontatoFeito;
      if (feito) {
        anexarNotaDeRecontato(leadId, feito);
        const fim = feito.metadados.recontato_fim as { id?: unknown } | undefined;
        if (typeof fim?.id === "string") tirarRecontatoDaLinha(leadId, fim.id);
      }
      void recarregarConversaAberta();
      void recarregarLista(filtrosRef.current, { silenciosa: true });
      mostrarAviso(
        feito
          ? { texto: "Template enviado · recontato feito", tom: "normal" }
          : resultado.aviso
            ? { texto: resultado.aviso, tom: "erro" }
            : { texto: "Template enviado", tom: "normal" },
      );
    },
    [
      aoEnviarComSucesso,
      anexarNotaDeRecontato,
      tirarRecontatoDaLinha,
      recarregarConversaAberta,
      recarregarLista,
      mostrarAviso,
    ],
  );
  const aoTemplateDoRecontatoEmVoo = useCallback(
    (leadId: string, emVoo: boolean) => aoEnvioEmVoo(leadId, emVoo, "template"),
    [aoEnvioEmVoo],
  );

  /** Esc no compositor: o foco volta para a linha da conversa na fila. */
  const focarFila = useCallback(() => {
    if (!telaMdRef.current) return;
    const leadId = abertaRef.current?.leadId;
    const alvo =
      (leadId
        ? listaRef.current?.querySelector<HTMLElement>(
            `[data-lead="${CSS.escape(leadId)}"] button`,
          )
        : null) ??
      tituloVisaoRef.current ??
      selecionarTodasRef.current;
    alvo?.focus();
  }, []);

  // As callbacks que descem para cada linha: estáveis (a linha é
  // memoizada) e recebem o leadId em vez de nascer uma por linha.
  const aoAbrirLinha = useCallback(
    (leadId: string, nome: string, origem: OrigemAbertura) =>
      void abrirConversa(leadId, nome, {
        origem,
        historia: telaMdRef.current ? "replace" : "push",
      }),
    [abrirConversa],
  );
  const aoResolverLinha = useCallback(
    (leadId: string) => void despachar(leadId, "resolver", { daFila: true }),
    [despachar],
  );
  const aoAdiarLinha = useCallback(
    (leadId: string) => void despachar(leadId, "adiar", { daFila: true }),
    [despachar],
  );
  const aoReativarLinha = useCallback(
    (leadId: string) => void despachar(leadId, "reativar", { daFila: true }),
    [despachar],
  );
  const aoAssumirLinha = useCallback(
    (leadId: string) => void assumir(leadId, { daFila: true }),
    [assumir],
  );
  const aoReabrirLinha = useCallback(
    (leadId: string) => void reabrir(leadId, { daFila: true }),
    [reabrir],
  );

  /* ── resumo ──────────────────────────────────────────────────────────── */

  /** Resumo da conversa pela IA: só quando alguém pede (⋯ ou paleta). */
  const pedirResumo = useCallback(async () => {
    const emCena = abertaRef.current;
    if (!emCena) return;
    const pedido = ++pedidoResumoRef.current;
    setResumindo(true);
    setResumo(null);
    let r: { resumo?: string; erro?: string };
    try {
      r = await resumirConversa(emCena.leadId);
    } catch {
      r = { erro: "A conexão não respondeu. Tente de novo." };
    }
    // Trocou de conversa no meio: o resumo do lead A não aparece no B.
    if (
      pedido !== pedidoResumoRef.current ||
      abertaRef.current?.leadId !== emCena.leadId
    ) {
      return;
    }
    setResumindo(false);
    setResumo(r.resumo ? { texto: r.resumo } : { erro: r.erro });
  }, []);

  /** O X do resumo; durante o "Resumindo…" ele também desiste do pedido. */
  const fecharResumo = () => {
    pedidoResumoRef.current++;
    setResumindo(false);
    setResumo(null);
    focoDepoisRef.current = () => nomeRef.current ?? gatilhoPainelRef.current;
  };

  /* ── teclado ─────────────────────────────────────────────────────────── */

  // O compositor da próxima chegou (focou) ou a pessoa pegou o ponteiro: o
  // avanço do ⌘Enter deixa de segurar as teclas.
  useEffect(() => {
    const soltar = () => {
      compositorPendenteRef.current = null;
    };
    const aoFocar = (e: FocusEvent) => {
      if ((e.target as HTMLElement | null)?.tagName === "TEXTAREA") soltar();
    };
    document.addEventListener("focusin", aoFocar);
    document.addEventListener("pointerdown", soltar, true);
    return () => {
      document.removeEventListener("focusin", aoFocar);
      document.removeEventListener("pointerdown", soltar, true);
    };
  }, []);

  // J/K andam, E resolve, H adia, A assume, G→C e G→A trocam de visão. E, H
  // e A ESCREVEM no servidor: a ordem das guardas é o que impede a
  // digitação de resolver uma conversa sem querer. O ⌘K é da paleta global.
  // Na conversa resolvida, E e H não fazem nada (resolver de novo gravaria
  // outra nota; reabrir é pelo ⋯ ou pelo arrasto). Quem só lê fica com J,
  // K e G.
  useEffect(() => {
    const aoTeclar = (e: KeyboardEvent) => {
      const temModal = Boolean(document.querySelector('[aria-modal="true"]'));
      if (e.key === "Escape") {
        // Um painel interno que já tratou o Esc chega aqui consumido.
        if (e.defaultPrevented || temModal) return;
        if (modoSelecao && !massaPendente) {
          if (massaConfirmar) voltarDaConfirmacao();
          else sairDaSelecao();
        }
        return;
      }
      if (temModal) return;
      // Durante um lote da seleção, o palco espera: E e H gravariam por
      // cima do que o lote está mudando, e J/K trocariam a conversa que ele
      // pode estar tirando da fila.
      if (massaPendente) return;
      const alvo = e.target as HTMLElement | null;
      if (
        alvo &&
        (alvo.tagName === "INPUT" ||
          alvo.tagName === "TEXTAREA" ||
          alvo.tagName === "SELECT" ||
          alvo.isContentEditable)
      ) {
        return;
      }
      // Foco DENTRO de um menu aberto, ou no botão que o abriu: a tecla é
      // do menu, não do palco.
      const ativo = document.activeElement as HTMLElement | null;
      if (
        ativo &&
        (ativo.closest(
          '[data-popover], [role="menu"], [role="listbox"], [role="dialog"]',
        ) ||
          ativo.getAttribute("aria-expanded") === "true")
      ) {
        return;
      }
      // Com modificador é atalho do navegador e repeat é tecla presa.
      if (e.metaKey || e.ctrlKey || e.altKey || e.repeat) return;
      // O ⌘Enter abriu a próxima e o foco vai para o compositor dela:
      // enquanto ele não chega, a letra é de quem segue digitando, não
      // atalho. Carregada e ainda sem foco, o compositor o recebe aqui.
      const pendente = compositorPendenteRef.current;
      if (pendente && pendente === abertaRef.current?.leadId) {
        if (conversaCarregadaRef.current === pendente) {
          document.getElementById(`texto-${pendente}`)?.focus();
        }
        return;
      }
      const tecla = e.key.toLowerCase();
      // Acorde G→C / G→A. Qualquer outra tecla só CANCELA o acorde: o G→H
      // de dedo torto não pode adiar a conversa.
      if (acordeGRef.current && Date.now() - acordeGRef.current < 600) {
        acordeGRef.current = 0;
        if (tecla === "c") trocarVisao("caixa");
        else if (tecla === "a") trocarVisao("aguardando");
        return;
      }
      if (tecla === "g") {
        acordeGRef.current = Date.now();
        return;
      }
      const emCena = abertaRef.current;
      if (tecla === "k") anterior();
      if (tecla === "j") proxima();
      if (!emCena || leitura) return;
      const linha = todasLinhasRef.current.find(
        (l) => l.leadId === emCena.leadId,
      );
      const resolvida =
        conversaRef.current?.leadId === emCena.leadId
          ? conversaRef.current.ferramentas.conversaResolvida
          : (linha?.resolvida ?? false);
      if (tecla === "e" && !resolvida) {
        void despachar(emCena.leadId, "resolver");
      }
      if (tecla === "h" && !resolvida) void despachar(emCena.leadId, "adiar");
      if (tecla === "a" && podeAssumirPapel) {
        const semDono = conversaRef.current?.leadId === emCena.leadId
          ? !conversaRef.current.ferramentas.responsavelId
          : linha
            ? !linha.responsavelId
            : false;
        if (semDono) void assumir(emCena.leadId);
      }
    };
    window.addEventListener("keydown", aoTeclar);
    return () => window.removeEventListener("keydown", aoTeclar);
  }, [
    proxima,
    anterior,
    modoSelecao,
    massaPendente,
    massaConfirmar,
    sairDaSelecao,
    voltarDaConfirmacao,
    despachar,
    assumir,
    trocarVisao,
    podeAssumirPapel,
    leitura,
  ]);

  /* ── derivados da tela ───────────────────────────────────────────────── */

  const contagemDe = (v: VisaoConversas): number | null =>
    v === "tudo" || !lista.contagens ? null : (lista.contagens[v] ?? null);
  // O tamanho da lista da visão. Recontatos conta só os de hoje e os
  // atrasados (o número do título e do menu), mas a lista traz também os
  // próximos: para "Ver N conversas" e "Marcar as N", vale a lista.
  const contagemDaLista = (v: VisaoConversas): number | null =>
    v === "recontatos" ? null : contagemDe(v);

  const linhaDaAberta = aberta
    ? (lista.linhas.find((l) => l.leadId === aberta.leadId) ?? null)
    : null;

  // A visão Recontatos em grupos (Atrasados, Hoje, Próximos), na ordem que
  // o servidor mandou (do mais cedo para o mais tarde): J e K andam igual.
  const modoRecontatos = lista.filtros.visao === "recontatos";
  const gruposDeRecontato = useMemo(() => {
    if (!modoRecontatos) return [];
    const hoje = diaDaChave(hojeChave);
    return GRUPOS_RECONTATO.map((g) => ({
      ...g,
      linhas: linhasVisiveis.filter(
        (l) =>
          (l.recontato
            ? grupoDoRecontato(l.recontato.dia, hoje)
            : "proximos") === g.chave,
      ),
    })).filter((g) => g.linhas.length > 0);
  }, [modoRecontatos, linhasVisiveis, hojeChave]);
  const conversaEmCena =
    conversa && aberta && conversa.leadId === aberta.leadId ? conversa : null;
  // A fonte de verdade é a conversa carregada; enquanto ela abre, vale o
  // que a fila já sabe.
  const donoDaAberta = conversaEmCena
    ? conversaEmCena.ferramentas.responsavelNome
    : (linhaDaAberta?.responsavelNome ?? null);
  const donoIdDaAberta = conversaEmCena
    ? conversaEmCena.ferramentas.responsavelId
    : (linhaDaAberta?.responsavelId ?? null);
  const semDonoAberta = conversaEmCena
    ? !conversaEmCena.ferramentas.responsavelId
    : linhaDaAberta
      ? !linhaDaAberta.responsavelId
      : false;
  const resolvidaAberta = conversaEmCena
    ? conversaEmCena.ferramentas.conversaResolvida
    : (linhaDaAberta?.resolvida ?? false);
  const adiadaAberta = Boolean(
    linhaDaAberta?.adiadaAte && !linhaDaAberta.adiadaVencida,
  );
  // O recontato da faixa: o pendente mais cedo da conversa em cena. O
  // template dele só sai com telefone e com a lista da Meta carregada.
  const recontatoEmCena = conversaEmCena?.recontatos?.[0] ?? null;
  const podeEnviarTemplateRecontato = Boolean(
    recontatoEmCena?.template &&
      conversaEmCena?.aceitaTemplate &&
      (catalogos.templates?.length ?? 0) > 0,
  );
  const podeAssumirAberta =
    Boolean(aberta) && podeAssumirPapel && semDonoAberta && !resolvidaAberta;
  const pendenteAberta = aberta ? acaoPendente.has(aberta.leadId) : false;
  const voltarDaAberta =
    aberta && voltar && aberta.leadId === leadDoVoltar ? voltar : null;
  // A ficha, a edição e o "Ver ficha" voltam para esta conversa com a fila
  // como está.
  const hrefDaAberta = aberta ? hrefConversa(aberta.leadId, filtros) : "/chat";

  // Etiquetas da conversa aberta com nome e cor, para o painel do contato
  // acompanhar o ⋯ sem ir ao servidor.
  const etiquetasDaAberta = useMemo(() => {
    const ids = conversaEmCena?.ferramentas.etiquetasLead;
    if (!ids || !catalogos.etiquetas) return undefined;
    const marcadas = new Set(ids);
    return catalogos.etiquetas
      .filter((t) => marcadas.has(t.id))
      .map((t) => ({ id: t.id, nome: t.nome, cor: t.cor }));
  }, [conversaEmCena?.ferramentas.etiquetasLead, catalogos.etiquetas]);

  const nFiltros = contarFiltrosFila(filtros);
  const termoNaTela = busca.trim();

  // Em quantas das selecionadas cada etiqueta já está: o ponto de partida
  // das caixas do "Etiquetas…" em massa (todas, algumas ou nenhuma).
  const etiquetasDasMarcadas = useMemo(() => {
    const marcadas = new Set(idsSelecionados);
    const mapa = new Map<string, number>();
    for (const l of linhasVisiveis) {
      if (!marcadas.has(l.leadId)) continue;
      for (const e of l.etiquetas) mapa.set(e.id, (mapa.get(e.id) ?? 0) + 1);
    }
    return mapa;
  }, [linhasVisiveis, idsSelecionados]);

  // Quem a busca única achou e não está nesta visão.
  const pessoasFora = useMemo(() => {
    if (
      !pessoas ||
      !("resultados" in pessoas) ||
      pessoas.termo !== termoPessoas ||
      termoPessoas !== termoNaTela ||
      termoPessoas.length < 2
    ) {
      return [];
    }
    const naLista = new Set(lista.linhas.map((l) => l.leadId));
    return pessoas.resultados.filter((p) => !naLista.has(p.leadId));
  }, [pessoas, termoPessoas, termoNaTela, lista.linhas]);

  const totalDaVisao = contagemDe(filtros.visao);
  // Sem contagem (Tudo não conta; numa visão, a contagem falhou) o número é
  // o da página: com mais para carregar (ou a Caixa cortada) sai "60+", não
  // a página como se fosse o total. Com zero, nada: a fila vazia logo
  // abaixo já diz "Caixa zerada.", e um 0 solto ao lado do título lia como
  // selo.
  const contagemTitulo =
    totalDaVisao === null
      ? lista.linhas.length === 0
        ? null
        : `${lista.linhas.length.toLocaleString("pt-BR")}${lista.temMais || lista.cortada ? "+" : ""}`
      : totalDaVisao === 0
        ? null
        : lista.cortada
          ? `${lista.linhas.length.toLocaleString("pt-BR")} de ${totalDaVisao.toLocaleString("pt-BR")}`
          : totalDaVisao.toLocaleString("pt-BR");

  /** Abre a lista do funil ou o menu de um filtro (null fecha). O de
   *  Atendentes pede a carga da equipe; reabrir depois de uma falha não
   *  mostra o erro velho: ele sai antes do pedido e a coluna mostra o
   *  Spinner. Com o erro na tela, o menu abria com o foco no aviso, e a
   *  leitura certa o tirava de baixo do foco. */
  const abrirFiltro = (aberto: FiltroAberto | null) => {
    setFiltroAberto(aberto);
    if (aberto?.qual === "atendentes" && mostrarFiltroAtendente) {
      setErroCarga(null);
      void pedirCarga();
    }
  };

  /** "Filtros da fila" na paleta: abre a lista do funil, que leva o foco.
   *  Na seleção, o funil está fora da tela: sai dela antes, no mesmo
   *  render, sem o foco que a saída mandaria ao "Selecionar" (ele tiraria
   *  o foco do menu, e o menu fecharia). */
  const abrirListaFiltros = () => {
    if (modoSelecao) {
      sairDaSelecao();
      focoDepoisRef.current = null;
    }
    abrirFiltro({ qual: "lista" });
  };

  /* ── paleta ──────────────────────────────────────────────────────────── */

  // Os comandos rodam quando alguém os escolhe na paleta, nunca durante o
  // render: leem a conversa em cena pelo estado.
  const acoesPaleta: ContextoComandos["acoes"] = {
    resolver: () => {
      if (aberta) void despachar(aberta.leadId, "resolver");
    },
    adiar: (prazo) => {
      if (aberta) void despachar(aberta.leadId, "adiar", { prazo });
    },
    adiarData: () => {
      if (!aberta) return;
      setAdiarData({
        aberto: true,
        alvo: { tipo: "conversa", leadId: aberta.leadId },
      });
    },
    agendarRecontato: abrirAgendarRecontato,
    enviarTemplateRecontato: abrirTemplateDoRecontato,
    recontatoFeito: () => void encerrarRecontatoDaCena("feito"),
    reagendarRecontato: abrirReagendarRecontato,
    cancelarRecontato: () => void encerrarRecontatoDaCena("cancelado"),
    assumir: () => {
      if (aberta) void assumir(aberta.leadId);
    },
    reativar: () => {
      if (aberta) void despachar(aberta.leadId, "reativar");
    },
    reabrir: () => {
      if (aberta) void reabrir(aberta.leadId);
    },
    transferir: () => pedirMenu("atendente"),
    etiquetar: () => pedirMenu("etiquetas"),
    resumir: () => void pedirResumo(),
    marcarNaoLida: () => {
      if (!aberta) return;
      const leadId = aberta.leadId;
      aoAntesDeMarcarNaoLida(leadId);
      void marcarChatNaoLido(leadId)
        .catch(() => ({ erro: "A conexão não respondeu. Tente de novo." }))
        .then((r) => {
          if (r.erro) {
            aoFalharMarcarNaoLida(leadId);
            mostrarAviso({ texto: r.erro, tom: "erro" });
          } else {
            aoMarcarNaoLidaAberta();
          }
        });
    },
    dadosContato: () => {
      if (telaXl) gravarPainel(false);
      else setPainelAberto(true);
    },
    verFicha: () => {
      if (!aberta || segurarPeloEnvio()) return;
      router.push(hrefContatoDoChat(aberta.leadId, hrefDaAberta));
    },
    inserirPronta: () => setPedidoProntas((n) => n + 1),
    irPara: trocarVisao,
    proxima,
    anterior,
    selecionar: () => iniciarSelecao(undefined, { focarTodas: true }),
    selecionarTodas: () => {
      setSelecionadas((atual) => {
        const novo = new Set(comFora ? atual : []);
        for (const l of linhasVisiveis) novo.add(l.leadId);
        return novo;
      });
    },
    sairDaSelecao,
    buscarNaFila: () => document.getElementById(ID_BUSCA)?.focus(),
    abrirFiltros: abrirListaFiltros,
    alternarNaoLidas: () => mudarFiltros({ naoLidas: !filtros.naoLidas }),
    limparFiltros,
  };

  /* ── pedaços da tela ─────────────────────────────────────────────────── */

  /** A carga da equipe ao lado de cada pessoa no menu de Atendentes (só a
   *  gestão a vê). Sem a equipe, a carga nunca é pedida (abrirFiltro e o
   *  intervalo exigem a equipe): "lendo" deixaria o Spinner girando sem
   *  fim ao lado do aviso de que a equipe não carregou. */
  const estadoCarga: EstadoCarga =
    !gestao || !mostrarFiltroAtendente
      ? { tipo: "fora" }
      : carga
        ? { tipo: "pronta", equipe: carga.equipe }
        : erroCarga
          ? { tipo: "erro", texto: erroCarga }
          : { tipo: "lendo" };

  // O pé da lista do funil e das escolhas múltiplas (Etiquetas, Atendentes,
  // que ficam abertas para combinar): quantas conversas a fila mostra com o
  // que está escolhido, e o toque fecha os filtros sobre elas.
  const totalResultado =
    contagemDaLista(filtros.visao) ?? lista.linhas.length;
  const resultadoAberto =
    contagemDaLista(filtros.visao) === null &&
    (lista.temMais || lista.cortada);
  const rotuloResultado = carregandoLista
    ? "Filtrando…"
    : totalResultado === 0
      ? "Fechar"
      : `Ver ${totalResultado.toLocaleString("pt-BR")}${resultadoAberto ? "+" : ""} ${totalResultado === 1 && !resultadoAberto ? "conversa" : "conversas"}`;

  // O funil (na linha do título) e as pílulas dos filtros ligados (embaixo
  // do escopo) leem e mudam o mesmo estado.
  const propsFiltros: PropsFiltros = {
    filtros,
    aberto: filtroAberto,
    aoAbrir: abrirFiltro,
    mostrarAtendentes: veOsAtendentes,
    equipe: equipeDoFiltro,
    nomesEquipe: catalogos.equipe,
    carga: estadoCarga,
    etiquetas: catalogos.etiquetas,
    campanhas,
    aoMudar: mudarFiltros,
    aoLimpar: limparFiltros,
    aoLerCarga: () => {
      setErroCarga(null);
      void pedirCarga(true);
    },
    funilRef,
    rotuloResultado,
  };

  /** Escolheu no menu da ação em massa: a barra vira a confirmação, e o
   *  foco vai para ela (o gatilho sumiu junto com o menu). */
  const pedirConfirmacao = (acao: AcaoMassa) => {
    setMassaConfirmar(acao);
    focoDepoisRef.current = () =>
      barraSelecaoRef.current?.querySelector<HTMLElement>(
        "button:not([disabled])",
      );
  };

  /** Os botões da fila vazia somem com a recarga que eles mesmos pedem:
   *  antes da troca, o foco vai para o título da visão (na seleção, para
   *  "Selecionar todas"), em vez de cair no body. */
  const focarTopoDaFila = useCallback(() => {
    (tituloVisaoRef.current ?? selecionarTodasRef.current)?.focus();
  }, []);

  /** A fila vazia diz por quê, sem consolar, e oferece o próximo passo. */
  const vazioDaFila = () => {
    let titulo = VAZIO_DA_VISAO[filtros.visao];
    let acao: React.ReactNode = null;
    if (termoNaTela) {
      titulo = `Nenhuma conversa com “${termoNaTela}” em ${NOME_DA_VISAO[filtros.visao]}.`;
      if (filtros.visao !== "tudo") {
        acao = (
          <Button
            variant="secondary"
            size="sm"
            className="mt-1.5"
            onClick={() => {
              focarTopoDaFila();
              trocarVisao("tudo");
            }}
          >
            Procurar em Tudo
          </Button>
        );
      }
    } else if (nFiltros > 0) {
      titulo = "Nenhuma conversa com esses filtros.";
      acao = (
        <Button
          variant="secondary"
          size="sm"
          className="mt-1.5"
          onClick={() => {
            focarTopoDaFila();
            limparFiltros();
          }}
        >
          Limpar filtros
        </Button>
      );
    } else if (filtros.visao === "caixa" && filtros.escopo !== "todas") {
      // "Caixa zerada." com 7 sem dono esperando parava o assessor: a frase
      // diz o escopo e o botão leva ao próximo trabalho.
      const semDono = lista.contagens?.semDono ?? 0;
      const minhas = filtros.escopo === "minhas";
      titulo = minhas
        ? "Nenhuma conversa sua na Caixa."
        : "Nenhuma conversa sem dono na Caixa.";
      acao =
        minhas && semDono > 0 ? (
          <Button
            variant="secondary"
            size="sm"
            className="mt-1.5"
            onClick={() => {
              focarTopoDaFila();
              trocarEscopo("semDono");
            }}
          >
            Ver {semDono === 1 ? "a" : "as"}{" "}
            <span className="tabular-nums">
              {semDono.toLocaleString("pt-BR")}
            </span>{" "}
            sem dono
          </Button>
        ) : (
          <Button
            variant="secondary"
            size="sm"
            className="mt-1.5"
            onClick={() => {
              focarTopoDaFila();
              trocarEscopo("todas");
            }}
          >
            Ver Todas
          </Button>
        );
    } else if (filtros.visao === "caixa") {
      const adiadas = lista.contagens?.adiadas ?? 0;
      if (adiadas > 0) {
        acao = (
          <Button
            variant="secondary"
            size="sm"
            className="mt-1.5"
            onClick={() => {
              focarTopoDaFila();
              trocarVisao("adiadas");
            }}
          >
            Adiadas · <span className="tabular-nums">{adiadas.toLocaleString("pt-BR")}</span>
          </Button>
        );
      }
    }
    return (
      <div className="px-2 pt-3 pb-2">
        <p className="tipo-titulo-3 text-tinta">{titulo}</p>
        {acao}
      </div>
    );
  };

  // De onde são as marcadas na seleção: "Tudo · Sem dono · VIP".
  const recorteDaSelecao = [
    NOME_DA_VISAO[lista.filtros.visao],
    !soAsMinhas && lista.filtros.escopo === "minhas"
      ? "Minhas"
      : !soAsMinhas && lista.filtros.escopo === "semDono"
        ? "Sem dono"
        : null,
    lista.filtros.busca.trim() ? `“${lista.filtros.busca.trim()}”` : null,
    ...resumoDosFiltros({
      filtros: lista.filtros,
      etiquetas: catalogos.etiquetas,
      nomesEquipe: catalogos.equipe,
      campanhas,
    }),
  ]
    .filter(Boolean)
    .join(" · ");

  // Todas as carregadas marcadas e mais conversas no recorte: a barra
  // oferece marcar as que a tela não carregou ("Marcar as 212 de Tudo").
  // Só com a fila em dia (a busca digitada já foi ao servidor).
  const marcadasNaTela = linhasVisiveis.filter((l) =>
    selecionadas.has(l.leadId),
  ).length;
  const foraDaTela = comFora
    ? idsSelecionados.length - marcadasNaTela
    : 0;
  const totalDoRecorte = contagemDaLista(lista.filtros.visao);
  const haMaisNoRecorte =
    lista.temMais ||
    lista.cortada ||
    (totalDoRecorte !== null && totalDoRecorte > lista.linhas.length);
  const filaEmDia =
    !carregandoLista &&
    busca.trim() === lista.filtros.busca.trim() &&
    mesmosFiltrosFila(filtros, lista.filtros);
  const ofereceMarcarRestantes =
    modoSelecao &&
    !massaConfirmar &&
    linhasVisiveis.length > 0 &&
    marcadasNaTela === linhasVisiveis.length &&
    haMaisNoRecorte &&
    filaEmDia;
  const visaoDaSelecao = daVisao(lista.filtros.visao);
  const linhaTodas =
    comFora && modoSelecao && !massaConfirmar ? (
      <p
        role="status"
        className="tipo-nota mt-0.5 rounded-controle bg-cartao px-1 py-0.5 text-texto-2"
      >
        {comFora.cortada
          ? `Marcadas as primeiras ${comFora.teto.toLocaleString("pt-BR")} ${visaoDaSelecao}.`
          : idsSelecionados.length >= comFora.total
            ? `As ${comFora.total.toLocaleString("pt-BR")} ${visaoDaSelecao} estão marcadas.`
            : `${idsSelecionados.length.toLocaleString("pt-BR")} marcadas, contando as que a lista não mostra.`}
      </p>
    ) : ofereceMarcarRestantes ? (
      <div className="mt-0.5 flex flex-wrap items-center gap-x-1 rounded-controle bg-cartao py-0.5 pr-0.5 pl-1">
        <p
          role={erroFora ? "alert" : undefined}
          className={cn(
            "tipo-nota min-w-0 flex-1",
            erroFora ? "text-erro" : "text-texto-2",
          )}
        >
          {erroFora ??
            (linhasVisiveis.length === 1
              ? "A conversa à vista está marcada."
              : `As ${linhasVisiveis.length.toLocaleString("pt-BR")} à vista estão marcadas.`)}
        </p>
        {/* Durante a leitura o botão não se desativa (o carregando do
            Button desativaria e largava o foco no body, com E e H valendo
            para a conversa em cena): fica aria-disabled, com o indicador, e
            o toque repetido é ignorado, como na confirmação da massa. */}
        <Button
          variant="ghost"
          size="sm"
          data-marcar-restantes=""
          className="shrink-0 px-1 font-semibold text-tinta pointer-coarse:h-[44px]"
          aria-disabled={lendoFora || undefined}
          aria-busy={lendoFora || undefined}
          icone={lendoFora ? <Spinner tamanho={16} /> : undefined}
          onClick={() => {
            if (!lendoFora) void marcarRestantes();
          }}
        >
          {lendoFora
            ? "Marcando…"
            : erroFora
              ? "Tentar de novo"
              : totalDoRecorte !== null
                ? `Marcar as ${totalDoRecorte.toLocaleString("pt-BR")} ${visaoDaSelecao}`
                : `Marcar todas ${visaoDaSelecao}`}
        </Button>
      </div>
    ) : null;

  // As linhas Atendente e Etiquetas do painel do contato abrem a mesma
  // escolha do ⋯ (que só existe com a conversa carregada). Quem só lê não
  // muda nada: as linhas ficam só de leitura.
  const trocarAtendentePeloPainel =
    conversaEmCena && !leitura && catalogos.equipe !== null
      ? () => pedirMenu("atendente")
      : undefined;
  const trocarEtiquetasPeloPainel =
    conversaEmCena &&
    !leitura &&
    conversaEmCena.ferramentas.etiquetasLead &&
    etiquetasAtivas.length > 0
      ? () => pedirMenu("etiquetas")
      : undefined;

  /** Uma linha da fila (a lista corrida e a dos grupos de Recontatos). */
  const desenharLinha = (l: LinhaConversa) => (
    <LinhaFila
      key={l.leadId}
      linha={l}
      aberta={l.leadId === aberta?.leadId}
      hojeChave={hojeChave}
      pendente={acaoPendente.has(l.leadId)}
      selecionando={modoSelecao}
      selecionada={selecionadas.has(l.leadId)}
      podeReativar={filtros.visao === "adiadas"}
      podeAssumir={podeAssumirPapel}
      somenteLeitura={leitura}
      modoRecontatos={modoRecontatos}
      coresEtiquetas={coresEtiquetas}
      aoAbrir={aoAbrirLinha}
      aoAlternarSelecao={alternarSelecao}
      aoIniciarSelecao={aoIniciarSelecaoLinha}
      aoResolver={aoResolverLinha}
      aoAdiar={aoAdiarLinha}
      aoReativar={aoReativarLinha}
      aoReabrir={aoReabrirLinha}
      aoAssumir={aoAssumirLinha}
    />
  );

  const filaVisivelNoCelular = !aberta;
  const atalhoSemDono =
    gestao &&
    filtros.escopo === "semDono" &&
    !modoSelecao &&
    linhasVisiveis.length > 1;

  // A tela vai dentro do provedor das fotos da equipe (ver o return no fim).
  const tela = (
    <div className="relative flex h-full min-h-0 bg-fundo">
      {/* Os comandos do chat na paleta global (⌘K). */}
      <ComandosDoChat
        conversa={Boolean(aberta)}
        podeAssumir={podeAssumirAberta}
        adiada={adiadaAberta}
        resolvida={resolvidaAberta}
        compositor={Boolean(conversaEmCena?.temConversa)}
        somenteLeitura={leitura}
        podeTransferir={Boolean(conversaEmCena) && catalogos.equipe !== null}
        podeEtiquetar={
          Boolean(conversaEmCena?.ferramentas.etiquetasLead) &&
          etiquetasAtivas.length > 0
        }
        visao={filtros.visao}
        podeSelecionar={podeAgirEmMassa}
        selecionando={modoSelecao}
        linhasNaFila={linhasVisiveis.length}
        naoLidas={filtros.naoLidas}
        filtrosAtivos={nFiltros}
        recontato={Boolean(recontatoEmCena)}
        recontatoComTemplate={podeEnviarTemplateRecontato}
        acoes={acoesPaleta}
      />
      {/* No celular a conversa ocupa a tela: a barra de abas sai. */}
      {aberta && !telaMd ? <EsconderAbas /> : null}

      {/* ── fila ── */}
      <section
        aria-label="Fila de conversas"
        className={cn(
          "min-w-0 flex-col border-fio md:flex md:w-[360px] md:shrink-0 md:border-r",
          filaVisivelNoCelular ? "flex w-full" : "hidden",
        )}
      >
        {/* O topo da fila, de cima para baixo: "Caixa ▾" com a contagem, o
            funil dos filtros e o "Selecionar" na mesma linha; a busca; o
            escopo; as pílulas dos filtros ligados (só com algum ligado).
            Na seleção em massa, tudo isso dá lugar à barra de ações, como
            no Gmail: as ações ficam onde os olhos já estão, e a barra do pé
            (que quebrava em duas linhas e cobria a fila) saiu. */}
        <header
          className={cn(
            "shrink-0 px-2 pt-[max(8px,env(safe-area-inset-top))] pb-1 md:pt-1.5",
            modoSelecao && "border-b border-fio",
          )}
        >
          {modoSelecao ? (
            <>
              {/* O título da visão sai com o topo: sem este, a tela ficava
                  sem h1 enquanto durasse a seleção, e quem anda pelos
                  títulos no leitor de tela perdia o ponto de partida. */}
              <h1 className="sr-only">
                Selecionar conversas em {NOME_DA_VISAO[filtros.visao]}
              </h1>
              <BarraSelecao
                barraRef={barraSelecaoRef}
                todasRef={selecionarTodasRef}
                menu={telaMd}
                total={linhasVisiveis.length}
                marcadas={idsSelecionados.length}
                foraDaTela={foraDaTela}
                recorte={recorteDaSelecao}
                linhaTodas={linhaTodas}
                confirmar={massaConfirmar}
                pendente={massaPendente}
                erro={massaErro}
                espera={massaEspera}
                equipe={equipeDestinos}
                cargaPorPessoa={gestao ? cargaPorPessoa : null}
                etiquetas={catalogos.etiquetas ? etiquetasAtivas : null}
                etiquetasDasMarcadas={etiquetasDasMarcadas}
                aoAlternarTodas={alternarTodas}
                aoPedir={pedirConfirmacao}
                aoVoltar={voltarDaConfirmacao}
                aoConfirmar={() => {
                  if (massaConfirmar) {
                    void executarMassa(idsSelecionados, massaConfirmar);
                  }
                }}
                aoCancelar={sairDaSelecao}
                aoAbrirTransferir={() => {
                  void pedirCarga();
                  pedirSoLeitura();
                }}
                aoEscolherData={() =>
                  setAdiarData({ aberto: true, alvo: { tipo: "massa" } })
                }
              />
            </>
          ) : (
            <>
              {/* A linha do título e a busca numa caixa só: abaixo de md o
                  funil sai da linha do título e se prende ao canto direito
                  da busca, que é o fim desta caixa (FunilFiltros). */}
              <div className="relative">
                {/* Sem vão entre os três: o respiro é o do desenho (a folga
                    da seta do título, o ícone no meio dos 40px do funil, os
                    8px de cada lado da palavra). Com 8px entre eles,
                    "Aguardando" cortava na fila de 360px. No toque isso
                    descumpre os 12px do kit entre vizinhos: exceção pendente
                    de decisão do Artur (SKILL, Topo de fila). No celular o
                    funil não fica aqui: "Aguardando" e "Resolvidas" cabem
                    inteiros em 375px ao lado do "Selecionar". */}
                <div className="flex min-h-[48px] min-w-0 items-center">
                  <TituloVisao
                    visao={filtros.visao}
                    contagens={lista.contagens}
                    contagem={contagemTitulo}
                    aoMudar={trocarVisao}
                    gatilhoRef={tituloVisaoRef}
                  />
                  <FunilFiltros {...propsFiltros} />
                  {podeAgirEmMassa ? (
                    <BotaoSelecionar
                      aoIniciar={() =>
                        iniciarSelecao(undefined, { focarTodas: true })
                      }
                      botaoRef={botaoSelecionarRef}
                    />
                  ) : null}
                </div>

                <label className="relative mt-1 block">
                  <span className="sr-only">Buscar na fila</span>
                  <Search
                    size={18}
                    strokeWidth={1.75}
                    aria-hidden
                    className="pointer-events-none absolute top-1/2 left-1.5 -translate-y-1/2 text-texto-3"
                  />
                  <input
                    ref={buscaRef}
                    id={ID_BUSCA}
                    type="search"
                    value={busca}
                    onChange={(e) => aoBuscar(e.target.value)}
                    onKeyDown={(e) => {
                      // ↓ ou Enter levam à primeira linha; Esc limpa.
                      if (e.key === "ArrowDown" || e.key === "Enter") {
                        const primeira =
                          listaRef.current?.querySelector<HTMLElement>(
                            "[data-lead] button",
                          ) ??
                          document.querySelector<HTMLElement>(
                            "[data-pessoas] button",
                          );
                        if (primeira) {
                          e.preventDefault();
                          primeira.focus();
                        }
                      }
                      if (e.key === "Escape" && busca) {
                        e.preventDefault();
                        e.stopPropagation();
                        limparBusca();
                      }
                    }}
                    placeholder="Nome, telefone, e-mail ou @"
                    autoComplete="off"
                    autoCorrect="off"
                    spellCheck={false}
                    enterKeyHint="search"
                    // Abaixo de md o funil mora no canto direito do campo: o
                    // texto para antes dele (e antes do X, com busca). No
                    // toque, o X fica a 12px do funil, e o texto para antes
                    // dos dois e do vão: 44 + 12 + 44.
                    className={cn(
                      CAMPO_BASE,
                      "tipo-corpo w-full border-transparent bg-cartao pr-5 pl-4 hover:border-transparent [&::-webkit-search-cancel-button]:hidden",
                      busca
                        ? "max-md:pr-11 max-md:pointer-coarse:pr-[100px]"
                        : "max-md:pr-6",
                    )}
                  />
                  {busca ? (
                    <button
                      type="button"
                      onClick={limparBusca}
                      aria-label="Limpar a busca"
                      title="Limpar a busca"
                      className={cn(
                        BOTAO_ICONE,
                        "absolute top-1/2 right-0 h-[40px] w-[40px] -translate-y-1/2",
                        // Abaixo de md, à esquerda do funil (40px). No toque,
                        // o funil tem 44 e os dois ficam a 12px um do outro
                        // (o vão mínimo do kit entre vizinhos no toque).
                        "max-md:right-[40px] max-md:pointer-coarse:right-[56px]",
                      )}
                    >
                      <X size={18} strokeWidth={1.75} aria-hidden />
                    </button>
                  ) : null}
                </label>
              </div>

              {!soAsMinhas ? (
                <Segmentado
                  rotulo="Escopo da fila"
                  valor={filtros.escopo}
                  onMudar={trocarEscopo}
                  opcoes={[
                    { valor: "todas", rotulo: "Todas" },
                    { valor: "minhas", rotulo: "Minhas" },
                    {
                      valor: "semDono",
                      rotulo: "Sem dono",
                      contagem: lista.contagens?.semDono,
                    },
                  ]}
                  // Na largura toda, cada segmento do tamanho do rótulo: em
                  // terços iguais, "Sem dono 128" cortava na fila de 360px.
                  className="mt-1 flex w-full [&>*]:flex-auto"
                />
              ) : null}

              <BarraFiltros {...propsFiltros} />

              {atalhoSemDono ? (
                <Chip
                  // Não alterna: entra na seleção já com todas marcadas.
                  aria-pressed={undefined}
                  className="mt-1"
                  onClick={() => {
                    // O chip sai do DOM com o topo: o foco vai para o
                    // "Selecionar todas", como pela paleta, e não cai no
                    // body (a próxima tecla viraria atalho do chat).
                    iniciarSelecao(undefined, { focarTodas: true });
                    setSelecionadas(
                      new Set(linhasVisiveis.map((l) => l.leadId)),
                    );
                  }}
                >
                  Selecionar as{" "}
                  <span className="tabular-nums">
                    {linhasVisiveis.length.toLocaleString("pt-BR")}
                  </span>{" "}
                  sem dono
                </Chip>
              ) : null}
            </>
          )}
        </header>

        <div
          ref={rolagemFilaRef}
          aria-busy={carregandoLista || undefined}
          className={cn(
            "min-h-0 flex-1 overflow-y-auto overscroll-contain pb-2 transition-opacity duration-[120ms]",
            carregandoLista && "opacity-60",
          )}
        >
          {linkSemAbrir ? (
            <div className="mx-2 mb-1 flex items-center gap-1 rounded-painel bg-cartao py-0.5 pr-0.5 pl-1.5">
              <p role="alert" className="tipo-nota min-w-0 flex-1 text-erro">
                A conversa do link não abriu.
              </p>
              <Button
                variant="secondary"
                size="sm"
                className="shrink-0"
                onClick={() => {
                  if (segurarPeloEnvio()) return;
                  setLinkSemAbrir(null);
                  // A URL já tem o ?lead= do link: nada a empurrar.
                  void abrirConversa(linkSemAbrir, "Conversa", {
                    historia: "replace",
                  });
                }}
              >
                Tentar de novo
              </Button>
              <button
                type="button"
                aria-label="Fechar o aviso"
                onClick={() => setLinkSemAbrir(null)}
                className={cn(BOTAO_ICONE, "h-[32px] w-[32px]")}
              >
                <X size={16} strokeWidth={1.75} aria-hidden />
              </button>
            </div>
          ) : null}

          {erroLista ? (
            <div className="mx-2 mb-1 rounded-painel bg-cartao px-1.5 py-1">
              <p role="alert" className="tipo-nota text-erro">
                {erroLista}
              </p>
              <Button
                variant="secondary"
                size="sm"
                className="mt-1"
                onClick={() => void recarregarLista(filtrosRef.current)}
              >
                Tentar de novo
              </Button>
            </div>
          ) : null}

          {lista.naoLidasNoTeto > 0 && lista.filtros.naoLidas ? (
            <p className="tipo-nota px-2 pt-1 pb-0.5 text-texto-2">
              Só não lidas: as{" "}
              <span className="tabular-nums">
                {lista.naoLidasNoTeto.toLocaleString("pt-BR")}
              </span>{" "}
              mais recentes.
            </p>
          ) : lista.naoLidasJanela > 0 && lista.filtros.naoLidas ? (
            // Sem esta linha a fila parecia completa: não lida mais antiga
            // que a janela não aparece.
            <p className="tipo-nota px-2 pt-1 pb-0.5 text-texto-2">
              Só não lidas entre as{" "}
              <span className="tabular-nums">
                {lista.naoLidasJanela.toLocaleString("pt-BR")}
              </span>{" "}
              conversas que receberam mensagem por último.
            </p>
          ) : null}

          {linhasVisiveis.length === 0 && !carregandoLista ? (
            vazioDaFila()
          ) : modoRecontatos ? (
            // Recontatos em grupos pelo dia: os atrasados no alto, na cor de
            // atenção, depois os de hoje e os próximos.
            <div ref={listaRef}>
              {gruposDeRecontato.map((g) => (
                <section
                  key={g.chave}
                  aria-labelledby={`grupo-recontato-${g.chave}`}
                >
                  <h2
                    id={`grupo-recontato-${g.chave}`}
                    className="tipo-nota flex items-baseline gap-0.5 px-2 pt-1.5 pb-0.5 text-texto-2"
                  >
                    <span
                      className={cn(
                        "font-semibold",
                        g.chave === "atrasados" && "text-atencao",
                      )}
                    >
                      {g.titulo}
                    </span>
                    <span aria-hidden>·</span>
                    <span className="tabular-nums">
                      {g.linhas.length.toLocaleString("pt-BR")}
                    </span>
                  </h2>
                  <div
                    role="list"
                    aria-labelledby={`grupo-recontato-${g.chave}`}
                  >
                    {g.linhas.map(desenharLinha)}
                  </div>
                </section>
              ))}
            </div>
          ) : (
            <div
              ref={listaRef}
              role="list"
              aria-label={`Conversas em ${NOME_DA_VISAO[filtros.visao]}`}
            >
              {linhasVisiveis.map(desenharLinha)}
            </div>
          )}

          {lista.temMais && !carregandoLista ? (
            <div className="px-2 pt-1">
              <Button
                variant="secondary"
                className="w-full pointer-coarse:h-[44px]"
                carregando={carregandoMais}
                onClick={() => void carregarMais()}
              >
                {carregandoMais ? "Carregando…" : "Carregar mais"}
              </Button>
            </div>
          ) : null}

          {lista.cortada && totalDaVisao !== null ? (
            <p className="tipo-nota px-2 pt-1.5 text-texto-2">
              Mostrando{" "}
              <span className="tabular-nums">
                {lista.linhas.length.toLocaleString("pt-BR")}
              </span>{" "}
              de{" "}
              <span className="tabular-nums">
                {totalDaVisao.toLocaleString("pt-BR")}
              </span>{" "}
              em aberto. Quem espera resposta vem antes; a busca acha as outras.
            </p>
          ) : null}

          {pessoasFora.length > 0 ? (
            <div data-pessoas="">
              <h2 className="tipo-nota px-2 pt-2 pb-0.5 text-texto-2">
                Em outras visões e contatos
              </h2>
              <ul>
                {pessoasFora.map((p) => (
                  <LinhaPessoa key={p.leadId} pessoa={p} aoAbrir={aoAbrirLinha} />
                ))}
              </ul>
            </div>
          ) : pessoas &&
            "erro" in pessoas &&
            pessoas.termo === termoNaTela &&
            termoNaTela.length >= 2 ? (
            <p className="tipo-nota px-2 pt-2 text-erro">{pessoas.erro}</p>
          ) : null}
        </div>

      </section>

      {/* ── conversa ── */}
      <section
        aria-label="Conversa"
        className={cn(
          "@container relative min-w-0 flex-1 flex-col bg-fundo",
          aberta ? "flex" : "hidden md:flex",
        )}
      >
        {!aberta ? (
          <PalcoVazio mac={mac} leitura={leitura} />
        ) : (
          <>
            <header className="flex shrink-0 items-center gap-0.5 border-b border-fio bg-fundo pt-[max(6px,env(safe-area-inset-top))] pr-1 pb-0.5 pl-0.5 md:min-h-[64px] md:gap-1 md:py-1 md:pr-2 md:pl-2">
              {voltarDaAberta ? (
                <Link
                  href={voltarDaAberta}
                  aria-label={`Voltar: ${rotuloVoltar(voltarDaAberta)}`}
                  title={rotuloVoltar(voltarDaAberta)}
                  className={CLASSE_VOLTAR}
                >
                  <ArrowLeft size={20} strokeWidth={1.75} aria-hidden />
                  <span
                    aria-hidden
                    className="max-w-[140px] truncate md:hidden @2xl:inline"
                  >
                    {rotuloVoltar(voltarDaAberta)}
                  </span>
                </Link>
              ) : (
                <button
                  type="button"
                  onClick={sairDaConversa}
                  aria-label={`Voltar para ${NOME_DA_VISAO[filtros.visao]}`}
                  className={cn(CLASSE_VOLTAR, "md:hidden")}
                >
                  <ArrowLeft size={20} strokeWidth={1.75} aria-hidden />
                  <span className="max-w-[96px] truncate">
                    {NOME_DA_VISAO[filtros.visao]}
                  </span>
                </button>
              )}

              {telaXl ? (
                <div className="flex min-w-0 flex-1 items-center gap-1.5 pl-0.5">
                  <AvatarContato
                    nome={aberta.nome}
                    leadId={aberta.leadId}
                    instagram={aberta.instagram}
                    className="h-[40px] w-[40px] tipo-nota font-semibold"
                  />
                  <div className="min-w-0">
                    <h2
                      ref={nomeRef}
                      tabIndex={-1}
                      className="tipo-destaque truncate text-tinta outline-none"
                    >
                      {aberta.nome}
                    </h2>
                    <SubtituloConversa
                      donoId={donoIdDaAberta}
                      dono={donoDaAberta}
                      semDono={semDonoAberta}
                      canal={conversaEmCena?.canal ?? null}
                    />
                  </div>
                </div>
              ) : (
                <button
                  ref={gatilhoPainelRef}
                  type="button"
                  onClick={() => setPainelAberto(true)}
                  aria-haspopup="dialog"
                  title="Dados do contato"
                  className="flex min-h-[44px] min-w-0 flex-1 items-center gap-1 rounded-controle py-0.5 pr-1 pl-0.5 text-left transition-colors duration-[120ms] hover:bg-realce active:bg-pressionado focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-tinta"
                >
                  <AvatarContato
                    nome={aberta.nome}
                    leadId={aberta.leadId}
                    instagram={aberta.instagram}
                    className="h-[36px] w-[36px] tipo-legenda font-semibold md:h-[40px] md:w-[40px]"
                  />
                  <span className="min-w-0">
                    <span className="tipo-destaque block truncate text-tinta">
                      {aberta.nome}
                    </span>
                    <SubtituloConversa
                      donoId={donoIdDaAberta}
                      dono={donoDaAberta}
                      semDono={semDonoAberta}
                      canal={conversaEmCena?.canal ?? null}
                    />
                  </span>
                </button>
              )}

              <div className="flex shrink-0 items-center gap-0.5 md:gap-1">
                {podeAssumirAberta ? (
                  <button
                    type="button"
                    disabled={pendenteAberta}
                    onClick={() => void assumir(aberta.leadId)}
                    title="Assumir a conversa (A)"
                    aria-label="Assumir a conversa"
                    className={classesDoBotao({
                      variant: "secondary",
                      className: "hidden w-[40px] px-0 md:inline-flex @3xl:w-auto @3xl:px-2",
                    })}
                  >
                    <UserPlus size={18} strokeWidth={1.75} aria-hidden />
                    <span className="hidden @3xl:inline">Assumir</span>
                  </button>
                ) : null}
                {!resolvidaAberta && !leitura ? (
                  <button
                    type="button"
                    disabled={pendenteAberta}
                    onClick={() => void despachar(aberta.leadId, "resolver")}
                    title="Resolver e ir para a próxima (E)"
                    aria-label="Resolver e ir para a próxima"
                    className={cn(
                      BOTAO_ICONE,
                      "text-tinta md:hidden",
                    )}
                  >
                    <Check size={22} strokeWidth={2} aria-hidden />
                  </button>
                ) : null}
                {!resolvidaAberta && !leitura ? (
                  <button
                    type="button"
                    disabled={pendenteAberta}
                    onClick={() => void despachar(aberta.leadId, "resolver")}
                    title="Resolver e ir para a próxima (E)"
                    aria-label="Resolver"
                    className={classesDoBotao({
                      variant: "secondary",
                      className: "hidden w-[40px] px-0 md:inline-flex @3xl:w-auto @3xl:px-2",
                    })}
                  >
                    <Check size={18} strokeWidth={2} aria-hidden />
                    <span className="hidden @3xl:inline">Resolver</span>
                  </button>
                ) : null}
                {!resolvidaAberta && !leitura ? (
                  <div className="hidden md:block">
                    <MenuAdiar
                      desativado={pendenteAberta}
                      aoAdiar={(prazo) =>
                        void despachar(aberta.leadId, "adiar", { prazo })
                      }
                      aoEscolherData={() =>
                        setAdiarData({
                          aberto: true,
                          alvo: { tipo: "conversa", leadId: aberta.leadId },
                        })
                      }
                    />
                  </div>
                ) : null}
                {telaXl ? (
                  <button
                    type="button"
                    onClick={() => gravarPainel(!painelRecolhido)}
                    aria-pressed={!painelRecolhido}
                    aria-label="Dados do contato"
                    title={
                      painelRecolhido
                        ? "Mostrar os dados do contato"
                        : "Esconder os dados do contato"
                    }
                    className={cn(BOTAO_ICONE, !painelRecolhido && "text-tinta")}
                  >
                    {painelRecolhido ? (
                      <PanelRight size={20} strokeWidth={1.75} aria-hidden />
                    ) : (
                      <PanelRightClose size={20} strokeWidth={1.75} aria-hidden />
                    )}
                  </button>
                ) : null}
                {conversaEmCena ? (
                  <MenuConversa
                    key={aberta.leadId}
                    leadId={aberta.leadId}
                    nome={aberta.nome}
                    ferramentas={conversaEmCena.ferramentas}
                    equipe={equipeDestinos}
                    etiquetas={catalogos.etiquetas}
                    carga={gestao ? cargaPorPessoa : null}
                    voltar={hrefDaAberta}
                    variante={telaMd ? "menu" : "folha"}
                    adiada={adiadaAberta}
                    somenteLeitura={leitura}
                    pedido={pedidoMenu}
                    aoAdiar={(prazo) =>
                      void despachar(aberta.leadId, "adiar", { prazo })
                    }
                    aoEscolherData={() =>
                      setAdiarData({
                        aberto: true,
                        alvo: { tipo: "conversa", leadId: aberta.leadId },
                      })
                    }
                    aoAgendarRecontato={abrirAgendarRecontato}
                    aoReativar={() => void despachar(aberta.leadId, "reativar")}
                    aoResumir={() => void pedirResumo()}
                    aoAtribuir={aoAtribuirAberta}
                    aoEtiquetar={aoEtiquetarAberta}
                    aoMarcarNaoLida={aoMarcarNaoLidaAberta}
                    aoAntesDeMarcarNaoLida={aoAntesDeMarcarNaoLida}
                    aoFalharMarcarNaoLida={aoFalharMarcarNaoLida}
                    aoReabrir={aoReabrirAberta}
                    aoAbrir={() => {
                      void pedirCarga();
                      pedirSoLeitura();
                    }}
                  />
                ) : null}
              </div>
            </header>

            {/* No celular o Assumir ganha a largura toda: sem dono é estado
                que pesa, e o cabeçalho não tem lugar para ele. */}
            {podeAssumirAberta && !telaMd ? (
              <div className="shrink-0 border-b border-fio px-2 py-1">
                <Button
                  variant="secondary"
                  className="w-full pointer-coarse:h-[44px]"
                  icone={<UserPlus size={18} strokeWidth={1.75} aria-hidden />}
                  carregando={pendenteAberta}
                  onClick={() => void assumir(aberta.leadId)}
                >
                  Assumir a conversa
                </Button>
              </div>
            ) : null}

            {/* O recontato pendente mais cedo: o motivo, quando e as ações.
                Do dia (ou atrasado), em atenção. */}
            {recontatoEmCena && conversaEmCena ? (
              <FaixaRecontato
                key={recontatoEmCena.id}
                recontato={recontatoEmCena}
                hoje={diaDaChave(conversaEmCena.hojeChave)}
                somenteLeitura={leitura}
                podeEnviarTemplate={podeEnviarTemplateRecontato}
                pendente={recontatoGravando}
                aoEnviarTemplate={abrirTemplateDoRecontato}
                aoFeito={() => void encerrarRecontatoDaCena("feito")}
                aoReagendar={abrirReagendarRecontato}
                aoCancelar={() => void encerrarRecontatoDaCena("cancelado")}
                gatilhoRef={gatilhoReagendarRef}
              />
            ) : null}

            {resumo || resumindo ? (
              <div className="mx-2 mt-1.5 max-h-[40%] shrink-0 overflow-y-auto overscroll-contain rounded-painel bg-cartao py-1 pr-0.5 pl-1.5 md:mx-3">
                <div className="flex items-start gap-1">
                  <div className="min-w-0 flex-1 pt-0.5">
                    <p className="tipo-nota font-semibold text-texto-2">
                      Resumo
                    </p>
                    {resumindo ? (
                      <p className="tipo-corpo mt-0.5 inline-flex items-center gap-1 text-texto-2">
                        <Spinner tamanho={16} /> Resumindo a conversa…
                      </p>
                    ) : (
                      <p
                        className={cn(
                          "tipo-corpo mt-0.5 whitespace-pre-wrap",
                          resumo?.erro ? "text-erro" : "text-tinta",
                        )}
                      >
                        {resumo?.texto ?? resumo?.erro}
                      </p>
                    )}
                  </div>
                  <button
                    type="button"
                    aria-label={resumindo ? "Cancelar o resumo" : "Fechar o resumo"}
                    title={resumindo ? "Cancelar o resumo" : "Fechar o resumo"}
                    onClick={fecharResumo}
                    className={BOTAO_ICONE}
                  >
                    <X size={18} strokeWidth={1.75} aria-hidden />
                  </button>
                </div>
              </div>
            ) : null}

            {erroConversa ? (
              <div className="m-auto max-w-[40ch] px-2 text-center">
                <p role="alert" className="tipo-corpo text-erro">
                  {erroConversa}
                </p>
                <Button
                  variant="secondary"
                  className="mt-1.5 pointer-coarse:h-[44px]"
                  onClick={() =>
                    void abrirConversa(aberta.leadId, aberta.nome, {
                      historia: "nenhuma",
                    })
                  }
                >
                  Tentar de novo
                </Button>
              </div>
            ) : carregandoConversa || !conversaEmCena ? (
              <EsqueletoConversa />
            ) : (
              <Janela
                leadId={aberta.leadId}
                nomeContato={aberta.nome}
                temConversa={conversaEmCena.temConversa}
                mensagens={conversaEmCena.mensagens}
                mensagensPadrao={catalogos.mensagensPadrao}
                templates={catalogos.templates}
                restanteJanela={conversaEmCena.restanteJanela}
                marketingBloqueado={conversaEmCena.marketingBloqueado}
                hojeChave={conversaEmCena.hojeChave}
                ontemChave={conversaEmCena.ontemChave}
                canal={conversaEmCena.canal}
                aceitaTemplate={conversaEmCena.aceitaTemplate}
                focarAoAbrir={focoCompositorPara === aberta.leadId}
                pedidoProntas={pedidoProntas}
                podeConfigurar={gestao}
                aoEnviarComSucesso={aoEnviarComSucesso}
                aoEnviarEResolver={aoEnviarEResolver}
                aoResolverESeguir={aoResolverESeguir}
                aoSairDoCompositor={focarFila}
                aoEnvioEmVoo={aoEnvioEmVoo}
                somenteLeitura={leitura}
              />
            )}
          </>
        )}
      </section>

      {/* ── dados do contato: coluna no desktop largo, folha abaixo dele ── */}
      {aberta && telaXl && !painelRecolhido ? (
        <aside
          aria-label="Dados do contato"
          className="w-[320px] shrink-0 border-l border-fio bg-fundo"
        >
          <PainelContato
            key={aberta.leadId}
            leadId={aberta.leadId}
            nome={aberta.nome}
            instagram={aberta.instagram}
            responsavelNome={
              conversaEmCena ? conversaEmCena.ferramentas.responsavelNome : undefined
            }
            etiquetas={etiquetasDaAberta}
            voltar={hrefDaAberta}
            forma="coluna"
            aoTrocarAtendente={trocarAtendentePeloPainel}
            aoTrocarEtiquetas={trocarEtiquetasPeloPainel}
            somenteLeitura={leitura}
          />
        </aside>
      ) : null}
      {aberta && !telaXl ? (
        <Folha
          aberta={painelAberto}
          aoFechar={() => setPainelAberto(false)}
          titulo={aberta.nome}
          forma="lado"
          retorno={gatilhoPainelRef}
        >
          <PainelContato
            key={aberta.leadId}
            leadId={aberta.leadId}
            nome={aberta.nome}
            instagram={aberta.instagram}
            responsavelNome={
              conversaEmCena ? conversaEmCena.ferramentas.responsavelNome : undefined
            }
            etiquetas={etiquetasDaAberta}
            voltar={hrefDaAberta}
            forma="folha"
            aoTrocarAtendente={trocarAtendentePeloPainel}
            aoTrocarEtiquetas={trocarEtiquetasPeloPainel}
            somenteLeitura={leitura}
          />
        </Folha>
      ) : null}

      {/* Os diálogos do adiar com data, do recontato e do template da faixa.
          Ficam montados (a folha fecha descendo) e guardam o último alvo. */}
      <DialogoAdiarData
        aberto={adiarData.aberto}
        aoFechar={() => setAdiarData((a) => ({ ...a, aberto: false }))}
        horaPadrao={catalogos.horaRecontato}
        rotuloBotao={adiarData.alvo.tipo === "massa" ? "Continuar" : "Adiar"}
        aoConfirmar={(iso, frase) => {
          const alvo = adiarData.alvo;
          setAdiarData((a) => ({ ...a, aberto: false }));
          if (alvo.tipo === "massa") {
            pedirConfirmacao({ tipo: "adiar", prazo: "data", ate: iso, frase });
          } else {
            void despachar(alvo.leadId, "adiar", { prazo: "data", ate: iso });
          }
        }}
      />
      <DialogoRecontato
        aberto={dialogoRecontato.aberto}
        aoFechar={() => setDialogoRecontato((d) => ({ ...d, aberto: false }))}
        leadId={dialogoRecontato.leadId}
        nomeContato={dialogoRecontato.nome}
        templates={catalogos.templates}
        aceitaTemplate={
          conversaEmCena && conversaEmCena.leadId === dialogoRecontato.leadId
            ? conversaEmCena.aceitaTemplate
            : null
        }
        horaPadrao={catalogos.horaRecontato}
        reagendar={dialogoRecontato.reagendar}
        aoConcluir={aoRecontatoAgendado}
        retorno={dialogoRecontato.reagendar ? gatilhoReagendarRef : undefined}
      />
      {aberta && catalogos.templates && catalogos.templates.length > 0 ? (
        <DialogoTemplate
          key={aberta.leadId}
          aberto={
            templateDoRecontato.aberto &&
            templateDoRecontato.recontato?.leadId === aberta.leadId
          }
          aoFechar={() =>
            setTemplateDoRecontato((t) => ({ ...t, aberto: false }))
          }
          leadId={aberta.leadId}
          nomeContato={aberta.nome}
          templates={catalogos.templates}
          inicial={templateDoRecontato.recontato?.template ?? null}
          recontatoId={templateDoRecontato.recontato?.id ?? null}
          aoEnviar={aoTemplateDoRecontatoEnviado}
          aoEnvioEmVoo={aoTemplateDoRecontatoEmVoo}
        />
      ) : null}

      {/* O aviso de um gesto (com Desfazer), um por vez. No celular com a
          conversa aberta ele desce do alto, abaixo do cabeçalho; no resto,
          sobe no pé da fila, onde a linha sumiu. */}
      <div
        aria-live="polite"
        className={cn(
          "pointer-events-none absolute z-30 flex",
          aberta && !telaMd
            ? "inset-x-2 top-[calc(64px+env(safe-area-inset-top))] justify-center"
            : "bottom-2 left-2 w-[calc(100%-32px)] md:w-[328px]",
        )}
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
            {aviso.desfazer ? (
              <button
                type="button"
                onClick={() => void desfazer()}
                className="tipo-corpo h-[40px] shrink-0 rounded-celula px-1 font-semibold text-fundo underline underline-offset-2 transition-colors duration-[120ms] hover:bg-tinta-hover focus-visible:outline-2 focus-visible:outline-offset-1 focus-visible:outline-fundo pointer-coarse:h-[44px]"
              >
                Desfazer
              </button>
            ) : null}
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
      </div>
    </div>
  );

  // As fotos da equipe chegam a tudo que está na tela (a bolha, a linha da
  // fila, o cabeçalho, os menus de Transferir e de Atendentes) por contexto,
  // do mapa que a página leu uma vez.
  return <ProvedorFotosDaEquipe fotos={fotos}>{tela}</ProvedorFotosDaEquipe>;
}

/* ── pedaços sem estado ───────────────────────────────────────────────── */

/** Dono (com a foto, ou "Sem dono", em atenção) e o canal da resposta. */
function SubtituloConversa({
  donoId,
  dono,
  semDono,
  canal,
}: {
  donoId: string | null;
  dono: string | null;
  semDono: boolean;
  canal: "whatsapp" | "instagram" | null;
}) {
  const sufixo = canal
    ? ` · ${canal === "instagram" ? "Direct" : "WhatsApp"}`
    : null;
  // Com dono, a foto dele (ou as iniciais) antes do nome, do tamanho da
  // linha: o subtítulo não cresce.
  if (!semDono && donoId && dono) {
    return (
      <span className="tipo-nota flex min-w-0 items-center gap-0.5 text-texto-2">
        <AvatarDaEquipe id={donoId} nome={dono} />
        <span className="min-w-0 truncate">
          {dono}
          {sufixo}
        </span>
      </span>
    );
  }
  return (
    <span className="tipo-nota block truncate text-texto-2">
      {semDono ? <span className="text-atencao">Sem dono</span> : dono}
      {sufixo}
    </span>
  );
}

/** O palco sem conversa (só do tablet para cima): o que fazer e as teclas.
 *  Quem só lê não vê as teclas que gravam. */
function PalcoVazio({ mac, leitura }: { mac: boolean; leitura: boolean }) {
  const cmd = mac ? "⌘" : "Ctrl+";
  const atalhos: [string, string][] = leitura
    ? [
        ["J", "Próxima da fila"],
        ["K", "Anterior"],
        [`${cmd}K`, "Buscar pessoa ou comando"],
      ]
    : [
        ["J", "Próxima da fila"],
        ["K", "Anterior"],
        ["E", "Resolver e seguir"],
        ["H", "Adiar até amanhã"],
        ["A", "Assumir"],
        [`${cmd}Enter`, "Enviar e resolver"],
        ["Esc", "Do compositor para a fila"],
        [`${cmd}K`, "Buscar pessoa ou comando"],
      ];
  return (
    <div className="m-auto px-3 py-4 text-center">
      <p className="tipo-titulo-3 text-tinta">Nenhuma conversa aberta</p>
      <p className="tipo-corpo mt-0.5 text-texto-2">Escolha uma na fila.</p>
      <dl className="mx-auto mt-3 grid w-max grid-cols-[auto_auto] items-center gap-x-1.5 gap-y-1 text-left pointer-coarse:hidden">
        {atalhos.map(([tecla, faz]) => (
          <Fragment key={tecla}>
            <dt className="text-right">
              <kbd className="tipo-nota inline-flex h-[24px] min-w-[24px] items-center justify-center rounded-celula bg-cartao px-0.5 text-tinta">
                {tecla}
              </kbd>
            </dt>
            <dd className="tipo-nota text-texto-2">{faz}</dd>
          </Fragment>
        ))}
      </dl>
    </div>
  );
}

/** Enquanto a conversa abre: bolhas e compositor no formato da tela. */
function EsqueletoConversa() {
  const bloco = "rounded-painel bg-cartao motion-safe:animate-pulse";
  return (
    <div
      role="status"
      aria-label="Abrindo a conversa"
      className="flex min-h-0 flex-1 flex-col"
    >
      <div className="flex min-h-0 flex-1 flex-col justify-end gap-1 px-2 py-2 md:px-3">
        <div className={cn("h-[44px] w-[46%] self-start", bloco)} />
        <div className={cn("h-[64px] w-[58%] self-start", bloco)} />
        <div className={cn("h-[44px] w-[40%] self-end", bloco)} />
        <div className={cn("h-[44px] w-[50%] self-start", bloco)} />
      </div>
      <div className="h-[132px] shrink-0 border-t border-fio" />
    </div>
  );
}
