import type { Metadata } from "next";
import { createClient } from "@/lib/supabase/server";
import { exigirGestao } from "../acesso";
import { caminhoDa } from "../rotas";
import { voltarDaSubpagina } from "../subpagina";
import {
  enderecoDoWebhook,
  eventosDoWebhook,
  webhookConfigurado,
} from "../webhook";
import { TelaWhatsapp, type Instancia, type PessoaAtendente } from "./tela";
import { titulo } from "@/lib/marca";

export const metadata: Metadata = { title: titulo("WhatsApp") };

/**
 * Administração › WhatsApp: os números e, logo abaixo, o webhook. Eram duas
 * telas (o phone_number_id em Configurações e o webhook em Administração,
 * com o passo a passo de uma mandando para a outra); ligar um número agora
 * é uma tela só.
 */
export default async function WhatsappPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const perfil = await exigirGestao();
  const params = await searchParams;
  const supabase = await createClient();

  const [{ data: instancias }, { data: equipe }, webhookUrl, eventos] =
    await Promise.all([
      supabase
        .from("whatsapp_instances")
        .select(
          "id, nome, telefone_e164, vendedor_id, ativa, meta_phone_number_id",
        )
        .order("nome"),
      // A equipe ativa: o atendente responsável de cada número.
      supabase
        .from("profiles")
        .select("id, nome")
        .eq("ativo", true)
        .order("nome"),
      enderecoDoWebhook(),
      eventosDoWebhook(),
    ]);

  return (
    <TelaWhatsapp
      ehAdmin={perfil.papel === "admin"}
      numeros={(instancias ?? []) as Instancia[]}
      equipe={(equipe ?? []) as PessoaAtendente[]}
      webhookUrl={webhookUrl}
      webhook={webhookConfigurado()}
      eventos={eventos}
      voltar={voltarDaSubpagina(params.voltar, caminhoDa("whatsapp"))}
    />
  );
}
