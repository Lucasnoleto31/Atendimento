import {
  GetObjectCommand,
  ListObjectsV2Command,
  S3Client,
} from "@aws-sdk/client-s3";
import { createServiceClient } from "@/lib/supabase/server";
import { agoraEmBrasilia, hojeEmBrasilia } from "@/lib/format";
import {
  COLUNAS_CONTA,
  COLUNAS_LOTES,
  COLUNAS_NOME,
  COLUNAS_TELEFONE,
  lerTabela,
  melhorAba,
  type Aba,
} from "@/lib/imports/tabular";
import { prepararClientes } from "@/lib/imports/clientes";
import {
  abrirRegistro,
  aplicarClientes,
  aplicarLotes,
  fecharRegistro,
  guardarArquivo,
  type Service,
} from "@/lib/imports/aplicar";

/**
 * Sincronização com o bucket S3 da corretora Genial — o mesmo que a equipe
 * acessava à mão pelo S3 Browser. Uma vez por dia útil o CRM lista os
 * arquivos novos, importa a base de clientes (diversificador) e os lotes
 * (modelo de contratos) pelos mesmos motores do upload manual, e registra
 * tudo no histórico de importações como se alguém tivesse subido — só que
 * sem autor.
 *
 * Sem as variáveis GENIAL_S3_* no ambiente, o recurso fica inativo e mudo.
 */

type Config = {
  bucket: string;
  prefix: string | undefined;
  endpoint: string | undefined;
  region: string;
  accessKeyId: string;
  secretAccessKey: string;
};

function config(): Config | null {
  const bucket = process.env.GENIAL_S3_BUCKET;
  const accessKeyId = process.env.GENIAL_S3_ACCESS_KEY_ID;
  const secretAccessKey = process.env.GENIAL_S3_SECRET_ACCESS_KEY;
  if (!bucket || !accessKeyId || !secretAccessKey) return null;

  return {
    bucket,
    accessKeyId,
    secretAccessKey,
    prefix: process.env.GENIAL_S3_PREFIX || undefined,
    endpoint: process.env.GENIAL_S3_ENDPOINT || undefined,
    region: process.env.GENIAL_S3_REGION || "us-east-1",
  };
}

/** Para as telas mostrarem se a busca automática está de pé. */
export function genialConfigurada(): boolean {
  return config() !== null;
}

let ultimaVerificacao = 0;
const INTERVALO_MS = 30 * 60_000;

export async function sincronizarGenial(): Promise<void> {
  const cfg = config();
  if (!cfg) return;

  // Throttle por processo: a checagem barata (settings) roda no máximo a
  // cada 30 min, mesmo com a página chamando a cada carregamento.
  if (Date.now() - ultimaVerificacao < INTERVALO_MS) return;
  ultimaVerificacao = Date.now();

  try {
    // A corretora só publica arquivo em dia útil — fim de semana não tem o
    // que buscar, e rodar no sábado queimaria a trava sem trazer nada.
    const { dia, fimDeSemana } = agoraEmBrasilia();
    if (fimDeSemana) return;

    const service = createServiceClient();

    // Trava por dia compartilhada entre instâncias — o throttle acima é por
    // processo, e na Vercel cada lambda tem o seu.
    const { data: trava } = await service
      .from("settings")
      .select("valor")
      .eq("chave", "genial_sincronizado_em")
      .maybeSingle();
    const sincronizadoEm = String(trava?.valor ?? "").replace(/^"|"$/g, "");
    if (sincronizadoEm.slice(0, 10) === dia) return;

    const s3 = new S3Client({
      region: cfg.region,
      // Endpoint custom (S3-compatível) resolve por caminho, não por
      // subdomínio — sem isso o SDK monta uma URL que não existe.
      ...(cfg.endpoint ? { endpoint: cfg.endpoint, forcePathStyle: true } : {}),
      credentials: {
        accessKeyId: cfg.accessKeyId,
        secretAccessKey: cfg.secretAccessKey,
      },
    });

    const listagem = await s3.send(
      new ListObjectsV2Command({ Bucket: cfg.bucket, Prefix: cfg.prefix }),
    );

    // A trava só grava depois da listagem responder: bucket fora do ar não
    // queima a única tentativa do dia — o próximo batimento retenta.
    await service.from("settings").upsert({
      chave: "genial_sincronizado_em",
      valor: dia,
      descricao: "Última busca automática no bucket da Genial.",
      atualizado_em: new Date().toISOString(),
    });

    const objetos = (listagem.Contents ?? [])
      .filter((o) => o.Key && !o.Key.endsWith("/"))
      .sort(
        (a, b) =>
          (b.LastModified?.getTime() ?? 0) - (a.LastModified?.getTime() ?? 0),
      )
      .slice(0, 50);

    const alvos = objetos.flatMap((o) => {
      const nome = o.Key!.split("/").pop()!;
      const tipo = classificar(nome);
      return tipo ? [{ key: o.Key!, nome, tipo }] : [];
    });
    if (alvos.length === 0) return;

    // O que já está no histórico (inclusive como falha) não volta: repetir
    // um arquivo que quebrou ontem quebraria de novo, todo dia.
    const { data: importados } = await service
      .from("imports")
      .select("arquivo_nome")
      .in(
        "arquivo_nome",
        alvos.map((a) => a.nome),
      );
    const jaImportados = new Set(
      (importados ?? []).map(
        (r: { arquivo_nome: string | null }) => r.arquivo_nome,
      ),
    );

    // Clientes antes de lotes: o lote de conta nova precisa achar o cliente
    // que o diversificador do mesmo ciclo acabou de trazer.
    const pendentes = alvos
      .filter((a) => !jaImportados.has(a.nome))
      .sort((a, b) =>
        a.tipo === b.tipo ? 0 : a.tipo === "clientes" ? -1 : 1,
      );

    for (const alvo of pendentes) {
      try {
        await importarObjeto(service, s3, cfg.bucket, alvo);
      } catch {
        // Download que falhou não deixa registro — fica para o próximo dia.
        // Erro de dado é tratado dentro e vira falha no histórico.
      }
    }
  } catch {
    // Silencioso de propósito: a tela do admin mostra o estado e o
    // histórico de importações mostra o que entrou (ou falhou).
  }
}

type Alvo = { key: string; nome: string; tipo: "clientes" | "lotes" };

function classificar(nome: string): Alvo["tipo"] | null {
  if (/diversificador/i.test(nome)) return "clientes";
  if (/contrato|lote|modelo/i.test(nome)) return "lotes";
  return null;
}

/** AAAAMMDD no nome ("DIVERSIFICADOR_20260823.csv") vira a data de referência. */
function dataDoNome(nome: string): string | null {
  const m = nome.match(/(20\d{2})(\d{2})(\d{2})/);
  if (!m) return null;
  const [, ano, mes, dia] = m;
  if (Number(mes) < 1 || Number(mes) > 12) return null;
  if (Number(dia) < 1 || Number(dia) > 31) return null;
  return `${ano}-${mes}-${dia}`;
}

async function importarObjeto(
  service: Service,
  s3: S3Client,
  bucket: string,
  alvo: Alvo,
) {
  const resposta = await s3.send(
    new GetObjectCommand({ Bucket: bucket, Key: alvo.key }),
  );
  const bytes = await resposta.Body?.transformToByteArray();
  if (!bytes || bytes.length === 0) return;

  const arquivo = new File([new Uint8Array(bytes)], alvo.nome);
  const referencia = dataDoNome(alvo.nome) ?? hojeEmBrasilia();

  // Daqui em diante todo erro vira registro de falha no histórico — sem
  // isso o mesmo arquivo ruim seria tentado de novo em todo ciclo.
  let abas: Aba[];
  try {
    abas = await lerTabela(arquivo.name, await arquivo.arrayBuffer());
  } catch (e) {
    const detalhe = e instanceof Error ? e.message : String(e);
    await registrarFalha(
      service,
      arquivo,
      alvo.tipo,
      referencia,
      `Arquivo ilegível: ${detalhe}`,
    );
    return;
  }

  if (abas.every((a) => a.linhas.length === 0)) {
    await registrarFalha(
      service,
      arquivo,
      alvo.tipo,
      referencia,
      "O arquivo está vazio ou não tem cabeçalho.",
    );
    return;
  }

  if (alvo.tipo === "lotes") {
    const aba = melhorAba(abas, [COLUNAS_CONTA, COLUNAS_LOTES]);
    if (!aba) {
      await registrarFalha(
        service,
        arquivo,
        alvo.tipo,
        referencia,
        "Nenhuma aba tem as colunas esperadas: conta + lotes.",
      );
      return;
    }

    const arquivoPath = await guardarArquivo(service, arquivo, "lotes");
    // O núcleo cuida do resto, inclusive de fechar como falha e de rodar
    // atualizar_giro + gerar_leads_reativacao depois de gravar.
    await aplicarLotes(service, {
      abas,
      dataPadrao: referencia,
      arquivoNome: arquivo.name,
      arquivoPath,
      autorId: null,
    });
    return;
  }

  // Clientes — a mesma sequência da importação manual, sem autor.
  const aba = melhorAba(abas, [
    COLUNAS_NOME,
    [...COLUNAS_TELEFONE, ...COLUNAS_CONTA],
  ]);
  if (!aba) {
    await registrarFalha(
      service,
      arquivo,
      alvo.tipo,
      referencia,
      "Nenhuma aba tem as colunas esperadas: nome + telefone ou conta.",
    );
    return;
  }

  const { grupos, erros } = prepararClientes(aba.linhas);
  const arquivoPath = await guardarArquivo(service, arquivo, "clientes");
  const registroId = await abrirRegistro(service, {
    tipo: "clientes",
    arquivoNome: arquivo.name,
    arquivoPath,
    referencia,
    totalLinhas: aba.linhas.length,
    autorId: null,
  });

  try {
    const { gravados } = await aplicarClientes(service, grupos);

    // Leads criados sem telefone herdam o telefone que a base trouxe agora;
    // quem ditou o CPF no chat casa com a base (0018 — sem a migração a
    // função não existe e o erro volta no retorno, ignorado).
    await service.rpc("atualizar_telefones_leads");
    await service.rpc("atualizar_documentos_leads");

    await fecharRegistro(service, registroId, {
      status: "concluida",
      ok: gravados,
      erros: erros.length,
    });
  } catch (e) {
    const detalhe = e instanceof Error ? e.message : String(e);
    await fecharRegistro(service, registroId, { status: "falhou", detalhe });
  }
}

/**
 * Arquivo que nem chegou a virar importação de verdade entra no histórico
 * como falha mesmo assim: é o registro que impede a repetição diária e
 * mostra à gestão que algo veio errado da corretora.
 */
async function registrarFalha(
  service: Service,
  arquivo: File,
  tipo: "clientes" | "lotes",
  referencia: string,
  detalhe: string,
) {
  const arquivoPath = await guardarArquivo(service, arquivo, tipo);
  const registroId = await abrirRegistro(service, {
    tipo,
    arquivoNome: arquivo.name,
    arquivoPath,
    referencia,
    totalLinhas: 0,
    autorId: null,
  });
  await fecharRegistro(service, registroId, { status: "falhou", detalhe });
}
