import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { perfilAtual } from "@/lib/auth";
import { veTudo } from "@/lib/papeis";
import { ROTULO_ACAO } from "@/lib/auditoria";
import { formatarData } from "@/lib/format";
import { voltarDaSubpagina } from "../subpagina";
import { GRUPO_ANTIGO, GRUPOS_ACOES } from "./acoes";
import {
  acoesAntigasNoPeriodo,
  consultarLog,
  LIMITE_LOG,
  paraLinha,
} from "./consulta";
import type { GrupoDoFiltro } from "./filtros";
import { TelaLog } from "./tela";
import {
  lerAvisoExportacao,
  lerFiltrosLog,
  rotuloDoPeriodoLog,
} from "./url";
import { titulo } from "@/lib/marca";

export const metadata: Metadata = { title: titulo("Log de acesso") };

/** Hoje e ontem em dd/mm/aaaa, e o nome do período. Fora do componente
 *  (regra de pureza: relógio não se lê no render). */
function relogio() {
  const agora = Date.now();
  return {
    hoje: formatarData(new Date(agora)),
    ontem: formatarData(new Date(agora - 86_400_000)),
    agora: new Date(agora),
  };
}

export default async function AcessosPage({
  searchParams,
}: PageProps<"/admin/acessos">) {
  const perfil = await perfilAtual();
  if (!perfil || !veTudo(perfil.papel)) redirect("/chat");

  const params = await searchParams;
  const filtros = lerFiltrosLog(params);
  const { hoje, ontem, agora } = relogio();

  const supabase = await createClient();
  const [{ registros, erro }, { data: equipe }, antigas, nomeDoLead] =
    await Promise.all([
      consultarLog(supabase, filtros),
      supabase.from("profiles").select("id, nome").order("nome"),
      acoesAntigasNoPeriodo(supabase, filtros),
      // O nome do contato do ?lead=, para a pílula dizer quem é.
      filtros.lead
        ? supabase
            .from("leads")
            .select("nome")
            .eq("id", filtros.lead)
            .maybeSingle()
            .then((r) => (r.data?.nome as string | undefined) ?? null)
        : Promise.resolve(null),
    ]);

  // As ações em grupos, com o rótulo. As do sistema antigo só aparecem com
  // registro no período (ou já escolhidas, para dar para tirá-las).
  const rotulo = (chave: string) => ROTULO_ACAO[chave] ?? chave;
  const antigasVisiveis = GRUPO_ANTIGO.acoes.filter(
    (a) => antigas.includes(a) || filtros.acoes.includes(a),
  );
  const conhecidas = new Set([
    ...GRUPOS_ACOES.flatMap((g) => g.acoes),
    ...GRUPO_ANTIGO.acoes,
  ]);
  // Ação que não está em grupo nenhum (gravada depois desta lista) e foi
  // escolhida por link: entra no fim, para a pílula ter nome e dar para
  // desmarcar.
  const avulsas = filtros.acoes.filter((a) => !conhecidas.has(a));
  const grupos: GrupoDoFiltro[] = [
    ...GRUPOS_ACOES,
    ...(antigasVisiveis.length > 0
      ? [{ ...GRUPO_ANTIGO, acoes: antigasVisiveis }]
      : []),
    ...(avulsas.length > 0
      ? [{ id: "outras", titulo: "Outras", acoes: avulsas }]
      : []),
  ].map((g) => ({
    id: g.id,
    titulo: g.titulo,
    acoes: g.acoes.map((chave) => ({ chave, rotulo: rotulo(chave) })),
  }));

  return (
    <TelaLog
      filtros={filtros}
      rotuloPeriodo={rotuloDoPeriodoLog(filtros, agora)}
      linhas={registros.map(paraLinha)}
      temMais={registros.length === LIMITE_LOG}
      pessoas={(equipe ?? []) as { id: string; nome: string }[]}
      grupos={grupos}
      nomeDoLead={nomeDoLead}
      erro={erro}
      avisoExportacao={lerAvisoExportacao(params.aviso)}
      hoje={hoje}
      ontem={ontem}
      raiz={perfil.papel === "compliance"}
      voltar={voltarDaSubpagina(params.voltar, "/admin/acessos")}
    />
  );
}
