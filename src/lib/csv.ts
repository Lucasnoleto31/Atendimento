/**
 * Leitura de CSV para as importações de planilha.
 * Aceita separador , ou ; (detectado pelo cabeçalho), campos entre aspas,
 * quebra de linha CRLF ou LF e BOM do Excel.
 */

// Telefone e número moram em telefone.ts (o webhook usa sem passar por aqui);
// a reexportação mantém quem já importava deste arquivo.
export {
  normalizarNumero,
  normalizarTelefone,
  variantesTelefone,
} from "./telefone.ts";

export type LinhaCsv = Record<string, string>;

export function lerCsv(texto: string): LinhaCsv[] {
  const limpo = texto.replace(/^﻿/, "").trim();
  if (!limpo) return [];

  const fimPrimeira = limpo.indexOf("\n");
  const primeiraLinha = fimPrimeira === -1 ? limpo : limpo.slice(0, fimPrimeira);
  const separador =
    (primeiraLinha.match(/;/g)?.length ?? 0) >
    (primeiraLinha.match(/,/g)?.length ?? 0)
      ? ";"
      : ",";

  const linhas = dividirLinhas(limpo, separador);
  if (linhas.length < 2) return [];

  const cabecalho = linhas[0].map(normalizarCabecalho);

  return linhas.slice(1).map((campos) => {
    const linha: LinhaCsv = {};
    cabecalho.forEach((coluna, i) => {
      linha[coluna] = (campos[i] ?? "").trim();
    });
    return linha;
  });
}

function dividirLinhas(texto: string, separador: string): string[][] {
  const linhas: string[][] = [];
  let campos: string[] = [];
  let atual = "";
  let entreAspas = false;

  for (let i = 0; i < texto.length; i++) {
    const c = texto[i];

    if (entreAspas) {
      if (c === '"') {
        if (texto[i + 1] === '"') {
          atual += '"';
          i++;
        } else {
          entreAspas = false;
        }
      } else {
        atual += c;
      }
      continue;
    }

    if (c === '"') {
      entreAspas = true;
    } else if (c === separador) {
      campos.push(atual);
      atual = "";
    } else if (c === "\n") {
      campos.push(atual);
      linhas.push(campos);
      campos = [];
      atual = "";
    } else if (c !== "\r") {
      atual += c;
    }
  }

  if (atual || campos.length) {
    campos.push(atual);
    linhas.push(campos);
  }

  return linhas;
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

/** Primeiro valor encontrado entre os nomes de coluna aceitos. */
export function campo(linha: LinhaCsv, ...nomes: string[]) {
  for (const nome of nomes) {
    const valor = linha[nome];
    if (valor) return valor;
  }
  return "";
}

/** Datas em dd/mm/aaaa ou aaaa-mm-dd. Retorna aaaa-mm-dd. */
export function normalizarData(bruto: string): string | null {
  const valor = bruto.trim();
  if (!valor) return null;

  const br = valor.match(/^(\d{2})\/(\d{2})\/(\d{4})$/);
  if (br) return `${br[3]}-${br[2]}-${br[1]}`;

  const iso = valor.match(/^(\d{4})-(\d{2})-(\d{2})/);
  if (iso) return `${iso[1]}-${iso[2]}-${iso[3]}`;

  return null;
}
