-- =============================================================================
-- Múltiplos kanbans
-- =============================================================================
-- As etapas deixam de ser uma lista global e passam a pertencer a um kanban
-- (pipeline). O kanban marcado como padrão é o que recebe os leads de
-- reativação e abre primeiro no Atendimento.
--
-- Script reexecutável.
-- =============================================================================

create table if not exists pipelines (
  id         uuid primary key default gen_random_uuid(),
  nome       text not null unique,
  padrao     boolean not null default false,
  criado_em  timestamptz not null default now()
);

-- No máximo um kanban padrão.
create unique index if not exists pipelines_padrao_unq
  on pipelines (padrao) where padrao;

-- Kanban inicial recebe as etapas que já existem.
insert into pipelines (nome, padrao)
select 'Atendimento', true
where not exists (select 1 from pipelines);

alter table pipeline_stages
  add column if not exists pipeline_id uuid references pipelines (id) on delete cascade;

update pipeline_stages
set pipeline_id = (select id from pipelines where padrao limit 1)
where pipeline_id is null;

alter table pipeline_stages alter column pipeline_id set not null;

-- A ordem passa a ser única por kanban, não global.
do $$
declare
  r record;
begin
  for r in
    select con.conname
    from pg_constraint con
    join pg_class rel on rel.oid = con.conrelid
    where rel.relname = 'pipeline_stages'
      and con.contype = 'u'
  loop
    execute format('alter table pipeline_stages drop constraint %I', r.conname);
  end loop;
end;
$$;

create unique index if not exists pipeline_stages_ordem_unq
  on pipeline_stages (pipeline_id, ordem);

-- RLS
alter table pipelines enable row level security;

drop policy if exists leitura_equipe on pipelines;
create policy leitura_equipe on pipelines
  for select to authenticated using (true);

drop policy if exists gestao on pipelines;
create policy gestao on pipelines
  for all to authenticated using (sou_gestor()) with check (sou_gestor());

-- Reativação usa a primeira etapa do kanban padrão.
create or replace function gerar_leads_reativacao()
returns table (criados integer, motivo lead_entry_reason)
language plpgsql
security definer
set search_path = public
as $$
declare
  limite_queda numeric;
  limite_dias  integer;
  etapa_novos  uuid;
  canal_interno uuid;
  qtd_queda    integer := 0;
  qtd_sem_giro integer := 0;
begin
  select (valor #>> '{}')::numeric into limite_queda
    from settings where chave = 'queda_lotes_percentual';
  select (valor #>> '{}')::integer into limite_dias
    from settings where chave = 'dias_sem_giro';

  limite_queda := coalesce(limite_queda, 25);
  limite_dias  := coalesce(limite_dias, 30);

  select s.id into etapa_novos
  from pipeline_stages s
  join pipelines p on p.id = s.pipeline_id
  order by p.padrao desc, s.ordem
  limit 1;

  select id into canal_interno from channels where slug = 'lista_interna';

  -- (a) queda de lotes
  with candidatos as (
    select g.customer_id, g.nome_completo, g.telefone_e164
    from v_customer_giro g
    where g.lotes_30d_anterior > 0
      and g.lotes_30d < g.lotes_30d_anterior * (1 - limite_queda / 100.0)
      and not exists (
        select 1 from leads l
        where l.customer_id = g.customer_id
           or (g.telefone_e164 is not null and l.telefone_e164 = g.telefone_e164)
      )
  ), inseridos as (
    insert into leads (
      nome, telefone_e164, customer_id, cliente_confirmado_em,
      channel_id, stage_id, status, entrada_motivo
    )
    select
      c.nome_completo, c.telefone_e164, c.customer_id, now(),
      canal_interno, etapa_novos, 'novo', 'queda_lotes'
    from candidatos c
    returning 1
  )
  select count(*) into qtd_queda from inseridos;

  -- (b) sem giro há N dias (inclui quem nunca girou)
  with candidatos as (
    select g.customer_id, g.nome_completo, g.telefone_e164
    from v_customer_giro g
    where (
      g.ultimo_giro_em is null
      or g.ultimo_giro_em < current_date - (limite_dias || ' days')::interval
    )
    and not exists (
      select 1 from leads l
      where l.customer_id = g.customer_id
         or (g.telefone_e164 is not null and l.telefone_e164 = g.telefone_e164)
    )
  ), inseridos as (
    insert into leads (
      nome, telefone_e164, customer_id, cliente_confirmado_em,
      channel_id, stage_id, status, entrada_motivo
    )
    select
      c.nome_completo, c.telefone_e164, c.customer_id, now(),
      canal_interno, etapa_novos, 'novo', 'sem_giro'
    from candidatos c
    returning 1
  )
  select count(*) into qtd_sem_giro from inseridos;

  return query
    select qtd_queda, 'queda_lotes'::lead_entry_reason
    union all
    select qtd_sem_giro, 'sem_giro'::lead_entry_reason;
end;
$$;
