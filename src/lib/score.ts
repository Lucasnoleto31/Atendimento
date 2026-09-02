/**
 * Score do lead: um número de 0 a 100 para ORDENAR a fila — nunca para
 * descartar ninguém. Arquivo puro; o painel do chat lê daqui.
 *
 * Cada fator é um fato que já existe no banco. Nada de "engajamento"
 * inventado: se não dá para apontar a linha que gerou o ponto, o ponto não
 * entra.
 */
export type FatosScore = {
  criadoEm: string;
  /** Quando o lead respondeu pela primeira vez (null = nunca falou). */
  primeiraRespostaEm: string | null;
  /** Já é cliente da corretora. */
  ehCliente: boolean;
  contaAbertaEm: string | null;
  primeiroLoteEm: string | null;
  /** Passos do checklist de abertura já marcados. */
  passosAtivacao: number;
  /** Templates pagos disparados para ele. */
  templatesEnviados: number;
  status: string | null;
};

export type Fator = { rotulo: string; pontos: number };
export type Score = {
  total: number;
  faixa: "quente" | "morno" | "frio";
  fatores: Fator[];
};

const DIA = 86_400_000;

export function calcularScore(f: FatosScore): Score {
  const fatores: Fator[] = [];

  if (f.primeiraRespostaEm) {
    const demora = Date.parse(f.primeiraRespostaEm) - Date.parse(f.criadoEm);
    if (Number.isFinite(demora) && demora <= DIA) {
      fatores.push({ rotulo: "Respondeu no mesmo dia", pontos: 30 });
    } else {
      fatores.push({ rotulo: "Respondeu à abordagem", pontos: 20 });
    }
  } else {
    // Sem nenhuma tentativa nossa, "nunca respondeu" seria injusto: o
    // silêncio é da mesa, não do lead.
    fatores.push({
      rotulo:
        f.templatesEnviados > 0 || f.passosAtivacao > 0
          ? "Nunca respondeu"
          : "Ainda não foi abordado",
      pontos: f.templatesEnviados > 0 || f.passosAtivacao > 0 ? -15 : 0,
    });
  }

  if (f.primeiroLoteEm) {
    fatores.push({ rotulo: "Já operou (1º lote)", pontos: 25 });
  } else if (f.contaAbertaEm) {
    fatores.push({ rotulo: "Conta aberta na Genial", pontos: 20 });
  } else if (f.ehCliente) {
    fatores.push({ rotulo: "Já está na carteira", pontos: 10 });
  }

  if (f.passosAtivacao > 0) {
    fatores.push({
      rotulo: `Abertura em andamento (${f.passosAtivacao} passo${f.passosAtivacao > 1 ? "s" : ""})`,
      pontos: Math.min(20, f.passosAtivacao * 5),
    });
  }

  // Template é dinheiro: muitos sem resposta é sinal de desgaste, não de calor.
  if (!f.primeiraRespostaEm && f.templatesEnviados >= 2) {
    fatores.push({
      rotulo: `${f.templatesEnviados} templates sem resposta`,
      pontos: -10,
    });
  }

  const idadeDias = (Date.now() - Date.parse(f.criadoEm)) / DIA;
  if (!f.primeiraRespostaEm && idadeDias > 30) {
    fatores.push({ rotulo: "Parado há mais de 30 dias", pontos: -10 });
  }

  if (f.status === "perdido") {
    fatores.push({ rotulo: "Marcado como perdido", pontos: -20 });
  }

  const bruto = fatores.reduce((t, x) => t + x.pontos, 50);
  const total = Math.max(0, Math.min(100, bruto));
  return {
    total,
    faixa: total >= 70 ? "quente" : total >= 40 ? "morno" : "frio",
    fatores,
  };
}
