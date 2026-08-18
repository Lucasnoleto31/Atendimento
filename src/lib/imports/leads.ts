import { campo, normalizarTelefone, type LinhaCsv } from "../csv.ts";
import { COLUNAS_NOME, COLUNAS_TELEFONE } from "./tabular.ts";

export type LeadImportado = {
  nome: string;
  telefone: string;
  email: string | null;
  campanha: string | null;
};

export type PreparoLeads = {
  leads: LeadImportado[];
  duplicados: number;
  erros: string[];
};

/**
 * Lê a lista de leads de uma planilha (Google Sheets exportado, CSV ou xlsx).
 *
 * Aqui o telefone é obrigatório — sem ele o lead não entra em campanha nem em
 * conversa, que é o único motivo de importar essa lista. Linhas repetidas
 * dentro do próprio arquivo são fundidas: a primeira ocorrência manda, as
 * seguintes só completam o que estava em branco.
 */
export function prepararLeads(linhas: LinhaCsv[]): PreparoLeads {
  const porTelefone = new Map<string, LeadImportado>();
  const erros: string[] = [];
  let duplicados = 0;

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

    const email = campo(linha, "email", "e_mail", "e-mail").trim() || null;
    const campanha =
      campo(linha, "campanha", "origem", "fonte", "utm_campaign").trim() || null;

    const existente = porTelefone.get(telefone);
    if (existente) {
      duplicados += 1;
      if (!existente.nome && nome) existente.nome = nome;
      existente.email = existente.email ?? email;
      existente.campanha = existente.campanha ?? campanha;
      return;
    }

    porTelefone.set(telefone, {
      // Sem nome o lead ainda serve: o telefone identifica e a equipe
      // completa depois. Melhor entrar assim do que ficar de fora.
      nome: nome || `Lead ${telefone.slice(-4)}`,
      telefone,
      email,
      campanha,
    });
  });

  return { leads: [...porTelefone.values()], duplicados, erros };
}
