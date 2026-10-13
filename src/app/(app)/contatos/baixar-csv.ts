/**
 * Baixa o CSV da rota de exportação (a lista filtrada ou a seleção) por
 * fetch, e não por link: o erro da rota (sessão caída, papel sem acesso, o
 * registro do log que não gravou) volta como texto para a tela mostrar, em
 * vez de virar um arquivo baixado com o texto do erro dentro. A trava de
 * papel e o registro no log de acesso continuam na rota.
 *
 * Só roda no navegador (cria o link do download).
 *
 * Com `sinal`, quem chamou pode cancelar no meio (o Cancelar da
 * confirmação): a busca para e nenhum arquivo sai. O registro no log é
 * gravado pela rota antes de montar o arquivo, então o cancelado pode já
 * ter ficado no log.
 *
 * O sucesso traz o que a rota mandou nos cabeçalhos: quantos contatos foram
 * no arquivo (X-Linhas) e se o filtro passava do teto da seleção
 * (X-Cortado). O aviso da tela diz isso, e não a contagem feita antes.
 */

const SEM_CONEXAO = "A conexão não respondeu. Confira a internet e tente de novo.";

const SESSAO =
  "Não deu para exportar: a sessão pode ter expirado. Entre de novo e tente outra vez.";

/** O texto de quem cancelou o download no meio. */
export const DOWNLOAD_CANCELADO =
  "Download cancelado. A exportação pode já ter ficado registrada no log de acesso.";

export type ResultadoCsv =
  | {
      ok: true;
      /** Contatos no arquivo; null se a resposta não disse. */
      linhas: number | null;
      /** O filtro passava do teto, e o arquivo parou nos primeiros. */
      cortado: boolean;
    }
  | { ok: false; erro: string; cancelado?: true };

const CANCELADO: ResultadoCsv = {
  ok: false,
  erro: DOWNLOAD_CANCELADO,
  cancelado: true,
};

export async function baixarCsv(
  url: string,
  sinal?: AbortSignal,
): Promise<ResultadoCsv> {
  let resposta: Response;
  try {
    resposta = await fetch(url, { credentials: "same-origin", signal: sinal });
  } catch {
    return sinal?.aborted ? CANCELADO : { ok: false, erro: SEM_CONEXAO };
  }
  const tipo = resposta.headers.get("Content-Type") ?? "";
  if (!resposta.ok || !tipo.includes("text/csv")) {
    const texto = tipo.includes("text/plain")
      ? (await resposta.text().catch(() => "")).trim()
      : "";
    if (sinal?.aborted) return CANCELADO;
    return { ok: false, erro: texto || SESSAO };
  }
  let arquivo: Blob;
  try {
    arquivo = await resposta.blob();
  } catch {
    return sinal?.aborted ? CANCELADO : { ok: false, erro: SEM_CONEXAO };
  }
  // Cancelado entre o fim da leitura e aqui: o arquivo não sai.
  if (sinal?.aborted) return CANCELADO;
  const nome =
    /filename="([^"]+)"/.exec(
      resposta.headers.get("Content-Disposition") ?? "",
    )?.[1] ?? "contatos.csv";
  const endereco = URL.createObjectURL(arquivo);
  const link = document.createElement("a");
  link.href = endereco;
  link.download = nome;
  document.body.appendChild(link);
  link.click();
  link.remove();
  window.setTimeout(() => URL.revokeObjectURL(endereco), 1000);
  const linhas = Number.parseInt(resposta.headers.get("X-Linhas") ?? "", 10);
  return {
    ok: true,
    linhas: Number.isNaN(linhas) ? null : linhas,
    cortado: resposta.headers.get("X-Cortado") === "1",
  };
}
