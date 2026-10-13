import { headers } from "next/headers";
import { createServiceClient } from "@/lib/supabase/server";

/**
 * Freio de tentativas do /entrar, todo em login_tentativas (0046): a Vercel
 * não guarda memória entre requisições e não há Redis. A tabela só tem
 * e-mail, IP e data; só o service role lê e grava.
 *
 * O freio da senha (5 falhas em 15 min por e-mail ou MAX_FALHAS_IP por IP,
 * sucesso apaga só as do e-mail) mora em actions.ts e usa e-mail e IP crus.
 * Palpite de
 * código e pedido de nova senha usam a MESMA tabela, mas com uma marca na
 * frente do e-mail e do IP ("CODIGO:fulano@zeve.com.br"). A marca é o que
 * impede o atalho: senha certa apaga as falhas do e-mail e do IP, e quem
 * tem a senha de outra pessoa poderia errar 4 códigos, entrar de novo com
 * a senha para zerar e repetir para sempre. Com a marca, a senha certa não
 * alcança as falhas de código. Em maiúsculas de propósito: o login baixa o
 * e-mail para minúsculas, então nenhum e-mail digitado vira uma linha
 * marcada.
 */

export const MAX_FALHAS = 5;
export const JANELA_MIN = 15;

/**
 * Teto de falhas de senha por IP na janela, mais alto que o do e-mail: a
 * equipe entra do mesmo escritório, atrás de um IP só, e o acerto de um não
 * apaga os erros de digitação dos outros. Com 5, cinco erros somados de
 * pessoas diferentes travariam o escritório inteiro por 15 minutos.
 */
export const MAX_FALHAS_IP = 20;

/** A mesma frase no pedido barrado e no palpite barrado: quem leu uma e
 *  tentou o outro caminho lê a mesma coisa, e não um aviso novo. */
export const MENSAGEM_MUITAS_TENTATIVAS =
  "Muitas tentativas. Aguarde alguns minutos e peça um código novo.";

/**
 * Tetos a mais do pedido de nova senha, além dos 5 em 15 min por e-mail ou
 * IP: 10 por e-mail em 24 h e 30 no sistema inteiro por hora. O pedido não
 * exige login e cada um gasta um e-mail do Resend; sem estes tetos, um
 * anônimo com a lista de e-mails da equipe (nome@zeve.com.br) esgotaria a
 * cota do dia e ninguém mais receberia código de nova senha. As linhas
 * duram 24 h: o expurgo do login certo só apaga as mais velhas que isso.
 */
export const RECUPERACAO_MAX_DIA = 10;
export const RECUPERACAO_MAX_HORA = 30;

const HORA_MS = 60 * 60 * 1000;
const DIA_MS = 24 * HORA_MS;

/** CODIGO: palpite errado de código de nova senha. RECUPERACAO: pedido de
 *  nova senha. */
export type Marca = "CODIGO" | "RECUPERACAO";

/**
 * Valor seguro para o filtro or= do PostgREST: vírgula, parêntese e aspas
 * quebram a sintaxe. E-mail com esses caracteres nem é válido de qualquer
 * forma, então remover não bloqueia ninguém legítimo.
 */
export function paraFiltro(valor: string): string {
  return valor.replaceAll(/[,()"]/g, "");
}

/** Primeiro salto do x-forwarded-for: é o IP real do cliente na Vercel. */
export async function ipDoCliente(): Promise<string> {
  const h = await headers();
  const encadeado = h.get("x-forwarded-for") ?? "";
  const primeiro = encadeado.split(",")[0]?.trim();
  return primeiro || h.get("x-real-ip") || "desconhecido";
}

function marcado(marca: Marca, valor: string): string {
  return `${marca}:${valor}`;
}

type Servico = ReturnType<typeof createServiceClient>;

function servico(): Servico | null {
  try {
    return createServiceClient();
  } catch {
    return null;
  }
}

/**
 * Linhas desta marca nos últimos `janelaMs`. Com e-mail e IP, as de um OU
 * do outro; só com e-mail, as do e-mail; sem nenhum dos dois, todas as da
 * marca (o teto do sistema inteiro). null quando o banco não respondeu.
 */
async function contar(
  s: Servico,
  marca: Marca,
  janelaMs: number,
  chaves: { email?: string; ip?: string },
): Promise<number | null> {
  const consulta = s
    .from("login_tentativas")
    .select("id", { count: "exact", head: true })
    .gte("criado_em", new Date(Date.now() - janelaMs).toISOString());
  const { count, error } = await (chaves.email && chaves.ip
    ? consulta.or(
        `email.eq."${paraFiltro(marcado(marca, chaves.email))}",ip.eq."${paraFiltro(marcado(marca, chaves.ip))}"`,
      )
    : chaves.email
      ? consulta.eq("email", marcado(marca, chaves.email))
      : consulta.like("email", `${marca}:%`));
  if (error) {
    console.error(`[freio] contagem ${marca} falhou: ${error.message}`);
    return null;
  }
  return count ?? 0;
}

/**
 * Quantas linhas desta marca há na janela de 15 min para o e-mail (e, se
 * vier, para o IP). null quando o banco não respondeu: cada chamador decide
 * se segue.
 */
export async function contarRecentes(
  marca: Marca,
  chaves: { email: string; ip?: string },
): Promise<number | null> {
  const s = servico();
  if (!s) {
    console.warn(`[freio] sem SUPABASE_SERVICE_ROLE_KEY: freio ${marca} desligado.`);
    return null;
  }
  return contar(s, marca, JANELA_MIN * 60_000, chaves);
}

/** Apaga as linhas desta marca para o e-mail (só o e-mail, nunca o IP). */
export async function limpar(marca: Marca, email: string): Promise<void> {
  const s = servico();
  if (!s) return;
  await s
    .from("login_tentativas")
    .delete()
    .eq("email", marcado(marca, email))
    .then(
      () => {},
      () => {},
    );
}

/** Grava a linha da tentativa e devolve o id dela, ou o erro do banco. */
async function gravarLinha(
  s: Servico,
  marca: Marca,
  email: string,
  ip: string,
): Promise<{ id: string } | { erro: string }> {
  const { data, error } = await s
    .from("login_tentativas")
    .insert({ email: marcado(marca, email), ip: marcado(marca, ip) })
    .select("id")
    .single();
  if (error || !data) return { erro: error?.message ?? "gravação sem retorno" };
  return { id: (data as { id: string }).id };
}

/**
 * A tentativa barrada não conta: senão quem insiste prolonga o bloqueio
 * para sempre, inclusive o do dono da conta. As linhas que causaram o
 * bloqueio continuam lá até sair da janela.
 */
async function apagarLinha(s: Servico, id: string): Promise<void> {
  await s
    .from("login_tentativas")
    .delete()
    .eq("id", id)
    .then(
      () => {},
      () => {},
    );
}

export type Reserva =
  | { situacao: "liberada" }
  | { situacao: "bloqueada" }
  | { situacao: "indisponivel" };

/**
 * Antes de conferir um código: grava a tentativa e SÓ DEPOIS conta. Contar
 * antes e gravar depois deixaria uma rajada de 100 requisições em paralelo
 * passar inteira pela contagem (todas veem 0); gravando antes, a k-ésima
 * enxerga pelo menos k linhas, e só as 5 primeiras seguem. A linha gravada
 * já é a falha: se o código conferir, quem chamou apaga as do e-mail.
 *
 * Sem banco, em produção, a conferência para (indisponivel): é o freio que
 * segura alguém com a senha de testar o milhão de códigos possíveis. Na
 * máquina de desenvolvimento sem service role, segue sem freio e avisa.
 */
export async function reservarTentativaDeCodigo(
  email: string,
  ip: string,
): Promise<Reserva> {
  const semFreio = (motivo: string): Reserva => {
    if (process.env.NODE_ENV !== "production") {
      console.warn(`[freio] código sem freio (${motivo}).`);
      return { situacao: "liberada" };
    }
    console.error(`[freio] código sem freio (${motivo}): conferência barrada.`);
    return { situacao: "indisponivel" };
  };

  const s = servico();
  if (!s) return semFreio("sem SUPABASE_SERVICE_ROLE_KEY");

  const linha = await gravarLinha(s, "CODIGO", email, ip);
  if ("erro" in linha) return semFreio(linha.erro);

  const total = await contar(s, "CODIGO", JANELA_MIN * 60_000, { email, ip });
  if (total === null) return semFreio("contagem falhou");
  if (total > MAX_FALHAS) {
    await apagarLinha(s, linha.id);
    return { situacao: "bloqueada" };
  }
  return { situacao: "liberada" };
}

/** Qual teto do pedido de nova senha barrou: 15 min, 24 h ou o da hora. */
export type TetoRecuperacao = "janela" | "dia" | "hora";

export type ReservaRecuperacao =
  | { situacao: "liberada" }
  | { situacao: "bloqueada"; teto: TetoRecuperacao };

/**
 * Antes de gerar o código de nova senha: grava o pedido e SÓ DEPOIS conta,
 * pelo mesmo motivo de reservarTentativaDeCodigo (contar antes deixava uma
 * rajada em paralelo passar inteira, e cada uma mandava um e-mail). Pedido
 * barrado é apagado: só os que passaram contam para os tetos.
 *
 * Sem banco, o pedido segue: o pior caso é e-mail repetido, não conta
 * aberta (o código ainda tem de ser digitado, e ali o freio do código vale).
 * Sem service role nem há o que mandar, porque o código sai do generateLink.
 */
export async function reservarPedidoDeRecuperacao(
  email: string,
  ip: string,
): Promise<ReservaRecuperacao> {
  const s = servico();
  if (!s) {
    console.warn("[freio] sem SUPABASE_SERVICE_ROLE_KEY: freio RECUPERACAO desligado.");
    return { situacao: "liberada" };
  }

  const linha = await gravarLinha(s, "RECUPERACAO", email, ip);
  if ("erro" in linha) {
    console.error(`[freio] registro RECUPERACAO falhou: ${linha.erro}`);
    return { situacao: "liberada" };
  }

  // A linha deste pedido entra nas três contagens, daí o ">" e não ">=".
  const [janela, dia, hora] = await Promise.all([
    contar(s, "RECUPERACAO", JANELA_MIN * 60_000, { email, ip }),
    contar(s, "RECUPERACAO", DIA_MS, { email }),
    contar(s, "RECUPERACAO", HORA_MS, {}),
  ]);
  const teto: TetoRecuperacao | null =
    (janela ?? 0) > MAX_FALHAS
      ? "janela"
      : (dia ?? 0) > RECUPERACAO_MAX_DIA
        ? "dia"
        : (hora ?? 0) > RECUPERACAO_MAX_HORA
          ? "hora"
          : null;
  if (!teto) return { situacao: "liberada" };

  await apagarLinha(s, linha.id);
  return { situacao: "bloqueada", teto };
}
