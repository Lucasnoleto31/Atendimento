-- =============================================================================
-- Relatório por campanha, não por canal
-- =============================================================================
-- Com várias campanhas no mesmo canal (WhatsApp), agrupar por canal junta
-- tudo num balde só e não dá para saber qual campanha traz cliente. A linha
-- passa a ser a CAMPANHA do lead (leads.campanha); quem não veio de campanha
-- nenhuma continua aparecendo pelo canal, como antes.
--
-- Gasto: cada template enviado custa (settings.custo_template_centavos,
-- padrão R$ 0,25). O relatório conta os templates que saíram para os leads
-- de cada campanha e multiplica. Some a isso o que estiver lançado à mão em
-- channel_spend: valor com o nome da campanha vai inteiro para ela, valor
-- solto no canal é rateado pelo volume de leads.
--
-- Custo por ganho: gasto dividido pelos leads GANHOS da campanha — o que
-- custou cada cliente, não cada disparo.
--
-- Mantém 'por_canal' no retorno para nada que dependa dele quebrar.
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

-- Preço de um template enviado, em centavos.
custo_template as (
  select coalesce(
    (select (valor #>> '{}')::numeric from settings
      where chave = 'custo_template_centavos'),
    25
  ) as centavos
),

-- Templates que saíram para cada lead. Todo envio de template grava o nome
-- dele em metadados->>'template' — é o que separa template de mensagem
-- comum, que não é cobrada.
templates_lead as (
  select i.lead_id, count(*) as n
  from lead_interactions i
  where i.tipo = 'mensagem_enviada'
    and i.metadados ? 'template'
  group by i.lead_id
),

-- Gasto lançado com o nome da campanha: vai inteiro para ela.
gasto_campanha as (
  select btrim(cs.campanha) as campanha, sum(cs.valor_centavos) as gasto
  from channel_spend cs
  where cs.campanha is not null
    and btrim(cs.campanha) <> ''
    and (p_dias is null or cs.referencia_data >= current_date - p_dias)
  group by btrim(cs.campanha)
),

-- Gasto lançado só no canal, sem campanha: é o que entra no rateio.
gasto_canal_geral as (
  select cs.channel_id, sum(cs.valor_centavos) as gasto
  from channel_spend cs
  where (cs.campanha is null or btrim(cs.campanha) = '')
    and (p_dias is null or cs.referencia_data >= current_date - p_dias)
  group by cs.channel_id
),

-- Total do canal, para a visão antiga por canal.
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

origens as (
  select
    coalesce(nullif(btrim(b.campanha), ''), ch.nome, 'Sem origem') as origem,
    coalesce(ch.nome, 'Sem canal') as canal,
    nullif(btrim(b.campanha), '') is not null as eh_campanha,
    b.channel_id,
    count(*) as leads,
    count(*) filter (where b.status = 'ganho') as ganhos,
    count(*) filter (where b.customer_id is not null) as clientes,
    coalesce(sum(tl.n), 0) as templates
  from base b
  left join channels ch on ch.id = b.channel_id
  left join templates_lead tl on tl.lead_id = b.id
  group by 1, 2, 3, b.channel_id
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
          'leads', o.leads,
          'ganhos', o.ganhos,
          'clientes', o.clientes,
          'templates', o.templates,
          'gasto_centavos',
            round(o.templates * ct.centavos)
            + coalesce(gcp.gasto, 0)
            + coalesce(
                round(gcg.gasto * o.leads::numeric / nullif(lc.n, 0)),
                0
              )
        )
        order by o.leads desc
      ),
      '[]'::jsonb
    )
    from origens o
    cross join custo_template ct
    left join gasto_campanha gcp
      on o.eh_campanha and lower(gcp.campanha) = lower(o.origem)
    left join gasto_canal_geral gcg on gcg.channel_id = o.channel_id
    left join leads_canal lc on lc.channel_id is not distinct from o.channel_id
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

-- Preço de um template, editável sem mexer em código.
insert into settings (chave, valor, descricao) values
  ('custo_template_centavos', '25'::jsonb,
   'Custo em centavos de cada template de WhatsApp enviado.')
on conflict (chave) do nothing;

-- A contagem de templates varre só os envios de template, não a conversa toda.
create index if not exists lead_interactions_template_idx
  on lead_interactions (lead_id)
  where tipo = 'mensagem_enviada' and metadados ? 'template';
