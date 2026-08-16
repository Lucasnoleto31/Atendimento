-- =============================================================================
-- Tempo real e mensagens agendadas
-- =============================================================================
-- 1. Publication do Realtime: o navegador assina INSERTs de lead_interactions
--    e o chat atualiza na hora, sem esperar o polling.
-- 2. scheduled_messages: "enviar amanhã às 9h" — o heartbeat processa.
--
-- Script reexecutável.
-- =============================================================================

do $$
begin
  if not exists (
    select 1 from pg_publication_tables
    where pubname = 'supabase_realtime' and tablename = 'lead_interactions'
  ) then
    alter publication supabase_realtime add table lead_interactions;
  end if;
end $$;

create table if not exists scheduled_messages (
  id         uuid primary key default gen_random_uuid(),
  lead_id    uuid not null references leads (id) on delete cascade,
  texto      text not null,
  enviar_em  timestamptz not null,
  autor_id   uuid references profiles (id) on delete set null,
  enviado_em timestamptz,
  erro       text,
  criado_em  timestamptz not null default now()
);

comment on table scheduled_messages is
  'Mensagens de texto agendadas pelo compositor do chat. enviado_em nulo = pendente.';

create index if not exists scheduled_messages_pendentes_idx
  on scheduled_messages (enviar_em)
  where enviado_em is null;

alter table scheduled_messages enable row level security;

drop policy if exists leitura_equipe on scheduled_messages;
create policy leitura_equipe on scheduled_messages
  for select to authenticated using (true);

drop policy if exists escrita_equipe on scheduled_messages;
create policy escrita_equipe on scheduled_messages
  for all to authenticated using (true) with check (true);
