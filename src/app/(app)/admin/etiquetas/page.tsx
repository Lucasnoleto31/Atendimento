import type { Metadata } from "next";
import { createClient } from "@/lib/supabase/server";
import { exigirGestao } from "../acesso";
import { caminhoDa } from "../rotas";
import { voltarDaSubpagina } from "../subpagina";
import { TelaEtiquetas, type Campanha, type Tag } from "./tela";
import { titulo } from "@/lib/marca";

export const metadata: Metadata = { title: titulo("Etiquetas") };

export default async function EtiquetasPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  await exigirGestao();
  const params = await searchParams;
  const supabase = await createClient();

  const [{ data: tags }, { data: campanhas }] = await Promise.all([
    // Com a contagem de contatos por etiqueta; se o embed falhar, sem ela.
    supabase
      .from("tags")
      .select("id, nome, cor, ativo, lead_tags(count)")
      .order("nome")
      .then((r) =>
        r.error
          ? supabase.from("tags").select("id, nome, cor, ativo").order("nome")
          : r,
      ),
    // Campanhas que ainda mandam: a etiqueta delas não se exclui.
    supabase
      .from("campanhas")
      .select("id, nome, status, etiqueta_id")
      .in("status", ["ativa", "pausada"])
      .then((r) => (r.error ? { data: [] } : r)),
  ]);

  return (
    <TelaEtiquetas
      tags={(tags ?? []) as Tag[]}
      campanhas={(campanhas ?? []) as Campanha[]}
      voltar={voltarDaSubpagina(params.voltar, caminhoDa("etiquetas"))}
    />
  );
}
