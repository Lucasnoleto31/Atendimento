export type LeadStatus =
  | "novo"
  | "em_atendimento"
  | "sem_resposta"
  | "ganho"
  | "perdido";

export type Stage = {
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
  /** Parado na etapa há mais de 7 dias — calculado no servidor. */
  atrasado?: boolean;
};

export const ROTULO_STATUS: Record<LeadStatus, string> = {
  novo: "Novo",
  em_atendimento: "Em atendimento",
  sem_resposta: "Sem resposta",
  ganho: "Ganho",
  perdido: "Perdido",
};
