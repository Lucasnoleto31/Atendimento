import type { Metadata } from "next";
import { createClient } from "@/lib/supabase/server";
import { exigirGestao } from "../acesso";
import { caminhoDa, PARAM_TEXTO } from "../rotas";
import { voltarDaSubpagina } from "../subpagina";
import { TelaMensagens, type Mensagem } from "./tela";
import { titulo } from "@/lib/marca";

export const metadata: Metadata = {
  title: titulo("Mensagens prontas"),
};

/** O texto que vem pela URL não passa do tamanho de uma mensagem. */
const LIMITE_TEXTO = 4000;

export default async function MensagensPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  await exigirGestao();
  const params = await searchParams;
  const supabase = await createClient();

  // Anexos das prontas (0060); sem a migração, cai para o formato antigo, e
  // a marca comAnexos vem da CONSULTA (lista vazia não prova nada).
  const { data: mensagens, comAnexos } = await supabase
    .from("quick_replies")
    .select("id, titulo, corpo, anexos")
    .order("titulo")
    .then((r) =>
      r.error
        ? supabase
            .from("quick_replies")
            .select("id, titulo, corpo")
            .order("titulo")
            .then((r2) => ({ ...r2, comAnexos: false }))
        : { ...r, comAnexos: true },
    );

  const texto = params[PARAM_TEXTO];
  return (
    <TelaMensagens
      mensagens={(mensagens ?? []) as Mensagem[]}
      comAnexos={comAnexos}
      textoInicial={
        typeof texto === "string" ? texto.slice(0, LIMITE_TEXTO) : ""
      }
      voltar={voltarDaSubpagina(params.voltar, caminhoDa("mensagens"))}
    />
  );
}
