-- =============================================================================
-- Relatório: detalhar por ETIQUETA, que é como a equipe organiza campanha
-- =============================================================================
-- O detalhamento agrupava por leads.campanha — um texto que só a importação
-- preenche. Só existiam 3 valores lá (Comunidade Whatsapp, hero, nulo),
-- enquanto a equipe usa 7 etiquetas (Resgate 1.181, Indicadores 23, Plano de
-- 2026 17…). Resultado: quase todo o trabalho da mesa ficava invisível no
-- relatório, e o motor de campanhas — que mira ETIQUETA (campanhas.etiqueta_id)
-- — não batia com o relatório.
--
-- Agora a linha é a etiqueta. Quem não tem etiqueta nenhuma continua caindo em
-- campanha e, na falta dela, no canal — ninguém some da tabela.
--
-- Um lead com duas etiquetas conta nas duas linhas (é o comportamento certo de
-- recorte por etiqueta); por isso a soma das linhas pode passar do total de
-- leads, e a tela avisa disso.
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
),

custo_template as (
  select coalesce(
    (select (valor #>> '{}')::numeric from settings
      where chave = 'custo_template_centavos'),
    25
  ) as centavos
),

templates_lead as (
  select i.lead_id, count(*) as n
  from lead_interactions i
  where i.tipo = 'mensagem_enviada'
    and i.metadados ? 'template'
  group by i.lead_id
),

gasto_campanha as (
  select btrim(cs.campanha) as campanha, sum(cs.valor_centavos) as gasto
  from channel_spend cs
  where cs.campanha is not null
    and btrim(cs.campanha) <> ''
    and (p_dias is null or cs.referencia_data >= current_date - p_dias)
  group by btrim(cs.campanha)
),

gasto_canal_geral as (
  select cs.channel_id, sum(cs.valor_centavos) as gasto
  from channel_spend cs
  where (cs.campanha is null or btrim(cs.campanha) = '')
    and (p_dias is null or cs.referencia_data >= current_date - p_dias)
  group by cs.channel_id
),

gasto_canal as (
  select cs.channel_id, sum(cs.valor_centavos) as gasto
  from channel_spend cs
  where p_dias is null or cs.referencia_data >= current_date - p_dias
  group by cs.channel_id
),

leads_canal as (
  select channel_id, count(*) as n
  from base
  group by channel_id
),

-- Fatia do gasto solto do canal que cabe a cada lead. Somada por etiqueta,
-- dá o rateio certo mesmo quando a etiqueta atravessa vários canais.
rateio_lead as (
  select
    b.id as lead_id,
    coalesce(gcg.gasto, 0)::numeric / nullif(lc.n, 0) as valor
  from base b
  left join gasto_canal_geral gcg on gcg.channel_id = b.channel_id
  left join leads_canal lc on lc.channel_id is not distinct from b.channel_id
),

-- Uma linha por (lead, etiqueta). O left join deixa o lead SEM etiqueta
-- passar uma vez só, caindo no nome da campanha e depois no canal.
origens as (
  select
    coalesce(
      t.nome,
      nullif(btrim(b.campanha), ''),
      ch.nome,
      'Sem origem'
    ) as origem,
    -- A etiqueta costuma atravessar canais; mostra o canal quando é um só.
    case
      when count(distinct coalesce(ch.nome, 'Sem canal')) > 1 then 'vários'
      else min(coalesce(ch.nome, 'Sem canal'))
    end as canal,
    (t.id is not null or nullif(btrim(b.campanha), '') is not null) as eh_campanha,
    (t.id is not null) as eh_etiqueta,
    count(*) as leads,
    count(*) filter (where b.status = 'ganho') as ganhos,
    count(*) filter (where b.customer_id is not null) as clientes,
    coalesce(sum(tl.n), 0) as templates,
    coalesce(sum(rl.valor), 0) as rateio
  from base b
  left join channels ch on ch.id = b.channel_id
  left join lead_tags lt on lt.lead_id = b.id
  left join tags t on t.id = lt.tag_id and t.ativo
  left join templates_lead tl on tl.lead_id = b.id
  left join rateio_lead rl on rl.lead_id = b.id
  group by 1, 3, 4
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

  'por_origem', (
    select coalesce(
      jsonb_agg(
        jsonb_build_object(
          'origem', o.origem,
          'canal', o.canal,
          'campanha', o.eh_campanha,
          'etiqueta', o.eh_etiqueta,
          'leads', o.leads,
          'ganhos', o.ganhos,
          'clientes', o.clientes,
          'templates', o.templates,
          'gasto_centavos',
            round(o.templates * ct.centavos)
            + coalesce(gcp.gasto, 0)
            + round(o.rateio)
        )
        order by o.leads desc
      ),
      '[]'::jsonb
    )
    from origens o
    cross join custo_template ct
    left join gasto_campanha gcp
      on o.eh_campanha and lower(gcp.campanha) = lower(o.origem)
  ),

  'por_canal', (
    select coalesce(jsonb_agg(x order by (x ->> 'leads')::int desc), '[]'::jsonb)
    from (
      select jsonb_build_object(
        'canal', coalesce(ch.nome, 'Sem canal'),
        'leads', count(b.id),
        'ganhos', count(b.id) filter (where b.status = 'ganho'),
        'clientes', count(b.id) filter (where b.customer_id is not null),
        'gasto_centavos', coalesce(gc.gasto, 0)
      ) as x
      from base b
      left join channels ch on ch.id = b.channel_id
      left join gasto_canal gc on gc.channel_id = b.channel_id
      group by ch.id, ch.nome, gc.gasto
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
