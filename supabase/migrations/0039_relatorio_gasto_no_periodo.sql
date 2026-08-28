-- =============================================================================
-- Relatório: gasto de template segue o período, etiqueta inativa não duplica
-- =============================================================================
-- Dois defeitos da relatorio_leads (0031), achados na auditoria de 27/08:
--
-- 1. O CTE templates_lead somava TODO template já enviado ao lead, sem olhar
--    o período — "últimos 30 dias" mostrava gasto acumulado desde sempre, e
--    quando a base envelhecer o efeito inverte: o gasto recente de leads
--    antigos some da visão curta.
--
-- 2. Lead cujas etiquetas estão TODAS inativas contava em dobro no
--    detalhamento: as linhas de lead_tags sobreviviam ao join e o lead ainda
--    caía no ramo "sem etiqueta".
--
-- A função é a MESMA da 0031 com essas duas mudanças, comentadas no corpo.
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
    -- Gasto segue o ENVIO, não o lead: sem este filtro, a visão "30 dias"
    -- somava templates de sempre para os leads da coorte — e zerava o custo
    -- real do período para leads antigos.
    and (p_dias is null or i.criado_em >= now() - make_interval(days => p_dias))
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
  -- O filtro de ativo fica DENTRO do join de lead_tags: com ele só no join
  -- de tags, lead cujas etiquetas estão todas inativas mantinha as linhas de
  -- lead_tags e caía também no ramo "sem etiqueta" — contava em dobro.
  left join (
    select lt.lead_id, lt.tag_id
    from lead_tags lt
    join tags ta on ta.id = lt.tag_id and ta.ativo
  ) lt on lt.lead_id = b.id
  left join tags t on t.id = lt.tag_id
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

-- Higiene achada na mesma auditoria: 4 leads GANHOS estacionados na coluna
-- Perdido — por isso "Perdido" mostrava 34 por etapa e 30 por status na
-- mesma tela. Ganho com conta que nunca girou vai para Ativação (é fila de
-- trabalho); quem já girou vai para Conta Aberta.
--
-- O destino é decidido numa subconsulta: no update ... from, os joins do
-- from não podem referenciar a tabela atualizada.
update leads l
set stage_id = d.destino,
    entrou_na_etapa_em = now()
from (
  select
    l2.id as lead_id,
    coalesce(
      case when g.ultimo_giro_em is not null then conta.id end,
      ativ.id
    ) as destino
  from leads l2
  join pipeline_stages s on s.id = l2.stage_id
  join pipelines p on p.id = s.pipeline_id and p.padrao
  left join pipeline_stages conta
    on conta.pipeline_id = p.id and conta.nome = 'Conta Aberta'
  left join pipeline_stages ativ
    on ativ.pipeline_id = p.id and ativ.nome = 'Ativação'
  left join v_customer_giro g on g.customer_id = l2.customer_id
  where s.is_final
    and l2.status = 'ganho'
) d
where l.id = d.lead_id
  and d.destino is not null;
