import type { Metadata } from "next";
import Link from "next/link";
import { ArrowLeft, Search, UserRound } from "lucide-react";
import { createClient } from "@/lib/supabase/server";
import { perfilAtual } from "@/lib/auth";
import { formatarTelefone } from "@/lib/format";
import { cn } from "@/lib/utils";
import { Janela, type Mensagem, type MensagemPadrao } from "./janela";
import { marcarChatLido } from "./actions";

export const metadata: Metadata = { title: "Chat · Zeve CRM" };

const FILTROS = [
  { chave: "todas", rotulo: "Todas" },
  { chave: "minhas", rotulo: "Minhas" },
  { chave: "naolidas", rotulo: "Não lidas" },
] as const;

type ChaveFiltro = (typeof FILTROS)[number]["chave"];

type ConversaLinha = {
  id: string;
  nome: string;
  telefone_e164: string | null;
  customer_id: string | null;
  responsavel_id: string | null;
  ultima_interacao_em: string | null;
  chat_lido_em: string | null;
  chatwoot_conversation_id: number | null;
};

function urlChat(filtro: ChaveFiltro, busca: string, leadId?: string) {
  const p = new URLSearchParams();
  if (filtro !== "todas") p.set("f", filtro);
  if (busca) p.set("q", busca);
  if (leadId) p.set("lead", leadId);
  const q = p.toString();
  return q ? `/chat?${q}` : "/chat";
}

export default async function ChatPage({ searchParams }: PageProps<"/chat">) {
  const params = await searchParams;
  const filtro = (
    FILTROS.some((f) => f.chave === params.f) ? params.f : "todas"
  ) as ChaveFiltro;
  const busca = typeof params.q === "string" ? params.q.trim() : "";
  const leadSelecionado = typeof params.lead === "string" ? params.lead : null;

  const perfil = await perfilAtual();
  const supabase = await createClient();

  let consulta = supabase
    .from("leads")
    .select(
      "id, nome, telefone_e164, customer_id, responsavel_id, ultima_interacao_em, chat_lido_em, chatwoot_conversation_id",
    )
    .not("chatwoot_conversation_id", "is", null)
    .order("ultima_interacao_em", { ascending: false, nullsFirst: false })
    .limit(100);

  if (filtro === "minhas" && perfil) {
    consulta = consulta.eq("responsavel_id", perfil.id);
  }
  if (busca) {
    const termo = busca.replace(/[,()]/g, " ").trim();
    const digitos = termo.replace(/\D/g, "");
    consulta =
      digitos.length >= 4
        ? consulta.or(`nome.ilike.%${termo}%,telefone_e164.ilike.%${digitos}%`)
        : consulta.ilike("nome", `%${termo}%`);
  }

  const { data: brutas } = await consulta;
  let conversas = (brutas ?? []) as ConversaLinha[];

  const naoLida = (c: ConversaLinha) =>
    c.ultima_interacao_em !== null &&
    (c.chat_lido_em === null || c.ultima_interacao_em > c.chat_lido_em);

  if (filtro === "naolidas") {
    conversas = conversas.filter(naoLida);
  }

  // Prévia da última mensagem, numa consulta só.
  const previas = new Map<string, string>();
  if (conversas.length > 0) {
    const { data: ultimas } = await supabase
      .from("lead_interactions")
      .select("lead_id, conteudo, criado_em")
      .in(
        "lead_id",
        conversas.map((c) => c.id),
      )
      .in("tipo", ["mensagem_recebida", "mensagem_enviada"])
      .order("criado_em", { ascending: false })
      .limit(300);

    for (const linha of (ultimas ?? []) as {
      lead_id: string;
      conteudo: string | null;
    }[]) {
      if (!previas.has(linha.lead_id)) {
        previas.set(linha.lead_id, linha.conteudo ?? "");
      }
    }
  }

  // Conversa aberta: mensagens + dados do lead; abrir marca como lida.
  const atual = leadSelecionado
    ? (conversas.find((c) => c.id === leadSelecionado) ??
      ((
        await supabase
          .from("leads")
          .select(
            "id, nome, telefone_e164, customer_id, responsavel_id, ultima_interacao_em, chat_lido_em, chatwoot_conversation_id",
          )
          .eq("id", leadSelecionado)
          .maybeSingle()
      ).data as ConversaLinha | null))
    : null;

  let mensagens: Mensagem[] = [];
  let mensagensPadrao: MensagemPadrao[] = [];

  if (atual) {
    if (naoLida(atual)) await marcarChatLido(atual.id);

    const [{ data: interacoes }, { data: padroes }] = await Promise.all([
      supabase
        .from("lead_interactions")
        .select("id, tipo, conteudo, criado_em, autor:profiles(nome)")
        .eq("lead_id", atual.id)
        .in("tipo", ["mensagem_recebida", "mensagem_enviada"])
        .order("criado_em", { ascending: true })
        .limit(300),
      supabase
        .from("quick_replies")
        .select("id, titulo, corpo")
        .eq("ativo", true)
        .order("titulo"),
    ]);

    mensagens = (
      (interacoes ?? []) as unknown as {
        id: string;
        tipo: Mensagem["tipo"];
        conteudo: string | null;
        criado_em: string;
        autor: { nome: string } | null;
      }[]
    ).map((m) => ({
      id: m.id,
      tipo: m.tipo,
      conteudo: m.conteudo,
      criado_em: m.criado_em,
      autor: m.autor?.nome ?? null,
    }));
    mensagensPadrao = (padroes ?? []) as MensagemPadrao[];
  }

  const horaCurta = (iso: string | null) => {
    if (!iso) return "";
    const data = new Date(iso);
    const hoje = new Date();
    return data.toDateString() === hoje.toDateString()
      ? data.toLocaleTimeString("pt-BR", { hour: "2-digit", minute: "2-digit" })
      : data.toLocaleDateString("pt-BR", { day: "2-digit", month: "2-digit" });
  };

  return (
    <div className="flex h-[calc(100dvh-64px)] min-h-0 lg:h-dvh">
      {/* Lista de conversas */}
      <aside
        className={cn(
          "w-full flex-col border-r border-neutral-200 bg-neutral-0 lg:flex lg:w-[320px] lg:shrink-0",
          atual ? "hidden" : "flex",
        )}
      >
        <div className="border-b border-neutral-200 p-1.5">
          <h1 className="px-0.5 text-h3 text-neutral-900">Chat</h1>

          <form action="/chat" method="get" className="mt-1 flex gap-1">
            {filtro !== "todas" ? (
              <input type="hidden" name="f" value={filtro} />
            ) : null}
            <label htmlFor="busca-chat" className="sr-only">
              Buscar conversa
            </label>
            <input
              id="busca-chat"
              name="q"
              defaultValue={busca}
              placeholder="Nome ou telefone…"
              className="h-[40px] min-w-0 flex-1 rounded-md border border-neutral-300 bg-neutral-0 px-1.5 text-sm text-neutral-800 placeholder:text-neutral-400 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-primary-500"
            />
            <button
              type="submit"
              aria-label="Buscar"
              className="inline-flex h-[40px] w-[40px] shrink-0 items-center justify-center rounded-md border border-neutral-300 text-neutral-600 transition-colors duration-[120ms] hover:bg-neutral-100 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-primary-500"
            >
              <Search size={18} strokeWidth={1.5} aria-hidden />
            </button>
          </form>

          <nav aria-label="Filtro de conversas" className="mt-1">
            <ul className="flex gap-0.5">
              {FILTROS.map((f) => {
                const ativo = f.chave === filtro;
                return (
                  <li key={f.chave}>
                    <Link
                      href={urlChat(f.chave, busca)}
                      aria-current={ativo ? "page" : undefined}
                      className={cn(
                        "inline-flex h-[32px] items-center rounded-md px-1.5 text-sm transition-colors duration-[120ms] focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-primary-500",
                        ativo
                          ? "bg-primary-50 font-medium text-primary-900"
                          : "text-neutral-600 hover:bg-neutral-100 hover:text-neutral-800",
                      )}
                    >
                      {f.rotulo}
                    </Link>
                  </li>
                );
              })}
            </ul>
          </nav>
        </div>

        <ul className="min-h-0 flex-1 divide-y divide-neutral-200 overflow-y-auto">
          {conversas.length === 0 ? (
            <li className="p-2 text-sm text-neutral-600">
              Nenhuma conversa aqui.
            </li>
          ) : (
            conversas.map((conversa) => {
              const selecionada = conversa.id === atual?.id;
              const pendente = naoLida(conversa) && !selecionada;
              return (
                <li key={conversa.id}>
                  <Link
                    href={urlChat(filtro, busca, conversa.id)}
                    aria-current={selecionada ? "true" : undefined}
                    className={cn(
                      "flex items-center gap-1 px-1.5 py-1 transition-colors duration-[120ms] focus-visible:outline-2 focus-visible:-outline-offset-2 focus-visible:outline-primary-500",
                      selecionada
                        ? "border-l-2 border-primary-600 bg-primary-50"
                        : "border-l-2 border-transparent hover:bg-neutral-50",
                    )}
                  >
                    <span
                      aria-hidden
                      className="flex h-[40px] w-[40px] shrink-0 items-center justify-center rounded-md bg-neutral-100 font-mono text-sm text-neutral-600"
                    >
                      {conversa.nome.slice(0, 2).toUpperCase()}
                    </span>
                    <span className="min-w-0 flex-1">
                      <span className="flex items-baseline justify-between gap-1">
                        <span
                          className={cn(
                            "truncate text-sm text-neutral-800",
                            pendente ? "font-semibold" : "font-medium",
                          )}
                        >
                          {conversa.nome}
                        </span>
                        <span className="shrink-0 font-mono text-xs text-neutral-400 tabular-nums">
                          {horaCurta(conversa.ultima_interacao_em)}
                        </span>
                      </span>
                      <span className="flex items-center justify-between gap-1">
                        <span
                          className={cn(
                            "truncate text-xs",
                            pendente
                              ? "font-medium text-neutral-800"
                              : "text-neutral-600",
                          )}
                        >
                          {previas.get(conversa.id) ?? "—"}
                        </span>
                        {pendente ? (
                          <span
                            aria-label="Mensagens não lidas"
                            className="h-1 w-1 shrink-0 rounded-full bg-primary-600"
                          />
                        ) : null}
                      </span>
                    </span>
                  </Link>
                </li>
              );
            })
          )}
        </ul>
      </aside>

      {/* Janela da conversa */}
      <section
        aria-label="Conversa"
        className={cn(
          "min-w-0 flex-1 flex-col lg:flex",
          atual ? "flex" : "hidden",
        )}
      >
        {atual ? (
          <>
            <header className="flex items-center gap-1 border-b border-neutral-200 bg-neutral-0 px-1.5 py-1">
              <Link
                href={urlChat(filtro, busca)}
                aria-label="Voltar para a lista"
                className="inline-flex h-[40px] w-[40px] items-center justify-center rounded-md text-neutral-600 hover:bg-neutral-100 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-primary-500 lg:hidden"
              >
                <ArrowLeft size={18} strokeWidth={1.5} aria-hidden />
              </Link>
              <div className="min-w-0 flex-1">
                <p className="truncate text-sm font-semibold text-neutral-900">
                  {atual.nome}
                </p>
                <p className="font-mono text-xs text-neutral-600 tabular-nums">
                  {atual.telefone_e164
                    ? formatarTelefone(atual.telefone_e164)
                    : "sem telefone"}
                </p>
              </div>
              <span
                className={cn(
                  "inline-flex h-[20px] shrink-0 items-center rounded-sm px-1 text-xs",
                  atual.customer_id
                    ? "bg-success-bg text-success"
                    : "bg-neutral-100 text-neutral-600",
                )}
              >
                {atual.customer_id ? "Cliente" : "Não cliente"}
              </span>
              <Link
                href={`/leads/${atual.id}`}
                className="inline-flex h-[32px] shrink-0 items-center gap-0.5 rounded-md border border-neutral-300 bg-neutral-0 px-1.5 text-xs font-medium text-neutral-800 transition-colors duration-[120ms] hover:bg-neutral-100 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-primary-500"
              >
                <UserRound size={14} strokeWidth={1.5} aria-hidden />
                Ficha
              </Link>
            </header>

            <Janela
              leadId={atual.id}
              temConversa={atual.chatwoot_conversation_id !== null}
              mensagens={mensagens}
              mensagensPadrao={mensagensPadrao}
            />
          </>
        ) : (
          <div className="hidden flex-1 items-center justify-center lg:flex">
            <p className="text-sm text-neutral-600">
              Escolha uma conversa na lista.
            </p>
          </div>
        )}
      </section>
    </div>
  );
}
