import type { Metadata } from "next";
import Link from "next/link";
import { createClient } from "@/lib/supabase/server";
import {
  MOTIVOS_PERDA,
  corteDiasAtras,
  type MotivoPerda,
} from "@/lib/perda";
import { buscarTudo } from "@/lib/supabase/paginar";
import { formatarData, formatarReais } from "@/lib/format";
import { ROTULO_STATUS, type LeadStatus } from "@/lib/types";
import { cn } from "@/lib/utils";

export const metadata: Metadata = { title: "Relatórios · Zeve CRM" };

const PERIODOS = [
  { dias: 30, rotulo: "30 dias" },
  { dias: 90, rotulo: "90 dias" },
  { dias: 365, rotulo: "12 meses" },
  { dias: null, rotulo: "Tudo" },
] as const;

type Relatorio = {
  total_leads: number;
  clientes_base: number;
  leads_clientes: number;
  ganhos: number;
  em_andamento: number;
  nunca_responderam: number;
  por_status: Record<string, number>;
  por_etapa: { etapa: string; kanban: string; ordem: number; total: number }[];
  por_canal: {
    canal: string;
    leads: number;
    ganhos: number;
    clientes: number;
    gasto_centavos: number;
  }[];
  /** Uma linha por etiqueta; sem etiqueta, cai na campanha e depois no canal. */
  por_origem?: {
    origem?: string;
    canal?: string;
    campanha?: boolean;
    etiqueta?: boolean;
    leads?: number;
    ganhos?: number;
    clientes?: number;
    templates?: number;
    gasto_centavos?: number;
  }[];
  por_vendedor: {
    vendedor: string;
    leads: number;
    ganhos: number;
    vendas: number;
    comissao_centavos: number;
  }[];
};

const numero = (n: number) => n.toLocaleString("pt-BR");
const percentual = (parte: number, todo: number) =>
  todo > 0 ? `${((parte / todo) * 100).toFixed(1).replace(".", ",")}%` : "—";

export default async function RelatoriosPage({
  searchParams,
}: PageProps<"/relatorios">) {
  const params = await searchParams;
  const escolhido = PERIODOS.find((p) => String(p.dias) === params.periodo);
  const periodo = escolhido ?? PERIODOS[3]; // padrão: tudo

  const supabase = await createClient();
  const [{ data, error }, { data: maisAntigo }] = await Promise.all([
    supabase.rpc("relatorio_leads", { p_dias: periodo.dias }),
    // Idade da base: com tudo importado há dias, "90 dias" e "Tudo" mostram
    // os MESMOS números — sem esta nota, o filtro parece quebrado.
    supabase
      .from("leads")
      .select("criado_em")
      .order("criado_em", { ascending: true })
      .limit(1)
      .maybeSingle(),
  ]);

  // Motivos de perda, na MESMA coorte do resto da página: leads criados no
  // período. Filtrar por data da perda enquanto a barra "Perdido" filtra por
  // criação faria duas seções da mesma tela discordarem.
  // Em lotes (buscarTudo): .limit acima de 1000 é truncado em silêncio pelo
  // PostgREST. Sem a 0038 a coluna não existe e a seção não aparece.
  let perdasPorMotivo: { motivo: string; total: number }[] = [];
  {
    const { dados: perdidos, erro: erroPerda } = await buscarTudo<{
      perda_motivo: string | null;
    }>((dei, ate) => {
      let q = supabase
        .from("leads")
        .select("perda_motivo")
        .eq("status", "perdido")
        .order("id")
        .range(dei, ate);
      if (periodo.dias !== null) {
        q = q.gte("criado_em", corteDiasAtras(periodo.dias));
      }
      return q;
    });
    if (erroPerda === null) {
      const soma = new Map<string, number>();
      for (const l of perdidos) {
        const chave = l.perda_motivo ?? "sem_motivo";
        soma.set(chave, (soma.get(chave) ?? 0) + 1);
      }
      perdasPorMotivo = [...soma.entries()]
        .map(([motivo, total]) => ({ motivo, total }))
        .sort((a, b) => b.total - a.total);
    }
  }

  const r = (data ?? null) as Relatorio | null;

  // A função no banco pode estar em qualquer versão: sem a 0022 só existe
  // por_canal, uma 0022 antiga vem sem `templates` e antes da 0031 não há
  // `etiqueta`. Normalizar aqui evita a página cair por um campo ausente.
  type LinhaOrigem = NonNullable<Relatorio["por_origem"]>[number];
  const brutas: LinhaOrigem[] =
    r?.por_origem ??
    (r?.por_canal ?? []).map((c) => ({
      ...c,
      origem: c.canal,
      campanha: false,
      etiqueta: false,
    }));

  const origens = brutas.map((o) => ({
    origem: o.origem ?? "Sem origem",
    canal: o.canal ?? "Sem canal",
    campanha: o.campanha ?? false,
    etiqueta: o.etiqueta ?? false,
    leads: o.leads ?? 0,
    ganhos: o.ganhos ?? 0,
    clientes: o.clientes ?? 0,
    templates: o.templates ?? 0,
    gasto_centavos: o.gasto_centavos ?? 0,
  }));

  // Atividade da equipe (30 dias) — quem contata, quanto e com que resposta.
  // eslint-disable-next-line react-hooks/purity -- Server Component: uma renderização por request, o relógio do request é estável.
  const agoraMs = Date.now();
  const d30 = new Date(agoraMs - 30 * 86_400_000).toISOString();
  const d1 = new Date(agoraMs - 86_400_000).toISOString();

  const [
    { dados: enviadas, erro: enviadasErro },
    { count: resolvidas, error: resolvidasErro },
    { dados: trocas, erro: trocasErro },
    { count: aguardandoCount, error: aguardandoErro },
    { data: metasEquipe },
  ] = await Promise.all([
    // Em lotes: acima de 1000 mensagens no período o PostgREST truncava e a
    // contagem por vendedor saía menor que a realidade.
    buscarTudo<{ criado_em: string; autor_id: string | null }>((dei, ate) =>
      supabase
        .from("lead_interactions")
        .select("criado_em, autor_id")
        .eq("tipo", "mensagem_enviada")
        .gte("criado_em", d30)
        // Desempate por id: criado_em repete em disparo em lote, e a fronteira
        // entre páginas pulava ou duplicava linhas.
        .order("criado_em")
        .order("id")
        .range(dei, ate),
    ),
    supabase
      .from("lead_interactions")
      .select("id", { count: "exact", head: true })
      .eq("tipo", "nota")
      .eq("conteudo", "Conversa resolvida")
      .gte("criado_em", d30),
    // Tempo de resposta medido nas mensagens, não em leads: para quem chega
    // pelo WhatsApp, a primeira mensagem É a criação do lead — a conta antiga
    // dava negativo em todos e a tela mostrava "—".
    buscarTudo<{ lead_id: string; tipo: string; criado_em: string }>(
      (dei, ate) =>
        supabase
          .from("lead_interactions")
          .select("lead_id, tipo, criado_em")
          .in("tipo", ["mensagem_recebida", "mensagem_enviada"])
          .gte("criado_em", d30)
          .order("criado_em")
          .order("id")
          .range(dei, ate),
    ),
    // Definição canônica de "aguardando resposta" (view da 0032): o CLIENTE
    // mandou a última mensagem e a conversa não está resolvida, adiada nem
    // perdida. A conta antiga usava ultima_interacao_em > chat_lido_em, e o
    // robô da cadência atualiza ultima_interacao_em sem "ler" — cada disparo
    // automático virava uma conversa "esperando" (66 no painel, 7 de verdade).
    supabase
      .from("v_leads_listas")
      .select("lead_id", { count: "exact", head: true })
      .eq("aguardando_resposta", true),
    // Coluna da migração 0013; sem ela, a coluna de meta some da tabela.
    supabase
      .from("profiles")
      .select("id, nome, meta_contatos_dia")
      .eq("ativo", true),
  ]);

  // Sem autor = disparo automático (cadência, agendada, reativação).
  const nomePorId = new Map(
    ((metasEquipe ?? []) as { id: string; nome: string }[]).map((p) => [
      p.id,
      p.nome,
    ]),
  );

  const porVendedor = new Map<string, { total: number; ultimas24h: number }>();
  for (const linha of enviadas) {
    const nome = linha.autor_id
      ? (nomePorId.get(linha.autor_id) ?? "Outro usuário")
      : "Automação";
    const atual = porVendedor.get(nome) ?? { total: 0, ultimas24h: 0 };
    atual.total++;
    if (linha.criado_em >= d1) atual.ultimas24h++;
    porVendedor.set(nome, atual);
  }
  const rankingVendedores = [...porVendedor.entries()].sort(
    (a, b) => b[1].total - a[1].total,
  );

  // Da mensagem do cliente até a resposta da equipe. Mediana, não média: uma
  // conversa esquecida no fim de semana distorce a média inteira.
  const conversasPorLead = new Map<
    string,
    { tipo: string; criado_em: string }[]
  >();
  for (const msg of trocas) {
    conversasPorLead.set(msg.lead_id, [
      ...(conversasPorLead.get(msg.lead_id) ?? []),
      msg,
    ]);
  }
  const temposMin: number[] = [];
  for (const msgs of conversasPorLead.values()) {
    let esperando: string | null = null;
    for (const msg of msgs) {
      if (msg.tipo === "mensagem_recebida") {
        if (esperando === null) esperando = msg.criado_em;
      } else if (esperando !== null) {
        const minutos =
          (Date.parse(msg.criado_em) - Date.parse(esperando)) / 60_000;
        // Fora do atendimento: negativo (importação) ou além de uma semana
        // (conversa retomada, não resposta).
        if (minutos >= 0 && minutos <= 60 * 24 * 7) temposMin.push(minutos);
        esperando = null;
      }
    }
  }
  temposMin.sort((a, b) => a - b);
  const medianaRespostaMin =
    temposMin.length > 0 ? temposMin[Math.floor(temposMin.length / 2)] : null;

  const aguardandoAgora = aguardandoCount ?? 0;

  // ── BUG: erro engolido virava zero "de verdade" na tela ──
  // Consulta que falha não pode renderizar 0 — zero é um dado, erro é outro.
  const atividadeErro =
    enviadasErro ??
    trocasErro ??
    aguardandoErro?.message ??
    resolvidasErro?.message ??
    null;

  const metaPorNome = new Map(
    ((metasEquipe ?? []) as { nome: string; meta_contatos_dia: number }[]).map(
      (m) => [m.nome, m.meta_contatos_dia],
    ),
  );
  const metasDisponiveis = metasEquipe !== null;
  const totalEnviadas30d = enviadas.length;

  // Retenção da carteira (migração 0015; tolerante à ausência das views).
  // Em lotes: o PostgREST corta em 1000 por resposta e os percentuais sairiam
  // calculados sobre uma fatia da base.
  const [
    { dados: carteira, erro: carteiraErro },
    { data: retencaoMeses },
    { count: totalLotes },
  ] = await Promise.all([
      buscarTudo<{
        status: string;
        receita_30d_centavos: number | null;
        lotes_30d: number | null;
        ultimo_giro_em: string | null;
      }>((de, ate) =>
        supabase
          .from("v_carteira")
          .select("status, receita_30d_centavos, lotes_30d, ultimo_giro_em")
          .order("customer_id")
          .range(de, ate),
      ),
      supabase
        .from("v_retencao_mensal")
        .select("mes, churns, reativacoes, resgates")
        .order("mes", { ascending: false })
        .limit(6),
      // Sem lote importado não existe giro para medir — e o status de todos
      // fica no padrão "ativo", o que fazia a tela mostrar 100% girando.
      supabase
        .from("customer_lots")
        .select("id", { count: "exact", head: true }),
    ]);
  const retencaoDisponivel = carteiraErro === null;
  const totalCarteira = carteira.length;
  const contagemStatus = (s: string) =>
    carteira.filter((c) => c.status === s).length;
  // Girando de verdade: teve lote nos últimos 30 dias. O status é rótulo de
  // ciclo de vida e só vale depois de a importação rodar o motor.
  const girando = carteira.filter((c) => (c.lotes_30d ?? 0) > 0).length;
  const nuncaGirou = carteira.filter((c) => c.ultimo_giro_em === null).length;
  const semDadoDeGiro = (totalLotes ?? 0) === 0;
  const receitaCarteira = carteira.reduce(
    (s, c) => s + (c.receita_30d_centavos ?? 0),
    0,
  );
  const mesesRetencao = (retencaoMeses ?? []) as {
    mes: string;
    churns: number;
    reativacoes: number;
    resgates: number;
  }[];
  const somaReativacoes = mesesRetencao.reduce((s, m) => s + m.reativacoes, 0);
  const somaResgates = mesesRetencao.reduce((s, m) => s + m.resgates, 0);

  return (
    <div className="p-2 md:p-3">
      <header className="border-b border-neutral-200 pb-2">
        <h1 className="text-h1 text-neutral-900">Relatórios</h1>
        <p className="mt-1 max-w-[68ch] text-base text-neutral-600">
          O quadro da operação: onde os leads estão, quanto convertem e quem
          está vendendo.
        </p>
      </header>

      <nav aria-label="Período" className="mt-2">
        <ul className="flex flex-wrap gap-1">
          {PERIODOS.map((p) => {
            const ativo = p.dias === periodo.dias;
            return (
              <li key={p.rotulo}>
                <Link
                  href={p.dias === null ? "/relatorios" : `/relatorios?periodo=${p.dias}`}
                  aria-current={ativo ? "page" : undefined}
                  className={cn(
                    "inline-flex h-[32px] items-center rounded-md px-1.5 text-sm transition-colors duration-[120ms] focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-primary-500",
                    ativo
                      ? "bg-primary-50 font-medium text-primary-900"
                      : "text-neutral-600 hover:bg-neutral-100 hover:text-neutral-800",
                  )}
                >
                  {p.rotulo}
                </Link>
              </li>
            );
          })}
        </ul>
        {maisAntigo?.criado_em ? (
          <p className="mt-1 text-xs text-neutral-400">
            A base tem leads desde {formatarData(maisAntigo.criado_em)} —
            períodos maiores que isso mostram os mesmos números.
          </p>
        ) : null}
      </nav>

      {error || !r ? (
        <p
          role="alert"
          className="mt-3 max-w-[68ch] rounded-md border border-danger bg-danger-bg px-1.5 py-1 text-sm text-danger"
        >
          Não foi possível carregar os números. Verifique se a migration 0009
          foi aplicada.
        </p>
      ) : (
        <>
          {/* Indicadores */}
          <dl className="mt-3 grid gap-3 border-y border-neutral-200 py-3 sm:grid-cols-2 lg:grid-cols-4">
            <Indicador
              rotulo="Leads no período"
              valor={numero(r.total_leads)}
              detalhe={`${numero(r.nunca_responderam)} nunca responderam`}
            />
            <Indicador
              rotulo="Já são clientes"
              valor={numero(r.leads_clientes)}
              detalhe={`${numero(r.clientes_base)} clientes ativos na base`}
            />
            <Indicador
              rotulo="Taxa de conversão"
              valor={percentual(r.ganhos, r.total_leads)}
              detalhe={`${numero(r.ganhos)} ganho(s)`}
            />
            <Indicador
              rotulo="Em andamento"
              valor={numero(r.em_andamento)}
              detalhe="novos + em atendimento"
            />
          </dl>

          {/* Atividade da equipe */}
          <section className="mt-3" aria-labelledby="atividade-titulo">
            <h2 id="atividade-titulo" className="text-h3 text-neutral-900">
              Atividade (últimos 30 dias)
            </h2>
            {atividadeErro !== null ? (
              <p
                role="alert"
                className="mt-2 max-w-[68ch] rounded-md bg-warning-bg px-1.5 py-1 text-sm text-warning"
              >
                Não deu para carregar toda a atividade ({atividadeErro}) — os
                números abaixo podem estar incompletos.
              </p>
            ) : null}
            <dl className="mt-2 grid gap-3 border-y border-neutral-200 py-3 sm:grid-cols-2 lg:grid-cols-4">
              <Indicador
                rotulo="Mensagens enviadas"
                valor={enviadasErro ? "—" : numero(totalEnviadas30d)}
                detalhe="pela equipe, no CRM e automações"
              />
              <Indicador
                rotulo="Equipe responde em"
                valor={
                  medianaRespostaMin === null
                    ? "—"
                    : medianaRespostaMin < 60
                      ? `${Math.round(medianaRespostaMin)}min`
                      : `${(medianaRespostaMin / 60).toFixed(1).replace(".", ",")}h`
                }
                detalhe={
                  temposMin.length > 0
                    ? `mediana de ${numero(temposMin.length)} resposta(s)`
                    : "sem respostas medidas no período"
                }
              />
              <Indicador
                rotulo="Conversas resolvidas"
                valor={resolvidasErro ? "—" : numero(resolvidas ?? 0)}
                detalhe="marcadas no chat"
              />
              <Indicador
                rotulo="Aguardando resposta"
                valor={aguardandoErro ? "—" : numero(aguardandoAgora)}
                detalhe="cliente falou por último e ninguém respondeu"
              />
            </dl>

            {rankingVendedores.length > 0 ? (
              <div className="mt-2 overflow-x-auto rounded-lg border border-neutral-200 bg-neutral-0 shadow-sm">
                <table className="w-full min-w-[480px] border-collapse text-left">
                  <thead>
                    <tr className="border-b border-neutral-200 bg-neutral-50">
                      <th className="px-2 py-1 text-xs tracking-[0.06em] text-neutral-600 uppercase">
                        Vendedor
                      </th>
                      <th className="px-2 py-1 text-right text-xs tracking-[0.06em] text-neutral-600 uppercase">
                        Mensagens (30d)
                      </th>
                      <th className="px-2 py-1 text-right text-xs tracking-[0.06em] text-neutral-600 uppercase">
                        Últimas 24h
                      </th>
                      {metasDisponiveis ? (
                        <th className="px-2 py-1 text-right text-xs tracking-[0.06em] text-neutral-600 uppercase">
                          Meta/dia
                        </th>
                      ) : null}
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-neutral-200">
                    {rankingVendedores.map(([nome, atividade]) => {
                      const meta = metaPorNome.get(nome) ?? 0;
                      const abaixo = meta > 0 && atividade.ultimas24h < meta;
                      return (
                        <tr key={nome} className="h-[40px]">
                          <td className="px-2 text-sm text-neutral-800">
                            {nome}
                          </td>
                          <td className="px-2 text-right font-mono text-sm text-neutral-800 tabular-nums">
                            {numero(atividade.total)}
                          </td>
                          <td
                            className={cn(
                              "px-2 text-right font-mono text-sm tabular-nums",
                              abaixo
                                ? "font-medium text-warning"
                                : "text-neutral-800",
                            )}
                          >
                            {numero(atividade.ultimas24h)}
                          </td>
                          {metasDisponiveis ? (
                            <td className="px-2 text-right font-mono text-sm text-neutral-600 tabular-nums">
                              {meta > 0 ? numero(meta) : "—"}
                            </td>
                          ) : null}
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
            ) : enviadasErro === null ? (
              <p className="mt-2 text-sm text-neutral-600">
                Nenhuma mensagem enviada nos últimos 30 dias — os números
                aparecem conforme a equipe usa o chat.
              </p>
            ) : null}
          </section>

          {/* Retenção da carteira */}
          <section className="mt-3" aria-labelledby="retencao-titulo">
            <h2 id="retencao-titulo" className="text-h3 text-neutral-900">
              Retenção da carteira
            </h2>
            {!retencaoDisponivel ? (
              <p className="mt-2 max-w-[68ch] rounded-md bg-warning-bg px-1.5 py-1 text-sm text-warning">
                Rode a migração 0015 (supabase/migrations/0015_retencao.sql) no
                SQL Editor para habilitar as métricas de retenção.
              </p>
            ) : totalCarteira === 0 ? (
              <p className="mt-2 text-sm text-neutral-600">
                A carteira enche com a importação diária de clientes e lotes.
              </p>
            ) : (
              <>
                {semDadoDeGiro ? (
                  <p className="mt-2 max-w-[68ch] rounded-md border border-warning bg-warning-bg px-1.5 py-1 text-sm text-warning">
                    <strong className="font-medium">
                      Nenhum lote importado ainda.
                    </strong>{" "}
                    Os {numero(totalCarteira)} clientes já estão na base, mas
                    sem os lotes não há giro para medir: risco, churn e receita
                    ficam em zero até a primeira importação de lotes na{" "}
                    <Link
                      href="/admin"
                      className="underline underline-offset-2"
                    >
                      Administração
                    </Link>
                    .
                  </p>
                ) : null}

                <dl className="mt-2 grid gap-3 border-y border-neutral-200 py-3 sm:grid-cols-2 lg:grid-cols-4">
                  <Indicador
                    rotulo="Carteira girando"
                    valor={
                      semDadoDeGiro ? "—" : percentual(girando, totalCarteira)
                    }
                    detalhe={
                      semDadoDeGiro
                        ? "sem lotes importados"
                        : `${numero(girando)} de ${numero(totalCarteira)} giraram nos últimos 30 dias`
                    }
                  />
                  <Indicador
                    rotulo="Em risco agora"
                    valor={numero(contagemStatus("em_risco"))}
                    detalhe={
                      semDadoDeGiro
                        ? "detecta na importação de lotes"
                        : "queda ou sem giro detectados"
                    }
                  />
                  <Indicador
                    rotulo="Churn"
                    valor={numero(contagemStatus("churn"))}
                    detalhe={
                      semDadoDeGiro
                        ? "detecta na importação de lotes"
                        : "sem giro além do limite"
                    }
                  />
                  <Indicador
                    rotulo="Nunca giraram"
                    valor={numero(nuncaGirou)}
                    detalhe={`de ${numero(totalCarteira)} na carteira`}
                  />
                </dl>

                {somaReativacoes > 0 ? (
                  <p className="mt-1 text-sm text-neutral-600">
                    Taxa de resgate:{" "}
                    <span className="font-mono font-medium text-neutral-800 tabular-nums">
                      {percentual(somaResgates, somaReativacoes)}
                    </span>{" "}
                    — {numero(somaResgates)} de {numero(somaReativacoes)}{" "}
                    acionados voltaram a girar.
                  </p>
                ) : null}
                {receitaCarteira > 0 ? (
                  <p className="mt-1 text-sm text-neutral-600">
                    Receita estimada da carteira (30d):{" "}
                    <span className="font-mono font-medium text-neutral-800 tabular-nums">
                      {formatarReais(receitaCarteira)}
                    </span>
                  </p>
                ) : null}

                {mesesRetencao.length > 0 ? (
                  <div className="mt-2 overflow-x-auto rounded-lg border border-neutral-200 bg-neutral-0 shadow-sm">
                    <table className="w-full min-w-[420px] border-collapse text-left">
                      <thead>
                        <tr className="border-b border-neutral-200 bg-neutral-50">
                          <th className="px-2 py-1 text-xs tracking-[0.06em] text-neutral-600 uppercase">
                            Mês
                          </th>
                          <th className="px-2 py-1 text-right text-xs tracking-[0.06em] text-neutral-600 uppercase">
                            Acionados
                          </th>
                          <th className="px-2 py-1 text-right text-xs tracking-[0.06em] text-neutral-600 uppercase">
                            Resgatados
                          </th>
                          <th className="px-2 py-1 text-right text-xs tracking-[0.06em] text-neutral-600 uppercase">
                            Churns
                          </th>
                        </tr>
                      </thead>
                      <tbody className="divide-y divide-neutral-200">
                        {mesesRetencao.map((m) => (
                          <tr key={m.mes} className="h-[40px]">
                            <td className="px-2 font-mono text-sm text-neutral-800 tabular-nums">
                              {new Date(`${m.mes.slice(0, 10)}T12:00:00`).toLocaleDateString(
                                "pt-BR",
                                { month: "short", year: "numeric" },
                              )}
                            </td>
                            <td className="px-2 text-right font-mono text-sm text-neutral-800 tabular-nums">
                              {numero(m.reativacoes)}
                            </td>
                            <td className="px-2 text-right font-mono text-sm text-success tabular-nums">
                              {numero(m.resgates)}
                            </td>
                            <td className="px-2 text-right font-mono text-sm text-danger tabular-nums">
                              {numero(m.churns)}
                            </td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                ) : null}
              </>
            )}
          </section>

          <div className="mt-3 grid items-start gap-3 lg:grid-cols-2">
            {/* Leads por etapa */}
            <section
              aria-labelledby="etapas-titulo"
              className="rounded-lg border border-neutral-200 bg-neutral-0 p-3 shadow-sm"
            >
              <h2 id="etapas-titulo" className="text-h3 text-neutral-900">
                Leads por etapa
              </h2>
              {agruparPorKanban(r.por_etapa).map(([kanban, etapas]) => (
                <div key={kanban} className="mt-2">
                  <h3 className="text-xs tracking-[0.06em] text-neutral-600 uppercase">
                    {kanban}
                  </h3>
                  <ul className="mt-1 flex flex-col gap-1">
                    {etapas.map((etapa) => (
                      <Barra
                        key={etapa.etapa}
                        rotulo={etapa.etapa}
                        valor={etapa.total}
                        maximo={Math.max(...etapas.map((e) => e.total), 1)}
                        extra={percentual(etapa.total, r.total_leads)}
                      />
                    ))}
                  </ul>
                </div>
              ))}
            </section>

            {/* Distribuição de status */}
            <section
              aria-labelledby="status-titulo"
              className="rounded-lg border border-neutral-200 bg-neutral-0 p-3 shadow-sm"
            >
              <h2 id="status-titulo" className="text-h3 text-neutral-900">
                Distribuição de status
              </h2>
              <ul className="mt-2 flex flex-col gap-1">
                {(Object.keys(ROTULO_STATUS) as LeadStatus[]).map((status) => {
                  const valor = r.por_status[status] ?? 0;
                  return (
                    <Barra
                      key={status}
                      rotulo={ROTULO_STATUS[status]}
                      valor={valor}
                      maximo={Math.max(...Object.values(r.por_status), 1)}
                      extra={percentual(valor, r.total_leads)}
                    />
                  );
                })}
              </ul>
            </section>
          </div>

          {/* Motivos de perda */}
          {perdasPorMotivo.length > 0 ? (
            <section
              aria-labelledby="perdas-titulo"
              className="mt-3 rounded-lg border border-neutral-200 bg-neutral-0 p-3 shadow-sm"
            >
              <h2 id="perdas-titulo" className="text-h3 text-neutral-900">
                Motivos de perda
              </h2>
              <p className="mt-1 max-w-[68ch] text-sm text-neutral-600">
                Cada motivo pede uma resposta diferente: quem sumiu é cadência,
                concorrente é proposta, e quem não quer abrir conta é
                qualificação do público — não é derrota da equipe.
              </p>
              <ul className="mt-2 flex max-w-[560px] flex-col gap-1">
                {perdasPorMotivo.map((linha) => (
                  <Barra
                    key={linha.motivo}
                    rotulo={
                      MOTIVOS_PERDA[linha.motivo as MotivoPerda] ??
                      "Sem motivo registrado (perda antiga)"
                    }
                    valor={linha.total}
                    maximo={Math.max(...perdasPorMotivo.map((x) => x.total), 1)}
                    extra={percentual(
                      linha.total,
                      perdasPorMotivo.reduce((t, x) => t + x.total, 0),
                    )}
                  />
                ))}
              </ul>
            </section>
          ) : null}

          {/* Campanhas */}
          <section aria-labelledby="origens-titulo" className="mt-3">
            <h2 id="origens-titulo" className="text-h3 text-neutral-900">
              Detalhamento por etiqueta
            </h2>
            <p className="mt-1 max-w-[68ch] text-sm text-neutral-600">
              Uma linha por etiqueta — é assim que a equipe separa campanha e
              interesse, e é o que o motor de campanhas mira. Lead sem
              etiqueta aparece pela campanha de origem e, na falta dela, pelo
              canal de entrada. O gasto conta cada template enviado (R$ 0,25
              por disparo, editável em Configurações) mais o que estiver
              lançado à mão por canal; o custo por ganho divide esse gasto
              pelos leads ganhos — quanto custou cada cliente, não cada
              disparo.
            </p>
            <p className="mt-1 max-w-[68ch] text-sm text-neutral-600">
              Lead com duas etiquetas conta nas duas linhas — leads, templates
              e gasto: somar as colunas passa do total real. A coluna Canal
              mostra “vários” quando a etiqueta atravessa mais de um canal de
              entrada.
            </p>
            {origens.length === 0 ? (
              <p className="mt-2 max-w-[68ch] rounded-lg border border-dashed border-neutral-300 p-3 text-sm text-neutral-600">
                Nenhum lead no período escolhido.
              </p>
            ) : (
            <div className="mt-2 overflow-x-auto rounded-lg border border-neutral-200 bg-neutral-0 shadow-sm">
              <table className="w-full min-w-[900px] border-collapse text-left">
                <thead>
                  <tr className="border-b border-neutral-200 bg-neutral-50">
                    <Th>Etiqueta</Th>
                    <Th>Canal</Th>
                    <Th alinhar>Leads</Th>
                    <Th alinhar>Clientes</Th>
                    <Th alinhar>Ganhos</Th>
                    <Th alinhar>Conversão</Th>
                    <Th alinhar>Templates</Th>
                    <Th alinhar>Gasto</Th>
                    <Th alinhar>Custo por ganho</Th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-neutral-200">
                  {origens.map((origem) => (
                    <tr
                      key={`${origem.origem}|${origem.canal}|${origem.campanha}|${origem.etiqueta}`}
                      className="h-[48px] hover:bg-neutral-50"
                    >
                      <td className="px-2 text-sm font-medium text-neutral-800">
                        {origem.origem}
                        {origem.etiqueta ? null : (
                          <span className="ml-1 text-xs font-normal text-neutral-400">
                            {origem.campanha ? "campanha" : "sem etiqueta"}
                          </span>
                        )}
                      </td>
                      <td className="px-2 text-sm text-neutral-600">
                        {origem.canal}
                      </td>
                      <Td>{numero(origem.leads)}</Td>
                      <Td>{numero(origem.clientes)}</Td>
                      <Td>{numero(origem.ganhos)}</Td>
                      <Td>{percentual(origem.ganhos, origem.leads)}</Td>
                      <Td>{numero(origem.templates)}</Td>
                      <Td>
                        {origem.gasto_centavos > 0
                          ? formatarReais(origem.gasto_centavos)
                          : "—"}
                      </Td>
                      <Td>
                        {origem.gasto_centavos > 0 && origem.ganhos > 0
                          ? formatarReais(
                              Math.round(origem.gasto_centavos / origem.ganhos),
                            )
                          : "—"}
                      </Td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            )}
          </section>

          {/* Vendedores */}
          <section aria-labelledby="vendedores-titulo" className="mt-3 mb-3">
            <h2 id="vendedores-titulo" className="text-h3 text-neutral-900">
              Desempenho por vendedor
            </h2>
            {r.por_vendedor.length === 0 ? (
              <p className="mt-2 text-sm text-neutral-600">
                Nenhum lead com responsável no período.
              </p>
            ) : (
              <div className="mt-2 overflow-x-auto rounded-lg border border-neutral-200 bg-neutral-0 shadow-sm">
                <table className="w-full min-w-[640px] border-collapse text-left">
                  <thead>
                    <tr className="border-b border-neutral-200 bg-neutral-50">
                      <Th>Vendedor</Th>
                      <Th alinhar>Leads</Th>
                      <Th alinhar>Ganhos</Th>
                      <Th alinhar>Conversão</Th>
                      <Th alinhar>Vendas</Th>
                      <Th alinhar>Comissão</Th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-neutral-200">
                    {r.por_vendedor.map((vendedor) => (
                      <tr
                        key={vendedor.vendedor}
                        className="h-[48px] hover:bg-neutral-50"
                      >
                        <td className="px-2 text-sm font-medium text-neutral-800">
                          {vendedor.vendedor}
                        </td>
                        <Td>{numero(vendedor.leads)}</Td>
                        <Td>{numero(vendedor.ganhos)}</Td>
                        <Td>{percentual(vendedor.ganhos, vendedor.leads)}</Td>
                        <Td>{numero(vendedor.vendas)}</Td>
                        <Td>{formatarReais(vendedor.comissao_centavos)}</Td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </section>
        </>
      )}
    </div>
  );
}

function agruparPorKanban(
  etapas: Relatorio["por_etapa"],
): [string, Relatorio["por_etapa"]][] {
  const mapa = new Map<string, Relatorio["por_etapa"]>();
  for (const etapa of etapas) {
    if (!mapa.has(etapa.kanban)) mapa.set(etapa.kanban, []);
    mapa.get(etapa.kanban)!.push(etapa);
  }
  for (const lista of mapa.values()) lista.sort((a, b) => a.ordem - b.ordem);
  return [...mapa.entries()];
}

function Indicador({
  rotulo,
  valor,
  detalhe,
}: {
  rotulo: string;
  valor: string;
  detalhe?: string;
}) {
  return (
    <div>
      <dt className="text-xs tracking-[0.06em] text-neutral-600 uppercase">
        {rotulo}
      </dt>
      <dd>
        <span className="block font-mono text-h1 text-neutral-900 tabular-nums">
          {valor}
        </span>
        {detalhe ? (
          <span className="mt-0.5 block text-sm text-neutral-600">{detalhe}</span>
        ) : null}
      </dd>
    </div>
  );
}

/** Barra horizontal com rótulo e valor diretos — magnitude em tom único. */
function Barra({
  rotulo,
  valor,
  maximo,
  extra,
}: {
  rotulo: string;
  valor: number;
  maximo: number;
  extra?: string;
}) {
  const largura = maximo > 0 ? Math.max((valor / maximo) * 100, valor > 0 ? 2 : 0) : 0;
  return (
    // No celular o rótulo ocupa a linha inteira e a barra desce — lado a
    // lado, sobravam ~13px para a barra em 375px.
    <li className="flex flex-wrap items-center gap-1">
      <span
        title={rotulo}
        className="w-full truncate text-sm text-neutral-800 sm:w-[180px] sm:shrink-0"
      >
        {rotulo}
      </span>
      <span
        aria-hidden
        className="h-1 flex-1 overflow-hidden rounded-sm bg-neutral-100"
      >
        <span
          className="block h-full rounded-sm bg-primary-500"
          style={{ width: `${largura}%` }}
        />
      </span>
      <span className="w-6 shrink-0 text-right font-mono text-sm text-neutral-900 tabular-nums">
        {valor.toLocaleString("pt-BR")}
      </span>
      {extra ? (
        <span className="w-[56px] shrink-0 text-right font-mono text-xs text-neutral-400 tabular-nums">
          {extra}
        </span>
      ) : null}
    </li>
  );
}

function Th({ children, alinhar }: { children: React.ReactNode; alinhar?: boolean }) {
  return (
    <th
      scope="col"
      className={cn(
        "px-2 py-1 text-xs tracking-[0.06em] text-neutral-600 uppercase",
        alinhar && "text-right",
      )}
    >
      {children}
    </th>
  );
}

function Td({ children }: { children: React.ReactNode }) {
  return (
    <td className="px-2 text-right font-mono text-sm text-neutral-800 tabular-nums">
      {children}
    </td>
  );
}
