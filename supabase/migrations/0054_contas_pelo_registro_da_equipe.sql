-- =============================================================================
-- Contas abertas: a régua passa a ser o registro da equipe, não a Genial
-- =============================================================================
-- A 0053 contava "contas abertas" por customers.conta_aberta_em — campo que
-- vem da planilha da Genial. Medido em agosto/2026: a equipe registrou 40
-- aberturas (vendas do produto ABERTURA), a planilha só marcou 14 — e o
-- lucas apareceu com 1 conta quando registrou 7. A planilha atrasa e não
-- cobre todo mundo; o registro de venda é imediato e é o que o vendedor
-- controla. Ativação segue na régua canônica (1º lote da vida do cliente,
-- referencia_data) — giro só a Genial sabe. O tempo médio abre→ativa também
-- segue Genial→Genial, para não misturar réguas dentro da mesma conta.
--
-- Identificação do produto pelo codigo 'ABERTURA' (estável; o nome é
-- editável na interface).
--
-- Script reexecutável (create or replace da mesma assinatura da 0053).
-- =============================================================================

create or replace function pagamentos_resumo(p_inicio timestamptz default null)
returns jsonb
language sql
stable
set search_path = public
as $$
with abertura as (
  select id from products where codigo = 'ABERTURA'
),
primeiro as (
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
      select count(distinct s.lead_id) from sales s
      where s.product_id in (select id from abertura)
        and s.status <> 'cancelada'
        and (p_inicio is null or s.ocorreu_em >= p_inicio)
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
        select count(*) from sales s
        where s.vendedor_id = pe.id
          and s.product_id in (select id from abertura)
          and s.status <> 'cancelada'
          and s.ocorreu_em >= (select inicio from mes_atual)
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
        -- primeiro que importamos — a média sairia anos inflada.
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
          select count(*) from sales s
          where s.vendedor_id = pe.id
            and s.product_id in (select id from abertura)
            and s.status <> 'cancelada'
            and s.ocorreu_em >= m.mes
            and s.ocorreu_em < m.mes + interval '1 month'
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
