"use server";

import { redirect } from "next/navigation";
import { after } from "next/server";
import { revalidatePath } from "next/cache";
import { createClient } from "@/lib/supabase/server";
import { perfilAtivo } from "@/lib/auth";
import { ehGestao } from "@/lib/papeis";
import { donoOculto, donosOcultosParaMim } from "@/lib/privacidade";
import { executarCampanhas } from "@/lib/campanhas";
import {
  listarTemplatesMeta,
  metaConfigurada,
  type TemplateWhatsapp,
} from "@/lib/whatsapp";
import { agoraEmBrasilia, formatarData } from "@/lib/format";
import { orcamentoEnviosRestante } from "@/lib/envios";
import {
  CHAVE_SEM_NOME,
  erroDoRitmo,
  nomeEhGenerico,
  primeiroEnvio,
  primeiroNome,
  rotuloHora,
  usaNome,
  variaveisEmBranco,
  type Ritmo,
} from "./regras";

/**
 * Gestão dos disparos em massa. Dois jeitos de chamar:
 *
 * - O assistente de nova campanha e o editor chamam direto e recebem
 *   { ok } ou { erro }: o erro aparece acima do botão com tudo preenchido
 *   (kit, bloco 8) e o sucesso fecha a folha e volta para a lista.
 * - O Pausar e o Começar do cartão são formulários de servidor: voltam para
 *   a lista com ?ok= (o retorno) ou ?aviso= (o erro).
 */

export type Resultado = { ok: string } | { erro: string };

/** Gestão ativa: conta desativada com a aba aberta não mexe em campanha. */
async function gestorAtivo() {
  const perfil = await perfilAtivo();
  return perfil && ehGestao(perfil.papel) ? perfil : null;
}

/** Volta para a lista com o retorno. O t muda a cada volta, para o mesmo
 *  texto duas vezes seguidas aparecer de novo. */
function voltar(retorno: { ok?: string; aviso?: string }): never {
  revalidatePath("/campanhas");
  const busca = new URLSearchParams();
  if (retorno.ok) busca.set("ok", retorno.ok);
  if (retorno.aviso) busca.set("aviso", retorno.aviso);
  busca.set("t", String(Date.now()));
  redirect(`/campanhas?${busca}`);
}

/**
 * O motor logo depois da resposta (after): em horário de envio ele leva
 * dezenas de segundos, e segurar a resposta faz o clique parecer morto. Com
 * MOTORES_DESLIGADOS=1 (máquina de desenvolvimento ligada no banco de
 * produção, a mesma trava do batimento do layout) não roda: a campanha fica
 * gravada e quem manda é o motor do servidor de verdade.
 */
function rodarMotorDepois() {
  if (process.env.MOTORES_DESLIGADOS === "1") return;
  after(() => executarCampanhas().catch(() => {}));
}

/**
 * O momento do primeiro envio no relógio de Brasília: já (agora) ou
 * "começa hoje às 9h", "os envios começam amanhã às 9h". Na mesma conta do
 * motor: o que a campanha já mandou hoje (campanhaId; a nova não mandou
 * nada) e o que sobra do teto do número. Sem isso, a cota do dia gasta virava
 * "enviando" para uma campanha que só manda amanhã.
 */
async function quandoComeca(
  supabase: Awaited<ReturnType<typeof createClient>>,
  ritmo: Ritmo,
  campanhaId?: string,
): Promise<{ agora: true } | { agora: false; texto: string }> {
  const relogio = agoraEmBrasilia();
  const [doDia, restanteTeto] = await Promise.all([
    campanhaId
      ? supabase
          .from("campanha_envios")
          .select("lead_id", { count: "exact", head: true })
          .eq("campanha_id", campanhaId)
          .gte("enviado_em", relogio.inicioDoDia)
      : Promise.resolve({ count: 0 }),
    orcamentoEnviosRestante(supabase),
  ]);
  const envio = primeiroEnvio(
    {
      ...ritmo,
      jaHoje: doDia.count ?? 0,
      restanteTeto,
      faltam: 1,
    },
    { dia: relogio.dia, hora: relogio.hora },
  );
  if (envio.tipo === "agora") return { agora: true };
  if (envio.tipo === "hoje") {
    return { agora: false, texto: `começa hoje às ${rotuloHora(envio.as)}` };
  }
  if (envio.tipo === "depois") {
    const antes =
      envio.motivo === "teto"
        ? "o teto de envios de hoje já foi usado e "
        : envio.motivo === "cota"
          ? "a cota de hoje já saiu e "
          : "";
    return {
      agora: false,
      texto: `${antes}os envios começam ${envio.quando} às ${rotuloHora(envio.as)}`,
    };
  }
  return { agora: false, texto: "ninguém no público para receber" };
}

/** O retorno de "criada" pelo status gravado: pausada, concluída ou o
 *  momento do primeiro envio. */
async function textoDeCriada(
  supabase: Awaited<ReturnType<typeof createClient>>,
  nome: string,
  status: string,
  ritmo: Ritmo,
  campanhaId?: string,
): Promise<string> {
  if (status === "pausada") return `${nome} criada, pausada.`;
  if (status === "concluida") return `${nome} criada e concluída.`;
  const quando = await quandoComeca(supabase, ritmo, campanhaId);
  return quando.agora
    ? `${nome} criada e enviando.`
    : `${nome} criada; ${quando.texto}.`;
}

/** Janela em que a mesma campanha, da mesma pessoa, conta como repetição do
 *  mesmo clique e não como campanha nova. */
const REPETIDA_MS = 10 * 60 * 1000;

/** Mesmas chaves com os mesmos valores, nos dois sentidos. */
function mesmoConteudo(
  a: Record<string, string>,
  b: Record<string, string>,
): boolean {
  const chavesA = Object.keys(a);
  return (
    chavesA.length === Object.keys(b).length &&
    chavesA.every((k) => a[k] === b[k])
  );
}

export type DadosNovaCampanha = Ritmo & {
  nome: string;
  etiquetaId: string;
  templateNome: string;
  templateIdioma: string;
  /** Valor de cada variável do template, pelo token ("1", "2"…). */
  valores: Record<string, string>;
  /** O que vai no lugar do {nome} de quem não tem nome. */
  semNome: string;
  /** Criar já ativa ("Criar e começar") ou pausada. */
  iniciar: boolean;
};

export async function criarCampanha(
  dados: DadosNovaCampanha,
): Promise<Resultado> {
  const perfil = await gestorAtivo();
  if (!perfil) return { erro: "Só a gestão cria campanha." };

  const nome = dados.nome.trim();
  if (!nome) return { erro: "Dê um nome à campanha." };
  if (nome.length > 120) return { erro: "O nome passa de 120 letras." };

  const ritmo: Ritmo = {
    porDia: dados.porDia,
    horaInicio: dados.horaInicio,
    horaFim: dados.horaFim,
    diasUteis: dados.diasUteis,
  };
  const erroRitmo = erroDoRitmo(ritmo);
  if (erroRitmo) return { erro: erroRitmo };

  const supabase = await createClient();
  const { data: etiqueta } = await supabase
    .from("tags")
    .select("id")
    .eq("id", dados.etiquetaId)
    .eq("ativo", true)
    .maybeSingle();
  if (!etiqueta) return { erro: "Essa etiqueta não existe mais. Escolha outra." };

  // Resposta perdida na rede: a tela mostrou erro, o rascunho ficou e o
  // segundo toque criaria outra campanha com o mesmo público e template (cada
  // contato pagaria o template duas vezes). A mesma campanha gravada há pouco
  // pela mesma pessoa, com as mesmas variáveis e o mesmo ritmo, vale como
  // criada. Variável ou ritmo diferente é campanha nova (quem corrigiu o
  // texto de uma campanha recém-criada não pode receber a antiga de volta).
  // O texto sai do que está gravado, não do botão desta vez: quem tentou
  // "Criar e começar" e depois "Criar pausada" fica sabendo que ela está
  // enviando.
  const acharRepetida = async (
    mesmasVariaveis: (gravadas: Record<string, string>) => boolean,
  ) => {
    const { data } = await supabase
      .from("campanhas")
      .select("id, status, parametros, por_dia, hora_inicio, hora_fim, dias_uteis")
      .eq("nome", nome)
      .eq("etiqueta_id", etiqueta.id)
      .eq("template_nome", dados.templateNome)
      .eq("template_idioma", dados.templateIdioma)
      .eq("criado_por", perfil.id)
      .gte("criado_em", new Date(Date.now() - REPETIDA_MS).toISOString())
      .order("criado_em", { ascending: false })
      .limit(5);
    return (data ?? []).find(
      (c) =>
        c.por_dia === ritmo.porDia &&
        c.hora_inicio === ritmo.horaInicio &&
        c.hora_fim === ritmo.horaFim &&
        c.dias_uteis === ritmo.diasUteis &&
        mesmasVariaveis((c.parametros ?? {}) as Record<string, string>),
    );
  };
  const comoCriada = async (
    repetida: NonNullable<Awaited<ReturnType<typeof acharRepetida>>>,
  ): Promise<Resultado> => {
    revalidatePath("/campanhas");
    return {
      ok: await textoDeCriada(
        supabase,
        nome,
        repetida.status,
        {
          porDia: repetida.por_dia,
          horaInicio: repetida.hora_inicio,
          horaFim: repetida.hora_fim,
          diasUteis: repetida.dias_uteis,
        },
        repetida.id,
      ),
    };
  };

  // Antes da Meta, pelo que veio da tela: a nova tentativa não depende de a
  // Meta responder de novo.
  const pedidas: Record<string, string> = {};
  for (const [token, valor] of Object.entries(dados.valores)) {
    if (valor?.trim()) pedidas[token] = valor.trim();
  }
  const repetidaAntes = await acharRepetida((gravadas) => {
    const { [CHAVE_SEM_NOME]: semNomeGravado, ...variaveis } = gravadas;
    if (semNomeGravado !== undefined && semNomeGravado !== dados.semNome.trim()) {
      return false;
    }
    return mesmoConteudo(variaveis, pedidas);
  });
  if (repetidaAntes) return comoCriada(repetidaAntes);

  // O template é conferido de novo na Meta: a tela pode ter ficado aberta
  // enquanto ele saía da lista de aprovados.
  if (!metaConfigurada()) {
    return { erro: "O WhatsApp (Meta) não está configurado neste ambiente." };
  }
  let template: TemplateWhatsapp | undefined;
  try {
    template = (await listarTemplatesMeta()).find(
      (t) => t.nome === dados.templateNome && t.idioma === dados.templateIdioma,
    );
  } catch (e) {
    return {
      erro: `A Meta não respondeu para conferir o template: ${e instanceof Error ? e.message : String(e)}. Tente de novo.`,
    };
  }
  if (!template) {
    return { erro: `O template ${dados.templateNome} não está aprovado na Meta.` };
  }

  // Só os tokens do template entram; variável em branco trava aqui, na
  // mesma regra do motor (template de uma variável só cai no {nome}).
  const parametros: Record<string, string> = {};
  for (const token of template.parametros) {
    const valor = dados.valores[token]?.trim();
    if (valor) parametros[token] = valor;
  }
  const emBranco = variaveisEmBranco(template.parametros, parametros);
  if (emBranco.length > 0) {
    return {
      erro: `Preencha a variável {{${emBranco[0]}}}: a Meta recusa variável vazia.`,
    };
  }
  if (usaNome(template.parametros, parametros)) {
    const semNome = dados.semNome.trim();
    if (!semNome) {
      return { erro: "Escreva o que vai no lugar do nome de quem não tem nome." };
    }
    parametros[CHAVE_SEM_NOME] = semNome;
  }

  // De novo logo antes do insert: o primeiro pedido pode ainda estar
  // esperando a Meta quando o segundo toque chega. Agora a janela de corrida
  // fica em milissegundos (sem trava no banco, não dá para fechar de vez).
  const repetidaDepois = await acharRepetida((gravadas) =>
    mesmoConteudo(gravadas, parametros),
  );
  if (repetidaDepois) return comoCriada(repetidaDepois);

  const { error } = await supabase.from("campanhas").insert({
    nome,
    template_nome: template.nome,
    template_idioma: template.idioma,
    parametros,
    etiqueta_id: etiqueta.id,
    por_dia: ritmo.porDia,
    dias_uteis: ritmo.diasUteis,
    hora_inicio: ritmo.horaInicio,
    hora_fim: ritmo.horaFim,
    // A campanha nasce pausada pelo padrão do banco; "Criar e começar"
    // grava ativa no mesmo insert (a check do status aceita os dois).
    status: dados.iniciar ? "ativa" : "pausada",
    criado_por: perfil.id,
  });
  if (error) return { erro: `Não deu para criar: ${error.message}` };

  // Ativa dentro da janela: o primeiro lote sai agora, sem esperar o
  // batimento.
  if (dados.iniciar) rodarMotorDepois();

  revalidatePath("/campanhas");
  return {
    ok: await textoDeCriada(
      supabase,
      nome,
      dados.iniciar ? "ativa" : "pausada",
      ritmo,
    ),
  };
}

/**
 * Começar ou pausar pelo cartão (formulário de servidor). Começar confere o
 * que faria o motor pular a campanha em silêncio (sem etiqueta, template fora
 * da lista, variável em branco) e recusa com o motivo, em vez de mostrar
 * "Enviando" para uma campanha que não envia.
 */
export async function alterarStatusCampanha(formData: FormData) {
  if (!(await gestorAtivo())) redirect("/chat");

  const id = String(formData.get("id") ?? "");
  const status = String(formData.get("status") ?? "");
  if (!id || !["ativa", "pausada"].includes(status)) {
    voltar({ aviso: "Pedido inválido. Recarregue a página." });
  }

  const supabase = await createClient();
  const { data: campanha } = await supabase
    .from("campanhas")
    .select(
      "id, nome, etiqueta_id, template_nome, template_idioma, parametros, por_dia, hora_inicio, hora_fim, dias_uteis",
    )
    .eq("id", id)
    .maybeSingle();
  if (!campanha) voltar({ aviso: "Essa campanha não existe mais." });

  if (status === "ativa") {
    if (!campanha.etiqueta_id) {
      voltar({
        aviso: `${campanha.nome} não tem público: a etiqueta dela foi excluída. Em Editar, use Criar parecida e escolha outra etiqueta.`,
      });
    }
    // Com a Meta fora do ar a conferência fica para o motor, que só manda
    // quando ela volta.
    const templates = metaConfigurada()
      ? await listarTemplatesMeta().catch(() => null)
      : null;
    if (templates) {
      const template = templates.find(
        (t) =>
          t.nome === campanha.template_nome &&
          t.idioma === campanha.template_idioma,
      );
      if (!template) {
        voltar({
          aviso: `O template ${campanha.template_nome} saiu da lista de aprovados na Meta: ${campanha.nome} não envia.`,
        });
      }
      const emBranco = variaveisEmBranco(
        template.parametros,
        campanha.parametros as Record<string, string> | null,
      );
      if (emBranco.length > 0) {
        voltar({
          aviso: `${campanha.nome} está sem a variável {{${emBranco[0]}}}. Em Editar, use Criar parecida e preencha a variável.`,
        });
      }
    }
  }

  const { error } = await supabase
    .from("campanhas")
    .update({ status, ...(status === "ativa" ? { concluida_em: null } : {}) })
    .eq("id", id);
  if (error) voltar({ aviso: `Não deu para atualizar: ${error.message}` });

  if (status === "ativa") {
    rodarMotorDepois();
    const quando = await quandoComeca(
      supabase,
      {
        porDia: campanha.por_dia,
        horaInicio: campanha.hora_inicio,
        horaFim: campanha.hora_fim,
        diasUteis: campanha.dias_uteis,
      },
      campanha.id,
    );
    voltar({
      ok: quando.agora
        ? `${campanha.nome} enviando.`
        : `${campanha.nome} ativa; ${quando.texto}.`,
    });
  }
  voltar({ ok: `${campanha.nome} pausada.` });
}

/**
 * Pausa todas as campanhas que estão enviando numa ida só (formulário de
 * servidor, como o Pausar do cartão): a mesma escrita do Pausar, para quando
 * a qualidade do número cai e cada minuto ainda manda template. Pega o que
 * estiver ativo na hora do clique, inclusive o que ficou ativo depois de a
 * tela abrir, e o retorno diz quantas pararam.
 */
export async function pausarTodasCampanhas(_formData: FormData) {
  if (!(await gestorAtivo())) redirect("/chat");

  const supabase = await createClient();
  const { data, error } = await supabase
    .from("campanhas")
    .update({ status: "pausada" })
    .eq("status", "ativa")
    .select("nome");
  if (error) voltar({ aviso: `Não deu para pausar: ${error.message}` });

  const pausadas = (data ?? []) as { nome: string }[];
  if (pausadas.length === 0) {
    voltar({ ok: "Nenhuma campanha estava enviando." });
  }
  voltar({
    ok:
      pausadas.length === 1
        ? `${pausadas[0].nome} pausada.`
        : `${pausadas.length.toLocaleString("pt-BR")} campanhas pausadas.`,
  });
}

/** Teto de linhas lidas para os motivos de recusa (o corte do PostgREST). */
const TETO_RECUSAS = 1000;

export type MotivoRecusa = {
  erro: string;
  total: number;
  /** "08/10/2026", a recusa mais recente com este texto. */
  ultima: string;
};

export type RecusasDaCampanha =
  | {
      motivos: MotivoRecusa[];
      /** Linhas lidas (até TETO_RECUSAS) e o total de recusas da campanha. */
      lidas: number;
      total: number;
    }
  | { erro: string };

/**
 * Os motivos de recusa de uma campanha, agrupados pelo texto do erro, com a
 * contagem e a data da última. Só leitura, sob demanda (a folha do cartão
 * pede ao abrir), das recusas mais recentes até o teto: o "Ver as recusas"
 * do número traz só as 5 últimas de todas as campanhas juntas.
 */
export async function recusasDaCampanha(
  campanhaId: string,
): Promise<RecusasDaCampanha> {
  if (!(await gestorAtivo())) return { erro: "Só a gestão vê as recusas." };
  if (!/^[0-9a-f-]{36}$/i.test(campanhaId)) {
    return { erro: "Campanha não informada." };
  }

  const supabase = await createClient();
  const { data, count, error } = await supabase
    .from("campanha_envios")
    .select("erro, enviado_em", { count: "exact" })
    .eq("campanha_id", campanhaId)
    .not("erro", "is", null)
    .order("enviado_em", { ascending: false })
    .limit(TETO_RECUSAS);
  if (error) return { erro: `Não deu para ler as recusas: ${error.message}` };

  const linhas = (data ?? []) as { erro: string | null; enviado_em: string }[];
  // Da mais recente para trás: a primeira linha de cada texto é a última
  // recusa com ele.
  const porTexto = new Map<string, { total: number; ultima: string }>();
  for (const l of linhas) {
    const texto = (l.erro ?? "").trim() || "Sem descrição da Meta";
    const atual = porTexto.get(texto);
    if (atual) atual.total++;
    else porTexto.set(texto, { total: 1, ultima: l.enviado_em });
  }
  const motivos = [...porTexto.entries()]
    .map(([erro, m]) => ({ erro, ...m }))
    .sort(
      (a, b) =>
        b.total - a.total || Date.parse(b.ultima) - Date.parse(a.ultima),
    )
    .map((m) => ({ ...m, ultima: formatarData(m.ultima) }));

  return {
    motivos,
    lidas: linhas.length,
    total: count ?? linhas.length,
  };
}

/**
 * Edita o ritmo de uma campanha existente: envios por dia, janela de horário
 * e dias úteis. Template, etiqueta e variáveis ficam de fora de propósito:
 * trocar a mensagem ou o público no meio do envio faz o histórico mentir
 * ("enviados 300" de QUAL mensagem?); para isso, crie outra.
 */
export async function editarRitmoCampanha(
  dados: Ritmo & { id: string },
): Promise<Resultado> {
  if (!(await gestorAtivo())) return { erro: "Só a gestão edita campanha." };
  if (!dados.id) return { erro: "Campanha não informada." };

  const erroRitmo = erroDoRitmo(dados);
  if (erroRitmo) return { erro: erroRitmo };

  const supabase = await createClient();
  const { data, error } = await supabase
    .from("campanhas")
    .update({
      por_dia: dados.porDia,
      hora_inicio: dados.horaInicio,
      hora_fim: dados.horaFim,
      dias_uteis: dados.diasUteis,
    })
    .eq("id", dados.id)
    .select("nome, status")
    .maybeSingle();
  if (error) return { erro: `Não deu para salvar: ${error.message}` };
  if (!data) return { erro: "Essa campanha não existe mais." };

  // Subiu o ritmo dentro da janela: o motor completa a cota nova do dia,
  // depois da resposta, pelo mesmo motivo do Começar.
  if (data.status === "ativa") rodarMotorDepois();
  revalidatePath("/campanhas");
  return { ok: `Ritmo de ${data.nome} salvo.` };
}

export async function excluirCampanha(id: string): Promise<Resultado> {
  if (!(await gestorAtivo())) return { erro: "Só a gestão exclui campanha." };
  if (!id) return { erro: "Campanha não informada." };

  const supabase = await createClient();
  const { data, error } = await supabase
    .from("campanhas")
    .delete()
    .eq("id", id)
    .select("nome");
  if (error) return { erro: `Não deu para excluir: ${error.message}` };
  if (!data?.length) return { erro: "Essa campanha já tinha sido excluída." };

  revalidatePath("/campanhas");
  return { ok: `${data[0].nome} excluída.` };
}

/**
 * Um primeiro nome de verdade do público, para a prévia da mensagem: o
 * primeiro da fila do motor (mesma ordem e mesmos filtros) que não tenha nome
 * inventado pelo sistema. Só o primeiro nome sai daqui: é dado de cliente na
 * tela de quem cria, e por isso não sai de contato de um dono oculto para
 * quem cria (Administração > Privacidade); sem a regra lida, não sai nome.
 */
export async function exemploDoPublico(
  etiquetaId: string,
): Promise<string | null> {
  if (!etiquetaId || !(await gestorAtivo())) return null;
  const supabase = await createClient();
  const [ocultos, { data }] = await Promise.all([
    donosOcultosParaMim().catch(() => null),
    supabase
      .from("lead_tags")
      .select("lead_id, lead:leads!inner(nome, responsavel_id)")
      .eq("tag_id", etiquetaId)
      .not("lead.telefone_e164", "is", null)
      .is("lead.marketing_bloqueado_em", null)
      .neq("lead.status", "perdido")
      .order("criado_em")
      .order("lead_id")
      .limit(30),
  ]);
  if (!ocultos) return null;
  for (const linha of (data ?? []) as unknown as {
    lead: { nome: string; responsavel_id: string | null } | null;
  }[]) {
    if (!linha.lead || donoOculto(linha.lead.responsavel_id, ocultos)) {
      continue;
    }
    const nome = linha.lead.nome;
    if (!nomeEhGenerico(nome)) return primeiroNome(nome, "");
  }
  return null;
}
