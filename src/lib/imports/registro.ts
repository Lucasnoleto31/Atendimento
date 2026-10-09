import type { createServiceClient } from "../supabase/server.ts";
import { hojeEmBrasilia } from "../format.ts";

// Peças da importação de contatos que não dependem da planilha: o arquivo
// guardado no Storage, a linha do histórico (tabela imports) e o fatiamento
// em blocos. Vivem fora do arquivo "use server" de propósito: lá, todo
// export vira endpoint invocável pelo navegador.

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
  // O Storage recusa chave com acento e alguns símbolos ("Lista São
  // Paulo.xlsx"), e a recusa era engolida abaixo: o arquivo não ficava
  // guardado. O nome original continua no registro (arquivo_nome).
  const nome = arquivo.name
    .normalize("NFD")
    .replace(/\p{Diacritic}/gu, "")
    .replace(/[^\w.\-]+/g, "_")
    .slice(-80);
  const caminho = `${tipo}/${hojeEmBrasilia()}-${crypto.randomUUID()}-${nome}`;
  const { error } = await service.storage
    .from("importacoes")
    .upload(caminho, arquivo, { upsert: false });

  // Bucket ausente não derruba a importação — o que importa são os dados.
  return error ? null : caminho;
}

export async function abrirRegistro(
  service: Service,
  dados: {
    tipo: "leads";
    arquivoNome: string;
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
