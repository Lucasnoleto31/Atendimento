/*
 * A etiqueta que cada contato importado recebe, num lugar só: a action que
 * grava (admin/actions.ts) e a prévia do formulário (no navegador) usam a
 * mesma regra, e a prévia conta exatamente o que a importação vai fazer.
 *
 * Arquivo puro, sem import: entra no pacote do navegador sem levar junto o
 * leitor de planilha (tabular.ts traz o exceljs).
 *
 * A precedência é a do sistema original (antes do corte de 09/10/2026):
 * etiqueta escolhida > coluna "campanha" da linha > nome do arquivo. A
 * etiqueta que já existe, escolhida na lista, nem passa por aqui: vale para
 * o arquivo inteiro.
 */

/** O nome mais longo de etiqueta, o mesmo do campo do formulário. */
export const MAX_NOME_ETIQUETA = 60;

/** O último recurso, quando nem o arquivo tem nome. */
const ETIQUETA_SEM_NOME = "Importação";

/** "Planilha sem título (3).xlsx" vira "Planilha sem título (3)". */
export function nomeSemExtensao(nome: string): string {
  return nome.replace(/\.[^.]+$/, "").trim();
}

/** O nome limpo: espaços repetidos viram um e o tamanho fica no limite. */
function limpar(nome: string | null | undefined): string {
  return (nome ?? "")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, MAX_NOME_ETIQUETA)
    .trim();
}

/**
 * O nome da etiqueta de um contato: o que foi escrito no formulário; sem
 * ele, a campanha da linha; sem as duas, o nome do arquivo (sem extensão).
 */
export function etiquetaDaLinha(
  escrita: string,
  campanha: string | null,
  arquivoSemExtensao: string,
): string {
  return (
    limpar(escrita) ||
    limpar(campanha) ||
    limpar(arquivoSemExtensao) ||
    ETIQUETA_SEM_NOME
  );
}

/**
 * A chave que diz se dois nomes são a mesma etiqueta: sem olhar maiúscula,
 * mas com acento ("Black Friday" e "black friday" são uma só; "Sao" e "São"
 * são duas), como o servidor sempre procurou.
 */
export function chaveDaEtiqueta(nome: string): string {
  return limpar(nome).toLocaleLowerCase("pt-BR");
}

/** "A", "A e B", "A, B e C": as etiquetas numa frase (Log e tela). */
export function juntarEtiquetas(nomes: readonly string[]): string {
  if (nomes.length <= 1) return nomes[0] ?? "";
  return `${nomes.slice(0, -1).join(", ")} e ${nomes[nomes.length - 1]}`;
}

/** As colunas que a importação lê, para a tela dizer. */
export const COLUNAS_ACEITAS = "telefone; opcionais: nome, email, campanha";

/**
 * A linha de exemplo do modelo. O telefone tem formato de celular de
 * verdade (é o que o exemplo ensina), então quem cola a lista embaixo sem
 * apagar a linha importaria "Maria Souza" e mandaria campanha paga para um
 * número que pode ser de alguém. A importação e a prévia reconhecem a linha
 * por telefone, nome e e-mail (a campanha pode ter sido trocada junto com a
 * coluna inteira) e a deixam de fora (leads.ts).
 */
export const EXEMPLO_DO_MODELO = {
  telefone: "(11) 98842-1170",
  nome: "Maria Souza",
  email: "maria@exemplo.com",
  campanha: "Black Friday",
} as const;

/**
 * O modelo da planilha, gerado no navegador (sem rota nova): o cabeçalho e
 * a linha de exemplo. Ponto e vírgula, que o Excel em português abre em
 * colunas, e o BOM do UTF-8, para o acento não quebrar. O telefone vai com
 * máscara: só dígitos, o Excel o transforma em número e corta o fim.
 */
const MODELO_CSV =
  "telefone;nome;email;campanha\r\n" +
  `${EXEMPLO_DO_MODELO.telefone};${EXEMPLO_DO_MODELO.nome};${EXEMPLO_DO_MODELO.email};${EXEMPLO_DO_MODELO.campanha}\r\n`;

/** O BOM do UTF-8 (U+FEFF), pelo código: escrito como caractere, some de
 *  vista no editor. */
const BOM = String.fromCharCode(0xfeff);

export const MODELO_CSV_HREF = `data:text/csv;charset=utf-8,${encodeURIComponent(BOM + MODELO_CSV)}`;

export const MODELO_CSV_NOME = "modelo-contatos.csv";
