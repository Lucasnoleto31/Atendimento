-- =============================================================================
-- Fase 6.1: velocidade de ativação — tempo médio geral e amostra por pessoa
-- =============================================================================
-- Os Relatórios ganham o bloco "abre→ativa" no Dinheiro parado. A régua já
-- existia na pagamentos_resumo (por vendedor); esta versão acrescenta:
--
--   tempo_medio_geral — {dias, n} da mesa inteira (mesma janela honesta:
--                       só contas abertas dentro do histórico de lotes,
--                       teto de 180 dias — mais velho que isso, o "1º lote"
--                       que temos é só o primeiro importado);
--   tempo_medio_n     — o tamanho da amostra por pessoa, para o rótulo
--                       "42d (8 contas)" não esconder uma média de n=1.
--
-- Mesma assinatura da 0053/0054 (create or replace); reexecutável.
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
),
janela as (
  select greatest(
    (select min(referencia_data) from customer_lots),
    current_date - 180
  ) as corte
)
select jsonb_build_object(
  'tempo_medio_geral', (
    select jsonb_build_object(
      'dias', round(avg(p.primeiro_em - c.conta_aberta_em)),
      'n', count(*)
    )
    from primeiro p
    join customers c on c.id = p.customer_id
    where c.conta_aberta_em >= (select corte from janela)
      and p.primeiro_em >= c.conta_aberta_em
  ),

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
        -- Só contas abertas DEPOIS do início do histórico de lotes (CTE
        -- janela): para cliente mais velho que o histórico, o "1º lote" que
        -- temos é só o primeiro importado — a média sairia anos inflada.
        select round(avg(p.primeiro_em - c.conta_aberta_em))
        from primeiro p
        join customers c on c.id = p.customer_id
        where c.responsavel_id = pe.id
          and c.conta_aberta_em >= (select corte from janela)
          and p.primeiro_em >= c.conta_aberta_em
      ),
      'tempo_medio_n', (
        select count(*)
        from primeiro p
        join customers c on c.id = p.customer_id
        where c.responsavel_id = pe.id
          and c.conta_aberta_em >= (select corte from janela)
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
