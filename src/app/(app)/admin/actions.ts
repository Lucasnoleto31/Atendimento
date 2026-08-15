"use server";

import { revalidatePath } from "next/cache";
import { createServiceClient } from "@/lib/supabase/server";
import { perfilAtual } from "@/lib/auth";
import {
  campo,
  lerCsv,
  normalizarData,
  normalizarNumero,
  normalizarTelefone,
} from "@/lib/csv";

const LIMITE_BYTES = 10 * 1024 * 1024; // 10 MB
const BLOCO = 500;

export type ResultadoImport = {
  ok?: boolean;
  erro?: string;
  totalLinhas?: number;
  linhasOk?: number;
  linhasErro?: number;
  exemplosErro?: string[];
  reativacao?: { queda: number; semGiro: number };
};

function blocos<T>(lista: T[], tamanho = BLOCO) {
  const partes: T[][] = [];
  for (let i = 0; i < lista.length; i += tamanho) {
    partes.push(lista.slice(i, i + tamanho));
  }
  return partes;
}

async function lerArquivo(formData: FormData) {
  const arquivo = formData.get("arquivo");

  if (!(arquivo instanceof File) || arquivo.size === 0) {
    return { erro: "Escolha um arquivo CSV." as const };
  }
  if (arquivo.size > LIMITE_BYTES) {
    return { erro: "Arquivo maior que 10 MB. Divida em partes." as const };
  }

  const texto = await arquivo.text();
  const linhas = lerCsv(texto);

  if (linhas.length === 0) {
    return { erro: "O arquivo está vazio ou não tem cabeçalho." as const };
  }

  return { arquivo, linhas };
}

async function guardarArquivo(
  service: ReturnType<typeof createServiceClient>,
  arquivo: File,
  tipo: string,
) {
  const caminho = `${tipo}/${new Date().toISOString().slice(0, 10)}-${crypto.randomUUID()}-${arquivo.name}`;
  const { error } = await service.storage
    .from("importacoes")
    .upload(caminho, arquivo, { upsert: false });

  // Bucket ausente não deve derrubar a importação — o que importa são os dados.
  return error ? null : caminho;
}

// ===========================================================================
// Clientes
// ===========================================================================

export async function importarClientes(
  _estado: ResultadoImport,
  formData: FormData,
): Promise<ResultadoImport> {
  const perfil = await perfilAtual();
  if (!perfil || (perfil.papel !== "admin" && perfil.papel !== "gestor")) {
    return { erro: "Só administração e gestão podem importar." };
  }

  const lido = await lerArquivo(formData);
  if ("erro" in lido) return { erro: lido.erro };
  const { arquivo, linhas } = lido;

  const registros: {
    nome_completo: string;
    telefone_e164: string;
    documento: string | null;
    email: string | null;
    conta_aberta_em: string | null;
  }[] = [];
  const erros: string[] = [];
  const vistos = new Set<string>();

  linhas.forEach((linha, i) => {
    const nome = campo(linha, "nome_completo", "nome", "cliente", "razao_social");
    const telefone = normalizarTelefone(
      campo(linha, "telefone", "celular", "whatsapp", "fone", "telefone_1"),
    );

    if (!nome) {
      erros.push(`Linha ${i + 2}: sem nome.`);
      return;
    }
    if (!telefone) {
      erros.push(`Linha ${i + 2}: telefone inválido (${nome}).`);
      return;
    }
    if (vistos.has(telefone)) {
      erros.push(`Linha ${i + 2}: telefone repetido no arquivo (${nome}).`);
      return;
    }

    vistos.add(telefone);
    registros.push({
      nome_completo: nome,
      telefone_e164: telefone,
      documento: campo(linha, "documento", "cpf", "cnpj", "cpf_cnpj") || null,
      email: campo(linha, "email", "e_mail") || null,
      conta_aberta_em: normalizarData(
        campo(linha, "conta_aberta_em", "data_abertura", "abertura", "data"),
      ),
    });
  });

  const service = createServiceClient();
  const arquivoPath = await guardarArquivo(service, arquivo, "clientes");

  const { data: registro } = await service
    .from("imports")
    .insert({
      tipo: "clientes",
      arquivo_nome: arquivo.name,
      arquivo_path: arquivoPath,
      referencia_data: new Date().toISOString().slice(0, 10),
      total_linhas: linhas.length,
      criado_por: perfil.id,
    })
    .select("id")
    .single();

  let gravados = 0;
  for (const parte of blocos(registros)) {
    const { error } = await service
      .from("customers")
      .upsert(parte, { onConflict: "telefone_e164" });

    if (error) {
      await service
        .from("imports")
        .update({ status: "falhou", erro_detalhe: error.message })
        .eq("id", registro?.id);
      return { erro: `Falha ao gravar: ${error.message}` };
    }
    gravados += parte.length;
  }

  await service
    .from("imports")
    .update({
      status: "concluida",
      linhas_ok: gravados,
      linhas_erro: erros.length,
    })
    .eq("id", registro?.id);

  revalidatePath("/admin");
  revalidatePath("/atendimento");
  revalidatePath("/leads");

  return {
    ok: true,
    totalLinhas: linhas.length,
    linhasOk: gravados,
    linhasErro: erros.length,
    exemplosErro: erros.slice(0, 5),
  };
}

// ===========================================================================
// Lotes
// ===========================================================================

export async function importarLotes(
  _estado: ResultadoImport,
  formData: FormData,
): Promise<ResultadoImport> {
  const perfil = await perfilAtual();
  if (!perfil || (perfil.papel !== "admin" && perfil.papel !== "gestor")) {
    return { erro: "Só administração e gestão podem importar." };
  }

  const dataPadrao =
    normalizarData(String(formData.get("referencia_data") ?? "")) ??
    new Date().toISOString().slice(0, 10);

  const lido = await lerArquivo(formData);
  if ("erro" in lido) return { erro: lido.erro };
  const { arquivo, linhas } = lido;

  const pendentes: {
    telefone: string;
    quantidade: number;
    referencia: string;
    origem: number;
  }[] = [];
  const erros: string[] = [];

  linhas.forEach((linha, i) => {
    const telefone = normalizarTelefone(
      campo(linha, "telefone", "celular", "whatsapp", "fone", "telefone_1"),
    );
    const quantidade = normalizarNumero(
      campo(linha, "lotes", "quantidade", "qtd", "volume", "contratos"),
    );

    if (!telefone) {
      erros.push(`Linha ${i + 2}: telefone inválido.`);
      return;
    }
    if (quantidade === null || quantidade < 0) {
      erros.push(`Linha ${i + 2}: quantidade inválida.`);
      return;
    }

    pendentes.push({
      telefone,
      quantidade,
      referencia:
        normalizarData(campo(linha, "data", "referencia", "data_referencia")) ??
        dataPadrao,
      origem: i + 2,
    });
  });

  const service = createServiceClient();

  // Telefone -> customer_id
  const mapa = new Map<string, string>();
  for (const parte of blocos([...new Set(pendentes.map((p) => p.telefone))])) {
    const { data } = await service
      .from("customers")
      .select("id, telefone_e164")
      .in("telefone_e164", parte);

    (data ?? []).forEach((c: { id: string; telefone_e164: string }) =>
      mapa.set(c.telefone_e164, c.id),
    );
  }

  const arquivoPath = await guardarArquivo(service, arquivo, "lotes");
  const { data: registro } = await service
    .from("imports")
    .insert({
      tipo: "lotes",
      arquivo_nome: arquivo.name,
      arquivo_path: arquivoPath,
      referencia_data: dataPadrao,
      total_linhas: linhas.length,
      criado_por: perfil.id,
    })
    .select("id")
    .single();

  const registros: {
    customer_id: string;
    referencia_data: string;
    quantidade: number;
    import_id: string | null;
  }[] = [];

  for (const p of pendentes) {
    const customerId = mapa.get(p.telefone);
    if (!customerId) {
      erros.push(`Linha ${p.origem}: telefone não está na base de clientes.`);
      continue;
    }
    registros.push({
      customer_id: customerId,
      referencia_data: p.referencia,
      quantidade: p.quantidade,
      import_id: registro?.id ?? null,
    });
  }

  let gravados = 0;
  for (const parte of blocos(registros)) {
    const { error } = await service
      .from("customer_lots")
      .upsert(parte, { onConflict: "customer_id,referencia_data" });

    if (error) {
      await service
        .from("imports")
        .update({ status: "falhou", erro_detalhe: error.message })
        .eq("id", registro?.id);
      return { erro: `Falha ao gravar: ${error.message}` };
    }
    gravados += parte.length;
  }

  await service
    .from("imports")
    .update({
      status: "concluida",
      linhas_ok: gravados,
      linhas_erro: erros.length,
    })
    .eq("id", registro?.id);

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
    totalLinhas: linhas.length,
    linhasOk: gravados,
    linhasErro: erros.length,
    exemplosErro: erros.slice(0, 5),
    reativacao: {
      queda:
        linhasReativacao.find((r) => r.motivo === "queda_lotes")?.criados ?? 0,
      semGiro:
        linhasReativacao.find((r) => r.motivo === "sem_giro")?.criados ?? 0,
    },
  };
}
