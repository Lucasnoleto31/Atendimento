import type { createClient } from "@/lib/supabase/server";
import { rotuloPapel } from "@/lib/papeis";
import {
  ACOES_SENSIVEIS,
  descreverDetalhes,
  fraseDaAcao,
} from "@/lib/auditoria";
import { formatarData, FUSO } from "@/lib/format";
import { ACOES_ANTIGAS } from "./acoes";
import { intervaloDoLog, type FiltrosLog } from "./url";

/*
 * A consulta do Log de acesso e a linha pronta para a tela. Servidor: a
 * página, a exportação e o "Carregar mais" leem daqui, com os mesmos
 * filtros. Nada aqui grava.
 */

type Supabase = Awaited<ReturnType<typeof createClient>>;

/** Registros por vez: a primeira leva e cada "Carregar mais". */
export const LIMITE_LOG = 300;

export type Registro = {
  id: string;
  quem: string | null;
  acao: string;
  detalhes: Record<string, unknown>;
  criado_em: string;
  autor: { nome: string; papel: string } | null;
};

const CAMPOS = "id, quem, acao, detalhes, criado_em, autor:profiles(nome, papel)";

/** Tira do termo o que quebra a sintaxe do .or() do PostgREST e os
 *  curingas do ilike. */
function termoSeguro(texto: string): string {
  return texto.replace(/[,()*%\\"]/g, " ").replace(/\s+/g, " ").trim();
}

/**
 * O filtro do contato: o nome gravado no registro (abriu a conversa de
 * Maria) ou os contatos que casam com o termo (nome ou telefone), pelo
 * lead_id gravado. Devolve o .or() pronto, ou null sem termo.
 */
async function filtroDoContato(
  supabase: Supabase,
  contato: string,
): Promise<string | null> {
  const termo = termoSeguro(contato);
  if (!termo) return null;
  const digitos = termo.replace(/\D/g, "");
  const alvos = [`nome.ilike.%${termo}%`];
  // Com poucos dígitos, "11" casaria meia base pelo DDD.
  if (digitos.length >= 4) alvos.push(`telefone_e164.ilike.%${digitos}%`);
  const { data } = await supabase
    .from("leads")
    .select("id")
    .or(alvos.join(","))
    // 100 ids cabem na URL do pedido (uns 3.700 caracteres).
    .limit(100);
  const ids = ((data ?? []) as { id: string }[]).map((l) => l.id);
  const filtros = [`detalhes->>nome.ilike.%${termo}%`];
  if (ids.length > 0) filtros.push(`detalhes->>lead_id.in.(${ids.join(",")})`);
  return filtros.join(",");
}

/**
 * Os registros dos filtros, do mais novo para o mais velho. `antes`: o
 * criado_em do último que a tela já tem (o "Carregar mais"). `limite`: null
 * para todos (a exportação pagina por fora com `faixa`).
 */
export async function consultarLog(
  supabase: Supabase,
  f: FiltrosLog,
  opcoes: { antes?: string | null; faixa?: [number, number] } = {},
): Promise<{ registros: Registro[]; erro: string | null }> {
  const contato = f.contato ? await filtroDoContato(supabase, f.contato) : null;
  const { desde, ateAntes } = intervaloDoLog(f);

  let q = supabase
    .from("auditoria")
    .select(CAMPOS)
    .order("criado_em", { ascending: false });
  if (desde) q = q.gte("criado_em", desde);
  if (ateAntes) q = q.lt("criado_em", ateAntes);
  if (opcoes.antes) q = q.lt("criado_em", opcoes.antes);
  if (f.quem.length > 0) q = q.in("quem", f.quem);
  if (f.acoes.length > 0) q = q.in("acao", f.acoes);
  if (f.lead) q = q.eq("detalhes->>lead_id", f.lead);
  if (contato) q = q.or(contato);
  q = opcoes.faixa
    ? q.range(opcoes.faixa[0], opcoes.faixa[1])
    : q.limit(LIMITE_LOG);

  const { data, error } = await q;
  return {
    registros: (data ?? []) as unknown as Registro[],
    erro: error ? error.message : null,
  };
}

/**
 * As ações do sistema antigo com registro no período (o resto dos filtros
 * não conta): só elas entram na lista de ações, no grupo do fim.
 */
export async function acoesAntigasNoPeriodo(
  supabase: Supabase,
  f: FiltrosLog,
): Promise<string[]> {
  const { desde, ateAntes } = intervaloDoLog(f);
  let q = supabase.from("auditoria").select("acao").in("acao", ACOES_ANTIGAS);
  if (desde) q = q.gte("criado_em", desde);
  if (ateAntes) q = q.lt("criado_em", ateAntes);
  const { data } = await q.limit(1000);
  return [...new Set(((data ?? []) as { acao: string }[]).map((r) => r.acao))];
}

/* ── A linha pronta para a tela ───────────────────────────────────────── */

/** O que a tela mostra de um registro, já em texto (a tela é de cliente e
 *  os rótulos moram no servidor). */
export type LinhaLog = {
  id: string;
  criadoEm: string;
  /** dd/mm/aaaa em Brasília, para o grupo do dia. */
  dia: string;
  /** 7h, 9h05, 14h32. */
  hora: string;
  /** Quem fez, quando a frase começa pelo nome; null nas ações sem sujeito. */
  nome: string | null;
  /** O verbo ("abriu a conversa") ou, sem sujeito, a frase inteira. */
  acao: string;
  tom: "tinta" | "atencao" | "erro";
  apoio: string;
  /** O contato do registro, para a linha abrir a ficha. */
  leadId: string | null;
};

const relogio = new Intl.DateTimeFormat("pt-BR", {
  timeZone: FUSO,
  hour: "2-digit",
  minute: "2-digit",
  hourCycle: "h23",
});

/** A hora em texto, como o kit, no fuso de Brasília: 7h, 9h05, 14h32. */
function horaCurta(iso: string) {
  const partes = relogio.formatToParts(new Date(iso));
  const h = Number(partes.find((p) => p.type === "hour")?.value ?? 0);
  const m = partes.find((p) => p.type === "minute")?.value ?? "00";
  return m === "00" ? `${h}h` : `${h}h${m}`;
}

/**
 * Ações sem sujeito: quem aparece no registro não fez a ação, sofreu (o
 * login barrado) ou só recebeu (o resumo do gestor). "Ana login bloqueado"
 * não é frase: nelas o rótulo vira a frase, com maiúscula, e o nome vai para
 * a linha de apoio.
 */
const SEM_SUJEITO = new Set([
  "login_bloqueado",
  "captura_bloqueada",
  "codigo_login_bloqueado",
  "recuperacao_bloqueada",
  "resumo_gestor",
  "resumo_gestor_falha",
]);

function comMaiuscula(texto: string) {
  return texto.charAt(0).toLocaleUpperCase("pt-BR") + texto.slice(1);
}

/** Ação sensível (dado pessoal) e bloqueio ganham a cor do estado no verbo;
 *  o resto fica na tinta. */
function tomDaAcao(acao: string): LinhaLog["tom"] {
  if (acao.includes("bloquead") || acao.includes("falha")) return "erro";
  if (ACOES_SENSIVEIS.has(acao)) return "atencao";
  return "tinta";
}

export function paraLinha(r: Registro): LinhaLog {
  // Com alvo, a frase já diz em quem se mexeu ("mudou o papel de Bia") e a
  // linha de apoio fica com o antes e o depois.
  const { frase: rotuloAcao, comAlvo } = fraseDaAcao(r.acao, r.detalhes ?? {});
  const objeto = descreverDetalhes(r.detalhes ?? {}, {
    curto: true,
    semAlvo: comAlvo,
  });
  const semSujeito = SEM_SUJEITO.has(r.acao);
  // Sem sujeito, o nome abre a linha de apoio (e não se repete quando os
  // detalhes já trazem o mesmo nome).
  const nomeNoApoio = semSujeito ? r.autor?.nome : undefined;
  const apoio = [
    nomeNoApoio && !objeto.startsWith(nomeNoApoio) ? nomeNoApoio : null,
    r.autor ? rotuloPapel(r.autor.papel) : null,
    objeto || null,
  ]
    .filter(Boolean)
    .join(" · ");
  const lead = r.detalhes?.lead_id;
  return {
    id: r.id,
    criadoEm: r.criado_em,
    dia: formatarData(r.criado_em),
    hora: horaCurta(r.criado_em),
    nome: semSujeito ? null : (r.autor?.nome ?? "Sistema"),
    acao: semSujeito ? comMaiuscula(rotuloAcao) : rotuloAcao,
    tom: tomDaAcao(r.acao),
    apoio,
    leadId: typeof lead === "string" && lead ? lead : null,
  };
}
