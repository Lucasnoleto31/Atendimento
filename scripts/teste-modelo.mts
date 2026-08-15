/**
 * Teste local: roda o parser das importações contra o modelo real da corretora.
 *   node --experimental-strip-types scripts/teste-modelo.mts <arquivo.xlsx>
 */
import { readFileSync } from "node:fs";
import {
  lerTabela,
  melhorAba,
  COLUNAS_CONTA,
  COLUNAS_LOTES,
  COLUNAS_NOME,
  COLUNAS_TELEFONE,
} from "../src/lib/imports/tabular.ts";
import { prepararClientes } from "../src/lib/imports/clientes.ts";
import { prepararLotes } from "../src/lib/imports/lotes.ts";

const caminho = process.argv[2];
if (!caminho) {
  console.error("Informe o caminho do arquivo.");
  process.exit(1);
}

const buffer = readFileSync(caminho);
const abas = await lerTabela(
  caminho,
  buffer.buffer.slice(buffer.byteOffset, buffer.byteOffset + buffer.byteLength),
);

console.log("=== Abas encontradas");
for (const aba of abas) {
  console.log(
    `  ${aba.nome}: ${aba.linhas.length} linhas · colunas: ${Object.keys(aba.linhas[0] ?? {}).join(", ")}`,
  );
}

// Importação de clientes
const abaClientes = melhorAba(abas, [COLUNAS_NOME, [...COLUNAS_TELEFONE, ...COLUNAS_CONTA]]);
console.log(`\n=== Clientes -> aba escolhida: ${abaClientes?.nome}`);
if (abaClientes) {
  const r = prepararClientes(abaClientes.linhas);
  console.log(`  grupos (clientes únicos): ${r.grupos.length}`);
  console.log(`  com telefone: ${r.grupos.filter((g) => g.telefone).length}`);
  console.log(`  com documento: ${r.grupos.filter((g) => g.documento).length}`);
  console.log(`  com data de abertura: ${r.grupos.filter((g) => g.conta_aberta_em).length}`);
  console.log(`  ativos: ${r.grupos.filter((g) => g.ativo).length} · inativos: ${r.grupos.filter((g) => !g.ativo).length}`);
  console.log(
    `  contas vinculadas: ${r.grupos.reduce((s, g) => s + g.contas.length, 0)}`,
  );
  console.log(`  erros: ${r.erros.length}`, r.erros.slice(0, 3));
  const multi = r.grupos.filter((g) => g.contas.length > 1);
  console.log(
    `  clientes com mais de uma conta: ${multi.length} (ex.: ${multi[0]?.nome} com ${multi[0]?.contas.length})`,
  );
}

// Importação de lotes
const abaLotes = melhorAba(abas, [COLUNAS_CONTA, COLUNAS_LOTES]);
console.log(`\n=== Lotes -> aba escolhida: ${abaLotes?.nome}`);
if (abaLotes) {
  const r = prepararLotes(abaLotes.linhas, "2026-08-15");
  console.log(`  linhas do arquivo: ${r.totalLinhas}`);
  console.log(`  agregados conta+dia: ${r.agregados.length}`);
  console.log(`  erros: ${r.erros.length}`, r.erros.slice(0, 3));

  const contas = new Set(r.agregados.map((a) => a.conta));
  const datas = new Set(r.agregados.map((a) => a.referencia));
  const total = r.agregados.reduce((s, a) => s + a.quantidade, 0);
  console.log(`  contas distintas: ${contas.size} · dias: ${[...datas].sort().join(", ")}`);
  console.log(`  total de lotes no período: ${total}`);

  const exemplo = r.agregados
    .filter((a) => a.conta === "19200756")
    .sort((a, b) => a.referencia.localeCompare(b.referencia));
  console.log(
    "  conferência conta 19200756:",
    exemplo.map((a) => `${a.referencia}=${a.quantidade}`).join(" "),
  );
}
