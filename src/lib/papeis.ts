/**
 * Os cinco papéis de acesso. Arquivo puro (sem imports de servidor): o
 * menu, a tela de usuários e as actions leem daqui.
 *
 * `vendedor` continua sendo o valor gravado no banco para o ASSESSOR — a
 * base inteira (policies, gates, distribuição) compara com esse literal e
 * renomear o enum quebraria tudo por um ganho cosmético. O rótulo é o que
 * muda.
 *
 * Os detalhes descrevem o que cada papel vê no chat, e quem decide isso é o
 * RLS do banco (0067 e 0068), não a tela: mudar o texto não muda o acesso.
 */
export const PAPEIS = [
  {
    papel: "atendente",
    rotulo: "Atendente",
    detalhe: "só as conversas em que é o responsável",
  },
  {
    papel: "vendedor",
    rotulo: "Assessor",
    detalhe: "as próprias conversas e as sem responsável",
  },
  {
    papel: "gestor",
    rotulo: "Gestor",
    detalhe: "todas as conversas, redistribui e aprova",
  },
  {
    papel: "admin",
    rotulo: "Admin",
    detalhe: "todas as conversas, usuários e integrações",
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

/**
 * Onde a entrada "Administração" do menu leva cada papel: a gestão ao
 * índice (/admin), o compliance direto ao Log de acesso (é tudo o que ele vê
 * ali; um índice de uma linha seria um toque à toa). null: o papel não tem
 * a entrada.
 */
export function entradaDaAdministracao(
  papel: string | null | undefined,
): string | null {
  if (ehGestao(papel)) return "/admin";
  if (papel === "compliance") return "/admin/acessos";
  return null;
}

export function somenteLeitura(papel: string | null | undefined): boolean {
  return papel === "compliance";
}

export function ehAtendente(papel: string | null | undefined): boolean {
  return papel === "atendente";
}
