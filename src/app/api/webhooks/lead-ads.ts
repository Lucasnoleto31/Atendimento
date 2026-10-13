import type { createServiceClient } from "@/lib/supabase/server";
import {
  concluirEvento,
  FalhaDefinitiva,
  registrarEvento,
  type Registro,
} from "@/app/api/webhooks/eventos";
import { normalizarTelefone, variantesTelefone } from "@/lib/telefone";
import { escolherVendedor } from "@/lib/distribuicao";
import { CORES_ETIQUETA } from "@/lib/etiquetas";
import { chaveDaEtiqueta, etiquetaDaLinha } from "@/lib/imports/etiqueta";

/**
 * Lead Ads do Facebook e do Instagram (field "leadgen" do webhook da Meta).
 *
 * A Meta manda só os ids (leadgen_id, form_id, ad_id); as respostas vêm de
 * uma leitura na Graph API com o token da página, que precisa da permissão
 * leads_retrieval. Sem token ou sem permissão a leitura falha: o evento
 * fica em webhook_events com o motivo e o contato continua no Gerenciador
 * de Anúncios, para baixar à mão.
 *
 * O contato nasce no modelo de hoje, sem etapa nem status de funil, como o
 * importado: sem conversa, ele não entra na Caixa (que só lista quem trocou
 * mensagem). Entra com a etiqueta do formulário (ou da campanha), criada se
 * não existir, para servir de público de disparo, e com o responsável da
 * distribuição automática, quando ela está ligada. Telefone que já é contato
 * não duplica (as duas grafias do nono dígito): ganha a etiqueta e a nota
 * com as respostas, e o resto fica como está.
 *
 * O evento falho volta pela passada de reprocessamento (eventos.ts), a
 * partir do payload guardado: a leitura na Meta e as gravações podem falhar
 * por um instante, e a Meta não reenvia o que já recebeu 200. O formulário
 * sem um telefone que sirva não volta: as respostas não mudam de uma
 * tentativa para outra, e o evento fecha com o motivo na primeira.
 */

type Service = ReturnType<typeof createServiceClient>;

/** O value do change "leadgen". A Meta manda os ids como texto; número
 *  também é aceito. */
export type ValorLeadAds = {
  leadgen_id?: string | number;
  form_id?: string | number;
  ad_id?: string | number;
  adgroup_id?: string | number;
  page_id?: string | number;
  created_time?: number;
};

/** A mesma versão do cliente do WhatsApp (lib/whatsapp.ts). */
const GRAPH = "https://graph.facebook.com/v23.0";

/** A leitura das respostas segura o webhook: prazo curto. */
const PRAZO_RESPOSTAS_MS = 8_000;
/** Os nomes são enfeite da etiqueta: prazo menor, e a falha não pesa. */
const PRAZO_NOME_MS = 5_000;

/** A cor da etiqueta que nasce aqui: a mesma da importação (o Grafite). */
const COR_ETIQUETA_NOVA = "azul";

/** Os textos que vão para o banco têm teto. */
const MAX_NOME = 120;
const MAX_EMAIL = 254;
const MAX_NOTA = 2_000;

/**
 * O token que lê o formulário: o da página e, sem ele, o do WhatsApp (serve
 * quando o usuário do sistema tem a página e a permissão). `reserva` marca o
 * do WhatsApp, para o motivo da falha dizer que falta o META_PAGE_TOKEN: em
 * produção o do WhatsApp sempre existe, e sem a marca a falta da variável
 * apareceria como falta de permissão.
 */
function tokenDaPagina(): { token: string; reserva: boolean } | null {
  const daPagina = process.env.META_PAGE_TOKEN?.trim();
  if (daPagina) return { token: daPagina, reserva: false };
  const doWhatsapp = process.env.META_WHATSAPP_TOKEN?.trim();
  return doWhatsapp ? { token: doWhatsapp, reserva: true } : null;
}

/** Um id da Meta como texto, ou null. */
function id(valor: string | number | undefined): string | null {
  const texto = valor === undefined ? "" : String(valor).trim();
  return /^\d+$/.test(texto) ? texto : null;
}

/** A chave do evento em webhook_events, ou null sem leadgen_id válido. */
export function eventoDoLeadAds(valor: ValorLeadAds): string | null {
  const leadgenId = id(valor.leadgen_id);
  return leadgenId ? `leadgen-${leadgenId}` : null;
}

/**
 * GET na Graph API com o token no cabeçalho (fora da URL, que vai para log).
 * O erro sai em português com o motivo da Meta junto, que é o que fica em
 * webhook_events.
 */
async function lerGraph<T>(
  caminho: string,
  token: string,
  prazoMs: number,
): Promise<T> {
  let resposta: Response;
  try {
    resposta = await fetch(`${GRAPH}/${caminho}`, {
      headers: { Authorization: `Bearer ${token}` },
      cache: "no-store",
      signal: AbortSignal.timeout(prazoMs),
    });
  } catch (e) {
    if (e instanceof Error && e.name === "TimeoutError") {
      throw new Error(
        `A Meta não respondeu em ${(prazoMs / 1000).toLocaleString("pt-BR")} s.`,
      );
    }
    throw new Error(
      `Sem conexão com a Meta: ${e instanceof Error ? e.message : String(e)}`,
    );
  }
  const json = (await resposta.json().catch(() => null)) as
    | (T & { error?: { message?: string } })
    | null;
  if (!resposta.ok || !json || json.error) {
    throw new Error(
      `A Meta recusou a leitura (${resposta.status}): ${json?.error?.message ?? "sem detalhe"}`,
    );
  }
  return json;
}

type CampoMeta = { name?: string; values?: string[] };

type Formulario = {
  nome: string | null;
  telefone: string | null;
  email: string | null;
  /** As respostas que não viraram nome, telefone nem e-mail. */
  outras: string[];
};

/**
 * Nome, telefone e e-mail pelas chaves padrão da Meta (full_name,
 * phone_number, email) e, sem elas, pela pergunta personalizada que tem a
 * palavra no nome. "name" sozinho não serve de trecho: casaria com
 * company_name.
 */
function lerCampos(campos: CampoMeta[]): Formulario {
  const respostas = campos.map((c) => ({
    chave: (c.name ?? "").trim().toLowerCase(),
    valor: (c.values ?? [])
      .map((v) => String(v).trim())
      .filter(Boolean)
      .join(", "),
  }));
  const usadas = new Set<string>();
  const exata = (...chaves: string[]) => {
    for (const chave of chaves) {
      const achada = respostas.find((r) => r.chave === chave && r.valor);
      if (achada) {
        usadas.add(achada.chave);
        return achada.valor;
      }
    }
    return null;
  };
  const contendo = (...trechos: string[]) => {
    const achada = respostas.find(
      (r) => r.valor && trechos.some((t) => r.chave.includes(t)),
    );
    if (!achada) return null;
    usadas.add(achada.chave);
    return achada.valor;
  };

  const nomeInteiro = exata("full_name", "nome_completo", "nome", "name");
  const partes = nomeInteiro
    ? null
    : [exata("first_name"), exata("last_name")].filter(Boolean).join(" ");
  const nome = nomeInteiro || partes || contendo("nome");
  const telefone =
    exata("phone_number", "telefone", "celular", "whatsapp") ??
    contendo("phone", "telefone", "celular", "whatsapp");
  const email = exata("email") ?? contendo("email", "e-mail");

  return {
    nome,
    telefone,
    email,
    outras: respostas
      .filter((r) => r.valor && !usadas.has(r.chave))
      // A chave da pergunta personalizada é o texto dela com "_" no lugar
      // do espaço.
      .map((r) => `${r.chave.replaceAll("_", " ") || "campo"}: ${r.valor}`),
  };
}

/** O nome do formulário muda pouco: fica dez minutos em memória. */
const TTL_NOME_FORMULARIO_MS = 10 * 60_000;
const nomesDeFormulario = new Map<string, { nome: string; expira: number }>();

async function nomeDoFormulario(
  formId: string,
  token: string,
): Promise<string | null> {
  const guardado = nomesDeFormulario.get(formId);
  if (guardado && Date.now() < guardado.expira) return guardado.nome;
  try {
    const { name } = await lerGraph<{ name?: string }>(
      `${formId}?fields=name`,
      token,
      PRAZO_NOME_MS,
    );
    const nome = name?.trim();
    if (!nome) return null;
    nomesDeFormulario.set(formId, {
      nome,
      expira: Date.now() + TTL_NOME_FORMULARIO_MS,
    });
    return nome;
  } catch (e) {
    console.warn(
      `[lead ads] nome do formulário ${formId}: ${e instanceof Error ? e.message : String(e)}`,
    );
    return null;
  }
}

/**
 * O nome da campanha. Pede a permissão de leitura de anúncios (ads_read),
 * que o token da página pode não ter: por isso é uma leitura à parte, e a
 * falha só tira o nome.
 */
async function nomeDaCampanha(
  leadgenId: string,
  token: string,
): Promise<string | null> {
  try {
    const { campaign_name } = await lerGraph<{ campaign_name?: string }>(
      `${leadgenId}?fields=campaign_name`,
      token,
      PRAZO_NOME_MS,
    );
    return campaign_name?.trim() || null;
  } catch (e) {
    console.warn(
      `[lead ads] campanha do lead ${leadgenId}: ${e instanceof Error ? e.message : String(e)}`,
    );
    return null;
  }
}

/**
 * As respostas e o nome da origem, em paralelo: o webhook espera no máximo
 * o prazo da leitura das respostas. A origem segue a precedência da
 * importação (etiqueta.ts): o nome do formulário, o da campanha e, sem os
 * dois, o id do formulário.
 */
async function lerFormulario(
  leadgenId: string,
  formId: string | null,
): Promise<Formulario & { origem: string }> {
  const acesso = tokenDaPagina();
  if (!acesso) {
    throw new Error(
      "Sem META_PAGE_TOKEN na Vercel: o formulário não foi lido. O contato segue no Gerenciador de Anúncios.",
    );
  }
  const { token, reserva } = acesso;
  const [lido, doFormulario, daCampanha] = await Promise.all([
    lerGraph<{ field_data?: CampoMeta[] }>(
      `${leadgenId}?fields=field_data`,
      token,
      PRAZO_RESPOSTAS_MS,
    ).catch((e: unknown) => {
      if (!reserva) throw e;
      throw new Error(
        `Sem META_PAGE_TOKEN; o token do WhatsApp não leu o formulário: ${e instanceof Error ? e.message : String(e)}`,
      );
    }),
    formId ? nomeDoFormulario(formId, token) : null,
    nomeDaCampanha(leadgenId, token),
  ]);
  if (!Array.isArray(lido.field_data)) {
    throw new Error("A Meta respondeu sem as respostas do formulário.");
  }
  return {
    ...lerCampos(lido.field_data),
    origem: etiquetaDaLinha(
      doFormulario ?? "",
      daCampanha,
      formId ? `Lead Ads ${formId}` : "Lead Ads",
    ),
  };
}

type EtiquetaLida = { id: string; nome: string; ativo: boolean | null };

/** O nome como padrão do LIKE: %, _ e \ valem como texto. */
function paraLike(texto: string): string {
  return texto.replace(/[\\%_]/g, (c) => `\\${c}`);
}

/**
 * A etiqueta com este nome, criada se não existir, como a importação faz
 * (admin/actions.ts, garantirEtiquetas): a mesma chave (sem olhar
 * maiúscula, com acento), a mesma cor, e a arquivada volta a valer, porque
 * arquivada ela não aparece como público em Nova campanha. O ilike só
 * estreita a leitura; quem decide é a chave.
 */
async function garantirEtiqueta(
  service: Service,
  nome: string,
): Promise<{ id: string; nome: string }> {
  const chave = chaveDaEtiqueta(nome);
  const { data, error } = await service
    .from("tags")
    .select("id, nome, ativo")
    .ilike("nome", paraLike(nome));
  if (error) throw new Error(`Falha ao ler as etiquetas: ${error.message}`);
  const mesmas = ((data ?? []) as EtiquetaLida[]).filter(
    (t) => chaveDaEtiqueta(t.nome) === chave,
  );
  const existente = mesmas.find((t) => t.ativo !== false) ?? mesmas[0];

  if (existente) {
    if (existente.ativo === false) {
      const { error: erroReativar } = await service
        .from("tags")
        .update({ ativo: true })
        .eq("id", existente.id);
      if (erroReativar) {
        throw new Error(
          `Falha ao reativar a etiqueta “${existente.nome}”: ${erroReativar.message}`,
        );
      }
    }
    return { id: existente.id, nome: existente.nome };
  }

  const { data: nova, error: erroNova } = await service
    .from("tags")
    .insert({ nome, cor: COR_ETIQUETA_NOVA })
    .select("id, nome")
    .single();
  if (nova) {
    // No Log como as criadas na tela de Etiquetas e na importação. Sem
    // pessoa: o Log escreve "Sistema". A falha do registro não pesa.
    const rotuloCor =
      CORES_ETIQUETA.find((c) => c.chave === COR_ETIQUETA_NOVA)?.rotulo ??
      COR_ETIQUETA_NOVA;
    const { error: erroLog } = await service.from("auditoria").insert({
      quem: null,
      acao: "criou_etiqueta",
      detalhes: {
        alvo: nova.nome,
        mudancas: [{ campo: "cor", depois: rotuloCor }],
        motivo: "pelo Lead Ads",
      },
    });
    if (erroLog) {
      console.warn(`[lead ads] etiqueta sem registro no Log: ${erroLog.message}`);
    }
    return nova as { id: string; nome: string };
  }

  // Outro evento criou o mesmo nome no meio do caminho (o nome é único).
  if (erroNova?.code === "23505") {
    const { data: mesma } = await service
      .from("tags")
      .select("id, nome")
      .eq("nome", nome)
      .maybeSingle();
    if (mesma) return mesma as { id: string; nome: string };
  }
  throw new Error(
    `Falha ao criar a etiqueta “${nome}”: ${erroNova?.message ?? "sem detalhe"}`,
  );
}

/** O contato pelo telefone, nas duas grafias do nono dígito; a grafia
 *  exata ganha. */
async function acharContato(
  service: Service,
  telefone: string,
): Promise<string | null> {
  const { data, error } = await service
    .from("leads")
    .select("id, telefone_e164")
    .in("telefone_e164", variantesTelefone(telefone));
  if (error) throw new Error(`Falha ao buscar o contato: ${error.message}`);
  const candidatos = (data ?? []) as { id: string; telefone_e164: string }[];
  return (
    candidatos.find((l) => l.telefone_e164 === telefone)?.id ??
    candidatos[0]?.id ??
    null
  );
}

/**
 * Contato novo do formulário, com o responsável da distribuição automática
 * (quando ligada) e a atribuição registrada no fio, como no contato novo do
 * WhatsApp. Quando outro evento criou o mesmo telefone no meio do caminho,
 * devolve o dele.
 */
async function criarContato(
  service: Service,
  dados: {
    nome: string;
    telefone: string;
    email: string | null;
    origem: string;
    formId: string | null;
    adId: string | null;
  },
): Promise<string> {
  const atendente = await escolherVendedor(service);
  const { data: novo, error } = await service
    .from("leads")
    .insert({
      nome: dados.nome,
      telefone_e164: dados.telefone,
      email: dados.email,
      // A origem, como no original e como a importação grava: aqui, o nome
      // do formulário (ou da campanha). Os ids ficam nos utm_*.
      campanha: dados.origem,
      entrada_motivo: "meta_lead_ads",
      responsavel_id: atendente?.id ?? null,
      utm_source: "meta",
      utm_medium: "lead_ads",
      utm_campaign: dados.formId,
      utm_content: dados.adId,
    })
    .select("id")
    .single();

  if (error) {
    if (error.code !== "23505") throw new Error(error.message);
    const corrida = await acharContato(service, dados.telefone);
    if (!corrida) throw new Error(error.message);
    return corrida;
  }

  if (atendente) {
    const { error: erroAtribuicao } = await service
      .from("lead_interactions")
      .insert({
        lead_id: novo.id,
        tipo: "atribuicao",
        conteudo: `Atendimento atribuído a ${atendente.nome} (distribuição automática)`,
        metadados: { via: "distribuicao_automatica" },
      });
    if (erroAtribuicao) {
      console.warn(
        `[lead ads] atribuição de ${novo.id} sem registro: ${erroAtribuicao.message}`,
      );
    }
  }
  return novo.id as string;
}

/** Nova tentativa: a nota deste formulário já entrou numa tentativa
 *  anterior? */
async function notaJaGravada(
  service: Service,
  leadId: string,
  leadgenId: string,
): Promise<boolean> {
  const { data, error } = await service
    .from("lead_interactions")
    .select("id")
    .eq("lead_id", leadId)
    .eq("tipo", "nota")
    .eq("metadados->>leadgen_id", leadgenId)
    .limit(1);
  if (error) throw new Error(`Falha ao conferir a nota: ${error.message}`);
  return (data?.length ?? 0) > 0;
}

/**
 * Processa um evento "leadgen". `reivindicado` vem da passada de
 * reprocessamento, que já tomou a linha do evento para a nova tentativa.
 */
export async function registrarLeadAds(
  service: Service,
  valor: ValorLeadAds,
  reivindicado?: Registro,
) {
  const leadgenId = id(valor.leadgen_id);
  // Sem o id não há o que ler nem como deduplicar. A passada só chama com o
  // payload conferido (eventoDoLeadAds).
  if (!leadgenId) return;
  const eventoId = `leadgen-${leadgenId}`;

  const registro =
    reivindicado ?? (await registrarEvento(service, "meta", eventoId, valor));
  if (registro.tipo === "duplicado") return;

  try {
    const formId = id(valor.form_id);
    const adId = id(valor.ad_id);
    const lido = await lerFormulario(leadgenId, formId);

    // A Meta manda o número com o DDI ("+5562..."): com "+" e outro país,
    // vale como veio, em vez de cair na regra do DDD e virar um número
    // brasileiro de outra pessoa. Sem telefone que sirva, a falha é
    // definitiva: a próxima leitura traria as mesmas respostas.
    const telefone = lido.telefone
      ? normalizarTelefone(lido.telefone, { aceitarExterior: true })
      : null;
    if (!telefone) {
      throw new FalhaDefinitiva(
        lido.telefone
          ? `Telefone do formulário fora do formato (${lido.telefone.slice(0, 30)}): o contato segue no Gerenciador de Anúncios.`
          : "Formulário sem telefone: o contato segue no Gerenciador de Anúncios.",
      );
    }

    const existente = await acharContato(service, telefone);
    const leadId =
      existente ??
      (await criarContato(service, {
        nome: (lido.nome || `Lead Ads ${telefone.slice(-4)}`).slice(0, MAX_NOME),
        telefone,
        email: lido.email?.slice(0, MAX_EMAIL) || null,
        origem: lido.origem,
        formId,
        adId,
      }));

    // A etiqueta é o que faz o contato servir de público: sem ela o evento
    // fica com o erro e volta pela passada, que acha o contato já criado.
    const etiqueta = await garantirEtiqueta(service, lido.origem);
    const { error: erroVinculo } = await service
      .from("lead_tags")
      .upsert(
        { lead_id: leadId, tag_id: etiqueta.id },
        { onConflict: "lead_id,tag_id" },
      );
    if (erroVinculo) {
      throw new Error(
        `Contato ${leadId} sem a etiqueta “${etiqueta.nome}”: ${erroVinculo.message}`,
      );
    }

    // As respostas viram nota do sistema na conversa: quem atender sabe o
    // que a pessoa pediu. Do sistema, para não contar como leitura da
    // equipe (marcarNaoLidas) nem aparecer como anotação na ficha. Uma
    // linha só, porque a tela junta as quebras.
    const novaTentativa = registro.tipo === "novo" && registro.tentativa > 1;
    if (
      !(novaTentativa && (await notaJaGravada(service, leadId, leadgenId)))
    ) {
      const conteudo = (
        lido.outras.length > 0
          ? `Lead Ads (${lido.origem}): ${lido.outras.join("; ")}`
          : `Chegou pelo Lead Ads (${lido.origem}).`
      ).slice(0, MAX_NOTA);
      const { error: erroNota } = await service.from("lead_interactions").insert({
        lead_id: leadId,
        tipo: "nota",
        conteudo,
        metadados: {
          via: "lead_ads",
          sistema: true,
          leadgen_id: leadgenId,
          form_id: formId,
          ad_id: adId,
        },
      });
      if (erroNota) {
        throw new Error(`Falha ao gravar as respostas: ${erroNota.message}`);
      }
    }

    await concluirEvento(service, "meta", eventoId, registro);
  } catch (e) {
    await concluirEvento(service, "meta", eventoId, registro, e);
  }
}
