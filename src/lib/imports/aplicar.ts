import type { createServiceClient } from "../supabase/server.ts";
import { hojeEmBrasilia } from "../format.ts";
import { COLUNAS_CONTA, COLUNAS_LOTES, melhorAba, type Aba } from "./tabular.ts";
import { prepararLotes } from "./lotes.ts";
import type { GrupoCliente } from "./clientes.ts";

// Núcleos das importações de clientes e lotes. Vivem fora do arquivo
// "use server" de propósito: lá, todo export vira endpoint invocável pelo
// navegador — aqui, a sincronização automática (genial.ts) e as actions
// manuais compartilham o mesmo motor sem expor nada.

export type Service = ReturnType<typeof createServiceClient>;

const BLOCO = 500;

export function blocos<T>(lista: T[], tamanho = BLOCO) {
  const partes: T[][] = [];
  for (let i = 0; i < lista.length; i += tamanho) {
    partes.push(lista.slice(i, i + tamanho));
  }
  return partes;
}

export async function guardarArquivo(
  service: Service,
  arquivo: File,
  tipo: string,
) {
  const caminho = `${tipo}/${hojeEmBrasilia()}-${crypto.randomUUID()}-${arquivo.name}`;
  const { error } = await service.storage
    .from("importacoes")
    .upload(caminho, arquivo, { upsert: false });

  // Bucket ausente não derruba a importação — o que importa são os dados.
  return error ? null : caminho;
}

export async function abrirRegistro(
  service: Service,
  dados: {
    tipo: "clientes" | "lotes" | "leads";
    arquivoNome: string;
    arquivoPath: string | null;
    referencia: string;
    totalLinhas: number;
    /** null = importação automática, sem autor humano. */
    autorId: string | null;
  },
) {
  const { data } = await service
    .from("imports")
    .insert({
      tipo: dados.tipo,
      arquivo_nome: dados.arquivoNome,
      arquivo_path: dados.arquivoPath,
      referencia_data: dados.referencia,
      total_linhas: dados.totalLinhas,
      criado_por: dados.autorId,
    })
    .select("id")
    .single();

  return data?.id as string | undefined;
}

export async function fecharRegistro(
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
export async function aplicarClientes(service: Service, grupos: GrupoCliente[]) {
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

export type ResultadoLotes = {
  ok?: boolean;
  erro?: string;
  totalLinhas?: number;
  linhasOk?: number;
  linhasErro?: number;
  exemplosErro?: string[];
  contasNovas?: number;
  reativacao?: { queda: number; semGiro: number };
};

/**
 * Importação de lotes de ponta a ponta: escolhe a aba, agrega por conta+dia,
 * registra em imports, grava e dispara a reativação — o mesmo caminho para o
 * upload manual e para a sincronização automática.
 */
export async function aplicarLotes(
  service: Service,
  dados: {
    abas: Aba[];
    dataPadrao: string;
    arquivoNome: string;
    arquivoPath?: string | null;
    /** null = importação automática, sem autor humano. */
    autorId: string | null;
  },
): Promise<ResultadoLotes> {
  const aba = melhorAba(dados.abas, [COLUNAS_CONTA, COLUNAS_LOTES]);
  if (!aba) {
    return { erro: "Nenhuma aba tem as colunas esperadas: conta + lotes." };
  }

  const { agregados, totalLinhas, erros } = prepararLotes(
    aba.linhas,
    dados.dataPadrao,
  );

  const registroId = await abrirRegistro(service, {
    tipo: "lotes",
    arquivoNome: dados.arquivoNome,
    arquivoPath: dados.arquivoPath ?? null,
    referencia: dados.dataPadrao,
    totalLinhas,
    autorId: dados.autorId,
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
    // Lotes novos no banco: a foto do giro (0044) atualiza ANTES do motor de
    // reativação decidir quem está parado — senão ele olharia o giro de ontem.
    await service.rpc("atualizar_giro").then(() => {}, () => {});
    const { data: reativados } = await service.rpc("gerar_leads_reativacao");
    const linhasReativacao = (reativados ?? []) as {
      criados: number;
      motivo: string;
    }[];

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
