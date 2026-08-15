-- =============================================================================
-- Leads sem telefone + mescla de clientes duplicados
-- =============================================================================
-- A base real da corretora veio sem telefone utilizável. Um lead de reativação
-- criado a partir dela também nasce sem telefone — a tabela precisa aceitar
-- isso (telefone segue único quando existe). E clientes com várias contas que
-- entraram pelos lotes antes da base viram registros duplicados; a função de
-- mescla junta tudo no registro certo.
--
-- Script reexecutável.
-- =============================================================================

-- 1. Telefone do lead opcional, único quando preenchido -----------------------

alter table leads alter column telefone_e164 drop not null;

do $$
declare
  r record;
begin
  for r in
    select con.conname
    from pg_constraint con
    join pg_class rel on rel.oid = con.conrelid
    join pg_attribute att
      on att.attrelid = rel.oid and att.attnum = any (con.conkey)
    where rel.relname = 'leads'
      and con.contype = 'u'
      and att.attname = 'telefone_e164'
  loop
    execute format('alter table leads drop constraint %I', r.conname);
  end loop;
end;
$$;

drop index if exists leads_telefone_unq;
create unique index leads_telefone_unq
  on leads (telefone_e164)
  where telefone_e164 is not null;

-- 2. Reativação tolerante a telefone nulo ------------------------------------
-- Dedup por cliente (customer_id) além do telefone: cliente sem telefone não
-- pode ganhar dois leads.

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

  select id into etapa_novos from pipeline_stages order by ordem limit 1;
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

-- 3. Mescla de clientes duplicados -------------------------------------------
-- Junta "remover" dentro de "manter": contas, lotes (somando dias repetidos),
-- leads e vendas passam para o registro mantido; dados faltantes são
-- completados; o duplicado é apagado.

create or replace function mesclar_clientes(manter uuid, remover uuid)
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  if manter = remover or manter is null or remover is null then
    return;
  end if;

  update customer_accounts set customer_id = manter where customer_id = remover;

  -- Dias que existem nos dois: soma no mantido e apaga do removido.
  update customer_lots l
  set quantidade = l.quantidade + d.quantidade
  from customer_lots d
  where l.customer_id = manter
    and d.customer_id = remover
    and d.referencia_data = l.referencia_data;

  delete from customer_lots d
  using customer_lots l
  where d.customer_id = remover
    and l.customer_id = manter
    and l.referencia_data = d.referencia_data;

  update customer_lots set customer_id = manter where customer_id = remover;
  update leads set customer_id = manter where customer_id = remover;
  update sales set customer_id = manter where customer_id = remover;

  update customers k
  set telefone_e164   = coalesce(k.telefone_e164, r.telefone_e164),
      documento       = coalesce(k.documento, r.documento),
      email           = coalesce(k.email, r.email),
      conta_aberta_em = least(
        coalesce(k.conta_aberta_em, r.conta_aberta_em),
        coalesce(r.conta_aberta_em, k.conta_aberta_em)
      )
  from customers r
  where k.id = manter and r.id = remover;

  delete from customers where id = remover;
end;
$$;

revoke execute on function mesclar_clientes(uuid, uuid) from public, anon, authenticated;
