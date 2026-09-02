import { after } from "next/server";
import { createServiceClient } from "@/lib/supabase/server";

/**
 * Trilha de acesso: quem viu o quê. Grava DEPOIS da resposta (after) para
 * não custar latência a quem está atendendo, e engole falha — auditoria
 * que derruba a tela vira auditoria desligada por alguém no primeiro dia.
 *
 * Ações de LEITURA (novas na 0067): viu_ficha, viu_cliente, abriu_conversa,
 * revelou_documento. As de escrita/exportação já existiam.
 */
export function registrarAcesso(
  quem: string | null,
  acao: string,
  detalhes: Record<string, unknown> = {},
) {
  try {
    after(async () => {
      try {
        const service = createServiceClient();
        await service.from("auditoria").insert({ quem, acao, detalhes });
      } catch {
        // sem service role ou tabela: silêncio consciente
      }
    });
  } catch {
    // fora de um request (script/cron): não há "after" — ignora
  }
}

/** Rótulo humano de cada ação, para a tela do log e o CSV. */
export const ROTULO_ACAO: Record<string, string> = {
  viu_ficha: "viu a ficha",
  viu_cliente: "viu o cliente",
  abriu_conversa: "abriu a conversa",
  revelou_documento: "revelou o CPF/CNPJ",
  exportar_leads: "exportou leads",
  exportar_carteira: "exportou a carteira",
  exportar_vendas: "exportou vendas",
  exportar_auditoria: "exportou o log de acesso",
  login_bloqueado: "login bloqueado",
  captura_bloqueada: "captura bloqueada",
  resumo_gestor: "resumo do gestor enviado",
  resumo_gestor_falha: "resumo do gestor falhou",
  resetou_2fa: "resetou o 2FA de alguém",
};

/** Ações que mexem com dado pessoal sensível — ganham selo no log. */
export const ACOES_SENSIVEIS = new Set([
  "revelou_documento",
  "exportar_leads",
  "exportar_carteira",
  "exportar_auditoria",
]);

/** O "objeto" da linha: o que dá para dizer a partir dos detalhes gravados. */
export function descreverDetalhes(d: Record<string, unknown>): string {
  const partes: string[] = [];
  if (typeof d.nome === "string") partes.push(d.nome);
  if (typeof d.email === "string") partes.push(d.email);
  if (typeof d.linhas === "number") partes.push(`${d.linhas} linhas`);
  if (typeof d.lista === "string") partes.push(`lista ${d.lista}`);
  if (typeof d.periodo === "string") partes.push(`período ${d.periodo}`);
  if (typeof d.ip === "string") partes.push(`ip ${d.ip}`);
  if (typeof d.motivo === "string") partes.push(d.motivo);
  if (partes.length === 0 && typeof d.lead_id === "string")
    partes.push(`lead ${d.lead_id.slice(0, 8)}`);
  if (partes.length === 0 && typeof d.customer_id === "string")
    partes.push(`cliente ${d.customer_id.slice(0, 8)}`);
  if (partes.length === 0 && typeof d.usuario_id === "string")
    partes.push(`usuário ${d.usuario_id.slice(0, 8)}`);
  return partes.join(" · ");
}
