-- =============================================================================
-- Agregados dos relatórios
-- =============================================================================
-- Uma função devolve todos os números da página de Relatórios numa chamada.
-- SECURITY INVOKER (padrão): respeita o RLS de quem consulta.
--
-- p_dias limita ao período (null = tudo). Aplica-se à criação do lead, ao
-- gasto por canal (referencia_data) e às vendas (ocorreu_em).
--
-- Script reexecutável.
-- =============================================================================

create or replace function relatorio_leads(p_dias integer default null)
returns jsonb
language sql
stable
set search_path = public
as $$
with base as (
  select *
  from leads l
  where p_dias is null
     or l.criado_em >= now() - make_interval(days => p_dias)
)
select jsonb_build_object(
  'total_leads', (select count(*) from base),

  'clientes_base', (select count(*) from customers where ativo),

  'leads_clientes', (select count(*) from base where customer_id is not null),

  'ganhos', (select count(*) from base where status = 'ganho'),

  'em_andamento',
    (select count(*) from base where status in ('novo', 'em_atendimento')),

  'nunca_responderam',
    (select count(*) from base where primeira_resposta_em is null),

  'por_status', (
    select coalesce(jsonb_object_agg(status, n), '{}'::jsonb)
    from (select status, count(*) as n from base group by status) s
  ),

  'por_etapa', (
    select coalesce(jsonb_agg(x order by x -> 'kanban', (x ->> 'ordem')::int), '[]'::jsonb)
    from (
      select jsonb_build_object(
        'etapa', s.nome,
        'kanban', p.nome,
        'ordem', s.ordem,
        'total', coalesce(n.n, 0)
      ) as x
      from pipeline_stages s
      join pipelines p on p.id = s.pipeline_id
      left join (
        select stage_id, count(*) as n from base group by stage_id
      ) n on n.stage_id = s.id
    ) etapas
  ),

  'por_canal', (
    select coalesce(jsonb_agg(x), '[]'::jsonb)
    from (
      select jsonb_build_object(
        'canal', coalesce(ch.nome, 'Sem canal'),
        'leads', count(b.id),
        'ganhos', count(b.id) filter (where b.status = 'ganho'),
        'clientes', count(b.id) filter (where b.customer_id is not null),
        'gasto_centavos', coalesce((
          select sum(cs.valor_centavos)
          from channel_spend cs
          where cs.channel_id = ch.id
            and (p_dias is null
                 or cs.referencia_data >= current_date - p_dias)
        ), 0)
      ) as x
      from base b
      left join channels ch on ch.id = b.channel_id
      group by ch.id, ch.nome
      order by count(b.id) desc
    ) canais
  ),

  'por_vendedor', (
    select coalesce(jsonb_agg(x), '[]'::jsonb)
    from (
      select jsonb_build_object(
        'vendedor', pr.nome,
        'leads', count(b.id),
        'ganhos', count(b.id) filter (where b.status = 'ganho'),
        'vendas', (
          select count(*)
          from sales s
          where s.vendedor_id = pr.id
            and s.status = 'confirmada'
            and (p_dias is null
                 or s.ocorreu_em >= now() - make_interval(days => p_dias))
        ),
        'comissao_centavos', (
          select coalesce(sum(s.valor_comissao_centavos), 0)
          from sales s
          where s.vendedor_id = pr.id
            and s.status = 'confirmada'
            and (p_dias is null
                 or s.ocorreu_em >= now() - make_interval(days => p_dias))
        )
      ) as x
      from base b
      join profiles pr on pr.id = b.responsavel_id
      group by pr.id, pr.nome
      order by count(b.id) desc
    ) vendedores
  )
)
$$;

revoke execute on function relatorio_leads(integer) from public, anon;
grant execute on function relatorio_leads(integer) to authenticated;
