-- =============================================================================
-- Canal do WhatsApp oficial
-- =============================================================================
-- Leads que chegam pelo webhook da Meta entram neste canal.
-- Script reexecutável.
-- =============================================================================

insert into channels (slug, nome)
values ('whatsapp', 'WhatsApp')
on conflict (slug) do nothing;
