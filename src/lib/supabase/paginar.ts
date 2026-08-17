/**
 * O PostgREST do Supabase tem teto de linhas por resposta (max-rows, 1000 por
 * padrão): pedir `limit(5000)` devolve 1000 e o resto some sem aviso — foi o
 * que truncava a Carteira e falseava os percentuais dos Relatórios.
 *
 * Esta função busca em lotes até acabar, então agregações e exportações
 * enxergam a base inteira sem depender de configuração do painel.
 *
 * Use para AGREGAR e EXPORTAR. Para listar em tela, pagine de verdade —
 * despejar milhares de linhas em HTML é o que derrubava o Safari do iPhone.
 */

const LOTE = 1000;
const TETO_SEGURANCA = 50_000;

export async function buscarTudo<T>(
  montarConsulta: (
    de: number,
    ate: number,
  ) => PromiseLike<{ data: T[] | null; error: { message: string } | null }>,
): Promise<{ dados: T[]; erro: string | null }> {
  const dados: T[] = [];

  for (let de = 0; de < TETO_SEGURANCA; de += LOTE) {
    const { data, error } = await montarConsulta(de, de + LOTE - 1);
    if (error) return { dados, erro: error.message };
    if (!data || data.length === 0) break;

    dados.push(...data);
    if (data.length < LOTE) break; // último lote
  }

  return { dados, erro: null };
}
