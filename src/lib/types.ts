export type LeadStatus =
  | "novo"
  | "em_atendimento"
  | "sem_resposta"
  | "ganho"
  | "perdido";

export type Stage = {
  /** Prazo esperado em dias nesta etapa (0051). Nulo = 7. */
  prazo_dias?: number | null;
  id: string;
  nome: string;
  ordem: number;
  is_final: boolean;
};

export type LeadCard = {
  id: string;
  nome: string;
  telefone_e164: string | null;
  customer_id: string | null;
  campanha: string | null;
  stage_id: string | null;
  status: LeadStatus;
  entrou_na_etapa_em: string;
  primeira_resposta_em: string | null;
  canal: string | null;
  responsavel: string | null;
  /** Semáforo do prazo da etapa: verde no prazo, laranja estourou, vermelho estourou o dobro. */
  semaforo?: "verde" | "laranja" | "vermelho";
  /** Conversa com mensagem não lida — vem da varredura da página. */
  naoLida?: boolean;
  /** Próxima tarefa pendente do lead (uma consulta para o quadro inteiro). */
  proximaAcao?: { titulo: string; quando: string; vencida: boolean } | null;
  etiquetas?: { id: string; nome: string; cor?: string | null }[];
};

export const ROTULO_STATUS: Record<LeadStatus, string> = {
  novo: "Novo",
  em_atendimento: "Em atendimento",
  sem_resposta: "Sem resposta",
  ganho: "Ganho",
  perdido: "Perdido",
};
