import { type NextRequest } from "next/server";
import { createClient, createServiceClient } from "@/lib/supabase/server";
import { buscarTudo } from "@/lib/supabase/paginar";
import { perfilAtivo } from "@/lib/auth";
import { veTudo } from "@/lib/papeis";
import { donosOcultosParaMim } from "@/lib/privacidade";
import { formatarData, hojeEmBrasilia } from "@/lib/format";
import { lerFiltros } from "@/app/(app)/contatos/filtros";
import {
  compararNaOrdemDaLista,
  consultarContatos,
  idsDoFiltro,
} from "@/app/(app)/contatos/consulta";
import {
  lerIds,
  SELECAO_FILTRO,
  TETO_FILTRO,
  TETO_SELECAO,
} from "@/app/(app)/contatos/selecao";

/**
 * Exporta os contatos em CSV com os MESMOS filtros da tela /contatos (busca,
 * período, etiquetas, responsáveis, campanha e canal, lidos por lerFiltros e
 * aplicados por consultarContatos, como na tela), e a mesma privacidade
 * entre pessoas da equipe (o contato de um dono oculto para quem exporta não
 * entra no arquivo). Com
 * ?ids=a,b,c, exporta só os contatos escolhidos na seleção da lista (até
 * TETO_SELECAO), no mesmo formato e com o mesmo registro no log de acesso.
 * Com ?selecao=filtro (o "Marcar os N deste filtro" da seleção), os filtros
 * valem como na lista filtrada, mas o arquivo para nos primeiros
 * TETO_FILTRO da lista, como as outras ações da seleção: os ids saem de
 * idsDoFiltro, o mesmo alcance da ação, e as linhas vêm por id, em lotes de
 * TETO_SELECAO, postas na ordem da tela no fim.
 * Separador ponto-e-vírgula e BOM para abrir certinho no Excel brasileiro.
 * Busca em lotes (buscarTudo) para furar o teto de 1000 linhas do
 * PostgREST; senão o CSV "completo" sairia pela metade.
 *
 * A resposta leva X-Linhas (quantos contatos foram no arquivo) e, quando o
 * filtro passava do teto, X-Cortado: 1. O aviso da seleção diz o que o
 * arquivo tem, não a contagem que a barra fez antes de baixar.
 */

function celula(valor: unknown): string {
  const texto = valor === null || valor === undefined ? "" : String(valor);
  // Nome vindo do WhatsApp pode começar com "=": no Excel viraria fórmula.
  const seguro = /^[=+\-@\t\r]/.test(texto) ? `'${texto}` : texto;
  return `"${seguro.replaceAll('"', '""')}"`;
}

/**
 * (11) 98842-1170. Sem o "+55" na frente: o "+" faria a célula cair na trava
 * de fórmula acima e ganhar um apóstrofo. O importador de contatos lê esse
 * formato de volta.
 *
 * Só número brasileiro (55 + DDD + 8 ou 9 dígitos) ganha a máscara. O resto
 * sai em dígitos crus, sem "+" pelo mesmo motivo: mascarado, o "1 415…" dos
 * EUA perderia o DDI e viraria "(14) 15555-2671", com cara de número de Bauru.
 * O número de fora, porém, não volta certo pelo importador, que toma todo
 * número por brasileiro, com ou sem "+": com 10 ou 11 dígitos ganha o 55 na frente
 * (o "1 415…" vira o mesmo número de Bauru), e com outro tamanho é recusado
 * como telefone inválido. Contato de fora volta para a base pelo cadastro,
 * digitado com o "+".
 */
function telefoneCsv(e164: string | null): string {
  if (!e164) return "";
  const d = e164.replace(/\D/g, "");
  if (!d.startsWith("55") || (d.length !== 12 && d.length !== 13)) return d;
  const ddd = d.slice(2, 4);
  const numero = d.slice(4);
  const corte = numero.length - 4;
  return `(${ddd}) ${numero.slice(0, corte)}-${numero.slice(corte)}`;
}

// Canal e Campanha são a origem do contato, como no CSV do sistema original:
// o canal de entrada (leads.channel_id, a mesma origem da ficha) e
// leads.campanha, que a importação e a /captura ainda gravam. Status e Etapa
// eram do funil e ficaram fora. O importador lê a Campanha de volta como a
// campanha da linha.
const CABECALHO = [
  "Nome",
  "Telefone",
  "E-mail",
  "Instagram",
  "Canal",
  "Campanha",
  "Etiquetas",
  "Responsável",
  "Criado em",
];

// id e ultima_interacao_em não vão para o arquivo: servem à ordem da tela
// no CSV do filtro inteiro.
const CAMPOS =
  "id, nome, telefone_e164, email, instagram_usuario, campanha, criado_em, " +
  "ultima_interacao_em, canal:channels(nome), " +
  "responsavel:profiles(nome), etiquetas:lead_tags(tag:tags(nome))";

/** Quantos lotes de ids do filtro inteiro vão ao banco de uma vez. */
const LOTES_JUNTOS = 5;

type Linha = {
  id: string;
  ultima_interacao_em: string | null;
  nome: string;
  telefone_e164: string | null;
  email: string | null;
  instagram_usuario: string | null;
  campanha: string | null;
  criado_em: string;
  canal: { nome: string } | null;
  responsavel: { nome: string } | null;
  etiquetas: { tag: { nome: string } | null }[] | null;
};

export async function GET(request: NextRequest) {
  // Conta desativada não leva a base: quem saiu da empresa com a aba aberta
  // ainda tem sessão até o token vencer, e o link do CSV continua na tela.
  const perfil = await perfilAtivo();
  if (!perfil) {
    return new Response("Conta desativada. Peça o acesso à gestão.", {
      status: 403,
    });
  }
  // A base com telefones é O ativo da mesa: exportação completa é coisa de
  // gestão (e compliance), e toda exportação deixa rastro de quem levou o quê.
  if (!veTudo(perfil.papel)) {
    return new Response(
      "Exportação da base é restrita à gestão. Peça a um gestor.",
      { status: 403 },
    );
  }
  const trilha = createServiceClient();

  // A seleção vem só com os ids: os filtros da lista já serviram para
  // escolher. Seleção vazia (ou só com ids tortos) não vira a base inteira.
  const ids = lerIds(request.nextUrl.searchParams.get("ids"));
  if (ids !== null && ids.length === 0) {
    return new Response("Nenhum contato escolhido para exportar.", {
      status: 400,
    });
  }
  if (ids !== null && ids.length > TETO_SELECAO) {
    return new Response(
      `A seleção passa de ${TETO_SELECAO.toLocaleString("pt-BR")} contatos. Exporte a lista filtrada.`,
      { status: 400 },
    );
  }
  // Parâmetro repetido (?etiquetas=a&etiquetas=b) entra inteiro, como na
  // página: Object.fromEntries ficaria só com o último.
  const params: Record<string, string[]> = {};
  for (const [chave, valor] of request.nextUrl.searchParams) {
    (params[chave] ??= []).push(valor);
  }
  const filtros = lerFiltros(params);
  // A seleção do filtro inteiro: o teto e a ordem da lista. Com ids, eles
  // mandam (o ?selecao= sobrando não muda nada).
  const doFiltro =
    ids === null &&
    request.nextUrl.searchParams.get("selecao") === SELECAO_FILTRO;

  // Sem a regra lida, nada sai: o arquivo levaria o que a tela esconde.
  let ocultos: string[];
  try {
    ocultos = await donosOcultosParaMim();
  } catch {
    return new Response(
      "Não deu para exportar: as regras de privacidade não carregaram. Tente de novo.",
      { status: 500 },
    );
  }

  const supabase = await createClient();
  let dados: Linha[];
  let erro: string | null;
  let cortado = false;
  if (doFiltro) {
    ({ dados, erro, cortado } = await linhasDoFiltro(
      supabase,
      filtros,
      ocultos,
    ));
  } else {
    const r = await buscarTudo((de, ate) =>
      consultarContatos(
        supabase,
        CAMPOS,
        ids !== null ? { ids, ocultos } : { filtros, ocultos },
      )
        .order("criado_em", { ascending: false })
        // O id desempata: sem ordem estável, um lote repetiria ou pularia
        // linhas do anterior.
        .order("id")
        .range(de, ate),
    );
    dados = r.dados as unknown as Linha[];
    erro = r.erro;
  }

  // CSV pela metade é pior que nenhum: quem baixa acha que é a base toda.
  if (erro) {
    return new Response(`Não deu para exportar os contatos: ${erro}`, {
      status: 500,
    });
  }

  // Mesma ação de sempre no log de acesso: a trilha de exportação da base
  // continua uma só, com o rótulo e o selo de sensível que o log já conhece.
  // Grava antes de montar o arquivo e confere: base que sai sem rastro de
  // quem levou não sai.
  const { error: erroTrilha } = await trilha.from("auditoria").insert({
    quem: perfil.id,
    acao: "exportar_leads",
    // Na seleção, os ids escolhidos ficam no registro: quem levou o quê.
    detalhes:
      ids !== null
        ? { origem: "contatos", selecao: ids, linhas: dados.length }
        : {
            origem: "contatos",
            // A seleção do filtro inteiro: os filtros e o teto que valeu.
            ...(doFiltro ? { selecao: SELECAO_FILTRO, teto: TETO_FILTRO } : {}),
            busca: filtros.busca,
            etiquetas: filtros.etiquetas,
            etiquetas_modo: filtros.etiquetasModo,
            sem_etiqueta: filtros.semEtiqueta,
            responsaveis: filtros.responsaveis,
            campanha: filtros.campanha,
            canal: filtros.canal,
            periodo:
              filtros.de || filtros.ate
                ? { data: filtros.data, de: filtros.de, ate: filtros.ate }
                : null,
            linhas: dados.length,
          },
  });
  if (erroTrilha) {
    return new Response(
      "Não deu para exportar: o registro da exportação não foi gravado. Tente de novo em instantes.",
      { status: 500 },
    );
  }

  const linhas = dados.map((l) => [
    l.nome,
    telefoneCsv(l.telefone_e164),
    l.email ?? "",
    // Sem a arroba: "@" no começo da célula também é fórmula para o Excel.
    l.instagram_usuario ?? "",
    l.canal?.nome ?? "",
    l.campanha ?? "",
    (l.etiquetas ?? [])
      .map((e) => e.tag?.nome)
      .filter(Boolean)
      .join(", "),
    l.responsavel?.nome ?? "",
    formatarData(l.criado_em),
  ]);

  const csv =
    "﻿" +
    [CABECALHO, ...linhas]
      .map((linha) => linha.map(celula).join(";"))
      .join("\r\n");

  // contatos-07-10-2026.csv: barra não pode em nome de arquivo, vai hífen.
  const hoje = hojeEmBrasilia().split("-").reverse().join("-");
  const arquivo =
    ids !== null || doFiltro
      ? `contatos-selecao-${hoje}.csv`
      : `contatos-${hoje}.csv`;

  return new Response(csv, {
    headers: {
      "Content-Type": "text/csv; charset=utf-8",
      "Content-Disposition": `attachment; filename="${arquivo}"`,
      "X-Linhas": String(linhas.length),
      ...(cortado ? { "X-Cortado": "1" } : {}),
    },
  });
}

/**
 * As linhas do "Marcar os N deste filtro": os ids de idsDoFiltro (o mesmo
 * alcance da ação, lido pelo id para não pular nem repetir contato com
 * mensagem chegando no meio), as linhas buscadas por id em lotes de
 * TETO_SELECAO, como no ?ids=, e a ordem da tela posta no fim. O lote por
 * id não repete linha: cada contato vem uma vez.
 */
async function linhasDoFiltro(
  supabase: Awaited<ReturnType<typeof createClient>>,
  filtros: ReturnType<typeof lerFiltros>,
  ocultos: string[],
): Promise<{ dados: Linha[]; erro: string | null; cortado: boolean }> {
  const r = await idsDoFiltro(supabase, filtros, ocultos);
  if ("erro" in r) return { dados: [], erro: r.erro, cortado: false };
  const lotes: string[][] = [];
  for (let i = 0; i < r.ids.length; i += TETO_SELECAO) {
    lotes.push(r.ids.slice(i, i + TETO_SELECAO));
  }
  const dados: Linha[] = [];
  for (let i = 0; i < lotes.length; i += LOTES_JUNTOS) {
    const respostas = await Promise.all(
      lotes
        .slice(i, i + LOTES_JUNTOS)
        .map((lote) =>
          consultarContatos(supabase, CAMPOS, { ids: lote, ocultos }),
        ),
    );
    for (const { data, error } of respostas) {
      if (error) return { dados: [], erro: error.message, cortado: false };
      dados.push(...((data ?? []) as unknown as Linha[]));
    }
  }
  dados.sort(compararNaOrdemDaLista);
  return { dados, erro: null, cortado: r.cortado };
}
