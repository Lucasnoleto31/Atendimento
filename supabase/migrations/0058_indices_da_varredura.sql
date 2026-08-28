-- =============================================================================
-- Fase 8.2: índices que as consultas quentes pedem há tempos
-- =============================================================================
-- A varredura final cruzou os filtros reais com os índices existentes:
--
--   lead_interactions (tipo, criado_em) — o orçamento único conta envios do
--     dia por tipo+data a cada batimento, os Relatórios varrem 30 dias por
--     tipo, o placar da /hoje idem; só existia (lead_id, criado_em).
--   auditoria (acao, criado_em) — lib/envios conta acao='resumo_gestor' do
--     dia a cada batimento; só existia (quem, criado_em).
--   followup_envios (rule_id, episodio) — a cadência consulta a exclusão de
--     já-enviados por regra+episódio a cada rodada.
--
-- Script reexecutável.
-- =============================================================================

create index if not exists lead_interactions_tipo_criado_idx
  on lead_interactions (tipo, criado_em desc);

create index if not exists auditoria_acao_criado_idx
  on auditoria (acao, criado_em desc);

create index if not exists followup_envios_regra_episodio_idx
  on followup_envios (rule_id, episodio);
