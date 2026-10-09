"use server";

import { revalidatePath } from "next/cache";
import { createServiceClient } from "@/lib/supabase/server";
import { perfilAtivo } from "@/lib/auth";
import { registrarAcesso } from "@/lib/auditoria";
import { formatarData, hojeEmBrasilia } from "@/lib/format";
import { CORES_ETIQUETA } from "@/lib/etiquetas";
import { variantesTelefone } from "@/lib/csv";
import {
  lerTabela,
  melhorAba,
  COLUNAS_CAMPANHA,
  COLUNAS_EMAIL,
  COLUNAS_NOME,
  COLUNAS_TELEFONE,
} from "@/lib/imports/tabular";
import { prepararLeads, type LeadImportado } from "@/lib/imports/leads";
import {
  chaveDaEtiqueta,
  etiquetaDaLinha,
  juntarEtiquetas,
  nomeSemExtensao,
} from "@/lib/imports/etiqueta";
import {
  abrirRegistro,
  blocos,
  fecharRegistro,
  guardarArquivo,
  type Service,
} from "@/lib/imports/registro";
import type { ResultadoAcao } from "../configuracoes/resultado";

const LIMITE_BYTES = 20 * 1024 * 1024; // 20 MB — xlsx é maior que csv

export type ResultadoImport = {
  ok?: boolean;
  erro?: string;
  totalLinhas?: number;
  linhasOk?: number;
  linhasErro?: number;
  exemplosErro?: string[];
  leadsNovos?: number;
  /** As linhas válidas que não viraram contato novo: quem já era contato e,
   *  com "Só telefones novos", o cliente da carteira (também em
   *  `jaEramClientes`). */
  leadsAtualizados?: number;
  /** Já eram contato ou cliente da carteira e não foram tocados (nem
   *  etiquetados). */
  leadsIntactos?: number;
  /** Desses, os que estavam só na carteira (customers), sem contato, e
   *  ficaram de fora da lista. */
  jaEramClientes?: number;
  etiquetouExistentes?: boolean;
  duplicadosNoArquivo?: number;
  /** Linhas iguais à de exemplo do modelo, deixadas de fora. */
  linhasExemplo?: number;
  /** As etiquetas que a lista usou, da que mais recebeu contatos para a
   *  que menos (uma só quando a etiqueta vale para o arquivo inteiro). */
  etiquetasAplicadas?: string[];
  /** Os ids delas, na mesma ordem, para o "Ver os contatos". */
  etiquetaIds?: string[];
  /** Quantos contatos saíram com etiqueta (com "Só telefones novos", só os
   *  novos). */
  etiquetados?: number;
};

/** Os contatos de uma campanha da planilha, para a prévia contar por
 *  etiqueta (o formulário aplica a mesma regra da importação). */
export type GrupoDaPrevia = {
  /** A coluna campanha das linhas; null para as que vieram sem ela. */
  campanha: string | null;
  /** Telefones válidos e diferentes entre si. */
  contatos: number;
  /** Desses, quantos ainda não são contato nem cliente da carteira; null se
   *  a conferência falhou. */
  novos: number | null;
};

/** O que a prévia diz do arquivo antes de gravar qualquer coisa. */
export type PreviaImport = {
  erro?: string;
  /** Linhas com dado (sem o cabeçalho). */
  linhas?: number;
  /** Telefones válidos e diferentes entre si. */
  validos?: number;
  /** Desses, quantos já são contato ou cliente da carteira (null se a
   *  conferência falhou). */
  jaContato?: number | null;
  /** Dos de `jaContato`, os que estão só na carteira, sem contato: com "Só
   *  telefones novos" ficam de fora; sem ele, viram contato novo (null se a
   *  conferência falhou). */
  jaCliente?: number | null;
  duplicados?: number;
  /** Linhas iguais à de exemplo do modelo, que a importação deixa de fora. */
  exemplo?: number;
  /** As colunas reconhecidas: telefone, nome, e-mail, campanha. */
  colunas?: string[];
  /** A aba lida, quando a planilha tem mais de uma. */
  aba?: string | null;
  /** Até 3 linhas com problema, e quantas são ao todo. */
  problemas?: string[];
  totalProblemas?: number;
  /** Alguma linha tem a coluna campanha preenchida. */
  temCampanha?: boolean;
  /** Os contatos por campanha da linha, do grupo maior para o menor, até
   *  MAX_GRUPOS_PREVIA (o resto vem somado em `outrasCampanhas`). */
  porCampanha?: GrupoDaPrevia[];
  outrasCampanhas?: {
    campanhas: number;
    contatos: number;
    novos: number | null;
  } | null;
};

/** Gestão com conta ativa. Conta desativada com a aba ainda aberta não
 *  importa nem apaga nada: o layout só barra a tela na próxima carga. */
async function validarGestor() {
  const perfil = await perfilAtivo();
  if (!perfil || (perfil.papel !== "admin" && perfil.papel !== "gestor")) {
    return null;
  }
  return perfil;
}

async function lerArquivo(formData: FormData) {
  const arquivo = formData.get("arquivo");

  if (!(arquivo instanceof File) || arquivo.size === 0) {
    return { erro: "Escolha um arquivo CSV ou Excel (.xlsx)." as const };
  }
  if (arquivo.size > LIMITE_BYTES) {
    return { erro: "Arquivo maior que 20 MB. Divida em partes." as const };
  }
  // O .xls antigo (binário do Excel 97) não é zip: o leitor quebrava com
  // "end of central directory" e a importação caía num erro sem explicação.
  if (/\.xls$/i.test(arquivo.name)) {
    return {
      erro: "Planilha .xls antiga. No Excel, salve como .xlsx ou .csv e envie de novo." as const,
    };
  }

  let abas: Awaited<ReturnType<typeof lerTabela>>;
  try {
    abas = await lerTabela(arquivo.name, await arquivo.arrayBuffer());
  } catch {
    return {
      erro: "Não deu para ler a planilha. Salve como .xlsx ou .csv e envie de novo." as const,
    };
  }
  if (abas.every((a) => a.linhas.length === 0)) {
    return { erro: "O arquivo está vazio ou não tem cabeçalho." as const };
  }

  return { arquivo, abas };
}

/** Os telefones da lista que já são contato (nas duas grafias do nono
 *  dígito), lidos em blocos. Só leitura. */
async function telefonesQueJaSaoContato(
  service: Service,
  telefones: string[],
): Promise<Map<string, string>> {
  const jaExiste = new Map<string, string>();
  for (const parte of blocos(telefones)) {
    const { data, error } = await service
      .from("leads")
      .select("id, telefone_e164")
      .in("telefone_e164", parte.flatMap(variantesTelefone));
    if (error) throw new Error(error.message);
    (data ?? []).forEach((r: { id: string; telefone_e164: string }) =>
      variantesTelefone(r.telefone_e164).forEach((v) => jaExiste.set(v, r.id)),
    );
  }
  return jaExiste;
}

/** Os telefones da lista que já são cliente da carteira (customers), nas
 *  duas grafias do nono dígito, com o dono de cada um (null quando o
 *  cliente não tem dono). Só leitura. O contato novo de um cliente se
 *  vincula a ele pelo gatilho do telefone (0043, t02) e o gatilho da
 *  carteira (0031) passa o dono do cliente para quem atende o contato: é
 *  por isso que a importação olha a carteira antes de criar. */
async function telefonesDaCarteira(
  service: Service,
  telefones: string[],
): Promise<Map<string, string | null>> {
  const naCarteira = new Map<string, string | null>();
  for (const parte of blocos(telefones)) {
    const { data, error } = await service
      .from("customers")
      .select("telefone_e164, responsavel_id")
      .in("telefone_e164", parte.flatMap(variantesTelefone));
    if (error) throw new Error(error.message);
    (data ?? []).forEach(
      (r: { telefone_e164: string; responsavel_id: string | null }) =>
        variantesTelefone(r.telefone_e164).forEach((v) => {
          // Dois cadastros no mesmo número: vale o que tem dono.
          if (!naCarteira.get(v)) naCarteira.set(v, r.responsavel_id);
        }),
    );
  }
  return naCarteira;
}

// ===========================================================================
// Prévia da importação
// ===========================================================================

/** Quantas campanhas a prévia devolve uma a uma; o resto vem somado. Uma
 *  coluna com um valor diferente por linha (uma data, um id) não vira uma
 *  resposta de megabytes. */
const MAX_GRUPOS_PREVIA = 100;

/**
 * Lê o arquivo escolhido e conta o que vai entrar, sem gravar nada: linhas,
 * telefones válidos, quantos já são contato ou cliente da carteira (e,
 * desses, quantos são só cliente), as colunas reconhecidas, as
 * primeiras linhas com problema e os contatos por campanha da linha (o
 * formulário transforma em contatos por etiqueta, pela escolha da tela). A
 * importação lê o arquivo de novo do zero (a prévia não guarda nada).
 */
export async function previaImportacao(
  formData: FormData,
): Promise<PreviaImport> {
  const perfil = await validarGestor();
  if (!perfil) return { erro: "Só administração e gestão podem importar." };

  const lido = await lerArquivo(formData);
  if ("erro" in lido) return { erro: lido.erro };
  const { abas } = lido;

  const aba = melhorAba(abas, [COLUNAS_TELEFONE]);
  if (!aba) return { erro: "Nenhuma aba tem coluna de telefone." };

  const { leads, duplicados, erros, exemplo } = prepararLeads(aba.linhas);
  const cabecalho = new Set(Object.keys(aba.linhas[0] ?? {}));
  const tem = (nomes: string[]) => nomes.some((n) => cabecalho.has(n));
  const colunas = [
    tem(COLUNAS_TELEFONE) ? "telefone" : null,
    tem(COLUNAS_NOME) ? "nome" : null,
    tem(COLUNAS_EMAIL) ? "e-mail" : null,
    tem(COLUNAS_CAMPANHA) ? "campanha" : null,
  ].filter((c): c is string => c !== null);

  // Já existe quem é contato e quem é cliente da carteira: com "Só
  // telefones novos", a importação deixa os dois de fora (importarLeads).
  // O cliente sem contato vem também à parte: sem a caixa, ele vira contato
  // novo, e a tela pode dizer isso.
  let jaExiste: Set<string> | null = null;
  let soCliente: Set<string> | null = null;
  try {
    const service = createServiceClient();
    const telefones = leads.map((l) => l.telefone);
    const [contatos, carteira] = await Promise.all([
      telefonesQueJaSaoContato(service, telefones),
      telefonesDaCarteira(service, telefones),
    ]);
    jaExiste = new Set([...contatos.keys(), ...carteira.keys()]);
    soCliente = new Set([...carteira.keys()].filter((t) => !contatos.has(t)));
  } catch {
    jaExiste = null;
    soCliente = null;
  }

  // Os contatos por campanha da linha, com quantos ainda não são contato
  // nem cliente.
  const grupos = new Map<string | null, { contatos: number; novos: number }>();
  for (const lead of leads) {
    const g = grupos.get(lead.campanha) ?? { contatos: 0, novos: 0 };
    g.contatos += 1;
    if (jaExiste && !jaExiste.has(lead.telefone)) g.novos += 1;
    grupos.set(lead.campanha, g);
  }
  const ordenados = [...grupos.entries()]
    .map(([campanha, g]) => ({
      campanha,
      contatos: g.contatos,
      novos: jaExiste ? g.novos : null,
    }))
    .sort((a, b) => b.contatos - a.contatos);
  const resto = ordenados.slice(MAX_GRUPOS_PREVIA);

  return {
    linhas: aba.linhas.length,
    validos: leads.length,
    jaContato: jaExiste
      ? leads.filter((l) => jaExiste.has(l.telefone)).length
      : null,
    jaCliente: soCliente
      ? leads.filter((l) => soCliente.has(l.telefone)).length
      : null,
    duplicados,
    exemplo,
    colunas,
    aba: abas.filter((a) => a.linhas.length > 0).length > 1 ? aba.nome : null,
    problemas: erros.slice(0, 3),
    totalProblemas: erros.length,
    temCampanha: leads.some((l) => l.campanha),
    porCampanha: ordenados.slice(0, MAX_GRUPOS_PREVIA),
    outrasCampanhas:
      resto.length > 0
        ? {
            campanhas: resto.length,
            contatos: resto.reduce((s, g) => s + g.contatos, 0),
            novos: jaExiste ? resto.reduce((s, g) => s + (g.novos ?? 0), 0) : null,
          }
        : null,
  };
}

// ===========================================================================
// Exclusão de importação
// ===========================================================================

/**
 * Remove uma importação de contatos do histórico, com o arquivo guardado no
 * Storage. Os contatos que ela criou ficam: podem já estar em conversa, e
 * apagar em cascata seria destrutivo.
 */
export async function excluirImportacao(
  _estado: ResultadoAcao,
  formData: FormData,
): Promise<ResultadoAcao> {
  const perfil = await validarGestor();
  if (!perfil) return { erro: "Só administração e gestão podem excluir." };

  const id = String(formData.get("import_id") ?? "");
  if (!id) return { erro: "Importação não informada." };

  const service = createServiceClient();

  // Só o tipo que a tela mostra e sobe: as outras linhas de imports não se
  // apagam por aqui.
  const { data: registro } = await service
    .from("imports")
    .select("id, arquivo_path, arquivo_nome, total_linhas, criado_em")
    .eq("id", id)
    .eq("tipo", "leads")
    .maybeSingle();

  if (!registro) return { erro: "Importação não encontrada." };

  if (registro.arquivo_path) {
    await service.storage.from("importacoes").remove([registro.arquivo_path]);
  }

  // Confirma pela linha devolvida, como nas outras exclusões: com duas abas
  // excluindo a mesma importação, a segunda apaga zero linhas, não registra
  // e devolve o mesmo "excluída" (o histórico já está sem ela).
  const { data: apagada, error } = await service
    .from("imports")
    .delete()
    .eq("id", id)
    .eq("tipo", "leads")
    .select("id")
    .maybeSingle();
  if (error) return { erro: `Falha ao excluir: ${error.message}` };

  // O registro do histórico some: o log guarda qual era.
  if (apagada) {
    registrarAcesso(perfil.id, "excluiu_importacao", {
      import_id: id,
      ...(registro.arquivo_nome ? { arquivo: registro.arquivo_nome } : {}),
      ...(typeof registro.total_linhas === "number"
        ? { linhas: registro.total_linhas }
        : {}),
      ...(registro.criado_em
        ? { importada_em: formatarData(registro.criado_em) }
        : {}),
    });
  }
  revalidatePath("/admin", "layout");

  return { ok: "Importação excluída do histórico" };
}

// ===========================================================================
// Contatos
// ===========================================================================

/** A cor da etiqueta que a importação cria ("azul", o Grafite da tela). */
const COR_ETIQUETA_IMPORTADA = "azul";

type EtiquetaGravada = { id: string; nome: string };

/** A etiqueta como a tabela tem: arquivada é a de ativo = false. */
type EtiquetaLida = EtiquetaGravada & { ativo: boolean | null };

/** Quantas etiquetas cada leitura pede (o teto padrão do PostgREST). */
const PAGINA_ETIQUETAS = 1000;

/**
 * Todas as etiquetas, as arquivadas junto, página por página: numa leitura
 * só, o PostgREST parava nas primeiras 1.000, e um nome que só muda nas
 * maiúsculas virava etiqueta repetida. Para quando a página volta vazia, e
 * não quando vem menor que o pedido: com o teto do servidor abaixo de 1.000,
 * a primeira página já viria menor.
 */
async function todasAsEtiquetas(service: Service): Promise<EtiquetaLida[]> {
  const todas: EtiquetaLida[] = [];
  for (;;) {
    const { data, error } = await service
      .from("tags")
      .select("id, nome, ativo")
      .order("criado_em")
      .order("id")
      .range(todas.length, todas.length + PAGINA_ETIQUETAS - 1);
    if (error) throw new Error(error.message);
    const pagina = (data ?? []) as EtiquetaLida[];
    if (pagina.length === 0) return todas;
    todas.push(...pagina);
  }
}

/**
 * Apaga as etiquetas que esta importação criou antes de parar: ainda não
 * têm contato, e a importação volta como se nada tivesse acontecido. A que
 * já tem contato (outra aba caiu no mesmo nome, o 23505 abaixo, e etiquetou
 * gente nela) fica. Devolve as que ficaram na lista.
 */
async function desfazerNovas(
  service: Service,
  novas: EtiquetaGravada[],
): Promise<EtiquetaGravada[]> {
  if (novas.length === 0) return [];
  const ids = novas.map((e) => e.id);
  const { data: vinculos, error } = await service
    .from("lead_tags")
    .select("tag_id")
    .in("tag_id", ids);
  if (error) return novas;
  const comContato = new Set(
    (vinculos ?? []).map((v: { tag_id: string }) => v.tag_id),
  );
  const livres = ids.filter((id) => !comContato.has(id));
  if (livres.length === 0) return novas;
  const { data: apagadas, error: erroApagar } = await service
    .from("tags")
    .delete()
    .in("id", livres)
    .select("id");
  const foram = new Set(
    erroApagar ? [] : (apagadas ?? []).map((t: { id: string }) => t.id),
  );
  return novas.filter((e) => !foram.has(e.id));
}

type EtiquetasGarantidas = {
  porChave: Map<string, EtiquetaGravada>;
  /** Criadas por esta importação. */
  novas: EtiquetaGravada[];
  /** Estavam arquivadas e voltaram a valer. */
  reativadas: EtiquetaGravada[];
  /** O nome que não deu para criar ou reativar; null, tudo certo. */
  falhou: { nome: string; arquivada: boolean } | null;
  /** Na falha: as criadas antes dela que não deu para apagar. */
  sobraram: EtiquetaGravada[];
};

/**
 * As etiquetas pelos nomes que a lista pede; cria as que faltam, para a
 * campanha ter público. A comparação é pela chave (sem olhar maiúscula),
 * aqui e não no banco: no ilike, o "_" e o "%" de um nome de campanha
 * ("black_friday") viram curinga e casavam com outra etiqueta.
 *
 * A arquivada entra na comparação, como sempre entrou, mas volta a valer
 * (ativo = true, que é dado): arquivada, ela não aparece como público em
 * Nova campanha e o "escolha X como público" do resultado mentia. A prévia
 * recebe as arquivadas e avisa antes (etiqueta-lista.tsx). Com uma ativa e
 * uma arquivada na mesma chave, vale a ativa.
 *
 * Tudo ou nada: a reativação só vem depois de todas as criações darem
 * certo, e uma falha apaga as criadas aqui (desfazerNovas). O que não deu
 * para apagar volta em `sobraram`, para a mensagem dizer.
 */
async function garantirEtiquetas(
  service: Service,
  nomes: string[],
): Promise<EtiquetasGarantidas> {
  const porChave = new Map<string, EtiquetaLida>();
  const novas: EtiquetaGravada[] = [];

  // A primeira grafia de cada nome manda ("Black Friday" antes de "black
  // friday").
  const pedidos = new Map<string, string>();
  for (const nome of nomes) {
    const chave = chaveDaEtiqueta(nome);
    if (chave && !pedidos.has(chave)) pedidos.set(chave, nome);
  }
  if (pedidos.size === 0) {
    return { porChave, novas, reativadas: [], falhou: null, sobraram: [] };
  }

  for (const t of await todasAsEtiquetas(service)) {
    const chave = chaveDaEtiqueta(t.nome);
    const atual = porChave.get(chave);
    if (!atual || (atual.ativo === false && t.ativo !== false)) {
      porChave.set(chave, t);
    }
  }

  const falhar = async (
    nome: string,
    arquivada: boolean,
  ): Promise<EtiquetasGarantidas> => ({
    porChave,
    novas: [],
    reativadas: [],
    falhou: { nome, arquivada },
    sobraram: await desfazerNovas(service, novas),
  });

  for (const [chave, nome] of pedidos) {
    if (porChave.has(chave)) continue;
    const { data: nova, error: erroNova } = await service
      .from("tags")
      .insert({ nome, cor: COR_ETIQUETA_IMPORTADA })
      .select("id, nome")
      .single();
    if (nova) {
      porChave.set(chave, { ...(nova as EtiquetaGravada), ativo: true });
      novas.push(nova as EtiquetaGravada);
      continue;
    }
    // Outra aba criou o mesmo nome no meio do caminho (o nome é único): os
    // contatos entram na dela.
    if (erroNova?.code === "23505") {
      const { data: mesma } = await service
        .from("tags")
        .select("id, nome, ativo")
        .eq("nome", nome)
        .maybeSingle();
      if (mesma) {
        porChave.set(chave, mesma as EtiquetaLida);
        continue;
      }
    }
    return falhar(nome, false);
  }

  // As arquivadas que a lista pede, num update só (ou todas, ou nenhuma).
  const arquivadas = [...pedidos.keys()]
    .map((chave) => porChave.get(chave))
    .filter((t): t is EtiquetaLida => t !== undefined && t.ativo === false);
  if (arquivadas.length > 0) {
    const { error: erroReativar } = await service
      .from("tags")
      .update({ ativo: true })
      .in(
        "id",
        arquivadas.map((t) => t.id),
      );
    if (erroReativar) return falhar(arquivadas[0].nome, true);
  }

  return {
    porChave,
    novas,
    reativadas: arquivadas.map(({ id, nome }) => ({ id, nome })),
    falhou: null,
    sobraram: [],
  };
}

/**
 * O que o Log guarda das etiquetas da importação. Uma, sem novidade:
 * "etiqueta X" (ou "etiqueta nova X"), como sempre. Várias (a coluna
 * campanha) ou uma que estava arquivada: a lista inteira em `etiquetas` e,
 * para a linha do Log dizer hoje, a frase pelo campo genérico de mudanças
 * ("etiquetas A (nova), B (reativada) e C").
 */
function etiquetasNoLog(
  lista: EtiquetaGravada[],
  novas: Set<string>,
  reativadas: Set<string>,
): Record<string, unknown> {
  if (lista.length === 0) return {};
  const nomesReativados = lista
    .filter((e) => reativadas.has(e.id))
    .map((e) => e.nome);
  if (lista.length === 1 && nomesReativados.length === 0) {
    return {
      etiqueta: lista[0].nome,
      ...(novas.has(lista[0].id) ? { etiqueta_nova: true } : {}),
    };
  }
  const nomesNovos = lista.filter((e) => novas.has(e.id)).map((e) => e.nome);
  const marcado = (e: EtiquetaGravada) =>
    novas.has(e.id)
      ? `${e.nome} (nova)`
      : reativadas.has(e.id)
        ? `${e.nome} (reativada)`
        : e.nome;
  return {
    etiquetas: lista.map((e) => e.nome),
    ...(nomesNovos.length > 0 ? { etiquetas_novas: nomesNovos } : {}),
    ...(nomesReativados.length > 0
      ? { etiquetas_reativadas: nomesReativados }
      : {}),
    mudancas: [
      {
        campo: lista.length === 1 ? "etiqueta" : "etiquetas",
        depois: juntarEtiquetas(lista.map(marcado)),
      },
    ],
  };
}

export async function importarLeads(
  _estado: ResultadoImport,
  formData: FormData,
): Promise<ResultadoImport> {
  const perfil = await validarGestor();
  if (!perfil) return { erro: "Só administração e gestão podem importar." };

  // Etiqueta que já existe, escolhida na lista, vale para o arquivo inteiro
  // e dispensa digitar o nome de novo (digitar cria etiqueta repetida). Sem
  // ela, o nome escrito; sem nome escrito ("Pela coluna campanha da planilha"),
  // a campanha de cada linha e, por último, o nome do arquivo
  // (etiqueta.ts).
  const etiquetaExistenteId = String(formData.get("etiqueta_id") ?? "").trim();
  const nomeEtiqueta = String(formData.get("etiqueta") ?? "").trim();
  const distribuir = formData.get("distribuir") === "on";
  // Caixa marcada (o padrão do formulário): telefone que já é contato ou
  // cliente da carteira fica exatamente como está, nem etiqueta nova (nem
  // contato novo, para o cliente). Desmarcada, o navegador não
  // manda o campo — por isso a comparação é pelo valor presente, não pela
  // ausência dele.
  const somenteNovos = formData.get("somente_novos") === "sim";

  const lido = await lerArquivo(formData);
  if ("erro" in lido) return { erro: lido.erro };
  const { arquivo, abas } = lido;

  const aba = melhorAba(abas, [COLUNAS_TELEFONE]);
  if (!aba) {
    return { erro: "Nenhuma aba tem coluna de telefone." };
  }

  const { leads, duplicados, erros, exemplo } = prepararLeads(aba.linhas);
  if (leads.length === 0) {
    return {
      erro:
        exemplo > 0
          ? "O arquivo só tem a linha de exemplo do modelo. Cole os contatos no lugar dela e envie de novo."
          : "Nenhum telefone válido no arquivo.",
      exemplosErro: erros.slice(0, 5),
    };
  }

  const service = createServiceClient();
  const nomeDoArquivo = nomeSemExtensao(arquivo.name);
  const telefones = leads.map((l) => l.telefone);

  // Tudo o que pode recusar a importação vem antes de abrir o registro,
  // para o histórico não ficar em "Processando" para sempre: a etiqueta
  // escolhida, quem já é contato ou cliente e as etiquetas que faltam criar.
  let fixa: EtiquetaGravada | null = null;
  if (etiquetaExistenteId) {
    const { data: escolhida } = await service
      .from("tags")
      .select("id, nome")
      .eq("id", etiquetaExistenteId)
      .maybeSingle();
    if (!escolhida) return { erro: "A etiqueta escolhida não existe mais." };
    fixa = escolhida as EtiquetaGravada;
  }

  /** O nome da etiqueta de cada contato. */
  const nomeDaLinha = (lead: LeadImportado) =>
    fixa
      ? fixa.nome
      : etiquetaDaLinha(nomeEtiqueta, lead.campanha, nomeDoArquivo);

  // Quem já é contato não vira duplicata: só ganha a etiqueta da lista (ou
  // nem isso, com "Só telefones novos"). O mapa guarda as duas grafias do
  // nono dígito, para a planilha (com 9) casar com o contato que o WhatsApp
  // criou (sem 9). A carteira vem junto, nas mesmas grafias, com o dono de
  // cada cliente.
  let jaExiste: Map<string, string>;
  let carteira: Map<string, string | null>;
  try {
    [jaExiste, carteira] = await Promise.all([
      telefonesQueJaSaoContato(service, telefones),
      telefonesDaCarteira(service, telefones),
    ]);
  } catch {
    return {
      erro: "Não deu para conferir quem já é contato ou cliente. Tente de novo.",
    };
  }

  // "Já é contato ou cliente" cobre os dois, como no sistema original: o
  // telefone que só existe na carteira ainda não tem contato, e criar um
  // agora seria justamente mexer em quem a lista deveria deixar em paz (o
  // gatilho da carteira ainda daria o cliente a quem o rodízio escolheu).
  const eraCliente = (l: LeadImportado) =>
    somenteNovos && !jaExiste.has(l.telefone) && carteira.has(l.telefone);
  const jaEramClientes = leads.filter(eraCliente).length;
  const novos = leads.filter(
    (l) => !jaExiste.has(l.telefone) && !eraCliente(l),
  );
  // "Só números novos": quem já era contato ou cliente não recebe nem a
  // etiqueta — entrar numa lista nova É mexer em quem já está sendo
  // atendido, e foi justamente isso que se pediu para não acontecer.
  const aEtiquetar = somenteNovos ? novos : leads;

  // Só as etiquetas de quem vai recebê-las: com "Só telefones novos", a
  // campanha em que todos já eram contato não deixa etiqueta vazia.
  let etiquetas: EtiquetasGarantidas;
  if (fixa) {
    etiquetas = {
      porChave: new Map([[chaveDaEtiqueta(fixa.nome), fixa]]),
      novas: [],
      reativadas: [],
      falhou: null,
      sobraram: [],
    };
  } else {
    try {
      etiquetas = await garantirEtiquetas(service, aEtiquetar.map(nomeDaLinha));
    } catch {
      return { erro: "Não deu para ler as etiquetas. Tente de novo." };
    }
  }

  // A etiqueta que nasce aqui entra no Log como as criadas na tela de
  // Etiquetas: o filtro "Etiquetas" mostra todas, venham de onde vierem. Na
  // falha, só as que ficaram (as outras foram apagadas de volta).
  const rotuloCor =
    CORES_ETIQUETA.find((c) => c.chave === COR_ETIQUETA_IMPORTADA)?.rotulo ??
    COR_ETIQUETA_IMPORTADA;
  const criadas = etiquetas.falhou ? etiquetas.sobraram : etiquetas.novas;
  for (const nova of criadas) {
    registrarAcesso(perfil.id, "criou_etiqueta", {
      alvo: nova.nome,
      mudancas: [{ campo: "cor", depois: rotuloCor }],
      motivo: "pela importação de contatos",
    });
  }
  if (etiquetas.falhou) {
    const { nome, arquivada } = etiquetas.falhou;
    const sobra = etiquetas.sobraram;
    const aviso =
      sobra.length === 0
        ? ""
        : sobra.length === 1
          ? ` A etiqueta “${sobra[0].nome}”, criada antes da falha, ficou na lista de etiquetas.`
          : ` As etiquetas ${juntarEtiquetas(sobra.map((e) => `“${e.nome}”`))}, criadas antes da falha, ficaram na lista de etiquetas.`;
    return {
      erro: `${
        arquivada
          ? `Não deu para reativar a etiqueta arquivada “${nome}”.`
          : `Não deu para criar a etiqueta “${nome}”.`
      } Nenhum contato foi importado; tente de novo.${aviso}`,
    };
  }

  const tagDoLead = (lead: LeadImportado): EtiquetaGravada | undefined =>
    fixa ?? etiquetas.porChave.get(chaveDaEtiqueta(nomeDaLinha(lead)));
  const idsNovas = new Set(etiquetas.novas.map((e) => e.id));
  const idsReativadas = new Set(etiquetas.reativadas.map((e) => e.id));

  const arquivoPath = await guardarArquivo(service, arquivo, "leads");
  const registroId = await abrirRegistro(service, {
    tipo: "leads",
    arquivoNome: arquivo.name,
    arquivoPath,
    referencia: hojeEmBrasilia(),
    totalLinhas: aba.linhas.length,
    autorId: perfil.id,
  });

  // Os contatos que o insert devolveu, não os que se tentou gravar: a linha
  // pulada no 23505 não conta. Fora do try para o registro da falha dizer
  // quantos entraram até ela.
  let criados = 0;
  // As etiquetas que a lista usou de fato, da que mais recebeu para a que
  // menos; antes de etiquetar, as que ela pediu (o Log de uma falha no meio
  // ainda diz quais eram).
  const pedidas = new Map<string, EtiquetaGravada>();
  for (const lead of aEtiquetar) {
    const tag = tagDoLead(lead);
    if (tag) pedidas.set(tag.id, tag);
  }
  let usadas: EtiquetaGravada[] = fixa ? [fixa] : [...pedidas.values()];
  // O que o Log guarda da importação, deu certo ou não: o arquivo, as linhas,
  // quantos contatos nasceram e as etiquetas da lista (e quais nasceram aqui).
  const detalhesDoLog = () => ({
    ...(registroId ? { import_id: registroId } : {}),
    arquivo: arquivo.name,
    linhas: aba.linhas.length,
    novos: criados,
    ...etiquetasNoLog(usadas, idsNovas, idsReativadas),
  });

  try {
    // Rodízio simples: lista grande dividida em partes iguais entre a equipe.
    let equipe: string[] = [];
    if (distribuir) {
      const { data } = await service
        .from("profiles")
        .select("id")
        .eq("ativo", true)
        // Mesma régua da distribuição automática (0041): quem está no rodízio.
        .eq("recebe_leads", true)
        .order("nome");
      equipe = (data ?? []).map((p: { id: string }) => p.id);
    }

    // O rodízio divide a lista em partes iguais, como no sistema original,
    // inclusive o cliente da carteira que só chega aqui com "Só telefones
    // novos" desligado: o gatilho da carteira (0031) passa esse cliente para
    // quem o rodízio escolheu, como já passava. A /captura entrega ao dono
    // da carteira; trazer essa regra para cá é decisão em aberto.
    const linhasNovas = novos.map((lead, i) => ({
      nome: lead.nome,
      telefone_e164: lead.telefone,
      email: lead.email,
      // A origem do contato, como o sistema original gravava: o nome
      // escrito, a campanha da linha ou o arquivo (a etiqueta escolhida na
      // lista não entra aqui).
      campanha: etiquetaDaLinha(nomeEtiqueta, lead.campanha, nomeDoArquivo),
      entrada_motivo: "importacao" as const,
      responsavel_id: equipe.length > 0 ? equipe[i % equipe.length] : null,
    }));

    // Insert puro, não upsert: o telefone é único por índice PARCIAL
    // (migração 0004, "where telefone_e164 is not null") e ON CONFLICT não
    // casa com índice parcial. Quem já existe foi filtrado acima; se um
    // contato nascer no meio da importação (mensagem chegando pelo webhook),
    // o bloco cai em duplicidade e é regravado linha a linha, pulando o
    // repetido — o registro de quem já está em atendimento fica intacto.
    for (const parte of blocos(linhasNovas)) {
      const { data, error } = await service
        .from("leads")
        .insert(parte)
        .select("id, telefone_e164");

      if (error && error.code !== "23505") throw new Error(error.message);

      if (error) {
        for (const linha of parte) {
          const { data: uma } = await service
            .from("leads")
            .insert(linha)
            .select("id, telefone_e164")
            .maybeSingle();
          if (uma) {
            jaExiste.set(uma.telefone_e164, uma.id);
            criados += 1;
          }
        }
        continue;
      }

      (data ?? []).forEach((r: { id: string; telefone_e164: string }) =>
        jaExiste.set(r.telefone_e164, r.id),
      );
      criados += (data ?? []).length;
    }

    // Quem caiu nessa corrida não voltou do insert: busca o id para a
    // etiqueta da lista não deixar ninguém de fora. Só entre os novos: o
    // resto já tem id ou ficou de fora (o cliente da carteira, com "Só
    // telefones novos").
    const semId = novos
      .map((l) => l.telefone)
      .filter((t) => !jaExiste.has(t));
    for (const parte of blocos(semId)) {
      const { data } = await service
        .from("leads")
        .select("id, telefone_e164")
        .in("telefone_e164", parte);
      (data ?? []).forEach((r: { id: string; telefone_e164: string }) =>
        jaExiste.set(r.telefone_e164, r.id),
      );
    }

    // Um vínculo por contato e etiqueta: as duas grafias do nono dígito no
    // mesmo arquivo apontam para o mesmo contato, e o upsert recusa a mesma
    // linha duas vezes no lote.
    const vinculos = [
      ...new Map(
        aEtiquetar.flatMap((l) => {
          const leadId = jaExiste.get(l.telefone);
          const tag = tagDoLead(l);
          return leadId && tag
            ? [[`${leadId}:${tag.id}`, { lead_id: leadId, tag_id: tag.id }] as const]
            : [];
        }),
      ).values(),
    ];

    for (const parte of blocos(vinculos)) {
      await service
        .from("lead_tags")
        .upsert(parte, { onConflict: "lead_id,tag_id" });
    }

    // As etiquetas pela quantidade de contatos que cada uma recebeu.
    if (!fixa) {
      const porEtiqueta = new Map<string, number>();
      for (const v of vinculos) {
        porEtiqueta.set(v.tag_id, (porEtiqueta.get(v.tag_id) ?? 0) + 1);
      }
      usadas = usadas
        .filter((e) => porEtiqueta.has(e.id))
        .sort(
          (a, b) =>
            (porEtiqueta.get(b.id) ?? 0) - (porEtiqueta.get(a.id) ?? 0) ||
            a.nome.localeCompare(b.nome, "pt-BR"),
        );
    }

    await fecharRegistro(service, registroId, {
      status: "concluida",
      ok: leads.length,
      erros: erros.length,
    });

    registrarAcesso(perfil.id, "importou_contatos", detalhesDoLog());
    revalidatePath("/admin", "layout");

    return {
      ok: true,
      totalLinhas: aba.linhas.length,
      linhasOk: leads.length,
      linhasErro: erros.length,
      exemplosErro: erros.slice(0, 5),
      // Os mesmos números do Log: quem entrou de fato é novo; o resto já era
      // contato (inclusive quem nasceu pelo webhook no meio da importação)
      // ou, com "Só telefones novos", cliente da carteira deixado de fora.
      leadsNovos: criados,
      leadsAtualizados: leads.length - criados,
      leadsIntactos: somenteNovos ? leads.length - criados : 0,
      jaEramClientes,
      etiquetouExistentes: !somenteNovos,
      duplicadosNoArquivo: duplicados,
      linhasExemplo: exemplo,
      etiquetasAplicadas: usadas.map((e) => e.nome),
      etiquetaIds: usadas.map((e) => e.id),
      etiquetados: vinculos.length,
    };
  } catch (e) {
    const detalhe = e instanceof Error ? e.message : String(e);
    // Um bloco pode ter gravado contatos antes da falha: o Log fica com a
    // linha, com quantos entraram até ali.
    registrarAcesso(perfil.id, "importou_contatos", {
      ...detalhesDoLog(),
      motivo: "parou com erro no meio",
    });
    await fecharRegistro(service, registroId, { status: "falhou", detalhe });
    return { erro: `Falha ao gravar: ${detalhe}` };
  }
}
