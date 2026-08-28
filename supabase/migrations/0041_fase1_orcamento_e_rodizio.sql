-- =============================================================================
-- Fase 1: orçamento único de envios, cadência religada e rodízio de verdade
-- =============================================================================
-- Três decisões aprovadas na auditoria de 28/08:
--
-- 1. ORÇAMENTO ÚNICO DE ENVIOS. O incidente de 24/08 (1.015 templates num
--    dia, qualidade caiu para amarelo) aconteceu porque cada motor tinha teto
--    próprio e ninguém somava. Agora cadência, campanhas e disparo manual
--    debitam do MESMO teto diário (envios_teto_dia). A rampa é manual e
--    deliberada: com a qualidade verde, o gestor sobe 100 → 150 → 200 em
--    Configurações; se cair para amarelo, desce.
--
-- 2. CADÊNCIA DE AQUISIÇÃO RELIGADA. Desligada no susto de 24/08, deixou
--    1.949 leads sem follow-up. Volta protegida pelo teto acima.
--
-- 3. RODÍZIO DE VERDADE. A distribuição automática filtrava papel=vendedor:
--    só o Aikon passava, e o "rodízio" era de um só (1.022 leads). Quem
--    atende agora é marcado em profiles.recebe_leads, controlado no Admin.
--
-- Script reexecutável.
-- =============================================================================

-- 1. Orçamento único --------------------------------------------------------
insert into settings (chave, valor) values ('envios_teto_dia', '100'::jsonb)
on conflict (chave) do nothing;

-- 2. Cadência de aquisição: religar SÓ na segunda-feira (decisão de 28/08) --
-- O comando fica pronto aqui, comentado. Na segunda, rode só esta linha no
-- SQL Editor — o teto único acima já protege o número:
--
--   update followup_rules set ativo = true where ancora = 'lead_criado';

-- 3. Rodízio por pessoa, não por papel ---------------------------------------
alter table profiles
  add column if not exists recebe_leads boolean not null default false;

comment on column profiles.recebe_leads is
  'Entra no rodízio da distribuição automática de leads novos. Papel não decide; o gestor marca no Admin.';

-- Estado inicial espelha o comportamento antigo: vendedores atendem.
update profiles set recebe_leads = true
where papel = 'vendedor' and ativo;
