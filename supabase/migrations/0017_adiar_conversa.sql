-- =============================================================================
-- Adiar conversa até a próxima resposta
-- =============================================================================
-- A conversa adiada sai da caixa de entrada e volta sozinha quando o lead
-- manda a próxima mensagem: os webhooks limpam a marca ao receber. Serve para
-- "já respondi, agora é com ele" sem perder o atendimento de vista.
--
-- Script reexecutável.
-- =============================================================================

alter table leads add column if not exists chat_adiado_em timestamptz;

comment on column leads.chat_adiado_em is
  'Marcado ao adiar a conversa; o webhook de mensagem recebida zera e ela volta à caixa de entrada.';

create index if not exists leads_chat_adiado_idx
  on leads (chat_adiado_em)
  where chat_adiado_em is not null;
