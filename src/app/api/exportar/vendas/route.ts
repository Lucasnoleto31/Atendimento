import { type NextRequest } from "next/server";
import { createClient, createServiceClient } from "@/lib/supabase/server";
import { buscarTudo } from "@/lib/supabase/paginar";
import { perfilAtual } from "@/lib/auth";

/**
 * Exporta as vendas em CSV com os MESMOS filtros da página Pagamentos.
 * Restrito à gestão e registrado na trilha — o extrato de comissões é dado
 * sensível como a base de leads.
 */

function celula(valor: unknown): string {
  const texto = valor === null || valor === undefined ? "" : String(valor);
  return `"${texto.replaceAll('"', '""')}"`;
}

function inicioDoPeriodo(chave: string): string | null {
  if (chave === "tudo") return null;
  const agora = new Date();
  if (chave === "hoje") {
    const dia = new Intl.DateTimeFormat("en-CA", {
      timeZone: "America/Sao_Paulo",
    }).format(agora);
    return new Date(`${dia}T00:00:00-03:00`).toISOString();
  }
  if (chave === "mes") {
    return new Date(agora.getFullYear(), agora.getMonth(), 1).toISOString();
  }
  const dias = Number(chave);
  if (!Number.isInteger(dias) || dias <= 0) return null;
  agora.setDate(agora.getDate() - dias);
  return agora.toISOString();
}

export async function GET(request: NextRequest) {
  const perfil = await perfilAtual();
  if (!perfil) return new Response("Forbidden", { status: 403 });
  if (perfil.papel !== "admin" && perfil.papel !== "gestor") {
    return new Response("Exportação restrita à gestão.", { status: 403 });
  }

  const params = request.nextUrl.searchParams;
  const periodo = params.get("periodo") ?? "mes";
  const fVendedor = params.get("v") ?? "";
  const fProduto = params.get("p") ?? "";
  const fStatus = params.get("st") ?? "";
  const fBusca = (params.get("q") ?? "").trim();
  const inicio = inicioDoPeriodo(periodo);

  const supabase = await createClient();
  const { dados } = await buscarTudo((de, ate) => {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any -- corta a recursão de tipos do builder
    let q: any = supabase
      .from("sales")
      .select(
        `valor_comissao_centavos, status, ocorreu_em, observacao,
         lead:leads${fBusca ? "!inner" : ""}(nome),
         produto:products(nome),
         vendedor:profiles(nome)`,
      )
      .order("ocorreu_em", { ascending: false })
      .range(de, ate);
    if (inicio) q = q.gte("ocorreu_em", inicio);
    if (fVendedor) q = q.eq("vendedor_id", fVendedor);
    if (fProduto) q = q.eq("product_id", fProduto);
    if (fStatus) q = q.eq("status", fStatus);
    if (fBusca) q = q.ilike("lead.nome", `%${fBusca.replaceAll(/[,()]/g, " ")}%`);
    return q;
  });

  type Linha = {
    valor_comissao_centavos: number;
    status: string;
    ocorreu_em: string;
    observacao: string | null;
    lead: { nome: string } | null;
    produto: { nome: string } | null;
    vendedor: { nome: string } | null;
  };
  const linhas = ((dados ?? []) as unknown as Linha[]).map((v) => [
    v.ocorreu_em,
    v.lead?.nome ?? "",
    v.produto?.nome ?? "",
    v.vendedor?.nome ?? "",
    (v.valor_comissao_centavos / 100).toFixed(2).replace(".", ","),
    v.status,
    v.observacao ?? "",
  ]);

  await createServiceClient().from("auditoria").insert({
    quem: perfil.id,
    acao: "exportar_vendas",
    detalhes: {
      periodo,
      vendedor: fVendedor,
      produto: fProduto,
      status: fStatus,
      busca: fBusca,
      linhas: linhas.length,
    },
  });

  const csv =
    "﻿" +
    [
      [
        "Data",
        "Lead",
        "Produto",
        "Vendedor",
        "Comissão (R$)",
        "Status",
        "Observação",
      ],
      ...linhas,
    ]
      .map((l) => l.map(celula).join(";"))
      .join("\r\n");

  return new Response(csv, {
    headers: {
      "Content-Type": "text/csv; charset=utf-8",
      "Content-Disposition": `attachment; filename="vendas-${periodo}.csv"`,
    },
  });
}
