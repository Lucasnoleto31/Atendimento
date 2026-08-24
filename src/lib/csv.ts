/**
 * Leitura de CSV para as importações diárias.
 * Aceita separador , ou ; (detectado pelo cabeçalho), campos entre aspas,
 * quebra de linha CRLF ou LF e BOM do Excel.
 */

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

/**
 * Telefone brasileiro para E.164 sem símbolos: 5511988421170.
 * Retorna null quando não dá para confiar no número.
 */
export function normalizarTelefone(bruto: string): string | null {
  // Notação científica do Excel ("5,56599E+12"): os dígitos finais foram
  // perdidos na exportação — número irrecuperável, melhor nulo que errado.
  if (/e[+-]?\d/i.test(bruto)) return null;

  const d = bruto.replace(/\D/g, "").replace(/^0+/, "");
  if (!d) return null;

  // Já veio com DDI 55 e DDD.
  if ((d.length === 12 || d.length === 13) && d.startsWith("55")) return d;

  // DDD + número, sem DDI.
  if (d.length === 10 || d.length === 11) return `55${d}`;

  return null;
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

/** Aceita 1.234,56 e 1234.56. */
export function normalizarNumero(bruto: string): number | null {
  const valor = bruto.trim();
  if (!valor) return null;

  const limpo =
    valor.includes(",") && valor.lastIndexOf(",") > valor.lastIndexOf(".")
      ? valor.replace(/\./g, "").replace(",", ".")
      : valor.replace(/,/g, "");

  const n = Number(limpo);
  return Number.isFinite(n) ? n : null;
}

/**
 * As duas grafias do mesmo CELULAR brasileiro: com e sem o nono dígito.
 * O WhatsApp registra números antigos sem o 9 (wa_id "556296073230"),
 * mas as pessoas digitam com o 9 ("5562996073230") — comparar telefone
 * por igualdade exata separa a mesma pessoa em dois registros.
 */
export function variantesTelefone(telefone: string): string[] {
  const variantes = [telefone];
  if (telefone.startsWith("55")) {
    // Fixo é 55 + DDD + 8 dígitos começando em 2..5; celular antigo, em 6..9.
    // Somar um 9 a um fixo inventa o número de outra pessoa.
    if (telefone.length === 12 && telefone[4] >= "6" && telefone[4] <= "9") {
      variantes.push(`${telefone.slice(0, 4)}9${telefone.slice(4)}`);
    }
    if (telefone.length === 13 && telefone[4] === "9") {
      variantes.push(telefone.slice(0, 4) + telefone.slice(5));
    }
  }
  return variantes;
}
