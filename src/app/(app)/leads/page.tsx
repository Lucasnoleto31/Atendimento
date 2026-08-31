import type { Metadata } from "next";
import Link from "next/link";
import { Download, MessageSquare, Plus, Search, X } from "lucide-react";
import { createClient } from "@/lib/supabase/server";
import { perfilAtual } from "@/lib/auth";
import { formatarData, formatarTelefone, tempoDesde } from "@/lib/format";
import {
  listarTemplatesMeta,
  metaConfigurada,
  type TemplateWhatsapp,
} from "@/lib/whatsapp";
import { Button } from "@/components/ui/button";
import { DistribuirLeads } from "./distribuir";
import { DispararTemplate } from "./disparar-template";
import { cn } from "@/lib/utils";
import { LISTAS_DISPARO } from "@/lib/listas-leads";

export const metadata: Metadata = { title: "Leads · Zeve CRM" };

const POR_PAGINA = 50;

/**
 * As listas que a equipe trabalha. Cada uma é um filtro booleano na view
 * v_leads_listas (migração 0032) — nada é calculado na página.
 *
 * O princípio: lista tem que caber num dia de trabalho e disparar UMA decisão.
 * Balde gigante ("nunca giraram: 1.248") não é fila, é relatório; por isso a
 * massa parada é fatiada por tempo de conta, e o que é campanha fica marcado
 * como campanha em vez de virar lista de telefone.
 */
type DefLista = {
  chave: string;
  rotulo: string;
  /** Coluna booleana da view que define a lista. */
  coluna?: string;
  /** Explicação curta que aparece quando a lista está aberta. */
  ajuda: string;
  /** Destaque visual: dinheiro escorrendo ou cliente esperando. */
  urgente?: boolean;
  /** Vazia é sinal de saúde, não de tela quebrada. */
  vaziaOk?: boolean;
  /** Coluna de ordenação e direção dentro da lista. */
  ordem?: { coluna: string; ascendente: boolean };
};

const GRUPOS: { titulo: string; descricao: string; listas: DefLista[] }[] = [
  {
    titulo: "Agir agora",
    descricao: "A fila do dia — esvazia conforme a equipe trabalha.",
    listas: [
      {
        chave: "aguardando",
        rotulo: "Aguardando resposta",
        coluna: "aguardando_resposta",
        ajuda:
          "O cliente mandou a última mensagem e ninguém voltou. Quem espera há mais tempo vem primeiro.",
        urgente: true,
        vaziaOk: true,
        ordem: { coluna: "ultima_mensagem_em", ascendente: true },
      },
      {
        chave: "janela_aberta",
        rotulo: "Janela de 24h aberta",
        coluna: "janela_aberta",
        ajuda:
          "Responderam nas últimas 24h: dá para mandar mensagem livre agora. Passou disso, só template aprovado chega.",
        urgente: true,
        ordem: { coluna: "ultima_recebida_em", ascendente: true },
      },
      {
        chave: "adiado_vencido",
        rotulo: "Adiados sem volta",
        coluna: "adiado_vencido",
        ajuda:
          "O prazo do adiamento venceu: já voltaram para a caixa do chat e ninguém retomou.",
        vaziaOk: true,
        ordem: { coluna: "ultima_interacao_em", ascendente: true },
      },
      {
        chave: "responderam_sem_conta",
        rotulo: "Responderam, sem conta",
        coluna: "quente_sem_conta",
        ajuda:
          "Já conversaram com a mesa e ainda não abriram conta na Genial. É o lead mais quente que existe.",
        ordem: { coluna: "ultima_interacao_em", ascendente: false },
      },
    ],
  },
  {
    titulo: "Abrir o primeiro giro",
    descricao:
      "Conta aberta que nunca operou. A receita só começa no primeiro lote — é a maior massa parada da empresa.",
    listas: [
      {
        chave: "primeiro_giro",
        rotulo: "Conta nova sem giro",
        coluna: "primeiro_giro_recente",
        ajuda:
          "Abriram conta nos últimos 90 dias e não operaram nenhum lote. Janela curta: isto é telefone, não campanha.",
        urgente: true,
        ordem: { coluna: "conta_aberta_em", ascendente: false },
      },
      {
        chave: "sem_giro_ja_conversou",
        rotulo: "Já conversou, nunca girou",
        coluna: "sem_giro_ja_conversou",
        ajuda:
          "Tem conta, já respondeu a mesa em algum momento, mas nunca operou. Retomar uma conversa que já existiu é mais barato que abrir uma nova.",
        ordem: { coluna: "ultima_interacao_em", ascendente: false },
      },
      {
        chave: "primeiro_giro_parado",
        rotulo: "Parados há +90 dias",
        coluna: "primeiro_giro_dormente",
        ajuda:
          "Abriram conta há mais de 90 dias e nunca operaram. Volume grande demais para telefone: marque com etiqueta e deixe a campanha trabalhar no ritmo diário.",
        ordem: { coluna: "conta_aberta_em", ascendente: false },
      },
    ],
  },
  {
    titulo: "Manter girando",
    descricao: "Quem já gera receita — e quem está prestes a parar de gerar.",
    listas: [
      {
        chave: "giro_em_risco",
        rotulo: "Giro em risco",
        coluna: "giro_em_risco",
        ajuda:
          "Caíram mais de 25% de volume ou zeraram nos últimos 30 dias. Receita escorrendo agora.",
        urgente: true,
        vaziaOk: true,
        ordem: { coluna: "lotes_30d_anterior", ascendente: false },
      },
      {
        chave: "girando",
        rotulo: "Girando",
        coluna: "girando",
        ajuda:
          "Operaram nos últimos 30 dias. Carteira viva: relacionamento, não resgate.",
        ordem: { coluna: "lotes_30d", ascendente: false },
      },
    ],
  },
  {
    titulo: "Organizar a base",
    descricao: "Higiene e matéria-prima para as campanhas.",
    listas: [
      {
        chave: "sem_dono",
        rotulo: "Sem dono",
        coluna: "sem_dono",
        ajuda:
          "Ninguém é responsável por estes leads. Use Distribuir para dividir entre a equipe.",
        ordem: { coluna: "criado_em", ascendente: false },
      },
      {
        chave: "nunca_contatado",
        rotulo: "Nunca contatados",
        coluna: "nunca_contatado",
        ajuda:
          "Nenhuma mensagem trocada. É o público das campanhas — etiquete e deixe o disparo diário trabalhar.",
        ordem: { coluna: "criado_em", ascendente: false },
      },
      {
        chave: "nao_contatavel",
        rotulo: "Não dá para contatar",
        coluna: "nao_contatavel",
        ajuda:
          "Sem telefone ou desativaram marketing no WhatsApp. Complete o número na ficha em Carteira; quem recusou marketing só recebe se responder primeiro.",
        vaziaOk: true,
        ordem: { coluna: "criado_em", ascendente: false },
      },
      {
        chave: "todos",
        rotulo: "Todos",
        ajuda: "A base inteira, sem filtro. Serve para busca e exportação.",
        ordem: { coluna: "criado_em", ascendente: false },
      },
    ],
  },
];

const TODAS_LISTAS = GRUPOS.flatMap((g) => g.listas);

// Nestas listas o assunto é lote operado; nas outras, o que importa é quando
// foi o último contato. Mostrar as três colunas sempre só empurraria a tabela
// para a rolagem lateral.
const LISTAS_COM_GIRO = new Set(
  GRUPOS.filter((g) =>
    g.titulo === "Abrir o primeiro giro" || g.titulo === "Manter girando",
  ).flatMap((g) => g.listas.map((l) => l.chave)),
);

const CAMPOS_VIEW =
  "lead_id, nome, telefone_e164, status, criado_em, customer_id, campanha, " +
  "responsavel_nome, canal_nome, etapa_nome, ultima_interacao_em, " +
  "lotes_30d, ultimo_giro_em, conta_aberta_em, dias_conta_aberta, " +
  "ultima_mensagem_em, ultima_recebida_em, horas_esperando, sem_dono, " +
  "primeira_resposta_em";

type Linha = {
  lead_id: string;
  nome: string;
  telefone_e164: string | null;
  status: string;
  criado_em: string;
  customer_id: string | null;
  campanha: string | null;
  responsavel_nome: string | null;
  canal_nome: string | null;
  etapa_nome: string | null;
  ultima_interacao_em: string | null;
  lotes_30d: number | null;
  ultimo_giro_em: string | null;
  conta_aberta_em: string | null;
  dias_conta_aberta: number | null;
  ultima_mensagem_em: string | null;
  ultima_recebida_em: string | null;
  horas_esperando: number | null;
  sem_dono: boolean | null;
  primeira_resposta_em: string | null;
};

/**
 * Lista, busca e etiqueta são filtros independentes que se combinam: trocar de
 * lista não pode derrubar a etiqueta escolhida, senão medir uma campanha ao
 * longo do funil vira reescolher o filtro a cada clique.
 */
function urlLeads(
  lista: string,
  busca: string,
  etiqueta: string,
  pagina = 1,
) {
  const p = new URLSearchParams();
  if (lista !== "todos") p.set("lista", lista);
  if (busca) p.set("busca", busca);
  if (etiqueta) p.set("etiqueta", etiqueta);
  if (pagina > 1) p.set("pagina", String(pagina));
  const q = p.toString();
  return q ? `/leads?${q}` : "/leads";
}

export default async function LeadsPage({ searchParams }: PageProps<"/leads">) {
  const params = await searchParams;
  const listaAtiva =
    typeof params.lista === "string" &&
    TODAS_LISTAS.some((l) => l.chave === params.lista)
      ? params.lista
      : "todos";
  const def =
    TODAS_LISTAS.find((l) => l.chave === listaAtiva) ?? TODAS_LISTAS[0];
  const busca = typeof params.busca === "string" ? params.busca.trim() : "";
  const etiqueta =
    typeof params.etiqueta === "string" && params.etiqueta ? params.etiqueta : "";
  const pagina = Math.max(1, Number(params.pagina) || 1);
  const aviso = typeof params.aviso === "string" ? params.aviso : null;

  const supabase = await createClient();
  const perfil = await perfilAtual();
  const ehGestor = perfil?.papel === "admin" || perfil?.papel === "gestor";

  /**
   * Toda lista é o mesmo desenho: a view v_leads_listas com um filtro
   * booleano. Sem ramo especial por lista, sem cálculo na página.
   */
  function consulta(chave: string, modo: "dados" | "contagem") {
    const alvo = TODAS_LISTAS.find((l) => l.chave === chave);
    // eslint-disable-next-line @typescript-eslint/no-explicit-any -- corta a recursão de tipos do builder
    let q: any =
      modo === "contagem"
        ? supabase
            .from("v_leads_listas")
            .select("lead_id", { count: "exact", head: true })
        : supabase.from("v_leads_listas").select(CAMPOS_VIEW, { count: "exact" });

    if (alvo?.coluna) q = q.eq(alvo.coluna, true);

    // Etiqueta entra nos dois modos de propósito: com uma campanha escolhida,
    // o número em cada aba passa a ser "quantos desta campanha estão aqui" —
    // que é a pergunta que se faz olhando a tela.
    if (etiqueta) q = q.contains("etiqueta_ids", [etiqueta]);

    if (modo === "dados" && busca) {
      // Vírgula e parênteses quebram a sintaxe do .or() do PostgREST.
      const termo = busca.replace(/[,()]/g, " ").trim();
      const digitos = termo.replace(/\D/g, "");
      q =
        digitos.length >= 4
          ? q.or(`nome.ilike.%${termo}%,telefone_e164.ilike.%${digitos}%`)
          : q.ilike("nome", `%${termo}%`);
    }
    return q;
  }

  const de = (pagina - 1) * POR_PAGINA;

  const ordem = def.ordem ?? { coluna: "criado_em", ascendente: false };

  const [
    { data, count, error },
    { count: semResponsavel },
    { count: equipeAtiva },
    { data: tags },
    ...contagens
  ] = await Promise.all([
    consulta(listaAtiva, "dados")
      // nullsFirst=false: linha sem a data de ordenação vai para o fim em vez
      // de encabeçar a fila (ex.: cliente sem data de abertura de conta).
      .order(ordem.coluna, { ascending: ordem.ascendente, nullsFirst: false })
      .range(de, de + POR_PAGINA - 1),
    supabase
      .from("leads")
      .select("id", { count: "exact", head: true })
      .is("responsavel_id", null),
    supabase
      .from("profiles")
      .select("id", { count: "exact", head: true })
      .eq("ativo", true),
    supabase
      .from("v_tags_uso")
      .select("id, nome, leads")
      .eq("ativo", true)
      .order("nome"),
    ...TODAS_LISTAS.map(async (l) => {
      const { count: total } = await consulta(l.chave, "contagem");
      return { chave: l.chave, total: total ?? 0 };
    }),
  ]);

  const templatesDisparo =
    ehGestor && LISTAS_DISPARO.has(listaAtiva)
      ? await (metaConfigurada()
          ? listarTemplatesMeta()
          : Promise.resolve([] as TemplateWhatsapp[])
        ).catch(() => [] as TemplateWhatsapp[])
      : [];

  const linhas = (data ?? []) as unknown as Linha[];
  const total = count ?? 0;
  const totalPaginas = Math.max(1, Math.ceil(total / POR_PAGINA));
  const totalPorLista = new Map(contagens.map((c) => [c.chave, c.total]));
  const etiquetas = (tags ?? []) as { id: string; nome: string; leads: number }[];
  const etiquetaAtiva = etiquetas.find((t) => t.id === etiqueta) ?? null;

  return (
    <div className="flex min-h-full flex-col p-2 md:p-3">
      <header className="flex flex-wrap items-start justify-between gap-2 border-b border-neutral-200 pb-2">
        <div>
          <h1 className="text-h1 text-neutral-900">Leads</h1>
          <p className="mt-1 text-sm text-neutral-600">
            As listas que a equipe trabalha, cruzadas com o giro de lotes da base.
          </p>
        </div>
        <div className="flex flex-wrap items-start gap-1">
          {ehGestor ? (
            <DistribuirLeads
              semResponsavel={semResponsavel ?? 0}
              equipe={equipeAtiva ?? 0}
            />
          ) : null}
          <Button href="/leads/novo" size="md">
            <Plus size={18} strokeWidth={1.5} aria-hidden />
            Novo lead
          </Button>
        </div>
      </header>

      {aviso ? (
        <p
          role="status"
          className="mt-2 max-w-[68ch] rounded-md border border-neutral-200 bg-neutral-50 px-1.5 py-1 text-sm text-neutral-800"
        >
          {aviso}
        </p>
      ) : null}

      {GRUPOS.map((grupo) => (
        <nav aria-label={grupo.titulo} key={grupo.titulo} className="mt-2">
          <p className="text-xs font-medium tracking-[0.06em] text-neutral-400 uppercase">
            {grupo.titulo}
          </p>
          <ul className="mt-0.5 flex flex-wrap gap-1">
            {grupo.listas.map((l) => {
              const ativa = l.chave === listaAtiva;
              const qtd = totalPorLista.get(l.chave) ?? 0;
              // Urgente com fila é o que a equipe tem que ver primeiro; a
              // mesma lista zerada é boa notícia e volta a ser discreta.
              const chamar = Boolean(l.urgente) && qtd > 0 && !ativa;
              return (
                <li key={l.chave}>
                  <Link
                    href={urlLeads(l.chave, busca, etiqueta)}
                    aria-current={ativa ? "page" : undefined}
                    className={cn(
                      "inline-flex h-[32px] items-center gap-1 rounded-md px-1.5 text-sm transition-colors duration-[120ms] focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-primary-500",
                      ativa
                        ? "bg-primary-50 font-medium text-primary-900"
                        : chamar
                          ? "bg-warning-bg font-medium text-warning hover:brightness-95"
                          : "text-neutral-600 hover:bg-neutral-100 hover:text-neutral-800",
                    )}
                  >
                    {l.rotulo}
                    <span
                      className={cn(
                        "font-mono text-xs tabular-nums",
                        ativa
                          ? "text-primary-600"
                          : chamar
                            ? "text-warning"
                            : "text-neutral-400",
                      )}
                    >
                      {qtd}
                    </span>
                  </Link>
                </li>
              );
            })}
          </ul>
        </nav>
      ))}

      <p className="mt-2 max-w-[68ch] text-sm text-neutral-600">{def.ajuda}</p>

      <form
        action="/leads"
        method="get"
        className="mt-2 flex flex-wrap items-center gap-1"
      >
        {listaAtiva !== "todos" ? (
          <input type="hidden" name="lista" value={listaAtiva} />
        ) : null}

        <label htmlFor="etiqueta" className="sr-only">
          Filtrar por etiqueta
        </label>
        <select
          id="etiqueta"
          name="etiqueta"
          defaultValue={etiqueta}
          className="h-[40px] max-w-[260px] rounded-md border border-neutral-300 bg-neutral-0 px-1 text-sm text-neutral-800 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-primary-500"
        >
          <option value="">Todas as etiquetas</option>
          {etiquetas.map((t) => (
            <option key={t.id} value={t.id}>
              {t.nome} ({t.leads})
            </option>
          ))}
        </select>

        <label htmlFor="busca" className="sr-only">
          Buscar por nome ou telefone
        </label>
        <input
          id="busca"
          name="busca"
          defaultValue={busca}
          placeholder="Nome ou telefone…"
          className="h-[40px] w-[220px] min-w-0 rounded-md border border-neutral-300 bg-neutral-0 px-1.5 text-base text-neutral-800 placeholder:text-neutral-400 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-primary-500"
        />
        <button
          type="submit"
          className="inline-flex h-[40px] items-center gap-0.5 rounded-md border border-neutral-300 bg-neutral-0 px-1.5 text-sm font-medium text-neutral-800 transition-colors duration-[120ms] hover:bg-neutral-100 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-primary-500"
        >
          <Search size={18} strokeWidth={1.5} aria-hidden />
          Filtrar
        </button>

        {/* Filtro ativo tem que ser visível fora do <select>: número de aba
            menor do que a pessoa espera é confuso quando o motivo está
            escondido dentro de uma caixa fechada. */}
        {etiquetaAtiva ? (
          <Link
            href={urlLeads(listaAtiva, busca, "")}
            className="inline-flex h-[40px] items-center gap-0.5 rounded-md bg-primary-50 px-1.5 text-sm font-medium text-primary-900 transition-colors duration-[120ms] hover:brightness-95 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-primary-500"
          >
            {etiquetaAtiva.nome}
            <X size={16} strokeWidth={1.5} aria-hidden />
            <span className="sr-only">Remover filtro de etiqueta</span>
          </Link>
        ) : null}
      </form>

      <div className="mt-2 flex flex-wrap items-center gap-1">
        {ehGestor && LISTAS_DISPARO.has(listaAtiva) ? (
          <DispararTemplate
            lista={listaAtiva}
            rotuloLista={
              etiquetaAtiva
                ? `${def.rotulo} · ${etiquetaAtiva.nome}`
                : def.rotulo
            }
            etiqueta={etiqueta}
            total={total}
            templates={templatesDisparo}
          />
        ) : null}
        <a
          href={`/api/exportar/leads?lista=${listaAtiva}${busca ? `&busca=${encodeURIComponent(busca)}` : ""}${etiqueta ? `&etiqueta=${etiqueta}` : ""}`}
          download
          className="inline-flex h-[40px] items-center gap-0.5 rounded-md border border-neutral-300 bg-neutral-0 px-2 text-sm font-medium text-neutral-800 transition-colors duration-[120ms] hover:bg-neutral-100 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-primary-500"
        >
          <Download size={18} strokeWidth={1.5} aria-hidden />
          Exportar CSV
        </a>
      </div>

      {error ? (
        <p
          role="alert"
          className="mt-2 max-w-[68ch] rounded-md border border-danger bg-danger-bg px-1.5 py-1 text-sm text-danger"
        >
          Rode a migração 0032 no SQL Editor do Supabase para as listas
          funcionarem — ela cria a view que alimenta esta tela.
        </p>
      ) : linhas.length === 0 ? (
        <div className="mt-3 max-w-[68ch] rounded-lg border border-neutral-200 bg-neutral-0 p-3 shadow-sm">
          <h2 className="text-h3 text-neutral-900">
            {busca
              ? "Nada encontrado"
              : def.vaziaOk
                ? "Tudo em dia"
                : "Lista vazia"}
          </h2>
          <p className="mt-1 text-sm text-neutral-600">
            {busca
              ? "Nenhum lead corresponde à busca nesta lista."
              : etiquetaAtiva
                ? `Nenhum lead com a etiqueta "${etiquetaAtiva.nome}" está nesta lista.`
                : def.vaziaOk
                  ? // Lista de urgência vazia é o objetivo, não tela quebrada.
                    "Nenhum caso pendente nesta fila — é o resultado esperado."
                  : "Nenhum lead se encaixa nesta lista no momento."}
          </p>
        </div>
      ) : (
        <>
          <div className="mt-2 overflow-x-auto rounded-lg border border-neutral-200 bg-neutral-0 shadow-sm">
            <table className="w-full min-w-[880px] border-collapse text-left">
              <thead>
                <tr className="border-b border-neutral-200 bg-neutral-50">
                  <Th>Lead</Th>
                  <Th>Situação</Th>
                  <Th>Origem</Th>
                  <Th>Etapa</Th>
                  {!LISTAS_COM_GIRO.has(listaAtiva) ? (
                    <Th alinhar="right">Último contato</Th>
                  ) : (
                    <>
                      <Th alinhar="right">Lotes 30d</Th>
                      <Th alinhar="right">Último giro</Th>
                    </>
                  )}
                  <Th>Responsável</Th>
                  <Th>
                    <span className="sr-only">Ações</span>
                  </Th>
                </tr>
              </thead>
              <tbody className="divide-y divide-neutral-200">
                {linhas.map((linha) => (
                  <tr key={linha.lead_id} className="h-[48px] hover:bg-neutral-50">
                    <td className="px-2">
                      <Link
                        href={`/leads/${linha.lead_id}`}
                        className="block max-w-[280px] truncate rounded-sm text-sm font-medium text-neutral-800 underline-offset-2 hover:text-primary-600 hover:underline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-primary-500"
                      >
                        {linha.nome}
                      </Link>
                      <span className="block font-mono text-xs text-neutral-600 tabular-nums">
                        {linha.telefone_e164
                          ? formatarTelefone(linha.telefone_e164)
                          : "sem telefone"}
                      </span>
                    </td>
                    <td className="px-2">
                      <span
                        className={cn(
                          "inline-flex h-[20px] items-center rounded-sm px-1 text-xs",
                          linha.customer_id
                            ? "bg-success-bg text-success"
                            : "bg-neutral-100 text-neutral-600",
                        )}
                      >
                        {linha.customer_id ? "Cliente" : "Não cliente"}
                      </span>
                      {linha.primeira_resposta_em === null ? (
                        <span className="mt-0.5 block text-xs text-neutral-400">
                          nunca respondeu
                        </span>
                      ) : null}
                    </td>
                    <td className="max-w-[200px] truncate px-2 text-sm text-neutral-600">
                      {linha.canal_nome ?? "—"}
                      {linha.campanha ? ` · ${linha.campanha}` : ""}
                    </td>
                    <td className="px-2 text-sm text-neutral-600">
                      {linha.etapa_nome ?? "—"}
                    </td>
                    {!LISTAS_COM_GIRO.has(listaAtiva) ? (
                      <td className="px-2 text-right font-mono text-sm text-neutral-800 tabular-nums">
                        {linha.ultima_interacao_em
                          ? tempoDesde(linha.ultima_interacao_em)
                          : "nunca"}
                      </td>
                    ) : (
                      <>
                        <td className="px-2 text-right font-mono text-sm text-neutral-800 tabular-nums">
                          {linha.customer_id ? (linha.lotes_30d ?? 0) : "—"}
                        </td>
                        <td className="px-2 text-right font-mono text-sm text-neutral-600 tabular-nums">
                          {formatarData(linha.ultimo_giro_em)}
                        </td>
                      </>
                    )}
                    <td className="max-w-[160px] truncate px-2 text-sm text-neutral-600">
                      {linha.responsavel_nome ?? "—"}
                    </td>
                    <td className="px-2">
                      <Link
                        href={`/chat?lead=${linha.lead_id}`}
                        aria-label={`Abrir conversa com ${linha.nome} no chat`}
                        title="Abrir no chat"
                        className="inline-flex h-[32px] w-[32px] items-center justify-center rounded-md text-neutral-600 transition-colors duration-[120ms] hover:bg-neutral-100 hover:text-primary-600 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-primary-500"
                      >
                        <MessageSquare size={16} strokeWidth={1.5} aria-hidden />
                      </Link>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>

          <div className="mt-2 flex items-center justify-between gap-2">
            <p className="text-sm text-neutral-600">
              <span className="font-mono tabular-nums">{total}</span> lead(s) ·
              página{" "}
              <span className="font-mono tabular-nums">
                {pagina}/{totalPaginas}
              </span>
            </p>
            <div className="flex gap-1">
              <PaginaLink
                rotulo="Anterior"
                desabilitado={pagina <= 1}
                href={urlLeads(listaAtiva, busca, etiqueta, pagina - 1)}
              />
              <PaginaLink
                rotulo="Próxima"
                desabilitado={pagina >= totalPaginas}
                href={urlLeads(listaAtiva, busca, etiqueta, pagina + 1)}
              />
            </div>
          </div>
        </>
      )}
    </div>
  );
}

function Th({
  children,
  alinhar,
}: {
  children: React.ReactNode;
  alinhar?: "right";
}) {
  return (
    <th
      scope="col"
      className={cn(
        "px-2 py-1 text-xs tracking-[0.06em] text-neutral-600 uppercase",
        alinhar === "right" && "text-right",
      )}
    >
      {children}
    </th>
  );
}

function PaginaLink({
  rotulo,
  href,
  desabilitado,
}: {
  rotulo: string;
  href: string;
  desabilitado: boolean;
}) {
  if (desabilitado) {
    return (
      <span className="inline-flex h-[32px] items-center rounded-md border border-neutral-200 px-1.5 text-sm text-neutral-400">
        {rotulo}
      </span>
    );
  }
  return (
    <Link
      href={href}
      className="inline-flex h-[32px] items-center rounded-md border border-neutral-300 bg-neutral-0 px-1.5 text-sm text-neutral-800 transition-colors duration-[120ms] hover:bg-neutral-100 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-primary-500"
    >
      {rotulo}
    </Link>
  );
}
