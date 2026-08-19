import {
  campo,
  normalizarData,
  normalizarTelefone,
  type LinhaCsv,
} from "../csv.ts";
import { normalizarDocumento } from "../documento.ts";
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
  ativo: boolean;
};

export type PreparoClientes = {
  grupos: GrupoCliente[];
  erros: string[];
};

/**
 * Agrupa as linhas do arquivo em clientes.
 * Identidade, na ordem de confiança: telefone > documento (CPF/CNPJ) > nome.
 * No diversificador da corretora o telefone costuma vir corrompido pelo Excel,
 * mas o CPF é 100% preenchido — é ele que junta as contas da mesma pessoa.
 */
export function prepararClientes(linhas: LinhaCsv[]): PreparoClientes {
  const grupos = new Map<string, GrupoCliente>();
  const erros: string[] = [];

  linhas.forEach((linha, i) => {
    const numeroLinha = i + 2;
    const nome = campo(linha, ...COLUNAS_NOME).trim();
    const telefone = normalizarTelefone(campo(linha, ...COLUNAS_TELEFONE));
    const conta = normalizarConta(campo(linha, ...COLUNAS_CONTA));
    // Normaliza para trazer de volta o zero à esquerda que o Excel comeu —
    // senão o CPF do cliente não casa com o que o lead informa no chat.
    const documento = normalizarDocumento(
      campo(linha, "documento", "cpf", "cnpj", "cpf_cnpj"),
    );

    if (!nome) {
      erros.push(`Linha ${numeroLinha}: sem nome.`);
      return;
    }
    if (!telefone && !conta) {
      erros.push(`Linha ${numeroLinha}: sem telefone e sem conta (${nome}).`);
      return;
    }

    const chave =
      telefone ?? (documento ? `doc:${documento}` : `nome:${chaveNome(nome)}`);
    const existente = grupos.get(chave);

    const email = campo(linha, "email", "e_mail") || null;
    const abertura = normalizarData(
      campo(linha, "conta_aberta_em", "data_abertura", "data_habilitacao", "abertura"),
    );
    const situacao = campo(linha, "situacao_conta", "situacao").toUpperCase();
    const ativo = situacao === "" || situacao === "ATIVA" || situacao === "ATIVO";

    if (existente) {
      if (conta && !existente.contas.includes(conta)) {
        existente.contas.push(conta);
      }
      existente.telefone = existente.telefone ?? telefone;
      existente.documento = existente.documento ?? documento;
      existente.email = existente.email ?? email;
      // Mantém a abertura mais antiga entre as contas do cliente.
      if (abertura && (!existente.conta_aberta_em || abertura < existente.conta_aberta_em)) {
        existente.conta_aberta_em = abertura;
      }
      // Basta uma conta ativa para o cliente contar como ativo.
      existente.ativo = existente.ativo || ativo;
      return;
    }

    grupos.set(chave, {
      nome,
      telefone,
      contas: conta ? [conta] : [],
      documento,
      email,
      conta_aberta_em: abertura,
      ativo,
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
