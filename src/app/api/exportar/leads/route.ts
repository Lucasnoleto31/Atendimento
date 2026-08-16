import { type NextRequest } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { perfilAtual } from "@/lib/auth";

/**
 * Exporta a lista filtrada de leads em CSV (mesmos filtros da página Leads).
 * Separador ponto-e-vírgula e BOM para abrir certinho no Excel brasileiro.
 */

const LIMITE = 5000;

const LISTAS_CONTATO = new Set([
  "ativos_24h",
  "esfriando",
  "sem_contato_30",
  "sem_contato_60",
  "sem_contato_nunca",
]);

function celula(valor: unknown): string {
  const texto = valor === null || valor === undefined ? "" : String(valor);
  return `"${texto.replaceAll('"', '""')}"`;
}

export async function GET(request: NextRequest) {
  const perfil = await perfilAtual();
  if (!perfil) return new Response("Forbidden", { status: 403 });

  const params = request.nextUrl.searchParams;
  const lista = params.get("lista") ?? "todos";
  const busca = (params.get("busca") ?? "").trim();

  const supabase = await createClient();
  const linhas: string[][] = [];

  if (LISTAS_CONTATO.has(lista)) {
    const dataAtras = (dias: number) =>
      new Date(Date.now() - dias * 86_400_000).toISOString();
    const d1 = dataAtras(1);
    const d7 = dataAtras(7);
    const d30 = dataAtras(30);
    const d60 = dataAtras(60);

    let q = supabase
      .from("leads")
      .select(
        "nome, telefone_e164, status, criado_em, campanha, ultima_interacao_em, responsavel:profiles(nome), channel:channels(nome), stage:pipeline_stages(nome)",
      )
      .not("status", "in", "(ganho,perdido)")
      .limit(LIMITE);

    if (lista === "ativos_24h") q = q.gte("ultima_interacao_em", d1);
    if (lista === "esfriando")
      q = q.lt("ultima_interacao_em", d7).gte("ultima_interacao_em", d30);
    if (lista === "sem_contato_30")
      q = q.lt("ultima_interacao_em", d30).gte("ultima_interacao_em", d60);
    if (lista === "sem_contato_60") q = q.lt("ultima_interacao_em", d60);
    if (lista === "sem_contato_nunca") q = q.is("ultima_interacao_em", null);
    if (busca) q = q.ilike("nome", `%${busca}%`);

    const { data } = await q.order("criado_em", { ascending: false });
    for (const l of (data ?? []) as unknown as {
      nome: string;
      telefone_e164: string | null;
      status: string;
      criado_em: string;
      campanha: string | null;
      ultima_interacao_em: string | null;
      responsavel: { nome: string } | null;
      channel: { nome: string } | null;
      stage: { nome: string } | null;
    }[]) {
      linhas.push([
        l.nome,
        l.telefone_e164 ?? "",
        l.status,
        l.stage?.nome ?? "",
        l.channel?.nome ?? "",
        l.campanha ?? "",
        l.responsavel?.nome ?? "",
        l.ultima_interacao_em ?? "nunca",
        l.criado_em,
      ]);
    }
  } else {
    let q = supabase.from("v_listas_atendimento").select("*").limit(LIMITE);
    if (lista === "nunca_respondeu") q = q.eq("nunca_respondeu", true);
    else if (lista !== "todos") q = q.eq("lista", lista);
    if (busca) q = q.ilike("nome", `%${busca}%`);

    const { data } = await q.order("criado_em", { ascending: false });
    for (const l of (data ?? []) as {
      nome: string;
      telefone_e164: string | null;
      status: string;
      etapa_nome: string | null;
      canal_nome: string | null;
      campanha: string | null;
      responsavel_nome: string | null;
      lotes_30d: number | null;
      ultimo_giro_em: string | null;
      criado_em: string;
    }[]) {
      linhas.push([
        l.nome,
        l.telefone_e164 ?? "",
        l.status,
        l.etapa_nome ?? "",
        l.canal_nome ?? "",
        l.campanha ?? "",
        l.responsavel_nome ?? "",
        String(l.lotes_30d ?? ""),
        l.ultimo_giro_em ?? "",
        l.criado_em,
      ]);
    }
  }

  const cabecalho = LISTAS_CONTATO.has(lista)
    ? ["Nome", "Telefone", "Status", "Etapa", "Canal", "Campanha", "Responsável", "Último contato", "Criado em"]
    : ["Nome", "Telefone", "Status", "Etapa", "Canal", "Campanha", "Responsável", "Lotes 30d", "Último giro", "Criado em"];

  const csv =
    "﻿" +
    [cabecalho, ...linhas]
      .map((linha) => linha.map(celula).join(";"))
      .join("\r\n");

  return new Response(csv, {
    headers: {
      "Content-Type": "text/csv; charset=utf-8",
      "Content-Disposition": `attachment; filename="leads-${lista}.csv"`,
    },
  });
}
