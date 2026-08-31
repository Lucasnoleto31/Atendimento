"use client";

import {
  useEffect,
  useState,
  useSyncExternalStore,
  useTransition,
} from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { ArrowLeft, Clock, ExternalLink, X } from "lucide-react";
import { Janela } from "@/app/(app)/chat/janela";
import { cn } from "@/lib/utils";
import {
  carregarConversa,
  sonecarConversa,
  sonecarItem,
  type ConversaDoPainel,
} from "./actions";

/**
 * O painel de conversa da /hoje: a MESMA Janela do chat, aberta ao lado da
 * fila. A comunicação com as linhas (server components) é por uma store de
 * módulo — o painel monta uma vez e qualquer linha o abre sem prop drilling.
 */

type Pedido = { leadId: string; nome: string } | null;

let pedidoAtual: Pedido = null;
const ouvintes = new Set<() => void>();

function abrir(pedido: Pedido) {
  pedidoAtual = pedido;
  ouvintes.forEach((fn) => fn());
}

const store = {
  subscribe(fn: () => void) {
    ouvintes.add(fn);
    return () => ouvintes.delete(fn);
  },
  ler: () => pedidoAtual,
  lerNoServidor: () => null as Pedido,
};

/** A linha da fila que abre a conversa no painel. */
export function ItemConversa({
  leadId,
  nome,
  className,
  children,
}: {
  leadId: string;
  nome: string;
  className?: string;
  children: React.ReactNode;
}) {
  return (
    <button
      type="button"
      onClick={() => abrir({ leadId, nome })}
      className={cn("w-full text-left", className)}
    >
      {children}
    </button>
  );
}

/** Soneca: some da fila até amanhã de manhã. */
export function BotaoSoneca({
  tipo,
  alvo,
  pessoa,
}: {
  tipo: "conversa" | "ativacao" | "risco";
  alvo: string;
  pessoa: string;
}) {
  const router = useRouter();
  const [pendente, iniciar] = useTransition();
  const [erro, setErro] = useState<string | null>(null);

  return (
    <button
      type="button"
      disabled={pendente}
      title={erro ?? "Voltar amanhã — some da fila até amanhã de manhã"}
      aria-label="Voltar amanhã"
      onClick={(e) => {
        e.stopPropagation();
        setErro(null);
        iniciar(async () => {
          const r =
            tipo === "conversa"
              ? await sonecarConversa(alvo)
              : await sonecarItem(tipo, alvo, pessoa);
          if (r.erro) setErro(r.erro);
          else router.refresh();
        });
      }}
      className={cn(
        "inline-flex h-[32px] w-[32px] shrink-0 items-center justify-center rounded-md text-neutral-400 transition-colors duration-[120ms] hover:bg-neutral-100 hover:text-neutral-800 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-primary-500 disabled:cursor-not-allowed disabled:opacity-50",
        erro && "text-danger",
      )}
    >
      <Clock size={16} strokeWidth={1.5} aria-hidden />
    </button>
  );
}

/** O painel em si — montado uma vez no fim da página. */
export function PainelConversa() {
  const pedido = useSyncExternalStore(
    store.subscribe,
    store.ler,
    store.lerNoServidor,
  );
  const router = useRouter();
  const [dados, setDados] = useState<ConversaDoPainel | null>(null);
  const [erro, setErro] = useState<string | null>(null);
  const [, iniciar] = useTransition();

  // Troca de pedido zera o painel durante o render (padrão "estado derivado"),
  // e o efeito fica só com o trabalho externo: buscar a conversa.
  const [pedidoAnterior, setPedidoAnterior] = useState(pedido);
  if (pedido !== pedidoAnterior) {
    setPedidoAnterior(pedido);
    setDados(null);
    setErro(null);
  }

  useEffect(() => {
    if (!pedido) return;
    let vivo = true;
    iniciar(async () => {
      const r = await carregarConversa(pedido.leadId);
      if (!vivo) return;
      if ("erro" in r) setErro(r.erro);
      else setDados(r);
    });
    return () => {
      vivo = false;
    };
  }, [pedido]);

  useEffect(() => {
    if (!pedido) return;
    const aoTeclar = (e: KeyboardEvent) => {
      if (e.key === "Escape") abrir(null);
    };
    window.addEventListener("keydown", aoTeclar);
    return () => window.removeEventListener("keydown", aoTeclar);
  }, [pedido]);

  if (!pedido) return null;

  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-label={`Conversa com ${pedido.nome}`}
      className="fixed inset-0 z-50 flex justify-end bg-neutral-900/40"
      onClick={(e) => {
        if (e.target === e.currentTarget) abrir(null);
      }}
    >
      {/* No celular ocupa a tela; no desktop desliza pela direita. */}
      <div className="flex h-full w-full flex-col bg-neutral-50 shadow-lg sm:max-w-[560px] sm:border-l sm:border-neutral-200">
        <header className="flex h-[48px] shrink-0 items-center gap-1 border-b border-neutral-200 bg-neutral-0 px-1.5">
          <button
            type="button"
            onClick={() => abrir(null)}
            aria-label="Voltar para a fila"
            className="inline-flex h-[40px] w-[40px] items-center justify-center rounded-md text-neutral-600 transition-colors duration-[120ms] hover:bg-neutral-100 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-primary-500 sm:hidden"
          >
            <ArrowLeft size={18} strokeWidth={1.5} aria-hidden />
          </button>
          <p className="min-w-0 flex-1 truncate text-sm font-medium text-neutral-800">
            {pedido.nome}
          </p>
          <Link
            href={`/chat?lead=${pedido.leadId}`}
            className="inline-flex h-[32px] items-center gap-0.5 rounded-md px-1 text-xs font-medium text-neutral-600 transition-colors duration-[120ms] hover:bg-neutral-100 hover:text-neutral-800 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-primary-500"
          >
            <ExternalLink size={14} strokeWidth={1.5} aria-hidden />
            Abrir no Chat
          </Link>
          <button
            type="button"
            onClick={() => abrir(null)}
            aria-label="Fechar"
            className="hidden h-[40px] w-[40px] items-center justify-center rounded-md text-neutral-600 transition-colors duration-[120ms] hover:bg-neutral-100 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-primary-500 sm:inline-flex"
          >
            <X size={18} strokeWidth={1.5} aria-hidden />
          </button>
        </header>

        {erro ? (
          <p className="m-2 rounded-md border border-danger bg-danger-bg px-1.5 py-1 text-sm text-danger">
            {erro}
          </p>
        ) : dados === null ? (
          <p className="m-2 text-sm text-neutral-600">Carregando a conversa…</p>
        ) : (
          <Janela
            leadId={pedido.leadId}
            temConversa={dados.temConversa}
            mensagens={dados.mensagens}
            mensagensPadrao={dados.mensagensPadrao}
            templates={dados.templates}
            restanteJanela={dados.restanteJanela}
            marketingBloqueado={dados.marketingBloqueado}
            hojeChave={dados.hojeChave}
            ontemChave={dados.ontemChave}
            // Esta tela não tem tempo real próprio: a rede de segurança de
            // 60s da conversa aberta é o refresh daqui.
            aoRecarregarPeriodico={() => router.refresh()}
            aoEnviarComSucesso={() => {
              // A resposta saiu: a fila "Aguardando" se recalcula no servidor
              // e o item some — sem gambiarra de esconder linha no cliente.
              router.refresh();
            }}
          />
        )}
      </div>
    </div>
  );
}
