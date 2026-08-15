import { campo, normalizarData, normalizarTelefone, type LinhaCsv } from "../csv.ts";
import {
  COLUNAS_CONTA,
  COLUNAS_NOME,
  COLUNAS_TELEFONE,
  normalizarConta,
} from "./tabular.ts";

export type GrupoCliente = {
  nome: string;
  telefone: string | null;
  contas: string[];
  documento: string | null;
  email: string | null;
  conta_aberta_em: string | null;
};

export type PreparoClientes = {
  grupos: GrupoCliente[];
  erros: string[];
};

/**
 * Agrupa as linhas do arquivo em clientes.
 * Identidade: telefone quando existe; sem telefone, o nome (é o caso da base
 * por conta da corretora, onde o mesmo nome aparece em várias contas).
 */
export function prepararClientes(linhas: LinhaCsv[]): PreparoClientes {
  const grupos = new Map<string, GrupoCliente>();
  const erros: string[] = [];

  linhas.forEach((linha, i) => {
    const numeroLinha = i + 2;
    const nome = campo(linha, ...COLUNAS_NOME).trim();
    const telefone = normalizarTelefone(campo(linha, ...COLUNAS_TELEFONE));
    const conta = normalizarConta(campo(linha, ...COLUNAS_CONTA));

    if (!nome) {
      erros.push(`Linha ${numeroLinha}: sem nome.`);
      return;
    }
    if (!telefone && !conta) {
      erros.push(`Linha ${numeroLinha}: sem telefone e sem conta (${nome}).`);
      return;
    }

    const chave = telefone ?? `nome:${chaveNome(nome)}`;
    const existente = grupos.get(chave);

    const documento =
      campo(linha, "documento", "cpf", "cnpj", "cpf_cnpj") || null;
    const email = campo(linha, "email", "e_mail") || null;
    const abertura = normalizarData(
      campo(linha, "conta_aberta_em", "data_abertura", "abertura"),
    );

    if (existente) {
      if (conta && !existente.contas.includes(conta)) {
        existente.contas.push(conta);
      }
      existente.telefone = existente.telefone ?? telefone;
      existente.documento = existente.documento ?? documento;
      existente.email = existente.email ?? email;
      existente.conta_aberta_em = existente.conta_aberta_em ?? abertura;
      return;
    }

    grupos.set(chave, {
      nome,
      telefone,
      contas: conta ? [conta] : [],
      documento,
      email,
      conta_aberta_em: abertura,
    });
  });

  return { grupos: [...grupos.values()], erros };
}

function chaveNome(nome: string) {
  return nome
    .toLowerCase()
    .normalize("NFD")
    .replace(/\p{Diacritic}/gu, "")
    .replace(/\s+/g, " ")
    .trim();
}
