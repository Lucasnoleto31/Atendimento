-- =============================================================================
-- Fase 0 da reestruturação: o kanban vira espelho e para de mentir
-- =============================================================================
-- Aprovada na auditoria de 28/08. Este script faz, nesta ordem:
--
--   1. GATILHOS DO ESPELHO — o quadro passa a se mover pelos fatos:
--      · cliente respondeu           → sai de Novo para Em Contato
--      · lead virou cliente          → vai para Ativação (sem 1º giro)
--                                      ou sai do funil (já girando)
--      · cliente girou o 1º lote     → o card sai do funil
--      O único gesto humano que resta é marcar Perdido, com motivo (0038).
--
--   2. LIMPEZA DO ESTOQUE — aplica as mesmas regras ao que já existe:
--      ganhos estacionados, leads mortos de "Novo", canal dos importados.
--
--   3. APOSENTA O KANBAN CARTEIRA — 3 colunas zeradas e 1.183 cards numa só
--      não é quadro, é depósito. A retenção vive em /carteira, nas listas e
--      nas tarefas (que agora sempre nascem com dono).
--
--   4. AUDITORIA E HIGIENE — trilha de exportação, índices para as consultas
--      quentes, WITH CHECK em vendas, settings documentadas em migração.
--
-- Script reexecutável.
-- =============================================================================

-- 1a. Respondeu → Em Contato --------------------------------------------------
create or replace function lead_respondeu_avanca()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  primeira uuid;
  segunda  uuid;
begin
  if new.tipo <> 'mensagem_recebida' then
    return new;
  end if;

  select s.id into primeira
  from pipeline_stages s
  join pipelines p on p.id = s.pipeline_id and p.padrao
  order by s.ordem limit 1;

  select s.id into segunda
  from pipeline_stages s
  join pipelines p on p.id = s.pipeline_id and p.padrao
  order by s.ordem offset 1 limit 1;

  if primeira is null or segunda is null then
    return new;
  end if;

  -- Em Novo e respondeu: avança. Sem coluna e respondeu: entra no quadro —
  -- não-cliente vai para Em Contato; cliente sem 1º giro vai direto para a
  -- fila de Ativação; cliente girando fica fora (é carteira, não funil).
  update leads l
  set stage_id = case
        when l.customer_id is null then segunda
        else (
          select s.id from pipeline_stages s
          join pipelines p on p.id = s.pipeline_id and p.padrao
          where s.nome = 'Ativação' limit 1
        )
      end,
      entrou_na_etapa_em = now(),
      status = case when l.status = 'novo' then 'em_atendimento' else l.status end
  where l.id = new.lead_id
    and (
      l.stage_id = primeira
      or (
        l.stage_id is null
        and l.status not in ('perdido')
        and (
          l.customer_id is null
          or exists (
            select 1 from v_customer_giro g
            where g.customer_id = l.customer_id and g.ultimo_giro_em is null
          )
        )
      )
    );

  return new;
end;
$$;

drop trigger if exists interacoes_lead_respondeu on lead_interactions;
create trigger interacoes_lead_respondeu
  after insert on lead_interactions
  for each row execute function lead_respondeu_avanca();

-- 1b. Virou cliente → Ativação (ou fora do funil, se já gira) -----------------
-- "zzz" no nome: BEFORE roda em ordem alfabética e este precisa vir DEPOIS
-- de leads_zz_marcar_ganho, que é quem carimba o status.
create or replace function lead_ganho_espelha_etapa()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  ativacao uuid;
  girou    boolean;
begin
  if new.customer_id is null or old.customer_id is not distinct from new.customer_id then
    return new;
  end if;

  -- Só mexe em quem está nas colunas de conversa (ou sem coluna): quem já
  -- foi marcado à mão em Conta Aberta/Ativação/Perdido fica onde está.
  if new.stage_id is not null and not exists (
    select 1 from pipeline_stages s
    join pipelines p on p.id = s.pipeline_id and p.padrao
    where s.id = new.stage_id and s.nome in ('Novo', 'Em Contato')
  ) then
    return new;
  end if;

  select (g.ultimo_giro_em is not null) into girou
  from v_customer_giro g where g.customer_id = new.customer_id;

  if coalesce(girou, false) then
    -- Já opera: não é atendimento, é carteira. Sai do quadro.
    new.stage_id = null;
  else
    select s.id into ativacao
    from pipeline_stages s
    join pipelines p on p.id = s.pipeline_id and p.padrao
    where s.nome = 'Ativação'
    limit 1;
    if ativacao is not null then
      new.stage_id = ativacao;
      new.entrou_na_etapa_em = now();
    end if;
  end if;

  return new;
end;
$$;

drop trigger if exists leads_zzz_espelha_etapa on leads;
create trigger leads_zzz_espelha_etapa
  before update on leads
  for each row execute function lead_ganho_espelha_etapa();

-- 1c. Girou o 1º lote → sai do funil ------------------------------------------
-- Por STATEMENT, não por linha: a importação de lotes insere milhares de
-- linhas de uma vez e o gatilho roda uma única vez sobre o conjunto.
create or replace function lotes_tiram_do_funil()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  update leads l
  set stage_id = null
  from pipeline_stages s
  join pipelines p on p.id = s.pipeline_id and p.padrao
  where s.id = l.stage_id
    and s.nome in ('Novo', 'Em Contato', 'Conta Aberta', 'Ativação')
    and l.customer_id in (select distinct customer_id from lotes_novos);
  return null;
end;
$$;

drop trigger if exists customer_lots_saem_do_funil on customer_lots;
create trigger customer_lots_saem_do_funil
  after insert on customer_lots
  referencing new table as lotes_novos
  for each statement execute function lotes_tiram_do_funil();

-- 2. Limpeza do estoque atual -------------------------------------------------
do $$
declare
  p_id uuid;
  s_novo uuid; s_contato uuid; s_conta uuid; s_ativ uuid;
begin
  select id into p_id from pipelines where padrao limit 1;
  if p_id is null then return; end if;
  select id into s_novo    from pipeline_stages where pipeline_id = p_id and nome = 'Novo';
  select id into s_contato from pipeline_stages where pipeline_id = p_id and nome = 'Em Contato';
  select id into s_conta   from pipeline_stages where pipeline_id = p_id and nome = 'Conta Aberta';
  select id into s_ativ    from pipeline_stages where pipeline_id = p_id and nome = 'Ativação';

  -- Cliente que já gira não é card de atendimento, esteja onde estiver.
  update leads l
  set stage_id = null
  from v_customer_giro g
  where g.customer_id = l.customer_id
    and g.ultimo_giro_em is not null
    and l.stage_id in (s_novo, s_contato, s_conta, s_ativ);

  -- Cliente sem giro estacionado nas colunas de conversa vai para Ativação.
  update leads l
  set stage_id = s_ativ, entrou_na_etapa_em = now()
  from v_customer_giro g
  where g.customer_id = l.customer_id
    and g.ultimo_giro_em is null
    and l.stage_id in (s_novo, s_contato);

  -- Lead importado que nunca teve interação não é fila de ninguém: sai do
  -- quadro e fica nas listas ("Nunca contatados"), que é o público das
  -- campanhas. O quadro volta a mostrar só o que é acionável.
  update leads
  set stage_id = null
  where stage_id = s_novo
    and ultima_interacao_em is null
    and customer_id is null;

  -- Importados sem canal entram como Lista interna: o relatório de origem
  -- deixa de ter um buraco de 932 leads.
  update leads
  set channel_id = (select id from channels where slug = 'lista_interna')
  where channel_id is null
    and entrada_motivo = 'importacao';
end;
$$;

-- 3. Aposenta o kanban Carteira ----------------------------------------------
-- O FK de leads.stage_id é ON DELETE SET NULL: os 1.183 cards de Resgate
-- ficam sem coluna e continuam vivos em /carteira, nas listas e nas tarefas.
delete from pipelines where nome = 'Carteira' and not padrao;

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

  -- O kanban Carteira foi aposentado (0040): lead de resgate não tem coluna.
  -- A fila vive nas listas de /leads e nas tarefas 'Resgatar:' com dono.
  etapa_resgate := null;
  etapa_padrao := null;
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
      -- congelava o cliente para sempre. O cooldown de verdade é o
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

    -- As duas grafias do celular: o card do WhatsApp costuma estar sem o nono
    -- dígito e o da planilha com ele. Comparar por igualdade exata criava um
    -- segundo card para quem já estava sendo atendido.
    select l.id, l.responsavel_id into lead_alvo
    from leads l
    where l.customer_id = cand.customer_id
       or (cand.telefone_e164 is not null
           and l.telefone_e164 = any (variantes_telefone(cand.telefone_e164)))
    order by l.criado_em desc
    limit 1;

    if lead_alvo.id is not null then
      -- Reabre o lead existente SEM mexer na coluna: se ele está na fila de
      -- Ativação, o resgate não pode roubá-lo de lá — o quadro é do espelho.
      update leads
      set entrada_motivo = motivo_atual,
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
      coalesce(
        lead_alvo.responsavel_id,
        cand.dono,
        (select id from profiles where ativo and papel in ('gestor','admin')
         order by nome limit 1)
      )
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

-- 4a. Trilha de auditoria -----------------------------------------------------
create table if not exists auditoria (
  id        uuid primary key default gen_random_uuid(),
  quem      uuid references profiles (id) on delete set null,
  acao      text not null,
  detalhes  jsonb not null default '{}'::jsonb,
  criado_em timestamptz not null default now()
);
create index if not exists auditoria_quem_idx on auditoria (quem, criado_em desc);
alter table auditoria enable row level security;
drop policy if exists gestao on auditoria;
create policy gestao on auditoria
  for select to authenticated using (sou_gestor());
-- Escrita só pelo servidor (service role); ninguém edita trilha.

-- 4b. Índices para as consultas quentes de amanhã -----------------------------
create index if not exists leads_ultima_interacao_idx
  on leads (ultima_interacao_em desc nulls last);
create index if not exists leads_criado_idx on leads (criado_em desc);
create index if not exists sales_lead_idx on sales (lead_id);
create index if not exists sales_customer_idx on sales (customer_id);
create index if not exists lead_tasks_lead_idx on lead_tasks (lead_id);
create index if not exists scheduled_messages_lead_idx on scheduled_messages (lead_id);
create index if not exists followup_envios_rule_idx on followup_envios (rule_id);

-- 4c. Vendedor não edita a própria comissão -----------------------------------
drop policy if exists venda_edicao on sales;
create policy venda_edicao on sales
  for update to authenticated
  using (vendedor_id = auth.uid() or sou_gestor())
  with check (vendedor_id = auth.uid() or sou_gestor());

-- 4d. Settings que nasceram fora de migração ficam documentadas ---------------
insert into settings (chave, valor) values
  ('distribuicao_automatica', '1'::jsonb),
  ('minutos_alerta_espera', '15'::jsonb)
on conflict (chave) do nothing;

-- 4e. View antiga substituída pela v_leads_listas (0032) ----------------------
drop view if exists v_listas_atendimento;

-- 4f. Expurgo de webhooks processados com mais de 30 dias ---------------------
delete from webhook_events
where processado and recebido_em < now() - interval '30 days';
