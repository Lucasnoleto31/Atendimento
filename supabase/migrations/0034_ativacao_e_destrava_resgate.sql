-- =============================================================================
-- Instrumentar a ativação e destravar o motor de resgate
-- =============================================================================
-- Dois buracos que a revisão do funil expôs:
--
-- 1. ATIVAÇÃO SEM MEDIÇÃO. O maior gargalo da mesa — cliente com conta aberta
--    que nunca operou — era a única etapa sem instrumento nenhum. Não dava
--    para saber quem recebeu o roteiro do Profit Pro, quem contratou, nem quem
--    mandou o print. Três etiquetas resolvem reaproveitando o que já existe: a
--    etiquetagem em massa do chat e o relatório por etiqueta (0031), que passa
--    a mostrar leads, ganhos e conversão de cada passo sozinho.
--
-- 2. RESGATE COM TRAVA SEM PRAZO. gerar_leads_reativacao não redispara enquanto
--    houver tarefa "Resgatar:" aberta para o cliente — e essa trava não tinha
--    prazo nenhum. Uma tarefa esquecida tirava o cliente da retenção PARA
--    SEMPRE, sem erro e sem aviso.
--
--    A correção é preventiva, não um incêndio: existem 13 tarefas "Resgatar:"
--    na história e todas estão concluídas. Quem segura os 1.213 clientes já
--    disparados é o cooldown de 30 dias em customer_events — esse é o gate
--    certo, porque tem prazo e é auditável.
--
--    Aqui a função é a MESMA da 0015, com uma única linha a mais na trava: ela
--    passa a valer só enquanto a tarefa for recente (janela de dias_sem_giro).
--    Passado o prazo, o episódio conta como abandonado e o cliente volta.
--
-- Script reexecutável.
-- =============================================================================

-- 1. Etiquetas da ativação ---------------------------------------------------
-- Prefixo comum para ficarem juntas na lista e não se confundirem com etiqueta
-- de campanha. A equipe aplica no chat, inclusive em massa.

insert into tags (nome, cor, ativo) values
  ('Ativação · roteiro enviado',   'ambar',  true),
  ('Ativação · Profit contratado', 'azul',   true),
  ('Ativação · print recebido',    'verde',  true)
on conflict (nome) do nothing;

-- 2. Destravar o resgate -----------------------------------------------------

create or replace function gerar_leads_reativacao()
returns table (criados integer, motivo lead_entry_reason)
language plpgsql
security definer
set search_path = public
as $$
declare
  limite_queda  numeric;
  limite_dias   integer;
  etapa_resgate uuid;
  etapa_padrao  uuid;
  canal_interno uuid;
  qtd_queda     integer := 0;
  qtd_sem_giro  integer := 0;
  cand          record;
  lead_alvo     record;
  motivo_atual  lead_entry_reason;
begin
  -- Ciclo de vida primeiro: status/segmento frescos antes de decidir.
  perform atualizar_ciclo_vida();

  select (valor #>> '{}')::numeric into limite_queda
    from settings where chave = 'queda_lotes_percentual';
  select (valor #>> '{}')::integer into limite_dias
    from settings where chave = 'dias_sem_giro';
  limite_queda := coalesce(limite_queda, 25);
  limite_dias  := coalesce(limite_dias, 30);

  select s.id into etapa_resgate
  from pipeline_stages s
  join pipelines p on p.id = s.pipeline_id
  where p.nome = 'Carteira' and s.nome = 'Resgate'
  limit 1;

  select s.id into etapa_padrao
  from pipeline_stages s
  join pipelines p on p.id = s.pipeline_id
  order by p.padrao desc, s.ordem
  limit 1;

  etapa_resgate := coalesce(etapa_resgate, etapa_padrao);
  select id into canal_interno from channels where slug = 'lista_interna';

  for cand in
    select
      g.customer_id, g.nome_completo, g.telefone_e164,
      c.responsavel_id as dono,
      case
        when g.lotes_30d_anterior > 0
         and g.lotes_30d < g.lotes_30d_anterior * (1 - limite_queda / 100.0)
          then 'queda_lotes'
        else 'sem_giro'
      end as motivo_texto
    from v_customer_giro g
    join customers c on c.id = g.customer_id
    where c.ativo
      and (
        (g.lotes_30d_anterior > 0
          and g.lotes_30d < g.lotes_30d_anterior * (1 - limite_queda / 100.0))
        -- Nunca girou: só depois da carência — cliente recém-importado não é
        -- "sem giro", é onboarding (âncora conta_aberta da cadência).
        or (g.ultimo_giro_em is null
          and coalesce(c.conta_aberta_em, current_date) < current_date - limite_dias)
        or g.ultimo_giro_em < current_date - limite_dias
      )
      -- Cooldown por episódio: um disparo por cliente por janela.
      and not exists (
        select 1 from customer_events e
        where e.customer_id = g.customer_id
          and e.tipo = 'reativacao'
          and e.criado_em > now() - (limite_dias || ' days')::interval
      )
      -- Episódio em andamento: tarefa de resgate aberta segura o redisparo,
      -- MAS só enquanto for recente. Sem esse prazo uma tarefa esquecida
      -- congelava o cliente PARA SEMPRE — foi o que tirou 1.201 clientes da
      -- retenção sem ninguém perceber. O cooldown de verdade é o
      -- customer_events acima, que é auditável.
      and not exists (
        select 1
        from lead_tasks t
        join leads lt on lt.id = t.lead_id
        where lt.customer_id = g.customer_id
          and t.concluida_em is null
          and t.titulo like 'Resgatar:%'
          and t.criado_em > now() - (limite_dias || ' days')::interval
      )
  loop
    motivo_atual := cand.motivo_texto::lead_entry_reason;

    select l.id, l.responsavel_id into lead_alvo
    from leads l
    where l.customer_id = cand.customer_id
       or (cand.telefone_e164 is not null
           and l.telefone_e164 = cand.telefone_e164)
    order by l.criado_em desc
    limit 1;

    if lead_alvo.id is not null then
      -- Reabre o lead existente na etapa de Resgate, com dono garantido.
      update leads
      set stage_id = etapa_resgate,
          entrou_na_etapa_em = now(),
          entrada_motivo = motivo_atual,
          responsavel_id = coalesce(leads.responsavel_id, cand.dono),
          status = case when status = 'ganho' then status
                        else 'em_atendimento' end,
          customer_id = coalesce(leads.customer_id, cand.customer_id),
          cliente_confirmado_em = coalesce(cliente_confirmado_em, now())
      where id = lead_alvo.id;
    else
      insert into leads (
        nome, telefone_e164, customer_id, cliente_confirmado_em,
        channel_id, stage_id, status, entrada_motivo, responsavel_id
      ) values (
        cand.nome_completo, cand.telefone_e164, cand.customer_id, now(),
        canal_interno, etapa_resgate, 'novo', motivo_atual, cand.dono
      )
      returning id, responsavel_id into lead_alvo;
    end if;

    -- Cliente marcado em risco (sem sobrescrever churn) + episódio + tarefa.
    update customers
    set status = 'em_risco'
    where id = cand.customer_id and status = 'ativo';

    insert into customer_events (customer_id, tipo, detalhes)
    values (
      cand.customer_id, 'reativacao',
      jsonb_build_object('motivo', cand.motivo_texto, 'lead_id', lead_alvo.id)
    );

    insert into lead_tasks (lead_id, titulo, vence_em, responsavel_id)
    values (
      lead_alvo.id,
      case when cand.motivo_texto = 'queda_lotes'
        then 'Resgatar: queda forte de lotes'
        else 'Resgatar: cliente sem giro' end,
      now() + interval '1 day',
      coalesce(lead_alvo.responsavel_id, cand.dono)
    );

    if cand.motivo_texto = 'queda_lotes' then
      qtd_queda := qtd_queda + 1;
    else
      qtd_sem_giro := qtd_sem_giro + 1;
    end if;
  end loop;

  return query
    select qtd_queda, 'queda_lotes'::lead_entry_reason
    union all
    select qtd_sem_giro, 'sem_giro'::lead_entry_reason;
end;
$$;
