-- =============================================================================
-- 0064: relatorio_equipe_30d sem a subconsulta quadrática
-- =============================================================================
-- A mediana da 1ª resposta (0059) buscava, para CADA início de conversa, a
-- próxima enviada com uma subconsulta correlacionada sobre o CTE `fluxo` —
-- CTE não tem índice, então cada busca varria as ~13 mil linhas do mês
-- inteiro: custo quadrático. Medido em produção: 5,7s com service role; como
-- usuário logado estourava o statement_timeout, a página caía no fallback
-- "cru" (baixa as 13 mil linhas paginadas) e o total passava do limite da
-- Vercel — os Relatórios simplesmente não abriam.
--
-- A reescrita entrega a mesma resposta com UMA janela: para cada linha, a
-- menor `criado_em` de enviada nas linhas seguintes do mesmo lead. Validado
-- contra o dado real: 1561 respostas e mediana 9,44 min nas duas versões.
--
-- Única diferença teórica: recebida e enviada com o MESMO timestamp (até o
-- microssegundo) — impossível na prática, os dois lados nascem em inserts
-- distintos.
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
  -- Ordem DESCENDENTE de propósito: com o frame "unbounded preceding..1
  -- preceding" o conjunto agregado só cresce linha a linha, e o min() vira
  -- incremental (O(n)) — o frame "following" recomputaria o min a cada
  -- linha (quadrático dentro de um lead falador). Na ordem invertida,
  -- lead() é a linha ANTERIOR do tempo real, e o frame "preceding" são as
  -- linhas POSTERIORES do tempo real.
  select
    tipo, criado_em,
    lead(tipo) over (partition by lead_id order by criado_em desc, id desc)
      as tipo_ant,
    min(criado_em) filter (where tipo = 'mensagem_enviada')
      over (partition by lead_id order by criado_em desc, id desc
            rows between unbounded preceding and 1 preceding) as resposta
  from lead_interactions
  where tipo in ('mensagem_recebida', 'mensagem_enviada')
    and criado_em >= p_inicio
),
validos as (
  -- primeira recebida de cada sequência abre a espera; a enviada seguinte
  -- fecha; pares fora de 0..7 dias caem fora (importação retroativa e
  -- conversa retomada não são "resposta").
  select extract(epoch from (resposta - criado_em)) / 60 as minutos
  from fluxo
  where tipo = 'mensagem_recebida'
    and (tipo_ant is null or tipo_ant = 'mensagem_enviada')
    and resposta is not null
    and resposta > criado_em
    and resposta - criado_em <= interval '7 days'
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

-- O índice (tipo, criado_em) já existe desde a 0058 — a lentidão era 100%
-- da subconsulta quadrática, não de índice faltando.
