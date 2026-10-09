import { headers } from "next/headers";
import { createServiceClient } from "@/lib/supabase/server";

/*
 * O que a Administração mostra dos webhooks da Meta (WhatsApp e Instagram
 * Direct): o endereço para colar no painel, quais variáveis estão no
 * ambiente (só os nomes, nunca o valor) e o último evento que chegou. Só
 * leitura; servidor (lê o ambiente e o cabeçalho).
 */

const CAMINHO_WEBHOOK = "/api/webhooks/meta";
export const CAMINHO_WEBHOOK_INSTAGRAM = "/api/webhooks/instagram";

/** O endereço completo do webhook, para colar no painel da Meta: pelo
 *  NEXT_PUBLIC_SITE_URL ou, sem ele, pelo host da requisição. Sem
 *  argumento, o do WhatsApp. */
export async function enderecoDoWebhook(caminho: string = CAMINHO_WEBHOOK) {
  const site = process.env.NEXT_PUBLIC_SITE_URL?.trim();
  if (site) {
    try {
      return new URL(caminho, site).href;
    } catch {
      // Variável mal preenchida: cai para o host da requisição.
    }
  }
  const h = await headers();
  const host = (h.get("x-forwarded-host") ?? h.get("host") ?? "")
    .split(",")[0]
    .trim();
  if (!host) return caminho;
  const protocolo =
    h.get("x-forwarded-proto")?.split(",")[0].trim() ||
    (host.startsWith("localhost") || host.startsWith("127.0.0.1")
      ? "http"
      : "https");
  return `${protocolo}://${host}${caminho}`;
}

export type SituacaoWebhook = { tokenOk: boolean; segredoOk: boolean };

/** As duas variáveis que o webhook pede, presentes no ambiente? */
export function webhookConfigurado(): SituacaoWebhook {
  return {
    tokenOk: Boolean(process.env.META_WEBHOOK_VERIFY_TOKEN),
    segredoOk: Boolean(process.env.META_APP_SECRET),
  };
}

/** "Falta o token", "Falta o app secret" ou, sem os dois, "Falta
 *  configurar" (cabe à direita da linha no celular); null configurado. */
export function faltaNoWebhook(s: SituacaoWebhook): string | null {
  if (s.tokenOk && s.segredoOk) return null;
  if (!s.tokenOk && !s.segredoOk) return "Falta configurar";
  return s.tokenOk ? "Falta o app secret" : "Falta o token";
}

export type EventosWebhook = {
  /** Quando chegou o último evento da Meta (ISO), ou null sem nenhum. */
  ultimo: string | null;
  /** Eventos das últimas 48 horas que ainda não gravaram (o
   *  reprocessamento tenta de novo). */
  comErro: number;
};

const DOIS_DIAS_MS = 2 * 86_400_000;

/**
 * O último evento e os que falharam nas últimas 48 horas, de uma origem:
 * "meta" (o WhatsApp, o padrão) ou "instagram" (o Direct). A tabela não tem
 * policy (só a chave de serviço lê), e o que vem daqui é só data e
 * contagem, nunca o conteúdo. Sem a chave (a máquina local) ou com erro,
 * null: a linha não aparece.
 */
export async function eventosDoWebhook(
  origem: "meta" | "instagram" = "meta",
): Promise<EventosWebhook | null> {
  try {
    const service = createServiceClient();
    const desde = new Date(Date.now() - DOIS_DIAS_MS).toISOString();
    // Cada canal com a origem dele. Com erro é o que ainda não gravou: o
    // reprocessamento marca a tentativa no erro e só o processado sai da
    // conta. A "lida" do Direct não entra no livro (webhooks/instagram).
    const [ultimo, erros] = await Promise.all([
      service
        .from("webhook_events")
        .select("recebido_em")
        .eq("origem", origem)
        .order("recebido_em", { ascending: false })
        .limit(1),
      service
        .from("webhook_events")
        .select("id", { count: "exact", head: true })
        .eq("origem", origem)
        .eq("processado", false)
        .not("erro", "is", null)
        .gte("recebido_em", desde),
    ]);
    if (ultimo.error || erros.error) return null;
    const linha = (ultimo.data ?? [])[0] as { recebido_em: string } | undefined;
    return { ultimo: linha?.recebido_em ?? null, comErro: erros.count ?? 0 };
  } catch {
    return null;
  }
}

// ===========================================================================
// Instagram Direct
// ===========================================================================

/** Uma variável que o Direct pede, pelo nome (o valor nunca sai daqui). */
export type VariavelInstagram = {
  nome: string;
  /** Para que ela serve, na linha da tela. */
  papel: string;
  ok: boolean;
  /** A do WhatsApp que serve no lugar dela (o app da Meta é o mesmo), ou
   *  null quando não há. */
  reserva: string | null;
  /** Preenchida pela variável do WhatsApp (o app da Meta é o mesmo). */
  pelaDoWhatsapp: string | null;
  /** Existe no ambiente, mas em branco: a rota não cai na do WhatsApp. */
  emBranco: boolean;
};

export type SituacaoInstagram = {
  variaveis: VariavelInstagram[];
  /** As quatro estão no ambiente. Não quer dizer que funciona: o token
   *  vence a cada 60 dias, e a leitura do ambiente não vê isso. */
  configurado: boolean;
};

/**
 * As variáveis do Direct, com a mesma leitura do código que as usa
 * (lib/instagram.ts e api/webhooks/instagram): o token e o id da conta
 * enviam; o token de verificação e o app secret do webhook caem nos do
 * WhatsApp (META_*) quando o app do Instagram é o mesmo. A rota lê com
 * "??": a própria variável em branco não cai na do WhatsApp, e a tela diz.
 */
export function situacaoInstagram(): SituacaoInstagram {
  const env = process.env;
  const simples = (nome: string, papel: string): VariavelInstagram => ({
    nome,
    papel,
    ok: Boolean(env[nome]),
    reserva: null,
    pelaDoWhatsapp: null,
    emBranco: env[nome] === "",
  });
  const comReserva = (
    nome: string,
    doWhatsapp: string,
    papel: string,
  ): VariavelInstagram => {
    const valor = env[nome] ?? env[doWhatsapp];
    return {
      nome,
      papel,
      ok: Boolean(valor),
      reserva: doWhatsapp,
      pelaDoWhatsapp: env[nome] === undefined && valor ? doWhatsapp : null,
      emBranco: env[nome] === "",
    };
  };

  const variaveis = [
    simples("INSTAGRAM_TOKEN", "Envia as respostas pelo Direct"),
    simples("INSTAGRAM_ACCOUNT_ID", "A conta profissional do Instagram"),
    comReserva(
      "INSTAGRAM_WEBHOOK_VERIFY_TOKEN",
      "META_WEBHOOK_VERIFY_TOKEN",
      "Confirma o webhook no painel da Meta",
    ),
    comReserva(
      "INSTAGRAM_APP_SECRET",
      "META_APP_SECRET",
      "Confere a assinatura de cada evento",
    ),
  ];
  return { variaveis, configurado: variaveis.every((v) => v.ok) };
}
