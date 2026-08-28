-- =============================================================================
-- Resolver conversa: sai da caixa de entrada
-- =============================================================================
-- Marcar como resolvida tira a conversa da fila para a equipe ver só o que
-- falta atender. Se o cliente escrever de novo, os webhooks limpam a marca e
-- ela volta — ninguém precisa lembrar de reabrir.
--
-- Guardamos local (e não só no Chatwoot) porque o canal agora é a Meta, que
-- não tem conceito de conversa resolvida.
--
-- Script reexecutável.
-- =============================================================================

alter table leads add column if not exists chat_resolvido_em timestamptz;

comment on column leads.chat_resolvido_em is
  'Marcado ao resolver a conversa; o webhook de mensagem recebida zera e ela volta à caixa de entrada.';

create index if not exists leads_chat_resolvido_idx
  on leads (chat_resolvido_em)
  where chat_resolvido_em is not null;
