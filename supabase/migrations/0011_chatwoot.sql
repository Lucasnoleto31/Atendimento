-- =============================================================================
-- Vínculo com o Chatwoot
-- =============================================================================
-- Guarda os ids do Chatwoot no lead: o contato (pessoa) e a conversa mais
-- recente — é por ela que o CRM envia mensagem e template na fase seguinte.
--
-- Script reexecutável.
-- =============================================================================

alter table leads add column if not exists chatwoot_contact_id bigint;
alter table leads add column if not exists chatwoot_conversation_id bigint;

create index if not exists leads_chatwoot_contact_idx
  on leads (chatwoot_contact_id)
  where chatwoot_contact_id is not null;
