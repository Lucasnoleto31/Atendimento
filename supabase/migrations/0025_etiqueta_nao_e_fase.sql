-- =============================================================================
-- Etiqueta deixa de ser fase de funil
-- =============================================================================
-- As etiquetas vieram do Chatwoot espelhando o funil (estagio-*, ganho-*,
-- perdido-*). Com isso a mesma informação vivia em dois lugares que podiam
-- discordar: um lead podia estar na coluna "Novos" e com a etiqueta
-- "ganho-conta_aberta".
--
-- A separação passa a ser:
--   coluna do kanban = FASE do funil (Novos, Em contato, Em negociação,
--                      Conta aberta, Perdido)
--   etiqueta         = interesse do lead e campanha de onde ele veio
--
-- Quem tem etiqueta de fase é movido para a coluna equivalente ANTES de a
-- etiqueta sumir — nenhuma informação se perde. O lead nunca regride: só
-- avança se estiver numa fase anterior.
--
-- Script reexecutável.
-- =============================================================================

-- 1. estagio-em_conversa -> coluna "Em contato" (só quem ainda está em Novos)

update leads l
set stage_id = e.destino
from (
  select
    (select s.id from pipeline_stages s join pipelines p on p.id = s.pipeline_id
      where p.padrao and s.nome = 'Em contato' limit 1) as destino,
    (select s.id from pipeline_stages s join pipelines p on p.id = s.pipeline_id
      where p.padrao and s.nome = 'Novos' limit 1) as origem
) e
where e.destino is not null
  and l.stage_id is not distinct from e.origem
  and exists (
    select 1 from lead_tags lt join tags t on t.id = lt.tag_id
    where lt.lead_id = l.id and t.nome = 'estagio-em_conversa'
  );

-- 2. ganho-conta_aberta -> coluna "Conta aberta" (não mexe em quem já está
--    lá nem em quem foi dado como perdido)

update leads l
set stage_id = e.destino
from (
  select
    (select s.id from pipeline_stages s join pipelines p on p.id = s.pipeline_id
      where p.padrao and s.nome = 'Conta aberta' limit 1) as destino,
    (select s.id from pipeline_stages s join pipelines p on p.id = s.pipeline_id
      where p.padrao and s.nome = 'Perdido' limit 1) as perdido
) e
where e.destino is not null
  and l.stage_id is distinct from e.destino
  and l.stage_id is distinct from e.perdido
  and exists (
    select 1 from lead_tags lt join tags t on t.id = lt.tag_id
    where lt.lead_id = l.id and t.nome = 'ganho-conta_aberta'
  );

-- 3. Fora as etiquetas que eram fase (lead_tags cai por cascade).

delete from tags where nome in (
  'estagio-em_conversa',
  'estagio-abrindo_conta',
  'ganho-conta_aberta',
  'ganho-cliente_ativo',
  'ganho-robo_vendido',
  'perdido-ja_tem',
  'perdido-sem_interesse',
  'perdido-sem_resposta',
  'perdido-sumiu'
);

-- 4. "estagio-interessado" é interesse, não fase: fica, sem o prefixo que
--    fazia parecer coluna.

update tags set nome = 'Interessado'
where nome = 'estagio-interessado'
  and not exists (select 1 from tags o where o.nome = 'Interessado');
