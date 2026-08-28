-- =============================================================================
-- Cadência ganha teto diário
-- =============================================================================
-- O motor de cadência só tinha teto POR RODADA (10 por regra). Quantas rodadas
-- acontecem por dia dependia de um throttle guardado em variável de módulo —
-- que na Vercel morre a cada instância fria. Na prática: nenhum teto.
--
-- Em 24/08/2026 os 879 leads de reativação criados no mesmo dia (17/08)
-- cruzaram juntos o limiar de 6 dias da regra `lead_criado` e saíram 740
-- templates numa tacada. A qualidade do número caiu de GREEN para YELLOW.
--
-- Agora o motor conta no banco quantos já saíram hoje (todas as regras
-- somadas) e para ao encostar nesta cota. 60/dia é conservador de propósito:
-- é a reputação do número que está em jogo, e ele é o canal de TODO o
-- atendimento. Suba aos poucos, olhando a nota na WhatsApp Manager.
--
-- Script reexecutável.
-- =============================================================================

insert into settings (chave, valor, descricao) values
  ('cadencia_por_dia', '60'::jsonb,
   'Teto de disparos automáticos da cadência por dia, somando todas as regras.')
on conflict (chave) do nothing;
