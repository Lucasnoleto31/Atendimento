/**
 * A regra de privacidade entre pessoas da equipe, sem nada que só rode no
 * servidor: os tipos, a leitura tolerante do JSON gravado em settings e a
 * conta de quem fica oculto para quem. O lado do servidor (ler do banco,
 * saber quem está logado, conferir um lead) mora em lib/privacidade.ts, que
 * reexporta tudo daqui.
 *
 * Componente de cliente importa DAQUI ("@/lib/privacidade-regra"), nunca de
 * "@/lib/privacidade": aquele arquivo puxa o cliente do Supabase de servidor
 * (next/headers), e o Next recusa o bundle do navegador com ele dentro. É o
 * mesmo par de lib/automaticas.ts (puro) e webhooks/automaticas.ts.
 *
 * A configuração mora em settings, chave "privacidade" (jsonb):
 *   { grupos: [{ id, nome, membros: [id de profiles] }],
 *     regras: [{ id, quem: { tipo: "pessoa" | "grupo", id }, naoVe: [id de profiles] }] }
 * Sem linha = sem regra.
 *
 * A regra: a pessoa P não vê conversas nem contatos (leads) cujo
 * responsavel_id esteja na união dos naoVe das regras em que "quem" é P ou um
 * grupo que contém P. Lead sem dono continua visível. Admin vê tudo sempre (a
 * regra não vale para ele). Ninguém fica oculto de si mesmo.
 *
 * Testes de mesa. Equipe: Artur (admin), Lucas e Caio (gestores), Ana e Bia
 * (assessoras), Dani (atendente). Grupo Aikon = Ana e Bia.
 *
 *   Regras: R1 "Aikon não vê Artur e Lucas"; R2 "Caio não vê Ana".
 *     ocultosPara(Ana)   = [Artur, Lucas]   (R1, pelo grupo)
 *     ocultosPara(Bia)   = [Artur, Lucas]   (R1)
 *     ocultosPara(Caio)  = [Ana]            (R2)
 *     ocultosPara(Lucas) = []               (nenhuma regra fala dele)
 *     ocultosPara(Artur) = []               (admin)
 *     Ana abre a Caixa: some a conversa de Artur que ela via pelo ramo da
 *     carteira; a sem dono e a dela ficam.
 *     Caio (gestor, via tudo) busca um contato de Ana: não acha; um sem
 *     dono, acha; um de Lucas, acha.
 *
 *   Regra R3 "Aikon não vê Ana":
 *     ocultosPara(Ana) = []    (ninguém fica oculto de si mesmo)
 *     ocultosPara(Bia) = [Ana]
 *
 *   Regra R4 "Artur não vê Lucas" (quem é o admin):
 *     ocultosPara(Artur) = []  (a tela de Administração avisa que não vale)
 *
 *   Regra R5 "Dani não vê Artur" (Dani é atendente):
 *     ocultosPara(Dani) = [Artur], mas o RLS já só mostra a Dani as conversas
 *     em que ela é a responsável: na tela nada muda (a prévia avisa).
 *
 *   R1 e R2 juntas, e Ana também numa regra própria "Ana não vê Caio":
 *     ocultosPara(Ana) = [Artur, Caio, Lucas]  (a união das duas)
 */

export const CHAVE_PRIVACIDADE = "privacidade";

export type GrupoPrivacidade = {
  id: string;
  nome: string;
  /** Ids de profiles. */
  membros: string[];
};

export type QuemPrivacidade = { tipo: "pessoa" | "grupo"; id: string };

export type RegraPrivacidade = {
  id: string;
  /** A quem a regra vale: uma pessoa ou um grupo. */
  quem: QuemPrivacidade;
  /** Os responsáveis cujas conversas e contatos ficam ocultos (ids de profiles). */
  naoVe: string[];
};

export type ConfigPrivacidade = {
  grupos: GrupoPrivacidade[];
  regras: RegraPrivacidade[];
};

export const PRIVACIDADE_VAZIA: ConfigPrivacidade = { grupos: [], regras: [] };

function texto(valor: unknown): string | null {
  return typeof valor === "string" && valor.trim() ? valor.trim() : null;
}

/** Lista de ids sem repetição e sem o que não é texto. */
function ids(valor: unknown): string[] {
  if (!Array.isArray(valor)) return [];
  const vistos = new Set<string>();
  for (const v of valor) {
    const id = texto(v);
    if (id) vistos.add(id);
  }
  return [...vistos];
}

/**
 * O valor de settings como a regra entende. Tolera linha ausente, campo
 * faltando e item quebrado (sai só o item; o resto vale): a chave é gravada
 * pela tela de Administração, mas até a proposta 0071 a policy de settings
 * deixa a gestão gravar qualquer coisa nela pela API.
 */
export function normalizarPrivacidade(valor: unknown): ConfigPrivacidade {
  if (!valor || typeof valor !== "object" || Array.isArray(valor)) {
    return { grupos: [], regras: [] };
  }
  const bruto = valor as { grupos?: unknown; regras?: unknown };

  const grupos: GrupoPrivacidade[] = [];
  for (const g of Array.isArray(bruto.grupos) ? bruto.grupos : []) {
    if (!g || typeof g !== "object") continue;
    const item = g as { id?: unknown; nome?: unknown; membros?: unknown };
    const id = texto(item.id);
    if (!id) continue;
    grupos.push({
      id,
      nome: texto(item.nome) ?? "Grupo sem nome",
      membros: ids(item.membros),
    });
  }

  const regras: RegraPrivacidade[] = [];
  for (const r of Array.isArray(bruto.regras) ? bruto.regras : []) {
    if (!r || typeof r !== "object") continue;
    const item = r as { id?: unknown; quem?: unknown; naoVe?: unknown };
    const id = texto(item.id);
    const quem = item.quem as { tipo?: unknown; id?: unknown } | null;
    const tipo = quem?.tipo;
    const quemId = texto(quem?.id);
    if (!id || !quemId || (tipo !== "pessoa" && tipo !== "grupo")) continue;
    regras.push({ id, quem: { tipo, id: quemId }, naoVe: ids(item.naoVe) });
  }

  return { grupos, regras };
}

/**
 * Os responsáveis ocultos para a pessoa: a união dos naoVe das regras que
 * valem para ela (dela mesma ou de um grupo em que está), menos ela mesma.
 * Vazio para admin. Em ordem, para a lista sair igual a cada chamada.
 */
export function ocultosPara(
  config: ConfigPrivacidade,
  pessoaId: string,
  papel?: string | null,
): string[] {
  if (!pessoaId || papel === "admin") return [];
  const meusGrupos = new Set(
    config.grupos.filter((g) => g.membros.includes(pessoaId)).map((g) => g.id),
  );
  const ocultos = new Set<string>();
  for (const regra of config.regras) {
    const vale =
      regra.quem.tipo === "pessoa"
        ? regra.quem.id === pessoaId
        : meusGrupos.has(regra.quem.id);
    if (!vale) continue;
    for (const id of regra.naoVe) {
      if (id !== pessoaId) ocultos.add(id);
    }
  }
  return [...ocultos].sort();
}

/**
 * A conversa (ou o contato) com este responsável está oculta para quem tem
 * esta lista? Sem dono, nunca. A lista vem de donosOcultosParaMim() no
 * servidor, ou da prop donosOcultos no cliente.
 */
export function donoOculto(
  responsavelId: string | null | undefined,
  ocultos: readonly string[],
): boolean {
  if (!responsavelId || ocultos.length === 0) return false;
  return ocultos.includes(responsavelId);
}
