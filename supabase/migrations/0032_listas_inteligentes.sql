-- =============================================================================
-- Listas inteligentes da página Leads
-- =============================================================================
-- A view antiga classificava o lead numa categoria só (nao_cliente, girou_30d,
-- nunca_girou…), o que produzia baldes gigantes e indiferenciados: "nunca
-- giraram 1.248" não é fila de trabalho. E o estado que a mesa realmente
-- precisa — quem está esperando resposta, com a janela de 24h aberta, sem
-- dono, ou com conta aberta e nunca girou — não existia em lugar nenhum.
--
-- Esta view resolve tudo por lead, em colunas booleanas independentes: um lead
-- pode estar em várias listas ao mesmo tempo (é o certo — quem está sem dono E
-- esperando resposta precisa aparecer nas duas).
--
-- Custo: dois LATERAL por lead sobre lead_interactions, servidos pelo índice
-- (lead_id, criado_em desc) que já existe desde a 0001.
--
-- Script reexecutável.
-- =============================================================================

drop view if exists v_leads_listas;

create view v_leads_listas as
select
  l.id as lead_id,
  l.nome,
  l.telefone_e164,
  l.status,
  l.criado_em,
  l.customer_id,
  l.campanha,
  l.responsavel_id,
  p.nome as responsavel_nome,
  ch.nome as canal_nome,
  s.nome as etapa_nome,
  s.pipeline_id,
  l.ultima_interacao_em,
  l.primeira_resposta_em,

  g.lotes_30d,
  g.lotes_30d_anterior,
  g.ultimo_giro_em,
  c.conta_aberta_em,

  -- Conversa viva: não resolvida, não adiada, lead não perdido. Toda lista de
  -- trabalho parte daqui — o resto é ruído para a fila do dia.
  (
    l.chat_resolvido_em is null
    and l.chat_adiado_em is null
    and l.status <> 'perdido'
  ) as em_aberto,

  -- Quem falou por último e quando o cliente falou pela última vez.
  ult.tipo as ultimo_tipo,
  ult.criado_em as ultima_mensagem_em,
  rec.criado_em as ultima_recebida_em,

  -- AGUARDANDO NÓS: o cliente mandou a última mensagem e ninguém voltou.
  (
    ult.tipo = 'mensagem_recebida'
    and l.chat_resolvido_em is null
    and l.chat_adiado_em is null
    and l.status <> 'perdido'
  ) as aguardando_resposta,

  -- Horas que o cliente está esperando (null quando não está esperando).
  case
    when ult.tipo = 'mensagem_recebida'
      then extract(epoch from (now() - ult.criado_em)) / 3600
  end as horas_esperando,

  -- JANELA DE 24h: dá para mandar mensagem livre agora (sem template).
  (rec.criado_em is not null and rec.criado_em > now() - interval '24 hours')
    as janela_aberta,

  -- Sem dono: ninguém é responsável por este lead.
  (l.responsavel_id is null) as sem_dono,

  -- Nunca trocou mensagem nenhuma (veio de importação e ficou parado).
  (ult.criado_em is null) as nunca_contatado,

  -- Recebeu mensagem nossa e nunca respondeu.
  (ult.criado_em is not null and rec.criado_em is null) as sem_resposta,

  -- Respondeu mas ainda não abriu conta: lead quente na mesa.
  (rec.criado_em is not null and l.customer_id is null) as quente_sem_conta,

  -- ABRIU CONTA E NUNCA GIROU: a maior massa de receita parada da empresa.
  (l.customer_id is not null and g.ultimo_giro_em is null) as sem_primeiro_giro,

  -- Dias desde a abertura da conta — separa quem acabou de abrir (ligação de
  -- onboarding, cabe no dia) de quem está dormente há meses (é campanha, não
  -- fila de telefone). Sem esse corte, "971 sem giro" vira um balde inútil.
  case
    when c.conta_aberta_em is not null then (current_date - c.conta_aberta_em)
  end as dias_conta_aberta,

  (
    l.customer_id is not null
    and g.ultimo_giro_em is null
    and c.conta_aberta_em is not null
    and c.conta_aberta_em >= current_date - 90
  ) as primeiro_giro_recente,

  (
    l.customer_id is not null
    and g.ultimo_giro_em is null
    and (c.conta_aberta_em is null or c.conta_aberta_em < current_date - 90)
  ) as primeiro_giro_dormente,

  -- Está girando agora.
  (coalesce(g.lotes_30d, 0) > 0) as girando,

  -- Girava e caiu mais de 25% em relação ao período anterior.
  (
    coalesce(g.lotes_30d_anterior, 0) > 0
    and coalesce(g.lotes_30d, 0) < g.lotes_30d_anterior * 0.75
  ) as caiu_volume,

  -- Já girou algum dia e parou.
  (g.ultimo_giro_em is not null and coalesce(g.lotes_30d, 0) = 0)
    as parou_de_girar,

  -- Adiado e o prazo já passou: some da caixa do chat e ninguém retomou.
  (
    l.chat_adiado_em is not null
    and l.chat_adiado_em < now() - interval '3 days'
    and l.chat_resolvido_em is null
    and (rec.criado_em is null or rec.criado_em < l.chat_adiado_em)
  ) as adiado_vencido,

  -- Sem primeiro giro E já conversou com a mesa: prioridade sobre o frio.
  (
    l.customer_id is not null
    and g.ultimo_giro_em is null
    and rec.criado_em is not null
  ) as sem_giro_ja_conversou,

  -- Receita escorrendo: caiu forte OU parou de vez. Duas listas de 12 e 15
  -- viram uma de 27, que é o tamanho de um dia de resgate.
  (
    (coalesce(g.lotes_30d_anterior, 0) > 0
      and coalesce(g.lotes_30d, 0) < g.lotes_30d_anterior * 0.75)
    or (g.ultimo_giro_em is not null and coalesce(g.lotes_30d, 0) = 0)
  ) as giro_em_risco,

  -- Não dá para falar com esta pessoa: sem número ou recusou marketing.
  (l.telefone_e164 is null or l.marketing_bloqueado_em is not null)
    as nao_contatavel,

  -- Higiene da base: sem telefone não dá para atender.
  (l.telefone_e164 is null) as sem_telefone,
  (l.marketing_bloqueado_em is not null) as marketing_bloqueado

from leads l
left join v_customer_giro g on g.customer_id = l.customer_id
left join customers c on c.id = l.customer_id
left join profiles p on p.id = l.responsavel_id
left join channels ch on ch.id = l.channel_id
left join pipeline_stages s on s.id = l.stage_id
left join lateral (
  select i.tipo, i.criado_em
  from lead_interactions i
  where i.lead_id = l.id
    and i.tipo in ('mensagem_recebida', 'mensagem_enviada')
  order by i.criado_em desc
  limit 1
) ult on true
left join lateral (
  select i.criado_em
  from lead_interactions i
  where i.lead_id = l.id
    and i.tipo = 'mensagem_recebida'
  order by i.criado_em desc
  limit 1
) rec on true;

alter view v_leads_listas set (security_invoker = true);
