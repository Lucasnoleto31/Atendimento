import type {
  ConfigPrivacidade,
  QuemPrivacidade,
} from "@/lib/privacidade-regra";

/*
 * Os textos da privacidade, num lugar só: a tela de Administração monta a
 * prévia da regra com eles e a action grava a mesma frase no Log de acesso.
 * Módulo puro (sem "use client" e sem servidor): os dois lados importam.
 */

/** O valor do campo Quem da regra que cria o grupo junto ("Várias pessoas
 *  (grupo novo)…"): a tela manda, a action lê. */
export const QUEM_NOVO_GRUPO = "novo-grupo";

export type PessoaPrivacidade = {
  id: string;
  nome: string;
  papel: string;
  ativo: boolean;
};

const ORDEM = new Intl.Collator("pt-BR", { sensitivity: "base" });

/** "Artur", "Artur e Lucas", "Artur, Lucas e Ana". */
export function listaDeNomes(nomes: readonly string[]): string {
  if (nomes.length <= 1) return nomes[0] ?? "";
  return `${nomes.slice(0, -1).join(", ")} e ${nomes[nomes.length - 1]}`;
}

/** 1 pessoa · 12 pessoas. */
export function quantasPessoas(n: number): string {
  return `${n.toLocaleString("pt-BR")} ${n === 1 ? "pessoa" : "pessoas"}`;
}

/** Os nomes dos ids, em ordem alfabética; id que não está mais na equipe
 *  vira "pessoa removida". */
export function nomesDe(
  idsPessoas: readonly string[],
  porId: ReadonlyMap<string, PessoaPrivacidade>,
): string[] {
  return idsPessoas
    .map((id) => porId.get(id)?.nome ?? "pessoa removida")
    .sort(ORDEM.compare);
}

/** Quem a regra alcança, em pessoas (o grupo vira os membros). */
export function pessoasDeQuem(
  quem: QuemPrivacidade,
  config: ConfigPrivacidade,
): string[] {
  if (quem.tipo === "pessoa") return [quem.id];
  return config.grupos.find((g) => g.id === quem.id)?.membros ?? [];
}

/** "Aikon (3 pessoas)" ou "Ana". */
export function rotuloDeQuem(
  quem: QuemPrivacidade,
  config: ConfigPrivacidade,
  porId: ReadonlyMap<string, PessoaPrivacidade>,
): string {
  if (quem.tipo === "pessoa") {
    return porId.get(quem.id)?.nome ?? "pessoa removida";
  }
  const grupo = config.grupos.find((g) => g.id === quem.id);
  if (!grupo) return "grupo excluído";
  return `${grupo.nome} (${quantasPessoas(grupo.membros.length)})`;
}

/** O nome curto de quem (sem a contagem do grupo), para títulos. */
export function nomeDeQuem(
  quem: QuemPrivacidade,
  config: ConfigPrivacidade,
  porId: ReadonlyMap<string, PessoaPrivacidade>,
): string {
  if (quem.tipo === "pessoa") {
    return porId.get(quem.id)?.nome ?? "pessoa removida";
  }
  return config.grupos.find((g) => g.id === quem.id)?.nome ?? "grupo excluído";
}

/**
 * A regra numa frase: "Aikon (3 pessoas) não vê as conversas de Artur e
 * Lucas." Quem a regra vale sai da lista (ninguém fica oculto de si mesmo).
 */
export function fraseDaRegra(
  regra: { quem: QuemPrivacidade; naoVe: readonly string[] },
  config: ConfigPrivacidade,
  porId: ReadonlyMap<string, PessoaPrivacidade>,
): string {
  const ocultos =
    regra.quem.tipo === "pessoa"
      ? regra.naoVe.filter((id) => id !== regra.quem.id)
      : regra.naoVe;
  return `${rotuloDeQuem(regra.quem, config, porId)} não vê as conversas de ${listaDeNomes(nomesDe(ocultos, porId))}.`;
}

/**
 * "Admin vê tudo; esta regra não vale para Artur." quando a regra (ou o
 * grupo dela) alcança um admin. null quando não alcança.
 */
export function avisoDeAdmin(
  quem: QuemPrivacidade,
  config: ConfigPrivacidade,
  porId: ReadonlyMap<string, PessoaPrivacidade>,
): string | null {
  const admins = pessoasDeQuem(quem, config).filter(
    (id) => porId.get(id)?.papel === "admin",
  );
  if (admins.length === 0) return null;
  return `Admin vê tudo; esta regra não vale para ${listaDeNomes(nomesDe(admins, porId))}.`;
}

/**
 * O atendente já só vê as conversas em que é o responsável (RLS da 0067),
 * e ninguém fica oculto de si: para ele a regra não muda nada. Dito na
 * prévia, para a regra não parecer fazer o que não faz. null quando a regra
 * não alcança atendente.
 */
export function avisoDeAtendente(
  quem: QuemPrivacidade,
  config: ConfigPrivacidade,
  porId: ReadonlyMap<string, PessoaPrivacidade>,
): string | null {
  const atendentes = pessoasDeQuem(quem, config).filter(
    (id) => porId.get(id)?.papel === "atendente",
  );
  if (atendentes.length === 0) return null;
  return `Atendente já só vê as conversas em que é o responsável; para ${listaDeNomes(nomesDe(atendentes, porId))}, nada muda.`;
}

/**
 * Membros do grupo que estão também no "não vê": continuam vendo as
 * próprias conversas. null quando não há ninguém assim (ou quando a regra é
 * de uma pessoa: aí ela nem entra na lista).
 */
export function avisoDasProprias(
  regra: { quem: QuemPrivacidade; naoVe: readonly string[] },
  config: ConfigPrivacidade,
  porId: ReadonlyMap<string, PessoaPrivacidade>,
): string | null {
  if (regra.quem.tipo !== "grupo") return null;
  const membros = new Set(pessoasDeQuem(regra.quem, config));
  const dentro = regra.naoVe.filter((id) => membros.has(id));
  if (dentro.length === 0) return null;
  const nomes = listaDeNomes(nomesDe(dentro, porId));
  return dentro.length === 1
    ? `${nomes} está no grupo e continua vendo as próprias conversas.`
    : `${nomes} estão no grupo e continuam vendo as próprias conversas.`;
}
