-- =============================================================================
-- Cliente que recusou marketing no WhatsApp
-- =============================================================================
-- O WhatsApp deixa a pessoa desligar mensagens de MARKETING por empresa. Quando
-- isso acontece, template dessa categoria volta com falha (código 131050) —
-- mas template de UTILIDADE e resposta dentro da janela de 24h continuam
-- chegando normalmente.
--
-- Marcamos o lead para: (a) o disparo em massa e a cadência pularem,
-- (b) a equipe saber que precisa de outro caminho, e (c) não queimar a
-- reputação do número com falhas repetidas.
--
-- Script reexecutável.
-- =============================================================================

alter table leads
  add column if not exists marketing_bloqueado_em timestamptz;

comment on column leads.marketing_bloqueado_em is
  'Cliente desativou mensagens de marketing no WhatsApp (erro 131050). Template de utilidade e janela de 24h seguem valendo.';

create index if not exists leads_marketing_bloqueado_idx
  on leads (marketing_bloqueado_em)
  where marketing_bloqueado_em is not null;
