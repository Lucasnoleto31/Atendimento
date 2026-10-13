import { createClient } from "@/lib/supabase/server";
import { cargaDaEquipe } from "@/lib/distribuicao";
import { agoraEmBrasilia, formatarDataCurta } from "@/lib/format";
import { donoOculto, donosOcultosParaMim } from "@/lib/privacidade";
import { semDonosOcultos } from "@/app/(app)/contatos/consulta";
import {
  FILTROS_FILA_PADRAO,
  hrefConversa,
  type FiltrosFila,
} from "@/app/(app)/chat/mensagem";
import { PERIODO_PADRAO, type Periodo } from "./periodo";

/*
 * As leituras do Relatório. Só lê o que o banco já tem, com o RLS de quem
 * está logado (a página só abre para quem vê a base inteira). Tudo sai em
 * paralelo; o que depende de outra leitura (a carga depende da equipe, as
 * páginas das recebidas dependem do total) encadeia na própria promessa e
 * não espera o resto da primeira onda.
 *
 * Idas ao banco por abertura (equipe de N pessoas, R recebidas no mês):
 *   1ª onda   RPC da equipe · equipe · recebidas (1ª página + total) ·
 *             quem espera resposta · sem dono · resolvidas (1ª página +
 *             total) · 30 contagens das enviadas pela equipe, uma por dia
 *             · com período de hoje ou 7 dias, a contagem das recebidas
 *             do período
 *   2ª onda   3N contagens por pessoa (só gestão, como no chat): a carga
 *             do rodízio e a divisão dela em Caixa e adiadas · as outras
 *             páginas das recebidas (R / 1000 − 1) · páginas extras das
 *             resolvidas (só acima de 1000)
 *
 * O período (periodo.ts) muda os números de cima, a Equipe e as
 * Resolvidas. O gráfico por dia e o mapa de calor ficam nos 30 dias e nas 4
 * semanas inteiras: a leitura das recebidas é sempre a dos 30 dias.
 * Duas idas em sequência; o que vem com corpo é só criado_em das recebidas,
 * horas_esperando de quem espera e responsavel_id das resolvidas.
 *
 * Privacidade entre pessoas da equipe (Administração > Privacidade): o que
 * leva à conversa segue a regra de quem abre. "Esperando resposta" não
 * conta a conversa de um dono oculto (o número tem de bater com a visão
 * Aguardando do chat, para onde a linha leva), e a carga por pessoa não
 * lista o dono oculto (a linha levaria à fila dele, que sai vazia). Ficam
 * as contagens agregadas, que não abrem conversa: recebidas, enviadas, a
 * atividade e as resolvidas por pessoa, a mediana, o mapa e o "sem dono"
 * (sem dono nunca é oculto).
 */

const DIA_MS = 86_400_000;
/** Brasil sem horário de verão desde 2019: o deslocamento é fixo. */
const DESLOCAMENTO_MS = 3 * 3_600_000;

export const DIAS = 30;
/** Dias do gráfico por dia: os últimos 30 de calendário, hoje incluído. */
const DIAS_GRAFICO = 30;
/** O mapa de calor usa semanas inteiras (cada célula conta 4 vezes). */
export const SEMANAS_MAPA = 4;

/** O corte de linhas do PostgREST no projeto. */
const PAGINA = 1000;
/** Acima disto o mapa e o gráfico das recebidas ficam de fora: seriam mais
 *  de 30 idas para desenhar uma tela. O total continua aparecendo, e o
 *  painel diz o motivo (é corte, não falha). */
export const TETO_RECEBIDAS = 30_000;

/** Visão Caixa no PostgREST, a mesma de conversas/lista.ts (que é "use
 *  server" e não exporta constante): em aberto com conversa, ou adiada
 *  vencida. A contagem de sem dono do chat parte dela. */
const FILTRO_CAIXA =
  "and(em_aberto.eq.true,ultima_mensagem_em.not.is.null),adiado_vencido.eq.true";

const SEMANA = [
  "domingo",
  "segunda",
  "terça",
  "quarta",
  "quinta",
  "sexta",
  "sábado",
] as const;

// ─────────────────────────────── formato ───────────────────────────────

export type FaixasEspera = {
  /** até 15 min · 15 min a 1 h · 1 h a 4 h · mais de 4 h */
  contagens: [number, number, number, number];
  total: number;
  /** Horas da espera mais longa; null sem ninguém esperando. */
  maisAntiga: number | null;
};

export type CargaPessoa = {
  id: string;
  nome: string;
  /** A carga do rodízio (lib/distribuicao.ts): o número da linha. */
  abertas: number;
  noRodizio: boolean;
  /** A Caixa do chat com a pessoa, e quantas conversas ela mostra; null:
   *  a contagem falhou. */
  href: string;
  caixa: number | null;
  /** A visão Adiadas com a pessoa (as adiadas no prazo, que a Caixa não
   *  mostra e a carga conta), e quantas são. */
  hrefAdiadas: string;
  adiadas: number | null;
};

export type DiaGrafico = {
  /** "15/09" */
  rotulo: string;
  /** "terça" */
  semana: string;
  recebidas: number;
  /** null: a contagem deste dia falhou. */
  enviadas: number | null;
};

export type DadosRelatorio = {
  /** O período escolhido e o começo dele, em ISO; `agora` é o fim. */
  periodo: Periodo;
  inicio: string;
  agora: string;
  /** "14h32", em Brasília. */
  agoraHora: string;

  fila: {
    /** null: a leitura falhou. */
    espera: FaixasEspera | null;
    semDono: number | null;
    /** A carga por pessoa é só da gestão, como no chat; o compliance vê o
     *  grupo sem ela (e sem aviso de falha). */
    comCarga: boolean;
    /** null: a leitura falhou ou o papel não vê a carga. */
    carga: CargaPessoa[] | null;
    hrefEsperando: string;
    hrefSemDono: string;
  };

  /** null: a contagem falhou e o número sai como "—". */
  recebidas: number | null;
  /** true: as recebidas passaram do TETO_RECEBIDAS e o gráfico por dia e o
   *  mapa ficaram de fora de propósito (corte, não falha). */
  recebidasAcimaDoTeto: boolean;
  /** As recebidas dos 30 dias, a leitura do gráfico e do mapa (o corte
   *  vale para ela, qualquer que seja o período); null: falhou. */
  recebidas30d: number | null;
  /** null quando a atividade da equipe (RPC) não carregou. */
  atividade: {
    enviadas: number;
    /** Enviadas com autor (as automáticas fora), mesmo sem os nomes. */
    daEquipe: number;
    mediana: number | null;
    respostas: number;
    /** null: os nomes da equipe não carregaram e o ranking por nome não se
     *  desenha (juntaria todo mundo em "Outro usuário"). */
    equipe: { nome: string; total: number; hoje: number }[] | null;
    automaticas: { total: number; hoje: number };
  } | null;

  /** Recebidas e enviadas pela equipe por dia; null quando as recebidas
   *  não vieram (o gráfico não se desenha pela metade do dado). */
  porDia: DiaGrafico[] | null;

  /** 7 × 24, segunda primeiro, hora 0 a 23 em Brasília. */
  mapa: { celulas: number[]; de: string; ate: string } | null;

  resolvidas: {
    total: number;
    /** null: os nomes da equipe não carregaram (como em atividade.equipe). */
    porPessoa: { nome: string; total: number }[] | null;
    semDono: number;
  } | null;

  /** Partes que não carregaram, para o aviso do topo. */
  falhas: string[];
};

// ─────────────────────────────── contas ────────────────────────────────

/** "9h" ou "18h30". */
function horaEmTexto(hora: number, minuto: number) {
  return minuto ? `${hora}h${String(minuto).padStart(2, "0")}` : `${hora}h`;
}

/** aaaa-mm-dd do instante, no dia de Brasília. */
function diaDe(ms: number) {
  return new Date(ms - DESLOCAMENTO_MS).toISOString().slice(0, 10);
}

/** Faixas pela última mensagem recebida (horas_esperando da view). */
export function faixasDeEspera(horas: number[]): FaixasEspera {
  const contagens: [number, number, number, number] = [0, 0, 0, 0];
  let maisAntiga: number | null = null;
  for (const h of horas) {
    if (h <= 0.25) contagens[0]++;
    else if (h <= 1) contagens[1]++;
    else if (h <= 4) contagens[2]++;
    else contagens[3]++;
    if (maisAntiga === null || h > maisAntiga) maisAntiga = h;
  }
  return { contagens, total: horas.length, maisAntiga };
}

/**
 * Recebidas por dia (os 30 dias do gráfico) e por dia da semana × hora (as
 * 4 semanas inteiras até ontem). Conta em Brasília pela aritmética do
 * deslocamento fixo: milhares de instantes, sem Intl por linha.
 */
export function distribuirRecebidas(
  instantes: number[],
  hojeMs: number,
): { porDia: number[]; mapa: number[] } {
  const porDia = new Array<number>(DIAS_GRAFICO).fill(0);
  const mapa = new Array<number>(7 * 24).fill(0);
  // hojeMs é a meia-noite de Brasília: tirando o deslocamento, cai na
  // meia-noite UTC, e o número do dia sai exato.
  const ultimoDia = Math.floor((hojeMs - DESLOCAMENTO_MS) / DIA_MS);
  const primeiroDia = ultimoDia - (DIAS_GRAFICO - 1);
  const inicioMapa = hojeMs - SEMANAS_MAPA * 7 * DIA_MS;

  for (const t of instantes) {
    const local = t - DESLOCAMENTO_MS;
    const indice = Math.floor(local / DIA_MS) - primeiroDia;
    if (indice >= 0 && indice < DIAS_GRAFICO) porDia[indice]++;
    if (t >= inicioMapa && t < hojeMs) {
      const d = new Date(local);
      // getUTCDay: 0 é domingo; a linha 0 do mapa é segunda.
      const linha = (d.getUTCDay() + 6) % 7;
      mapa[linha * 24 + d.getUTCHours()]++;
    }
  }
  return { porDia, mapa };
}

// ─────────────────────────────── leituras ──────────────────────────────

type Cliente = Awaited<ReturnType<typeof createClient>>;

/**
 * criado_em de todas as recebidas da janela. A 1ª página traz o total
 * (count exact) e as outras saem juntas, em paralelo. A ordem
 * (criado_em, id) não muda com mensagem nova chegando no meio: ela entra
 * no fim, depois do teto `agora`. Acima do TETO_RECEBIDAS volta sem os
 * instantes e com `acimaDoTeto`, que não é falha.
 */
async function lerRecebidas(
  supabase: Cliente,
  inicio: string,
  agora: string,
): Promise<{
  total: number | null;
  instantes: number[] | null;
  acimaDoTeto: boolean;
}> {
  const consulta = (contar: boolean) =>
    supabase
      .from("lead_interactions")
      .select("criado_em", contar ? { count: "exact" } : undefined)
      .eq("tipo", "mensagem_recebida")
      .gte("criado_em", inicio)
      .lte("criado_em", agora)
      .order("criado_em", { ascending: true })
      .order("id", { ascending: true });

  const primeira = await consulta(true).range(0, PAGINA - 1);
  if (primeira.error) {
    return { total: null, instantes: null, acimaDoTeto: false };
  }
  const total = primeira.count ?? 0;
  const linhas = (primeira.data ?? []) as { criado_em: string }[];
  const instantes = linhas.map((l) => Date.parse(l.criado_em));
  if (linhas.length >= total) return { total, instantes, acimaDoTeto: false };
  if (total > TETO_RECEBIDAS) {
    return { total, instantes: null, acimaDoTeto: true };
  }
  if (linhas.length === 0) {
    return { total, instantes: null, acimaDoTeto: false };
  }

  // O tamanho da página é o que o servidor devolveu: se o corte do projeto
  // for menor que 1000, as páginas seguem o corte e nada fica de fora.
  const tamanho = linhas.length;
  const faltam = Math.ceil((total - tamanho) / tamanho);
  const resto = await Promise.all(
    Array.from({ length: faltam }, (_, i) => {
      const de = (i + 1) * tamanho;
      return consulta(false).range(de, de + tamanho - 1);
    }),
  );
  if (resto.some((r) => r.error)) {
    return { total, instantes: null, acimaDoTeto: false };
  }
  for (const r of resto) {
    for (const l of (r.data ?? []) as { criado_em: string }[]) {
      instantes.push(Date.parse(l.criado_em));
    }
  }
  return { total, instantes, acimaDoTeto: false };
}

/** Quantas recebidas no período, sem trazer linha (o período de hoje ou de
 *  7 dias; o de 30 sai junto com os instantes do gráfico). */
async function contarRecebidas(
  supabase: Cliente,
  inicio: string,
  agora: string,
): Promise<number | null> {
  const { count, error } = await supabase
    .from("lead_interactions")
    .select("id", { count: "exact", head: true })
    .eq("tipo", "mensagem_recebida")
    .gte("criado_em", inicio)
    .lte("criado_em", agora);
  return error ? null : (count ?? 0);
}

/**
 * Por pessoa, as duas filas do chat em que a carga dela aparece: a Caixa
 * (o FILTRO_CAIXA, como o chat conta) e as Adiadas no prazo (a regra da
 * visão Adiadas em conversas/lista.ts). A carga do rodízio conta as duas;
 * a Caixa sozinha não mostra as adiadas, e o número do link tem de ser o
 * da fila que ele abre. null: a contagem falhou.
 */
async function dividirCarga(
  supabase: Cliente,
  ids: string[],
  agoraData: Date,
): Promise<Map<string, { caixa: number | null; adiadas: number | null }>> {
  const agoraIso = agoraData.toISOString();
  const tresDias = new Date(agoraData.getTime() - 3 * DIA_MS).toISOString();
  const linhas = await Promise.all(
    ids.map(async (id) => {
      const [caixa, adiadas] = await Promise.all([
        supabase
          .from("v_leads_listas")
          .select("lead_id", { count: "exact", head: true })
          .or(FILTRO_CAIXA)
          .eq("responsavel_id", id),
        supabase
          .from("leads")
          .select("id", { count: "exact", head: true })
          .eq("responsavel_id", id)
          .not("chat_adiado_em", "is", null)
          .is("chat_resolvido_em", null)
          .neq("status", "perdido")
          .or(
            `chat_adiado_ate.gte.${agoraIso},and(chat_adiado_ate.is.null,chat_adiado_em.gte.${tresDias})`,
          ),
      ]);
      return [
        id,
        {
          caixa: caixa.error ? null : (caixa.count ?? 0),
          adiadas: adiadas.error ? null : (adiadas.count ?? 0),
        },
      ] as const;
    }),
  );
  return new Map(linhas);
}

/** responsavel_id das conversas resolvidas na janela, com o mesmo esquema
 *  de páginas (quase sempre cabe numa). */
async function lerResolvidas(
  supabase: Cliente,
  inicio: string,
  agora: string,
): Promise<(string | null)[] | null> {
  const consulta = (contar: boolean) =>
    supabase
      .from("leads")
      .select("responsavel_id", contar ? { count: "exact" } : undefined)
      .gte("chat_resolvido_em", inicio)
      .lte("chat_resolvido_em", agora)
      .order("id", { ascending: true });

  const primeira = await consulta(true).range(0, PAGINA - 1);
  if (primeira.error) return null;
  const total = primeira.count ?? 0;
  const linhas = (primeira.data ?? []) as { responsavel_id: string | null }[];
  const ids = linhas.map((l) => l.responsavel_id);
  if (linhas.length >= total) return ids;
  if (linhas.length === 0) return null;

  const tamanho = linhas.length;
  const faltam = Math.ceil((total - tamanho) / tamanho);
  const resto = await Promise.all(
    Array.from({ length: faltam }, (_, i) => {
      const de = (i + 1) * tamanho;
      return consulta(false).range(de, de + tamanho - 1);
    }),
  );
  if (resto.some((r) => r.error)) return null;
  for (const r of resto) {
    for (const l of (r.data ?? []) as { responsavel_id: string | null }[]) {
      ids.push(l.responsavel_id);
    }
  }
  return ids;
}

/** Quem espera resposta agora: a mesma linha da visão Aguardando do chat
 *  (aguardando_resposta), só com as horas, sem os donos ocultos para quem
 *  abre. Raro passar de uma página; se passar, as seguintes vêm em
 *  sequência. */
async function lerEspera(
  supabase: Cliente,
  ocultos: readonly string[],
): Promise<number[] | null> {
  const horas: number[] = [];
  for (let de = 0; ; de += PAGINA) {
    const { data, error } = await semDonosOcultos(
      supabase
        .from("v_leads_listas")
        .select("horas_esperando")
        .eq("aguardando_resposta", true),
      ocultos,
    )
      .order("lead_id", { ascending: true })
      .range(de, de + PAGINA - 1);
    if (error) return null;
    const linhas = (data ?? []) as { horas_esperando: number | null }[];
    for (const l of linhas) {
      if (l.horas_esperando !== null) horas.push(Number(l.horas_esperando));
    }
    if (linhas.length < PAGINA) return horas;
  }
}

type Pessoa = {
  id: string;
  nome: string;
  ativo: boolean | null;
  papel: string;
  recebe_leads: boolean | null;
};

type Atividade = {
  por_autor: { autor_id: string | null; total: number; hoje: number }[];
  enviadas_total: number;
  mediana_min: number | null;
  respostas: number;
};

const filtro = (parcial: Partial<FiltrosFila>) =>
  hrefConversa(null, { ...FILTROS_FILA_PADRAO, ...parcial });

/**
 * `comCarga`: a carga por pessoa só sai para a gestão, a mesma regra do
 * chat (carregarCargaEquipe em conversas/lista.ts); para o compliance as N
 * contagens nem saem.
 */
export async function carregarRelatorio(
  {
    comCarga,
    periodo = PERIODO_PADRAO,
  }: { comCarga: boolean; periodo?: Periodo },
  agoraData: Date = new Date(),
): Promise<DadosRelatorio> {
  const supabase = await createClient();
  const agora = agoraData.toISOString();
  // A janela do gráfico e do mapa: sempre os 30 dias.
  const inicio30 = new Date(agoraData.getTime() - DIAS * DIA_MS).toISOString();
  const brasilia = agoraEmBrasilia(agoraData);
  const hojeMs = Date.parse(brasilia.inicioDoDia);
  // A janela dos números do período.
  const inicio =
    periodo === "hoje"
      ? new Date(hojeMs).toISOString()
      : periodo === "7d"
        ? new Date(agoraData.getTime() - 7 * DIA_MS).toISOString()
        : inicio30;

  // Os 30 dias do gráfico, do mais antigo para hoje: começo de cada um em
  // ISO (UTC), para a contagem das enviadas.
  const comecos = Array.from(
    { length: DIAS_GRAFICO },
    (_, i) => hojeMs - (DIAS_GRAFICO - 1 - i) * DIA_MS,
  );

  const pessoasP = supabase
    .from("profiles")
    .select("id, nome, ativo, papel, recebe_leads")
    .then((r) => (r.error ? null : ((r.data ?? []) as Pessoa[])));
  // Uma leitura por request (cache): a página já a fez ao conferir o
  // perfil. Erro aqui derruba a página, em vez de mostrar o que a regra
  // esconde.
  const ocultosP = donosOcultosParaMim();

  // A carga é a conta do rodízio (lib/distribuicao.ts), para as mesmas
  // pessoas da faixa Equipe do chat: ativas, menos o compliance, que só lê.
  // Menos o dono oculto para quem abre: a linha dele levaria à fila dele,
  // que sai vazia.
  const cargaP = Promise.all([pessoasP, ocultosP]).then(
    async ([pessoas, ocultos]) => {
      if (!comCarga || !pessoas) return null;
      const equipe = pessoas.filter(
        (p) =>
          p.ativo === true &&
          p.papel !== "compliance" &&
          !donoOculto(p.id, ocultos),
      );
      const ids = equipe.map((p) => p.id);
      const [carga, divisao] = await Promise.all([
        cargaDaEquipe(supabase, ids),
        dividirCarga(supabase, ids, agoraData),
      ]);
      if ([...carga.values()].some((n) => n === null)) return null;
      return equipe
        .map((p) => ({
          id: p.id,
          nome: p.nome,
          abertas: carga.get(p.id) ?? 0,
          noRodizio: p.recebe_leads === true,
          href: filtro({ atendentes: [p.id] }),
          caixa: divisao.get(p.id)?.caixa ?? null,
          hrefAdiadas: filtro({ visao: "adiadas", atendentes: [p.id] }),
          adiadas: divisao.get(p.id)?.adiadas ?? null,
        }))
        .sort(
          (a, b) =>
            b.abertas - a.abertas || a.nome.localeCompare(b.nome, "pt-BR"),
        );
    },
  );

  const [
    pessoas,
    carga,
    { data: agregada, error: erroEquipe },
    recebidasR,
    recebidasDoPeriodo,
    espera,
    semDonoR,
    resolvidasIds,
    enviadasPorDia,
  ] = await Promise.all([
    pessoasP,
    cargaP,
    // Mensagens por autor, mediana da 1ª resposta e total enviado numa ida
    // só (0064): o cálculo em janela única roda no banco, sem trazer linhas.
    // O começo é o do período (a função recebe qualquer começo).
    supabase.rpc("relatorio_equipe_30d", {
      p_inicio: inicio,
      p_inicio_hoje: brasilia.inicioDoDia,
    }),
    lerRecebidas(supabase, inicio30, agora),
    periodo === "30d"
      ? Promise.resolve(undefined)
      : contarRecebidas(supabase, inicio, agora),
    ocultosP.then((ocultos) => lerEspera(supabase, ocultos)),
    // O "Sem dono" do chat: a Caixa sem responsável, qualquer escopo.
    supabase
      .from("v_leads_listas")
      .select("lead_id", { count: "exact", head: true })
      .or(FILTRO_CAIXA)
      .is("responsavel_id", null),
    lerResolvidas(supabase, inicio, agora),
    // Enviadas pela equipe (com autor; sem autor é envio automático), uma
    // contagem por dia de Brasília pelo índice (tipo, criado_em): 30
    // respostas sem corpo em vez de milhares de linhas.
    Promise.all(
      comecos.map((ms) =>
        supabase
          .from("lead_interactions")
          .select("id", { count: "exact", head: true })
          .eq("tipo", "mensagem_enviada")
          .not("autor_id", "is", null)
          .gte("criado_em", new Date(ms).toISOString())
          .lt("criado_em", new Date(ms + DIA_MS).toISOString())
          .then((r) => (r.error ? null : (r.count ?? 0))),
      ),
    ),
  ]);

  const falhas: string[] = [];
  const nomePorId = new Map((pessoas ?? []).map((p) => [p.id, p.nome]));
  // Sem os nomes, todo autor viraria "Outro usuário" e o ranking juntaria a
  // equipe inteira numa linha: os rankings por nome ficam de fora (null).
  if (!pessoas) falhas.push("os nomes da equipe");

  // ── Atividade da equipe (como antes) ──
  const atividadeBruta = erroEquipe ? null : (agregada as Atividade | null);
  // Uma linha por pessoa. Sem autor é envio automático (os disparos e a
  // cadência antiga, que ainda roda): fica fora do ranking, que compara
  // gente, e vira uma linha à parte.
  const porNome = new Map<string, { total: number; hoje: number }>();
  const automaticas = { total: 0, hoje: 0 };
  let daEquipe = 0;
  for (const a of atividadeBruta?.por_autor ?? []) {
    if (!a.autor_id) {
      automaticas.total += a.total;
      automaticas.hoje += a.hoje;
      continue;
    }
    daEquipe += a.total;
    const nome = nomePorId.get(a.autor_id) ?? "Outro usuário";
    const atual = porNome.get(nome) ?? { total: 0, hoje: 0 };
    porNome.set(nome, {
      total: atual.total + a.total,
      hoje: atual.hoje + a.hoje,
    });
  }
  const equipe =
    pessoas || porNome.size === 0
      ? [...porNome.entries()]
          .map(([nome, n]) => ({ nome, ...n }))
          .sort((a, b) => b.total - a.total)
      : null;
  if (!atividadeBruta) falhas.push("a atividade da equipe");

  // ── Recebidas: total do período, por dia e mapa ──
  const recebidas =
    recebidasDoPeriodo === undefined ? recebidasR.total : recebidasDoPeriodo;
  if (recebidas === null) falhas.push("as recebidas");
  let porDia: DiaGrafico[] | null = null;
  let mapa: DadosRelatorio["mapa"] = null;
  if (recebidasR.instantes) {
    const dist = distribuirRecebidas(recebidasR.instantes, hojeMs);
    porDia = comecos.map((ms, i) => {
      const dia = diaDe(ms);
      return {
        rotulo: formatarDataCurta(dia),
        semana: SEMANA[new Date(ms - DESLOCAMENTO_MS).getUTCDay()],
        recebidas: dist.porDia[i],
        enviadas: enviadasPorDia[i],
      };
    });
    mapa = {
      celulas: dist.mapa,
      de: formatarDataCurta(diaDe(hojeMs - SEMANAS_MAPA * 7 * DIA_MS)),
      ate: formatarDataCurta(diaDe(hojeMs - DIA_MS)),
    };
  } else if (
    !recebidasR.acimaDoTeto &&
    // Com o período de 30 dias, a falha das recebidas já entrou na lista.
    (recebidasR.total !== null || recebidasDoPeriodo !== undefined)
  ) {
    // Acima do teto não é falha: o painel diz o motivo no lugar do gráfico.
    falhas.push("o volume por dia e o horário de pico");
  }
  if (porDia && enviadasPorDia.some((n) => n === null)) {
    falhas.push("parte das enviadas por dia");
  }

  // ── Agora ──
  if (!espera) falhas.push("quem espera resposta");
  if (semDonoR.error) falhas.push("as conversas sem dono");
  // Para quem não é gestão a carga não sai de propósito: não é falha.
  if (comCarga && !carga) falhas.push("a carga da equipe");
  if (carga?.some((p) => p.caixa === null || p.adiadas === null)) {
    falhas.push("a divisão da carga entre Caixa e adiadas");
  }

  // ── Resolvidas por responsável ──
  let resolvidas: DadosRelatorio["resolvidas"] = null;
  if (resolvidasIds) {
    const contagem = new Map<string, number>();
    let semDono = 0;
    for (const id of resolvidasIds) {
      if (!id) {
        semDono++;
        continue;
      }
      const nome = nomePorId.get(id) ?? "Outro usuário";
      contagem.set(nome, (contagem.get(nome) ?? 0) + 1);
    }
    resolvidas = {
      total: resolvidasIds.length,
      porPessoa:
        pessoas || contagem.size === 0
          ? [...contagem.entries()]
              .map(([nome, total]) => ({ nome, total }))
              .sort((a, b) => b.total - a.total)
          : null,
      semDono,
    };
  } else {
    falhas.push("as resolvidas");
  }

  return {
    periodo,
    inicio,
    agora,
    agoraHora: horaEmTexto(brasilia.hora, brasilia.minuto),
    fila: {
      espera: espera ? faixasDeEspera(espera) : null,
      semDono: semDonoR.error ? null : (semDonoR.count ?? 0),
      comCarga,
      carga,
      hrefEsperando: filtro({ visao: "aguardando" }),
      hrefSemDono: filtro({ escopo: "semDono" }),
    },
    recebidas,
    recebidasAcimaDoTeto: recebidasR.acimaDoTeto,
    recebidas30d: recebidasR.total,
    atividade: atividadeBruta
      ? {
          enviadas: atividadeBruta.enviadas_total,
          daEquipe,
          mediana: atividadeBruta.mediana_min,
          respostas: atividadeBruta.respostas,
          equipe,
          automaticas,
        }
      : null,
    porDia,
    mapa,
    resolvidas,
    falhas,
  };
}
