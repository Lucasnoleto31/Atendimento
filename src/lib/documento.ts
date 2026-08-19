/**
 * Detecção de CPF/CNPJ em texto livre (mensagens do WhatsApp).
 *
 * Telefone BR também tem 11 dígitos — por isso só aceitamos documento com os
 * dígitos verificadores corretos, e descartamos qualquer candidato que seja o
 * próprio telefone do lead.
 */

/**
 * Forma canônica do documento: só dígitos, com o zero à esquerda de volta.
 * O Excel/diversificador trata CPF como número e come o zero da frente
 * ("01177961237" vira "1177961237"), então o mesmo CPF fica com grafias
 * diferentes no cliente e no lead e o cruzamento falha. Normaliza os dois
 * lados para 11 (CPF) ou 14 (CNPJ) dígitos. Devolve null se não sobrar nada.
 */
export function normalizarDocumento(bruto: string): string | null {
  const d = (bruto ?? "").replace(/\D/g, "");
  if (!d) return null;
  if (d.length <= 11) return d.padStart(11, "0");
  if (d.length <= 14) return d.padStart(14, "0");
  return d;
}

export function validarCpf(cpf: string): boolean {
  if (!/^\d{11}$/.test(cpf) || /^(\d)\1{10}$/.test(cpf)) return false;
  for (const posicao of [9, 10]) {
    let soma = 0;
    for (let i = 0; i < posicao; i++) {
      soma += Number(cpf[i]) * (posicao + 1 - i);
    }
    const dv = ((soma * 10) % 11) % 10;
    if (dv !== Number(cpf[posicao])) return false;
  }
  return true;
}

export function validarCnpj(cnpj: string): boolean {
  if (!/^\d{14}$/.test(cnpj) || /^(\d)\1{13}$/.test(cnpj)) return false;
  const calcular = (tamanho: number) => {
    const pesos =
      tamanho === 12
        ? [5, 4, 3, 2, 9, 8, 7, 6, 5, 4, 3, 2]
        : [6, 5, 4, 3, 2, 9, 8, 7, 6, 5, 4, 3, 2];
    let soma = 0;
    for (let i = 0; i < tamanho; i++) soma += Number(cnpj[i]) * pesos[i];
    const resto = soma % 11;
    return resto < 2 ? 0 : 11 - resto;
  };
  return (
    calcular(12) === Number(cnpj[12]) && calcular(13) === Number(cnpj[13])
  );
}

/**
 * Primeiro CPF/CNPJ válido no texto, ou null. `telefoneLead` (dígitos com DDI)
 * é descartado como candidato — 11 dígitos podem ser só o número de quem fala.
 */
export function extrairDocumento(
  texto: string,
  telefoneLead: string,
): string | null {
  // Trechos de dígitos possivelmente pontuados (052.936.281-70, 05293628170,
  // 12.345.678/0001-90…), sem atravessar palavras ou quebras de linha.
  const trechos = texto.match(/\d[\d.\-\/ ]{9,24}\d/g) ?? [];

  for (const trecho of trechos) {
    const digitos = trecho.replace(/\D/g, "");
    if (digitos.length === 11) {
      if (telefoneLead.endsWith(digitos)) continue; // é o próprio telefone
      if (validarCpf(digitos)) return digitos;
    }
    if (digitos.length === 14 && validarCnpj(digitos)) return digitos;
  }
  return null;
}
