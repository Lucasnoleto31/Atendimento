-- =============================================================================
-- Chat rápido: prévia das conversas numa chamada só
-- =============================================================================
-- A lista do /chat mostrava a última mensagem de cada conversa buscando as
-- 300 interações mais recentes e ficando com a 1ª de cada lead — funciona com
-- a caixa pequena, mas quebra quando ela cresce (com ~950 conversas na caixa,
-- 300 linhas não alcançam nem um terço dos leads e a prévia some).
--
-- `distinct on (lead_id)` resolve no banco: uma linha por lead, sempre a mais
-- recente, aproveitando o índice lead_interactions_lead_idx (lead_id,
-- criado_em desc) da 0001. A página chama via RPC e mantém o caminho antigo
-- como fallback enquanto esta migração não roda em produção.
--
-- SECURITY DEFINER com search_path fixo: a função só devolve prévia de
-- mensagem (recebida/enviada) dos leads pedidos — nada além do que a própria
-- tela já mostra — e fica restrita a usuários autenticados (revoke de anon).
--
-- Script reexecutável.
-- =============================================================================

create or replace function previas_conversas(p_lead_ids uuid[])
returns table (
  lead_id uuid,
  tipo interaction_type,
  conteudo text,
  criado_em timestamptz
)
language sql
stable
security definer
set search_path = public
as $$
  select distinct on (lead_id) lead_id, tipo, conteudo, criado_em
  from lead_interactions
  where lead_id = any(p_lead_ids)
    and tipo in ('mensagem_recebida', 'mensagem_enviada')
  order by lead_id, criado_em desc
$$;

revoke execute on function previas_conversas(uuid[]) from public, anon;
grant execute on function previas_conversas(uuid[]) to authenticated;
