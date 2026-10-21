import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { lerPrivacidade } from "@/lib/privacidade";
import { exigirGestao } from "./acesso";
import { situacaoInstagram, webhookConfigurado } from "./webhook";
import { PARAM_ABRIR, hrefDoEditor, subpaginaDoEditor } from "./rotas";
import { TelaIndice, type ResumoAdministracao } from "./tela";
import { titulo } from "@/lib/marca";

export const metadata: Metadata = { title: titulo("Administração") };

type Busca = Record<string, string | string[] | undefined>;

function primeiro(valor: string | string[] | undefined): string {
  const bruto = Array.isArray(valor) ? valor[0] : valor;
  return typeof bruto === "string" ? bruto : "";
}

/**
 * O índice da Administração: uma linha por seção, com o estado à direita,
 * no desenho dos Ajustes do iPhone. O compliance vai direto ao Log de acesso
 * (acesso.ts). O endereço com ?abrir=<chave> (o link de outra tela para um
 * editor, e o /configuracoes antigo) vai à subpágina da chave, com o
 * ?voltar= e o resto junto.
 */
export default async function AdminPage({
  searchParams,
}: {
  searchParams: Promise<Busca>;
}) {
  const perfil = await exigirGestao();
  const params = await searchParams;

  // Chave que não é de subpágina nenhuma fica no índice (sem isso, o
  // desvio voltaria para cá mesmo, em círculo).
  const chave = primeiro(params[PARAM_ABRIR]) || primeiro(params.editar);
  if (chave && subpaginaDoEditor(chave)) {
    const destino = new URL(hrefDoEditor(chave), "https://x.invalid");
    for (const [nome, valor] of Object.entries(params)) {
      if (nome === PARAM_ABRIR || nome === "editar") continue;
      const v = primeiro(valor);
      if (v) destino.searchParams.set(nome, v);
    }
    redirect(destino.pathname + destino.search);
  }

  const ehAdmin = perfil.papel === "admin";
  const supabase = await createClient();
  const contar = (tabela: string) =>
    supabase
      .from(tabela)
      .select("id", { count: "exact", head: true })
      .then((r) => (r.error ? null : (r.count ?? 0)));

  const [
    mensagens,
    etiquetas,
    distribuicao,
    equipe,
    ultimaImportacao,
    numeros,
    privacidade,
  ] = await Promise.all([
    contar("quick_replies"),
    contar("tags"),
    supabase
      .from("settings")
      .select("valor")
      .eq("chave", "distribuicao_automatica")
      .maybeSingle()
      .then((r) => Number(r.data?.valor ?? 0) === 1),
    // A coluna do rodízio é da 0041; sem ela, a equipe sem o rodízio.
    supabase
      .from("profiles")
      .select("id, ativo, recebe_leads")
      .then((r) =>
        r.error
          ? supabase
              .from("profiles")
              .select("id, ativo")
              .then((r2) => ({
                lista: (r2.data ?? []) as {
                  ativo: boolean;
                  recebe_leads?: boolean | null;
                }[],
                comRodizio: false,
              }))
          : {
              lista: (r.data ?? []) as {
                ativo: boolean;
                recebe_leads?: boolean | null;
              }[],
              comRodizio: true,
            },
      ),
    supabase
      .from("imports")
      .select("referencia_data, status, linhas_ok")
      .eq("tipo", "leads")
      .order("criado_em", { ascending: false })
      .limit(1)
      .then(
        (r) =>
          ((r.data ?? [])[0] ?? null) as {
            referencia_data: string;
            status: string;
            linhas_ok: number | null;
          } | null,
      ),
    supabase
      .from("whatsapp_instances")
      .select("meta_phone_number_id")
      .then(
        (r) => (r.data ?? []) as { meta_phone_number_id: string | null }[],
      ),
    ehAdmin ? lerPrivacidade().catch(() => null) : Promise.resolve(null),
  ]);

  const ativos = equipe.lista.filter((p) => p.ativo);
  const resumo: ResumoAdministracao = {
    ehAdmin,
    mensagens,
    etiquetas,
    distribuicao,
    rodizio: equipe.comRodizio
      ? {
          dentro: ativos.filter((p) => p.recebe_leads).length,
          ativos: ativos.length,
        }
      : null,
    ultimaImportacao,
    pessoas: equipe.lista.length,
    desativadas: equipe.lista.length - ativos.length,
    regras: privacidade ? privacidade.regras.length : null,
    numeros: numeros.length,
    conectados: numeros.filter((n) => n.meta_phone_number_id).length,
    webhook: webhookConfigurado(),
    instagram: situacaoInstagram().configurado,
  };

  return <TelaIndice resumo={resumo} />;
}
