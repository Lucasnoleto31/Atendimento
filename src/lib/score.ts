import { PASSOS_ATIVACAO } from "@/lib/ativacao-passos";

/**
 * Score de ativação: o quanto este cliente já andou até o primeiro giro —
 * que é a definição canônica de ativação e o que paga comissão.
 *
 * Não é "lead quente/frio". É progresso medido nos passos que existem no
 * checklist, com peso maior nos degraus que de fato travam a mesa: conta
 * aprovada e DEPÓSITO. Quem já operou está em 100 e sai da conta.
 *
 * Arquivo puro — o painel do chat lê daqui.
 */

/** Peso de cada passo. Soma 100 com todos feitos (grupo não ativa ninguém). */
export const PESO_PASSO: Record<string, number> = {
  link_abertura: 5,
  cadastro_iniciado: 10,
  conta_aprovada: 20,
  codigo_assessor: 10,
  stvm_custodia: 10,
  deposito: 25,
  plataforma: 5,
  primeira_operacao: 15,
  grupo: 0,
};

/** Parado mais que isso sem avançar um passo: o score começa a cair. */
export const DIAS_ATE_ESFRIAR = 7;
const DIA = 86_400_000;

export type FatosScore = {
  /** Passos do checklist marcados à mão (slugs). */
  passosFeitos: string[];
  /** Vem da Genial, não do checklist. */
  contaAbertaEm: string | null;
  primeiroLoteEm: string | null;
  /** Quando o último passo foi dado (checklist ou fato da Genial). */
  ultimoAvancoEm: string | null;
  status: string | null;
};

export type Fator = { rotulo: string; pontos: number };
export type Score = {
  total: number;
  faixa: "ativado" | "perto" | "andando" | "parado";
  fatores: Fator[];
  /** O passo pendente de maior peso — o que segura a ativação. */
  trava: string | null;
};

const ROTULO = new Map(PASSOS_ATIVACAO.map((p) => [p.passo, p.rotulo]));

export function calcularScore(f: FatosScore): Score {
  // Já operou: ativou. Não existe "quase" depois disso.
  if (f.primeiroLoteEm) {
    return {
      total: 100,
      faixa: "ativado",
      fatores: [{ rotulo: "Fez o primeiro giro", pontos: 100 }],
      trava: null,
    };
  }

  const feitos = new Set(f.passosFeitos);
  if (f.contaAbertaEm) feitos.add("conta_aprovada");

  const fatores: Fator[] = [];
  let total = 0;
  for (const passo of PASSOS_ATIVACAO) {
    const peso = PESO_PASSO[passo.passo] ?? 0;
    if (peso > 0 && feitos.has(passo.passo)) {
      total += peso;
      fatores.push({ rotulo: passo.rotulo, pontos: peso });
    }
  }

  // A trava é o PRÓXIMO passo pendente na ordem do roteiro, não o de maior
  // peso: para quem nem recebeu o link, dizer "falta o depósito" é verdade
  // inútil — o atendente precisa do passo que ele pode dar agora.
  const trava =
    PASSOS_ATIVACAO.find(
      (p) => !feitos.has(p.passo) && (PESO_PASSO[p.passo] ?? 0) > 0,
    )?.passo ?? null;

  // Parado é sintoma: quem não anda há semanas esfria, e o número tem que
  // contar isso — senão um cliente travado no depósito parece saudável.
  if (f.ultimoAvancoEm) {
    const dias = Math.floor((Date.now() - Date.parse(f.ultimoAvancoEm)) / DIA);
    if (Number.isFinite(dias) && dias > DIAS_ATE_ESFRIAR) {
      const perda = Math.min(
        20,
        Math.floor((dias - DIAS_ATE_ESFRIAR) / 7) * 5 + 5,
      );
      total -= perda;
      fatores.push({ rotulo: `Parado há ${dias} dias`, pontos: -perda });
    }
  }

  if (f.status === "perdido") {
    total -= 20;
    fatores.push({ rotulo: "Marcado como perdido", pontos: -20 });
  }

  const nota = Math.max(0, Math.min(100, total));
  return {
    total: nota,
    faixa: nota >= 60 ? "perto" : nota >= 25 ? "andando" : "parado",
    fatores,
    trava: trava ? (ROTULO.get(trava) ?? trava) : null,
  };
}
