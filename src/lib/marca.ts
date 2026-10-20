/**
 * A identidade de quem usa o sistema, lida do ambiente na hora do build
 * (variáveis NEXT_PUBLIC_*, que o Next embute no código do navegador).
 *
 * Sem variável nenhuma vale a Zeve: a produção da Zeve não muda com este
 * arquivo. Outro cliente (a primeira é a Incell, loja de iPhones) sobe com
 * as variáveis preenchidas no painel da Vercel e ganha o próprio nome em
 * título, marca, e-mails, página de captura e nos prompts da IA. O passo a
 * passo de um cliente novo está em docs/NOVO-CLIENTE.md.
 *
 * As chaves do localStorage (`zeve:…`) ficam como estão: são internas ao
 * navegador do atendente e ninguém as vê.
 */

/** O nome da empresa que atende: "Zeve", "Incell". */
export const NOME_DA_EMPRESA =
  process.env.NEXT_PUBLIC_NOME_DA_EMPRESA?.trim() || "Zeve";

/** O nome do sistema como aparece na aba, na marca e nos e-mails. */
export const NOME_DO_PRODUTO =
  process.env.NEXT_PUBLIC_NOME_DO_PRODUTO?.trim() ||
  `${NOME_DA_EMPRESA} Atendimento`;

/**
 * Sobre o que a equipe conversa, para os prompts da IA do chat (resumo e
 * sugestão de resposta). Entra na frase "…conversa com leads e clientes
 * pelo WhatsApp sobre {RAMO_DO_NEGOCIO}".
 */
export const RAMO_DO_NEGOCIO =
  process.env.NEXT_PUBLIC_RAMO_DO_NEGOCIO?.trim() ||
  "investimentos e abertura de conta em corretora";

/**
 * Quem chama o lead de volta, na página pública /captura: "um assessor",
 * "um vendedor", "alguém da equipe". Minúsculo; a página capitaliza quando
 * começa a frase.
 */
export const QUEM_ATENDE =
  process.env.NEXT_PUBLIC_QUEM_ATENDE?.trim() || "um assessor";

/**
 * O tema do cliente: o nome de uma pasta em public/temas/ com tema.css (os
 * tokens de cor dos dois temas, com a ficha do projeto no topo), logo.svg e
 * logo-escuro.svg (a marca por extenso, uma por tema), simbolo.svg (a barra
 * recolhida) e icone.svg (o favicon). Só letras minúsculas, dígitos e
 * hífen: vira caminho de URL e de arquivo. Em branco, não há tema.
 */
export const TEMA = (() => {
  const t = process.env.NEXT_PUBLIC_TEMA?.trim() ?? "";
  return /^[a-z0-9-]+$/.test(t) ? t : "";
})();

/** Caminhos públicos dos arquivos do tema, ou null sem tema. */
export const ARQUIVOS_DO_TEMA = TEMA
  ? {
      css: `/temas/${TEMA}/tema.css`,
      logo: `/temas/${TEMA}/logo.svg`,
      logoEscuro: `/temas/${TEMA}/logo-escuro.svg`,
      simbolo: `/temas/${TEMA}/simbolo.svg`,
      icone: `/temas/${TEMA}/icone.svg`,
    }
  : null;

/**
 * O Z da Zeve só aparece na Zeve, sem tema. Com tema, a marca vem dos
 * arquivos dele; sem tema e com outra empresa, a marca é o nome em texto e,
 * com a barra lateral recolhida, a inicial.
 */
export const MARCA_DA_ZEVE = !TEMA && NOME_DA_EMPRESA === "Zeve";

/** O e-mail de exemplo dos campos de entrada e da validação do admin. */
export const EMAIL_EXEMPLO = MARCA_DA_ZEVE ? "voce@zeve.com.br" : "voce@email.com";

/** Título de página no padrão "Chat · Zeve Atendimento". */
export function titulo(pagina: string): string {
  return `${pagina} · ${NOME_DO_PRODUTO}`;
}

/** "um assessor" → "Um assessor". */
export function capitalizar(texto: string): string {
  return texto.charAt(0).toUpperCase() + texto.slice(1);
}
