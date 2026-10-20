import { CODIGO_VALIDADE_MS } from "@/lib/codigo-recuperacao";
import { FUSO } from "@/lib/format";
import { NOME_DO_PRODUTO } from "@/lib/marca";

/**
 * E-mails do login (código de nova senha) e o aviso de senha trocada,
 * enviados pelo Resend direto pela API HTTP: um POST só, sem pacote a mais
 * no bundle.
 *
 * Sem RESEND_API_KEY fora de produção o e-mail não sai e o código vai para o
 * console do servidor, para testar o fluxo na máquina de desenvolvimento.
 * Em produção, sem a chave, o envio do código falha com erro claro: código
 * que "saiu" sem sair deixaria a pessoa esperando um e-mail que nunca chega.
 * O aviso de senha trocada não tem ninguém esperando: sem a chave, ele só
 * vai para o console, em qualquer ambiente.
 */

const RESEND_URL = "https://api.resend.com/emails";
const PRAZO_ENVIO_MS = 10_000;
const MINUTOS = Math.round(CODIGO_VALIDADE_MS / 60_000);

const MODELO_NOVA_SENHA = {
  assunto: "Código para criar uma nova senha",
  uso: `Digite este código na tela de nova senha do ${NOME_DO_PRODUTO}.`,
  fecho:
    "Se você não pediu uma senha nova, ignore este e-mail. A sua senha continua a mesma.",
};

function escapar(texto: string): string {
  return texto
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;");
}

const FONTE =
  "-apple-system, 'Segoe UI', Roboto, Helvetica, Arial, sans-serif";
const MONO = "ui-monospace, Menlo, Consolas, monospace";

const TEXTO = `font-family:${FONTE};font-size:14px;line-height:20px;color:#57534e;`;

function linha(conteudo: string, estilo: string) {
  return `<tr><td style="${estilo}">${conteudo}</td></tr>`;
}

/** O envelope dos e-mails: a marca, o assunto como título e as linhas de
 *  cada modelo embaixo. */
function pagina(assunto: string, linhas: string): string {
  return `<!doctype html>
<html lang="pt-BR">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>${escapar(assunto)}</title>
</head>
<body style="margin:0;padding:0;background:#fafaf9;">
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background:#fafaf9;">
<tr><td align="center" style="padding:32px 16px;">
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="max-width:440px;background:#ffffff;border:1px solid #e7e5e1;border-radius:10px;">
${linha(escapar(NOME_DO_PRODUTO), `padding:24px 24px 0 24px;font-family:${FONTE};font-size:14px;line-height:20px;font-weight:600;color:#1a1917;`)}
${linha(escapar(assunto), `padding:16px 24px 0 24px;font-family:${FONTE};font-size:20px;line-height:28px;font-weight:600;color:#1a1917;`)}
${linhas}
</table>
</td></tr>
</table>
</body>
</html>`;
}

function html(codigo: string): string {
  const m = MODELO_NOVA_SENHA;
  return pagina(
    m.assunto,
    `${linha(escapar(m.uso), `padding:8px 24px 0 24px;${TEXTO}`)}
${linha(
  `<div style="font-family:${MONO};font-size:32px;line-height:40px;font-weight:600;letter-spacing:8px;color:#12293f;background:#f1f5fa;border-radius:6px;padding:12px 0 12px 8px;text-align:center;">${escapar(codigo)}</div>`,
  "padding:16px 24px 0 24px;",
)}
${linha(`Vale por ${MINUTOS} minutos e só funciona uma vez.`, `padding:16px 24px 0 24px;${TEXTO}`)}
${linha("Ninguém da equipe pede este código. Não passe para outra pessoa.", `padding:8px 24px 24px 24px;${TEXTO}`)}
${linha(escapar(m.fecho), `padding:16px 24px 24px 24px;border-top:1px solid #e7e5e1;font-family:${FONTE};font-size:12px;line-height:16px;color:#57534e;`)}`,
  );
}

function textoPuro(codigo: string): string {
  const m = MODELO_NOVA_SENHA;
  return [
    NOME_DO_PRODUTO,
    "",
    `${m.assunto}: ${codigo}`,
    "",
    `${m.uso} Vale por ${MINUTOS} minutos e só funciona uma vez.`,
    "",
    "Ninguém da equipe pede este código. Não passe para outra pessoa.",
    "",
    m.fecho,
  ].join("\n");
}

/**
 * Manda o código de nova senha para `para`. Lança erro quando o e-mail não
 * sai, para quem chamou decidir o que dizer na tela. A mensagem do erro
 * nunca leva o código.
 */
export async function enviarCodigoNovaSenha(
  para: string,
  codigo: string,
): Promise<void> {
  const chave = process.env.RESEND_API_KEY;

  if (!chave) {
    if (process.env.NODE_ENV === "production") {
      throw new Error(
        "RESEND_API_KEY não configurada: o e-mail com o código não sai (veja docs/SETUP.md).",
      );
    }
    console.warn(
      `[email] RESEND_API_KEY vazia, e-mail não enviado. Código (nova senha) para ${para}: ${codigo}`,
    );
    return;
  }

  await enviarPeloResend(chave, {
    para,
    assunto: MODELO_NOVA_SENHA.assunto,
    html: html(codigo),
    texto: textoPuro(codigo),
  });
}

const QUANDO = new Intl.DateTimeFormat("pt-BR", {
  timeZone: FUSO,
  day: "2-digit",
  month: "2-digit",
  year: "numeric",
  hour: "2-digit",
  minute: "2-digit",
  hourCycle: "h23",
});

/** "08/10/2026 às 14h05" (ou "às 9h", na hora cheia), em Brasília. */
function quandoEmTexto(quando: Date): string {
  const partes = QUANDO.formatToParts(quando);
  const pegar = (tipo: Intl.DateTimeFormatPartTypes) =>
    partes.find((p) => p.type === tipo)?.value ?? "";
  const hora = Number(pegar("hour"));
  const minuto = pegar("minute");
  return `${pegar("day")}/${pegar("month")}/${pegar("year")} às ${hora}h${minuto === "00" ? "" : minuto}`;
}

const ASSUNTO_SENHA_TROCADA = "Sua senha foi trocada";

/**
 * Avisa `para` que a senha da conta foi trocada pela tela Minha conta, com
 * dia e hora de Brasília: se não foi a pessoa, ela fica sabendo pelo e-mail,
 * que quem trocou a senha não alcança. Lança erro quando o e-mail não sai;
 * quem chama só registra (a senha já está trocada).
 */
export async function enviarAvisoSenhaTrocada(
  para: string,
  quando: Date,
): Promise<void> {
  const frase = `Sua senha do ${NOME_DO_PRODUTO} foi trocada em ${quandoEmTexto(quando)}.`;
  const fecho = "Se não foi você, fale com a administração.";
  const chave = process.env.RESEND_API_KEY;

  if (!chave) {
    console.warn(
      `[email] RESEND_API_KEY vazia, aviso não enviado. Para ${para}: ${frase} ${fecho}`,
    );
    return;
  }

  await enviarPeloResend(chave, {
    para,
    assunto: ASSUNTO_SENHA_TROCADA,
    html: pagina(
      ASSUNTO_SENHA_TROCADA,
      `${linha(escapar(frase), `padding:8px 24px 0 24px;${TEXTO}`)}
${linha(escapar(fecho), `padding:8px 24px 24px 24px;${TEXTO}`)}`,
    ),
    texto: [NOME_DO_PRODUTO, "", frase, "", fecho].join("\n"),
  });
}

/**
 * O POST para o Resend. Sem remetente configurado, em produção o envio
 * falha; fora dela, usa o remetente de teste. Lança erro quando o e-mail
 * não sai.
 */
async function enviarPeloResend(
  chave: string,
  email: { para: string; assunto: string; html: string; texto: string },
): Promise<void> {
  let remetente = process.env.EMAIL_REMETENTE;
  if (!remetente) {
    if (process.env.NODE_ENV === "production") {
      throw new Error(
        "EMAIL_REMETENTE não configurado: o e-mail não sai (veja docs/SETUP.md).",
      );
    }
    // Remetente de teste do Resend: só entrega para o dono da conta do Resend.
    remetente = `${NOME_DO_PRODUTO} <onboarding@resend.dev>`;
    console.warn(
      "[email] EMAIL_REMETENTE vazio, usando o remetente de teste do Resend.",
    );
  }

  let resposta: Response;
  try {
    resposta = await fetch(RESEND_URL, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${chave}`,
        "Content-Type": "application/json",
        "User-Agent": "atendimento",
      },
      body: JSON.stringify({
        from: remetente,
        to: [email.para],
        subject: email.assunto,
        html: email.html,
        text: email.texto,
      }),
      signal: AbortSignal.timeout(PRAZO_ENVIO_MS),
      cache: "no-store",
    });
  } catch (erro) {
    const prazo =
      erro instanceof Error &&
      (erro.name === "TimeoutError" || erro.name === "AbortError");
    throw new Error(
      prazo
        ? "Resend: sem resposta a tempo."
        : `Resend: falha de rede (${erro instanceof Error ? erro.message : "desconhecida"}).`,
    );
  }

  if (!resposta.ok) {
    let motivo = "";
    try {
      const corpo = (await resposta.json()) as { message?: unknown };
      if (typeof corpo.message === "string") {
        motivo = corpo.message.trim().replace(/\.+$/, "");
      }
    } catch {
      // corpo vazio ou fora do JSON: fica só o status
    }
    throw new Error(
      `Resend recusou o envio (${resposta.status})${motivo ? `: ${motivo}` : ""}.`,
    );
  }
}
