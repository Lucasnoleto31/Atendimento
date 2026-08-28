-- =============================================================================
-- Hoje, fase 1: ativações registradas no dia, numa chamada só
-- =============================================================================
-- "Ativação registrada hoje" = cliente cujo PRIMEIRO lote da vida entrou na
-- importação de hoje. A página calculava em três idas (lotes de hoje → quais
-- já tinham lote antes → quantos são da pessoa) e a cadeia DOBROU o tempo de
-- carga medido da /hoje (500ms → 1.063ms). Aqui o banco resolve numa viagem.
--
-- Script reexecutável.
-- =============================================================================

create or replace function ativacoes_registradas(
  p_responsavel uuid,
  p_inicio timestamptz
)
returns integer
language sql
stable
security definer
set search_path = public
as $$
  with novos as (
    select distinct l.customer_id
    from customer_lots l
    where l.criado_em >= p_inicio
      and not exists (
        select 1 from customer_lots a
        where a.customer_id = l.customer_id
          and a.criado_em < p_inicio
      )
  )
  select count(*)::int
  from customers c
  join novos n on n.customer_id = c.id
  where c.responsavel_id = p_responsavel
$$;

revoke execute on function ativacoes_registradas(uuid, timestamptz) from public, anon;
grant execute on function ativacoes_registradas(uuid, timestamptz) to authenticated;

-- A busca por "lotes criados hoje" ganha índice próprio (a tabela só tinha
-- índice por cliente+data de referência).
create index if not exists customer_lots_criado_idx
  on customer_lots (criado_em desc);
