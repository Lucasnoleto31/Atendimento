-- =============================================================================
-- Reativação automática
-- =============================================================================
-- Devolve para a fila de atendimento o cliente que:
--   a) caiu mais de X% em lotes nos últimos 30 dias contra os 30 anteriores; ou
--   b) está há mais de N dias sem girar.
-- X e N vêm de settings (queda_lotes_percentual, dias_sem_giro), então dá para
-- mudar a régua sem tocar em código.
--
-- Não cria lead duplicado: se já existe lead com aquele telefone, ignora.
-- =============================================================================

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
      and not exists (select 1 from leads l where l.telefone_e164 = g.telefone_e164)
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
    and not exists (select 1 from leads l where l.telefone_e164 = g.telefone_e164)
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

comment on function gerar_leads_reativacao is
  'Roda após o upload diário de lotes. Idempotente: não duplica lead existente.';

revoke execute on function gerar_leads_reativacao() from public, anon;
grant execute on function gerar_leads_reativacao() to authenticated;
