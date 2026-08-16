import { listarTemplates } from "@/lib/chatwoot";
import { listarTemplatesMeta, metaConfigurada } from "@/lib/whatsapp";

/**
 * Qual canal de WhatsApp está ativo. Com META_WHATSAPP_TOKEN preenchido o
 * CRM fala direto com a Meta (e a sincronização do Chatwoot desliga);
 * sem ele, tudo continua passando pelo Chatwoot.
 */
export type CanalWhatsapp = "meta" | "chatwoot";

export function canalAtivo(): CanalWhatsapp {
  return metaConfigurada() ? "meta" : "chatwoot";
}

export async function listarTemplatesCanal() {
  return canalAtivo() === "meta" ? listarTemplatesMeta() : listarTemplates();
}
