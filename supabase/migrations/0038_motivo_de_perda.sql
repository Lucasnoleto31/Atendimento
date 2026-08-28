-- =============================================================================
-- Motivo da perda
-- =============================================================================
-- "Perdido" era um balde sem explicação: não dava para saber quanto foi
-- concorrente, quanto foi lead que sumiu e quanto nunca quis abrir conta —
-- três problemas com três respostas diferentes (proposta, cadência e
-- qualificação do público). O motivo vira coluna, o carimbo de quando perdeu
-- também, e o relatório passa a somar por motivo.
--
-- O carimbo fica num gatilho, não no aplicativo: qualquer caminho que marque
-- 'perdido' (edição, kanban, importação futura) ganha a data de graça, e sair
-- de 'perdido' limpa motivo e data sozinho — lead reaberto não carrega a
-- perda antiga no relatório.
--
-- Script reexecutável.
-- =============================================================================

alter table leads
  add column if not exists perda_motivo  text,
  add column if not exists perda_detalhe text,
  add column if not exists perdido_em    timestamptz;

comment on column leads.perda_motivo is
  'Por que o lead foi perdido. Null enquanto o lead não está perdido.';

alter table leads drop constraint if exists leads_perda_motivo_chk;
alter table leads add constraint leads_perda_motivo_chk check (
  perda_motivo is null or perda_motivo in (
    'sumiu', 'concorrente', 'sem_interesse', 'sem_perfil',
    'contato_invalido', 'outro'
  )
);

create or replace function leads_carimbar_perda()
returns trigger
language plpgsql
as $$
begin
  if new.status = 'perdido' then
    if old.status is distinct from 'perdido' then
      new.perdido_em = coalesce(new.perdido_em, now());
    end if;
  else
    -- Reabriu: a perda antiga não pode continuar somando no relatório.
    new.perda_motivo  = null;
    new.perda_detalhe = null;
    new.perdido_em    = null;
  end if;
  return new;
end;
$$;

-- BEFORE roda em ordem alfabética; "leads_aa_" garante que a limpeza acontece
-- antes de qualquer outro gatilho ler esses campos.
drop trigger if exists leads_aa_carimbar_perda on leads;
create trigger leads_aa_carimbar_perda
  before update on leads
  for each row execute function leads_carimbar_perda();

-- Acerto do estoque atual --------------------------------------------------
-- 1. Card na coluna Perdido com status vivo: o kanban e o status contavam
--    histórias diferentes (mover o card nunca mudou o status). Alinha pelo
--    kanban, que é onde a equipe trabalha; o motivo fica nulo — não se
--    inventa motivo para perda antiga.
update leads l
set status = 'perdido'
from pipeline_stages s
join pipelines p on p.id = s.pipeline_id
where s.id = l.stage_id
  and p.padrao
  and s.is_final
  and l.status not in ('perdido', 'ganho');

-- 2. Quem já está perdido ganha o carimbo aproximado (melhor data que temos).
update leads
set perdido_em = coalesce(perdido_em, entrou_na_etapa_em, atualizado_em, criado_em)
where status = 'perdido';
