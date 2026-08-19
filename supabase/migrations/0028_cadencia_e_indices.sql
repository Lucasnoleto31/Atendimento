-- =============================================================================
-- Robustez da cadência + índices quentes
-- =============================================================================
-- 1. followup_envios.erro: a cadência passa a GUARDAR a falha permanente em
--    vez de apagar a reserva e tentar de novo para sempre (um template
--    quebrado disparava até 300 chamadas com erro por rodada contra a Meta).
-- 2. Índice em lead_tags (tag_id): é a consulta quente do motor de campanhas
--    e do filtro de etiqueta no chat — sem ele, varre a tabela inteira.
--
-- Script reexecutável.
-- =============================================================================

alter table followup_envios
  add column if not exists erro text;

create index if not exists lead_tags_tag_idx on lead_tags (tag_id);
