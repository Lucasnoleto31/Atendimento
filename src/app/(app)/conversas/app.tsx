"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import Link from "next/link";
import {
  ArrowDown,
  Check,
  CheckCheck,
  Clock,
  ExternalLink,
  Inbox,
  ListFilter,
  RotateCcw,
  Search,
  Timer,
} from "lucide-react";
import { cn } from "@/lib/utils";
import { Janela } from "@/app/(app)/chat/janela";
import {
  adiarConversa,
  alterarStatusConversaChat,
} from "@/app/(app)/chat/actions";
import { carregarConversa, type ConversaDoPainel } from "@/app/(app)/hoje/actions";
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
  const [acaoPendente, setAcaoPendente] = useState<string | null>(null);

  const pedidoRef = useRef(0);

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
      setAberta(linha);
      setConversa(null);
      setErroConversa(null);
      setCarregandoConversa(true);
      const r = await carregarConversa(linha.leadId);
      setCarregandoConversa(false);
      if ("erro" in r) setErroConversa(r.erro ?? "Não deu para abrir.");
      else setConversa(r);
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

  // Resolver/Adiar de 1 clique: a linha some da visão na hora (otimista) e
  // o servidor confirma; erro devolve a linha e avisa.
  const despachar = useCallback(
    async (leadId: string, acao: "resolver" | "adiar") => {
      setAcaoPendente(leadId);
      const r =
        acao === "resolver"
          ? await alterarStatusConversaChat(leadId, "resolved")
          : await adiarConversa(leadId, "amanha");
      setAcaoPendente(null);
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
    [visao, aberta, proxima],
  );

  // Atalho J: próxima da fila (desktop; no celular o gesto vem no Bloco C).
  useEffect(() => {
    const aoTeclar = (e: KeyboardEvent) => {
      const alvo = e.target as HTMLElement | null;
      if (
        alvo &&
        (alvo.tagName === "INPUT" ||
          alvo.tagName === "TEXTAREA" ||
          alvo.isContentEditable)
      ) {
        return;
      }
      if (e.key.toLowerCase() === "j") proxima();
    };
    window.addEventListener("keydown", aoTeclar);
    return () => window.removeEventListener("keydown", aoTeclar);
  }, [proxima]);

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
              className="ml-auto inline-flex h-[28px] items-center rounded-md border border-neutral-200 bg-neutral-0 px-1 text-xs font-medium text-neutral-600 hover:bg-neutral-100 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-primary-500"
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
                pendente={acaoPendente === l.leadId}
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
            className="inline-flex h-[32px] items-center gap-0.5 rounded-md bg-primary-50 px-1.5 text-xs font-semibold text-primary-600 hover:bg-primary-100 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-primary-500"
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
                onClick={() => setAberta(null)}
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
                  disabled={acaoPendente === aberta.leadId}
                  onClick={() => void despachar(aberta.leadId, "resolver")}
                  className="inline-flex h-[36px] items-center gap-0.5 rounded-full border border-neutral-200 bg-neutral-0 px-1.5 text-sm font-medium text-success hover:bg-success-bg focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-primary-500 disabled:opacity-50"
                >
                  <Check size={15} strokeWidth={2} aria-hidden /> Resolver
                </button>
                <button
                  type="button"
                  disabled={acaoPendente === aberta.leadId}
                  onClick={() => void despachar(aberta.leadId, "adiar")}
                  className="inline-flex h-[36px] items-center gap-0.5 rounded-full border border-neutral-200 bg-neutral-0 px-1.5 text-sm font-medium text-neutral-800 hover:bg-neutral-100 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-primary-500 disabled:opacity-50"
                >
                  <Clock size={15} strokeWidth={1.7} aria-hidden /> Adiar
                </button>
                <Link
                  href={`/chat?lead=${aberta.leadId}`}
                  title="Etapa, atendente, etiquetas, perdido — na tela completa (até o Bloco B)"
                  className="inline-flex h-[36px] w-[36px] items-center justify-center rounded-full text-neutral-400 hover:bg-neutral-100 hover:text-neutral-800 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-primary-500"
                >
                  <ExternalLink size={16} strokeWidth={1.7} aria-hidden />
                </Link>
              </div>
            </header>

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
  return (
    <div
      className={cn(
        "group relative flex cursor-pointer items-center gap-1.5 rounded-lg px-1 py-1 transition-colors duration-[120ms]",
        aberta
          ? "bg-neutral-0 shadow-sm ring-1 ring-neutral-200"
          : "hover:bg-neutral-0",
        pendente && "opacity-50",
      )}
      onClick={aoAbrir}
      role="button"
      tabIndex={0}
      onKeyDown={(e) => {
        if (e.key === "Enter") aoAbrir();
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
                  "rounded-full px-1 py-[2px] font-mono text-[11px] font-semibold tabular-nums",
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
          className="inline-flex h-[32px] w-[32px] items-center justify-center rounded-md text-success hover:bg-success-bg focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-primary-500"
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
          className="inline-flex h-[32px] w-[32px] items-center justify-center rounded-md text-neutral-600 hover:bg-neutral-100 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-primary-500"
        >
          <Clock size={15} strokeWidth={1.7} aria-hidden />
        </button>
      </div>
    </div>
  );
}
