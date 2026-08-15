/** +55 11 98842-1170 a partir de 5511988421170. */
export function formatarTelefone(e164: string) {
  const d = e164.replace(/\D/g, "");
  const nacional = d.startsWith("55") ? d.slice(2) : d;
  const ddd = nacional.slice(0, 2);
  const numero = nacional.slice(2);

  if (numero.length === 9) {
    return `+55 ${ddd} ${numero.slice(0, 5)}-${numero.slice(5)}`;
  }
  if (numero.length === 8) {
    return `+55 ${ddd} ${numero.slice(0, 4)}-${numero.slice(4)}`;
  }
  return e164;
}

/** Centavos para R$ 1.340,00. */
export function formatarReais(centavos: number) {
  return new Intl.NumberFormat("pt-BR", {
    style: "currency",
    currency: "BRL",
  }).format(centavos / 100);
}

/** "hoje", "ontem", "há 4 dias". */
export function tempoDesde(iso: string | null) {
  if (!iso) return null;

  const dias = Math.floor(
    (Date.now() - new Date(iso).getTime()) / (1000 * 60 * 60 * 24),
  );

  if (dias <= 0) return "hoje";
  if (dias === 1) return "ontem";
  return `há ${dias} dias`;
}
