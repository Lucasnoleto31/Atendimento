import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { createClient, createServiceClient } from "@/lib/supabase/server";
import { perfilAtual } from "@/lib/auth";
import { ehGestao } from "@/lib/papeis";
import {
  buscarQualidadeNumero,
  listarTemplatesMeta,
  metaConfigurada,
  type TemplateWhatsapp,
} from "@/lib/whatsapp";
import { contarEnviosDesde, tetoDeEnvios } from "@/lib/envios";
import { agoraEmBrasilia } from "@/lib/format";
import { MAX_CAMPANHAS } from "../contatos/filtros";
import {
  CHAVE_SEM_NOME,
  montarPrevia,
  textoSemNome,
  usaNome,
  variaveisEmBranco,
  variaveisGravadas,
  type PublicoEtiqueta,
} from "./regras";
import type { TextoDaCampanha } from "./editar-campanha";
import { PainelDisparos, type CampanhaVista } from "./painel";
import { titulo } from "@/lib/marca";

export const metadata: Metadata = {
  title: titulo("Disparos"),
};

type Campanha = {
  id: string;
  nome: string;
  template_nome: string;
  template_idioma: string;
  parametros: Record<string, string> | null;
  etiqueta_id: string | null;
  por_dia: number;
  dias_uteis: boolean;
  hora_inicio: number;
  hora_fim: number;
  status: "ativa" | "pausada" | "concluida";
  criado_em: string;
  concluida_em: string | null;
};

type Cliente = Awaited<ReturnType<typeof createClient>>;

/** Registro de mais de 24h conta como velho e dispara nova consulta. */
function qualidadeEstaVelha(em?: string | null): boolean {
  return !em || Date.now() - Date.parse(em) > 24 * 3600_000;
}

/**
 * Estado em settings.numero_qualidade, gravado pelo webhook da Meta ou pela
 * consulta ativa desta página. `em` é DESDE QUANDO a nota vale (o que o
 * painel mostra); `verificado_em` é a última checagem (só controla as 24h:
 * o webhook não grava, e aí `em` faz os dois papéis, pois evento é fresco).
 */
type QualidadeNumero = {
  rating?: string | null;
  limite?: string | null;
  em?: string | null;
  verificado_em?: string | null;
};

/** Janela da rotina de erros: 7 dias para trás, em ISO. */
function seteDiasAtrasIso() {
  return new Date(Date.now() - 7 * 24 * 60 * 60 * 1000).toISOString();
}

/**
 * Nota do número na Meta. O webhook só avisa quando a qualidade MUDA: número
 * saudável que nunca mudou não gera evento, e o painel ficava em "sem dado"
 * para sempre. Sem evento gravado (ou com checagem de mais de 24h), pergunta
 * direto à Meta e guarda no mesmo lugar; o webhook segue cobrindo o tempo
 * real.
 */
async function qualidadeDoNumero(
  gravada: unknown,
): Promise<QualidadeNumero | null> {
  let qualidade =
    gravada && typeof gravada === "object"
      ? (gravada as QualidadeNumero)
      : null;

  if (
    !metaConfigurada() ||
    (qualidade?.rating &&
      !qualidadeEstaVelha(qualidade.verificado_em ?? qualidade.em))
  ) {
    return qualidade;
  }

  const inicioConsulta = new Date().toISOString();
  try {
    const aoVivo = await buscarQualidadeNumero();
    if (!aoVivo.rating) return qualidade;

    const mesmaNota = qualidade?.rating?.toUpperCase() === aoVivo.rating;
    qualidade = {
      rating: aoVivo.rating,
      // A consulta pode vir sem o tier: não apaga o que o webhook sabia.
      limite: aoVivo.limite ?? qualidade?.limite ?? null,
      // "desde" é a mudança de nota, não a checagem: nota igual mantém.
      em: mesmaNota && qualidade?.em ? qualidade.em : inicioConsulta,
      verificado_em: inicioConsulta,
    };
    const service = createServiceClient();
    const valor = {
      ...qualidade,
      telefone: aoVivo.telefone,
      evento: "consulta_api",
    };
    // Condicional para não atropelar o webhook: se um evento chegou no meio
    // do render (em >= agora), a escrita não acontece, e aí o registro dele,
    // mais fresco, é o que vale no painel também.
    const { data: gravadas, error: erroGravar } = await service
      .from("settings")
      .update({ valor, atualizado_em: inicioConsulta })
      .eq("chave", "numero_qualidade")
      .lt("valor->>em", inicioConsulta)
      .select("chave");
    if (erroGravar) {
      console.error("[campanhas] qualidade não persistiu:", erroGravar.message);
    } else if (!gravadas?.length) {
      if (gravada) {
        const { data: relido } = await service
          .from("settings")
          .select("valor")
          .eq("chave", "numero_qualidade")
          .maybeSingle();
        if (relido?.valor && typeof relido.valor === "object") {
          qualidade = relido.valor as QualidadeNumero;
        }
      } else {
        // Primeira gravação de todas; duplicata = webhook chegou antes.
        const { error: erroInserir } = await service.from("settings").insert({
          chave: "numero_qualidade",
          valor,
          atualizado_em: inicioConsulta,
        });
        if (erroInserir && !erroInserir.message.includes("duplicate")) {
          console.error(
            "[campanhas] qualidade não persistiu:",
            erroInserir.message,
          );
        }
      }
    }
  } catch {
    // Meta fora do ar: fica o que o webhook tiver gravado (ou "sem dado").
  }
  return qualidade;
}

/**
 * O público de uma etiqueta em quatro partes disjuntas, com os filtros do
 * motor (lib/campanhas.ts, proximosAlvos): recebem (telefone, marketing não
 * bloqueado, status diferente de perdido), sem telefone, bloquearam
 * marketing e perdidos (o resto). Contado no banco, sem trazer linha.
 */
async function contarPublico(
  supabase: Cliente,
  etiqueta: { id: string; nome: string; cor: string | null },
): Promise<PublicoEtiqueta> {
  const comContato = () =>
    supabase
      .from("lead_tags")
      .select("lead_id, lead:leads!inner(id)", {
        count: "exact",
        head: true,
      })
      .eq("tag_id", etiqueta.id);

  const [total, recebem, semTelefone, bloquearam] = await Promise.all([
    supabase
      .from("lead_tags")
      .select("lead_id", { count: "exact", head: true })
      .eq("tag_id", etiqueta.id),
    comContato()
      .not("lead.telefone_e164", "is", null)
      .is("lead.marketing_bloqueado_em", null)
      .neq("lead.status", "perdido"),
    comContato().is("lead.telefone_e164", null),
    comContato()
      .not("lead.telefone_e164", "is", null)
      .not("lead.marketing_bloqueado_em", "is", null),
  ]);

  const t = total.count ?? 0;
  const r = recebem.count ?? 0;
  const s = semTelefone.count ?? 0;
  const b = bloquearam.count ?? 0;
  return {
    ...etiqueta,
    total: t,
    recebem: r,
    semTelefone: s,
    bloquearam: b,
    perdidos: Math.max(t - r - s - b, 0),
  };
}

export default async function CampanhasPage({
  searchParams,
}: PageProps<"/campanhas">) {
  const { aviso, ok, t, antiga } = await searchParams;
  const supabase = await createClient();

  // Mesmo relógio do motor de envio (Brasília), e a janela da rotina de
  // erros.
  const relogio = agoraEmBrasilia();
  const seteDiasAtras = seteDiasAtrasIso();

  // Primeira rodada: o perfil sai junto com as leituras, que passam pelo RLS
  // do mesmo jeito. Quem não é da gestão é mandado embora antes de o
  // resultado virar tela.
  const [
    perfil,
    { data: linhas, error },
    listagem,
    { data: tags },
    { data: configs },
    { count: enviadosHojeCount },
    { data: errosLinhas },
  ] = await Promise.all([
    perfilAtual(),
    supabase
      .from("campanhas")
      .select(
        "id, nome, template_nome, template_idioma, parametros, etiqueta_id, por_dia, dias_uteis, hora_inicio, hora_fim, status, criado_em, concluida_em",
      )
      .order("criado_em", { ascending: false }),
    // Com a Meta fora do ar a lista fica vazia e a tela diz o porquê, em vez
    // de a página inteira cair.
    (metaConfigurada()
      ? listarTemplatesMeta().then(
          (templates) => ({ templates, erro: null as string | null }),
          (e: unknown) => ({
            templates: [] as TemplateWhatsapp[],
            erro: e instanceof Error ? e.message : String(e),
          }),
        )
      : Promise.resolve({
          templates: [] as TemplateWhatsapp[],
          erro: "O WhatsApp (Meta) não está configurado neste ambiente.",
        })),
    supabase.from("tags").select("id, nome, cor, ativo").order("nome"),
    supabase
      .from("settings")
      .select("chave, valor")
      .in("chave", ["numero_qualidade", "envios_teto_dia"]),
    // Teto do dia: mesma conta do motor (src/lib/envios.ts).
    contarEnviosDesde(supabase, relogio.inicioDoDia),
    // As 5 recusas mais recentes; o total é contado no banco, por campanha.
    supabase
      .from("campanha_envios")
      .select("campanha_id, erro, enviado_em")
      .not("erro", "is", null)
      .gte("enviado_em", seteDiasAtras)
      .order("enviado_em", { ascending: false })
      .limit(5),
  ]);

  if (!perfil) redirect("/entrar");
  if (!ehGestao(perfil.papel)) redirect("/chat");

  const semMigracao = Boolean(error);
  const campanhas = (linhas ?? []) as Campanha[];
  const etiquetas = (tags ?? []) as {
    id: string;
    nome: string;
    cor: string | null;
    ativo: boolean;
  }[];
  const configuracoes = (configs ?? []) as { chave: string; valor: unknown }[];
  const templates = listagem.templates;

  // O público conta para as etiquetas ativas (escolha da nova campanha) e
  // para as que alguma campanha usa, mesmo desativada.
  const usadas = new Set(
    campanhas.map((c) => c.etiqueta_id).filter((id): id is string => !!id),
  );
  const contadas = etiquetas.filter((e) => e.ativo || usadas.has(e.id));

  // Segunda rodada, toda em paralelo: o público de cada etiqueta, o
  // progresso de cada campanha e a nota do número.
  const [publicos, progressos, qualidade] = await Promise.all([
    Promise.all(
      contadas.map((e) =>
        contarPublico(supabase, { id: e.id, nome: e.nome, cor: e.cor }),
      ),
    ),
    Promise.all(
      campanhas.map(async (c) => {
        const concluida = c.status === "concluida";
        // Concluída não envia mais: a que concluiu antes de hoje não mandou
        // nada hoje e, passada uma semana da conclusão, não tem como haver
        // recusa recente. A que concluiu hoje conta o dia: o Retomar diz
        // quanto ainda cabe na cota, na mesma conta do motor.
        const concluidaAntes = (limite: string) =>
          concluida &&
          c.concluida_em !== null &&
          Date.parse(c.concluida_em) < Date.parse(limite);
        const semEnvioHoje = concluidaAntes(relogio.inicioDoDia);
        const semEnvioNaSemana = concluidaAntes(seteDiasAtras);
        const zero = Promise.resolve({ count: 0 });
        const envios = () =>
          supabase
            .from("campanha_envios")
            .select("lead_id", { count: "exact", head: true })
            .eq("campanha_id", c.id);

        const [total, doDia, falhas, erros7d, elegiveisJaEnviados] =
          await Promise.all([
            envios(),
            semEnvioHoje
              ? zero
              : envios().gte("enviado_em", relogio.inicioDoDia),
            envios().not("erro", "is", null),
            // Recusas da semana contadas no banco (head + exact): trazer as
            // linhas esbarraria no teto de 1000 do PostgREST em dia ruim.
            semEnvioNaSemana
              ? zero
              : envios()
                  .not("erro", "is", null)
                  .gte("enviado_em", seteDiasAtras),
            // Quem já recebeu e ainda está no público elegível da etiqueta:
            // tirado do público, dá exatamente quantos FALTAM pela regra do
            // motor. Quem bloqueou, virou perdido ou saiu da etiqueta depois
            // de receber não entra em nenhum dos dois lados da conta.
            c.etiqueta_id
              ? supabase
                  .from("campanha_envios")
                  .select("lead_id, lead:leads!inner(id, lead_tags!inner(tag_id))", {
                    count: "exact",
                    head: true,
                  })
                  .eq("campanha_id", c.id)
                  .not("lead.telefone_e164", "is", null)
                  .is("lead.marketing_bloqueado_em", null)
                  .neq("lead.status", "perdido")
                  .eq("lead.lead_tags.tag_id", c.etiqueta_id)
              : zero,
          ]);
        return [
          c.id,
          {
            enviados: total.count ?? 0,
            hoje: doDia.count ?? 0,
            falhas: falhas.count ?? 0,
            erros7d: erros7d.count ?? 0,
            jaEnviadosElegiveis: elegiveisJaEnviados.count ?? 0,
          },
        ] as const;
      }),
    ),
    qualidadeDoNumero(
      configuracoes.find((c) => c.chave === "numero_qualidade")?.valor,
    ),
  ]);

  const publicoPorEtiqueta = new Map(publicos.map((p) => [p.id, p]));
  const progresso = new Map(progressos);
  const teto = tetoDeEnvios(
    configuracoes.find((c) => c.chave === "envios_teto_dia")?.valor,
  );

  const vistas: CampanhaVista[] = campanhas.map((c, indice) => {
    const dados = progresso.get(c.id);
    const etiqueta = etiquetas.find((e) => e.id === c.etiqueta_id) ?? null;
    const publico = c.etiqueta_id
      ? (publicoPorEtiqueta.get(c.etiqueta_id) ?? null)
      : null;
    const faltam = publico
      ? Math.max(publico.recebem - (dados?.jaEnviadosElegiveis ?? 0), 0)
      : 0;

    const template = listagem.erro
      ? undefined
      : templates.find(
          (tpl) =>
            tpl.nome === c.template_nome && tpl.idioma === c.template_idioma,
        );

    // O que faz o motor pular a campanha em silêncio vira texto no cartão.
    // A saída é a mesma nos três casos: "Criar parecida", com o que falta
    // marcado na revisão.
    let bloqueio: string | null = null;
    if (!c.etiqueta_id) {
      bloqueio = "A etiqueta do público foi excluída: esta campanha não envia mais. Crie uma parecida com outra etiqueta.";
    } else if (!listagem.erro) {
      if (!template) {
        bloqueio = "O template saiu da lista de aprovados na Meta: esta campanha não envia. Crie uma parecida com outro template.";
      } else {
        const emBranco = variaveisEmBranco(template.parametros, c.parametros);
        if (emBranco.length > 0) {
          bloqueio = `Falta a variável {{${emBranco[0]}}}: esta campanha não envia. Crie uma parecida com ela preenchida.`;
        }
      }
    }

    // O texto que sai, com as variáveis gravadas e ‹nome› no lugar do nome:
    // o editor mostra, para ninguém precisar abrir uma conversa para saber.
    const texto: TextoDaCampanha = listagem.erro
      ? {
          indisponivel:
            "A lista de templates da Meta não carregou: o texto não aparece agora.",
        }
      : !template
        ? {
            indisponivel: `O template ${c.template_nome} saiu da lista de aprovados na Meta: o texto não aparece aqui.`,
          }
        : {
            previa: montarPrevia(
              template.corpo,
              template.parametros,
              c.parametros,
              "‹nome›",
            ),
            semNome: usaNome(template.parametros, c.parametros)
              ? textoSemNome(c.parametros)
              : null,
          };

    return {
      id: c.id,
      nome: c.nome,
      status: c.status,
      templateNome: c.template_nome,
      templateIdioma: c.template_idioma,
      etiquetaId: c.etiqueta_id,
      etiqueta: etiqueta ? { nome: etiqueta.nome, cor: etiqueta.cor } : null,
      valores: variaveisGravadas(c.parametros),
      semNome: c.parametros?.[CHAVE_SEM_NOME]?.trim() || null,
      ritmo: {
        porDia: c.por_dia,
        horaInicio: c.hora_inicio,
        horaFim: c.hora_fim,
        diasUteis: c.dias_uteis,
      },
      criadaEm: c.criado_em,
      concluidaEm: c.concluida_em,
      enviados: dados?.enviados ?? 0,
      falhas: dados?.falhas ?? 0,
      hoje: dados?.hoje ?? 0,
      faltam,
      bloqueio,
      semPublico: !c.etiqueta_id,
      publico,
      jaTiveramEnvio: dados?.jaEnviadosElegiveis ?? 0,
      // A lista vem da mais recente para trás, como o catálogo do filtro
      // Campanha do chat (as 50 mais recentes, conversas/lista.ts): fora
      // dele, o link das respostas abriria a fila sem o nome da campanha.
      noFiltroDoChat: indice < MAX_CAMPANHAS,
      texto,
    };
  });

  // Criada a parecida de uma campanha que não envia: o retorno oferece
  // excluir a antiga, se ela ainda existe.
  const vistaAntiga =
    typeof antiga === "string" ? vistas.find((v) => v.id === antiga) : undefined;

  const errosPorCampanha = campanhas
    .map((c) => ({ nome: c.nome, erros: progresso.get(c.id)?.erros7d ?? 0 }))
    .filter((c) => c.erros > 0)
    .sort((a, b) => b.erros - a.erros);
  const errosRecentes = (
    (errosLinhas ?? []) as {
      campanha_id: string;
      erro: string;
      enviado_em: string;
    }[]
  ).map((e) => ({
    quando: e.enviado_em,
    campanha:
      campanhas.find((c) => c.id === e.campanha_id)?.nome ??
      "campanha excluída",
    erro: e.erro,
  }));

  const bloqueioNova =
    templates.length > 0
      ? null
      : listagem.erro
        ? `Sem a lista de templates não dá para criar campanha. ${listagem.erro}`
        : "Nenhum template aprovado na Meta: sem ele não dá para criar campanha.";

  return (
    <PainelDisparos
      dados={{
        campanhas: vistas,
        publicos: publicos.filter(
          (p) => etiquetas.find((e) => e.id === p.id)?.ativo,
        ),
        templates: templates.map((tpl) => ({
          nome: tpl.nome,
          idioma: tpl.idioma,
          categoria: tpl.categoria,
          corpo: tpl.corpo,
          parametros: tpl.parametros,
        })),
        bloqueioNova,
        relogio: { dia: relogio.dia, hora: relogio.hora },
        teto,
        enviadosHoje: enviadosHojeCount ?? 0,
        qualidade: qualidade?.rating
          ? {
              rating: qualidade.rating,
              desde: qualidade.em ?? null,
              limite: qualidade.limite ?? null,
            }
          : null,
        erros7d: errosPorCampanha.reduce((s, c) => s + c.erros, 0),
        errosPorCampanha,
        errosRecentes,
        retorno: {
          ok: typeof ok === "string" ? ok : undefined,
          aviso: typeof aviso === "string" ? aviso : undefined,
          t: typeof t === "string" ? t : undefined,
          antiga: vistaAntiga
            ? {
                id: vistaAntiga.id,
                nome: vistaAntiga.nome,
                recebidos: Math.max(vistaAntiga.enviados - vistaAntiga.falhas, 0),
                recusadas: vistaAntiga.falhas,
                faltam: vistaAntiga.faltam,
                concluida: vistaAntiga.status === "concluida",
              }
            : null,
        },
        semMigracao,
        nomesUsados: campanhas.map((c) => c.nome),
      }}
    />
  );
}
