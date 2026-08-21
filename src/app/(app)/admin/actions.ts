"use server";

import { revalidatePath } from "next/cache";
import { createServiceClient } from "@/lib/supabase/server";
import { perfilAtual } from "@/lib/auth";
import { normalizarData } from "@/lib/csv";
import { hojeEmBrasilia } from "@/lib/format";
import {
  lerTabela,
  melhorAba,
  COLUNAS_CONTA,
  COLUNAS_LOTES,
  COLUNAS_NOME,
  COLUNAS_TELEFONE,
} from "@/lib/imports/tabular";
import { prepararClientes, type GrupoCliente } from "@/lib/imports/clientes";
import { prepararLotes } from "@/lib/imports/lotes";
import { prepararLeads } from "@/lib/imports/leads";
import { variantesTelefone } from "@/lib/csv";

const LIMITE_BYTES = 20 * 1024 * 1024; // 20 MB — xlsx é maior que csv
const BLOCO = 500;

export type ResultadoImport = {
  ok?: boolean;
  erro?: string;
  totalLinhas?: number;
  linhasOk?: number;
  linhasErro?: number;
  exemplosErro?: string[];
  contasNovas?: number;
  mesclados?: number;
  telefonesPreenchidos?: number;
  reativacao?: { queda: number; semGiro: number };
  leadsNovos?: number;
  leadsAtualizados?: number;
  /** Já eram lead/cliente e não foram tocados (nem etiquetados). */
  leadsIntactos?: number;
  /** Estavam só na base de clientes e ficaram de fora da lista. */
  jaEramClientes?: number;
  etiquetouExistentes?: boolean;
  duplicadosNoArquivo?: number;
  etiquetasAplicadas?: string[];
};

type Service = ReturnType<typeof createServiceClient>;

function blocos<T>(lista: T[], tamanho = BLOCO) {
  const partes: T[][] = [];
  for (let i = 0; i < lista.length; i += tamanho) {
    partes.push(lista.slice(i, i + tamanho));
  }
  return partes;
}

async function validarGestor() {
  const perfil = await perfilAtual();
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

  const abas = await lerTabela(arquivo.name, await arquivo.arrayBuffer());
  if (abas.every((a) => a.linhas.length === 0)) {
    return { erro: "O arquivo está vazio ou não tem cabeçalho." as const };
  }

  return { arquivo, abas };
}

async function guardarArquivo(service: Service, arquivo: File, tipo: string) {
  const caminho = `${tipo}/${hojeEmBrasilia()}-${crypto.randomUUID()}-${arquivo.name}`;
  const { error } = await service.storage
    .from("importacoes")
    .upload(caminho, arquivo, { upsert: false });

  // Bucket ausente não derruba a importação — o que importa são os dados.
  return error ? null : caminho;
}

async function abrirRegistro(
  service: Service,
  dados: {
    tipo: "clientes" | "lotes" | "leads";
    arquivo: File;
    arquivoPath: string | null;
    referencia: string;
    totalLinhas: number;
    autorId: string;
  },
) {
  const { data } = await service
    .from("imports")
    .insert({
      tipo: dados.tipo,
      arquivo_nome: dados.arquivo.name,
      arquivo_path: dados.arquivoPath,
      referencia_data: dados.referencia,
      total_linhas: dados.totalLinhas,
      criado_por: dados.autorId,
    })
    .select("id")
    .single();

  return data?.id as string | undefined;
}

async function fecharRegistro(
  service: Service,
  id: string | undefined,
  resultado:
    | { status: "concluida"; ok: number; erros: number }
    | { status: "falhou"; detalhe: string },
) {
  if (!id) return;

  await service
    .from("imports")
    .update(
      resultado.status === "concluida"
        ? {
            status: "concluida",
            linhas_ok: resultado.ok,
            linhas_erro: resultado.erros,
          }
        : { status: "falhou", erro_detalhe: resultado.detalhe },
    )
    .eq("id", id);
}

/**
 * Resolve cada grupo do arquivo para um customer_id: primeiro pela conta,
 * depois pelo telefone; quem não casa com nada vira cliente novo.
 * Devolve também os vínculos conta -> cliente a gravar.
 */
async function aplicarClientes(service: Service, grupos: GrupoCliente[]) {
  const todasContas = grupos.flatMap((g) => g.contas);
  const todosTelefones = grupos
    .map((g) => g.telefone)
    .filter((t): t is string => t !== null);

  const contaParaCliente = new Map<string, string>();
  for (const parte of blocos(todasContas)) {
    const { data } = await service
      .from("customer_accounts")
      .select("conta, customer_id")
      .in("conta", parte);
    (data ?? []).forEach((r: { conta: string; customer_id: string }) =>
      contaParaCliente.set(r.conta, r.customer_id),
    );
  }

  const telefoneParaCliente = new Map<string, string>();
  for (const parte of blocos(todosTelefones)) {
    const { data } = await service
      .from("customers")
      .select("id, telefone_e164")
      .in("telefone_e164", parte);
    (data ?? []).forEach((r: { id: string; telefone_e164: string }) =>
      telefoneParaCliente.set(r.telefone_e164, r.id),
    );
  }

  const novos: GrupoCliente[] = [];
  const existentes: { id: string; grupo: GrupoCliente }[] = [];
  let mesclados = 0;

  for (const grupo of grupos) {
    // Contas da mesma pessoa apontando para clientes diferentes: registros
    // duplicados (lotes importados antes da base). Mescla no primeiro.
    const idsDoGrupo = [
      ...new Set(
        grupo.contas
          .map((c) => contaParaCliente.get(c))
          .filter((v): v is string => Boolean(v)),
      ),
    ];

    const porConta = idsDoGrupo[0];

    for (const duplicado of idsDoGrupo.slice(1)) {
      const { error } = await service.rpc("mesclar_clientes", {
        manter: porConta,
        remover: duplicado,
      });
      if (error) throw new Error(`mesclar_clientes: ${error.message}`);
      mesclados++;
      for (const [conta, id] of contaParaCliente) {
        if (id === duplicado) contaParaCliente.set(conta, porConta!);
      }
      for (const [tel, id] of telefoneParaCliente) {
        if (id === duplicado) telefoneParaCliente.set(tel, porConta!);
      }
    }

    const porTelefone = grupo.telefone
      ? telefoneParaCliente.get(grupo.telefone)
      : undefined;

    // Conta e telefone apontando para clientes diferentes: mesmo caso de
    // duplicata — mescla no cliente da conta.
    if (porConta && porTelefone && porConta !== porTelefone) {
      const { error } = await service.rpc("mesclar_clientes", {
        manter: porConta,
        remover: porTelefone,
      });
      if (error) throw new Error(`mesclar_clientes: ${error.message}`);
      mesclados++;
      for (const [conta, cid] of contaParaCliente) {
        if (cid === porTelefone) contaParaCliente.set(conta, porConta);
      }
      for (const [tel, cid] of telefoneParaCliente) {
        if (cid === porTelefone) telefoneParaCliente.set(tel, porConta);
      }
    }

    const id = porConta ?? porTelefone;

    if (id) existentes.push({ id, grupo });
    else novos.push(grupo);
  }

  const vinculos: { conta: string; customer_id: string }[] = [];

  // Novos em lote; o retorno preserva a ordem do insert.
  for (const parte of blocos(novos)) {
    const { data, error } = await service
      .from("customers")
      .insert(
        parte.map((g) => ({
          nome_completo: g.nome,
          telefone_e164: g.telefone,
          documento: g.documento,
          email: g.email,
          conta_aberta_em: g.conta_aberta_em,
          ativo: g.ativo,
        })),
      )
      .select("id");

    if (error) throw new Error(error.message);

    (data ?? []).forEach((linha: { id: string }, i) => {
      parte[i].contas.forEach((conta) =>
        vinculos.push({ conta, customer_id: linha.id }),
      );
    });
  }

  // Existentes: busca o estado atual e mescla sem apagar dado preenchido.
  const idsExistentes = existentes.map((e) => e.id);
  const atual = new Map<
    string,
    {
      telefone_e164: string | null;
      documento: string | null;
      email: string | null;
      conta_aberta_em: string | null;
    }
  >();

  for (const parte of blocos(idsExistentes)) {
    const { data } = await service
      .from("customers")
      .select("id, telefone_e164, documento, email, conta_aberta_em")
      .in("id", parte);
    (data ?? []).forEach(
      (r: {
        id: string;
        telefone_e164: string | null;
        documento: string | null;
        email: string | null;
        conta_aberta_em: string | null;
      }) => atual.set(r.id, r),
    );
  }

  // Dois grupos podem resolver para o MESMO cliente (após mesclas): o upsert
  // não aceita o mesmo id duas vezes no lote, então mescla os campos antes.
  const porId = new Map<string, (typeof existentes)[number]["grupo"] & { id: string }>();
  for (const { id, grupo } of existentes) {
    grupo.contas.forEach((conta) => {
      if (!contaParaCliente.has(conta)) {
        vinculos.push({ conta, customer_id: id });
      }
    });
    const junto = porId.get(id);
    if (junto) {
      junto.telefone = junto.telefone ?? grupo.telefone;
      junto.documento = junto.documento ?? grupo.documento;
      junto.email = junto.email ?? grupo.email;
      junto.conta_aberta_em = junto.conta_aberta_em ?? grupo.conta_aberta_em;
      junto.ativo = junto.ativo || grupo.ativo;
    } else {
      porId.set(id, { ...grupo, id });
    }
  }

  const atualizacoes = [...porId.values()].map((grupo) => {
    const estado = atual.get(grupo.id);
    return {
      id: grupo.id,
      nome_completo: grupo.nome,
      telefone_e164: grupo.telefone ?? estado?.telefone_e164 ?? null,
      documento: grupo.documento ?? estado?.documento ?? null,
      email: grupo.email ?? estado?.email ?? null,
      conta_aberta_em: grupo.conta_aberta_em ?? estado?.conta_aberta_em ?? null,
      ativo: grupo.ativo,
    };
  });

  for (const parte of blocos(atualizacoes)) {
    const { error } = await service
      .from("customers")
      .upsert(parte, { onConflict: "id" });
    if (error) throw new Error(error.message);
  }

  // A mesma conta só entra uma vez no lote.
  const vinculosUnicos = [...new Map(vinculos.map((v) => [v.conta, v])).values()];

  for (const parte of blocos(vinculosUnicos)) {
    const { error } = await service
      .from("customer_accounts")
      .upsert(parte, { onConflict: "conta" });
    if (error) throw new Error(error.message);
  }

  return {
    gravados: grupos.length,
    contasNovas: vinculosUnicos.length,
    mesclados,
  };
}

// ===========================================================================
// Exclusão de importação
// ===========================================================================

export type ResultadoExclusao = { ok?: boolean; erro?: string };

/**
 * Remove uma importação do histórico. Para lotes, desfaz também os dados
 * (customer_lots marcados com o import_id) e o arquivo no Storage. Para
 * clientes, remove apenas o registro — a base pode ter sido atualizada por
 * uploads posteriores e apagar em cascata seria destrutivo.
 */
export async function excluirImportacao(
  _estado: ResultadoExclusao,
  formData: FormData,
): Promise<ResultadoExclusao> {
  const perfil = await validarGestor();
  if (!perfil) return { erro: "Só administração e gestão podem excluir." };

  const id = String(formData.get("import_id") ?? "");
  if (!id) return { erro: "Importação não informada." };

  const service = createServiceClient();

  const { data: registro } = await service
    .from("imports")
    .select("id, tipo, arquivo_path")
    .eq("id", id)
    .single();

  if (!registro) return { erro: "Importação não encontrada." };

  if (registro.tipo === "lotes") {
    const { error } = await service
      .from("customer_lots")
      .delete()
      .eq("import_id", id);
    if (error) return { erro: `Falha ao remover os lotes: ${error.message}` };
  }

  if (registro.arquivo_path) {
    await service.storage.from("importacoes").remove([registro.arquivo_path]);
  }

  const { error } = await service.from("imports").delete().eq("id", id);
  if (error) return { erro: `Falha ao excluir: ${error.message}` };

  revalidatePath("/admin");
  revalidatePath("/atendimento");
  revalidatePath("/leads");

  return { ok: true };
}

// ===========================================================================
// Clientes
// ===========================================================================

export async function importarClientes(
  _estado: ResultadoImport,
  formData: FormData,
): Promise<ResultadoImport> {
  const perfil = await validarGestor();
  if (!perfil) return { erro: "Só administração e gestão podem importar." };

  const lido = await lerArquivo(formData);
  if ("erro" in lido) return { erro: lido.erro };
  const { arquivo, abas } = lido;

  const aba = melhorAba(abas, [
    COLUNAS_NOME,
    [...COLUNAS_TELEFONE, ...COLUNAS_CONTA],
  ]);
  if (!aba) {
    return {
      erro: "Nenhuma aba tem as colunas esperadas: nome + telefone ou conta.",
    };
  }

  const { grupos, erros } = prepararClientes(aba.linhas);

  const service = createServiceClient();
  const arquivoPath = await guardarArquivo(service, arquivo, "clientes");
  const registroId = await abrirRegistro(service, {
    tipo: "clientes",
    arquivo,
    arquivoPath,
    referencia: hojeEmBrasilia(),
    totalLinhas: aba.linhas.length,
    autorId: perfil.id,
  });

  try {
    const { gravados, contasNovas, mesclados } = await aplicarClientes(
      service,
      grupos,
    );

    // Leads criados sem telefone herdam o telefone que a base trouxe agora.
    const { data: preenchidos } = await service.rpc("atualizar_telefones_leads");
    // Leads que ditaram o CPF no chat casam com a base agora (0018 — sem a
    // migração a função não existe e o erro volta no retorno, ignorado).
    await service.rpc("atualizar_documentos_leads");

    await fecharRegistro(service, registroId, {
      status: "concluida",
      ok: gravados,
      erros: erros.length,
    });

    revalidatePath("/admin");
    revalidatePath("/atendimento");
    revalidatePath("/leads");

    return {
      ok: true,
      totalLinhas: aba.linhas.length,
      linhasOk: gravados,
      linhasErro: erros.length,
      exemplosErro: erros.slice(0, 5),
      contasNovas,
      mesclados,
      telefonesPreenchidos:
        typeof preenchidos === "number" ? preenchidos : undefined,
    };
  } catch (e) {
    const detalhe = e instanceof Error ? e.message : String(e);
    await fecharRegistro(service, registroId, { status: "falhou", detalhe });
    return { erro: `Falha ao gravar: ${detalhe}` };
  }
}

// ===========================================================================
// Lotes
// ===========================================================================

export async function importarLotes(
  _estado: ResultadoImport,
  formData: FormData,
): Promise<ResultadoImport> {
  const perfil = await validarGestor();
  if (!perfil) return { erro: "Só administração e gestão podem importar." };

  const dataPadrao =
    normalizarData(String(formData.get("referencia_data") ?? "")) ??
    hojeEmBrasilia();

  const lido = await lerArquivo(formData);
  if ("erro" in lido) return { erro: lido.erro };
  const { arquivo, abas } = lido;

  const aba = melhorAba(abas, [COLUNAS_CONTA, COLUNAS_LOTES]);
  if (!aba) {
    return { erro: "Nenhuma aba tem as colunas esperadas: conta + lotes." };
  }
  const { agregados, totalLinhas, erros } = prepararLotes(
    aba.linhas,
    dataPadrao,
  );

  const service = createServiceClient();
  const arquivoPath = await guardarArquivo(service, arquivo, "lotes");
  const registroId = await abrirRegistro(service, {
    tipo: "lotes",
    arquivo,
    arquivoPath,
    referencia: dataPadrao,
    totalLinhas,
    autorId: perfil.id,
  });

  try {
    // Conta -> cliente. Conta desconhecida cria o cliente na hora, com o nome
    // que veio no arquivo, para nenhum lote ficar órfão.
    const contas = [...new Set(agregados.map((a) => a.conta))];
    const mapa = new Map<string, string>();

    for (const parte of blocos(contas)) {
      const { data } = await service
        .from("customer_accounts")
        .select("conta, customer_id")
        .in("conta", parte);
      (data ?? []).forEach((r: { conta: string; customer_id: string }) =>
        mapa.set(r.conta, r.customer_id),
      );
    }

    const desconhecidas = contas.filter((c) => !mapa.has(c));
    let contasNovas = 0;

    if (desconhecidas.length > 0) {
      const nomePorConta = new Map<string, string>();
      agregados.forEach((a) => {
        if (a.nome && !nomePorConta.has(a.conta)) {
          nomePorConta.set(a.conta, a.nome);
        }
      });

      const { gravados } = await aplicarClientes(
        service,
        desconhecidas.map((conta) => ({
          nome: nomePorConta.get(conta) ?? `Conta ${conta}`,
          telefone: null,
          contas: [conta],
          documento: null,
          email: null,
          conta_aberta_em: null,
          ativo: true,
        })),
      );
      contasNovas = gravados;

      for (const parte of blocos(desconhecidas)) {
        const { data } = await service
          .from("customer_accounts")
          .select("conta, customer_id")
          .in("conta", parte);
        (data ?? []).forEach((r: { conta: string; customer_id: string }) =>
          mapa.set(r.conta, r.customer_id),
        );
      }
    }

    // Um registro por conta + dia: o total do cliente é somado na leitura,
    // preservando o detalhe por conta na ficha do lead.
    const registros = agregados
      .filter((a) => mapa.has(a.conta))
      .map((a) => ({
        customer_id: mapa.get(a.conta)!,
        conta: a.conta,
        referencia_data: a.referencia,
        quantidade: a.quantidade,
        import_id: registroId ?? null,
      }));

    let gravados = 0;
    for (const parte of blocos(registros)) {
      const { error } = await service
        .from("customer_lots")
        .upsert(parte, { onConflict: "conta,referencia_data" });
      if (error) throw new Error(error.message);
      gravados += parte.length;
    }

    await fecharRegistro(service, registroId, {
      status: "concluida",
      ok: gravados,
      erros: erros.length,
    });

    // Quem caiu de giro volta para a fila.
    const { data: reativados } = await service.rpc("gerar_leads_reativacao");
    const linhasReativacao = (reativados ?? []) as {
      criados: number;
      motivo: string;
    }[];

    revalidatePath("/admin");
    revalidatePath("/atendimento");
    revalidatePath("/leads");

    return {
      ok: true,
      totalLinhas,
      linhasOk: gravados,
      linhasErro: erros.length,
      exemplosErro: erros.slice(0, 5),
      contasNovas,
      reativacao: {
        queda:
          linhasReativacao.find((r) => r.motivo === "queda_lotes")?.criados ??
          0,
        semGiro:
          linhasReativacao.find((r) => r.motivo === "sem_giro")?.criados ?? 0,
      },
    };
  } catch (e) {
    const detalhe = e instanceof Error ? e.message : String(e);
    await fecharRegistro(service, registroId, { status: "falhou", detalhe });
    return { erro: `Falha ao gravar: ${detalhe}` };
  }
}

// ===========================================================================
// Leads
// ===========================================================================

/** Etiqueta pelo nome; cria se não existir, para a campanha ter público. */
async function garantirEtiqueta(service: Service, nome: string) {
  const limpo = nome.trim();
  if (!limpo) return null;

  const { data: existente } = await service
    .from("tags")
    .select("id")
    .ilike("nome", limpo)
    // limit(1): dois nomes que só diferem no caixa fariam maybeSingle
    // devolver erro, e aí o CRM criaria uma etiqueta repetida.
    .limit(1)
    .maybeSingle();
  if (existente) return existente.id as string;

  const { data: nova } = await service
    .from("tags")
    .insert({ nome: limpo, cor: "azul" })
    .select("id")
    .single();
  return (nova?.id as string) ?? null;
}

export async function importarLeads(
  _estado: ResultadoImport,
  formData: FormData,
): Promise<ResultadoImport> {
  const perfil = await validarGestor();
  if (!perfil) return { erro: "Só administração e gestão podem importar." };

  // Etiqueta que já existe, escolhida na lista, vale para o arquivo inteiro
  // e dispensa digitar o nome de novo (digitar cria etiqueta repetida).
  const etiquetaExistenteId = String(formData.get("etiqueta_id") ?? "").trim();
  const nomeEtiqueta = String(formData.get("etiqueta") ?? "").trim();
  const distribuir = formData.get("distribuir") === "on";
  // Caixa marcada (o padrão do formulário): telefone que já é lead ou cliente
  // fica exatamente como está, nem etiqueta nova. Desmarcada, o navegador não
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

  const { leads, duplicados, erros } = prepararLeads(aba.linhas);
  if (leads.length === 0) {
    return {
      erro: "Nenhum telefone válido no arquivo.",
      exemplosErro: erros.slice(0, 5),
    };
  }

  const service = createServiceClient();
  const arquivoPath = await guardarArquivo(service, arquivo, "leads");
  const registroId = await abrirRegistro(service, {
    tipo: "leads",
    arquivo,
    arquivoPath,
    referencia: hojeEmBrasilia(),
    totalLinhas: aba.linhas.length,
    autorId: perfil.id,
  });

  try {
    // Etiqueta de cada lead, sem ninguém precisar digitar: o que a gestão
    // escreveu vale para a lista toda; na falta disso, a coluna "campanha"
    // da planilha; na falta das duas, o nome do arquivo. Todo lead
    // importado sai daqui com etiqueta — é ela que a campanha usa de
    // público.
    const nomeDoArquivo = arquivo.name.replace(/\.[^.]+$/, "").trim();
    const etiquetaDoLead = (lead: { campanha: string | null }) =>
      nomeEtiqueta || lead.campanha || nomeDoArquivo || "Importação";

    const idPorEtiqueta = new Map<string, string>();
    let etiquetaFixa: string | null = null;

    if (etiquetaExistenteId) {
      const { data: escolhida } = await service
        .from("tags")
        .select("id, nome")
        .eq("id", etiquetaExistenteId)
        .maybeSingle();
      if (!escolhida) return { erro: "A etiqueta escolhida não existe mais." };
      etiquetaFixa = escolhida.id as string;
      idPorEtiqueta.set(escolhida.nome as string, etiquetaFixa);
    } else {
      for (const nome of new Set(leads.map(etiquetaDoLead))) {
        const id = await garantirEtiqueta(service, nome);
        if (id) idPorEtiqueta.set(nome, id);
      }
    }

    const tagDoLead = (lead: { campanha: string | null }) =>
      etiquetaFixa ?? idPorEtiqueta.get(etiquetaDoLead(lead));

    const telefones = leads.map((l) => l.telefone);

    // Quem já é lead não vira duplicata: só ganha a etiqueta da campanha.
    // O mapa guarda as duas grafias do nono dígito, para a planilha (com 9)
    // casar com o lead que o WhatsApp criou (sem 9).
    const jaExiste = new Map<string, string>();
    for (const parte of blocos(telefones)) {
      const { data } = await service
        .from("leads")
        .select("id, telefone_e164")
        .in("telefone_e164", parte.flatMap(variantesTelefone));
      (data ?? []).forEach((r: { id: string; telefone_e164: string }) =>
        variantesTelefone(r.telefone_e164).forEach((v) =>
          jaExiste.set(v, r.id),
        ),
      );
    }

    // Telefone que bate com a base de clientes entra já vinculado — a equipe
    // vê na hora que aquele "lead" novo é cliente antigo.
    const clientePorTelefone = new Map<string, string>();
    for (const parte of blocos(telefones)) {
      const { data } = await service
        .from("customers")
        .select("id, telefone_e164")
        .in("telefone_e164", parte.flatMap(variantesTelefone));
      (data ?? []).forEach((r: { id: string; telefone_e164: string }) =>
        variantesTelefone(r.telefone_e164).forEach((v) =>
          clientePorTelefone.set(v, r.id),
        ),
      );
    }

    // Primeira etapa do kanban padrão — mesmo destino do lead criado à mão.
    const { data: etapa } = await service
      .from("pipeline_stages")
      .select("id, pipeline:pipelines!inner(padrao)")
      .eq("pipeline.padrao", true)
      .order("ordem")
      .limit(1)
      .maybeSingle();

    // Rodízio simples: lista grande dividida em partes iguais entre a equipe.
    let equipe: string[] = [];
    if (distribuir) {
      const { data } = await service
        .from("profiles")
        .select("id")
        .eq("ativo", true)
        .in("papel", ["vendedor", "gestor"])
        .order("nome");
      equipe = (data ?? []).map((p: { id: string }) => p.id);
    }

    // "Já é lead ou cliente" cobre os dois: o telefone que só existe na base
    // de clientes ainda não tem lead, e criar um agora seria justamente
    // "mexer" em quem a lista deveria deixar em paz.
    const eraCliente = (l: { telefone: string }) =>
      somenteNovos && !jaExiste.has(l.telefone) &&
      clientePorTelefone.has(l.telefone);

    const jaEramClientes = leads.filter(eraCliente).length;
    const novos = leads.filter(
      (l) => !jaExiste.has(l.telefone) && !eraCliente(l),
    );
    const agora = new Date().toISOString();

    const linhasNovas = novos.map((lead, i) => ({
      nome: lead.nome,
      telefone_e164: lead.telefone,
      email: lead.email,
      campanha: etiquetaDoLead(lead),
      entrada_motivo: "importacao" as const,
      stage_id: etapa?.id ?? null,
      customer_id: clientePorTelefone.get(lead.telefone) ?? null,
      cliente_confirmado_em: clientePorTelefone.has(lead.telefone)
        ? agora
        : null,
      responsavel_id:
        equipe.length > 0 ? equipe[i % equipe.length] : null,
    }));

    // Insert puro, não upsert: o telefone é único por índice PARCIAL
    // (migração 0004, "where telefone_e164 is not null") e ON CONFLICT não
    // casa com índice parcial. Quem já existe foi filtrado acima; se um lead
    // nascer no meio da importação (mensagem chegando pelo webhook), o bloco
    // cai em duplicidade e é regravado linha a linha, pulando o repetido —
    // o registro de quem já está em atendimento fica intacto.
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
          if (uma) jaExiste.set(uma.telefone_e164, uma.id);
        }
        continue;
      }

      (data ?? []).forEach((r: { id: string; telefone_e164: string }) =>
        jaExiste.set(r.telefone_e164, r.id),
      );
    }

    // Quem caiu nessa corrida não voltou do insert: busca o id para a
    // etiqueta da campanha não deixar ninguém de fora.
    const semId = telefones.filter((t) => !jaExiste.has(t));
    for (const parte of blocos(semId)) {
      const { data } = await service
        .from("leads")
        .select("id, telefone_e164")
        .in("telefone_e164", parte);
      (data ?? []).forEach((r: { id: string; telefone_e164: string }) =>
        jaExiste.set(r.telefone_e164, r.id),
      );
    }

    // "Só números novos": quem já era lead ou cliente não recebe nem a
    // etiqueta — entrar numa campanha nova É mexer em quem já está sendo
    // atendido, e foi justamente isso que se pediu para não acontecer.
    const aEtiquetar = somenteNovos ? novos : leads;

    const vinculos = aEtiquetar
      .map((l) => ({
        lead_id: jaExiste.get(l.telefone),
        tag_id: tagDoLead(l),
      }))
      .filter(
        (v): v is { lead_id: string; tag_id: string } =>
          Boolean(v.lead_id) && Boolean(v.tag_id),
      );

    for (const parte of blocos(vinculos)) {
      await service
        .from("lead_tags")
        .upsert(parte, { onConflict: "lead_id,tag_id" });
    }

    await fecharRegistro(service, registroId, {
      status: "concluida",
      ok: leads.length,
      erros: erros.length,
    });

    revalidatePath("/admin");
    revalidatePath("/leads");
    revalidatePath("/atendimento");
    revalidatePath("/campanhas");

    return {
      ok: true,
      totalLinhas: aba.linhas.length,
      linhasOk: leads.length,
      linhasErro: erros.length,
      exemplosErro: erros.slice(0, 5),
      leadsNovos: linhasNovas.length,
      leadsAtualizados: leads.length - linhasNovas.length,
      leadsIntactos: somenteNovos ? leads.length - linhasNovas.length : 0,
      jaEramClientes,
      etiquetouExistentes: !somenteNovos,
      duplicadosNoArquivo: duplicados,
      etiquetasAplicadas: [...idPorEtiqueta.keys()],
    };
  } catch (e) {
    const detalhe = e instanceof Error ? e.message : String(e);
    await fecharRegistro(service, registroId, { status: "falhou", detalhe });
    return { erro: `Falha ao gravar: ${detalhe}` };
  }
}
