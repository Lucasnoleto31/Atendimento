import type { Metadata } from "next";
import Link from "next/link";
import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { perfilAtual } from "@/lib/auth";
import { veTudo } from "@/lib/papeis";
import { buscarTudo } from "@/lib/supabase/paginar";
import { agoraEmBrasilia, formatarData, formatarReais } from "@/lib/format";
import { MOTIVOS_PERDA, corteDiasAtras, type MotivoPerda } from "@/lib/perda";
import { cn } from "@/lib/utils";

export const metadata: Metadata = { title: "Relatórios · Zeve CRM" };

/**
 * A página responde, nesta ordem, as quatro perguntas que sócio faz:
 *
 *   1. Quanto estamos girando? (o caixa)
 *   2. O funil converte?       (lead → conversa → conta → 1º giro)
 *   3. Onde há dinheiro parado e escorrendo? (ativação, perdas, risco)
 *   4. Quem está entregando?   (aquisição por etiqueta e equipe)
 *
 * O que não responde nenhuma delas não entra. Distribuição de status,
 * etapas de todos os kanbans e canal repetido moravam aqui e ninguém lia —
 * eram o estado interno do sistema, não o negócio.
 */

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
  por_origem?: {
    origem: string | null;
    canal: string | null;
    campanha: boolean | null;
    etiqueta: boolean | null;
    leads: number | null;
    ganhos: number | null;
    clientes: number | null;
    templates: number | null;
    gasto_centavos: number | null;
  }[];
  por_vendedor?: {
    vendedor: string;
    leads: number;
    ganhos: number;
    vendas: number;
    comissao_centavos: number;
  }[];
};

function numero(n: number) {
  return n.toLocaleString("pt-BR");
}

function percentual(parte: number, total: number) {
  if (total <= 0) return "—";
  return `${Math.round((parte / total) * 100)}%`;
}

export default async function RelatoriosPage({
  searchParams,
}: PageProps<"/relatorios">) {
  const params = await searchParams;
  const escolhido = PERIODOS.find((p) => String(p.dias) === params.periodo);
  const periodo = escolhido ?? PERIODOS[3]; // padrão: tudo
  const corte = periodo.dias !== null ? corteDiasAtras(periodo.dias) : null;

  // Relatórios são da mesa inteira: quem vê a base inteira (gestão e
  // compliance). Assessor e atendente têm o próprio recorte em Pagamentos.
  const perfil = await perfilAtual();
  if (!perfil || !veTudo(perfil.papel)) redirect("/hoje");

  const supabase = await createClient();

  // ── Tudo de uma vez: a página é leitura, o custo é uma rodada só ──────────
  const [
    { data, error },
    { data: maisAntigo },
    { dados: giro, erro: giroErro },
    { count: totalLotesImportados },
    { data: ultimoImporteLotes },
    { dados: vendasPeriodo, erro: vendasErro },
    contasNovas,
    { dados: ganhosCoorte },
    perdasBrutas,
    atividade,
    { count: aguardandoCount, error: aguardandoErro },
    { data: equipeAtiva },
    { data: resumoAtivBruto },
  ] = await Promise.all([
    supabase.rpc("relatorio_leads", { p_dias: periodo.dias }),
    // Idade da base: com tudo importado há dias, "90 dias" e "Tudo" mostram
    // os MESMOS números — sem esta nota, o filtro parece quebrado.
    supabase
      .from("leads")
      .select("criado_em")
      .order("criado_em", { ascending: true })
      .limit(1)
      .maybeSingle(),
    // Giro da carteira inteira (sempre 30d — é a janela do negócio).
    buscarTudo<{
      customer_id: string;
      lotes_30d: number | null;
      lotes_30d_anterior: number | null;
      ultimo_giro_em: string | null;
    }>((de, ate) =>
      supabase
        .from("v_customer_giro")
        .select("customer_id, lotes_30d, lotes_30d_anterior, ultimo_giro_em")
        .order("customer_id")
        .range(de, ate),
    ),
    // Sem lote importado não existe giro para medir — a carteira inteira
    // pareceria parada, o que é falta de dado, não de giro.
    supabase.from("customer_lots").select("id", { count: "exact", head: true }),
    // Última importação de lotes: o giro inteiro depende dela ser diária.
    supabase
      .from("imports")
      .select("criado_em")
      .eq("tipo", "lotes")
      .order("criado_em", { ascending: false })
      .limit(1)
      .maybeSingle(),
    // Receita de produtos (indicadores/robôs) no período.
    buscarTudo<{ valor_comissao_centavos: number }>((de, ate) => {
      let q = supabase
        .from("sales")
        .select("valor_comissao_centavos")
        .eq("status", "confirmada")
        .order("id")
        .range(de, ate);
      if (corte) q = q.gte("ocorreu_em", corte);
      return q;
    }),
    // Contas abertas na Genial dentro do período.
    (() => {
      let q = supabase
        .from("customers")
        .select("id", { count: "exact", head: true })
        .not("conta_aberta_em", "is", null);
      if (corte) q = q.gte("conta_aberta_em", corte);
      return q;
    })(),
    // Clientes dos leads ganhos da coorte — cruzado com o giro dá o último
    // degrau do funil: quem chegou até a primeira operação.
    buscarTudo<{ customer_id: string | null }>((de, ate) => {
      let q = supabase
        .from("leads")
        .select("customer_id")
        .eq("status", "ganho")
        .order("id")
        .range(de, ate);
      if (corte) q = q.gte("criado_em", corte);
      return q;
    }),
    // Motivos de perda, na MESMA coorte do resto (leads criados no período).
    buscarTudo<{ perda_motivo: string | null }>((de, ate) => {
      let q = supabase
        .from("leads")
        .select("perda_motivo")
        .eq("status", "perdido")
        .order("id")
        .range(de, ate);
      if (corte) q = q.gte("criado_em", corte);
      return q;
    }),
    // Atividade da equipe (sempre 30 dias — é ritmo, não coorte): a RPC da
    // 0059 devolve por-autor, mediana da 1ª resposta e totais num
    // round-trip. Era o gargalo medido da página: dois buscarTudo SERIAIS
    // trafegando milhares de interações (~2s) para meia dúzia de números.
    // Sem a migração, cai no caminho antigo.
    (async (): Promise<
      | {
          via: "rpc";
          por_autor: { autor_id: string | null; total: number; hoje: number }[];
          enviadas_total: number;
          mediana_min: number | null;
          respostas: number;
        }
      | {
          via: "cru";
          enviadas: { criado_em: string; autor_id: string | null }[];
          trocas: { lead_id: string; tipo: string; criado_em: string }[];
          erro: string | null;
        }
    > => {
      const { data: agregada, error } = await supabase.rpc(
        "relatorio_equipe_30d",
        {
          p_inicio: corteDiasAtras(30),
          p_inicio_hoje: agoraEmBrasilia().inicioDoDia,
        },
      );
      if (!error && agregada) {
        return {
          via: "rpc",
          ...(agregada as {
            por_autor: {
              autor_id: string | null;
              total: number;
              hoje: number;
            }[];
            enviadas_total: number;
            mediana_min: number | null;
            respostas: number;
          }),
        };
      }
      const [enviadas, trocas] = await Promise.all([
        buscarTudo<{ criado_em: string; autor_id: string | null }>((de, ate) =>
          supabase
            .from("lead_interactions")
            .select("criado_em, autor_id")
            .eq("tipo", "mensagem_enviada")
            .gte("criado_em", corteDiasAtras(30))
            .order("criado_em")
            .order("id")
            .range(de, ate),
        ),
        buscarTudo<{ lead_id: string; tipo: string; criado_em: string }>(
          (de, ate) =>
            supabase
              .from("lead_interactions")
              .select("lead_id, tipo, criado_em")
              .in("tipo", ["mensagem_recebida", "mensagem_enviada"])
              .gte("criado_em", corteDiasAtras(30))
              .order("criado_em")
              .order("id")
              .range(de, ate),
        ),
      ]);
      return {
        via: "cru",
        enviadas: enviadas.dados,
        trocas: trocas.dados,
        erro: enviadas.erro ?? trocas.erro ?? null,
      };
    })(),
    // Definição canônica (0032): cliente falou por último, conversa não
    // resolvida nem adiada, lead não perdido.
    supabase
      .from("v_leads_listas")
      .select("lead_id", { count: "exact", head: true })
      .eq("aguardando_resposta", true),
    supabase
      .from("profiles")
      .select("id, nome, meta_contatos_dia")
      .eq("ativo", true),
    // Velocidade de ativação (0055): janela própria (histórico de lotes,
    // teto 180d), não segue o período — por isso p_inicio nulo.
    supabase.rpc("pagamentos_resumo", { p_inicio: null }),
  ]);

  const r = (data ?? null) as Relatorio | null;

  // ── O caixa ───────────────────────────────────────────────────────────────
  const semDadoDeGiro = (totalLotesImportados ?? 0) === 0;
  // Importação parada = giro, resgate e relatório congelados sem aviso.
  // 1 dia útil de tolerância: sábado e domingo não contam.
  const importeVelhoDias = (() => {
    if (!ultimoImporteLotes?.criado_em) return null;
    const ultimo = new Date(ultimoImporteLotes.criado_em);
    let uteis = 0;
    const cursor = new Date(ultimo);
    const agora = new Date();
    while (cursor < agora) {
      cursor.setDate(cursor.getDate() + 1);
      const dia = cursor.getDay();
      if (dia !== 0 && dia !== 6 && cursor < agora) uteis++;
    }
    return uteis;
  })();
  const lotes30 = giro.reduce((s, g) => s + (g.lotes_30d ?? 0), 0);
  const lotesAnt = giro.reduce((s, g) => s + (g.lotes_30d_anterior ?? 0), 0);
  const deltaLotes =
    lotesAnt > 0 ? Math.round(((lotes30 - lotesAnt) / lotesAnt) * 100) : null;
  const clientesGirando = giro.filter((g) => (g.lotes_30d ?? 0) > 0).length;
  const receitaProdutos = vendasPeriodo.reduce(
    (s, v) => s + (v.valor_comissao_centavos ?? 0),
    0,
  );

  // Concentração: quanto do giro sai de só 10 clientes. É o número de risco
  // que os sócios precisam ver — hoje a mesa depende de pouquíssima gente.
  const top10 = [...giro]
    .sort((a, b) => (b.lotes_30d ?? 0) - (a.lotes_30d ?? 0))
    .slice(0, 10)
    .reduce((s, g) => s + (g.lotes_30d ?? 0), 0);
  const concentracao = lotes30 > 0 ? Math.round((top10 / lotes30) * 100) : null;

  // ── O funil ───────────────────────────────────────────────────────────────
  const giroPorCliente = new Map(
    giro.map((g) => [g.customer_id, g.ultimo_giro_em]),
  );
  const ativados = ganhosCoorte.filter(
    (l) => l.customer_id && giroPorCliente.get(l.customer_id),
  ).length;
  const conversaram = r ? r.total_leads - r.nunca_responderam : 0;
  const funil = r
    ? [
        { rotulo: "Entraram", valor: r.total_leads, detalhe: "leads no CRM" },
        {
          rotulo: "Conversaram",
          valor: conversaram,
          detalhe: "responderam ao menos uma vez",
        },
        {
          rotulo: "Abriram conta",
          valor: r.ganhos,
          detalhe: "viraram cliente na Genial",
        },
        {
          rotulo: "Fizeram o 1º giro",
          valor: ativados,
          detalhe: "operaram — aqui começa a receita",
        },
      ]
    : [];
  const maiorFunil = funil[0]?.valor ?? 0;

  // ── Dinheiro parado e escorrendo ─────────────────────────────────────────
  const nuncaGiraram = giro.filter((g) => g.ultimo_giro_em === null).length;
  const pararam = giro.filter(
    (g) => g.ultimo_giro_em !== null && (g.lotes_30d ?? 0) === 0,
  ).length;
  const caindo = giro.filter(
    (g) =>
      (g.lotes_30d_anterior ?? 0) > 0 &&
      (g.lotes_30d ?? 0) > 0 &&
      (g.lotes_30d ?? 0) < (g.lotes_30d_anterior ?? 0) * 0.75,
  ).length;

  // Velocidade de ativação (6.1): a régua canônica vem da pagamentos_resumo
  // (0055). Sem a migração, tempo_medio_geral não existe e o indicador vira
  // "—" — a página segue de pé.
  type ResumoAtivacao = {
    tempo_medio_geral?: { dias: number | null; n: number } | null;
    por_pessoa?: {
      nome: string;
      tempo_medio_dias: number | null;
      tempo_medio_n?: number | null;
    }[];
  };
  const resumoAtiv = (resumoAtivBruto ?? null) as ResumoAtivacao | null;
  const velGeral = resumoAtiv?.tempo_medio_geral ?? null;
  const velPorVendedor = (resumoAtiv?.por_pessoa ?? []).filter(
    (p) => p.tempo_medio_dias !== null && (p.tempo_medio_n ?? 0) > 0,
  );

  const perdasPorMotivo = (() => {
    if (perdasBrutas.erro !== null) return [];
    const soma = new Map<string, number>();
    for (const l of perdasBrutas.dados) {
      const chave = l.perda_motivo ?? "sem_motivo";
      soma.set(chave, (soma.get(chave) ?? 0) + 1);
    }
    return [...soma.entries()]
      .map(([motivo, total]) => ({ motivo, total }))
      .sort((a, b) => b.total - a.total);
  })();
  const totalPerdas = perdasPorMotivo.reduce((t, x) => t + x.total, 0);

  // ── Aquisição por etiqueta ────────────────────────────────────────────────
  const origens = (r?.por_origem ?? []).map((o) => ({
    origem: o.origem ?? "Sem origem",
    etiqueta: o.etiqueta ?? false,
    campanha: o.campanha ?? false,
    leads: o.leads ?? 0,
    ganhos: o.ganhos ?? 0,
    templates: o.templates ?? 0,
    gasto_centavos: o.gasto_centavos ?? 0,
  }));

  // ── Equipe ────────────────────────────────────────────────────────────────
  const equipe = (equipeAtiva ?? []) as {
    id: string;
    nome: string;
    meta_contatos_dia: number | null;
  }[];
  const nomePorId = new Map(equipe.map((p) => [p.id, p.nome]));
  const metaPorNome = new Map(
    equipe.map((p) => [p.nome, p.meta_contatos_dia ?? 0]),
  );

  // Atividade normalizada: mesmos números pelos dois caminhos (RPC 0059 ou
  // o cálculo antigo em memória, quando a migração ainda não rodou).
  const mensagensPorNome = new Map<string, number>();
  const hojePorNome = new Map<string, number>();
  let medianaMin: number | null = null;
  let respostasMedidas = 0;
  let enviadasTotal: number | null = null;
  let erroAtividade: string | null = null;

  if (atividade.via === "rpc") {
    for (const a of atividade.por_autor) {
      const nome = a.autor_id
        ? (nomePorId.get(a.autor_id) ?? "Outro usuário")
        : "Automação";
      mensagensPorNome.set(nome, (mensagensPorNome.get(nome) ?? 0) + a.total);
      if (a.hoje > 0) {
        hojePorNome.set(nome, (hojePorNome.get(nome) ?? 0) + a.hoje);
      }
    }
    medianaMin = atividade.mediana_min;
    respostasMedidas = atividade.respostas;
    enviadasTotal = atividade.enviadas_total;
  } else {
    // Meta é por DIA: compara com as mensagens de hoje, em Brasília.
    const inicioHoje = agoraEmBrasilia().inicioDoDia;
    for (const linha of atividade.enviadas) {
      const nome = linha.autor_id
        ? (nomePorId.get(linha.autor_id) ?? "Outro usuário")
        : "Automação";
      mensagensPorNome.set(nome, (mensagensPorNome.get(nome) ?? 0) + 1);
      if (linha.criado_em >= inicioHoje) {
        hojePorNome.set(nome, (hojePorNome.get(nome) ?? 0) + 1);
      }
    }

    // Mediana da 1ª resposta (mensagem do cliente → resposta da equipe).
    const conversasPorLead = new Map<
      string,
      { tipo: string; criado_em: string }[]
    >();
    for (const msg of atividade.trocas) {
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
    medianaMin =
      temposMin.length > 0 ? temposMin[Math.floor(temposMin.length / 2)] : null;
    respostasMedidas = temposMin.length;
    enviadasTotal = atividade.erro ? null : atividade.enviadas.length;
    erroAtividade = atividade.erro;
  }

  const atividadeErro = erroAtividade ?? aguardandoErro?.message ?? null;

  // Uma tabela só: leads e resultado (do período) + ritmo (sempre 30d).
  // Vendedor com venda mas sem lead novo no período também aparece — a
  // comissão dele não pode sumir da tela.
  const vendedores = (r?.por_vendedor ?? []).map((v) => ({
    ...v,
    mensagens: mensagensPorNome.get(v.vendedor) ?? 0,
  }));
  for (const [nome, mensagens] of mensagensPorNome) {
    if (!vendedores.some((v) => v.vendedor === nome)) {
      vendedores.push({
        vendedor: nome,
        leads: 0,
        ganhos: 0,
        vendas: 0,
        comissao_centavos: 0,
        mensagens,
      });
    }
  }
  vendedores.sort((a, b) => b.ganhos - a.ganhos || b.mensagens - a.mensagens);

  return (
    <div className="p-2 md:p-3">
      <header className="border-b border-neutral-200 pb-2">
        <h1 className="text-h1 text-neutral-900">Relatórios</h1>
        <p className="mt-1 max-w-[68ch] text-base text-neutral-600">
          Quanto a mesa gira, o que o funil converte e onde há dinheiro parado.
        </p>
      </header>

      <nav aria-label="Período" className="mt-2">
        <ul className="flex flex-wrap gap-1">
          {PERIODOS.map((p) => {
            const ativo = p.dias === periodo.dias;
            return (
              <li key={p.rotulo}>
                <Link
                  href={
                    p.dias === null
                      ? "/relatorios"
                      : `/relatorios?periodo=${p.dias}`
                  }
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
          className="mt-3 max-w-[68ch] rounded-md border border-warning bg-warning-bg px-1.5 py-1 text-sm text-warning"
        >
          Rode as migrações 0022 e 0031 no SQL Editor do Supabase — são elas que
          calculam este relatório.
        </p>
      ) : (
        <>
          {/* ── 1. O caixa ── */}
          <section className="mt-3" aria-labelledby="caixa-titulo">
            <h2
              id="caixa-titulo"
              className="text-xs tracking-[0.06em] text-neutral-600 uppercase"
            >
              O caixa
            </h2>
            {semDadoDeGiro ? (
              <p
                role="alert"
                className="mt-1 max-w-[68ch] rounded-md bg-warning-bg px-1.5 py-1 text-sm text-warning"
              >
                Nenhum lote importado ainda — os números de giro aparecem depois
                da primeira importação em Administração.
              </p>
            ) : importeVelhoDias !== null && importeVelhoDias > 1 ? (
              <p
                role="alert"
                className="mt-1 max-w-[68ch] rounded-md bg-warning-bg px-1.5 py-1 text-sm text-warning"
              >
                A última importação de lotes foi há {importeVelhoDias} dias
                úteis ({formatarData(ultimoImporteLotes?.criado_em ?? null)}) —
                giro, resgate e este relatório estão congelados nessa data.
                Importe em Administração.
              </p>
            ) : null}
            <dl className="mt-1 grid gap-3 border-y border-neutral-200 py-3 sm:grid-cols-2 lg:grid-cols-4">
              <Indicador
                rotulo="Lotes girados (30d)"
                valor={giroErro ? "—" : numero(lotes30)}
                detalhe={
                  deltaLotes === null
                    ? "é isto que paga a mesa"
                    : deltaLotes >= 0
                      ? `${deltaLotes}% acima dos 30 dias anteriores`
                      : `${Math.abs(deltaLotes)}% abaixo dos 30 dias anteriores`
                }
              />
              <Indicador
                rotulo="Clientes girando (30d)"
                valor={giroErro ? "—" : numero(clientesGirando)}
                detalhe={`de ${numero(giro.length)} contas na carteira`}
              />
              <Indicador
                rotulo="Contas abertas"
                valor={
                  contasNovas.count === null ? "—" : numero(contasNovas.count)
                }
                detalhe={
                  periodo.dias === null
                    ? "com data de abertura registrada"
                    : "no período"
                }
              />
              <Indicador
                rotulo="Venda de produtos"
                valor={vendasErro ? "—" : formatarReais(receitaProdutos)}
                detalhe={`${numero(vendasPeriodo.length)} venda(s) confirmada(s) no período`}
              />
            </dl>
          </section>

          {/* ── 2. O funil ── */}
          <section className="mt-3" aria-labelledby="funil-titulo">
            <h2
              id="funil-titulo"
              className="text-xs tracking-[0.06em] text-neutral-600 uppercase"
            >
              O funil do período
            </h2>
            <ol className="mt-1 grid gap-2 rounded-lg border border-neutral-200 bg-neutral-0 p-3 shadow-sm sm:grid-cols-2 lg:grid-cols-4">
              {funil.map((etapa, i) => {
                const anterior = funil[i - 1]?.valor ?? 0;
                const largura =
                  maiorFunil > 0
                    ? Math.max((etapa.valor / maiorFunil) * 100, 2)
                    : 0;
                return (
                  <li key={etapa.rotulo} className="min-w-0">
                    <p className="text-sm font-medium text-neutral-800">
                      {i + 1}. {etapa.rotulo}
                    </p>
                    <p className="mt-0.5 font-mono text-h2 text-neutral-900 tabular-nums">
                      {numero(etapa.valor)}
                      {i > 0 ? (
                        <span className="ml-1 font-sans text-sm text-neutral-600">
                          {percentual(etapa.valor, anterior)} da anterior
                        </span>
                      ) : null}
                    </p>
                    <span
                      aria-hidden
                      className="mt-1 block h-1 overflow-hidden rounded-sm bg-neutral-100"
                    >
                      <span
                        className="block h-full rounded-sm bg-primary-600"
                        style={{ width: `${largura}%` }}
                      />
                    </span>
                    <p className="mt-0.5 text-xs text-neutral-600">
                      {etapa.detalhe}
                    </p>
                  </li>
                );
              })}
            </ol>
            <p className="mt-1 max-w-[68ch] text-sm text-neutral-600">
              De cada 100 leads que entram,{" "}
              <strong>
                {maiorFunil > 0 ? Math.round((ativados / maiorFunil) * 100) : 0}
              </strong>{" "}
              chegam à primeira operação. O degrau mais barato de melhorar é o
              último — essas pessoas já são clientes.
            </p>
          </section>

          {/* ── 3. Dinheiro parado (o único destaque da tela) ── */}
          <section className="mt-3" aria-labelledby="parado-titulo">
            <div className="rounded-lg border border-accent-300 bg-accent-100 p-3">
              <h2 id="parado-titulo" className="text-h3 text-accent-700">
                {giroErro
                  ? "Dinheiro parado"
                  : `${numero(nuncaGiraram)} contas abertas que nunca giraram`}
              </h2>
              <p className="mt-1 max-w-[68ch] text-sm text-accent-700">
                Cliente com conta na Genial que nunca operou não gera nada — é a
                maior receita não realizada da mesa. O roteiro de ativação
                (Profit Pro → 1ª operação → print) existe para esta fila.
              </p>
              <div className="mt-2 flex flex-wrap gap-1">
                <Link
                  href="/leads?lista=primeiro_giro"
                  className="inline-flex h-[32px] items-center rounded-md border border-accent-300 bg-neutral-0 px-1.5 text-sm font-medium text-accent-700 transition-colors duration-[120ms] hover:brightness-95 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-primary-500"
                >
                  Contas novas sem giro
                </Link>
                <Link
                  href="/atendimento"
                  className="inline-flex h-[32px] items-center rounded-md border border-accent-300 bg-neutral-0 px-1.5 text-sm font-medium text-accent-700 transition-colors duration-[120ms] hover:brightness-95 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-primary-500"
                >
                  Coluna Ativação no kanban
                </Link>
              </div>
            </div>

            <dl className="mt-2 grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
              <Indicador
                rotulo="Pararam de girar"
                valor={giroErro ? "—" : numero(pararam)}
                detalhe="já operaram, zeraram nos últimos 30 dias"
              />
              <Indicador
                rotulo="Caindo de volume"
                valor={giroErro ? "—" : numero(caindo)}
                detalhe="giram, mas 25%+ abaixo do mês anterior"
              />
              <Indicador
                rotulo="Concentração do giro"
                valor={concentracao === null ? "—" : `${concentracao}%`}
                detalhe="do volume vem dos 10 maiores clientes"
              />
              <Indicador
                rotulo="Abre→ativa"
                valor={
                  velGeral?.dias === null || velGeral?.dias === undefined
                    ? "—"
                    : `${velGeral.dias}d`
                }
                detalhe={
                  velGeral && velGeral.n > 0
                    ? `média da abertura ao 1º giro (${numero(velGeral.n)} conta(s))`
                    : "sem conta medível ainda"
                }
              />
            </dl>
            {velPorVendedor.length > 0 ? (
              <p className="mt-1 max-w-[68ch] text-xs text-neutral-600">
                Por vendedor:{" "}
                {velPorVendedor
                  .map(
                    (p) =>
                      `${p.nome} ${p.tempo_medio_dias}d (${p.tempo_medio_n})`,
                  )
                  .join(" · ")}
                . Só contas abertas dentro do histórico de lotes (teto de 180
                dias) — este número não segue o período escolhido.
              </p>
            ) : null}
          </section>

          {/* ── 4. Por que perdemos ── */}
          {perdasPorMotivo.length > 0 ? (
            <section className="mt-3" aria-labelledby="perdas-titulo">
              <h2
                id="perdas-titulo"
                className="text-xs tracking-[0.06em] text-neutral-600 uppercase"
              >
                Por que perdemos ({numero(totalPerdas)})
              </h2>
              <ul className="mt-1 flex max-w-[560px] flex-col gap-1">
                {perdasPorMotivo.map((linha) => (
                  <Barra
                    key={linha.motivo}
                    rotulo={
                      MOTIVOS_PERDA[linha.motivo as MotivoPerda] ??
                      "Sem motivo registrado (perda antiga)"
                    }
                    valor={linha.total}
                    maximo={Math.max(...perdasPorMotivo.map((x) => x.total), 1)}
                    extra={percentual(linha.total, totalPerdas)}
                  />
                ))}
              </ul>
              <p className="mt-1 max-w-[68ch] text-xs text-neutral-600">
                Quem sumiu é cadência; concorrente é proposta; quem não quer
                abrir conta é qualificação do público — não derrota da equipe.
              </p>
            </section>
          ) : null}

          {/* ── 5. Aquisição ── */}
          <section className="mt-3" aria-labelledby="aquisicao-titulo">
            <h2
              id="aquisicao-titulo"
              className="text-xs tracking-[0.06em] text-neutral-600 uppercase"
            >
              Aquisição por etiqueta
            </h2>
            <p className="mt-1 max-w-[68ch] text-sm text-neutral-600">
              Gasto = template enviado no período (R$&nbsp;0,25 cada, editável
              em Configurações) mais o lançado à mão por canal. Lead com duas
              etiquetas conta nas duas linhas — não some a coluna.
            </p>
            {origens.length === 0 ? (
              <p className="mt-2 max-w-[68ch] rounded-lg border border-dashed border-neutral-300 p-3 text-sm text-neutral-600">
                Nenhum lead no período escolhido.
              </p>
            ) : (
              <div className="mt-2 overflow-x-auto rounded-lg border border-neutral-200 bg-neutral-0 shadow-sm">
                <table className="w-full min-w-[720px] border-collapse text-left">
                  <thead>
                    <tr className="border-b border-neutral-200 bg-neutral-50">
                      <Th>Origem</Th>
                      <Th alinhar>Leads</Th>
                      <Th alinhar>Ganhos</Th>
                      <Th alinhar>Conversão</Th>
                      <Th alinhar>Templates</Th>
                      <Th alinhar>Gasto</Th>
                      <Th alinhar>Custo por ganho</Th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-neutral-200">
                    {origens.map((o) => (
                      <tr
                        key={`${o.origem}|${o.etiqueta}|${o.campanha}`}
                        className="h-[48px] hover:bg-neutral-50"
                      >
                        <td className="max-w-[240px] truncate px-2 text-sm text-neutral-800">
                          {o.origem}
                          {!o.etiqueta && !o.campanha ? (
                            <span className="ml-1 text-xs text-neutral-400">
                              canal
                            </span>
                          ) : null}
                        </td>
                        <Td>{numero(o.leads)}</Td>
                        <Td>{numero(o.ganhos)}</Td>
                        <Td>{percentual(o.ganhos, o.leads)}</Td>
                        <Td>{numero(o.templates)}</Td>
                        <Td>
                          {o.gasto_centavos > 0
                            ? formatarReais(o.gasto_centavos)
                            : "—"}
                        </Td>
                        <Td>
                          {o.gasto_centavos > 0 && o.ganhos > 0
                            ? formatarReais(
                                Math.round(o.gasto_centavos / o.ganhos),
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

          {/* ── 6. Equipe ── */}
          <section className="mt-3" aria-labelledby="equipe-titulo">
            <h2
              id="equipe-titulo"
              className="text-xs tracking-[0.06em] text-neutral-600 uppercase"
            >
              Equipe
            </h2>
            {atividadeErro !== null ? (
              <p
                role="alert"
                className="mt-1 max-w-[68ch] rounded-md bg-warning-bg px-1.5 py-1 text-sm text-warning"
              >
                Não deu para carregar toda a atividade ({atividadeErro}) — os
                números abaixo podem estar incompletos.
              </p>
            ) : null}
            <dl className="mt-1 grid gap-3 border-y border-neutral-200 py-3 sm:grid-cols-3">
              <Indicador
                rotulo="Equipe responde em"
                valor={
                  medianaMin === null
                    ? "—"
                    : medianaMin < 60
                      ? `${Math.round(medianaMin)}min`
                      : `${(medianaMin / 60).toFixed(1).replace(".", ",")}h`
                }
                detalhe={
                  respostasMedidas > 0
                    ? `mediana de ${numero(respostasMedidas)} resposta(s), 30 dias`
                    : "sem respostas medidas em 30 dias"
                }
              />
              <Indicador
                rotulo="Mensagens enviadas (30d)"
                valor={enviadasTotal === null ? "—" : numero(enviadasTotal)}
                detalhe="pela equipe e automações"
              />
              <Indicador
                rotulo="Aguardando resposta"
                valor={aguardandoErro ? "—" : numero(aguardandoCount ?? 0)}
                detalhe="cliente falou por último e ninguém respondeu"
              />
            </dl>
            {vendedores.length > 0 ? (
              <div className="mt-2 overflow-x-auto rounded-lg border border-neutral-200 bg-neutral-0 shadow-sm">
                <table className="w-full min-w-[640px] border-collapse text-left">
                  <thead>
                    <tr className="border-b border-neutral-200 bg-neutral-50">
                      <Th>Vendedor</Th>
                      <Th alinhar>Leads (período)</Th>
                      <Th alinhar>Ganhos</Th>
                      <Th alinhar>Mensagens (30d)</Th>
                      <Th alinhar>Hoje / meta</Th>
                      <Th alinhar>Vendas</Th>
                      <Th alinhar>Comissão</Th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-neutral-200">
                    {vendedores.map((v) => (
                      <tr
                        key={v.vendedor}
                        className="h-[48px] hover:bg-neutral-50"
                      >
                        <td className="max-w-[200px] truncate px-2 text-sm text-neutral-800">
                          {v.vendedor}
                        </td>
                        <Td>{v.leads > 0 ? numero(v.leads) : "—"}</Td>
                        <Td>{v.ganhos > 0 ? numero(v.ganhos) : "—"}</Td>
                        <Td>{numero(v.mensagens)}</Td>
                        <Td>
                          {v.vendedor === "Automação"
                            ? "—"
                            : `${numero(hojePorNome.get(v.vendedor) ?? 0)}${
                                (metaPorNome.get(v.vendedor) ?? 0) > 0
                                  ? ` / ${numero(metaPorNome.get(v.vendedor) ?? 0)}`
                                  : ""
                              }`}
                        </Td>
                        <Td>{v.vendas > 0 ? numero(v.vendas) : "—"}</Td>
                        <Td>
                          {v.comissao_centavos > 0
                            ? formatarReais(v.comissao_centavos)
                            : "—"}
                        </Td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            ) : null}
            <p className="mt-1 max-w-[68ch] text-xs text-neutral-600">
              Leads, ganhos, vendas e comissão seguem o período escolhido;
              mensagens são sempre dos últimos 30 dias.
            </p>
          </section>
        </>
      )}
    </div>
  );
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
          <span className="mt-0.5 block text-sm text-neutral-600">
            {detalhe}
          </span>
        ) : null}
      </dd>
    </div>
  );
}

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
  const largura =
    maximo > 0 ? Math.max((valor / maximo) * 100, valor > 0 ? 2 : 0) : 0;
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
          className="block h-full rounded-sm bg-primary-600"
          style={{ width: `${largura}%` }}
        />
      </span>
      <span className="w-[56px] shrink-0 text-right font-mono text-sm text-neutral-800 tabular-nums">
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

function Th({
  children,
  alinhar,
}: {
  children: React.ReactNode;
  alinhar?: boolean;
}) {
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
