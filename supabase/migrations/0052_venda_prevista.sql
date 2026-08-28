-- =============================================================================
-- Fase 5 (bloco A): data prevista da venda pendente
-- =============================================================================
-- Venda pendente sem previsão é promessa sem prazo: o painel de pendentes
-- de Pagamentos ganha o campo opcional "prevista para", com alerta quando a
-- data passa. Só isso — o congelamento de valor e o fluxo de status não
-- mudam.
--
-- Script reexecutável.
-- =============================================================================

alter table sales
  add column if not exists prevista_em date;

comment on column sales.prevista_em is
  'Data prevista de confirmação de uma venda pendente. Opcional; vencida vira alerta em Pagamentos.';
