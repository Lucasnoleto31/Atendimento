-- =============================================================================
-- Retenção: carteira, ciclo de vida do cliente e motor de reativação v2
-- =============================================================================
-- 1. customers ganha dono (carteira), status de ciclo de vida, segmento e
--    motivo de churn. customer_events registra cada episódio (auditável).
-- 2. gerar_leads_reativacao() REABRE o lead existente (antes ignorava todo
--    cliente convertido — o motor anti-churn não alcançava o público
--    principal), com cooldown por episódio, dono e tarefa de resgate.
-- 3. Kanban "Carteira" (Ativos → Esfriando → Em risco → Resgate).
-- 4. Cadência ganha âncoras de cliente (conta_aberta, sem_giro, queda_lotes)
--    e dedup por episódio. Receita por lote habilita LTV e receita em risco.
--
-- Script reexecutável.
-- =============================================================================

-- 1. Carteira e ciclo de vida ------------------------------------------------

alter table customers
  add column if not exists responsavel_id uuid references profiles (id) on delete set null,
  add column if not exists status text not null default 'ativo'
    check (status in ('ativo', 'em_risco', 'reativado', 'churn')),
  add column if not exists segmento text
    check (segmento in ('heavy', 'regular', 'ocasional', 'parado')),
  add column if not exists churned_em timestamptz,
  add column if not exists motivo_churn text;

comment on column customers.responsavel_id is
  'Dono da carteira: o assessor responsável por manter este cliente girando.';

-- Backfill do dono: herda do lead vinculado.
update customers c
set responsavel_id = l.responsavel_id
from leads l
where l.customer_id = c.id
  and c.responsavel_id is null
  and l.responsavel_id is not null;

create table if not exists customer_events (
  id          uuid primary key default gen_random_uuid(),
  customer_id uuid not null references customers (id) on delete cascade,
  tipo        text not null check (tipo in (
    'reativacao', 'retomou_giro', 'em_risco', 'churn', 'reativado'
  )),
  detalhes    jsonb not null default '{}'::jsonb,
  criado_em   timestamptz not null default now()
);

comment on table customer_events is
  'Episódios do ciclo de vida do cliente: cada detecção/resgate vira um registro.';

create index if not exists customer_events_cliente_idx
  on customer_events (customer_id, tipo, criado_em desc);

alter table customer_events enable row level security;
drop policy if exists leitura_equipe on customer_events;
create policy leitura_equipe on customer_events
  for select to authenticated using (true);

-- 2. Kanban Carteira -----------------------------------------------------------

insert into pipelines (nome, padrao)
select 'Carteira', false
where not exists (select 1 from pipelines where nome = 'Carteira');

insert into pipeline_stages (pipeline_id, nome, ordem, is_final)
select p.id, e.nome, e.ordem, false
from pipelines p
cross join (values
  ('Ativos', 1), ('Esfriando', 2), ('Em risco', 3), ('Resgate', 4)
) as e (nome, ordem)
where p.nome = 'Carteira'
  and not exists (
    select 1 from pipeline_stages s where s.pipeline_id = p.id
  );

-- 3. Parâmetros novos ----------------------------------------------------------

insert into settings (chave, valor, descricao) values
  ('dias_churn', '60'::jsonb,
   'Dias sem giro para considerar o cliente perdido (churn).'),
  ('receita_por_lote', '0'::jsonb,
   'Receita média da assessoria por lote girado, em reais (0 desliga).')
on conflict (chave) do nothing;

-- 4. Cadência: âncoras de cliente e dedup por episódio -------------------------

alter table followup_rules
  add column if not exists ancora text not null default 'lead_criado'
    check (ancora in ('lead_criado', 'conta_aberta', 'sem_giro', 'queda_lotes'));

comment on column followup_rules.ancora is
  'lead_criado: N dias após criar lead que nunca respondeu. conta_aberta: conta aberta há N dias sem 1º giro. sem_giro: N dias sem girar. queda_lotes: queda detectada há N dias.';

alter table followup_envios
  add column if not exists episodio date not null default '2000-01-01';

do $$
begin
  if exists (
    select 1 from pg_constraint
    where conname = 'followup_envios_pkey'
      and conrelid = 'followup_envios'::regclass
  ) and not exists (
    select 1
    from pg_constraint c
    join pg_attribute a on a.attrelid = c.conrelid and a.attnum = any (c.conkey)
    where c.conname = 'followup_envios_pkey' and a.attname = 'episodio'
  ) then
    alter table followup_envios drop constraint followup_envios_pkey;
    alter table followup_envios add primary key (lead_id, rule_id, episodio);
  end if;
end $$;

-- 5. Views de receita, carteira e retenção ------------------------------------

-- v_carteira depende de v_customer_receita: derruba a dependente primeiro
-- para o script seguir reexecutável.
drop view if exists v_carteira;

drop view if exists v_customer_receita;
create view v_customer_receita as
select
  g.customer_id,
  round(g.lotes_30d * t.taxa * 100)::bigint          as receita_30d_centavos,
  round(g.lotes_30d_anterior * t.taxa * 100)::bigint as receita_30d_anterior_centavos,
  round(coalesce(tot.lotes_total, 0) * t.taxa * 100)::bigint as ltv_centavos
from v_customer_giro g
cross join (
  select coalesce((select (valor #>> '{}')::numeric from settings
                   where chave = 'receita_por_lote'), 0) as taxa
) t
left join (
  select l.customer_id, sum(l.quantidade) as lotes_total
  from customer_lots l
  group by l.customer_id
) tot on tot.customer_id = g.customer_id;

alter view v_customer_receita set (security_invoker = true);

create view v_carteira as
select
  c.id                                   as customer_id,
  c.nome_completo,
  c.status,
  c.segmento,
  c.conta_aberta_em,
  c.churned_em,
  c.motivo_churn,
  c.responsavel_id,
  p.nome                                 as responsavel_nome,
  g.lotes_30d,
  g.lotes_30d_anterior,
  g.ultimo_giro_em,
  case
    when g.ultimo_giro_em is null then null
    else (current_date - g.ultimo_giro_em)
  end                                    as dias_sem_giro,
  r.receita_30d_centavos,
  r.ltv_centavos,
  l.id                                   as lead_id,
  l.telefone_e164,
  l.ultima_interacao_em,
  case
    when l.ultima_interacao_em is null then null
    else extract(day from now() - l.ultima_interacao_em)::integer
  end                                    as dias_sem_contato
from customers c
left join v_customer_giro g on g.customer_id = c.id
left join v_customer_receita r on r.customer_id = c.id
left join profiles p on p.id = c.responsavel_id
left join lateral (
  select l.id, l.telefone_e164, l.ultima_interacao_em
  from leads l
  where l.customer_id = c.id
  order by l.criado_em desc
  limit 1
) l on true
where c.ativo;

alter view v_carteira set (security_invoker = true);

drop view if exists v_customer_giro_mensal;
create view v_customer_giro_mensal as
select
  l.customer_id,
  date_trunc('month', l.referencia_data)::date as mes,
  sum(l.quantidade)                            as lotes,
  count(distinct l.referencia_data)            as dias_girados
from customer_lots l
group by l.customer_id, date_trunc('month', l.referencia_data);

alter view v_customer_giro_mensal set (security_invoker = true);

drop view if exists v_retencao_mensal;
create view v_retencao_mensal as
select
  date_trunc('month', criado_em)::date                       as mes,
  count(*) filter (where tipo = 'churn')                     as churns,
  count(*) filter (where tipo = 'reativacao')                as reativacoes,
  count(*) filter (where tipo = 'retomou_giro')              as resgates
from customer_events
group by date_trunc('month', criado_em);

alter view v_retencao_mensal set (security_invoker = true);

-- 6. Ciclo de vida: status e segmento recalculados após cada upload ------------

create or replace function atualizar_ciclo_vida()
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  limite_churn integer;
begin
  select (valor #>> '{}')::integer into limite_churn
    from settings where chave = 'dias_churn';
  limite_churn := coalesce(limite_churn, 60);

  -- Segmento pela frequência de giro nos últimos 30 dias.
  update customers c
  set segmento = coalesce(f.faixa, 'parado')
  from (
    select c2.id as customer_id,
      case
        when count(distinct l.referencia_data) >= 15 then 'heavy'
        when count(distinct l.referencia_data) >= 5  then 'regular'
        when count(distinct l.referencia_data) >= 1  then 'ocasional'
        else 'parado'
      end as faixa
    from customers c2
    left join customer_lots l
      on l.customer_id = c2.id
     and l.referencia_data >= current_date - 30
     and l.quantidade > 0
    group by c2.id
  ) f
  where f.customer_id = c.id
    and c.segmento is distinct from f.faixa;

  -- Churn: sem giro há mais que o limite (ou nunca girou com conta antiga).
  with novos_churns as (
    update customers c
    set status = 'churn', churned_em = now()
    from v_customer_giro g
    where g.customer_id = c.id
      and c.ativo
      and c.status <> 'churn'
      and (
        (g.ultimo_giro_em is not null
          and g.ultimo_giro_em < current_date - limite_churn)
        or (g.ultimo_giro_em is null
          and coalesce(c.conta_aberta_em, current_date) < current_date - limite_churn)
      )
    returning c.id
  )
  insert into customer_events (customer_id, tipo, detalhes)
  select id, 'churn', jsonb_build_object('limite_dias', limite_churn)
  from novos_churns;

  -- Voltou a girar: churn/em_risco com giro nos últimos 7 dias.
  with retomados as (
    update customers c
    set status = case when c.status = 'churn' then 'reativado' else 'ativo' end,
        churned_em = null,
        motivo_churn = null
    where c.status in ('churn', 'em_risco', 'reativado')
      and exists (
        select 1 from customer_lots l
        where l.customer_id = c.id
          and l.referencia_data >= current_date - 7
          and l.quantidade > 0
      )
    returning c.id, c.status
  )
  insert into customer_events (customer_id, tipo, detalhes)
  select distinct id, 'retomou_giro', '{}'::jsonb
  from retomados
  where not exists (
    select 1 from customer_events e
    where e.customer_id = retomados.id
      and e.tipo = 'retomou_giro'
      and e.criado_em > now() - interval '7 days'
  );
end;
$$;

-- 7. Motor de reativação v2: reabre o lead do cliente convertido ---------------

create or replace function gerar_leads_reativacao()
returns table (criados integer, motivo lead_entry_reason)
language plpgsql
security definer
set search_path = public
as $$
declare
  limite_queda  numeric;
  limite_dias   integer;
  etapa_resgate uuid;
  etapa_padrao  uuid;
  canal_interno uuid;
  qtd_queda     integer := 0;
  qtd_sem_giro  integer := 0;
  cand          record;
  lead_alvo     record;
  motivo_atual  lead_entry_reason;
begin
  -- Ciclo de vida primeiro: status/segmento frescos antes de decidir.
  perform atualizar_ciclo_vida();

  select (valor #>> '{}')::numeric into limite_queda
    from settings where chave = 'queda_lotes_percentual';
  select (valor #>> '{}')::integer into limite_dias
    from settings where chave = 'dias_sem_giro';
  limite_queda := coalesce(limite_queda, 25);
  limite_dias  := coalesce(limite_dias, 30);

  select s.id into etapa_resgate
  from pipeline_stages s
  join pipelines p on p.id = s.pipeline_id
  where p.nome = 'Carteira' and s.nome = 'Resgate'
  limit 1;

  select s.id into etapa_padrao
  from pipeline_stages s
  join pipelines p on p.id = s.pipeline_id
  order by p.padrao desc, s.ordem
  limit 1;

  etapa_resgate := coalesce(etapa_resgate, etapa_padrao);
  select id into canal_interno from channels where slug = 'lista_interna';

  for cand in
    select
      g.customer_id, g.nome_completo, g.telefone_e164,
      c.responsavel_id as dono,
      case
        when g.lotes_30d_anterior > 0
         and g.lotes_30d < g.lotes_30d_anterior * (1 - limite_queda / 100.0)
          then 'queda_lotes'
        else 'sem_giro'
      end as motivo_texto
    from v_customer_giro g
    join customers c on c.id = g.customer_id
    where c.ativo
      and (
        (g.lotes_30d_anterior > 0
          and g.lotes_30d < g.lotes_30d_anterior * (1 - limite_queda / 100.0))
        -- Nunca girou: só depois da carência — cliente recém-importado não é
        -- "sem giro", é onboarding (âncora conta_aberta da cadência).
        or (g.ultimo_giro_em is null
          and coalesce(c.conta_aberta_em, current_date) < current_date - limite_dias)
        or g.ultimo_giro_em < current_date - limite_dias
      )
      -- Cooldown por episódio: um disparo por cliente por janela.
      and not exists (
        select 1 from customer_events e
        where e.customer_id = g.customer_id
          and e.tipo = 'reativacao'
          and e.criado_em > now() - (limite_dias || ' days')::interval
      )
      -- Episódio ainda aberto (tarefa de resgate pendente): não redispara.
      and not exists (
        select 1
        from lead_tasks t
        join leads lt on lt.id = t.lead_id
        where lt.customer_id = g.customer_id
          and t.concluida_em is null
          and t.titulo like 'Resgatar:%'
      )
  loop
    motivo_atual := cand.motivo_texto::lead_entry_reason;

    select l.id, l.responsavel_id into lead_alvo
    from leads l
    where l.customer_id = cand.customer_id
       or (cand.telefone_e164 is not null
           and l.telefone_e164 = cand.telefone_e164)
    order by l.criado_em desc
    limit 1;

    if lead_alvo.id is not null then
      -- Reabre o lead existente na etapa de Resgate, com dono garantido.
      update leads
      set stage_id = etapa_resgate,
          entrou_na_etapa_em = now(),
          entrada_motivo = motivo_atual,
          responsavel_id = coalesce(leads.responsavel_id, cand.dono),
          status = case when status = 'ganho' then status
                        else 'em_atendimento' end,
          customer_id = coalesce(leads.customer_id, cand.customer_id),
          cliente_confirmado_em = coalesce(cliente_confirmado_em, now())
      where id = lead_alvo.id;
    else
      insert into leads (
        nome, telefone_e164, customer_id, cliente_confirmado_em,
        channel_id, stage_id, status, entrada_motivo, responsavel_id
      ) values (
        cand.nome_completo, cand.telefone_e164, cand.customer_id, now(),
        canal_interno, etapa_resgate, 'novo', motivo_atual, cand.dono
      )
      returning id, responsavel_id into lead_alvo;
    end if;

    -- Cliente marcado em risco (sem sobrescrever churn) + episódio + tarefa.
    update customers
    set status = 'em_risco'
    where id = cand.customer_id and status = 'ativo';

    insert into customer_events (customer_id, tipo, detalhes)
    values (
      cand.customer_id, 'reativacao',
      jsonb_build_object('motivo', cand.motivo_texto, 'lead_id', lead_alvo.id)
    );

    insert into lead_tasks (lead_id, titulo, vence_em, responsavel_id)
    values (
      lead_alvo.id,
      case when cand.motivo_texto = 'queda_lotes'
        then 'Resgatar: queda forte de lotes'
        else 'Resgatar: cliente sem giro' end,
      now() + interval '1 day',
      coalesce(lead_alvo.responsavel_id, cand.dono)
    );

    if cand.motivo_texto = 'queda_lotes' then
      qtd_queda := qtd_queda + 1;
    else
      qtd_sem_giro := qtd_sem_giro + 1;
    end if;
  end loop;

  return query
    select qtd_queda, 'queda_lotes'::lead_entry_reason
    union all
    select qtd_sem_giro, 'sem_giro'::lead_entry_reason;
end;
$$;

-- Função interna: só o motor chama (mesmo padrão de mesclar_clientes, 0004).
revoke execute on function atualizar_ciclo_vida() from public, anon, authenticated;
