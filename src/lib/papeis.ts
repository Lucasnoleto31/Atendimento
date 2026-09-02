/**
 * Os cinco papéis de acesso. Arquivo puro (sem imports de servidor): o
 * menu, a tela de usuários e as actions leem daqui.
 *
 * `vendedor` continua sendo o valor gravado no banco para o ASSESSOR — a
 * base inteira (policies, gates, distribuição) compara com esse literal e
 * renomear o enum quebraria tudo por um ganho cosmético. O rótulo é o que
 * muda.
 */
export const PAPEIS = [
  {
    papel: "atendente",
    rotulo: "Atendente",
    detalhe: "só os próprios leads e conversas",
  },
  {
    papel: "vendedor",
    rotulo: "Assessor",
    detalhe: "a própria carteira, com custódia e comissão",
  },
  {
    papel: "gestor",
    rotulo: "Gestor",
    detalhe: "equipe inteira, redistribui e aprova",
  },
  {
    papel: "admin",
    rotulo: "Admin / Financeiro",
    detalhe: "usuários, integrações, fechamento",
  },
  {
    papel: "compliance",
    rotulo: "Compliance",
    detalhe: "vê tudo e exporta — não edita nada",
  },
] as const;

export type Papel = (typeof PAPEIS)[number]["papel"];

export function ehPapel(valor: string): valor is Papel {
  return PAPEIS.some((p) => p.papel === valor);
}

export function rotuloPapel(papel: string | null | undefined): string {
  return PAPEIS.find((p) => p.papel === papel)?.rotulo ?? String(papel ?? "");
}

/** Admin ou gestor: quem edita regras, redistribui e aprova. */
export function ehGestao(papel: string | null | undefined): boolean {
  return papel === "admin" || papel === "gestor";
}

/** Quem enxerga a base inteira (gestão + compliance). */
export function veTudo(papel: string | null | undefined): boolean {
  return ehGestao(papel) || papel === "compliance";
}

export function somenteLeitura(papel: string | null | undefined): boolean {
  return papel === "compliance";
}

export function ehAtendente(papel: string | null | undefined): boolean {
  return papel === "atendente";
}
