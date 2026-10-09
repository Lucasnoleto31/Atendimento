"use server";

import { revalidatePath } from "next/cache";
import { createClient, createServiceClient } from "@/lib/supabase/server";
import { perfilAtivo, perfilQueEscreve, type PerfilSessao } from "@/lib/auth";
import { registrarAcesso } from "@/lib/auditoria";
import { ehAtendente, veTudo } from "@/lib/papeis";
import { donoOculto, donosOcultosParaMim } from "@/lib/privacidade";
import { consultarContatos, idsDoFiltro } from "./consulta";
import { lerFiltros, UUID, type FiltrosContatos } from "./filtros";
import { lerIds, TETO_SELECAO, type AlcanceContatos } from "./selecao";

/*
 * As ações em massa da lista de contatos. Cada uma escreve por lote (uma
 * escrita no banco para o lote inteiro, não uma por contato), com o cliente
 * de quem está logado: quem decide o que muda é o RLS, como no cadastro. O
 * retorno diz quantos mudaram, quantos já estavam como pedido e quantos
 * ficaram de fora por permissão.
 *
 * O alcance sai da mesma consulta da lista (consultarContatos): a ação não
 * chega a um contato que a lista não mostraria, inclusive pela privacidade
 * entre pessoas da equipe (o contato de um dono oculto conta como recusado).
 *
 * Duas formas de alcance (AlcanceContatos): os ids marcados na tela (até
 * TETO_SELECAO, um lote só) ou, depois do "Marcar os N deste filtro", o
 * filtro da lista. Com o filtro, o servidor lê os ids pela consulta da
 * lista até TETO_FILTRO (idsDoFiltro, em consulta.ts, que diz por que a
 * leitura vai pelo id e só usa a ordem da tela quando há corte) e escreve
 * em lotes de TETO_SELECAO, somando o resultado de todos num aviso só.
 *
 * Etiquetar e transferir deixam uma linha no Log de acesso por ação, não uma
 * por contato (registrarEmMassa, abaixo).
 */

export type ResultadoEmMassa =
  | {
      ok: true;
      /** Contatos em que algo mudou. */
      mudaram: number;
      /** Contatos que já estavam como pedido. */
      iguais: number;
      /** Contatos que o RLS não deixa quem pediu alterar. */
      recusados: number;
      /** Transferir: o novo dono é alguém cujos contatos quem pediu não vê
       *  (Administração > Privacidade). Os que passaram saem da lista dele,
       *  e o aviso diz por quê. */
      saemDaVista?: boolean;
      /** Transferir: a troca valeu, mas a linha de atribuição no histórico
       *  das conversas não foi gravada. */
      semHistorico?: boolean;
      /** Pelo filtro: ele passava de TETO_FILTRO, e a ação parou nos
       *  primeiros da lista. */
      cortado?: boolean;
    }
  | { ok: false; erro: string };

type Cliente = Awaited<ReturnType<typeof createClient>>;

/** O que um lote devolve: os números, ou o erro com o que já tinha mudado
 *  nele antes de parar. */
type Lote<Extra = object> =
  | ({ ok: true; mudaram: number; iguais: number; recusados: number } & Extra)
  | { ok: false; erro: string; mudaram: number };

const SEM_PERMISSAO =
  "Sem permissão para alterar: o perfil é só de leitura ou a sessão expirou.";

const SEM_PRIVACIDADE =
  "Nada mudou: as regras de privacidade não carregaram. Tente de novo.";

const numero = new Intl.NumberFormat("pt-BR");

function falha(erro: string): ResultadoEmMassa {
  return { ok: false, erro };
}

/** Os ids da seleção, ou o texto do erro. */
function idsDaSelecao(valor: unknown): string[] | string {
  const ids = lerIds(valor) ?? [];
  if (ids.length === 0) return "Nenhum contato selecionado.";
  if (ids.length > TETO_SELECAO) {
    return `Selecione até ${numero.format(TETO_SELECAO)} contatos por vez.`;
  }
  return ids;
}

/** Os filtros vindos da query da URL da lista (a de consultaDosFiltros, a
 *  do CSV), lidos como a página lê. Parâmetro repetido entra inteiro. */
function filtrosDaConsulta(consulta: unknown): FiltrosContatos {
  const params: Record<string, string[]> = {};
  const texto = typeof consulta === "string" ? consulta : "";
  for (const [chave, valor] of new URLSearchParams(texto)) {
    (params[chave] ??= []).push(valor);
  }
  return lerFiltros(params);
}

/** Para quem vai a ação, em lotes; ou o texto do erro. */
type Alvo = { lotes: string[][]; cortado: boolean };

async function lerAlcance(
  supabase: Cliente,
  alcance: unknown,
  ocultos: readonly string[],
): Promise<Alvo | string> {
  if (Array.isArray(alcance)) {
    const ids = idsDaSelecao(alcance);
    return typeof ids === "string" ? ids : { lotes: [ids], cortado: false };
  }
  if (
    alcance === null ||
    typeof alcance !== "object" ||
    !("filtro" in alcance)
  ) {
    return "Nenhum contato selecionado.";
  }
  const filtros = filtrosDaConsulta((alcance as { filtro: unknown }).filtro);
  // Todos lidos antes da primeira escrita (idsDoFiltro).
  const r = await idsDoFiltro(supabase, filtros, ocultos);
  if ("erro" in r) return `Nada mudou: ${r.erro}`;
  if (r.ids.length === 0) {
    return "Nada mudou: o filtro não tem mais contatos. Atualize a lista.";
  }
  const lotes: string[][] = [];
  for (let i = 0; i < r.ids.length; i += TETO_SELECAO) {
    lotes.push(r.ids.slice(i, i + TETO_SELECAO));
  }
  return { lotes, cortado: r.cortado };
}

/**
 * O erro de um lote que não foi o primeiro a mudar alguma coisa: os lotes
 * de antes ficaram gravados, e o texto diz quantos. O "Nada mudou" do erro
 * do lote valeria só para ele.
 */
function falhaDoLote(
  r: { erro: string; mudaram: number },
  antes: number,
): ResultadoEmMassa {
  if (antes === 0) return falha(r.erro);
  const feitos = antes + r.mudaram;
  const motivo = r.erro.replace(/^Nada mudou: /, "");
  return falha(
    `Parou no meio: ${feitos === 1 ? "1 contato já tinha mudado" : `${numero.format(feitos)} contatos já tinham mudado`}. ${motivo.charAt(0).toLocaleUpperCase("pt-BR")}${motivo.slice(1)}`,
  );
}

/**
 * A linha da ação no Log de acesso: uma por ação, não uma por contato, com
 * quantos contatos mudaram de fato e por onde a ação foi (os marcados ou o
 * filtro). Só quando algo mudou: o que não foi gravado não entra. Se a ação
 * parou no meio, entra o que já tinha ficado gravado até parar, com o
 * motivo, como na importação de contatos: os lotes de antes e, ao etiquetar,
 * as etiquetas que o lote que falhou chegou a pôr (etiquetarContatos diz
 * como, sem dizer que tirou o que ficou).
 */
function registrarEmMassa(
  perfil: PerfilSessao,
  acao: "etiquetou_contatos" | "transferiu_contatos",
  alcance: AlcanceContatos,
  contatos: number,
  detalhes: Record<string, unknown>,
  parou = false,
) {
  if (contatos <= 0) return;
  registrarAcesso(perfil.id, acao, {
    ...detalhes,
    contatos,
    alcance: Array.isArray(alcance) ? "selecao" : "filtro",
    ...(parou ? { motivo: "parou com erro no meio" } : {}),
  });
}

/* ── etiquetas ─────────────────────────────────────────────────────────── */

/**
 * Põe e tira etiquetas de vários contatos de uma vez. `por` e `tirar` são
 * ids de etiqueta; a mesma nos dois vale como pôr. Etiqueta arquivada pode
 * sair de quem a tem, mas não entra em ninguém (a tela nem oferece).
 */
export async function etiquetarContatos(
  alcance: AlcanceContatos,
  por: string[],
  tirar: string[],
): Promise<ResultadoEmMassa> {
  const perfil = await perfilQueEscreve();
  if (!perfil) return falha(SEM_PERMISSAO);

  if (Array.isArray(alcance)) {
    const ids = idsDaSelecao(alcance);
    if (typeof ids === "string") return falha(ids);
  }
  const poe = lerIds(por) ?? [];
  const tira = (lerIds(tirar) ?? []).filter((t) => !poe.includes(t));
  if (poe.length === 0 && tira.length === 0) {
    return falha("Escolha uma etiqueta para pôr ou tirar.");
  }

  const supabase = await createClient();

  // O nome de cada etiqueta, para a linha do Log de acesso.
  const nomes = new Map<string, string>();
  if (poe.length > 0) {
    const { data: tags, error } = await supabase
      .from("tags")
      .select("id, nome, ativo")
      .in("id", poe);
    if (error) return falha(`Nada mudou: ${error.message}`);
    const lidas = (tags ?? []) as { id: string; nome: string; ativo: boolean }[];
    const ativas = new Set(lidas.filter((t) => t.ativo).map((t) => t.id));
    if (poe.some((t) => !ativas.has(t))) {
      return falha(
        "Nada mudou: uma das etiquetas foi arquivada ou apagada. Abra a lista de etiquetas de novo.",
      );
    }
    for (const t of lidas) nomes.set(t.id, t.nome);
  }
  if (tira.length > 0) {
    // Só o nome, para o log: tirar não depende dele, e a leitura que falha
    // não segura a ação (a linha do log sai sem o nome).
    const { data } = await supabase.from("tags").select("id, nome").in("id", tira);
    for (const t of (data ?? []) as { id: string; nome: string }[]) {
      nomes.set(t.id, t.nome);
    }
  }
  const nomesDe = (lista: string[]) =>
    lista.map((id) => nomes.get(id)).filter((n): n is string => Boolean(n));
  // `tirou: false` quando nenhuma remoção chegou a valer (o log não diz que
  // tirou uma etiqueta que ficou); `so_postas`, os contatos que só ganharam
  // as etiquetas novas, fora do número da linha.
  const registrar = (
    contatos: number,
    extra: { tirou?: boolean; so_postas?: number; parou?: boolean } = {},
  ) =>
    registrarEmMassa(
      perfil,
      "etiquetou_contatos",
      alcance,
      contatos,
      {
        ...(poe.length > 0 ? { etiquetas_postas: nomesDe(poe) } : {}),
        ...(tira.length > 0 && extra.tirou !== false
          ? { etiquetas_tiradas: nomesDe(tira) }
          : {}),
        ...(extra.so_postas ? { so_postas: extra.so_postas } : {}),
      },
      extra.parou,
    );

  const ocultos = await donosOcultosParaMim().catch(() => null);
  if (!ocultos) return falha(SEM_PRIVACIDADE);
  const alvo = await lerAlcance(supabase, alcance, ocultos);
  if (typeof alvo === "string") return falha(alvo);

  const soma = { mudaram: 0, iguais: 0, recusados: 0 };
  for (const ids of alvo.lotes) {
    const r = await etiquetarLote(supabase, ids, poe, tira, ocultos);
    if (!r.ok) {
      // O que entrou antes de parar fica gravado: a lista precisa mostrar,
      // e o log também. Os lotes de antes fizeram a ação inteira; o que
      // falhou só pode ter posto (r.mudaram vem do delete que falhou depois
      // do upsert), e nesses contatos nada saiu. Por isso eles vão à parte,
      // em so_postas, ou sozinhos e sem as tiradas quando são tudo o que
      // mudou.
      if (soma.mudaram + r.mudaram > 0) revalidatePath("/contatos");
      if (soma.mudaram > 0) {
        registrar(soma.mudaram, { so_postas: r.mudaram, parou: true });
      } else {
        registrar(r.mudaram, { tirou: false, parou: true });
      }
      return falhaDoLote(r, soma.mudaram);
    }
    soma.mudaram += r.mudaram;
    soma.iguais += r.iguais;
    soma.recusados += r.recusados;
  }

  if (soma.mudaram > 0) revalidatePath("/contatos");
  registrar(soma.mudaram);
  return { ok: true, ...soma, cortado: alvo.cortado || undefined };
}

/** Um lote de até TETO_SELECAO contatos. */
async function etiquetarLote(
  supabase: Cliente,
  ids: string[],
  poe: string[],
  tira: string[],
  ocultos: readonly string[],
): Promise<Lote> {
  // Só o que quem pediu enxerga: as policies de lead_tags usam a mesma
  // regra de visibilidade do contato, e pôr etiqueta num contato fora dela
  // não é ignorado pelo banco, desfaz a escrita inteira. Por isso o lote é
  // recortado antes.
  const { data: vistos, error: erroLeitura } = await consultarContatos(
    supabase,
    "id",
    { ids, ocultos },
  );
  if (erroLeitura) {
    return { ok: false, erro: `Nada mudou: ${erroLeitura.message}`, mudaram: 0 };
  }
  const alcance = ((vistos ?? []) as { id: string }[]).map((l) => l.id);
  const recusados = ids.length - alcance.length;
  if (alcance.length === 0) {
    return { ok: true, mudaram: 0, iguais: 0, recusados };
  }

  const mudou = new Set<string>();

  if (poe.length > 0) {
    // ignoreDuplicates: quem já tinha a etiqueta fica como está, e o
    // retorno traz só as linhas que entraram.
    const { data, error } = await supabase
      .from("lead_tags")
      .upsert(
        alcance.flatMap((lead_id) =>
          poe.map((tag_id) => ({ lead_id, tag_id })),
        ),
        { onConflict: "lead_id,tag_id", ignoreDuplicates: true },
      )
      .select("lead_id");
    if (error) return { ok: false, erro: erroDeEscrita(error), mudaram: 0 };
    for (const linha of (data ?? []) as { lead_id: string }[]) {
      mudou.add(linha.lead_id);
    }
  }

  if (tira.length > 0) {
    const { data, error } = await supabase
      .from("lead_tags")
      .delete()
      .in("lead_id", alcance)
      .in("tag_id", tira)
      .select("lead_id");
    if (error) {
      // As etiquetas postas já ficaram gravadas.
      return {
        ok: false,
        erro:
          mudou.size > 0
            ? `As etiquetas novas entraram, mas as outras não saíram: ${error.message}`
            : erroDeEscrita(error),
        mudaram: mudou.size,
      };
    }
    for (const linha of (data ?? []) as { lead_id: string }[]) {
      mudou.add(linha.lead_id);
    }
  }

  return {
    ok: true,
    mudaram: mudou.size,
    iguais: alcance.length - mudou.size,
    recusados,
  };
}

/* ── transferir ────────────────────────────────────────────────────────── */

/**
 * Passa vários contatos para uma pessoa da equipe (ou deixa sem dono). A
 * regra é a do cadastro: quem edita um contato pode trocar o responsável, e
 * o RLS recusa a troca que tiraria o contato da vista de quem a fez.
 */
export async function transferirContatos(
  alcance: AlcanceContatos,
  responsavelId: string | null,
): Promise<ResultadoEmMassa> {
  const perfil = await perfilQueEscreve();
  if (!perfil) return falha(SEM_PERMISSAO);

  if (Array.isArray(alcance)) {
    const ids = idsDaSelecao(alcance);
    if (typeof ids === "string") return falha(ids);
  }
  // null é "sem dono"; qualquer outra coisa tem de ser o id de alguém (o
  // argumento vem do navegador, e um valor torto não pode virar sem dono).
  if (
    responsavelId !== null &&
    (typeof responsavelId !== "string" || !UUID.test(responsavelId.trim()))
  ) {
    return falha("Nada mudou: essa pessoa não está na equipe.");
  }
  const para =
    responsavelId === null ? null : responsavelId.trim().toLowerCase();

  const supabase = await createClient();
  // Quem pediu não mexe no contato que não vê; passar PARA alguém oculto é
  // permitido (os contatos saem da lista de quem passou).
  const ocultos = await donosOcultosParaMim().catch(() => null);
  if (!ocultos) return falha(SEM_PRIVACIDADE);

  let nome: string | null = null;
  if (para) {
    const { data, error } = await supabase
      .from("profiles")
      .select("nome, ativo")
      .eq("id", para)
      .maybeSingle();
    if (error) return falha(`Nada mudou: ${error.message}`);
    const pessoa = data as { nome: string; ativo: boolean } | null;
    if (!pessoa) return falha("Nada mudou: essa pessoa não está na equipe.");
    if (!pessoa.ativo) {
      return falha(
        `Nada mudou: ${pessoa.nome} está com o acesso desativado. Escolha outra pessoa.`,
      );
    }
    nome = pessoa.nome;
  }

  const alvo = await lerAlcance(supabase, alcance, ocultos);
  if (typeof alvo === "string") return falha(alvo);

  // O novo dono pelo nome (e o id, que não muda com o nome) ou "sem dono".
  const registrar = (contatos: number, parou?: boolean) =>
    registrarEmMassa(
      perfil,
      "transferiu_contatos",
      alcance,
      contatos,
      para ? { alvo: nome, responsavel_id: para } : { sem_dono: true },
      parou,
    );

  const soma = { mudaram: 0, iguais: 0, recusados: 0 };
  let semHistorico = false;
  for (const ids of alvo.lotes) {
    const r = await transferirLote(supabase, perfil, ids, para, nome, ocultos);
    if (!r.ok) {
      // O lote que falhou não gravou nada (o update é uma escrita só); os
      // de antes ficaram, e o log diz quantos.
      if (soma.mudaram > 0) revalidatePath("/contatos");
      registrar(soma.mudaram, true);
      return falhaDoLote(r, soma.mudaram);
    }
    soma.mudaram += r.mudaram;
    soma.iguais += r.iguais;
    soma.recusados += r.recusados;
    semHistorico ||= r.semHistorico;
  }

  if (soma.mudaram > 0) revalidatePath("/contatos");
  registrar(soma.mudaram);
  return {
    ok: true,
    ...soma,
    saemDaVista: soma.mudaram > 0 && donoOculto(para, ocultos),
    semHistorico,
    cortado: alvo.cortado || undefined,
  };
}

/** Um lote de até TETO_SELECAO contatos. */
async function transferirLote(
  supabase: Cliente,
  perfil: PerfilSessao,
  ids: string[],
  para: string | null,
  nome: string | null,
  ocultos: readonly string[],
): Promise<Lote<{ semHistorico: boolean }>> {
  const { data: vistos, error: erroLeitura } = await consultarContatos(
    supabase,
    "id, responsavel_id, customer_id",
    { ids, ocultos },
  );
  if (erroLeitura) {
    return { ok: false, erro: `Nada mudou: ${erroLeitura.message}`, mudaram: 0 };
  }
  const linhas = (vistos ?? []) as {
    id: string;
    responsavel_id: string | null;
    customer_id: string | null;
  }[];

  const iguais = linhas.filter((l) => l.responsavel_id === para).length;
  const aMudar = linhas.filter((l) => l.responsavel_id !== para);

  // A policy de leitura de leads também vale para a linha como ela fica, e
  // uma linha recusada desfaz o update inteiro (é o 42501 do cadastro). Quem
  // não vê a base toda só passa adiante o que continua vendo depois da
  // troca: o atendente vê só os dele; o assessor vê os sem dono e os da
  // própria carteira (customers devolve, pelo RLS, só a carteira dele).
  let permitidos = aMudar;
  if (!veTudo(perfil.papel) && para !== perfil.id) {
    if (ehAtendente(perfil.papel)) {
      permitidos = [];
    } else if (para !== null) {
      const clientes = [
        ...new Set(
          aMudar
            .map((l) => l.customer_id)
            .filter((c): c is string => c !== null),
        ),
      ];
      let daCarteira = new Set<string>();
      if (clientes.length > 0) {
        const { data, error } = await supabase
          .from("customers")
          .select("id")
          .in("id", clientes);
        if (error) {
          return { ok: false, erro: `Nada mudou: ${error.message}`, mudaram: 0 };
        }
        daCarteira = new Set(
          ((data ?? []) as { id: string }[]).map((c) => c.id),
        );
      }
      permitidos = aMudar.filter(
        (l) => l.customer_id !== null && daCarteira.has(l.customer_id),
      );
    }
  }

  const recusados =
    ids.length - linhas.length + (aMudar.length - permitidos.length);
  if (permitidos.length === 0) {
    return { ok: true, mudaram: 0, iguais, recusados, semHistorico: false };
  }

  const { data: feitos, error } = await supabase
    .from("leads")
    .update({ responsavel_id: para })
    .in(
      "id",
      permitidos.map((l) => l.id),
    )
    .select("id");
  if (error) {
    return {
      ok: false,
      erro:
        error.code === "42501"
          ? "Nada mudou: com essa troca você deixaria de ver parte dos contatos. Peça a transferência à gestão."
          : `Nada mudou: ${error.message}`,
      mudaram: 0,
    };
  }
  const mudaram = ((feitos ?? []) as { id: string }[]).map((l) => l.id);

  // Uma linha no histórico de cada conversa, como na troca de dono pelo
  // chat: quem abre a conversa vê quem passou para quem. Falhar aqui não
  // desfaz a troca, que já está gravada, mas o resultado diz.
  let semHistorico = false;
  if (mudaram.length > 0) {
    semHistorico = !(await gravarHistorico(
      supabase,
      mudaram.map((lead_id) => ({
        lead_id,
        tipo: "atribuicao" as const,
        conteudo: nome
          ? `Atendimento atribuído a ${nome}`
          : "Atendimento ficou sem atendente",
        autor_id: perfil.id,
        metadados: { via: "crm", sistema: true, em_massa: true },
      })),
    ));
  }

  return {
    ok: true,
    mudaram: mudaram.length,
    iguais,
    recusados: recusados + (permitidos.length - mudaram.length),
    semHistorico,
  };
}

/* ── contagens ─────────────────────────────────────────────────────────── */

type Contagem = { ok: true; total: number } | { ok: false; erro: string };

/** Quantos contatos a lista tem com os filtros da query (count exato, sem
 *  linhas), com a mesma privacidade. Só lê. */
async function contarFiltro(consulta: unknown): Promise<Contagem> {
  const filtros = filtrosDaConsulta(consulta);
  const ocultos = await donosOcultosParaMim().catch(() => null);
  if (!ocultos) {
    return {
      ok: false,
      erro: "As regras de privacidade não carregaram. Tente de novo.",
    };
  }
  const supabase = await createClient();
  const { count, error } = await consultarContatos(supabase, "id", {
    filtros,
    ocultos,
    contar: true,
  });
  if (error) return { ok: false, erro: "Não deu para contar os contatos." };
  return { ok: true, total: count ?? 0 };
}

/**
 * Quantos contatos o CSV da lista filtrada vai levar, para a confirmação do
 * "Exportar CSV" dizer o número antes de baixar. Só lê (count exato, sem
 * linhas), com a mesma trava de papel da rota do CSV, os mesmos filtros
 * (lidos da query da URL do CSV por lerFiltros, como lá) e a mesma
 * privacidade. Não grava nada: o registro no log de acesso continua sendo
 * da rota, na hora de baixar.
 */
export async function contarParaExportar(consulta: string): Promise<Contagem> {
  const perfil = await perfilAtivo();
  if (!perfil) return { ok: false, erro: "Sua sessão terminou. Entre de novo." };
  if (!veTudo(perfil.papel)) {
    return {
      ok: false,
      erro: "Exportação da base é restrita à gestão. Peça a um gestor.",
    };
  }
  return contarFiltro(consulta);
}

/**
 * Quantos contatos o filtro da lista tem, para o "Marcar os N deste filtro"
 * da seleção. Pedida só quando a página inteira fica marcada e a lista tem
 * mais páginas. O número é o que a lista mostraria, pela mesma consulta e
 * a mesma privacidade: não diz nada além do que quem pede já vê.
 */
export async function contarDoFiltro(consulta: string): Promise<Contagem> {
  const perfil = await perfilAtivo();
  if (!perfil) return { ok: false, erro: "Sua sessão terminou. Entre de novo." };
  return contarFiltro(consulta);
}

type LinhaHistorico = {
  lead_id: string;
  tipo: "atribuicao";
  conteudo: string;
  autor_id: string;
  metadados: Record<string, unknown>;
};

/**
 * Grava as linhas de atribuição dos contatos que a troca confirmou. Primeiro
 * com a sessão de quem pediu; se o RLS recusar, pelo cliente de serviço, como
 * a rota do CSV faz com o log de acesso.
 *
 * A recusa é do assessor que passa um contato da carteira para outra pessoa:
 * o update vale (o RLS confere a linha antes do gatilho), e depois o gatilho
 * leads_sincroniza_dono_carteira passa o cliente para o novo dono, e o
 * contato sai da vista de quem pediu. O insert das linhas, que é uma escrita
 * só, levava 42501 e caía inteiro, calado. Os ids vêm do retorno do update,
 * e o autor é quem está logado: o cliente de serviço não grava nada que a
 * troca não tenha feito. Gravar antes do update não serve: lead_interactions
 * não tem policy de delete, e um update recusado deixaria o histórico de uma
 * troca que não houve.
 *
 * true quando gravou.
 */
async function gravarHistorico(
  supabase: Cliente,
  linhas: LinhaHistorico[],
): Promise<boolean> {
  const { error } = await supabase.from("lead_interactions").insert(linhas);
  if (!error) return true;
  try {
    const { error: erroServico } = await createServiceClient()
      .from("lead_interactions")
      .insert(linhas);
    return !erroServico;
  } catch {
    return false;
  }
}

function erroDeEscrita(error: { code?: string; message: string }): string {
  if (error.code === "42501") {
    return "Nada mudou: você não tem permissão sobre um dos contatos. Atualize a lista e tente de novo.";
  }
  return `Nada mudou: ${error.message}`;
}
