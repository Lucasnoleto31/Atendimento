import { createClient, createServiceClient } from "@/lib/supabase/server";
import { buscarTudo } from "@/lib/supabase/paginar";
import { perfilAtivo } from "@/lib/auth";
import { formatarDataHoraCompleta } from "@/lib/format";
import { rotuloPapel, veTudo } from "@/lib/papeis";
import { ROTULO_ACAO, descreverDetalhes } from "@/lib/auditoria";
import {
  comVoltar,
  lerVoltar,
  voltarDiferenteDe,
} from "@/app/(app)/contatos/voltar";
import { consultarLog, type Registro } from "../consulta";
import {
  AVISO_EXPORTACAO,
  lerFiltrosLog,
  parametrosDoLog,
  urlDoLog,
  type AvisoExportacao,
  type FiltrosLog,
} from "../url";

/*
 * Exporta o Log de acesso em CSV com os mesmos filtros da tela (várias
 * pessoas, várias ações, período por datas e o contato), e registra a
 * exportação. Mora junto da tela para as duas lerem a mesma consulta
 * (consulta.ts).
 *
 * Só POST, pelo formulário do botão "Exportar CSV": um link comum (GET)
 * pode ser pré-carregado ou aberto por um ?voltar= montado por alguém, e
 * cada abertura gravaria no log uma exportação que ninguém pediu.
 *
 * O arquivo é a prova de quem viu o quê: sai inteiro ou não sai. O
 * buscarTudo para calado no teto dele (50.000 linhas), e um período longo
 * passa disso fácil (toda conversa aberta grava um registro). Batendo no
 * teto, nada de CSV cortado: a pessoa volta ao log com o aviso para dividir
 * o período. O mesmo vale para o lote que falha no meio.
 */

/** Volta ao log com os mesmos filtros (e o ?voltar= da tela) e o aviso. */
function voltarAoLog(
  request: Request,
  filtros: FiltrosLog,
  voltar: string | null,
  aviso: AvisoExportacao,
): Response {
  const destino = new URL(comVoltar(urlDoLog(filtros), voltar), request.url);
  destino.searchParams.set(AVISO_EXPORTACAO, aviso);
  // 303: o navegador troca o POST do formulário por um GET da tela.
  return Response.redirect(destino, 303);
}

function celula(valor: unknown): string {
  const texto = valor === null || valor === undefined ? "" : String(valor);
  // Nome vindo do WhatsApp pode começar com "=": no Excel viraria fórmula.
  const seguro = /^[=+\-@\t\r]/.test(texto) ? `'${texto}` : texto;
  return `"${seguro.replaceAll('"', '""')}"`;
}

export async function POST(request: Request) {
  // perfilAtivo: conta desativada com a aba aberta não baixa o log.
  const perfil = await perfilAtivo();
  if (!perfil || !veTudo(perfil.papel)) {
    return new Response("Só gestão e compliance exportam o log.", {
      status: 403,
    });
  }

  // Os filtros chegam do formulário com os mesmos nomes da URL da tela.
  const corpo = await request.formData().catch(() => null);
  const params = new URLSearchParams();
  for (const [nome, valor] of corpo?.entries() ?? []) {
    if (typeof valor === "string") params.append(nome, valor);
  }
  const filtros = lerFiltrosLog(params);
  const voltar = voltarDiferenteDe(
    lerVoltar(params.get("voltar")),
    "/admin/acessos",
  );

  const supabase = await createClient();
  const { dados, erro } = await buscarTudo<Registro>((de, ate) =>
    consultarLog(supabase, filtros, { faixa: [de, ate] }).then((r) => ({
      data: r.registros,
      error: r.erro ? { message: r.erro } : null,
    })),
  );

  // Lote que falhou no meio: nada de CSV pela metade, e a exportação não
  // entra no log com uma contagem parcial.
  if (erro) return voltarAoLog(request, filtros, voltar, "erro");

  // Com o último lote cheio (de 1.000, o do buscarTudo), ele parou num lote
  // vazio logo depois ou no teto, sem dizer qual: um registro além do fim
  // responde. Existindo, o período passou do teto e o arquivo sairia
  // cortado sem ninguém saber.
  if (dados.length > 0 && dados.length % 1000 === 0) {
    const alem = await consultarLog(supabase, filtros, {
      faixa: [dados.length, dados.length],
    });
    if (alem.erro) return voltarAoLog(request, filtros, voltar, "erro");
    if (alem.registros.length > 0) {
      return voltarAoLog(request, filtros, voltar, "grande");
    }
  }

  const linhas = dados.map((r) => [
    // Data e hora de Brasília, com o ano: o arquivo é a prova de quem viu o
    // quê, e o ISO em UTC aparecia 3 h adiantado.
    formatarDataHoraCompleta(r.criado_em),
    r.autor?.nome ?? "sistema",
    r.autor ? rotuloPapel(r.autor.papel) : "",
    ROTULO_ACAO[r.acao] ?? r.acao,
    descreverDetalhes(r.detalhes ?? {}),
  ]);

  // O registro diz com que filtros saiu: o período, as listas e o contato.
  await createServiceClient()
    .from("auditoria")
    .insert({
      quem: perfil.id,
      acao: "exportar_auditoria",
      detalhes: {
        periodo:
          filtros.de || filtros.ate
            ? `${filtros.de || "início"} a ${filtros.ate || "hoje"}`
            : `${filtros.dias} dias`,
        filtros: parametrosDoLog(filtros).toString(),
        linhas: linhas.length,
      },
    });

  const csv = [
    ["quando", "quem", "papel", "acao", "objeto"].map(celula).join(";"),
    ...linhas.map((l) => l.map(celula).join(";")),
  ].join("\r\n");
  const nome =
    filtros.de || filtros.ate
      ? `log-de-acesso-${filtros.de || "inicio"}-a-${filtros.ate || "hoje"}`
      : `log-de-acesso-${filtros.dias}d`;
  return new Response(`﻿${csv}`, {
    headers: {
      "Content-Type": "text/csv; charset=utf-8",
      "Content-Disposition": `attachment; filename="${nome}.csv"`,
      "Cache-Control": "no-store",
    },
  });
}
