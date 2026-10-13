import { cache } from "react";
import { createClient } from "@/lib/supabase/server";
import { perfilAtual } from "@/lib/auth";
import {
  CHAVE_PRIVACIDADE,
  donoOculto,
  normalizarPrivacidade,
  ocultosPara,
  type ConfigPrivacidade,
} from "@/lib/privacidade-regra";

/*
 * Privacidade entre pessoas da equipe, do lado do servidor: o admin define
 * em Administração quem não vê as conversas de quem (grupos e regras), e as
 * telas filtram por aqui. A regra, os tipos e os testes de mesa estão em
 * lib/privacidade-regra.ts (puro, reexportado abaixo).
 *
 * Só para servidor (página, action, rota): este arquivo puxa next/headers
 * pelo cliente do Supabase. No cliente, a página passa a lista pronta como
 * prop (donosOcultos: string[]) e o componente filtra com o donoOculto de
 * "@/lib/privacidade-regra".
 *
 * Isto é a regra nas telas do sistema. Enquanto a proposta
 * supabase/propostas/0071_privacidade.sql não for aplicada, o banco não
 * sabe dela: a API com a chave pública e a sessão, e o tempo real, seguem
 * entregando o que o RLS de hoje entrega (docs/PRIVACIDADE.md).
 */

export {
  CHAVE_PRIVACIDADE,
  donoOculto,
  normalizarPrivacidade,
  ocultosPara,
  PRIVACIDADE_VAZIA,
} from "@/lib/privacidade-regra";
export type {
  ConfigPrivacidade,
  GrupoPrivacidade,
  QuemPrivacidade,
  RegraPrivacidade,
} from "@/lib/privacidade-regra";

/**
 * Os grupos e as regras, lidos de settings com a sessão de quem pede (a
 * policy de leitura de settings vale para toda a equipe). Sem linha, sem
 * regra.
 *
 * Erro de leitura é erro, não "sem regra": devolver vazio mostraria a quem
 * tem regra exatamente o que ela esconde. A página cai na tela de erro e a
 * pessoa tenta de novo.
 */
export async function lerPrivacidade(): Promise<ConfigPrivacidade> {
  const supabase = await createClient();
  const { data, error } = await supabase
    .from("settings")
    .select("valor")
    .eq("chave", CHAVE_PRIVACIDADE)
    .maybeSingle();
  if (error) {
    throw new Error(`Não deu para ler a privacidade: ${error.message}`);
  }
  return normalizarPrivacidade(data?.valor);
}

/**
 * Os responsáveis cujas conversas e contatos a pessoa logada não vê. Vazio
 * para admin e para quem nenhuma regra alcança. Uma leitura por request
 * (cache() do React): layout, página e loaders do mesmo render dividem a
 * conta. Em server action não há render, e cada chamada lê de novo.
 */
export const donosOcultosParaMim = cache(async (): Promise<string[]> => {
  const perfil = await perfilAtual();
  if (!perfil || perfil.papel === "admin") return [];
  return ocultosPara(await lerPrivacidade(), perfil.id, perfil.papel);
});

/**
 * A pessoa logada pode ver este lead (conversa ou contato)? Lê o
 * responsavel_id com a sessão: o lead que o RLS não devolve é false, e o
 * que ele devolve passa pela regra de privacidade. A guarda de quem abre
 * conversa ou ficha pelo id (URL, paleta, action).
 */
export async function podeVerLead(leadId: string): Promise<boolean> {
  if (!leadId) return false;
  const supabase = await createClient();
  const { data, error } = await supabase
    .from("leads")
    .select("responsavel_id")
    .eq("id", leadId)
    .maybeSingle();
  if (error || !data) return false;
  const dono = (data as { responsavel_id: string | null }).responsavel_id;
  return !donoOculto(dono, await donosOcultosParaMim());
}
