/**
 * Normalização de telefone e número digitados.
 *
 * Mora fora do csv.ts porque o webhook do WhatsApp depende de
 * variantesTelefone em toda mensagem recebida; o csv.ts reexporta tudo daqui
 * para quem já importava de lá. Sem import por alias (@/), para o arquivo
 * rodar também no node puro, fora do Next.
 */

/**
 * Telefone brasileiro para E.164 sem símbolos: 5511988421170.
 * Retorna null quando não dá para confiar no número.
 *
 * aceitarExterior é para o número digitado à mão (cadastro e edição de
 * contato): com "+" na frente e código de país que não é o 55, vale como
 * veio, de 8 a 15 dígitos (o teto do E.164); com "+55", só 12 ou 13 dígitos.
 * Sem a opção, "+1 415 555 2672" caía na regra do DDD e virava
 * 5514155552672, um número de Bauru. Webhook, importação e disparos seguem
 * sem ela: lá o número sem DDI é brasileiro.
 */
export function normalizarTelefone(
  bruto: string,
  opcoes: { aceitarExterior?: boolean } = {},
): string | null {
  // Notação científica do Excel ("5,56599E+12"): os dígitos finais foram
  // perdidos na exportação — número irrecuperável, melhor nulo que errado.
  if (/e[+-]?\d/i.test(bruto)) return null;

  if (opcoes.aceitarExterior && bruto.trim().startsWith("+")) {
    const exterior = bruto.replace(/\D/g, "");
    // Com "+55" o DDI já veio: vale só 55 + DDD + 8 ou 9 dígitos. Sem esta
    // trava, o "+55 62 9607-323" (um dígito a menos) caía na regra do DDD
    // e ganhava um segundo 55: 5555629607323.
    if (exterior.startsWith("55")) {
      return exterior.length === 12 || exterior.length === 13 ? exterior : null;
    }
    // Código de país não começa com 0.
    if (/^[1-9]/.test(exterior)) {
      return exterior.length >= 8 && exterior.length <= 15 ? exterior : null;
    }
  }

  const d = bruto.replace(/\D/g, "").replace(/^0+/, "");
  if (!d) return null;

  // Já veio com DDI 55 e DDD.
  if ((d.length === 12 || d.length === 13) && d.startsWith("55")) return d;

  // DDD + número, sem DDI.
  if (d.length === 10 || d.length === 11) return `55${d}`;

  return null;
}

/**
 * As duas grafias do mesmo CELULAR brasileiro: com e sem o nono dígito.
 * O WhatsApp registra números antigos sem o 9 (wa_id "556296073230"),
 * mas as pessoas digitam com o 9 ("5562996073230") — comparar telefone
 * por igualdade exata separa a mesma pessoa em dois registros.
 */
export function variantesTelefone(telefone: string): string[] {
  const variantes = [telefone];
  if (telefone.startsWith("55")) {
    // Fixo é 55 + DDD + 8 dígitos começando em 2..5; celular antigo, em 6..9.
    // Somar um 9 a um fixo inventa o número de outra pessoa.
    if (telefone.length === 12 && telefone[4] >= "6" && telefone[4] <= "9") {
      variantes.push(`${telefone.slice(0, 4)}9${telefone.slice(4)}`);
    }
    if (telefone.length === 13 && telefone[4] === "9") {
      variantes.push(telefone.slice(0, 4) + telefone.slice(5));
    }
  }
  return variantes;
}

/** Número digitado nos dois formatos: aceita 1.234,56 e 1234.56. */
export function normalizarNumero(bruto: string): number | null {
  const valor = bruto.trim();
  if (!valor) return null;

  const limpo =
    valor.includes(",") && valor.lastIndexOf(",") > valor.lastIndexOf(".")
      ? valor.replace(/\./g, "").replace(",", ".")
      : valor.replace(/,/g, "");

  const n = Number(limpo);
  return Number.isFinite(n) ? n : null;
}
