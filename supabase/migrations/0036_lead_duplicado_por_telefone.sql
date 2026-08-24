-- =============================================================================
-- Dois cards para a mesma pessoa
-- =============================================================================
-- Aconteceu de verdade em 24/08: o Heberson conversava com o Aikon desde 20/08
-- num lead criado pelo webhook com o número SEM o nono dígito (559491630382).
-- Alguém cadastrou o mesmo número à mão COM o nono dígito (5594991630382), o
-- CRM aceitou como pessoa nova, e ele recebeu um template de abertura no meio
-- de um atendimento em andamento. A resposta dele caiu no card antigo, porque
-- é aquele número que o WhatsApp usa — então o card novo ficava mudo para
-- sempre. Três pares assim existiam na base.
--
-- A 0026 já ensinou o banco que as duas grafias são a mesma pessoa, mas só na
-- hora de VINCULAR lead e cliente. Faltava usar a mesma régua na hora de
-- CRIAR o lead. Aqui vão as três peças que faltavam:
--
--   1. variantes_telefone deixa de inventar nono dígito para telefone fixo;
--   2. mesclar_leads junta dois cards sem perder histórico;
--   3. gerar_leads_reativacao procura o lead pelas duas grafias.
--
-- Script reexecutável.
-- =============================================================================

-- 1. Nono dígito só existe em celular -----------------------------------------
-- Fixo é 55 + DDD + 8 dígitos começando em 2..5; celular antigo, em 6..9.
-- Somar um 9 a um fixo cria um número que é de OUTRA pessoa — e era isso que a
-- versão da 0026 fazia com todo número de 12 dígitos.

create or replace function variantes_telefone(tel text)
returns text[]
language sql
immutable
as $$
  select case
    when tel is null then array[]::text[]
    when tel like '55%' and length(tel) = 12
     and substr(tel, 5, 1) between '6' and '9'
      then array[tel, substr(tel, 1, 4) || '9' || substr(tel, 5)]
    when tel like '55%' and length(tel) = 13 and substr(tel, 5, 1) = '9'
      then array[tel, substr(tel, 1, 4) || substr(tel, 6)]
    else array[tel]
  end
$$;

-- 2. Juntar dois cards --------------------------------------------------------
-- Nada de histórico se perde: as conversas, tarefas, etiquetas, agendamentos e
-- vendas do card removido passam para o mantido ANTES do delete. Sem isso o
-- `on delete cascade` levaria a conversa junto.
--
-- Ordem importa nas tabelas de chave composta (lead_tags, followup_envios,
-- campanha_envios): primeiro apaga do removido o que o mantido já tem, senão o
-- update esbarra na chave primária. Foi o mesmo tropeço da mesclar_clientes.

create or replace function mesclar_leads(manter uuid, remover uuid)
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  if manter is null or remover is null or manter = remover then
    return;
  end if;

  delete from lead_tags r using lead_tags k
    where r.lead_id = remover and k.lead_id = manter and k.tag_id = r.tag_id;
  update lead_tags set lead_id = manter where lead_id = remover;

  delete from followup_envios r using followup_envios k
    where r.lead_id = remover and k.lead_id = manter and k.rule_id = r.rule_id;
  update followup_envios set lead_id = manter where lead_id = remover;

  delete from campanha_envios r using campanha_envios k
    where r.lead_id = remover and k.lead_id = manter
      and k.campanha_id = r.campanha_id;
  update campanha_envios set lead_id = manter where lead_id = remover;

  update lead_interactions set lead_id = manter where lead_id = remover;
  update lead_tasks         set lead_id = manter where lead_id = remover;
  update scheduled_messages set lead_id = manter where lead_id = remover;
  update sales              set lead_id = manter where lead_id = remover;

  -- O card mantido herda o que só o removido tinha. Ganho não se perde numa
  -- fusão: se qualquer um dos dois abriu conta, o resultado abriu conta.
  update leads k
  set telefone_e164         = coalesce(k.telefone_e164, r.telefone_e164),
      email                 = coalesce(k.email, r.email),
      documento             = coalesce(k.documento, r.documento),
      customer_id           = coalesce(k.customer_id, r.customer_id),
      cliente_confirmado_em = coalesce(k.cliente_confirmado_em,
                                      r.cliente_confirmado_em),
      instagram_id          = coalesce(k.instagram_id, r.instagram_id),
      instagram_usuario     = coalesce(k.instagram_usuario, r.instagram_usuario),
      chatwoot_contact_id   = coalesce(k.chatwoot_contact_id,
                                       r.chatwoot_contact_id),
      chatwoot_conversation_id = coalesce(k.chatwoot_conversation_id,
                                          r.chatwoot_conversation_id),
      whatsapp_instance_id  = coalesce(k.whatsapp_instance_id,
                                       r.whatsapp_instance_id),
      responsavel_id        = coalesce(k.responsavel_id, r.responsavel_id),
      channel_id            = coalesce(k.channel_id, r.channel_id),
      campanha              = coalesce(k.campanha, r.campanha),
      observacao            = coalesce(k.observacao, r.observacao),
      status                = case when r.status = 'ganho' then 'ganho'
                                   else k.status end,
      primeira_resposta_em  = least(k.primeira_resposta_em,
                                    r.primeira_resposta_em),
      ultima_interacao_em   = greatest(k.ultima_interacao_em,
                                       r.ultima_interacao_em),
      criado_em             = least(k.criado_em, r.criado_em)
  from leads r
  where k.id = manter and r.id = remover;

  delete from leads where id = remover;
end;
$$;

revoke execute on function mesclar_leads(uuid, uuid) from public, anon;

-- 3. Resgate procura o lead pelas duas grafias --------------------------------
-- A função da 0034 casava o lead do cliente por telefone EXATO. Cliente cujo
-- card nasceu no WhatsApp (sem o nono dígito) não era encontrado e ganhava um
-- segundo card na coluna Resgate — com outro dono. Foi assim que o Josemar
-- acabou com um card para o Aikon e outro para o Artur.

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
