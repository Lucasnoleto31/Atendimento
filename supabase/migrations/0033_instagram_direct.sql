-- =============================================================================
-- Direct do Instagram como canal do CRM
-- =============================================================================
-- O Direct do perfil do Fabricio recebe volume de lead e nada disso era
-- medido: a Karen responde pelo app, como se fosse ele, e o CRM não via nem a
-- conversa nem o trabalho dela.
--
-- Conectado, o Direct vira mais um canal do Chat: a mensagem sai pelo perfil
-- do Fabricio, mas o CRM registra QUEM respondeu (autor_id) — que é o dado
-- que faltava.
--
-- Identidade: lead do Instagram NÃO TEM TELEFONE. Ele é identificado pelo
-- Instagram-scoped ID (IGSID), que é único por perfil de negócio. Por isso
-- telefone deixou de ser obrigatório lá atrás (0004) e aqui ganha um par.
--
-- Script reexecutável.
-- =============================================================================

alter table leads
  add column if not exists instagram_id text,
  add column if not exists instagram_usuario text;

comment on column leads.instagram_id is
  'Instagram-scoped ID (IGSID) do usuário — identidade do lead que veio pelo Direct.';
comment on column leads.instagram_usuario is
  '@ do perfil, para a equipe reconhecer quem é.';

-- Único quando preenchido: dois leads não podem ser o mesmo perfil do Direct.
drop index if exists leads_instagram_unq;
create unique index leads_instagram_unq
  on leads (instagram_id)
  where instagram_id is not null;

insert into channels (slug, nome, ativo)
values ('instagram', 'Instagram', true)
on conflict (slug) do nothing;

-- O motivo de entrada é enum: precisa existir antes de o app usar. ALTER TYPE
-- exige transação própria — se o editor reclamar, rode esta linha sozinha.
alter type lead_entry_reason add value if not exists 'webhook_instagram';
