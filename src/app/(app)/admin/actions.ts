"use server";

import { revalidatePath } from "next/cache";
import { createServiceClient } from "@/lib/supabase/server";
import { perfilAtual } from "@/lib/auth";
import { normalizarData } from "@/lib/csv";
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
  reativacao?: { queda: number; semGiro: number };
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
  const caminho = `${tipo}/${new Date().toISOString().slice(0, 10)}-${crypto.randomUUID()}-${arquivo.name}`;
  const { error } = await service.storage
    .from("importacoes")
    .upload(caminho, arquivo, { upsert: false });

  // Bucket ausente não derruba a importação — o que importa são os dados.
  return error ? null : caminho;
}

async function abrirRegistro(
  service: Service,
  dados: {
    tipo: "clientes" | "lotes";
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

  for (const grupo of grupos) {
    const porConta = grupo.contas
      .map((c) => contaParaCliente.get(c))
      .find(Boolean);
    const porTelefone = grupo.telefone
      ? telefoneParaCliente.get(grupo.telefone)
      : undefined;
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

  const atualizacoes = existentes.map(({ id, grupo }) => {
    const estado = atual.get(id);
    grupo.contas.forEach((conta) => {
      if (!contaParaCliente.has(conta)) {
        vinculos.push({ conta, customer_id: id });
      }
    });
    return {
      id,
      nome_completo: grupo.nome,
      telefone_e164: grupo.telefone ?? estado?.telefone_e164 ?? null,
      documento: grupo.documento ?? estado?.documento ?? null,
      email: grupo.email ?? estado?.email ?? null,
      conta_aberta_em: grupo.conta_aberta_em ?? estado?.conta_aberta_em ?? null,
      ativo: true,
    };
  });

  for (const parte of blocos(atualizacoes)) {
    const { error } = await service
      .from("customers")
      .upsert(parte, { onConflict: "id" });
    if (error) throw new Error(error.message);
  }

  for (const parte of blocos(vinculos)) {
    const { error } = await service
      .from("customer_accounts")
      .upsert(parte, { onConflict: "conta" });
    if (error) throw new Error(error.message);
  }

  return {
    gravados: grupos.length,
    contasNovas: vinculos.length,
  };
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
    referencia: new Date().toISOString().slice(0, 10),
    totalLinhas: aba.linhas.length,
    autorId: perfil.id,
  });

  try {
    const { gravados, contasNovas } = await aplicarClientes(service, grupos);
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
    new Date().toISOString().slice(0, 10);

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

    const registros = agregados
      .filter((a) => mapa.has(a.conta))
      .map((a) => ({
        customer_id: mapa.get(a.conta)!,
        referencia_data: a.referencia,
        quantidade: a.quantidade,
        import_id: registroId ?? null,
      }));

    let gravados = 0;
    for (const parte of blocos(registros)) {
      const { error } = await service
        .from("customer_lots")
        .upsert(parte, { onConflict: "customer_id,referencia_data" });
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
