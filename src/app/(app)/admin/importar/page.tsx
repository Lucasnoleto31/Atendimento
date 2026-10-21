import type { Metadata } from "next";
import { createClient } from "@/lib/supabase/server";
import { exigirGestao } from "../acesso";
import { caminhoDa } from "../rotas";
import { voltarDaSubpagina } from "../subpagina";
import { TelaImportar, type Importacao } from "./tela";
import { titulo } from "@/lib/marca";

export const metadata: Metadata = {
  title: titulo("Importar contatos"),
};

export default async function ImportarPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  await exigirGestao();
  const params = await searchParams;
  const supabase = await createClient();

  const [{ data: importacoes }, { data: tags }] = await Promise.all([
    supabase
      .from("imports")
      .select(
        "id, arquivo_nome, referencia_data, status, total_linhas, linhas_ok, linhas_erro, erro_detalhe, criado_em, autor:profiles(nome)",
      )
      // Só importação de contatos: é o único tipo que esta tela sobe.
      .eq("tipo", "leads")
      .order("criado_em", { ascending: false })
      .limit(20),
    // As arquivadas vêm junto: não entram na lista para escolher, mas a
    // prévia precisa delas para dizer o mesmo que a importação faz (o nome
    // que casa com uma arquivada a reativa, admin/actions.ts).
    supabase.from("tags").select("id, nome, ativo").order("nome"),
  ]);

  const todas = (tags ?? []) as {
    id: string;
    nome: string;
    ativo: boolean | null;
  }[];
  const so = (arquivada: boolean) =>
    todas
      .filter((t) => (t.ativo === false) === arquivada)
      .map(({ id, nome }) => ({ id, nome }));

  return (
    <TelaImportar
      historico={(importacoes ?? []) as unknown as Importacao[]}
      etiquetas={so(false)}
      arquivadas={so(true)}
      voltar={voltarDaSubpagina(params.voltar, caminhoDa("importar"))}
    />
  );
}
