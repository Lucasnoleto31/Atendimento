"use client";

import {
  useCallback,
  useEffect,
  useRef,
  useState,
  useSyncExternalStore,
} from "react";
import Link from "next/link";
import {
  ArrowDown,
  Check,
  CheckCheck,
  Clock,
  ExternalLink,
  Inbox,
  ListFilter,
  PanelRight,
  RotateCcw,
  Search,
  Sparkles,
  Timer,
  X,
} from "lucide-react";
import { cn } from "@/lib/utils";
import { Janela } from "@/app/(app)/chat/janela";
import {
  adiarConversa,
  alterarStatusConversaChat,
} from "@/app/(app)/chat/actions";
import { carregarConversa, type ConversaDoPainel } from "@/app/(app)/hoje/actions";
import { resumirConversa, sugerirResposta } from "@/app/(app)/chat/ia";
import { sugestaoStore } from "@/app/(app)/chat/sugestao-store";
import { FerramentasPalco } from "./ferramentas-palco";
import { PainelContexto } from "./contexto";
import { PaletaComandos } from "./paleta";
import { TempoRealConversas } from "./tempo-real";
import {
  carregarListaConversas,
  type CargaConversas,
  type LinhaConversa,
  type VisaoConversas,
} from "./actions";

/**
 * O Chat da Mesa (Bloco A do redesign aprovado no mockup): a lista vive no
 * NAVEGADOR — trocar de visão é uma chamada, abrir conversa é outra. Nada
 * de refazer a página inteira a cada clique (o pecado arquitetural do chat
 * antigo, ~18–28 consultas por gesto).
 *
 * Bloco A entrega lista + responder (a Janela existente no palco). As
 * ferramentas completas da conversa e o compositor novo são o Bloco B — até
 * lá, o link "abrir no Chat" leva à tela antiga para o que faltar.
 */

const VISOES: { chave: VisaoConversas; rotulo: string; icone: React.ReactNode }[] = [
  { chave: "caixa", rotulo: "Caixa", icone: <Inbox size={19} strokeWidth={1.7} aria-hidden /> },
  { chave: "aguardando", rotulo: "Aguard.", icone: <Clock size={19} strokeWidth={1.7} aria-hidden /> },
  { chave: "adiadas", rotulo: "Adiadas", icone: <Timer size={19} strokeWidth={1.7} aria-hidden /> },
  { chave: "tudo", rotulo: "Tudo", icone: <ListFilter size={19} strokeWidth={1.7} aria-hidden /> },
];

const ORDENS: Record<VisaoConversas, string> = {
  caixa: "Quem espera mais, primeiro. Adiadas vencidas voltaram para cá.",
  aguardando: "Só quem espera resposta — o relógio manda.",
  adiadas: "Dormindo com hora para acordar. Venceu, volta para a Caixa.",
  tudo: "O acervo completo, do mais recente para trás.",
};

/** Cor determinística por nome — identidade visual sem foto (a API oficial não dá a foto). */
const PALETA_AVATAR = [
  "#2E6296", "#A96513", "#6B5CA5", "#188652", "#B05A7A",
  "#3C7C8C", "#5C6BB3", "#398577", "#8A6D3B", "#985B4C",
];
function corDe(nome: string): string {
  let h = 0;
  for (let i = 0; i < nome.length; i++) h = (h * 31 + nome.charCodeAt(i)) >>> 0;
  return PALETA_AVATAR[h % PALETA_AVATAR.length];
}
function iniciaisDe(nome: string): string {
  const p = nome.trim().split(/\s+/);
  return ((p[0]?.[0] ?? "") + (p[1]?.[0] ?? "")).toUpperCase() || "?";
}

// xl (1280px) é onde cabem as três colunas — abaixo disso o contexto vira
// folha. Lido do cliente para não montar as duas versões ao mesmo tempo.
const CONSULTA_XL = "(min-width: 1280px)";
function assinarXl(avisar: () => void) {
  const mq = window.matchMedia(CONSULTA_XL);
  mq.addEventListener("change", avisar);
  return () => mq.removeEventListener("change", avisar);
}
const lerXl = () => window.matchMedia(CONSULTA_XL).matches;

function rotuloEspera(horas: number | null): string | null {
  if (horas === null) return null;
  if (horas < 1) return `${Math.max(1, Math.round(horas * 60))}min`;
  if (horas < 48) return `${Math.floor(horas)}h`;
  return `${Math.floor(horas / 24)}d`;
}

const FORMATO_HORA = new Intl.DateTimeFormat("pt-BR", {
  timeZone: "America/Sao_Paulo",
  hour: "2-digit",
  minute: "2-digit",
});
const FORMATO_DIA_CURTO = new Intl.DateTimeFormat("pt-BR", {
  timeZone: "America/Sao_Paulo",
  day: "2-digit",
  month: "2-digit",
});
const FORMATO_DIA = new Intl.DateTimeFormat("pt-BR", { timeZone: "America/Sao_Paulo" });
function horaOuDia(iso: string | null, hojeChave: string): string {
  if (!iso) return "";
  const d = new Date(iso);
  return FORMATO_DIA.format(d) === hojeChave
    ? FORMATO_HORA.format(d)
    : FORMATO_DIA_CURTO.format(d);
}

export function AppConversas({
  inicial,
  hojeChave,
  leadInicial,
}: {
  inicial: CargaConversas;
  hojeChave: string;
  /** Deep link ?lead= — a conversa já vem carregada do servidor. */
  leadInicial: { leadId: string; nome: string; dados: ConversaDoPainel } | null;
}) {
  const [visao, setVisao] = useState<VisaoConversas>("caixa");
  const [escopo, setEscopo] = useState<"minhas" | "todas">("todas");
  const [busca, setBusca] = useState("");
  const [carga, setCarga] = useState<CargaConversas>(inicial);
  const [carregandoLista, setCarregandoLista] = useState(false);
  const [erroLista, setErroLista] = useState<string | null>(null);

  const [aberta, setAberta] = useState<{ leadId: string; nome: string } | null>(
    leadInicial ? { leadId: leadInicial.leadId, nome: leadInicial.nome } : null,
  );
  const [conversa, setConversa] = useState<ConversaDoPainel | null>(
    leadInicial?.dados ?? null,
  );
  const [carregandoConversa, setCarregandoConversa] = useState(false);
  const [erroConversa, setErroConversa] = useState<string | null>(null);
  // Conjunto, não um slot só: duas linhas podem estar sendo resolvidas ao
  // mesmo tempo, e uma delas travada não pode calar a outra.
  const [acaoPendente, setAcaoPendente] = useState<ReadonlySet<string>>(
    () => new Set(),
  );
  const [resumo, setResumo] = useState<{ texto?: string; erro?: string } | null>(null);
  const [resumindo, setResumindo] = useState(false);
  const [paletaAberta, setPaletaAberta] = useState(false);
  // Painel de contexto: no desktop é uma coluna fixa (o atendente quer ver
  // giro e combinados enquanto escreve); abaixo de xl vira folha por cima.
  const [painelAberto, setPainelAberto] = useState(false);
  const telaLarga = useSyncExternalStore(assinarXl, lerXl, () => false);
  const [sinalContexto, setSinalContexto] = useState(0);
  // Devolve o foco ao botão que abriu a folha — solto no body, a próxima
  // letra digitada viraria atalho do palco (E resolve a conversa).
  const gatilhoPainelRef = useRef<HTMLButtonElement>(null);
  const fecharPainel = useCallback(() => {
    setPainelAberto(false);
    gatilhoPainelRef.current?.focus();
  }, []);

  const pedidoRef = useRef(0);
  // Contadores de corrida: resposta que chega depois de outra troca é lixo.
  const pedidoConversaRef = useRef(0);
  const pedidoResumoRef = useRef(0);
  const acordeGRef = useRef(0);
  // Quem está EM CENA agora. O contador sozinho não basta para a recarga do
  // menu ⋯: ela nasce numa closure do lead antigo e só é chamada depois da
  // troca, quando o contador já subiu — a identidade do lead é o que decide.
  const abertaRef = useRef<{ leadId: string; nome: string } | null>(
    leadInicial ? { leadId: leadInicial.leadId, nome: leadInicial.nome } : null,
  );

  const recarregarLista = useCallback(
    async (v: VisaoConversas, e: "minhas" | "todas", b: string) => {
      const pedido = ++pedidoRef.current;
      setCarregandoLista(true);
      setErroLista(null);
      const r = await carregarListaConversas(v, { escopo: e, busca: b });
      if (pedido !== pedidoRef.current) return; // resposta velha: descarta
      setCarregandoLista(false);
      if ("erro" in r) setErroLista(r.erro);
      else setCarga(r);
    },
    [],
  );

  // Rede de segurança do tempo real: uma recarga silenciosa por minuto,
  // só com a aba visível. Sem publication (0014) ou com o canal caído, é
  // isto que mantém a fila viva — sem flicker, porque não passa pelo
  // estado de carregamento.
  const estadoListaRef = useRef({ visao, escopo, busca });
  useEffect(() => {
    estadoListaRef.current = { visao, escopo, busca };
  }, [visao, escopo, busca]);
  useEffect(() => {
    const t = window.setInterval(() => {
      if (document.visibilityState !== "visible") return;
      const { visao: v, escopo: e, busca: b } = estadoListaRef.current;
      void carregarListaConversas(v, { escopo: e, busca: b }).then((r) => {
        // Só aplica se o filtro não mudou enquanto a resposta viajava.
        const atual = estadoListaRef.current;
        if (atual.visao === v && atual.escopo === e && atual.busca === b && !("erro" in r)) {
          setCarga(r);
        }
      });
    }, 60_000);
    return () => window.clearInterval(t);
  }, []);

  // Busca com respiro de 300ms; visão/escopo recarregam na hora.
  const timerBusca = useRef<number | null>(null);
  const aoBuscar = (valor: string) => {
    setBusca(valor);
    if (timerBusca.current !== null) clearTimeout(timerBusca.current);
    timerBusca.current = window.setTimeout(() => {
      void recarregarLista(visao, escopo, valor);
    }, 300);
  };
  const trocarVisao = (v: VisaoConversas) => {
    setVisao(v);
    void recarregarLista(v, escopo, busca);
  };
  const trocarEscopo = () => {
    const novo = escopo === "todas" ? "minhas" : "todas";
    setEscopo(novo);
    void recarregarLista(visao, novo, busca);
  };

  const abrirConversa = useCallback(
    async (linha: { leadId: string; nome: string }) => {
      const pedido = ++pedidoConversaRef.current;
      pedidoResumoRef.current++; // resumo em voo era da conversa anterior
      abertaRef.current = linha;
      setAberta(linha);
      setConversa(null);
      setErroConversa(null);
      setResumo(null);
      setResumindo(false);
      setCarregandoConversa(true);
      const r = await carregarConversa(linha.leadId);
      // Dois cliques rápidos: só a resposta do ÚLTIMO clique conta — sem
      // isto, a resposta lenta do lead A sobrescrevia o lead B já aberto.
      if (pedido !== pedidoConversaRef.current) return;
      setCarregandoConversa(false);
      if ("erro" in r) setErroConversa(r.erro ?? "Não deu para abrir.");
      else {
        setConversa(r);
        // Balão fantasma: só quando o cliente falou por último — é quando
        // existe uma resposta a escrever. Roda por fora do fluxo de abrir
        // (a conversa nunca espera a IA) e o store descarta sozinho se o
        // atendente trocar de conversa ou começar a digitar.
        sugestaoStore.limpar();
        const ultima = r.mensagens[r.mensagens.length - 1];
        if (ultima && ultima.tipo === "mensagem_recebida") {
          void sugerirResposta(linha.leadId)
            .then((sug) => {
              if (sug.sugestao && pedido === pedidoConversaRef.current) {
                sugestaoStore.definir(linha.leadId, sug.sugestao);
              }
            })
            .catch(() => {});
        }
      }
      // Abrir marca como lida no servidor (carregarConversa cuida); o
      // reflexo local é imediato.
      setCarga((c) => ({
        ...c,
        linhas: c.linhas.map((l) =>
          l.leadId === linha.leadId ? { ...l, naoLida: false } : l,
        ),
      }));
    },
    [],
  );

  const proxima = useCallback(() => {
    const fila = carga.linhas;
    if (fila.length === 0) return;
    const i = fila.findIndex((l) => l.leadId === aberta?.leadId);
    const alvo = fila[(i + 1) % fila.length];
    if (alvo) void abrirConversa({ leadId: alvo.leadId, nome: alvo.nome });
  }, [carga.linhas, aberta, abrirConversa]);

  const anterior = useCallback(() => {
    const fila = carga.linhas;
    if (fila.length === 0) return;
    const i = fila.findIndex((l) => l.leadId === aberta?.leadId);
    const alvo = fila[(i - 1 + fila.length) % fila.length];
    if (alvo) void abrirConversa({ leadId: alvo.leadId, nome: alvo.nome });
  }, [carga.linhas, aberta, abrirConversa]);

  // Resolver/Adiar de 1 clique: a linha some da visão na hora (otimista) e
  // o servidor confirma; erro devolve a linha e avisa.
  const despachar = useCallback(
    async (leadId: string, acao: "resolver" | "adiar") => {
      // Tecla presa ou E-E em sequência na MESMA conversa: a segunda espera
      // (o repeat duplicava o adiar e inflava as contagens). Outra conversa
      // segue livre.
      if (acaoPendente.has(leadId)) return;
      setAcaoPendente((s) => new Set(s).add(leadId));
      let r: { ok?: boolean; erro?: string };
      try {
        r =
          acao === "resolver"
            ? await alterarStatusConversaChat(leadId, "resolved")
            : await adiarConversa(leadId, "amanha");
      } catch {
        // Rede caiu no meio: sem este catch a promessa rejeitava, o lead
        // ficava preso em "pendente" e resolver/adiar morria em silêncio.
        r = { erro: "Sem resposta do servidor — tente de novo." };
      } finally {
        setAcaoPendente((s) => {
          const n = new Set(s);
          n.delete(leadId);
          return n;
        });
      }
      if (r.erro) {
        setErroLista(r.erro);
        return;
      }
      setCarga((c) => ({
        ...c,
        linhas:
          visao === "tudo"
            ? c.linhas
            : c.linhas.filter((l) => l.leadId !== leadId),
        contagens: {
          ...c.contagens,
          caixa: Math.max(0, c.contagens.caixa - (visao === "caixa" ? 1 : 0)),
          aguardando: Math.max(
            0,
            c.contagens.aguardando - (visao === "aguardando" ? 1 : 0),
          ),
          adiadas: c.contagens.adiadas + (acao === "adiar" ? 1 : 0),
        },
      }));
      if (aberta?.leadId === leadId) proxima();
    },
    [visao, aberta, proxima, acaoPendente],
  );

  // Atalhos J/E/H/⌘K (desktop; no celular o gesto vem no Bloco C). E e H
  // ESCREVEM no servidor — a ordem das guardas abaixo é o que impede a
  // digitação de resolver uma conversa sem querer.
  useEffect(() => {
    const aoTeclar = (e: KeyboardEvent) => {
      // Modal aberto (diálogo de perda, template): nada atravessa por baixo
      // — nem a paleta, que empilharia por cima dele.
      const temModal = Boolean(document.querySelector('[role="dialog"]'));
      // ⌘K vale até com o foco num campo — é o contrato de toda paleta.
      if ((e.metaKey || e.ctrlKey) && !e.altKey && e.key.toLowerCase() === "k") {
        if (temModal && !paletaAberta) return;
        e.preventDefault();
        setPaletaAberta((v) => !v);
        return;
      }
      if (e.key === "Escape") {
        // Um painel interno (prontas da Janela, menu ⋯) que já tratou o Esc
        // chega aqui consumido — não fecha a paleta por cima dele.
        if (e.defaultPrevented) return;
        // A folha de contexto é o que está por cima: fecha ela primeiro.
        if (painelAberto && !paletaAberta) fecharPainel();
        else setPaletaAberta(false);
        return;
      }
      if (paletaAberta || temModal) return;
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
      // Foco DENTRO de um menu/lista aberto, ou no botão que o abriu: a
      // tecla é do menu (type-ahead), não do palco. Vale pelo foco — não
      // pela existência do painel no DOM, senão o painel de prontas aberto
      // matava J/E/H mesmo com o foco longe dele.
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
      // Com modificador é atalho do navegador/SO (Cmd+E, Ctrl+H) e repeat é
      // tecla presa — nenhum dos dois é intenção de despachar conversa.
      if (e.metaKey || e.ctrlKey || e.altKey || e.repeat) return;
      const tecla = e.key.toLowerCase();
      // Acorde G→C / G→A do desenho: "ir para" Caixa / Aguardando.
      if (acordeGRef.current && Date.now() - acordeGRef.current < 600) {
        acordeGRef.current = 0;
        if (tecla === "c") {
          setVisao("caixa");
          void recarregarLista("caixa", escopo, busca);
          return;
        }
        if (tecla === "a") {
          setVisao("aguardando");
          void recarregarLista("aguardando", escopo, busca);
          return;
        }
      }
      if (tecla === "g") {
        acordeGRef.current = Date.now();
        return;
      }
      if (tecla === "k") anterior();
      if (e.key.toLowerCase() === "j") proxima();
      if (e.key.toLowerCase() === "e" && aberta) {
        void despachar(aberta.leadId, "resolver");
      }
      if (e.key.toLowerCase() === "h" && aberta) {
        void despachar(aberta.leadId, "adiar");
      }
    };
    window.addEventListener("keydown", aoTeclar);
    return () => window.removeEventListener("keydown", aoTeclar);
  }, [proxima, anterior, paletaAberta, painelAberto, fecharPainel, aberta, despachar, escopo, busca, recarregarLista]);

  const pedirResumo = useCallback(async () => {
    if (!aberta || resumindo) return;
    const pedido = ++pedidoResumoRef.current;
    setResumindo(true);
    setResumo(null);
    let r: { resumo?: string; erro?: string };
    try {
      r = await resumirConversa(aberta.leadId);
    } catch {
      // Sem este catch o ✦ ficava pulsando para sempre em queda de rede.
      r = { erro: "Sem resposta do servidor — tente de novo." };
    }
    // Trocou de conversa no meio: o resumo do lead A não pode aparecer
    // sob o cabeçalho do lead B (abrirConversa invalida o pedido).
    if (pedido !== pedidoResumoRef.current) return;
    setResumindo(false);
    setResumo(r.resumo ? { texto: r.resumo } : { erro: r.erro });
  }, [aberta, resumindo]);

  // Recarga SILENCIOSA após uma ação do menu ⋯: troca os dados por baixo
  // sem desmontar a Janela — desmontar apagava anexos na fila, fechava o
  // menu e re-disparava o marcarChatLido que desfazia o "marcar não lida".
  const recarregarConversaAberta = useCallback(async () => {
    const leadDaRecarga = aberta?.leadId;
    if (!leadDaRecarga) return;
    // Guarda por IDENTIDADE, antes e depois da ida ao servidor: a ação do
    // menu ⋯ pode ter começado no lead A e terminado com o B em cena — e um
    // contador não pega isso, porque ele já subiu antes desta chamada.
    if (abertaRef.current?.leadId !== leadDaRecarga) return;
    const r = await carregarConversa(leadDaRecarga);
    if (abertaRef.current?.leadId !== leadDaRecarga) return;
    if (!("erro" in r)) setConversa(r);
    // O painel de contexto mostra etapa e atendente: sem este sinal ele
    // ficaria com o valor velho ao lado do menu que acabou de mudá-lo.
    setSinalContexto((n) => n + 1);
  }, [aberta]);

  /** O menu ⋯ marcou "não lida": a linha volta a ficar em negrito na hora. */
  const marcarLinhaNaoLida = useCallback((leadId: string) => {
    setCarga((c) => ({
      ...c,
      linhas: c.linhas.map((l) =>
        l.leadId === leadId ? { ...l, naoLida: true } : l,
      ),
    }));
  }, []);

  const contagemDe = (v: VisaoConversas): number | null =>
    v === "caixa"
      ? carga.contagens.caixa
      : v === "aguardando"
        ? carga.contagens.aguardando
        : v === "adiadas"
          ? carga.contagens.adiadas
          : null;

  return (
    <div className="flex h-[calc(100dvh-1px)] min-h-0 bg-neutral-50">
      {/* ── trilho ── */}
      <nav
        aria-label="Visões das conversas"
        className="flex w-[72px] shrink-0 flex-col items-center gap-1 border-r border-neutral-200 bg-neutral-50 py-2"
      >
        {VISOES.map((v) => {
          const n = contagemDe(v.chave);
          const ativa = v.chave === visao;
          return (
            <button
              key={v.chave}
              type="button"
              onClick={() => trocarVisao(v.chave)}
              aria-current={ativa ? "page" : undefined}
              className={cn(
                "relative flex h-[56px] w-[60px] flex-col items-center justify-center gap-0.5 rounded-lg text-neutral-600 transition-colors duration-[120ms] focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-primary-500",
                ativa
                  ? "bg-primary-50 text-primary-600"
                  : "hover:bg-neutral-100 hover:text-neutral-800",
              )}
            >
              {v.icone}
              <span className="text-[10px] font-medium">{v.rotulo}</span>
              {n !== null && n > 0 ? (
                <span
                  className={cn(
                    "absolute top-0.5 right-0.5 inline-flex h-[17px] min-w-[17px] items-center justify-center rounded-full px-0.5 font-mono text-[10px] font-semibold tabular-nums",
                    v.chave === "caixa"
                      ? "bg-danger text-neutral-0"
                      : "bg-primary-600 text-neutral-0",
                  )}
                >
                  {n > 999 ? "1k+" : n}
                </span>
              ) : null}
            </button>
          );
        })}
        <Link
          href="/chat"
          title="Tela antiga do chat (ferramentas completas até o Bloco B)"
          className="mt-auto mb-1 inline-flex h-[40px] w-[40px] items-center justify-center rounded-lg text-neutral-400 hover:bg-neutral-100 hover:text-neutral-800 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-primary-500"
        >
          <ExternalLink size={17} strokeWidth={1.7} aria-hidden />
        </Link>
      </nav>

      {/* ── lista ── */}
      <section
        aria-label="Lista de conversas"
        className={cn(
          "flex w-full min-w-0 flex-col border-r border-neutral-200 bg-neutral-50 md:w-[360px] md:shrink-0",
          aberta ? "hidden md:flex" : "flex",
        )}
      >
        <div className="px-2 pt-2">
          <div className="flex items-baseline gap-1">
            <h1 className="text-h3 font-semibold text-neutral-900">
              {VISOES.find((v) => v.chave === visao)?.rotulo === "Aguard."
                ? "Aguardando"
                : VISOES.find((v) => v.chave === visao)?.rotulo}
            </h1>
            <span className="font-mono text-xs text-neutral-400 tabular-nums">
              {contagemDe(visao) ?? carga.linhas.length}
            </span>
            <button
              type="button"
              onClick={trocarEscopo}
              className="ml-auto inline-flex h-[40px] items-center rounded-md border border-neutral-200 bg-neutral-0 px-1 text-xs font-medium text-neutral-600 hover:bg-neutral-100 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-primary-500"
            >
              {escopo === "todas" ? "Todas" : "Minhas"}
            </button>
          </div>
          <label className="mt-1 flex h-[40px] items-center gap-1 rounded-lg border border-neutral-200 bg-neutral-0 px-1.5">
            <Search size={16} strokeWidth={1.7} aria-hidden className="text-neutral-400" />
            <input
              value={busca}
              onChange={(e) => aoBuscar(e.target.value)}
              placeholder="Buscar nome ou telefone"
              className="h-full min-w-0 flex-1 bg-transparent text-sm text-neutral-800 placeholder:text-neutral-400 focus:outline-none"
            />
          </label>
          <p className="mt-1 mb-1 px-0.5 text-[11px] leading-tight text-neutral-400">
            {ORDENS[visao]}
          </p>
        </div>

        {erroLista ? (
          <p role="alert" className="mx-2 mb-1 rounded-md bg-danger-bg px-1.5 py-1 text-xs text-danger">
            {erroLista}
          </p>
        ) : null}

        <div className={cn("min-h-0 flex-1 overflow-y-auto px-1 pb-1", carregandoLista && "opacity-50")}>
          {carga.linhas.length === 0 && !carregandoLista ? (
            <div className="px-2 py-4 text-center">
              <p className="text-sm font-medium text-neutral-800">
                {visao === "caixa" ? "Caixa zerada." : "Nada por aqui."}
              </p>
              <p className="mt-0.5 text-xs text-neutral-600">
                {visao === "caixa"
                  ? "Bom dia de verdade — a fila de Aguardando é a próxima parada."
                  : "Troque de visão no trilho ou ajuste a busca."}
              </p>
            </div>
          ) : (
            carga.linhas.map((l) => (
              <LinhaLista
                key={l.leadId}
                linha={l}
                aberta={l.leadId === aberta?.leadId}
                hojeChave={hojeChave}
                pendente={acaoPendente.has(l.leadId)}
                aoAbrir={() => void abrirConversa({ leadId: l.leadId, nome: l.nome })}
                aoResolver={() => void despachar(l.leadId, "resolver")}
                aoAdiar={() => void despachar(l.leadId, "adiar")}
              />
            ))
          )}
        </div>

        <div className="flex items-center justify-between border-t border-neutral-200 px-2 py-1">
          <span className="text-[11px] text-neutral-400">
            anel verde = janela aberta · amarelo = só template
          </span>
          <button
            type="button"
            onClick={proxima}
            className="inline-flex h-[40px] items-center gap-0.5 rounded-md bg-primary-50 px-1.5 text-xs font-semibold text-primary-600 hover:bg-primary-100 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-primary-500"
          >
            Próxima <ArrowDown size={13} strokeWidth={2} aria-hidden />
            <kbd className="font-mono text-[10px] font-normal opacity-60">J</kbd>
          </button>
        </div>
      </section>

      {/* ── palco ── */}
      <section
        aria-label="Conversa aberta"
        className={cn(
          "min-w-0 flex-1 flex-col bg-neutral-100",
          aberta ? "flex" : "hidden md:flex",
        )}
      >
        {!aberta ? (
          <div className="flex flex-1 items-center justify-center">
            <div className="text-center">
              <p className="text-h3 text-neutral-800">Escolha uma conversa</p>
              <p className="mt-0.5 text-sm text-neutral-600">
                ou aperte <kbd className="rounded-sm border border-neutral-300 bg-neutral-0 px-0.5 font-mono text-xs">J</kbd> para a primeira da fila.
              </p>
            </div>
          </div>
        ) : (
          <>
            <header className="flex items-center gap-1.5 border-b border-neutral-200 bg-neutral-0 px-2 py-1">
              <button
                type="button"
                onClick={() => {
                  abertaRef.current = null;
                  setAberta(null);
                }}
                aria-label="Voltar para a lista"
                className="inline-flex h-[40px] w-[40px] items-center justify-center rounded-md text-neutral-600 hover:bg-neutral-100 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-primary-500 md:hidden"
              >
                <RotateCcw size={18} strokeWidth={1.7} aria-hidden className="rotate-90" />
              </button>
              <span
                aria-hidden
                className="flex h-[36px] w-[36px] shrink-0 items-center justify-center rounded-full text-sm font-semibold text-neutral-0"
                style={{ backgroundColor: corDe(aberta.nome) }}
              >
                {iniciaisDe(aberta.nome)}
              </span>
              <div className="min-w-0">
                <p className="truncate text-sm font-semibold text-neutral-900">
                  {aberta.nome}
                </p>
              </div>
              <div className="ml-auto flex items-center gap-1">
                <button
                  type="button"
                  disabled={acaoPendente.has(aberta.leadId)}
                  onClick={() => void despachar(aberta.leadId, "resolver")}
                  className="inline-flex h-[40px] items-center gap-0.5 rounded-full border border-neutral-200 bg-neutral-0 px-1.5 text-sm font-medium text-success hover:bg-success-bg focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-primary-500 disabled:opacity-50"
                >
                  <Check size={15} strokeWidth={2} aria-hidden /> Resolver
                </button>
                <button
                  type="button"
                  disabled={acaoPendente.has(aberta.leadId)}
                  onClick={() => void despachar(aberta.leadId, "adiar")}
                  className="inline-flex h-[40px] items-center gap-0.5 rounded-full border border-neutral-200 bg-neutral-0 px-1.5 text-sm font-medium text-neutral-800 hover:bg-neutral-100 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-primary-500 disabled:opacity-50"
                >
                  <Clock size={15} strokeWidth={1.7} aria-hidden /> Adiar
                </button>
                <button
                  ref={gatilhoPainelRef}
                  type="button"
                  title="Contexto do lead"
                  aria-label="Contexto do lead"
                  aria-expanded={painelAberto}
                  onClick={() => setPainelAberto((v) => !v)}
                  className={cn(
                    "inline-flex h-[40px] w-[40px] items-center justify-center rounded-full text-neutral-600 hover:bg-neutral-100 hover:text-neutral-800 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-primary-500 xl:hidden",
                    painelAberto && "bg-neutral-100 text-neutral-800",
                  )}
                  hidden={telaLarga}
                >
                  <PanelRight size={16} strokeWidth={1.7} aria-hidden />
                </button>
                <button
                  type="button"
                  title="Resumo da conversa pela IA"
                  aria-label="Resumo da conversa pela IA"
                  disabled={resumindo}
                  onClick={() => void pedirResumo()}
                  className={cn(
                    "inline-flex h-[40px] w-[40px] items-center justify-center rounded-full text-neutral-600 hover:bg-neutral-100 hover:text-primary-600 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-primary-500",
                    resumindo && "animate-pulse text-primary-600",
                  )}
                >
                  <Sparkles size={16} strokeWidth={1.7} aria-hidden />
                </button>
                {conversa?.ferramentas ? (
                  <FerramentasPalco
                    leadId={aberta.leadId}
                    nome={aberta.nome}
                    ferramentas={conversa.ferramentas}
                    aoMudar={recarregarConversaAberta}
                    aoMarcarNaoLida={() => marcarLinhaNaoLida(aberta.leadId)}
                  />
                ) : (
                  <Link
                    href={`/chat?lead=${aberta.leadId}`}
                    title="Abrir na tela antiga"
                    className="inline-flex h-[40px] w-[40px] items-center justify-center rounded-full text-neutral-600 hover:bg-neutral-100 hover:text-neutral-800 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-primary-500"
                  >
                    <ExternalLink size={16} strokeWidth={1.7} aria-hidden />
                  </Link>
                )}
              </div>
            </header>

            {resumo || resumindo ? (
              <div className="mx-2 mt-1 flex items-start gap-1 rounded-lg border border-neutral-200 border-l-2 border-l-primary-500 bg-neutral-0 px-1.5 py-1 text-sm shadow-sm">
                <Sparkles
                  size={14}
                  strokeWidth={1.7}
                  aria-hidden
                  className="mt-0.5 shrink-0 text-primary-600"
                />
                <p className={cn("min-w-0", resumo?.erro ? "text-danger" : "text-neutral-800")}>
                  {resumindo
                    ? "Resumindo a conversa…"
                    : (resumo?.texto ?? resumo?.erro)}
                </p>
                <button
                  type="button"
                  aria-label="Fechar resumo"
                  onClick={() => setResumo(null)}
                  className="-my-1 -mr-1 ml-auto inline-flex h-[40px] w-[40px] shrink-0 items-center justify-center rounded-md text-neutral-600 hover:bg-neutral-100 hover:text-neutral-800 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-primary-500"
                >
                  <X size={14} strokeWidth={2} aria-hidden />
                </button>
              </div>
            ) : null}

            {erroConversa ? (
              <p role="alert" className="m-2 rounded-md border border-danger bg-danger-bg px-1.5 py-1 text-sm text-danger">
                {erroConversa}
              </p>
            ) : carregandoConversa || !conversa ? (
              <p className="m-2 text-sm text-neutral-600">Abrindo a conversa…</p>
            ) : (
              <Janela
                leadId={aberta.leadId}
                temConversa={conversa.temConversa}
                mensagens={conversa.mensagens}
                mensagensPadrao={conversa.mensagensPadrao}
                templates={conversa.templates}
                restanteJanela={conversa.restanteJanela}
                urlMaisAntigas={null}
                marketingBloqueado={conversa.marketingBloqueado}
                hojeChave={conversa.hojeChave}
                ontemChave={conversa.ontemChave}
                aoEnviarComSucesso={() => {
                  // Respondeu: a linha sai da fila de espera local na hora.
                  setCarga((c) => ({
                    ...c,
                    linhas: c.linhas.map((l) =>
                      l.leadId === aberta.leadId
                        ? { ...l, esperaHoras: null, vez: "nos" }
                        : l,
                    ),
                  }));
                }}
              />
            )}
          </>
        )}
      </section>

      {/* ── contexto ── coluna fixa no desktop largo; folha por cima abaixo
          de xl, onde não cabem três colunas. */}
      {aberta ? (
        <>
          {telaLarga ? (
            <aside className="w-[320px] shrink-0 border-l border-neutral-200">
              <PainelContexto
                key={aberta.leadId}
                leadId={aberta.leadId}
                nome={aberta.nome}
                sinalRecarga={sinalContexto}
              />
            </aside>
          ) : null}
          {painelAberto && !telaLarga ? (
            <div
              role="dialog"
              aria-modal="true"
              aria-label={`Contexto de ${aberta.nome}`}
              className="fixed inset-0 z-40 flex justify-end bg-overlay"
              onClick={(e) => {
                if (e.target === e.currentTarget) fecharPainel();
              }}
            >
              <div className="h-full w-full max-w-[360px] border-l border-neutral-200 shadow-lg">
                <PainelContexto
                  key={aberta.leadId}
                  leadId={aberta.leadId}
                  nome={aberta.nome}
                  sinalRecarga={sinalContexto}
                  aoFechar={fecharPainel}
                />
              </div>
            </div>
          ) : null}
        </>
      ) : null}

      <TempoRealConversas
        leadAbertoId={aberta?.leadId ?? null}
        aoMensagemDoAberto={() => void recarregarConversaAberta()}
        aoMudancaNaLista={() => void recarregarLista(visao, escopo, busca)}
      />
      <PaletaComandos
        aberta={paletaAberta}
        aoFechar={() => setPaletaAberta(false)}
        temConversa={Boolean(aberta)}
        comandos={[
          {
            grupo: "Esta conversa",
            itens: [
              {
                rotulo: "Resolver e ir para a próxima",
                tecla: "E",
                precisaConversa: true,
                acao: () => {
                  if (aberta) void despachar(aberta.leadId, "resolver");
                },
              },
              {
                rotulo: "Adiar até amanhã e ir para a próxima",
                tecla: "H",
                precisaConversa: true,
                acao: () => {
                  if (aberta) void despachar(aberta.leadId, "adiar");
                },
              },
              {
                rotulo: "Resumo da conversa pela IA",
                tecla: "",
                precisaConversa: true,
                acao: () => void pedirResumo(),
              },
            ],
          },
          {
            grupo: "Ir para",
            itens: [
              { rotulo: "Caixa", tecla: "", acao: () => trocarVisao("caixa") },
              { rotulo: "Aguardando", tecla: "", acao: () => trocarVisao("aguardando") },
              { rotulo: "Adiadas", tecla: "", acao: () => trocarVisao("adiadas") },
              { rotulo: "Tudo (acervo e busca)", tecla: "", acao: () => trocarVisao("tudo") },
              { rotulo: "Próxima da fila", tecla: "J", acao: proxima },
            ],
          },
        ]}
      />
    </div>
  );
}

function LinhaLista({
  linha,
  aberta,
  hojeChave,
  pendente,
  aoAbrir,
  aoResolver,
  aoAdiar,
}: {
  linha: LinhaConversa;
  aberta: boolean;
  hojeChave: string;
  pendente: boolean;
  aoAbrir: () => void;
  aoResolver: () => void;
  aoAdiar: () => void;
}) {
  const espera = rotuloEspera(linha.esperaHoras);
  const critica = (linha.esperaHoras ?? 0) >= 24;
  const alta = !critica && (linha.esperaHoras ?? 0) >= 0.25;

  // Gesto do celular: arrastar a linha para a direita resolve, para a
  // esquerda adia — os dois gestos que a equipe faz o dia inteiro e que no
  // toque custavam mirar um alvo de 32px. Só com o dedo (pointer coarse);
  // no mouse continuam valendo os botões do hover.
  const [arrasto, setArrasto] = useState(0);
  const inicioRef = useRef<{ x: number; y: number; id: number } | null>(null);
  // O clique sintético chega DEPOIS do pointerup, quando o estado já voltou
  // a zero — só um ref segura a informação de que houve gesto.
  const arrastouRef = useRef(false);
  // Passou daqui, o gesto vale. Abaixo disso é toque, e toque abre.
  const LIMIAR = 72;
  const deslizando = arrasto !== 0;

  const aoSoltar = () => {
    const distancia = arrasto;
    inicioRef.current = null;
    setArrasto(0);
    if (Math.abs(distancia) >= 8) arrastouRef.current = true;
    if (distancia >= LIMIAR) aoResolver();
    else if (distancia <= -LIMIAR) aoAdiar();
  };

  return (
    <div className="relative overflow-hidden rounded-lg">
      {/* A pista que aparece atrás da linha enquanto o dedo arrasta: verde à
          esquerda (resolver), âmbar à direita (adiar). */}
      {arrasto !== 0 ? (
        <div
          aria-hidden
          className={cn(
            "absolute inset-0 flex items-center rounded-lg px-2 text-sm font-semibold",
            arrasto > 0
              ? "justify-start bg-success-bg text-success"
              : "justify-end bg-accent-100 text-accent-700",
          )}
        >
          {arrasto > 0 ? (
            <span className="inline-flex items-center gap-0.5">
              <Check size={16} strokeWidth={2} aria-hidden />
              {arrasto >= LIMIAR ? "Resolver" : "Arraste"}
            </span>
          ) : (
            <span className="inline-flex items-center gap-0.5">
              {arrasto <= -LIMIAR ? "Adiar" : "Arraste"}
              <Clock size={16} strokeWidth={1.7} aria-hidden />
            </span>
          )}
        </div>
      ) : null}
    <div
      className={cn(
        "group relative flex cursor-pointer touch-pan-y items-center gap-1.5 rounded-lg px-1 py-1",
        // Sem transição durante o arrasto: a linha precisa colar no dedo.
        deslizando ? "" : "transition-colors duration-[120ms]",
        aberta
          ? "bg-neutral-0 shadow-sm ring-1 ring-neutral-200"
          : "hover:bg-neutral-0",
        pendente && "opacity-50",
      )}
      style={arrasto !== 0 ? { transform: `translateX(${arrasto}px)` } : undefined}
      onPointerDown={(e) => {
        if (e.pointerType === "mouse" || pendente) return;
        inicioRef.current = { x: e.clientX, y: e.clientY, id: e.pointerId };
        arrastouRef.current = false;
      }}
      onPointerMove={(e) => {
        const inicio = inicioRef.current;
        if (!inicio || inicio.id !== e.pointerId) return;
        const dx = e.clientX - inicio.x;
        const dy = e.clientY - inicio.y;
        // Rolagem vertical vence: o dedo desce a lista muito mais do que
        // arrasta a linha.
        if (arrasto === 0 && Math.abs(dy) > Math.abs(dx)) {
          inicioRef.current = null;
          return;
        }
        if (arrasto === 0 && Math.abs(dx) < 8) return;
        if (arrasto === 0) {
          // Captura só AQUI, quando já se sabe que o gesto é horizontal:
          // capturar no pointerdown atrapalharia a rolagem da lista. Sem
          // ela, o dedo que sai da linha leva o pointerup embora e a linha
          // fica travada deslocada.
          try {
            e.currentTarget.setPointerCapture(e.pointerId);
          } catch {
            // navegador sem captura: o gesto ainda vale dentro da linha
          }
        }
        setArrasto(Math.max(-140, Math.min(140, dx)));
      }}
      onPointerUp={aoSoltar}
      onPointerCancel={() => {
        inicioRef.current = null;
        setArrasto(0);
      }}
      onClick={() => {
        // Arrastou: o clique que o navegador manda depois do gesto não pode
        // abrir a conversa.
        if (arrastouRef.current) {
          arrastouRef.current = false;
          return;
        }
        aoAbrir();
      }}
      role="button"
      tabIndex={0}
      onKeyDown={(e) => {
        // Espaço também abre: é o contrato de qualquer role="button".
        if (e.key === "Enter" || e.key === " ") {
          e.preventDefault();
          aoAbrir();
        }
      }}
    >
      <span className="relative shrink-0" aria-hidden>
        <span
          className={cn(
            "flex h-[44px] w-[44px] items-center justify-center rounded-full text-sm font-semibold text-neutral-0 ring-2 ring-offset-2 ring-offset-neutral-50",
            linha.janelaAberta ? "ring-success" : "ring-accent-500",
          )}
          style={{ backgroundColor: corDe(linha.nome) }}
          title={linha.janelaAberta ? "Janela de 24h aberta" : "Janela fechada — só template"}
        >
          {iniciaisDe(linha.nome)}
        </span>
      </span>
      <div className="min-w-0 flex-1">
        <div className="flex items-baseline gap-1">
          <span
            className={cn(
              "truncate text-sm text-neutral-900",
              linha.naoLida ? "font-semibold" : "font-medium",
            )}
          >
            {linha.nome}
          </span>
          <span className="ml-auto shrink-0">
            {linha.adiadaAte && !linha.adiadaVencida ? (
              <span className="font-mono text-[11px] text-neutral-400">
                volta {horaOuDia(linha.adiadaAte, hojeChave)}
              </span>
            ) : espera ? (
              <span
                className={cn(
                  "rounded-full px-1 py-0.5 font-mono text-xs font-semibold tabular-nums",
                  critica
                    ? "bg-danger-bg text-danger"
                    : alta
                      ? "bg-accent-100 text-accent-700"
                      : "bg-primary-50 text-primary-600",
                )}
              >
                {espera}
              </span>
            ) : (
              <span className="font-mono text-[11px] text-neutral-400">
                {horaOuDia(linha.ultimaEm, hojeChave)}
              </span>
            )}
          </span>
        </div>
        <div className="mt-[1px] flex items-center gap-0.5">
          {linha.vez === "nos" ? (
            <CheckCheck size={14} strokeWidth={1.7} aria-hidden className="shrink-0 text-neutral-400" />
          ) : null}
          <span
            className={cn(
              "truncate text-[13px]",
              linha.naoLida ? "text-neutral-800" : "text-neutral-600",
            )}
          >
            {linha.previa ?? (linha.telefone ? "" : linha.instagram ? `@${linha.instagram}` : "")}
          </span>
          {linha.naoLida ? (
            <span className="ml-auto inline-flex h-[18px] min-w-[18px] shrink-0 items-center justify-center rounded-full bg-primary-600 px-0.5 font-mono text-[10px] font-semibold text-neutral-0">
              1
            </span>
          ) : null}
        </div>
        {linha.sub ? (
          <p className="text-[10.5px] text-neutral-400">{linha.sub}</p>
        ) : null}
      </div>

      <div className="absolute top-1/2 right-1 hidden -translate-y-1/2 gap-0.5 rounded-lg border border-neutral-200 bg-neutral-0 p-0.5 shadow-sm group-hover:flex">
        <button
          type="button"
          aria-label={`Resolver conversa com ${linha.nome}`}
          disabled={pendente}
          onClick={(e) => {
            e.stopPropagation();
            aoResolver();
          }}
          className="inline-flex h-[40px] w-[40px] items-center justify-center rounded-md text-success hover:bg-success-bg focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-primary-500"
        >
          <Check size={15} strokeWidth={2} aria-hidden />
        </button>
        <button
          type="button"
          aria-label={`Adiar conversa com ${linha.nome} até amanhã`}
          disabled={pendente}
          onClick={(e) => {
            e.stopPropagation();
            aoAdiar();
          }}
          className="inline-flex h-[40px] w-[40px] items-center justify-center rounded-md text-neutral-600 hover:bg-neutral-100 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-primary-500"
        >
          <Clock size={15} strokeWidth={1.7} aria-hidden />
        </button>
      </div>
    </div>
    </div>
  );
}
