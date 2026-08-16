-- =============================================================================
-- Engajamento: cadência de follow-up, tarefas de lead e meta diária de contato
-- =============================================================================
-- 1. followup_rules: "N dias depois de criado, lead que nunca respondeu recebe
--    o template X". O motor roda no servidor e deduplica por followup_envios.
-- 2. lead_tasks: lembretes ("ligar amanhã às 10h") visíveis no chat.
-- 3. profiles.meta_contatos_dia: meta de atividade por vendedor (Relatórios).
--
-- Script reexecutável.
-- =============================================================================

create table if not exists followup_rules (
  id              uuid primary key default gen_random_uuid(),
  dias            smallint not null check (dias > 0),
  template_nome   text not null,
  template_idioma text not null default 'pt_BR',
  ativo           boolean not null default true,
  criado_em       timestamptz not null default now()
);

comment on table followup_rules is
  'Cadência: template disparado N dias após a criação de lead que nunca respondeu.';

create table if not exists followup_envios (
  lead_id    uuid not null references leads (id) on delete cascade,
  rule_id    uuid not null references followup_rules (id) on delete cascade,
  enviado_em timestamptz not null default now(),
  primary key (lead_id, rule_id)
);

create table if not exists lead_tasks (
  id             uuid primary key default gen_random_uuid(),
  lead_id        uuid not null references leads (id) on delete cascade,
  titulo         text not null,
  vence_em       timestamptz not null,
  concluida_em   timestamptz,
  autor_id       uuid references profiles (id) on delete set null,
  responsavel_id uuid references profiles (id) on delete set null,
  criado_em      timestamptz not null default now()
);

create index if not exists lead_tasks_pendentes_idx
  on lead_tasks (vence_em)
  where concluida_em is null;

alter table profiles
  add column if not exists meta_contatos_dia smallint not null default 0;

-- RLS -------------------------------------------------------------------------

alter table followup_rules  enable row level security;
alter table followup_envios enable row level security;
alter table lead_tasks      enable row level security;

drop policy if exists leitura_equipe on followup_rules;
create policy leitura_equipe on followup_rules
  for select to authenticated using (true);

drop policy if exists gestao on followup_rules;
create policy gestao on followup_rules
  for all to authenticated using (sou_gestor()) with check (sou_gestor());

-- Envios são gravados só pelo motor (service role); equipe apenas lê.
drop policy if exists leitura_equipe on followup_envios;
create policy leitura_equipe on followup_envios
  for select to authenticated using (true);

drop policy if exists leitura_equipe on lead_tasks;
create policy leitura_equipe on lead_tasks
  for select to authenticated using (true);

drop policy if exists escrita_equipe on lead_tasks;
create policy escrita_equipe on lead_tasks
  for all to authenticated using (true) with check (true);
