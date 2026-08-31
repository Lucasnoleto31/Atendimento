-- =============================================================================
-- O prazo do adiamento passa a valer em TODAS as filas
-- =============================================================================
-- A 0042 deu hora marcada ao adiamento (chat_adiado_ate). Só que a coluna
-- chat_adiado_em NUNCA é limpa quando o prazo vence — ela some só quando o
-- lead responde ou alguém reativa. E a view continuava tratando "tem
-- chat_adiado_em" como "está adiado", para sempre. Resultado, com a 0042
-- aplicada:
--
--   • A CAIXA DO CHAT decidia por adiado_vencido, que era a heurística velha
--     dos 3 dias: adiar para AMANHÃ sumia com a conversa por dois dias (saiu
--     de "Adiadas", ainda não entrou na Caixa), e o stand-by de UMA SEMANA
--     voltava no terceiro dia, quatro dias antes do combinado.
--   • O RESTO DO SISTEMA nem isso: /hoje, kanban, listas de /leads,
--     relatórios, quadro da equipe e resumo do gestor leem em_aberto e
--     aguardando_resposta, que ignoravam o prazo — a conversa adiada saía
--     dessas filas e NÃO VOLTAVA NUNCA. O bolsão de stand-by inteiro
--     desaparecia da fila do dia.
--
-- Aqui a regra passa a ser uma só, nas três expressões: está fora das filas
-- quem foi adiado E AINDA ESTÁ NO PRAZO. Vencido volta a ser conversa viva.
-- A heurística de 3 dias sobrevive só para o que foi adiado antes da 0042
-- sem prazo gravado. De carona, adiado_vencido passa a excluir lead perdido,
-- como as outras duas expressões sempre fizeram.
--
-- Fora essas três expressões, a view é a definição da 0037, reproduzida
-- porque "create or replace view" exige o corpo inteiro.
--
-- Script reexecutável.
-- =============================================================================

create or replace view v_leads_listas as
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

  -- Conversa viva: não resolvida, não adiada AINDA NO PRAZO, lead não
  -- perdido. Toda lista de trabalho parte daqui — o resto é ruído para a
  -- fila do dia.
  --
  -- "no prazo" é o que muda com a 0042: antes, adiar tirava a conversa de
  -- TODAS as filas para sempre, porque chat_adiado_em nunca é limpo quando
  -- o prazo vence. O chat disfarçava somando adiado_vencido à Caixa; a
  -- /hoje, o kanban, as listas e os relatórios não — a conversa adiada
  -- sumia deles e não voltava nunca.
  (
    l.chat_resolvido_em is null
    and not (
      l.chat_adiado_em is not null
      and (
        (l.chat_adiado_ate is not null and l.chat_adiado_ate > now())
        or (l.chat_adiado_ate is null
            and l.chat_adiado_em >= now() - interval '3 days')
      )
    )
    and l.status <> 'perdido'
  ) as em_aberto,

  -- Quem falou por último e quando o cliente falou pela última vez.
  ult.tipo as ultimo_tipo,
  ult.criado_em as ultima_mensagem_em,
  rec.criado_em as ultima_recebida_em,

  -- AGUARDANDO NÓS: o cliente mandou a última mensagem e ninguém voltou.
  -- Mesma regra de prazo do em_aberto: vencido volta a esperar resposta.
  (
    ult.tipo = 'mensagem_recebida'
    and l.chat_resolvido_em is null
    and not (
      l.chat_adiado_em is not null
      and (
        (l.chat_adiado_ate is not null and l.chat_adiado_ate > now())
        or (l.chat_adiado_ate is null
            and l.chat_adiado_em >= now() - interval '3 days')
      )
    )
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

  -- Adiado e o prazo já passou: volta para a caixa do chat.
  --
  -- Com a 0042 o adiamento tem HORA MARCADA (chat_adiado_ate) e é ela que
  -- manda. A heurística de 3 dias fica só para o que foi adiado antes da
  -- migração e não tem prazo gravado.
  (
    l.chat_adiado_em is not null
    and l.chat_resolvido_em is null
    and l.status <> 'perdido'
    and not (
      l.chat_adiado_em is not null
      and (
        (l.chat_adiado_ate is not null and l.chat_adiado_ate > now())
        or (l.chat_adiado_ate is null
            and l.chat_adiado_em >= now() - interval '3 days')
      )
    )
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
  (l.marketing_bloqueado_em is not null) as marketing_bloqueado,

  -- Etiquetas do lead em array. Array e não junção: o filtro da página vira um
  -- `contains`, que o PostgREST resolve numa consulta só e mantém a contagem
  -- certa. Com `in (mil ids)` a URL estoura antes de chegar no banco.
  coalesce(et.ids, '{}'::uuid[]) as etiqueta_ids,
  coalesce(et.nomes, '{}'::text[]) as etiquetas,

  -- Quando este lead recebeu template do disparo em massa. As filas antigas
  -- eram por data de contato, então enviar já tirava o lead do filtro; as
  -- listas de hoje ("conta aberta e nunca girou") não mudam por causa de um
  -- envio — sem esta coluna, clicar duas vezes manda o mesmo template para as
  -- mesmas pessoas, que é o caminho curto para derrubar a qualidade do número.
  disp.criado_em as ultimo_disparo_em

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
) rec on true
left join lateral (
  select array_agg(t.id order by t.nome)   as ids,
         array_agg(t.nome order by t.nome) as nomes
  from lead_tags lt
  join tags t on t.id = lt.tag_id
  where lt.lead_id = l.id
) et on true
left join lateral (
  select i.criado_em
  from lead_interactions i
  where i.lead_id = l.id
    and i.tipo = 'mensagem_enviada'
    and i.metadados ->> 'via' = 'disparo'
  order by i.criado_em desc
  limit 1
) disp on true;

alter view v_leads_listas set (security_invoker = true);
