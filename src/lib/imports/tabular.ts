import ExcelJS from "exceljs";
import { lerCsv, type LinhaCsv } from "../csv.ts";

export type Aba = { nome: string; linhas: LinhaCsv[] };

/**
 * Lê CSV ou Excel (.xlsx) e devolve todas as abas com cabeçalho normalizado
 * (minúsculas, sem acento, _ no lugar de espaço) — o mesmo formato do lerCsv.
 */
export async function lerTabela(
  nomeArquivo: string,
  dados: ArrayBuffer,
): Promise<Aba[]> {
  if (/\.xlsx?$|\.xlsm$/i.test(nomeArquivo)) {
    return lerExcel(dados);
  }

  const texto = new TextDecoder("utf-8").decode(dados);
  return [{ nome: "csv", linhas: lerCsv(texto) }];
}

async function lerExcel(dados: ArrayBuffer): Promise<Aba[]> {
  const wb = new ExcelJS.Workbook();
  await wb.xlsx.load(dados);

  const abas: Aba[] = [];

  wb.eachSheet((ws) => {
    const linhaCabecalho = ws.getRow(1);
    const colunas: { indice: number; nome: string }[] = [];

    linhaCabecalho.eachCell((celula, indice) => {
      const nome = normalizarCabecalho(valorTexto(celula.value));
      if (nome) colunas.push({ indice, nome });
    });

    if (colunas.length === 0) return;

    const linhas: LinhaCsv[] = [];
    ws.eachRow((row, numero) => {
      if (numero === 1) return;

      const linha: LinhaCsv = {};
      let temValor = false;

      for (const coluna of colunas) {
        const valor = valorTexto(row.getCell(coluna.indice).value);
        linha[coluna.nome] = valor;
        if (valor) temValor = true;
      }

      if (temValor) linhas.push(linha);
    });

    abas.push({ nome: ws.name, linhas });
  });

  return abas;
}

/** Converte qualquer valor de célula do exceljs em texto estável. */
function valorTexto(valor: ExcelJS.CellValue): string {
  if (valor === null || valor === undefined) return "";

  if (valor instanceof Date) {
    return valor.toISOString().slice(0, 10);
  }

  if (typeof valor === "object") {
    if ("richText" in valor) {
      return valor.richText.map((t) => t.text).join("").trim();
    }
    if ("result" in valor) {
      return valorTexto(valor.result as ExcelJS.CellValue);
    }
    if ("text" in valor) {
      return String(valor.text).trim();
    }
    if ("error" in valor) {
      return "";
    }
    return "";
  }

  return String(valor).trim();
}

function normalizarCabecalho(nome: string) {
  return nome
    .trim()
    .toLowerCase()
    .normalize("NFD")
    .replace(/\p{Diacritic}/gu, "")
    .replace(/[^a-z0-9]+/g, "_")
    .replace(/^_|_$/g, "");
}

/**
 * Escolhe a aba certa para uma importação: cada grupo de aliases precisa ter
 * pelo menos uma coluna presente. Empate resolve por número de linhas.
 */
export function melhorAba(abas: Aba[], grupos: string[][]): Aba | null {
  let escolhida: Aba | null = null;

  for (const aba of abas) {
    if (aba.linhas.length === 0) continue;
    const colunas = new Set(Object.keys(aba.linhas[0]));
    const atende = grupos.every((aliases) =>
      aliases.some((a) => colunas.has(a)),
    );
    if (!atende) continue;
    if (!escolhida || aba.linhas.length > escolhida.linhas.length) {
      escolhida = aba;
    }
  }

  return escolhida;
}

export const COLUNAS_NOME = [
  "nome_completo",
  "nome_cliente",
  "nome",
  "cliente",
  "razao_social",
];
export const COLUNAS_TELEFONE = [
  "telefone",
  "celular",
  "whatsapp",
  "fone",
  "telefone_1",
];
// A conta canônica é a COM dígito: é ela que aparece nos contratos diários.
// cd_conta_sem_digito fica de fora de propósito — não casa com nada.
export const COLUNAS_CONTA = [
  "cd_conta_com_digito",
  "conta",
  "conta_sinacor",
  "numero_conta",
  "nr_conta",
  "num_conta",
  "codigo_conta",
];
export const COLUNAS_LOTES = [
  "lotes_operados",
  "lotes",
  "quantidade",
  "qtd",
  "volume",
  "contratos",
];
export const COLUNAS_DATA = ["data", "referencia", "data_referencia", "dt"];

/** Só dígitos — contas vêm como número no Excel e como texto no CSV. */
export function normalizarConta(bruto: string): string | null {
  const d = bruto.replace(/\D/g, "");
  return d.length >= 3 ? d : null;
}
