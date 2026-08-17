import type { Metadata } from "next";
import Link from "next/link";
import { createClient } from "@/lib/supabase/server";
import { buscarTudo } from "@/lib/supabase/paginar";
import { formatarReais } from "@/lib/format";
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
  const { data, error } = await supabase.rpc("relatorio_leads", {
    p_dias: periodo.dias,
  });

  const r = (data ?? null) as Relatorio | null;

  // Atividade da equipe (30 dias) — quem contata, quanto e com que resposta.
  // eslint-disable-next-line react-hooks/purity -- Server Component: uma renderização por request, o relógio do request é estável.
  const agoraMs = Date.now();
  const d30 = new Date(agoraMs - 30 * 86_400_000).toISOString();
  const d1 = new Date(agoraMs - 86_400_000).toISOString();

  const [
    { dados: enviadas },
    { count: resolvidas },
    { dados: trocas },
    { dados: conversasAbertas },
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
        .order("criado_em")
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
          .range(dei, ate),
    ),
    // Conversa é histórico de mensagem (vale para Meta e Chatwoot), em lotes.
    buscarTudo<{ ultima_interacao_em: string; chat_lido_em: string | null }>(
      (dei, ate) =>
        supabase
          .from("leads")
          .select("ultima_interacao_em, chat_lido_em")
          .not("ultima_interacao_em", "is", null)
          .order("id")
          .range(dei, ate),
    ),
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

  const aguardandoAgora = conversasAbertas.filter(
    (l) => l.chat_lido_em === null || l.ultima_interacao_em > l.chat_lido_em,
  ).length;

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
  const [{ dados: carteira, erro: carteiraErro }, { data: retencaoMeses }] =
    await Promise.all([
      buscarTudo<{ status: string; receita_30d_centavos: number | null }>(
        (de, ate) =>
          supabase
            .from("v_carteira")
            .select("status, receita_30d_centavos")
            .order("customer_id")
            .range(de, ate),
      ),
      supabase
        .from("v_retencao_mensal")
        .select("mes, churns, reativacoes, resgates")
        .order("mes", { ascending: false })
        .limit(6),
    ]);
  const retencaoDisponivel = carteiraErro === null;
  const totalCarteira = carteira.length;
  const contagemStatus = (s: string) =>
    carteira.filter((c) => c.status === s).length;
  const girando = contagemStatus("ativo") + contagemStatus("reativado");
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
            <dl className="mt-2 grid gap-3 border-y border-neutral-200 py-3 sm:grid-cols-2 lg:grid-cols-4">
              <Indicador
                rotulo="Mensagens enviadas"
                valor={numero(totalEnviadas30d)}
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
                valor={numero(resolvidas ?? 0)}
                detalhe="marcadas no chat"
              />
              <Indicador
                rotulo="Aguardando resposta"
                valor={numero(aguardandoAgora)}
                detalhe="conversas não lidas agora"
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
            ) : (
              <p className="mt-2 text-sm text-neutral-600">
                Nenhuma mensagem enviada nos últimos 30 dias — os números
                aparecem conforme a equipe usa o chat.
              </p>
            )}
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
                <dl className="mt-2 grid gap-3 border-y border-neutral-200 py-3 sm:grid-cols-2 lg:grid-cols-4">
                  <Indicador
                    rotulo="Carteira girando"
                    valor={percentual(girando, totalCarteira)}
                    detalhe={`${numero(girando)} de ${numero(totalCarteira)} clientes`}
                  />
                  <Indicador
                    rotulo="Em risco agora"
                    valor={numero(contagemStatus("em_risco"))}
                    detalhe="queda ou sem giro detectados"
                  />
                  <Indicador
                    rotulo="Churn"
                    valor={numero(contagemStatus("churn"))}
                    detalhe="sem giro além do limite"
                  />
                  <Indicador
                    rotulo="Taxa de resgate"
                    valor={percentual(somaResgates, somaReativacoes)}
                    detalhe={`${numero(somaResgates)} voltaram a girar de ${numero(somaReativacoes)} acionados`}
                  />
                </dl>
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

          {/* Canais */}
          <section aria-labelledby="canais-titulo" className="mt-3">
            <h2 id="canais-titulo" className="text-h3 text-neutral-900">
              Detalhamento por canal
            </h2>
            <div className="mt-2 overflow-x-auto rounded-lg border border-neutral-200 bg-neutral-0 shadow-sm">
              <table className="w-full min-w-[720px] border-collapse text-left">
                <thead>
                  <tr className="border-b border-neutral-200 bg-neutral-50">
                    <Th>Canal</Th>
                    <Th alinhar>Leads</Th>
                    <Th alinhar>Clientes</Th>
                    <Th alinhar>Ganhos</Th>
                    <Th alinhar>Conversão</Th>
                    <Th alinhar>Gasto</Th>
                    <Th alinhar>Custo por lead</Th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-neutral-200">
                  {r.por_canal.map((canal) => (
                    <tr key={canal.canal} className="h-[48px] hover:bg-neutral-50">
                      <td className="px-2 text-sm font-medium text-neutral-800">
                        {canal.canal}
                      </td>
                      <Td>{numero(canal.leads)}</Td>
                      <Td>{numero(canal.clientes)}</Td>
                      <Td>{numero(canal.ganhos)}</Td>
                      <Td>{percentual(canal.ganhos, canal.leads)}</Td>
                      <Td>
                        {canal.gasto_centavos > 0
                          ? formatarReais(canal.gasto_centavos)
                          : "—"}
                      </Td>
                      <Td>
                        {canal.gasto_centavos > 0 && canal.leads > 0
                          ? formatarReais(
                              Math.round(canal.gasto_centavos / canal.leads),
                            )
                          : "—"}
                      </Td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
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
      <span className="w-full truncate text-sm text-neutral-800 sm:w-[152px] sm:shrink-0">
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
