-- =============================================================================
-- Fase 4: prazo esperado por etapa do kanban
-- =============================================================================
-- O cartão marcava "atrasado" com 7 dias fixos para qualquer coluna — mas
-- cada etapa tem seu ritmo: Novo deveria queimar em dias, Ativação aguenta
-- semanas. O prazo vira campo da etapa (nulo = 7), editável na
-- Administração; o cartão ganha semáforo (verde no prazo, laranja estourou,
-- vermelho estourou o dobro) e a coluna conta os vermelhos.
--
-- Script reexecutável.
-- =============================================================================

alter table pipeline_stages
  add column if not exists prazo_dias integer
    check (prazo_dias is null or prazo_dias between 1 and 365);

comment on column pipeline_stages.prazo_dias is
  'Prazo esperado (dias) de um lead nesta etapa. Nulo = 7. Laranja ao estourar; vermelho no dobro.';
