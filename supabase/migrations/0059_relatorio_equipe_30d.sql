-- =============================================================================
-- Fase 8.2: a atividade da equipe dos Relatórios vira UMA agregada no banco
-- =============================================================================
-- O gargalo medido da página (fase 6): dois buscarTudo SERIAIS sobre
-- lead_interactions de 30 dias (~2s, milhares de linhas trafegadas) para
-- produzir meia dúzia de números — mensagens por autor, mensagens de hoje,
-- e a mediana do tempo da 1ª resposta. Esta função devolve tudo num
-- round-trip; a página mantém o caminho antigo como fallback sem a migração.
--
-- A mediana replica o algoritmo que morava em TypeScript: para cada lead,
-- cada sequência de recebidas abre UMA espera (a primeira recebida da
-- sequência) e a próxima enviada fecha; pares fora de 0..7 dias caem fora
-- (importação retroativa e conversa retomada não são "resposta").
--
-- SECURITY INVOKER: mesma visibilidade da página (RLS de quem chama).
--
-- Script reexecutável.
-- =============================================================================

create or replace function relatorio_equipe_30d(
  p_inicio timestamptz,
  p_inicio_hoje timestamptz
)
returns jsonb
language sql
stable
set search_path = public
as $$
with fluxo as (
  select
    lead_id, tipo, criado_em,
    lag(tipo) over (partition by lead_id order by criado_em, id) as tipo_ant
  from lead_interactions
  where tipo in ('mensagem_recebida', 'mensagem_enviada')
    and criado_em >= p_inicio
),
inicios as (
  -- primeira recebida de cada sequência: abre a espera
  select lead_id, criado_em as inicio
  from fluxo
  where tipo = 'mensagem_recebida'
    and (tipo_ant is null or tipo_ant = 'mensagem_enviada')
),
pares as (
  select
    i.inicio,
    (
      select min(f.criado_em) from fluxo f
      where f.lead_id = i.lead_id
        and f.tipo = 'mensagem_enviada'
        and f.criado_em > i.inicio
    ) as resposta
  from inicios i
),
validos as (
  select extract(epoch from (resposta - inicio)) / 60 as minutos
  from pares
  where resposta is not null
    and resposta >= inicio
    and resposta - inicio <= interval '7 days'
)
select jsonb_build_object(
  'por_autor', (
    select coalesce(jsonb_agg(jsonb_build_object(
      'autor_id', a.autor_id,
      'total', a.total,
      'hoje', a.hoje
    )), '[]'::jsonb)
    from (
      select
        autor_id,
        count(*) as total,
        count(*) filter (where criado_em >= p_inicio_hoje) as hoje
      from lead_interactions
      where tipo = 'mensagem_enviada' and criado_em >= p_inicio
      group by autor_id
    ) a
  ),
  'enviadas_total', (
    select count(*) from lead_interactions
    where tipo = 'mensagem_enviada' and criado_em >= p_inicio
  ),
  'mediana_min', (select percentile_cont(0.5) within group (order by minutos) from validos),
  'respostas', (select count(*) from validos)
)
$$;

revoke execute on function relatorio_equipe_30d(timestamptz, timestamptz) from public, anon;
grant execute on function relatorio_equipe_30d(timestamptz, timestamptz) to authenticated;
