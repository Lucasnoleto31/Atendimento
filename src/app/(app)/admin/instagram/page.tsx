import type { Metadata } from "next";
import { exigirGestao } from "../acesso";
import { caminhoDa } from "../rotas";
import { voltarDaSubpagina } from "../subpagina";
import {
  CAMINHO_WEBHOOK_INSTAGRAM,
  enderecoDoWebhook,
  eventosDoWebhook,
  situacaoInstagram,
} from "../webhook";
import { TelaInstagram } from "./tela";
import { titulo } from "@/lib/marca";

export const metadata: Metadata = {
  title: titulo("Instagram Direct"),
};

/**
 * Administração › Instagram Direct. No sistema original não havia tela: a
 * conexão é toda por variáveis de ambiente (lib/instagram.ts e
 * api/webhooks/instagram). Aqui o admin vê quais faltam (só o nome), o
 * endereço do webhook, o último evento e os passos; a gestão vê o estado.
 * O último evento sai de webhook_events, lido no servidor com a chave de
 * serviço (a tabela não tem policy).
 */
export default async function InstagramPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const perfil = await exigirGestao();
  const params = await searchParams;
  const ehAdmin = perfil.papel === "admin";

  const [webhookUrl, eventos] = await Promise.all([
    ehAdmin ? enderecoDoWebhook(CAMINHO_WEBHOOK_INSTAGRAM) : null,
    eventosDoWebhook("instagram"),
  ]);
  const situacao = situacaoInstagram();

  return (
    <TelaInstagram
      ehAdmin={ehAdmin}
      configurado={situacao.configurado}
      // Os nomes das variáveis e o passo a passo só vão para o admin.
      variaveis={ehAdmin ? situacao.variaveis : null}
      webhookUrl={webhookUrl}
      eventos={eventos}
      voltar={voltarDaSubpagina(params.voltar, caminhoDa("instagram"))}
    />
  );
}
