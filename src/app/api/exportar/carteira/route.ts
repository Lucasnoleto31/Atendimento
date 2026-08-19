import { type NextRequest } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { buscarTudo } from "@/lib/supabase/paginar";
import { perfilAtual } from "@/lib/auth";

/**
 * Exporta a carteira filtrada em CSV — a base inteira, buscada em lotes para
 * furar o teto de 1000 linhas por resposta do PostgREST.
 */

type Linha = {
  nome_completo: string;
  telefone_e164: string | null;
  status: string;
  segmento: string | null;
  conta_aberta_em: string | null;
  lotes_30d: number | null;
  lotes_30d_anterior: number | null;
  ultimo_giro_em: string | null;
  dias_sem_giro: number | null;
  dias_sem_contato: number | null;
  receita_30d_centavos: number | null;
  ltv_centavos: number | null;
  responsavel_nome: string | null;
};

function celula(valor: unknown): string {
  const texto = valor === null || valor === undefined ? "" : String(valor);
  return `"${texto.replaceAll('"', '""')}"`;
}

const reais = (centavos: number | null) =>
  centavos === null ? "" : (centavos / 100).toFixed(2).replace(".", ",");

export async function GET(request: NextRequest) {
  const perfil = await perfilAtual();
  if (!perfil) return new Response("Forbidden", { status: 403 });

  const ehGestor = perfil.papel === "admin" || perfil.papel === "gestor";

  const params = request.nextUrl.searchParams;
  // Vendedor só exporta a PRÓPRIA carteira, mesmo forjando ?f=todas na URL —
  // a carteira inteira traz receita e LTV, que a tela já esconde de quem não
  // é gestor. O escopo é decidido no servidor, não pelo parâmetro.
  const filtro = ehGestor ? (params.get("f") ?? "todas") : "minha";
  const status = params.get("s") ?? "todos";
  const busca = (params.get("q") ?? "").trim();

  const supabase = await createClient();

  const { dados, erro } = await buscarTudo<Linha>((de, ate) => {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any -- corta a recursão de tipos do builder
    let q: any = supabase
      .from("v_carteira")
      .select(
        "nome_completo, telefone_e164, status, segmento, conta_aberta_em, lotes_30d, lotes_30d_anterior, ultimo_giro_em, dias_sem_giro, dias_sem_contato, receita_30d_centavos, ltv_centavos, responsavel_nome",
      )
      .order("ultimo_giro_em", { ascending: true, nullsFirst: true })
      .order("customer_id");

    if (filtro === "minha") q = q.eq("responsavel_id", perfil.id);
    if (status !== "todos") q = q.eq("status", status);
    if (busca) {
      // Vírgula e parênteses quebram a sintaxe do filtro .or() do PostgREST —
      // tira antes de interpolar.
      const termo = busca.replace(/[,()]/g, " ").trim();
      const digitos = busca.replace(/\D/g, "");
      q =
        digitos.length >= 4
          ? q.or(
              `nome_completo.ilike.%${termo}%,telefone_e164.ilike.%${digitos}%`,
            )
          : q.ilike("nome_completo", `%${termo}%`);
    }
    return q.range(de, ate);
  });

  if (erro) return new Response(`Erro ao exportar: ${erro}`, { status: 500 });

  const cabecalho = [
    "Cliente",
    "Telefone",
    "Situação",
    "Segmento",
    "Conta aberta em",
    "Lotes 30d",
    "Lotes 30d anteriores",
    "Último giro",
    "Dias sem giro",
    "Dias sem contato",
    "Receita 30d (R$)",
    "LTV (R$)",
    "Responsável",
  ];

  const linhas = dados.map((l) => [
    l.nome_completo,
    l.telefone_e164 ?? "",
    l.status,
    l.segmento ?? "",
    l.conta_aberta_em ?? "",
    l.lotes_30d ?? 0,
    l.lotes_30d_anterior ?? 0,
    l.ultimo_giro_em ?? "nunca",
    l.dias_sem_giro ?? "",
    l.dias_sem_contato ?? "",
    reais(l.receita_30d_centavos),
    reais(l.ltv_centavos),
    l.responsavel_nome ?? "",
  ]);

  const csv =
    "﻿" +
    [cabecalho, ...linhas]
      .map((linha) => linha.map(celula).join(";"))
      .join("\r\n");

  return new Response(csv, {
    headers: {
      "Content-Type": "text/csv; charset=utf-8",
      "Content-Disposition": `attachment; filename="carteira-${status}.csv"`,
    },
  });
}
