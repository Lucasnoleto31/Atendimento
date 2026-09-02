import { type NextRequest } from "next/server";
import { createClient, createServiceClient } from "@/lib/supabase/server";
import { buscarTudo } from "@/lib/supabase/paginar";
import { perfilAtual } from "@/lib/auth";
import { rotuloPapel, veTudo } from "@/lib/papeis";
import { ROTULO_ACAO, descreverDetalhes } from "@/lib/auditoria";

/** Exporta o log de acesso (gestão e compliance) — e registra a exportação. */
function celula(valor: unknown): string {
  const texto = valor === null || valor === undefined ? "" : String(valor);
  // Nome vindo do WhatsApp pode começar com "=": no Excel viraria fórmula.
  const seguro = /^[=+\-@\t\r]/.test(texto) ? `'${texto}` : texto;
  return `"${seguro.replaceAll('"', '""')}"`;
}

export async function GET(request: NextRequest) {
  const perfil = await perfilAtual();
  if (!perfil || !veTudo(perfil.papel)) {
    return new Response("Só gestão e compliance exportam o log.", {
      status: 403,
    });
  }
  const p = request.nextUrl.searchParams;
  const dias = [1, 7, 30].includes(Number(p.get("dias")))
    ? Number(p.get("dias"))
    : 7;
  const quem = p.get("quem") ?? "";
  const acao = p.get("acao") ?? "";
  const corte = new Date(Date.now() - dias * 86_400_000).toISOString();

  const supabase = await createClient();
  type Linha = {
    criado_em: string;
    acao: string;
    detalhes: Record<string, unknown>;
    autor: { nome: string; papel: string } | null;
  };
  const { dados } = await buscarTudo((de, ate) => {
    let q = supabase
      .from("auditoria")
      .select("criado_em, acao, detalhes, autor:profiles(nome, papel)")
      .gte("criado_em", corte)
      .order("criado_em", { ascending: false })
      .range(de, ate);
    if (quem) q = q.eq("quem", quem);
    if (acao) q = q.eq("acao", acao);
    return q;
  });

  const linhas = ((dados ?? []) as unknown as Linha[]).map((r) => [
    r.criado_em,
    r.autor?.nome ?? "sistema",
    r.autor ? rotuloPapel(r.autor.papel) : "",
    ROTULO_ACAO[r.acao] ?? r.acao,
    descreverDetalhes(r.detalhes ?? {}),
  ]);

  await createServiceClient()
    .from("auditoria")
    .insert({
      quem: perfil.id,
      acao: "exportar_auditoria",
      detalhes: { dias, quem, acao, linhas: linhas.length },
    });

  const csv = [
    ["quando", "quem", "papel", "acao", "objeto"].map(celula).join(";"),
    ...linhas.map((l) => l.map(celula).join(";")),
  ].join("\r\n");
  return new Response(`﻿${csv}`, {
    headers: {
      "Content-Type": "text/csv; charset=utf-8",
      "Content-Disposition": `attachment; filename="log-de-acesso-${dias}d.csv"`,
    },
  });
}
