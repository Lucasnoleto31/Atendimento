-- =============================================================================
-- Motivo de perda novo: "nunca respondeu"
-- =============================================================================
-- A equipe agora marca perdido direto do chat, e o caso mais comum de lá é o
-- lead que NUNCA respondeu nada — não era coberto pela lista da 0038 (o
-- "sumiu" pressupõe que chegou a conversar). A constraint é recriada com o
-- valor novo; os dados existentes não mudam.
--
-- Script reexecutável.
-- =============================================================================

alter table leads drop constraint if exists leads_perda_motivo_chk;
alter table leads add constraint leads_perda_motivo_chk check (
  perda_motivo is null or perda_motivo in (
    'sumiu', 'nunca_respondeu', 'concorrente', 'sem_interesse',
    'sem_perfil', 'contato_invalido', 'outro'
  )
);
