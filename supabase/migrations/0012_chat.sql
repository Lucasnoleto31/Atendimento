-- =============================================================================
-- Página de Chat
-- =============================================================================
-- Marca de leitura da conversa: atividade posterior a chat_lido_em acende o
-- indicador de não lida na lista. Compartilhada pela equipe (mesa colaborativa).
--
-- Script reexecutável.
-- =============================================================================

alter table leads add column if not exists chat_lido_em timestamptz;
