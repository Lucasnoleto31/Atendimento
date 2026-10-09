import { cache } from "react";
import { cookies } from "next/headers";
import type { Papel } from "@/lib/papeis";
import { createClient } from "@/lib/supabase/server";
import { aparelhoConfirmado, COOKIE_APARELHO } from "@/lib/codigo-login";

export type PerfilSessao = {
  id: string;
  nome: string;
  email: string;
  papel: Papel;
  ativo: boolean;
};

/**
 * Id do usuário logado (claim `sub` do token), ou null.
 *
 * getClaims e não getUser: o middleware já chamou getUser neste mesmo
 * request (inclusive no POST de server action) e barrou sessão inválida ou
 * revogada — repetir aqui seria mais uma ida ao Supabase Auth por chamada.
 * Com chave de assinatura assimétrica (o projeto publica uma ES256 no JWKS)
 * a assinatura é conferida localmente; com chave simétrica o próprio
 * getClaims cai no getUser. O único caso que a conferência local não vê —
 * sessão revogada com o token ainda no prazo — é justamente o que o getUser
 * do middleware pega antes de o request chegar aqui.
 *
 * Sessão de aparelho que ainda não confirmou o código do e-mail para ESTA
 * pessoa também é null. O middleware já segura essa pessoa na tela do
 * código; conferir de novo aqui faz layout, páginas, loaders e server
 * actions não dependerem só dele (um matcher que pule um caminho deixaria
 * de ser furo). É só o HMAC do cookie, conferido em memória. No layout,
 * null leva ao /entrar, e o middleware de lá manda para /entrar/codigo.
 * A tela do código e as actions dela não passam por aqui: usam getUser
 * direto, senão quem ainda não confirmou ficaria preso fora delas.
 *
 * cache() do React: layout, página e loaders do mesmo render dividem uma
 * única verificação. Server action não roda dentro de um render, então ali
 * cada chamada confere de novo — o que custa pouco, porque é local.
 */
export const idDaSessao = cache(async (): Promise<string | null> => {
  const supabase = await createClient();
  const { data } = await supabase.auth.getClaims();
  const id = data?.claims.sub;
  if (!id) return null;

  const aparelho = (await cookies()).get(COOKIE_APARELHO)?.value;
  return (await aparelhoConfirmado(aparelho, id)) ? id : null;
});

/**
 * Perfil do usuário logado, ou null (sem sessão, aparelho sem o código do
 * e-mail ou sem linha em profiles). Uma consulta por request, por causa do
 * cache(). O select traz tudo o que o layout e as páginas leem, inclusive
 * `ativo`.
 *
 * Devolve também a conta DESATIVADA, de propósito: é com ela que o layout
 * mostra "Acesso desativado". Se esta função a escondesse, o layout mandaria
 * para o /entrar, o middleware (sessão e aparelho válidos) devolveria para o
 * /chat, e assim sem fim. Guarda de quem AGE usa perfilAtivo().
 */
export const perfilAtual = cache(async (): Promise<PerfilSessao | null> => {
  const id = await idDaSessao();
  if (!id) return null;

  const supabase = await createClient();
  const { data } = await supabase
    .from("profiles")
    .select("id, nome, email, papel, ativo")
    .eq("id", id)
    .single();

  return (data as PerfilSessao) ?? null;
});

/**
 * perfilAtual() só de conta ativa: a guarda de action, rota de exportação e
 * leitor. Desativar grava só profiles.ativo = false e o RLS não olha essa
 * coluna; sem esta guarda, quem saiu da empresa com a aba aberta seguia
 * mandando mensagem e baixando a base até o token vencer. O middleware
 * barra a mesma conta nas server actions e no /api/exportar (rede de
 * segurança para quem ainda chama perfilAtual numa action).
 */
export async function perfilAtivo(): Promise<PerfilSessao | null> {
  const perfil = await perfilAtual();
  return perfil?.ativo ? perfil : null;
}

/**
 * Igual a perfilAtivo(), mas devolve null para quem não pode gravar
 * (compliance é só leitura). É a guarda das actions que escrevem por
 * service role ou disparam efeito externo (WhatsApp): o RLS restritivo
 * não alcança esses caminhos.
 */
export async function perfilQueEscreve(): Promise<PerfilSessao | null> {
  const perfil = await perfilAtivo();
  if (!perfil || perfil.papel === "compliance") return null;
  return perfil;
}
