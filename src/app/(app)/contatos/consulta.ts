import type { createClient } from "@/lib/supabase/server";
import {
  aplicarFiltros,
  selectComFiltros,
  UUID,
  type FiltrosContatos,
} from "./filtros";
import { TETO_FILTRO } from "./selecao";

type Cliente = Awaited<ReturnType<typeof createClient>>;

/**
 * O filtro do PostgREST que deixa de fora os contatos (e as conversas) dos
 * donos ocultos para quem pede (donosOcultosParaMim, lib/privacidade.ts):
 * fica quem não tem dono e quem tem outro dono. null quando não há o que
 * tirar. Vale na tabela leads e na view v_leads_listas, que têm a coluna
 * responsavel_id com o mesmo nome.
 *
 * Só id com cara de uuid entra: a lista vem de settings, e um texto torto
 * gravado ali não pode virar sintaxe do filtro. Id que não é uuid também
 * não casaria com responsavel_id nenhum: tirá-lo não muda o resultado.
 */
export function filtroDonosOcultos(ocultos: readonly string[]): string | null {
  const ids = ocultos.filter((id) => UUID.test(id));
  if (ids.length === 0) return null;
  return `responsavel_id.is.null,responsavel_id.not.in.(${ids.join(",")})`;
}

/**
 * A consulta sem os donos ocultos. Um .or() a mais, que o PostgREST soma
 * aos outros filtros (inclusive a outros .or()) com E.
 */
export function semDonosOcultos<Q extends { or: (filtros: string) => Q }>(
  q: Q,
  ocultos: readonly string[],
): Q {
  const filtro = filtroDonosOcultos(ocultos);
  return filtro ? q.or(filtro) : q;
}

/**
 * A consulta de contatos, num ponto só. A lista da tela, o CSV (o da lista
 * filtrada e o da seleção) e o alcance das ações em massa partem daqui:
 * uma regra de acesso aplicada neste ponto vale ao mesmo tempo para o que a
 * tela mostra, para o que o arquivo leva e para o que a ação em massa
 * consegue mudar. O RLS do banco continua recortando por papel por baixo.
 *
 * `ocultos` é a privacidade entre pessoas da equipe (donosOcultosParaMim):
 * obrigatório, para nenhum caminho novo esquecê-la. Vazio para o admin e
 * para quem nenhuma regra alcança.
 *
 * Devolve a consulta do PostgREST sem ordem nem faixa: cada uso põe as
 * dele. `ids` restringe aos contatos escolhidos na seleção. `contar` pede
 * só o número (count exato, sem linhas): a confirmação do CSV diz quantos
 * vão no arquivo antes de baixar.
 */
export function consultarContatos(
  supabase: Cliente,
  colunas: string,
  {
    filtros,
    ids,
    ocultos,
    contar = false,
  }: {
    filtros?: FiltrosContatos;
    ids?: string[];
    ocultos: readonly string[];
    contar?: boolean;
  },
) {
  const base = supabase
    .from("leads")
    .select(
      filtros ? selectComFiltros(colunas, filtros) : colunas,
      contar ? { count: "exact", head: true } : undefined,
    );
  const filtrada = semDonosOcultos(
    filtros ? aplicarFiltros(base, filtros) : base,
    ocultos,
  );
  return ids ? filtrada.in("id", ids) : filtrada;
}

/**
 * A ordem da lista de contatos, num ponto só: interação mais recente
 * primeiro (nullsFirst=false: quem nunca conversou vai para o fim em vez de
 * encabeçar), depois o cadastro, e o id desempata, senão a página seguinte
 * repetiria ou pularia linhas com a mesma data. A página, o "Marcar os N
 * deste filtro" e o CSV dele usam a mesma: os "primeiros 5.000" do teto são
 * os primeiros que a tela mostra.
 */
// eslint-disable-next-line @typescript-eslint/no-explicit-any -- corta a recursão de tipos do builder
export function naOrdemDaLista<Q extends { order: (...args: any[]) => Q }>(
  q: Q,
): Q {
  return q
    .order("ultima_interacao_em", { ascending: false, nullsFirst: false })
    .order("criado_em", { ascending: false })
    .order("id");
}

/** O instante de um timestamp do banco, ou null (vazio ou ilegível). */
function instante(valor: string | null): number | null {
  if (!valor) return null;
  const ms = Date.parse(valor);
  return Number.isNaN(ms) ? null : ms;
}

/**
 * A ordem de naOrdemDaLista para linhas já lidas: o CSV do filtro inteiro
 * busca as linhas pelo id e as põe na ordem da tela depois. A comparação é
 * em milissegundos; o banco guarda microssegundos, e o empate que sobra
 * cai no cadastro e no id, como lá.
 */
export function compararNaOrdemDaLista(
  a: { id: string; ultima_interacao_em: string | null; criado_em: string },
  b: { id: string; ultima_interacao_em: string | null; criado_em: string },
): number {
  const ia = instante(a.ultima_interacao_em);
  const ib = instante(b.ultima_interacao_em);
  if (ia !== ib) {
    // Quem nunca conversou vai para o fim.
    if (ia === null) return 1;
    if (ib === null) return -1;
    return ib - ia;
  }
  const ca = instante(a.criado_em) ?? 0;
  const cb = instante(b.criado_em) ?? 0;
  if (ca !== cb) return cb - ca;
  return a.id < b.id ? -1 : a.id > b.id ? 1 : 0;
}

/** Do PostgREST: no máximo 1.000 linhas por resposta. */
const PEDACO_LEITURA = 1000;

/**
 * Os ids do filtro da lista, até TETO_FILTRO: o alcance das ações do
 * "Marcar os N deste filtro" e do CSV dele. Lidos todos antes de escrever:
 * a ação muda o que o filtro devolve (tirar a etiqueta do filtro, passar os
 * sem dono para alguém), e ler um pedaço depois do outro, com a escrita no
 * meio, pularia contatos.
 *
 * A leitura vai pelo id, cada pedaço a partir do último id lido, e não pela
 * posição na ordem da lista. A ordem da lista começa pela última interação,
 * que muda a cada mensagem que chega e a cada envio de campanha: lido por
 * posição, o contato que recebia mensagem no meio da leitura subia para o
 * trecho já lido, ficava de fora, e o de baixo vinha duas vezes ("Recebeu a
 * campanha X" com a campanha ainda enviando). O id não muda. Cabendo no
 * teto, vão todos, e a ordem não importa.
 *
 * O último pedaço pede uma linha além do teto: é ela que diz que o filtro
 * passa dele. Aí a ordem volta a importar, porque é ela que escolhe os
 * primeiros, e a leitura refaz o caminho por posição na ordem da lista. O
 * risco acima fica aceito nesse caso: com mensagem chegando no meio, um
 * contato pode ficar fora do corte e outro entrar no lugar dele. O repetido
 * não conta duas vezes.
 */
export async function idsDoFiltro(
  supabase: Cliente,
  filtros: FiltrosContatos,
  ocultos: readonly string[],
): Promise<{ ids: string[]; cortado: boolean } | { erro: string }> {
  const ids: string[] = [];
  let ultimo: string | null = null;
  while (ids.length <= TETO_FILTRO) {
    const pedir = Math.min(PEDACO_LEITURA, TETO_FILTRO + 1 - ids.length);
    let q = consultarContatos(supabase, "id", { filtros, ocultos });
    if (ultimo) q = q.gt("id", ultimo);
    const { data, error } = await q.order("id").limit(pedir);
    if (error) return { erro: error.message };
    const linhas = (data ?? []) as unknown as { id: string }[];
    for (const l of linhas) ids.push(l.id);
    if (linhas.length < pedir) return { ids, cortado: false };
    ultimo = linhas[linhas.length - 1].id;
  }

  // Passou do teto: os primeiros na ordem da lista.
  const vistos = new Set<string>();
  for (let de = 0; de < TETO_FILTRO; de += PEDACO_LEITURA) {
    const ate = Math.min(de + PEDACO_LEITURA, TETO_FILTRO) - 1;
    const { data, error } = await naOrdemDaLista(
      consultarContatos(supabase, "id", { filtros, ocultos }),
    ).range(de, ate);
    if (error) return { erro: error.message };
    const linhas = (data ?? []) as unknown as { id: string }[];
    for (const l of linhas) vistos.add(l.id);
    // O filtro encolheu entre as duas leituras e agora cabe no teto: não
    // houve corte.
    if (linhas.length < ate - de + 1) return { ids: [...vistos], cortado: false };
  }
  return { ids: [...vistos], cortado: true };
}
