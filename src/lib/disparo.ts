import {
  enviarTemplateMeta,
  metaConfigurada,
  type TemplateWhatsapp,
} from "@/lib/whatsapp";

/**
 * Envio de um template aprovado para um contato, fora de uma conversa: é o
 * que o disparo em massa (lib/campanhas) usa a cada destinatário da fila.
 * Quem chama decide o público e registra o resultado; aqui só sai a mensagem.
 */

/** Destinatário de um disparo: o contato e o telefone já em E.164. */
export type Alvo = {
  leadId: string;
  nome: string;
  telefone: string;
};

/**
 * Manda o template e devolve o wamid, que os recibos do webhook referenciam.
 * Lança erro quando a Meta recusa: a mensagem do erro é o que fica gravado
 * na linha do envio para a tela mostrar.
 */
export async function dispararTemplate(
  alvo: Alvo,
  template: TemplateWhatsapp,
  valores: Record<string, string>,
): Promise<string | null> {
  // Canal único: sem a Meta configurada não existe por onde enviar. O erro
  // explica isso em vez do estouro críptico do token interno.
  if (!metaConfigurada()) {
    throw new Error("WhatsApp (Meta) não configurado.");
  }
  return enviarTemplateMeta(alvo.telefone, template, valores);
}

/**
 * Corpo do template com as variáveis preenchidas — o texto que entra no
 * histórico da conversa, igual ao que o contato recebeu. Variável sem valor
 * fica como estava ({{1}}), para a falta aparecer em vez de sumir.
 */
export function corpoPreenchido(
  template: TemplateWhatsapp,
  valores: Record<string, string>,
): string {
  return template.corpo.replace(
    /\{\{\s*([^{}]+?)\s*\}\}/g,
    (bloco, token: string) => valores[token] ?? bloco,
  );
}
