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
import { prepararClientes } from "@/lib/imports/clientes";
import { prepararLeads } from "@/lib/imports/leads";
import {
  abrirRegistro,
  aplicarClientes,
  aplicarLotes,
  blocos,
  fecharRegistro,
  guardarArquivo,
  type Service,
} from "@/lib/imports/aplicar";
import { variantesTelefone } from "@/lib/csv";

const LIMITE_BYTES = 20 * 1024 * 1024; // 20 MB — xlsx é maior que csv

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
    arquivoNome: arquivo.name,
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

  const service = createServiceClient();
  const arquivoPath = await guardarArquivo(service, arquivo, "lotes");
  const resultado = await aplicarLotes(service, {
    abas,
    dataPadrao,
    arquivoNome: arquivo.name,
    arquivoPath,
    autorId: perfil.id,
  });

  if (resultado.ok) {
    revalidatePath("/admin");
    revalidatePath("/atendimento");
    revalidatePath("/leads");
  }

  return resultado;
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
    arquivoNome: arquivo.name,
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
