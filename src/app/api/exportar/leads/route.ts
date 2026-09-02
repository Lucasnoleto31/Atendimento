import { type NextRequest } from "next/server";
import { createClient, createServiceClient } from "@/lib/supabase/server";
import { buscarTudo } from "@/lib/supabase/paginar";
import { perfilAtual } from "@/lib/auth";
import { veTudo } from "@/lib/papeis";
import { COLUNA_LISTA } from "@/lib/listas-leads";

/**
 * Exporta a lista filtrada de leads em CSV — os MESMOS filtros da página:
 * fila, busca e etiqueta. Separador ponto-e-vírgula e BOM para abrir certinho
 * no Excel brasileiro. Busca em lotes (buscarTudo) para furar o teto de 1000
 * linhas do PostgREST — senão o CSV "completo" saía pela metade.
 *
 * Este arquivo ficou para trás quando as listas foram refeitas (0032): ainda
 * consultava a view antiga com as chaves novas, então o botão Exportar da
 * página devolvia um CSV só com o cabeçalho.
 */

function celula(valor: unknown): string {
  const texto = valor === null || valor === undefined ? "" : String(valor);
  // Nome vindo do WhatsApp pode começar com "=": no Excel viraria fórmula.
  const seguro = /^[=+\-@\t\r]/.test(texto) ? `'${texto}` : texto;
  return `"${seguro.replaceAll('"', '""')}"`;
}

const CABECALHO = [
  "Nome",
  "Telefone",
  "Status",
  "Etapa",
  "Canal",
  "Campanha",
  "Etiquetas",
  "Responsável",
  "Lotes 30d",
  "Último giro",
  "Último contato",
  "Criado em",
];

type Linha = {
  nome: string;
  telefone_e164: string | null;
  status: string;
  etapa_nome: string | null;
  canal_nome: string | null;
  campanha: string | null;
  etiquetas: string[] | null;
  responsavel_nome: string | null;
  lotes_30d: number | null;
  ultimo_giro_em: string | null;
  ultima_interacao_em: string | null;
  criado_em: string;
};

export async function GET(request: NextRequest) {
  const perfil = await perfilAtual();
  if (!perfil) return new Response("Forbidden", { status: 403 });
  // A base com telefones é O ativo da mesa: exportação completa é coisa de
  // gestão, e toda exportação deixa rastro de quem levou o quê.
  if (!veTudo(perfil.papel)) {
    return new Response(
      "Exportação da base é restrita à gestão. Peça a um gestor.",
      { status: 403 },
    );
  }
  const trilha = createServiceClient();

  const params = request.nextUrl.searchParams;
  const lista = params.get("lista") ?? "todos";
  const busca = (params.get("busca") ?? "").trim();
  const etiqueta = params.get("etiqueta") ?? "";
  const coluna = COLUNA_LISTA[lista];

  const supabase = await createClient();
  const termo = busca.replace(/[,()]/g, " ").trim();
  const digitos = termo.replace(/\D/g, "");

  const { dados } = await buscarTudo((de, ate) => {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any -- corta a recursão de tipos do builder
    let q: any = supabase
      .from("v_leads_listas")
      .select(
        "nome, telefone_e164, status, etapa_nome, canal_nome, campanha, etiquetas, responsavel_nome, lotes_30d, ultimo_giro_em, ultima_interacao_em, criado_em",
      )
      .order("criado_em", { ascending: false })
      .range(de, ate);

    if (coluna) q = q.eq(coluna, true);
    if (etiqueta) q = q.contains("etiqueta_ids", [etiqueta]);
    if (termo) {
      q =
        digitos.length >= 4
          ? q.or(`nome.ilike.%${termo}%,telefone_e164.ilike.%${digitos}%`)
          : q.ilike("nome", `%${termo}%`);
    }
    return q;
  });

  const linhas = ((dados ?? []) as unknown as Linha[]).map((l) => [
    l.nome,
    l.telefone_e164 ?? "",
    l.status,
    l.etapa_nome ?? "",
    l.canal_nome ?? "",
    l.campanha ?? "",
    (l.etiquetas ?? []).join(", "),
    l.responsavel_nome ?? "",
    String(l.lotes_30d ?? ""),
    l.ultimo_giro_em ?? "",
    l.ultima_interacao_em ?? "nunca",
    l.criado_em,
  ]);

  await trilha.from("auditoria").insert({
    quem: perfil.id,
    acao: "exportar_leads",
    detalhes: { lista, busca, etiqueta, linhas: linhas.length },
  });

  const csv =
    "﻿" +
    [CABECALHO, ...linhas]
      .map((linha) => linha.map(celula).join(";"))
      .join("\r\n");

  return new Response(csv, {
    headers: {
      "Content-Type": "text/csv; charset=utf-8",
      "Content-Disposition": `attachment; filename="leads-${lista}.csv"`,
    },
  });
}
