-- =============================================================================
-- Listas de atendimento: view completa + correção de segurança
-- =============================================================================
-- 1. SEGURANÇA: views herdam a permissão do DONO por padrão, o que deixava
--    v_customer_giro e v_listas_atendimento legíveis sem login, ignorando o
--    RLS das tabelas. security_invoker faz a view respeitar o RLS de quem
--    consulta.
-- 2. A view das listas passa a trazer canal, etapa e responsável resolvidos,
--    e separa "só abriu a conta" (conta nova, nunca girou) de "nunca girou"
--    (conta antiga que nunca operou).
--
-- Script reexecutável.
-- =============================================================================

create or replace view v_listas_atendimento as
select
  l.id as lead_id,
  l.nome,
  l.telefone_e164,
  l.status,
  l.entrada_motivo,
  l.criado_em,
  l.customer_id,
  l.campanha,
  l.responsavel_id,
  p.nome as responsavel_nome,
  ch.nome as canal_nome,
  s.id as etapa_id,
  s.nome as etapa_nome,
  s.pipeline_id,
  case
    when l.customer_id is null then 'nao_cliente'
    when g.lotes_30d > 0 then 'girou_30d'
    when g.ultimo_giro_em is null
      and coalesce(c.conta_aberta_em, current_date) >= current_date - interval '30 days'
      then 'so_abriu_conta'
    when g.ultimo_giro_em is null then 'nunca_girou'
    else 'sem_giro_30d'
  end as lista,
  l.primeira_resposta_em is null as nunca_respondeu,
  g.lotes_30d,
  g.lotes_30d_anterior,
  g.ultimo_giro_em
from leads l
left join v_customer_giro g on g.customer_id = l.customer_id
left join customers c on c.id = l.customer_id
left join profiles p on p.id = l.responsavel_id
left join channels ch on ch.id = l.channel_id
left join pipeline_stages s on s.id = l.stage_id;

alter view v_customer_giro set (security_invoker = true);
alter view v_listas_atendimento set (security_invoker = true);
