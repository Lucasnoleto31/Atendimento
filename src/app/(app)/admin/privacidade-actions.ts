"use server";

import { randomUUID } from "node:crypto";
import { revalidatePath } from "next/cache";
import { createClient } from "@/lib/supabase/server";
import { perfilAtivo } from "@/lib/auth";
import { registrarAcesso } from "@/lib/auditoria";
import {
  CHAVE_PRIVACIDADE,
  normalizarPrivacidade,
  type ConfigPrivacidade,
  type QuemPrivacidade,
} from "@/lib/privacidade-regra";
import type { ResultadoAcao } from "../configuracoes/resultado";
import {
  fraseDaRegra,
  nomeDeQuem,
  nomesDe,
  quantasPessoas,
  QUEM_NOVO_GRUPO,
  type PessoaPrivacidade,
} from "./privacidade-texto";

/*
 * Grupos e regras de privacidade (Administração). Tudo grava numa linha só
 * de settings (chave "privacidade"): cada action lê a linha de agora, muda o
 * item dela e grava de volta.
 *
 * Só o admin grava. A policy de settings deixa a gestão gravar qualquer
 * chave (0001), então quem barra o gestor aqui é a action; no banco, só a
 * proposta 0071 fecha a chave para o admin.
 */

const NOME_MAX = 60;
const SO_ADMIN: ResultadoAcao = { erro: "Só o admin muda a privacidade." };

/** Admin com conta ativa: a conta desativada com a aba aberta não grava. */
async function exigirAdmin() {
  const perfil = await perfilAtivo();
  if (!perfil || perfil.papel !== "admin") return null;
  return perfil;
}

type Supabase = Awaited<ReturnType<typeof createClient>>;

/** A configuração de agora e a equipe (para validar ids e montar a frase
 *  do log). */
async function carregar(supabase: Supabase): Promise<
  | { erro: string }
  | { config: ConfigPrivacidade; porId: Map<string, PessoaPrivacidade> }
> {
  const [linha, equipe] = await Promise.all([
    supabase
      .from("settings")
      .select("valor")
      .eq("chave", CHAVE_PRIVACIDADE)
      .maybeSingle(),
    supabase.from("profiles").select("id, nome, papel, ativo"),
  ]);
  if (linha.error) {
    return { erro: `Não deu para ler a privacidade: ${linha.error.message}` };
  }
  if (equipe.error) {
    return { erro: `Não deu para ler a equipe: ${equipe.error.message}` };
  }
  const porId = new Map<string, PessoaPrivacidade>();
  for (const p of (equipe.data ?? []) as PessoaPrivacidade[]) porId.set(p.id, p);
  return { config: normalizarPrivacidade(linha.data?.valor), porId };
}

async function gravar(
  supabase: Supabase,
  config: ConfigPrivacidade,
): Promise<string | null> {
  // Upsert: a chave nasce na primeira regra (sem linha = sem regra).
  const { error } = await supabase.from("settings").upsert({
    chave: CHAVE_PRIVACIDADE,
    valor: config,
    descricao: "Grupos e regras de privacidade (Administração).",
    atualizado_em: new Date().toISOString(),
  });
  if (!error) return null;
  if (error.code === "42501") {
    return "O banco recusou a gravação. Confira se a sua conta ainda é admin.";
  }
  return `Não deu para salvar: ${error.message}. Nada mudou.`;
}

function pronto(ok: string): ResultadoAcao {
  revalidatePath("/admin", "layout");
  return { ok };
}

/** Os ids marcados no formulário que existem na equipe, sem repetição. */
function idsDaEquipe(
  formData: FormData,
  campo: string,
  porId: ReadonlyMap<string, PessoaPrivacidade>,
): string[] {
  const vistos = new Set<string>();
  for (const v of formData.getAll(campo)) {
    const id = String(v);
    if (porId.has(id)) vistos.add(id);
  }
  return [...vistos];
}

function nomeLimpo(bruto: FormDataEntryValue | null): string {
  return String(bruto ?? "")
    .trim()
    .replace(/\s+/g, " ");
}

// ===========================================================================
// Grupos
// ===========================================================================

/** Cria (sem id) ou muda o nome e os membros de um grupo. */
export async function salvarGrupoPrivacidade(
  _estado: ResultadoAcao,
  formData: FormData,
): Promise<ResultadoAcao> {
  const admin = await exigirAdmin();
  if (!admin) return SO_ADMIN;

  const id = String(formData.get("id") ?? "");
  const nome = nomeLimpo(formData.get("nome"));
  if (!nome) return { erro: "Escreva o nome do grupo." };
  if (nome.length > NOME_MAX) {
    return { erro: `O nome pode ter no máximo ${NOME_MAX} caracteres.` };
  }

  const supabase = await createClient();
  const atual = await carregar(supabase);
  if ("erro" in atual) return atual;
  const { config, porId } = atual;

  const membros = idsDaEquipe(formData, "membros", porId);
  if (membros.length === 0) return { erro: "Marque pelo menos uma pessoa." };

  const repetido = config.grupos.some(
    (g) =>
      g.id !== id &&
      g.nome.localeCompare(nome, "pt-BR", { sensitivity: "base" }) === 0,
  );
  if (repetido) return { erro: `Já existe um grupo chamado ${nome}.` };

  let antes: string | null = null;
  // Quem entrou e quem saiu, pelos nomes: tirar a Ana do grupo devolve a
  // ela as conversas que a regra escondia, e o log precisa dizer isso. Na
  // criação, todos entram.
  let entraram: string[] = membros;
  let sairam: string[] = [];
  let grupos: ConfigPrivacidade["grupos"];
  if (id) {
    const existente = config.grupos.find((g) => g.id === id);
    if (!existente) {
      return { erro: "Esse grupo não existe mais. Recarregue a página." };
    }
    antes = existente.nome;
    const eram = new Set(existente.membros);
    const ficam = new Set(membros);
    entraram = membros.filter((p) => !eram.has(p));
    sairam = existente.membros.filter((p) => !ficam.has(p));
    grupos = config.grupos.map((g) => (g.id === id ? { id, nome, membros } : g));
  } else {
    grupos = [...config.grupos, { id: randomUUID(), nome, membros }];
  }

  const erro = await gravar(supabase, { ...config, grupos });
  if (erro) return { erro };

  registrarAcesso(admin.id, id ? "privacidade_grupo_mudou" : "privacidade_grupo_criou", {
    grupo: nome,
    membros: membros.length,
    ...(entraram.length > 0 ? { entraram: nomesDe(entraram, porId) } : {}),
    ...(sairam.length > 0 ? { sairam: nomesDe(sairam, porId) } : {}),
    ...(antes && antes !== nome ? { antes } : {}),
  });
  return pronto(
    id
      ? `Grupo ${nome} salvo`
      : `Grupo ${nome} criado com ${quantasPessoas(membros.length)}`,
  );
}

/** Exclui o grupo e as regras que valem para ele (a tela pergunta antes). */
export async function excluirGrupoPrivacidade(
  _estado: ResultadoAcao,
  formData: FormData,
): Promise<ResultadoAcao> {
  const admin = await exigirAdmin();
  if (!admin) return SO_ADMIN;

  const id = String(formData.get("id") ?? "");
  if (!id) return { erro: "Grupo não informado." };

  const supabase = await createClient();
  const atual = await carregar(supabase);
  if ("erro" in atual) return atual;
  const { config } = atual;

  const grupo = config.grupos.find((g) => g.id === id);
  // Já saiu (outra aba, outro admin): o fim é o mesmo.
  if (!grupo) return pronto("Grupo excluído");

  const regras = config.regras.filter(
    (r) => !(r.quem.tipo === "grupo" && r.quem.id === id),
  );
  const apagadas = config.regras.length - regras.length;
  const erro = await gravar(supabase, {
    grupos: config.grupos.filter((g) => g.id !== id),
    regras,
  });
  if (erro) return { erro };

  registrarAcesso(admin.id, "privacidade_grupo_excluiu", {
    grupo: grupo.nome,
    regras_apagadas: apagadas,
  });
  return pronto(
    apagadas === 0
      ? `Grupo ${grupo.nome} excluído`
      : apagadas === 1
        ? `Grupo ${grupo.nome} e a regra dele excluídos`
        : `Grupo ${grupo.nome} e ${apagadas.toLocaleString("pt-BR")} regras excluídos`,
  );
}

// ===========================================================================
// Regras
// ===========================================================================

/** "pessoa:<id>" ou "grupo:<id>", como o select manda. */
function lerQuem(bruto: FormDataEntryValue | null): QuemPrivacidade | null {
  const m = /^(pessoa|grupo):(.+)$/.exec(String(bruto ?? ""));
  if (!m) return null;
  return { tipo: m[1] as QuemPrivacidade["tipo"], id: m[2] };
}

/** Cria (sem id) ou muda uma regra. Uma regra por pessoa ou grupo: a
 *  segunda viraria duas linhas dizendo coisas diferentes sobre o mesmo
 *  alguém. Com "Várias pessoas (grupo novo)" no Quem, o grupo nasce junto,
 *  na mesma gravação (nome e pessoas vêm nos campos grupo_*), com as mesmas
 *  conferências do editor de grupo. */
export async function salvarRegraPrivacidade(
  _estado: ResultadoAcao,
  formData: FormData,
): Promise<ResultadoAcao> {
  const admin = await exigirAdmin();
  if (!admin) return SO_ADMIN;

  const id = String(formData.get("id") ?? "");
  const comGrupoNovo = String(formData.get("quem") ?? "") === QUEM_NOVO_GRUPO;
  let quemLido = comGrupoNovo ? null : lerQuem(formData.get("quem"));
  if (!comGrupoNovo && !quemLido) {
    return { erro: "Escolha a pessoa ou o grupo da regra." };
  }

  const supabase = await createClient();
  const atual = await carregar(supabase);
  if ("erro" in atual) return atual;
  const { porId } = atual;
  let { config } = atual;

  let grupoNovo: ConfigPrivacidade["grupos"][number] | null = null;
  if (comGrupoNovo) {
    const nomeGrupo = nomeLimpo(formData.get("grupo_nome"));
    if (!nomeGrupo) return { erro: "Escreva o nome do grupo." };
    if (nomeGrupo.length > NOME_MAX) {
      return { erro: `O nome pode ter no máximo ${NOME_MAX} caracteres.` };
    }
    const membros = idsDaEquipe(formData, "grupo_membros", porId);
    if (membros.length === 0) {
      return { erro: "Marque pelo menos uma pessoa do grupo." };
    }
    const repetido = config.grupos.some(
      (g) =>
        g.nome.localeCompare(nomeGrupo, "pt-BR", { sensitivity: "base" }) === 0,
    );
    if (repetido) return { erro: `Já existe um grupo chamado ${nomeGrupo}.` };
    grupoNovo = { id: randomUUID(), nome: nomeGrupo, membros };
    config = { ...config, grupos: [...config.grupos, grupoNovo] };
    quemLido = { tipo: "grupo", id: grupoNovo.id };
  }
  if (!quemLido) return { erro: "Escolha a pessoa ou o grupo da regra." };
  const quem: QuemPrivacidade = quemLido;

  if (quem.tipo === "pessoa" && !porId.has(quem.id)) {
    return { erro: "Essa pessoa não está mais na equipe. Recarregue a página." };
  }
  if (quem.tipo === "grupo" && !config.grupos.some((g) => g.id === quem.id)) {
    return { erro: "Esse grupo não existe mais. Recarregue a página." };
  }

  // Ninguém fica oculto de si mesmo: a própria pessoa sai da lista.
  const naoVe = idsDaEquipe(formData, "nao_ve", porId).filter(
    (p) => !(quem.tipo === "pessoa" && p === quem.id),
  );
  if (naoVe.length === 0) {
    return { erro: "Marque as pessoas cujas conversas ficam ocultas." };
  }

  const outra = config.regras.find(
    (r) => r.id !== id && r.quem.tipo === quem.tipo && r.quem.id === quem.id,
  );
  if (outra) {
    return {
      erro: `${nomeDeQuem(quem, config, porId)} já tem uma regra. Abra a que existe para mudar.`,
    };
  }

  let antes: string | null = null;
  let regras: ConfigPrivacidade["regras"];
  if (id) {
    const existente = config.regras.find((r) => r.id === id);
    if (!existente) {
      return { erro: "Essa regra não existe mais. Recarregue a página." };
    }
    antes = fraseDaRegra(existente, config, porId);
    regras = config.regras.map((r) => (r.id === id ? { id, quem, naoVe } : r));
  } else {
    regras = [...config.regras, { id: randomUUID(), quem, naoVe }];
  }

  const novo = { ...config, regras };
  const erro = await gravar(supabase, novo);
  if (erro) return { erro };

  if (grupoNovo) {
    registrarAcesso(admin.id, "privacidade_grupo_criou", {
      grupo: grupoNovo.nome,
      membros: grupoNovo.membros.length,
      entraram: nomesDe(grupoNovo.membros, porId),
    });
  }
  const frase = fraseDaRegra({ quem, naoVe }, novo, porId);
  registrarAcesso(
    admin.id,
    id ? "privacidade_regra_mudou" : "privacidade_regra_criou",
    { regra: frase, ...(antes && antes !== frase ? { antes } : {}) },
  );
  return pronto(
    grupoNovo
      ? `Grupo ${grupoNovo.nome} e a regra dele criados`
      : id
        ? "Regra salva"
        : "Regra criada",
  );
}

export async function excluirRegraPrivacidade(
  _estado: ResultadoAcao,
  formData: FormData,
): Promise<ResultadoAcao> {
  const admin = await exigirAdmin();
  if (!admin) return SO_ADMIN;

  const id = String(formData.get("id") ?? "");
  if (!id) return { erro: "Regra não informada." };

  const supabase = await createClient();
  const atual = await carregar(supabase);
  if ("erro" in atual) return atual;
  const { config, porId } = atual;

  const regra = config.regras.find((r) => r.id === id);
  if (!regra) return pronto("Regra excluída");

  const erro = await gravar(supabase, {
    ...config,
    regras: config.regras.filter((r) => r.id !== id),
  });
  if (erro) return { erro };

  registrarAcesso(admin.id, "privacidade_regra_excluiu", {
    regra: fraseDaRegra(regra, config, porId),
  });
  return pronto("Regra excluída");
}
