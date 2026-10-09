"use server";

import { revalidatePath } from "next/cache";
import { createClient, createServiceClient } from "@/lib/supabase/server";
import { perfilAtivo } from "@/lib/auth";
import { normalizarNumero, normalizarTelefone } from "@/lib/csv";
import {
  CHAVE_HORARIO,
  CHAVE_RESPOSTA,
  ehTipoAutomatica,
  horarioCurto,
  lerHorario,
  lerResposta,
  LIMITE_TEXTO,
  normalizarDias,
  normalizarHora,
  ROTULO_AUTOMATICA,
  textoDaResposta,
} from "@/lib/automaticas";
import { registrarAcesso, soMudou, type Mudanca } from "@/lib/auditoria";
import { CORES_ETIQUETA } from "@/lib/etiquetas";
import { tetoDeEnvios } from "@/lib/envios";
import { formatarTelefone } from "@/lib/format";
import { contagem, type ResultadoAcao } from "./resultado";

/*
 * As actions das subpáginas da Administração que eram Configurações
 * (mensagens prontas, etiquetas, atendimento e números de WhatsApp). Todas
 * devolvem { ok, erro } para o editor da tela (editor.tsx), sem
 * redirecionar: deu certo, o aviso curto aparece e o editor fecha; deu
 * errado, o erro fica no formulário com o que foi digitado.
 */

const MAX_INSTANCIAS = 10;

const SEM_PERMISSAO: ResultadoAcao = {
  erro: "Só a administração e a gestão mudam as configurações.",
};

/** Gestão com conta ativa. Conta desativada com a aba ainda aberta não grava
 *  nada: o layout só barra a tela na próxima carga. */
async function gestorAtivo() {
  const perfil = await perfilAtivo();
  if (!perfil || (perfil.papel !== "admin" && perfil.papel !== "gestor")) {
    return null;
  }
  return perfil;
}

/** Gravou: a Administração inteira relê (o índice mostra as contagens e o
 *  estado de cada subpágina). */
function pronto(ok: string): ResultadoAcao {
  revalidatePath("/admin", "layout");
  return { ok };
}

function amigavel(codigo: string | undefined, mensagem: string) {
  if (codigo === "23505") return "Já existe um registro com esse valor.";
  if (codigo === "23503")
    return "Há registros ligados a este item. Desative em vez de excluir.";
  return mensagem;
}

/*
 * O Log de acesso registra cada mudança destas subpáginas com o antes e o
 * depois (registrarAcesso, lib/auditoria.ts), sempre depois de a gravação
 * dar certo. Salvar sem mudar nada não vira registro.
 */

/** O nome da cor como a tela mostra ("azul" é "Grafite" desde a ficha). */
function rotuloCor(cor: string | null | undefined): string {
  return CORES_ETIQUETA.find((c) => c.chave === cor)?.rotulo ?? String(cor ?? "");
}

/** O valor de um parâmetro em settings antes de gravar (valor null sem
 *  linha); null quando a leitura falhou e o antes não é sabido. */
async function valorAtual(
  supabase: Awaited<ReturnType<typeof createClient>>,
  chave: string,
): Promise<{ valor: unknown } | null> {
  const { data, error } = await supabase
    .from("settings")
    .select("valor")
    .eq("chave", chave)
    .maybeSingle();
  if (error) return null;
  return { valor: data?.valor ?? null };
}

// ===========================================================================
// Etiquetas
// ===========================================================================

const CORES_VALIDAS = new Set(["azul", "ambar", "verde", "vermelho", "neutro"]);

export async function criarTag(
  _estado: ResultadoAcao,
  formData: FormData,
): Promise<ResultadoAcao> {
  const perfil = await gestorAtivo();
  if (!perfil) return SEM_PERMISSAO;
  const nome = String(formData.get("nome") ?? "").trim();
  const cor = String(formData.get("cor") ?? "neutro");
  if (!nome) return { erro: "Dê um nome à etiqueta." };
  if (!CORES_VALIDAS.has(cor)) return { erro: "Escolha uma das cores." };

  const supabase = await createClient();
  const { error } = await supabase.from("tags").insert({ nome, cor });
  if (error) {
    return {
      erro:
        error.code === "23505"
          ? `A etiqueta “${nome}” já existe.`
          : error.message.includes("cor")
            ? "Cores de etiqueta dependem da migração 0016. Rode-a no SQL Editor."
            : error.message,
    };
  }
  registrarAcesso(perfil.id, "criou_etiqueta", {
    alvo: nome,
    mudancas: [{ campo: "cor", depois: rotuloCor(cor) }],
  });
  return pronto(`Etiqueta “${nome}” criada`);
}

/**
 * Muda o nome da etiqueta, com a mesma permissão da cor. Contatos e
 * campanhas apontam para ela pelo id: o público da campanha e a fila
 * filtrada continuam iguais. Nome que já é de outra etiqueta (sem olhar
 * maiúscula) é recusado: duas "VIP" na lista confundiriam o filtro.
 */
export async function renomearTag(
  _estado: ResultadoAcao,
  formData: FormData,
): Promise<ResultadoAcao> {
  const perfil = await gestorAtivo();
  if (!perfil) return SEM_PERMISSAO;
  const id = String(formData.get("id") ?? "");
  const nome = String(formData.get("nome") ?? "")
    .trim()
    .replace(/\s+/g, " ");
  if (!id) return { erro: "Etiqueta não informada." };
  if (!nome) return { erro: "Dê um nome à etiqueta." };
  if (nome.length > 60) {
    return { erro: "O nome pode ter no máximo 60 caracteres." };
  }

  const supabase = await createClient();
  // % e _ são curingas do ilike: escapados, valem como letra.
  const { data: outra } = await supabase
    .from("tags")
    .select("id")
    .ilike("nome", nome.replace(/[\\%_]/g, "\\$&"))
    .neq("id", id)
    .limit(1);
  if ((outra ?? []).length > 0) {
    return { erro: `A etiqueta “${nome}” já existe.` };
  }

  // O nome de antes, para o log.
  const { data: antes } = await supabase
    .from("tags")
    .select("nome")
    .eq("id", id)
    .maybeSingle();

  const { data, error } = await supabase
    .from("tags")
    .update({ nome })
    .eq("id", id)
    .select("id")
    .maybeSingle();
  if (error) {
    return {
      erro:
        error.code === "23505"
          ? `A etiqueta “${nome}” já existe.`
          : amigavel(error.code, error.message),
    };
  }
  if (!data) {
    return { erro: "Não deu para renomear. Recarregue a página e tente de novo." };
  }
  if (antes?.nome !== nome) {
    // Sem alvo: a linha diz "renomeou uma etiqueta" e o apoio, de qual
    // nome para qual.
    registrarAcesso(perfil.id, "renomeou_etiqueta", {
      tag_id: id,
      mudancas: [{ antes: antes?.nome, depois: nome, texto: true }],
    });
  }
  return pronto(`Etiqueta renomeada para “${nome}”`);
}

/** Troca a cor da etiqueta; o rótulo continua sendo o nome. */
export async function alterarCorTag(
  _estado: ResultadoAcao,
  formData: FormData,
): Promise<ResultadoAcao> {
  const perfil = await gestorAtivo();
  if (!perfil) return SEM_PERMISSAO;
  const id = String(formData.get("id") ?? "");
  const cor = String(formData.get("cor") ?? "");
  if (!id) return { erro: "Etiqueta não informada." };
  if (!CORES_VALIDAS.has(cor)) return { erro: "Escolha uma das cores." };

  const supabase = await createClient();
  const { data: antes } = await supabase
    .from("tags")
    .select("nome, cor")
    .eq("id", id)
    .maybeSingle();
  const { data: gravada, error } = await supabase
    .from("tags")
    .update({ cor })
    .eq("id", id)
    .select("nome")
    .maybeSingle();
  if (error) return { erro: amigavel(error.code, error.message) };
  if (gravada && antes?.cor !== cor) {
    registrarAcesso(perfil.id, "mudou_cor_etiqueta", {
      tag_id: id,
      alvo: gravada.nome,
      mudancas: [
        {
          antes: antes ? rotuloCor(antes.cor) : undefined,
          depois: rotuloCor(cor),
        },
      ],
    });
  }
  return pronto("Cor salva");
}

export async function excluirTag(
  _estado: ResultadoAcao,
  formData: FormData,
): Promise<ResultadoAcao> {
  const perfil = await gestorAtivo();
  if (!perfil) return SEM_PERMISSAO;
  const id = String(formData.get("id") ?? "");
  if (!id) return { erro: "Etiqueta não informada." };

  const supabase = await createClient();

  // A etiqueta é o público das campanhas (FK com on delete set null): apagada,
  // a campanha que ainda manda ficava "Enviando" para sempre, sem ninguém
  // para quem enviar, e o motor pulava ela calado. Enquanto houver campanha
  // ativa ou pausada com ela, a exclusão espera. Tabela de campanhas ausente
  // (migração 0021 não rodada) não trava nada.
  const { data: emUso, error: erroUso } = await supabase
    .from("campanhas")
    .select("nome")
    .eq("etiqueta_id", id)
    .in("status", ["ativa", "pausada"])
    .limit(1);
  if (erroUso && erroUso.code !== "42P01" && erroUso.code !== "PGRST205") {
    return { erro: `Não deu para conferir as campanhas: ${erroUso.message}` };
  }
  const campanha = (emUso ?? [])[0] as { nome: string } | undefined;
  if (campanha) {
    return {
      erro: `A etiqueta é o público da campanha “${campanha.nome}”. Conclua ou exclua a campanha antes.`,
    };
  }

  const { data: excluida, error } = await supabase
    .from("tags")
    .delete()
    .eq("id", id)
    .select("nome")
    .maybeSingle();
  if (error) return { erro: amigavel(error.code, error.message) };
  // Sem linha de volta, nada foi apagado (já tinha saído): não vira registro.
  if (excluida) {
    registrarAcesso(perfil.id, "excluiu_etiqueta", {
      tag_id: id,
      alvo: excluida.nome,
    });
  }
  return pronto(
    excluida?.nome ? `Etiqueta “${excluida.nome}” excluída` : "Etiqueta excluída",
  );
}

// ===========================================================================
// Mensagens prontas
// ===========================================================================

const MAX_ANEXOS_MENSAGEM = 5;

/**
 * Os anexos chegam como JSON num campo escondido (o componente cliente sobe
 * os arquivos por URL assinada e só manda os metadados). Valida forma,
 * quantidade e, o essencial, que cada URL aponta para o NOSSO bucket: campo
 * escondido é editável por quem souber, e mensagem pronta vai para lead; URL
 * alheia aqui viraria vetor de phishing com a nossa cara.
 */
function lerAnexosMensagem(
  bruto: string,
):
  { anexos: { tipo: string; url: string; nome: string }[] } | { erro: string } {
  let lista: unknown;
  try {
    lista = JSON.parse(bruto);
  } catch {
    return { erro: "Anexos inválidos. Recarregue a página e tente de novo." };
  }
  if (!Array.isArray(lista)) return { erro: "Anexos inválidos." };
  if (lista.length > MAX_ANEXOS_MENSAGEM) {
    return { erro: `No máximo ${MAX_ANEXOS_MENSAGEM} anexos por mensagem.` };
  }
  const prefixo = new URL(
    `${process.env.NEXT_PUBLIC_SUPABASE_URL}/storage/v1/object/public/midia-whatsapp/mensagens-padrao/`,
  );
  const anexos: { tipo: string; url: string; nome: string }[] = [];
  for (const item of lista) {
    const a = item as { tipo?: unknown; url?: unknown; nome?: unknown };
    // startsWith cru é contornável com ../ (o navegador normaliza os
    // dot-segments ANTES do fetch): compara origem e caminho JÁ normalizado
    // pelo parser, e recusa qualquer resquício de escape.
    let u: URL | null = null;
    try {
      u = typeof a.url === "string" ? new URL(a.url) : null;
    } catch {
      u = null;
    }
    if (
      !u ||
      u.origin !== prefixo.origin ||
      !u.pathname.startsWith(prefixo.pathname) ||
      (a.url as string).includes("..") ||
      (a.url as string).includes("\\") ||
      typeof a.tipo !== "string" ||
      !["image", "audio", "video", "file"].includes(a.tipo)
    ) {
      return { erro: "Anexo fora do padrão. Envie os arquivos de novo." };
    }
    anexos.push({
      tipo: a.tipo,
      // u só existe quando a.url era string: o guard acima garante.
      url: a.url as string,
      nome: String(a.nome ?? "anexo").slice(0, 120),
    });
  }
  return { anexos };
}

/** URL assinada para o navegador subir o anexo da mensagem pronta. */
export async function prepararUploadMensagemPadrao(
  nome: string,
): Promise<{ caminho?: string; token?: string; erro?: string }> {
  if (!(await gestorAtivo())) return { erro: SEM_PERMISSAO.erro };
  const limpo = nome.replace(/[^\w.\-]+/g, "_").slice(-80);
  const caminho = `mensagens-padrao/${crypto.randomUUID()}-${limpo}`;
  const service = createServiceClient();
  const { data, error } = await service.storage
    .from("midia-whatsapp")
    .createSignedUploadUrl(caminho);
  if (error) {
    return { erro: `Não deu para preparar o envio: ${error.message}` };
  }
  return { caminho, token: data.token };
}

/** Título, texto e anexos do formulário, já conferidos. */
function lerMensagem(
  formData: FormData,
): { payload: Record<string, unknown> } | { erro: string } {
  const titulo = String(formData.get("titulo") ?? "").trim();
  const corpo = String(formData.get("corpo") ?? "").trim();
  if (!titulo) return { erro: "Dê um título à mensagem." };
  if (!corpo) return { erro: "Escreva o texto da mensagem." };

  // O campo só existe no formulário quando a coluna existe (0060). Presente,
  // sempre grava (inclusive [] para limpar).
  const payload: Record<string, unknown> = { titulo, corpo };
  const brutoAnexos = formData.get("anexos");
  if (brutoAnexos !== null) {
    const lidos = lerAnexosMensagem(String(brutoAnexos));
    if ("erro" in lidos) return { erro: lidos.erro };
    payload.anexos = lidos.anexos;
  }
  return { payload };
}

function erroMensagem(codigo: string | undefined, mensagem: string) {
  return codigo === "42703" || codigo === "PGRST204"
    ? "Rode a migração 0060 para os anexos das mensagens prontas existirem."
    : amigavel(codigo, mensagem);
}

/** As URLs dos anexos gravados (sem a coluna, ou fora do formato, vazio). */
function urlsDosAnexos(v: unknown): string[] {
  if (!Array.isArray(v)) return [];
  return v
    .map((a) => (a as { url?: unknown } | null)?.url)
    .filter((u): u is string => typeof u === "string");
}

export async function criarMensagem(
  _estado: ResultadoAcao,
  formData: FormData,
): Promise<ResultadoAcao> {
  const perfil = await gestorAtivo();
  if (!perfil) return SEM_PERMISSAO;
  const lida = lerMensagem(formData);
  if ("erro" in lida) return { erro: lida.erro };

  const supabase = await createClient();
  const { error } = await supabase.from("quick_replies").insert(lida.payload);
  if (error) return { erro: erroMensagem(error.code, error.message) };
  const anexos = urlsDosAnexos(lida.payload.anexos).length;
  registrarAcesso(perfil.id, "criou_mensagem_padrao", {
    alvo: lida.payload.titulo,
    mudancas: [
      { campo: "texto", depois: String(lida.payload.corpo), texto: true },
      ...(anexos > 0 ? [{ depois: contagem(anexos, "anexo", "anexos") }] : []),
    ],
  });
  return pronto("Mensagem criada");
}

export async function atualizarMensagem(
  _estado: ResultadoAcao,
  formData: FormData,
): Promise<ResultadoAcao> {
  const perfil = await gestorAtivo();
  if (!perfil) return SEM_PERMISSAO;
  const id = String(formData.get("id") ?? "");
  if (!id) return { erro: "Mensagem não informada." };
  const lida = lerMensagem(formData);
  if ("erro" in lida) return { erro: lida.erro };

  const supabase = await createClient();
  // Como estava, para o log ("*": a coluna dos anexos pode não existir).
  const { data: antes } = await supabase
    .from("quick_replies")
    .select("*")
    .eq("id", id)
    .maybeSingle();
  const { data: gravada, error } = await supabase
    .from("quick_replies")
    .update(lida.payload)
    .eq("id", id)
    .select("id")
    .maybeSingle();
  if (error) return { erro: erroMensagem(error.code, error.message) };

  if (gravada) {
    const titulo = String(lida.payload.titulo);
    const mudancas: Mudanca[] = soMudou([
      { campo: "título", antes: antes?.titulo, depois: titulo, texto: true },
      {
        campo: "texto",
        antes: antes?.corpo,
        depois: String(lida.payload.corpo),
        texto: true,
      },
    ]);
    // Os anexos pela lista de arquivos: mesma quantidade com arquivo
    // trocado também é mudança. Sem o campo no formulário, ficaram como
    // estavam.
    if (antes && lida.payload.anexos !== undefined) {
      const eram = urlsDosAnexos(antes.anexos);
      const ficam = urlsDosAnexos(lida.payload.anexos);
      if (eram.join("\n") !== ficam.join("\n")) {
        mudancas.push(
          eram.length === ficam.length
            ? { campo: "anexos", depois: "trocados" }
            : { campo: "anexos", antes: eram.length, depois: ficam.length },
        );
      }
    }
    if (mudancas.length > 0) {
      registrarAcesso(perfil.id, "mudou_mensagem_padrao", {
        quick_reply_id: id,
        alvo: titulo,
        mudancas,
      });
    }
  }
  return pronto("Mensagem salva");
}

export async function excluirMensagem(
  _estado: ResultadoAcao,
  formData: FormData,
): Promise<ResultadoAcao> {
  const perfil = await gestorAtivo();
  if (!perfil) return SEM_PERMISSAO;
  const id = String(formData.get("id") ?? "");
  if (!id) return { erro: "Mensagem não informada." };

  const supabase = await createClient();
  const { data: excluida, error } = await supabase
    .from("quick_replies")
    .delete()
    .eq("id", id)
    .select("titulo, corpo")
    .maybeSingle();
  if (error) return { erro: amigavel(error.code, error.message) };
  // O texto vai junto: depois de excluída, o log é o único lugar que diz
  // o que ela dizia.
  if (excluida) {
    registrarAcesso(perfil.id, "excluiu_mensagem_padrao", {
      quick_reply_id: id,
      alvo: excluida.titulo,
      mudancas: [{ campo: "texto", antes: excluida.corpo, texto: true }],
    });
  }
  return pronto("Mensagem excluída");
}

// ===========================================================================
// Números de WhatsApp (instâncias)
// ===========================================================================

/**
 * Contatos que chegaram pelo webhook da Meta antes de o phone_number_id ser
 * cadastrado ficam sem vínculo com instância. Ao conectar a instância, adota
 * os órfãos cujas mensagens chegaram por esse número.
 */
async function adotarLeadsOrfaos(
  supabase: Awaited<ReturnType<typeof createClient>>,
  instanciaId: string,
  phoneNumberId: string,
) {
  const { data: interacoes } = await supabase
    .from("lead_interactions")
    .select("lead_id")
    .eq("tipo", "mensagem_recebida")
    .eq("metadados->>phone_number_id", phoneNumberId)
    .limit(1000);

  const ids = [...new Set((interacoes ?? []).map((i) => i.lead_id as string))];
  if (ids.length === 0) return;

  await supabase
    .from("leads")
    .update({ whatsapp_instance_id: instanciaId })
    .in("id", ids)
    .is("whatsapp_instance_id", null);
}

/** Os nomes da equipe pelos ids pedidos (o atendente fixo do número). */
async function nomesDaEquipe(
  supabase: Awaited<ReturnType<typeof createClient>>,
  ids: (string | null | undefined)[],
): Promise<Map<string, string>> {
  const validos = [...new Set(ids.filter((i): i is string => Boolean(i)))];
  if (validos.length === 0) return new Map();
  const { data } = await supabase
    .from("profiles")
    .select("id, nome")
    .in("id", validos);
  return new Map(
    ((data ?? []) as { id: string; nome: string }[]).map((p) => [p.id, p.nome]),
  );
}

export async function criarInstancia(
  _estado: ResultadoAcao,
  formData: FormData,
): Promise<ResultadoAcao> {
  const perfil = await gestorAtivo();
  if (!perfil) return SEM_PERMISSAO;
  const nome = String(formData.get("nome") ?? "").trim();
  const telefone = normalizarTelefone(String(formData.get("telefone") ?? ""));
  const vendedorId = String(formData.get("vendedor_id") ?? "");
  const phoneNumberId = String(
    formData.get("meta_phone_number_id") ?? "",
  ).trim();

  if (!nome) return { erro: "Dê um nome ao número." };
  if (!telefone) {
    return {
      erro: "Telefone inválido. Use DDD e número, por exemplo 11 98842-1170.",
    };
  }

  const supabase = await createClient();

  const { count } = await supabase
    .from("whatsapp_instances")
    .select("id", { count: "exact", head: true });
  if ((count ?? 0) >= MAX_INSTANCIAS) {
    return { erro: `O limite é de ${MAX_INSTANCIAS} números.` };
  }

  const { data: nova, error } = await supabase
    .from("whatsapp_instances")
    .insert({
      nome,
      telefone_e164: telefone,
      vendedor_id: vendedorId || null,
      meta_phone_number_id: phoneNumberId || null,
    })
    .select("id")
    .single();
  if (error) {
    return {
      erro:
        error.code === "23505"
          ? "Esse telefone já está cadastrado."
          : error.message,
    };
  }
  if (phoneNumberId && nova) {
    await adotarLeadsOrfaos(supabase, nova.id, phoneNumberId);
  }
  const atendente = vendedorId
    ? (await nomesDaEquipe(supabase, [vendedorId])).get(vendedorId)
    : undefined;
  registrarAcesso(perfil.id, "criou_numero", {
    instancia_id: nova?.id,
    alvo: nome,
    mudancas: [
      { campo: "telefone", depois: formatarTelefone(telefone) },
      ...(atendente ? [{ campo: "atendente", depois: atendente }] : []),
      ...(phoneNumberId ? [{ campo: "ID da Meta", depois: phoneNumberId }] : []),
    ],
  });
  return pronto(`Número “${nome}” adicionado`);
}

export async function atualizarInstancia(
  _estado: ResultadoAcao,
  formData: FormData,
): Promise<ResultadoAcao> {
  const perfil = await gestorAtivo();
  if (!perfil) return SEM_PERMISSAO;
  const id = String(formData.get("id") ?? "");
  const nome = String(formData.get("nome") ?? "").trim();
  const vendedorId = String(formData.get("vendedor_id") ?? "");
  const phoneNumberId = String(
    formData.get("meta_phone_number_id") ?? "",
  ).trim();
  if (!id) return { erro: "Número não informado." };
  if (!nome) return { erro: "Dê um nome ao número." };

  const supabase = await createClient();
  // Como estava, para o log.
  const { data: antes } = await supabase
    .from("whatsapp_instances")
    .select("nome, vendedor_id, meta_phone_number_id")
    .eq("id", id)
    .maybeSingle();
  const { data: gravada, error } = await supabase
    .from("whatsapp_instances")
    .update({
      nome,
      vendedor_id: vendedorId || null,
      meta_phone_number_id: phoneNumberId || null,
    })
    .eq("id", id)
    .select("id")
    .maybeSingle();
  if (error) return { erro: amigavel(error.code, error.message) };
  if (phoneNumberId) await adotarLeadsOrfaos(supabase, id, phoneNumberId);

  // Gravou, registra. Se a leitura de antes falhou, as mudanças vão só com o
  // depois, como em mudarPapel e alterarCorTag: o número mudou e o Log não
  // pode ficar sem a linha.
  if (gravada) {
    const nomes = await nomesDaEquipe(supabase, [antes?.vendedor_id, vendedorId]);
    const atendente = (v: string | null | undefined) =>
      (v && nomes.get(v)) || (v ? "pessoa removida" : "ninguém");
    const mudancas = soMudou([
      { campo: "nome", antes: antes?.nome, depois: nome, texto: true },
      {
        campo: "atendente",
        antes: antes ? atendente(antes.vendedor_id) : undefined,
        depois: atendente(vendedorId || null),
      },
      {
        campo: "ID da Meta",
        antes: antes ? antes.meta_phone_number_id || "nenhum" : undefined,
        depois: phoneNumberId || "nenhum",
      },
    ]);
    if (mudancas.length > 0) {
      registrarAcesso(perfil.id, "mudou_numero", {
        instancia_id: id,
        alvo: nome,
        mudancas,
      });
    }
  }
  return pronto(`Número “${nome}” salvo`);
}

export async function alternarInstancia(
  _estado: ResultadoAcao,
  formData: FormData,
): Promise<ResultadoAcao> {
  const perfil = await gestorAtivo();
  if (!perfil) return SEM_PERMISSAO;
  const id = String(formData.get("id") ?? "");
  if (!id) return { erro: "Número não informado." };

  const supabase = await createClient();
  const { data, error: erroLeitura } = await supabase
    .from("whatsapp_instances")
    .select("nome, ativa")
    .eq("id", id)
    .single();
  if (erroLeitura || !data) {
    return { erro: "Esse número não existe mais. Recarregue a página." };
  }
  // Estado pedido pelo formulário (1 ou 0), não "inverter": o duplo toque
  // na chave não desfaz o primeiro.
  const pedido = formData.get("ativa");
  const ativa = pedido === null ? !data.ativa : pedido === "1";
  const { data: gravada, error } = await supabase
    .from("whatsapp_instances")
    .update({ ativa })
    .eq("id", id)
    .select("id")
    .maybeSingle();
  if (error) return { erro: amigavel(error.code, error.message) };
  // O segundo toque de um duplo clique não muda nada e não vira registro.
  if (gravada && data.ativa !== ativa) {
    registrarAcesso(perfil.id, ativa ? "ativou_numero" : "desativou_numero", {
      instancia_id: id,
      alvo: data.nome,
    });
  }
  return pronto(`“${data.nome}” ${ativa ? "ativado" : "desativado"}`);
}

export async function excluirInstancia(
  _estado: ResultadoAcao,
  formData: FormData,
): Promise<ResultadoAcao> {
  const perfil = await gestorAtivo();
  if (!perfil) return SEM_PERMISSAO;
  const id = String(formData.get("id") ?? "");
  if (!id) return { erro: "Número não informado." };

  const supabase = await createClient();
  const { data: excluida, error } = await supabase
    .from("whatsapp_instances")
    .delete()
    .eq("id", id)
    .select("nome, telefone_e164")
    .maybeSingle();
  if (error) return { erro: amigavel(error.code, error.message) };
  if (excluida) {
    registrarAcesso(perfil.id, "excluiu_numero", {
      instancia_id: id,
      alvo: excluida.nome,
      mudancas: [
        { campo: "telefone", antes: formatarTelefone(excluida.telefone_e164) },
      ],
    });
  }
  return pronto("Número excluído");
}

// ===========================================================================
// Atendimento (parâmetros)
// ===========================================================================

const PARAMETROS_VALIDOS = new Set([
  "distribuicao_automatica",
  "envios_teto_dia",
]);

// Parâmetros liga/desliga aceitam 0; os demais exigem número positivo.
const PARAMETROS_BINARIOS = new Set(["distribuicao_automatica"]);

export async function salvarParametro(
  _estado: ResultadoAcao,
  formData: FormData,
): Promise<ResultadoAcao> {
  const perfil = await gestorAtivo();
  if (!perfil) return SEM_PERMISSAO;
  const chave = String(formData.get("chave") ?? "");
  const bruto = String(formData.get("valor") ?? "").trim();
  // Contagem se digita como se lê: "1.000" é mil, não um (o
  // normalizarNumero leria o ponto como decimal).
  const valor = PARAMETROS_BINARIOS.has(chave)
    ? normalizarNumero(bruto)
    : /^\d+$|^\d{1,3}(\.\d{3})+$/.test(bruto)
      ? Number(bruto.replace(/\./g, ""))
      : null;

  if (!PARAMETROS_VALIDOS.has(chave)) return { erro: "Parâmetro desconhecido." };
  if (PARAMETROS_BINARIOS.has(chave)) {
    if (valor !== 0 && valor !== 1) {
      return { erro: "Use 0 (desligado) ou 1 (ligado)." };
    }
  } else if (valor === null || valor <= 0) {
    return { erro: "Use um número inteiro maior que zero, como 250." };
  }

  const supabase = await createClient();
  const lido = await valorAtual(supabase, chave);
  // Upsert: chaves novas ainda não têm linha na tabela settings.
  const { error } = await supabase
    .from("settings")
    .upsert({ chave, valor, atualizado_em: new Date().toISOString() });
  if (error) return { erro: amigavel(error.code, error.message) };

  if (chave === "distribuicao_automatica") {
    // Sem linha, a distribuição está desligada (a mesma leitura da tela).
    const estava = lido ? Number(lido.valor ?? 0) === 1 : null;
    if (estava !== (valor === 1)) {
      registrarAcesso(
        perfil.id,
        valor === 1 ? "ligou_distribuicao" : "desligou_distribuicao",
      );
    }
    return pronto(
      valor === 1
        ? "Distribuição automática ligada"
        : "Distribuição automática desligada",
    );
  }
  // Sem linha, vale o teto padrão (lib/envios.ts), que é o que a tela mostra.
  const tetoAntes = lido ? tetoDeEnvios(lido.valor) : undefined;
  if (tetoAntes !== valor) {
    registrarAcesso(perfil.id, "mudou_teto_envios", {
      mudancas: [{ antes: tetoAntes, depois: valor ?? 0 }],
    });
  }
  return pronto(`Teto salvo: ${contagem(valor ?? 0, "envio", "envios")} por dia`);
}

// ===========================================================================
// Respostas automáticas (regra em lib/automaticas.ts; quem manda é o webhook)
// ===========================================================================

/** Dias e horas do atendimento, em Brasília. */
export async function salvarHorario(
  _estado: ResultadoAcao,
  formData: FormData,
): Promise<ResultadoAcao> {
  const perfil = await gestorAtivo();
  if (!perfil) return SEM_PERMISSAO;
  const dias = normalizarDias(formData.getAll("dias"));
  const inicio = normalizarHora(String(formData.get("inicio") ?? ""));
  const fim = normalizarHora(String(formData.get("fim") ?? ""));
  if (dias.length === 0) return { erro: "Marque pelo menos um dia." };
  if (!inicio || !fim) {
    return { erro: "Preencha o início e o fim, como 09:00 e 18:00." };
  }
  // "HH:MM" com zero à esquerda: a ordem do texto é a da hora.
  if (fim <= inicio) return { erro: "O fim precisa ser depois do início." };

  const horario = { dias, inicio, fim };
  const supabase = await createClient();
  const lido = await valorAtual(supabase, CHAVE_HORARIO);
  const { error } = await supabase.from("settings").upsert({
    chave: CHAVE_HORARIO,
    valor: horario,
    atualizado_em: new Date().toISOString(),
  });
  if (error) return { erro: amigavel(error.code, error.message) };
  // Comparado pelo resumo da tela: mesmo resumo, mesmo horário. Sem linha,
  // vale o padrão (lerHorario).
  const antes = lido ? horarioCurto(lerHorario(lido.valor)) : undefined;
  const depois = horarioCurto(horario);
  if (antes !== depois) {
    registrarAcesso(perfil.id, "mudou_horario", {
      mudancas: [{ antes, depois, texto: true }],
    });
  }
  return pronto(`Horário salvo: ${depois}`);
}

/**
 * Liga, desliga e muda o texto da resposta de fora do horário ou das
 * boas-vindas. Texto vazio não liga. O tamanho conta o texto como sai para
 * o contato, com o horário por extenso no lugar do {horario}.
 */
export async function salvarRespostaAutomatica(
  _estado: ResultadoAcao,
  formData: FormData,
): Promise<ResultadoAcao> {
  const perfil = await gestorAtivo();
  if (!perfil) return SEM_PERMISSAO;
  const tipo = formData.get("tipo");
  if (!ehTipoAutomatica(tipo)) return { erro: "Resposta desconhecida." };
  const ativo = formData.get("ativo") === "1";
  // As quebras de linha do meio ficam; só as pontas saem.
  const texto = String(formData.get("texto") ?? "")
    .replace(/\r\n?/g, "\n")
    .trim();
  if (ativo && !texto) return { erro: "Escreva o texto antes de ligar." };

  const supabase = await createClient();
  const { data: linhaHorario, error: erroHorario } = await supabase
    .from("settings")
    .select("valor")
    .eq("chave", CHAVE_HORARIO)
    .maybeSingle();
  if (erroHorario) {
    return { erro: `Não deu para ler o horário: ${erroHorario.message}` };
  }
  const saida = textoDaResposta(texto, lerHorario(linhaHorario?.valor));
  if (saida.length > LIMITE_TEXTO) {
    return {
      erro: `Texto longo demais: com o horário por extenso, passa de ${LIMITE_TEXTO.toLocaleString("pt-BR")} caracteres.`,
    };
  }

  const lido = await valorAtual(supabase, CHAVE_RESPOSTA[tipo]);
  const { error } = await supabase.from("settings").upsert({
    chave: CHAVE_RESPOSTA[tipo],
    valor: { ativo, texto },
    atualizado_em: new Date().toISOString(),
  });
  if (error) return { erro: amigavel(error.code, error.message) };

  // Uma linha por gravação: ligou ou desligou (com o texto, se mudou junto)
  // ou só mudou o texto. Sem linha, a resposta estava desligada com o texto
  // padrão (lerResposta), que é o que a tela mostrava.
  const estava = lido ? lerResposta(lido.valor, tipo) : null;
  const mudouTexto = !estava || estava.texto.trim() !== texto;
  const mudancas: Mudanca[] = mudouTexto
    ? [{ campo: "texto", antes: estava?.texto, depois: texto, texto: true }]
    : [];
  const acao =
    !estava || estava.ativo !== ativo
      ? ativo
        ? "ligou_resposta_automatica"
        : "desligou_resposta_automatica"
      : mudouTexto
        ? "mudou_resposta_automatica"
        : null;
  if (acao) {
    registrarAcesso(perfil.id, acao, {
      alvo: ROTULO_AUTOMATICA[tipo],
      ...(mudancas.length > 0 ? { mudancas } : {}),
    });
  }
  const nome = tipo === "fora_do_horario" ? "Fora do horário" : "Boas-vindas";
  return pronto(`${nome}: ${ativo ? "ligada" : "desligada"}`);
}
