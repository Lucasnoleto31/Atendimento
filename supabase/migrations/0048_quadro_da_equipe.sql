-- =============================================================================
-- Hoje, fase 4: o quadro da equipe numa chamada só
-- =============================================================================
-- O gestor vê, acima das filas, uma linha por pessoa ativa: mensagens
-- manuais do dia contra a meta, quantos aguardam resposta (e a espera mais
-- longa), tarefas vencidas e clientes com giro em risco. Uma função, um
-- round-trip — nada de N consultas por pessoa.
--
-- SECURITY DEFINER com porteiro embutido: a função enxerga tudo, mas só
-- devolve linhas se quem chama é gestor/admin (auth.uid() consultado na
-- própria função). Vendedor que chamar recebe vazio.
--
-- Script reexecutável.
-- =============================================================================

create or replace function quadro_equipe(p_inicio timestamptz)
returns table (
  responsavel_id    uuid,
  nome              text,
  meta_contatos_dia integer,
  mensagens_manuais integer,
  mensagens_disparo integer,
  aguardando        integer,
  espera_max_horas  numeric,
  tarefas_vencidas  integer,
  giro_em_risco     integer
)
language sql
stable
security definer
set search_path = public
as $$
  with sou_gestor as (
    select 1 from profiles me
    where me.id = auth.uid() and me.papel in ('admin', 'gestor')
  ),
  pessoas as (
    select id, nome, coalesce(meta_contatos_dia, 0) as meta
    from profiles where ativo and exists (select 1 from sou_gestor)
  ),
  msgs as (
    select i.autor_id,
           count(*) filter (
             where coalesce(i.metadados->>'via', 'crm') <> 'disparo'
           ) as manuais,
           count(*) filter (where i.metadados->>'via' = 'disparo') as disparos
    from lead_interactions i
    where i.tipo = 'mensagem_enviada'
      and i.criado_em >= p_inicio
      and i.autor_id is not null
    group by i.autor_id
  ),
  esperas as (
    select v.responsavel_id,
           count(*) as aguardando,
           max(v.horas_esperando) as espera_max
    from v_leads_listas v
    where v.aguardando_resposta
    group by v.responsavel_id
  ),
  vencidas as (
    select t.responsavel_id, count(*) as total
    from lead_tasks t
    where t.concluida_em is null and t.vence_em < now()
    group by t.responsavel_id
  ),
  risco as (
    select c.responsavel_id, count(*) as total
    from v_carteira c
    where c.ultimo_giro_em is not null
      and (
        coalesce(c.lotes_30d, 0) = 0
        or (coalesce(c.lotes_30d_anterior, 0) > 0
            and coalesce(c.lotes_30d, 0) < c.lotes_30d_anterior * 0.75)
      )
    group by c.responsavel_id
  )
  select p.id,
         p.nome,
         p.meta,
         coalesce(m.manuais, 0)::int,
         coalesce(m.disparos, 0)::int,
         coalesce(e.aguardando, 0)::int,
         e.espera_max,
         coalesce(v.total, 0)::int,
         coalesce(r.total, 0)::int
  from pessoas p
  left join msgs m on m.autor_id = p.id
  left join esperas e on e.responsavel_id = p.id
  left join vencidas v on v.responsavel_id = p.id
  left join risco r on r.responsavel_id = p.id
  order by p.nome
$$;

revoke execute on function quadro_equipe(timestamptz) from public, anon;
grant execute on function quadro_equipe(timestamptz) to authenticated;
