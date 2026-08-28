-- =============================================================================
-- Fase 5 (bloco B): funil de abertura→ativação→compra e metas por pessoa
-- =============================================================================
-- Uma função, um round-trip, três blocos de Pagamentos:
--
--   funil       — contas abertas no período → ativadas (1º giro, pelo dia
--                 REAL da operação: referencia_data do primeiro lote, a
--                 régua canônica da Fase 2) → compraram produto.
--   por_pessoa  — contas e ativações do MÊS CORRENTE (meta é mensal, não
--                 acompanha o seletor de período) + tempo médio entre
--                 abertura e ativação (histórico completo da pessoa).
--   historico   — últimos 3 meses por pessoa: comissão, contas, ativações.
--
-- SECURITY INVOKER de propósito: roda com o RLS de quem chama — as tabelas
-- envolvidas já são legíveis pela equipe, e a função não abre nada além.
--
-- Script reexecutável.
-- =============================================================================

create or replace function pagamentos_resumo(p_inicio timestamptz default null)
returns jsonb
language sql
stable
set search_path = public
as $$
with primeiro as (
  select customer_id, min(referencia_data) as primeiro_em
  from customer_lots
  group by customer_id
),
mes_atual as (
  select date_trunc('month', now() at time zone 'America/Sao_Paulo')::date as inicio
),
pessoas as (
  select id, nome from profiles where ativo
)
select jsonb_build_object(
  'funil', jsonb_build_object(
    'contas', (
      select count(*) from customers c
      where c.conta_aberta_em is not null
        and (p_inicio is null or c.conta_aberta_em >= p_inicio::date)
    ),
    'ativadas', (
      select count(*) from primeiro p
      where (p_inicio is null or p.primeiro_em >= p_inicio::date)
    ),
    'compraram', (
      select count(distinct s.customer_id) from sales s
      where s.status = 'confirmada'
        and s.customer_id is not null
        and (p_inicio is null or s.ocorreu_em >= p_inicio)
    )
  ),

  'por_pessoa', (
    select coalesce(jsonb_agg(jsonb_build_object(
      'id', pe.id,
      'nome', pe.nome,
      'contas_mes', (
        select count(*) from customers c
        where c.responsavel_id = pe.id
          and c.conta_aberta_em >= (select inicio from mes_atual)
      ),
      'ativacoes_mes', (
        select count(*) from primeiro p
        join customers c on c.id = p.customer_id
        where c.responsavel_id = pe.id
          and p.primeiro_em >= (select inicio from mes_atual)
      ),
      'tempo_medio_dias', (
        -- Só contas abertas DEPOIS do início do histórico de lotes: para
        -- cliente mais velho que o histórico, o "1º lote" que temos é só o
        -- primeiro que importamos — a média sairia anos inflada. A janela
        -- cresce sozinha conforme o histórico acumula, com teto de 180 dias.
        select round(avg(p.primeiro_em - c.conta_aberta_em))
        from primeiro p
        join customers c on c.id = p.customer_id
        where c.responsavel_id = pe.id
          and c.conta_aberta_em >= greatest(
            (select min(referencia_data) from customer_lots),
            current_date - 180
          )
          and p.primeiro_em >= c.conta_aberta_em
      )
    )), '[]'::jsonb)
    from pessoas pe
  ),

  'historico', (
    select coalesce(jsonb_agg(jsonb_build_object(
      'pessoa', h.pid,
      'mes', to_char(h.mes, 'YYYY-MM'),
      'comissao_centavos', h.comissao,
      'contas', h.contas,
      'ativacoes', h.ativ
    ) order by h.mes), '[]'::jsonb)
    from (
      select
        pe.id as pid,
        m.mes,
        coalesce((
          select sum(s.valor_comissao_centavos) from sales s
          where s.vendedor_id = pe.id
            and s.status = 'confirmada'
            and s.ocorreu_em >= m.mes
            and s.ocorreu_em < m.mes + interval '1 month'
        ), 0) as comissao,
        (
          select count(*) from customers c
          where c.responsavel_id = pe.id
            and c.conta_aberta_em >= m.mes::date
            and c.conta_aberta_em < (m.mes + interval '1 month')::date
        ) as contas,
        (
          select count(*) from primeiro p
          join customers c on c.id = p.customer_id
          where c.responsavel_id = pe.id
            and p.primeiro_em >= m.mes::date
            and p.primeiro_em < (m.mes + interval '1 month')::date
        ) as ativ
      from pessoas pe
      cross join (
        select (date_trunc('month', now() at time zone 'America/Sao_Paulo')
                - (i || ' month')::interval)::date as mes
        from generate_series(0, 2) i
      ) m
    ) h
  )
)
$$;

revoke execute on function pagamentos_resumo(timestamptz) from public, anon;
grant execute on function pagamentos_resumo(timestamptz) to authenticated;
