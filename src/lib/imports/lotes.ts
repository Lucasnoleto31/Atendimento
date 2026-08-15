import { campo, normalizarData, normalizarNumero, type LinhaCsv } from "../csv.ts";
import {
  COLUNAS_CONTA,
  COLUNAS_DATA,
  COLUNAS_LOTES,
  COLUNAS_NOME,
  normalizarConta,
} from "./tabular.ts";

export type LoteAgregado = {
  conta: string;
  nome: string | null;
  referencia: string;
  quantidade: number;
};

export type PreparoLotes = {
  agregados: LoteAgregado[];
  totalLinhas: number;
  erros: string[];
};

/**
 * Soma os lotes por conta + dia. O arquivo da corretora traz uma linha por
 * ativo/plataforma, então a mesma conta aparece várias vezes no mesmo dia.
 */
export function prepararLotes(
  linhas: LinhaCsv[],
  dataPadrao: string,
): PreparoLotes {
  const mapa = new Map<string, LoteAgregado>();
  const erros: string[] = [];

  linhas.forEach((linha, i) => {
    const numeroLinha = i + 2;
    const conta = normalizarConta(campo(linha, ...COLUNAS_CONTA));
    const quantidade = normalizarNumero(campo(linha, ...COLUNAS_LOTES));
    const referencia =
      normalizarData(campo(linha, ...COLUNAS_DATA)) ?? dataPadrao;

    if (!conta) {
      erros.push(`Linha ${numeroLinha}: conta inválida.`);
      return;
    }
    if (quantidade === null || quantidade < 0) {
      erros.push(`Linha ${numeroLinha}: quantidade de lotes inválida.`);
      return;
    }

    const chave = `${conta}|${referencia}`;
    const existente = mapa.get(chave);

    if (existente) {
      existente.quantidade += quantidade;
    } else {
      mapa.set(chave, {
        conta,
        nome: campo(linha, ...COLUNAS_NOME) || null,
        referencia,
        quantidade,
      });
    }
  });

  return {
    agregados: [...mapa.values()],
    totalLinhas: linhas.length,
    erros,
  };
}
