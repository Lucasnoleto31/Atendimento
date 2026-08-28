-- =============================================================================
-- Adiar com prazo: a conversa volta sozinha quando o prazo vence
-- =============================================================================
-- Adiar virou arquivo: a conversa adiada só voltava à caixa se o LEAD
-- respondesse — se ele não respondia, dormia para sempre (a auditoria achou
-- 954 assim, com 3+ dias sem resposta). Agora adiar grava até quando; passado
-- o prazo, o filtro das consultas devolve a conversa à caixa de entrada como
-- pendente — comparação com now() na leitura, sem cron e sem apagar o
-- histórico de adiamento (chat_adiado_em fica).
--
-- Script reexecutável.
-- =============================================================================

alter table leads add column if not exists chat_adiado_ate timestamptz;

comment on column leads.chat_adiado_ate is
  'Até quando a conversa fica fora da caixa de entrada; vencido o prazo ela volta a contar como pendente. O webhook de mensagem recebida zera junto com chat_adiado_em.';

-- As adiadas de antes ganham o prazo de 3 dias que a view da 0032
-- (adiado_vencido) já considera "vencido": as que passaram disso voltam à
-- caixa na hora; as demais voltam quando completarem os 3 dias.
update leads
  set chat_adiado_ate = chat_adiado_em + interval '3 days'
  where chat_adiado_em is not null and chat_adiado_ate is null;

create index if not exists leads_chat_adiado_ate_idx
  on leads (chat_adiado_ate)
  where chat_adiado_ate is not null;
