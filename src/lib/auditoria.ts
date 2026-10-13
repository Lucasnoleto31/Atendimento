import { after } from "next/server";
import { createServiceClient } from "@/lib/supabase/server";

/**
 * Trilha de acesso: quem viu o quê. Grava DEPOIS da resposta (after) para
 * não custar latência a quem está atendendo, e engole falha — auditoria
 * que derruba a tela vira auditoria desligada por alguém no primeiro dia.
 *
 * Ações de LEITURA (novas na 0067): viu_ficha, viu_cliente, abriu_conversa,
 * revelou_documento. As de escrita/exportação já existiam. Desde 09/10/2026
 * entram também as mudanças da Administração, com o antes e o depois em
 * detalhes.mudancas, e as ações em massa da lista de contatos, uma linha por
 * ação; só depois de a gravação dar certo.
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

/**
 * Rótulo humano de cada ação, para a tela do log e o CSV. A lista é de tudo
 * o que já foi gravado na tabela, não só do que o sistema grava hoje: as
 * linhas antigas continuam lá e o log precisa seguir legível para elas.
 */
export const ROTULO_ACAO: Record<string, string> = {
  viu_ficha: "viu a ficha",
  viu_cliente: "viu o cliente",
  abriu_conversa: "abriu a conversa",
  revelou_documento: "revelou o CPF/CNPJ",
  exportar_leads: "exportou contatos",
  exportar_carteira: "exportou a carteira",
  exportar_vendas: "exportou vendas",
  exportar_auditoria: "exportou o log de acesso",
  login_bloqueado: "login bloqueado",
  captura_bloqueada: "captura bloqueada",
  resumo_gestor: "resumo do gestor enviado",
  resumo_gestor_falha: "resumo do gestor falhou",
  resetou_2fa: "resetou o 2FA de alguém",
  resetou_senha: "gerou senha nova para alguém",
  // Só linhas antigas: o código de acesso por e-mail saiu em 10/2026, e o
  // rótulo fica para o log de antes continuar legível.
  aparelho_confirmado: "confirmou um aparelho novo",
  // Ainda gravada pela tela de nova senha (além das linhas antigas do login).
  codigo_login_bloqueado: "palpites de código bloqueados",
  recuperacao_pedida: "pediu código de nova senha",
  recuperacao_bloqueada: "pedido de nova senha bloqueado",
  senha_redefinida: "criou senha nova pelo e-mail",
  // Minha conta: o log lê "Ana trocou a própria senha", com o nome antes.
  trocou_senha: "trocou a própria senha",
  troca_senha_bloqueada: "teve a troca de senha bloqueada",
  saiu_dos_outros_aparelhos: "saiu dos outros aparelhos",
  mudou_proprio_nome: "mudou o próprio nome",
  trocou_propria_foto: "trocou a própria foto",
  removeu_foto_usuario: "removeu a foto de alguém",
  // Administração > Equipe.
  mudou_nome_usuario: "mudou o nome de alguém",
  mudou_email_usuario: "mudou o e-mail de alguém",
  // Administração > Privacidade (lib/privacidade.ts): quem não vê as
  // conversas de quem.
  privacidade_grupo_criou: "criou um grupo de privacidade",
  privacidade_grupo_mudou: "mudou um grupo de privacidade",
  privacidade_grupo_excluiu: "excluiu um grupo de privacidade",
  privacidade_regra_criou: "criou uma regra de privacidade",
  privacidade_regra_mudou: "mudou uma regra de privacidade",
  privacidade_regra_excluiu: "excluiu uma regra de privacidade",
  // Chat: apagar só esconde da equipe (o contato continua vendo), e o
  // contato aparece pelo nome gravado nos detalhes.
  apagou_mensagem: "apagou uma mensagem para a equipe",
  ocultou_mensagem: "ocultou uma mensagem do contato",
  restaurou_mensagem: "restaurou uma mensagem apagada",
  // Contatos: as ações em massa da lista (e o "Trocar" do responsável na
  // ficha, que passa pela mesma action). Uma linha por ação, não uma por
  // contato; na linha do log, a frase diz as etiquetas ou o novo dono e
  // quantos contatos mudaram (FRASE_EM_MASSA, abaixo).
  etiquetou_contatos: "mudou as etiquetas de contatos",
  transferiu_contatos: "transferiu contatos",
  // As mudanças da Administração (desde 09/10/2026). O rótulo é o da lista de
  // filtros e do CSV; na linha do log, o "alguém" e o "uma" dão lugar ao
  // nome gravado em detalhes.alvo (FRASE_COM_ALVO, abaixo).
  criou_usuario: "cadastrou alguém na equipe",
  mudou_papel_usuario: "mudou o papel de alguém",
  desativou_usuario: "desativou o acesso de alguém",
  reativou_usuario: "reativou o acesso de alguém",
  pos_no_rodizio: "pôs alguém no rodízio",
  tirou_do_rodizio: "tirou alguém do rodízio",
  ligou_distribuicao: "ligou a distribuição automática",
  desligou_distribuicao: "desligou a distribuição automática",
  mudou_teto_envios: "mudou o teto de envios por dia",
  mudou_horario: "mudou o horário de atendimento",
  ligou_resposta_automatica: "ligou uma resposta automática",
  desligou_resposta_automatica: "desligou uma resposta automática",
  mudou_resposta_automatica: "mudou o texto de uma resposta automática",
  criou_numero: "adicionou um número de WhatsApp",
  mudou_numero: "mudou um número de WhatsApp",
  ativou_numero: "ativou um número de WhatsApp",
  desativou_numero: "desativou um número de WhatsApp",
  excluiu_numero: "excluiu um número de WhatsApp",
  criou_etiqueta: "criou uma etiqueta",
  renomeou_etiqueta: "renomeou uma etiqueta",
  mudou_cor_etiqueta: "mudou a cor de uma etiqueta",
  excluiu_etiqueta: "excluiu uma etiqueta",
  criou_mensagem_padrao: "criou uma mensagem pronta",
  mudou_mensagem_padrao: "mudou uma mensagem pronta",
  excluiu_mensagem_padrao: "excluiu uma mensagem pronta",
  importou_contatos: "importou contatos",
  excluiu_importacao: "excluiu uma importação do histórico",
};

/**
 * A frase da linha do log quando o registro diz em quem ou em quê se mexeu
 * (detalhes.alvo): "Ana mudou o papel de Bia", "Ana excluiu a etiqueta
 * “VIP”". Nome de pessoa vai sem aspas; nome de coisa, com as aspas do
 * aviso da tela ("Etiqueta “VIP” excluída").
 */
const FRASE_COM_ALVO: Record<string, (alvo: string) => string> = {
  criou_usuario: (a) => `cadastrou ${a} na equipe`,
  mudou_papel_usuario: (a) => `mudou o papel de ${a}`,
  desativou_usuario: (a) => `desativou o acesso de ${a}`,
  reativou_usuario: (a) => `reativou o acesso de ${a}`,
  pos_no_rodizio: (a) => `pôs ${a} no rodízio`,
  tirou_do_rodizio: (a) => `tirou ${a} do rodízio`,
  removeu_foto_usuario: (a) => `removeu a foto de ${a}`,
  ligou_resposta_automatica: (a) => `ligou a resposta automática de ${a}`,
  desligou_resposta_automatica: (a) => `desligou a resposta automática de ${a}`,
  mudou_resposta_automatica: (a) =>
    `mudou o texto da resposta automática de ${a}`,
  criou_numero: (a) => `adicionou o número “${a}”`,
  mudou_numero: (a) => `mudou o número “${a}”`,
  ativou_numero: (a) => `ativou o número “${a}”`,
  desativou_numero: (a) => `desativou o número “${a}”`,
  excluiu_numero: (a) => `excluiu o número “${a}”`,
  criou_etiqueta: (a) => `criou a etiqueta “${a}”`,
  mudou_cor_etiqueta: (a) => `mudou a cor da etiqueta “${a}”`,
  excluiu_etiqueta: (a) => `excluiu a etiqueta “${a}”`,
  criou_mensagem_padrao: (a) => `criou a mensagem pronta “${a}”`,
  mudou_mensagem_padrao: (a) => `mudou a mensagem pronta “${a}”`,
  excluiu_mensagem_padrao: (a) => `excluiu a mensagem pronta “${a}”`,
};

/**
 * A frase das ações em massa dos contatos, montada dos detalhes: "pôs a
 * etiqueta “VIP” em 120 contatos", "transferiu 1 contato para Bia". O
 * número é o de contatos que mudaram de fato, não o de marcados. Faltando o
 * que a frase pede, null, e a linha fica com o rótulo.
 */
const FRASE_EM_MASSA: Record<
  string,
  (d: Record<string, unknown>) => string | null
> = {
  etiquetou_contatos: (d) => {
    if (typeof d.contatos !== "number") return null;
    const n = contagemContatos(d.contatos);
    const postas = nomesGravados(d.etiquetas_postas);
    const tiradas = nomesGravados(d.etiquetas_tiradas);
    const artigo = (l: string[]) => (l.length === 1 ? "a etiqueta" : "as etiquetas");
    if (postas.length > 0 && tiradas.length > 0) {
      return `mudou as etiquetas de ${n}: pôs ${entreAspas(postas)} e tirou ${entreAspas(tiradas)}`;
    }
    if (postas.length > 0) return `pôs ${artigo(postas)} ${entreAspas(postas)} em ${n}`;
    if (tiradas.length > 0) {
      return `tirou ${artigo(tiradas)} ${entreAspas(tiradas)} de ${n}`;
    }
    return null;
  },
  transferiu_contatos: (d) => {
    if (typeof d.contatos !== "number") return null;
    const n = contagemContatos(d.contatos);
    if (d.sem_dono === true) return `deixou ${n} sem dono`;
    const alvo = typeof d.alvo === "string" ? d.alvo.trim() : "";
    return alvo ? `transferiu ${n} para ${alvo}` : null;
  },
};

/**
 * O verbo da linha do log, com o alvo quando há ("mudou o papel de Bia");
 * sem alvo gravado, o rótulo da lista. `comAlvo` avisa que o alvo já está na
 * frase (nas ações em massa, também as etiquetas, o novo dono e o número de
 * contatos), para a linha de apoio não repetir.
 */
export function fraseDaAcao(
  acao: string,
  d: Record<string, unknown>,
): { frase: string; comAlvo: boolean } {
  const emMassa = FRASE_EM_MASSA[acao];
  const fraseEmMassa = emMassa ? emMassa(d) : null;
  if (fraseEmMassa) return { frase: fraseEmMassa, comAlvo: true };
  const montar = FRASE_COM_ALVO[acao];
  const alvo = typeof d.alvo === "string" ? d.alvo.trim() : "";
  if (montar && alvo) return { frase: montar(alvo), comAlvo: true };
  return { frase: ROTULO_ACAO[acao] ?? acao, comAlvo: false };
}

/**
 * Uma mudança gravada nos detalhes (detalhes.mudancas): o campo, o valor de
 * antes e o de depois. Na criação só há o depois; na exclusão, só o antes.
 * Valor já em texto de gente ("Assessor", "Grafite", "+55 11 98842-1170");
 * número fica número e sai com o milhar brasileiro.
 */
export type Mudanca = {
  campo?: string;
  antes?: string | number;
  depois?: string | number;
  /** Texto livre (título, mensagem): sai entre aspas e, na tela, encurtado. */
  texto?: boolean;
};

/** As mudanças que mudaram de fato: campo igual antes e depois sai. */
export function soMudou(lista: Mudanca[]): Mudanca[] {
  return lista.filter((m) => m.antes !== m.depois);
}

/** Texto livre na linha do log (o CSV leva inteiro). */
const TEXTO_CURTO = 60;

function valorEmTexto(v: unknown, texto: boolean, curto: boolean) {
  if (typeof v === "number") return v.toLocaleString("pt-BR");
  if (typeof v !== "string") return null;
  if (!texto) return v;
  // A linha do log é uma frase: quebra de linha vira espaço.
  const plano = v.replace(/\s+/g, " ").trim();
  if (!plano) return "vazio";
  if (!curto || plano.length <= TEXTO_CURTO) return `“${plano}”`;
  // Corta no fim de palavra quando dá ("por aqui…", não "por aq…").
  const corte = plano.slice(0, TEXTO_CURTO - 1);
  const espaco = corte.lastIndexOf(" ");
  const inteiro = espaco >= TEXTO_CURTO / 2 ? corte.slice(0, espaco) : corte;
  return `“${inteiro.replace(/[\s,.;:!?]+$/, "")}…”`;
}

/** "papel de Assessor para Gestor", "cor Verde", "de 100 para 250". */
function descreverMudanca(m: unknown, curto: boolean): string | null {
  if (!m || typeof m !== "object") return null;
  const { campo, antes, depois, texto } = m as Record<string, unknown>;
  const a = valorEmTexto(antes, texto === true, curto);
  const d = valorEmTexto(depois, texto === true, curto);
  const valor = a !== null && d !== null ? `de ${a} para ${d}` : (d ?? a);
  if (valor === null) return null;
  return typeof campo === "string" && campo ? `${campo} ${valor}` : valor;
}

/** Ações que mexem com dado pessoal sensível — ganham selo no log. */
export const ACOES_SENSIVEIS = new Set([
  "revelou_documento",
  "exportar_leads",
  "exportar_carteira",
  "exportar_auditoria",
]);

/** Lista de nomes gravada nos detalhes; o que não for texto fica de fora. */
function nomesGravados(v: unknown): string[] {
  if (!Array.isArray(v)) return [];
  return v.filter((x): x is string => typeof x === "string" && x !== "");
}

/** "Ana", "Ana e Bia", "Ana, Bia e Caio". */
function juntarNomes(nomes: readonly string[]): string {
  if (nomes.length <= 1) return nomes[0] ?? "";
  return `${nomes.slice(0, -1).join(", ")} e ${nomes[nomes.length - 1]}`;
}

/** “VIP”, “VIP” e “Frio”: nome de coisa vai com as aspas da tela. */
function entreAspas(nomes: readonly string[]): string {
  return juntarNomes(nomes.map((n) => `“${n}”`));
}

/** "1 contato", "1.234 contatos". */
function contagemContatos(n: number): string {
  return n === 1 ? "1 contato" : `${n.toLocaleString("pt-BR")} contatos`;
}

/**
 * O "objeto" da linha: o que dá para dizer a partir dos detalhes gravados.
 * Sem opções, sai tudo e inteiro (o CSV). Na tela: `curto` encurta o texto
 * livre das mudanças e `semAlvo` deixa de fora o que a frase já disse
 * (fraseDaAcao): o alvo e, nas ações em massa, as etiquetas e o número de
 * contatos.
 */
export function descreverDetalhes(
  d: Record<string, unknown>,
  opcoes: { curto?: boolean; semAlvo?: boolean } = {},
): string {
  const partes: string[] = [];
  const alvo = typeof d.alvo === "string" && d.alvo.trim() ? d.alvo.trim() : null;
  if (alvo && !opcoes.semAlvo) partes.push(alvo);
  if (typeof d.nome === "string") partes.push(d.nome);
  if (typeof d.email === "string") partes.push(d.email);
  // O antes e o depois das mudanças da Administração ("papel de Assessor
  // para Gestor · texto de “Olá” para “Oi”").
  if (Array.isArray(d.mudancas)) {
    for (const m of d.mudancas) {
      const texto = descreverMudanca(m, opcoes.curto === true);
      if (texto) partes.push(texto);
    }
  }
  // Privacidade: o grupo pelo nome e a regra pela frase da tela ("Aikon (3
  // pessoas) não vê as conversas de Artur e Lucas.").
  if (typeof d.grupo === "string") partes.push(`grupo ${d.grupo}`);
  if (typeof d.membros === "number") {
    const n = d.membros.toLocaleString("pt-BR");
    partes.push(d.membros === 1 ? "1 pessoa" : `${n} pessoas`);
  }
  // Quem entrou no grupo e quem saiu ("entrou Bia · saíram Ana e Caio"):
  // sem isso, trocar os membros fica igual a salvar sem mudança.
  const entraram = nomesGravados(d.entraram);
  if (entraram.length > 0) {
    partes.push(`${entraram.length === 1 ? "entrou" : "entraram"} ${juntarNomes(entraram)}`);
  }
  const sairam = nomesGravados(d.sairam);
  if (sairam.length > 0) {
    partes.push(`${sairam.length === 1 ? "saiu" : "saíram"} ${juntarNomes(sairam)}`);
  }
  if (typeof d.regras_apagadas === "number" && d.regras_apagadas > 0) {
    const n = d.regras_apagadas.toLocaleString("pt-BR");
    partes.push(
      d.regras_apagadas === 1 ? "1 regra apagada junto" : `${n} regras apagadas junto`,
    );
  }
  if (typeof d.regra === "string") partes.push(d.regra);
  // O valor de antes, nas correções de nome e de e-mail (e no grupo e na
  // regra de privacidade).
  if (typeof d.antes === "string") partes.push(`antes ${d.antes}`);
  // A importação de contatos: o arquivo, as linhas, quantos contatos novos e
  // a etiqueta da lista ("etiqueta nova" quando ela nasceu na importação).
  if (typeof d.arquivo === "string") partes.push(d.arquivo);
  if (typeof d.linhas === "number") {
    // Separador de milhar brasileiro: 12.480 linhas, não 12480.
    const n = d.linhas.toLocaleString("pt-BR");
    partes.push(d.linhas === 1 ? "1 linha" : `${n} linhas`);
  }
  if (typeof d.novos === "number") {
    const n = d.novos.toLocaleString("pt-BR");
    partes.push(d.novos === 1 ? "1 contato novo" : `${n} contatos novos`);
  }
  if (typeof d.etiqueta === "string") {
    partes.push(
      d.etiqueta_nova === true
        ? `etiqueta nova ${d.etiqueta}`
        : `etiqueta ${d.etiqueta}`,
    );
  }
  if (typeof d.importada_em === "string") {
    partes.push(`importada em ${d.importada_em}`);
  }
  // As ações em massa dos contatos: as etiquetas que entraram e saíram, o
  // "sem dono" e quantos contatos mudaram (o novo dono é o alvo, acima). Na
  // tela a frase já diz isso, e a linha de apoio fica com o caminho: os
  // marcados ou o filtro inteiro da lista.
  if (!opcoes.semAlvo) {
    const postas = nomesGravados(d.etiquetas_postas);
    if (postas.length > 0) partes.push(`pôs ${entreAspas(postas)}`);
    const tiradas = nomesGravados(d.etiquetas_tiradas);
    if (tiradas.length > 0) partes.push(`tirou ${entreAspas(tiradas)}`);
    if (d.sem_dono === true) partes.push("sem dono");
    if (typeof d.contatos === "number") partes.push(contagemContatos(d.contatos));
  }
  // Etiquetar que parou no meio: no lote que falhou as etiquetas novas
  // entraram e as outras não saíram. Esses contatos ficam fora do número da
  // frase, e a linha diz à parte, também na tela.
  if (typeof d.so_postas === "number" && d.so_postas > 0) {
    const postas = nomesGravados(d.etiquetas_postas);
    partes.push(
      `só pôs ${postas.length > 0 ? entreAspas(postas) : "as etiquetas"} em mais ${contagemContatos(d.so_postas)}`,
    );
  }
  if (d.alcance === "selecao") partes.push("pela seleção");
  else if (d.alcance === "filtro") partes.push("pelo filtro da lista");
  if (typeof d.lista === "string") partes.push(`lista ${d.lista}`);
  if (typeof d.periodo === "string") partes.push(`período ${d.periodo}`);
  if (typeof d.ip === "string") partes.push(`ip ${d.ip}`);
  if (typeof d.motivo === "string") partes.push(d.motivo);
  // Os ids só quando não há mais nada a dizer (nem o alvo, já na frase).
  const vazio = partes.length === 0 && !alvo;
  if (vazio && typeof d.lead_id === "string")
    partes.push(`contato ${d.lead_id.slice(0, 8)}`);
  else if (vazio && typeof d.customer_id === "string")
    partes.push(`cliente ${d.customer_id.slice(0, 8)}`);
  else if (vazio && typeof d.usuario_id === "string")
    partes.push(`usuário ${d.usuario_id.slice(0, 8)}`);
  return partes.join(" · ");
}
