import { campo, normalizarTelefone, type LinhaCsv } from "../csv.ts";
import { EXEMPLO_DO_MODELO } from "./etiqueta.ts";
import {
  COLUNAS_CAMPANHA,
  COLUNAS_EMAIL,
  COLUNAS_NOME,
  COLUNAS_TELEFONE,
} from "./tabular.ts";

export type LeadImportado = {
  nome: string;
  telefone: string;
  email: string | null;
  /** A coluna "campanha" (ou origem, fonte, utm_campaign) da linha. Vira a
   *  etiqueta do contato quando ninguém escolhe uma (etiqueta.ts). */
  campanha: string | null;
};

export type PreparoLeads = {
  leads: LeadImportado[];
  duplicados: number;
  erros: string[];
  /** Linhas iguais à de exemplo do modelo, deixadas de fora. */
  exemplo: number;
};

/** O telefone do exemplo, já no formato que a importação compara. */
const TELEFONE_DO_EXEMPLO = normalizarTelefone(EXEMPLO_DO_MODELO.telefone);

/** A linha é a de exemplo do modelo: telefone, nome e e-mail iguais. */
function ehLinhaDoExemplo(
  telefone: string,
  nome: string,
  email: string | null,
): boolean {
  return (
    telefone === TELEFONE_DO_EXEMPLO &&
    nome.toLocaleLowerCase("pt-BR") ===
      EXEMPLO_DO_MODELO.nome.toLocaleLowerCase("pt-BR") &&
    (email ?? "").toLowerCase() === EXEMPLO_DO_MODELO.email
  );
}

/**
 * Lê a lista de contatos de uma planilha (Google Sheets exportado, CSV ou
 * xlsx).
 *
 * Aqui o telefone é obrigatório — sem ele o contato não recebe campanha nem
 * abre conversa, que é o único motivo de importar essa lista. Linhas
 * repetidas dentro do próprio arquivo são fundidas: a primeira ocorrência
 * manda, as seguintes só completam o que estava em branco. A linha de
 * exemplo do modelo, esquecida no arquivo, fica de fora e é contada à parte.
 */
export function prepararLeads(linhas: LinhaCsv[]): PreparoLeads {
  const porTelefone = new Map<string, LeadImportado>();
  const erros: string[] = [];
  let duplicados = 0;
  let exemplo = 0;

  linhas.forEach((linha, i) => {
    const numeroLinha = i + 2;
    const telefone = normalizarTelefone(campo(linha, ...COLUNAS_TELEFONE));
    const nome = campo(linha, ...COLUNAS_NOME).trim();

    if (!telefone) {
      erros.push(
        `Linha ${numeroLinha}: telefone ausente ou inválido${nome ? ` (${nome})` : ""}.`,
      );
      return;
    }

    const email = campo(linha, ...COLUNAS_EMAIL).trim() || null;
    const campanha = campo(linha, ...COLUNAS_CAMPANHA).trim() || null;

    if (ehLinhaDoExemplo(telefone, nome, email)) {
      exemplo += 1;
      return;
    }

    const existente = porTelefone.get(telefone);
    if (existente) {
      duplicados += 1;
      if (!existente.nome && nome) existente.nome = nome;
      existente.email = existente.email ?? email;
      existente.campanha = existente.campanha ?? campanha;
      return;
    }

    porTelefone.set(telefone, {
      // Sem nome o contato ainda serve: o telefone identifica e a equipe
      // completa depois. Melhor entrar assim do que ficar de fora.
      nome: nome || `Lead ${telefone.slice(-4)}`,
      telefone,
      email,
      campanha,
    });
  });

  return { leads: [...porTelefone.values()], duplicados, erros, exemplo };
}
