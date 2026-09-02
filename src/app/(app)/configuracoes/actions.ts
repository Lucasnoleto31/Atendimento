"use server";

import { redirect } from "next/navigation";
import { revalidatePath } from "next/cache";
import { createClient, createServiceClient } from "@/lib/supabase/server";
import { perfilAtual } from "@/lib/auth";
import { normalizarNumero, normalizarTelefone } from "@/lib/csv";
import { criarTemplateResumoMeta } from "@/lib/whatsapp";

const MAX_INSTANCIAS = 10;

async function exigirGestor() {
  const perfil = await perfilAtual();
  if (!perfil || (perfil.papel !== "admin" && perfil.papel !== "gestor")) {
    redirect("/hoje");
  }
  return perfil;
}

function terminar(aviso?: string): never {
  revalidatePath("/configuracoes");
  // O carimbo t= muda a URL a cada volta: os formulários com estado de
  // cliente (anexos das mensagens padrão) usam-no como key para resetar —
  // sem ele, os chips da mensagem recém-criada sobravam no formulário
  // "nova" e grudavam na próxima.
  const t = `t=${Date.now()}`;
  redirect(
    aviso
      ? `/configuracoes?aviso=${encodeURIComponent(aviso)}&${t}`
      : `/configuracoes?${t}`,
  );
}

function amigavel(codigo: string | undefined, mensagem: string) {
  if (codigo === "23505") return "Já existe um registro com esse valor único.";
  if (codigo === "23503")
    return "Este item está em uso (há registros ligados a ele). Desative em vez de excluir.";
  return mensagem;
}

// ===========================================================================
// Produtos
// ===========================================================================

function lerProduto(formData: FormData) {
  const codigo = String(formData.get("codigo") ?? "")
    .trim()
    .toUpperCase();
  const nome = String(formData.get("nome") ?? "").trim();
  const recorrencia = String(formData.get("recorrencia") ?? "unica");
  const valor = normalizarNumero(String(formData.get("valor") ?? ""));

  if (!codigo || !nome) return { erro: "Código e nome são obrigatórios." };
  if (valor === null || valor < 0)
    return { erro: "Valor de comissão inválido. Use algo como 15,00." };
  if (!["unica", "recorrente", "por_operacao"].includes(recorrencia))
    return { erro: "Recorrência inválida." };

  return {
    dados: {
      codigo,
      nome,
      recorrencia,
      valor_comissao_centavos: Math.round(valor * 100),
    },
  };
}

export async function criarProduto(formData: FormData) {
  await exigirGestor();
  const lido = lerProduto(formData);
  if ("erro" in lido) terminar(lido.erro);

  const supabase = await createClient();
  const { error } = await supabase.from("products").insert(lido.dados);
  if (error) terminar(amigavel(error.code, error.message));
  terminar();
}

/** Produtos que o sistema procura pelo código: renomear desligaria motor. */
const CODIGOS_DE_SISTEMA = new Set(["ABERTURA", "ATIVACAO"]);

export async function atualizarProduto(formData: FormData) {
  await exigirGestor();
  const id = String(formData.get("id") ?? "");
  const lido = lerProduto(formData);
  if ("erro" in lido) terminar(lido.erro);

  const supabase = await createClient();
  // Código de sistema não muda pela tela — o valor e o nome, sim.
  const { data: atual } = await supabase
    .from("products")
    .select("codigo")
    .eq("id", id)
    .maybeSingle();
  const dados =
    atual && CODIGOS_DE_SISTEMA.has(atual.codigo)
      ? { ...lido.dados, codigo: atual.codigo }
      : lido.dados;
  const { error } = await supabase.from("products").update(dados).eq("id", id);
  if (error) terminar(amigavel(error.code, error.message));
  terminar();
}

export async function alternarProduto(formData: FormData) {
  await exigirGestor();
  const id = String(formData.get("id") ?? "");

  const supabase = await createClient();
  const { data } = await supabase
    .from("products")
    .select("ativo")
    .eq("id", id)
    .single();
  const { error } = await supabase
    .from("products")
    .update({ ativo: !data?.ativo })
    .eq("id", id);
  if (error) terminar(amigavel(error.code, error.message));
  terminar();
}

export async function excluirProduto(formData: FormData) {
  await exigirGestor();
  const id = String(formData.get("id") ?? "");

  const supabase = await createClient();
  const { data: atual } = await supabase
    .from("products")
    .select("codigo")
    .eq("id", id)
    .maybeSingle();
  if (atual && CODIGOS_DE_SISTEMA.has(atual.codigo)) {
    terminar(
      "Este produto é usado pelo sistema (abertura/ativação): desative em vez de excluir.",
    );
  }
  const { error } = await supabase.from("products").delete().eq("id", id);
  if (error) terminar(amigavel(error.code, error.message));
  terminar();
}

// ===========================================================================
// Tags
// ===========================================================================

const CORES_VALIDAS = new Set(["azul", "ambar", "verde", "vermelho", "neutro"]);

export async function criarTag(formData: FormData) {
  await exigirGestor();
  const nome = String(formData.get("nome") ?? "").trim();
  const cor = String(formData.get("cor") ?? "neutro");
  if (!nome) terminar("Dê um nome à tag.");
  if (!CORES_VALIDAS.has(cor)) terminar("Cor inválida.");

  const supabase = await createClient();
  const { error } = await supabase.from("tags").insert({ nome, cor });
  if (error) {
    terminar(
      error.code === "23505"
        ? `A tag “${nome}” já existe.`
        : error.message.includes("cor")
          ? "Cores de etiqueta dependem da migração 0016 — rode-a no SQL Editor."
          : error.message,
    );
  }
  terminar();
}

/** Troca a cor da etiqueta — o rótulo continua sendo o nome. */
export async function alterarCorTag(formData: FormData) {
  await exigirGestor();
  const id = String(formData.get("id") ?? "");
  const cor = String(formData.get("cor") ?? "");
  if (!id) terminar("Etiqueta não informada.");
  if (!CORES_VALIDAS.has(cor)) terminar("Cor inválida.");

  const supabase = await createClient();
  const { error } = await supabase.from("tags").update({ cor }).eq("id", id);
  if (error) terminar(amigavel(error.code, error.message));
  terminar();
}

export async function excluirTag(formData: FormData) {
  await exigirGestor();
  const id = String(formData.get("id") ?? "");

  const supabase = await createClient();
  const { error } = await supabase.from("tags").delete().eq("id", id);
  if (error) terminar(amigavel(error.code, error.message));
  terminar();
}

// ===========================================================================
// Mensagens padrão
// ===========================================================================

const MAX_ANEXOS_MENSAGEM = 5;

/**
 * Os anexos chegam como JSON num campo escondido (o componente cliente sobe
 * os arquivos por URL assinada e só manda os metadados). Valida forma,
 * quantidade e — o essencial — que cada URL aponta para o NOSSO bucket:
 * campo escondido é editável por quem souber, e mensagem padrão vai para
 * lead; URL alheia aqui viraria vetor de phishing com a nossa cara.
 */
function lerAnexosMensagem(
  bruto: string,
):
  { anexos: { tipo: string; url: string; nome: string }[] } | { erro: string } {
  let lista: unknown;
  try {
    lista = JSON.parse(bruto);
  } catch {
    return { erro: "Anexos inválidos — recarregue a página e tente de novo." };
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
    // dot-segments ANTES do fetch): compara origem + caminho JÁ normalizado
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
      return { erro: "Anexo fora do padrão — envie os arquivos de novo." };
    }
    anexos.push({
      tipo: a.tipo,
      // u só existe quando a.url era string — o guard acima garante.
      url: a.url as string,
      nome: String(a.nome ?? "anexo").slice(0, 120),
    });
  }
  return { anexos };
}

/** URL assinada para o navegador subir o anexo da mensagem padrão. */
export async function prepararUploadMensagemPadrao(
  nome: string,
): Promise<{ caminho?: string; token?: string; erro?: string }> {
  await exigirGestor();
  const limpo = nome.replace(/[^\w.\-]+/g, "_").slice(-80);
  const caminho = `mensagens-padrao/${crypto.randomUUID()}-${limpo}`;
  const service = createServiceClient();
  const { data, error } = await service.storage
    .from("midia-whatsapp")
    .createSignedUploadUrl(caminho);
  if (error) {
    return { erro: `Não deu para preparar o upload: ${error.message}` };
  }
  return { caminho, token: data.token };
}

export async function criarMensagem(formData: FormData) {
  await exigirGestor();
  const titulo = String(formData.get("titulo") ?? "").trim();
  const corpo = String(formData.get("corpo") ?? "").trim();
  if (!titulo || !corpo) terminar("Título e mensagem são obrigatórios.");

  // O campo só existe no form quando a coluna existe (0060) — presente,
  // sempre grava (inclusive [] para limpar).
  const brutoAnexos = formData.get("anexos");
  const payload: Record<string, unknown> = { titulo, corpo };
  if (brutoAnexos !== null) {
    const lidos = lerAnexosMensagem(String(brutoAnexos));
    if ("erro" in lidos) terminar(lidos.erro);
    payload.anexos = lidos.anexos;
  }

  const supabase = await createClient();
  const { error } = await supabase.from("quick_replies").insert(payload);
  if (error) {
    terminar(
      error.code === "42703" || error.code === "PGRST204"
        ? "Rode a migração 0060 para anexos nas mensagens padrão existirem."
        : amigavel(error.code, error.message),
    );
  }
  terminar();
}

export async function atualizarMensagem(formData: FormData) {
  await exigirGestor();
  const id = String(formData.get("id") ?? "");
  const titulo = String(formData.get("titulo") ?? "").trim();
  const corpo = String(formData.get("corpo") ?? "").trim();
  if (!id || !titulo || !corpo) terminar("Título e mensagem são obrigatórios.");

  const brutoAnexos = formData.get("anexos");
  const payload: Record<string, unknown> = { titulo, corpo };
  if (brutoAnexos !== null) {
    const lidos = lerAnexosMensagem(String(brutoAnexos));
    if ("erro" in lidos) terminar(lidos.erro);
    payload.anexos = lidos.anexos;
  }

  const supabase = await createClient();
  const { error } = await supabase
    .from("quick_replies")
    .update(payload)
    .eq("id", id);
  if (error) {
    terminar(
      error.code === "42703" || error.code === "PGRST204"
        ? "Rode a migração 0060 para anexos nas mensagens padrão existirem."
        : amigavel(error.code, error.message),
    );
  }
  terminar();
}

export async function excluirMensagem(formData: FormData) {
  await exigirGestor();
  const id = String(formData.get("id") ?? "");

  const supabase = await createClient();
  const { error } = await supabase.from("quick_replies").delete().eq("id", id);
  if (error) terminar(amigavel(error.code, error.message));
  terminar();
}

// ===========================================================================
// Instâncias de WhatsApp
// ===========================================================================

/**
 * Leads que chegaram pelo webhook da Meta antes de o phone_number_id ser
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

export async function criarInstancia(formData: FormData) {
  await exigirGestor();
  const nome = String(formData.get("nome") ?? "").trim();
  const telefone = normalizarTelefone(String(formData.get("telefone") ?? ""));
  const vendedorId = String(formData.get("vendedor_id") ?? "");

  if (!nome) terminar("Dê um nome à instância.");
  if (!telefone)
    terminar("Telefone inválido. Use DDD + número, ex.: 11 98842-1170.");

  const supabase = await createClient();

  const { count } = await supabase
    .from("whatsapp_instances")
    .select("id", { count: "exact", head: true });
  if ((count ?? 0) >= MAX_INSTANCIAS) {
    terminar(`Limite de ${MAX_INSTANCIAS} instâncias atingido.`);
  }

  const phoneNumberId = String(
    formData.get("meta_phone_number_id") ?? "",
  ).trim();

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
  if (error)
    terminar(
      error.code === "23505"
        ? "Já existe uma instância com esse telefone."
        : error.message,
    );
  if (phoneNumberId && nova) {
    await adotarLeadsOrfaos(supabase, nova.id, phoneNumberId);
  }
  terminar();
}

export async function atualizarInstancia(formData: FormData) {
  await exigirGestor();
  const id = String(formData.get("id") ?? "");
  const nome = String(formData.get("nome") ?? "").trim();
  const vendedorId = String(formData.get("vendedor_id") ?? "");
  if (!id || !nome) terminar("Nome inválido.");

  const phoneNumberId = String(
    formData.get("meta_phone_number_id") ?? "",
  ).trim();

  const supabase = await createClient();
  const { error } = await supabase
    .from("whatsapp_instances")
    .update({
      nome,
      vendedor_id: vendedorId || null,
      meta_phone_number_id: phoneNumberId || null,
    })
    .eq("id", id);
  if (error) terminar(amigavel(error.code, error.message));
  if (phoneNumberId) await adotarLeadsOrfaos(supabase, id, phoneNumberId);
  terminar();
}

export async function alternarInstancia(formData: FormData) {
  await exigirGestor();
  const id = String(formData.get("id") ?? "");

  const supabase = await createClient();
  const { data } = await supabase
    .from("whatsapp_instances")
    .select("ativa")
    .eq("id", id)
    .single();
  const { error } = await supabase
    .from("whatsapp_instances")
    .update({ ativa: !data?.ativa })
    .eq("id", id);
  if (error) terminar(amigavel(error.code, error.message));
  terminar();
}

export async function excluirInstancia(formData: FormData) {
  await exigirGestor();
  const id = String(formData.get("id") ?? "");

  const supabase = await createClient();
  const { error } = await supabase
    .from("whatsapp_instances")
    .delete()
    .eq("id", id);
  if (error) terminar(amigavel(error.code, error.message));
  terminar();
}

// ===========================================================================
// Metas do mês (só admin — RLS de profiles exige)
// ===========================================================================

export async function salvarMeta(formData: FormData) {
  const perfil = await exigirGestor();
  if (perfil.papel !== "admin") terminar("Só o admin altera metas.");

  const id = String(formData.get("id") ?? "");
  const valor = normalizarNumero(String(formData.get("meta") ?? ""));
  if (!id || valor === null || valor < 0) {
    terminar("Meta inválida. Use algo como 5.000,00 (ou 0 para sem meta).");
  }

  const supabase = await createClient();
  const { error } = await supabase
    .from("profiles")
    .update({ meta_mensal_centavos: Math.round(valor * 100) })
    .eq("id", id);
  if (error) terminar(amigavel(error.code, error.message));
  // A meta em R$ aparece na barra de progresso de /pagamentos — revalida lá
  // também (o terminar genérico só cuida de /configuracoes).
  revalidatePath("/pagamentos");
  terminar();
}

/**
 * Metas mensais por TIPO (contas abertas, ativações) — inteiros, 0 = sem
 * meta. Mesma regra da meta em R$: só o admin altera (o gatilho da 0050
 * garante isso também no banco).
 */
export async function salvarMetaTipo(formData: FormData) {
  const perfil = await exigirGestor();
  if (perfil.papel !== "admin") terminar("Só o admin altera metas.");

  const id = String(formData.get("id") ?? "");
  const campo = String(formData.get("campo") ?? "");
  const bruto = String(formData.get("meta") ?? "").trim();
  const valor = Number(bruto);

  if (!id || (campo !== "contas" && campo !== "ativacoes")) {
    terminar("Meta inválida.");
  }
  if (!Number.isInteger(valor) || valor < 0 || valor > 10_000) {
    terminar("Meta inválida. Use um número inteiro (0 para sem meta).");
  }

  const coluna = campo === "contas" ? "meta_contas_mes" : "meta_ativacoes_mes";
  const supabase = await createClient();
  const { error } = await supabase
    .from("profiles")
    .update({ [coluna]: valor })
    .eq("id", id);
  if (error) {
    // UPDATE em coluna ausente volta PGRST204 (schema cache do PostgREST),
    // não só o 42703 do Postgres — os dois significam "sem a 0050".
    terminar(
      error.code === "42703" || error.code === "PGRST204"
        ? "Rode a migração 0050 para as metas por tipo existirem."
        : amigavel(error.code, error.message),
    );
  }
  // As metas por tipo aparecem no placar de /pagamentos — revalida lá
  // também (o terminar genérico só cuida de /configuracoes).
  revalidatePath("/pagamentos");
  terminar();
}

/** WhatsApp da própria equipe (7.2): destino do resumo diário do gestor. */
export async function salvarWhatsapp(formData: FormData) {
  const perfil = await exigirGestor();
  if (perfil.papel !== "admin")
    terminar("Só o admin altera o WhatsApp da equipe.");

  const id = String(formData.get("id") ?? "");
  if (!id) terminar("Perfil inválido.");
  const bruto = String(formData.get("whatsapp") ?? "").trim();
  let numero: string | null = null;
  if (bruto) {
    numero = normalizarTelefone(bruto);
    if (!numero) {
      terminar("WhatsApp inválido. Use DDD + número, ex.: 62 98181-0004.");
    }
  }

  const supabase = await createClient();
  const { error } = await supabase
    .from("profiles")
    .update({ whatsapp_e164: numero })
    .eq("id", id);
  if (error) {
    // UPDATE com coluna desconhecida volta PGRST204 (schema cache do
    // PostgREST), não o 42703 do Postgres — os dois significam "sem a 0057".
    terminar(
      error.code === "42703" || error.code === "PGRST204"
        ? "Rode a migração 0057 para o WhatsApp da equipe existir."
        : amigavel(error.code, error.message),
    );
  }
  terminar();
}

/**
 * Cria o template resumo_diario direto na WABA (7.2) — o gestor não
 * conseguiu pelo WhatsApp Manager; o token do app tem a permissão de
 * gestão de templates (é a mesma que lista os aprovados nas Campanhas).
 */
export async function criarTemplateResumo() {
  await exigirGestor();
  // terminar() NUNCA pode ficar dentro do try: redirect() do Next funciona
  // LANÇANDO um erro interno (NEXT_REDIRECT) — o catch o engolia e mostrava
  // o sucesso como "A Meta recusou: NEXT_REDIRECT".
  let aviso: string;
  try {
    const status = await criarTemplateResumoMeta();
    aviso =
      status === "APPROVED"
        ? "Template resumo_diario criado e já aprovado."
        : `Template resumo_diario criado (status ${status}). A Meta ainda vai aprovar — horas a dias; o resumo passa a sair sozinho depois disso.`;
  } catch (e) {
    const m = e instanceof Error ? e.message : String(e);
    aviso = /already exists|já existe/i.test(m)
      ? "O template resumo_diario já existe na WABA — se ainda não chegou nada, ele deve estar aguardando a aprovação da Meta."
      : `A Meta recusou a criação: ${m}`;
  }
  terminar(aviso);
}

// ===========================================================================
// Parâmetros de reativação
// ===========================================================================

const PARAMETROS_VALIDOS = new Set([
  "queda_lotes_percentual",
  "dias_sem_giro",
  "dias_sem_resposta",
  "minutos_alerta_espera",
  "distribuicao_automatica",
  "dias_churn",
  "receita_por_lote",
  // As três abaixo SEMPRE estiveram na tela, mas faltavam aqui: salvar
  // falhava com "Parâmetro desconhecido" desde que os campos nasceram.
  "envios_teto_dia",
  "cadencia_por_dia",
  "custo_template_centavos",
  "resumo_gestor_ativo",
]);

// Parâmetros liga/desliga aceitam 0; os demais exigem número positivo.
const PARAMETROS_BINARIOS = new Set([
  "distribuicao_automatica",
  "resumo_gestor_ativo",
]);
// Zero desliga o recurso (ex.: receita por lote sem taxa definida).
const PARAMETROS_ZERO_OK = new Set([
  "receita_por_lote",
  "custo_template_centavos",
]);

export async function salvarParametro(formData: FormData) {
  await exigirGestor();
  const chave = String(formData.get("chave") ?? "");
  const valor = normalizarNumero(String(formData.get("valor") ?? ""));

  if (!PARAMETROS_VALIDOS.has(chave)) terminar("Parâmetro desconhecido.");
  if (PARAMETROS_BINARIOS.has(chave)) {
    if (valor !== 0 && valor !== 1)
      terminar("Use 0 (desligado) ou 1 (ligado).");
  } else if (PARAMETROS_ZERO_OK.has(chave)) {
    if (valor === null || valor < 0) terminar("Informe um número (0 desliga).");
  } else if (valor === null || valor <= 0) {
    terminar("Informe um número maior que zero.");
  }

  const supabase = await createClient();
  // Upsert: chaves novas ainda não têm linha na tabela settings.
  const { error } = await supabase
    .from("settings")
    .upsert({ chave, valor, atualizado_em: new Date().toISOString() });
  if (error) terminar(amigavel(error.code, error.message));
  terminar();
}

// ===========================================================================
// Cadência de follow-up
// ===========================================================================

const ANCORAS_VALIDAS = new Set([
  "lead_criado",
  "conta_aberta",
  "sem_giro",
  "queda_lotes",
]);

export async function criarRegraCadencia(formData: FormData) {
  await exigirGestor();
  const dias = Number(formData.get("dias"));
  const escolha = String(formData.get("template") ?? "");
  const ancora = String(formData.get("ancora") ?? "lead_criado");
  const [nome, idioma] = escolha.split("|");

  if (!Number.isInteger(dias) || dias <= 0 || dias > 90) {
    terminar("Dias inválidos: use um número inteiro entre 1 e 90.");
  }
  if (!nome || !idioma) terminar("Escolha um template aprovado.");
  if (!ANCORAS_VALIDAS.has(ancora)) terminar("Gatilho inválido.");

  const supabase = await createClient();
  const { error } = await supabase.from("followup_rules").insert({
    dias,
    template_nome: nome,
    template_idioma: idioma,
    ancora,
  });
  if (error) {
    terminar(
      error.message.includes("ancora")
        ? "Gatilhos de cliente dependem da migração 0015 — rode-a no SQL Editor."
        : amigavel(error.code, error.message),
    );
  }
  terminar();
}

export async function alternarRegraCadencia(formData: FormData) {
  await exigirGestor();
  const id = String(formData.get("id") ?? "");
  const ativo = formData.get("ativo") === "1";
  if (!id) terminar("Regra não informada.");

  const supabase = await createClient();
  const { error } = await supabase
    .from("followup_rules")
    .update({ ativo })
    .eq("id", id);
  if (error) terminar(amigavel(error.code, error.message));
  terminar();
}

export async function excluirRegraCadencia(formData: FormData) {
  await exigirGestor();
  const id = String(formData.get("id") ?? "");
  if (!id) terminar("Regra não informada.");

  const supabase = await createClient();
  const { error } = await supabase.from("followup_rules").delete().eq("id", id);
  if (error) terminar(amigavel(error.code, error.message));
  terminar();
}

/** Meta diária de contatos por pessoa (coluna da migração 0013). */
export async function salvarMetaContatos(formData: FormData) {
  const perfil = await exigirGestor();
  if (perfil.papel !== "admin") terminar("Só o admin altera metas.");

  const id = String(formData.get("id") ?? "");
  const contatos = Number(formData.get("contatos"));
  if (!id || !Number.isInteger(contatos) || contatos < 0 || contatos > 500) {
    terminar("Meta de contatos inválida: use um número inteiro (0 desliga).");
  }

  const supabase = await createClient();
  const { error } = await supabase
    .from("profiles")
    .update({ meta_contatos_dia: contatos })
    .eq("id", id);
  if (error) terminar(amigavel(error.code, error.message));
  // A meta de contatos alimenta o placar de /hoje — revalida lá também
  // (o terminar genérico só cuida de /configuracoes).
  revalidatePath("/hoje");
  terminar();
}
