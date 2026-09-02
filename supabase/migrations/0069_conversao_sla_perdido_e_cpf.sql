-- =============================================================================
-- 0069: Conversão (item 3) — SLA de primeiro contato, perdido que volta e CPF
-- =============================================================================
-- Três buracos que custam dinheiro, na ordem em que sangram:
--
--   1. Ninguém é avisado quando um lead novo fica esperando o PRIMEIRO
--      contato. O campo "minutos_alerta_espera" existe em Configurações
--      desde a 0040 e NENHUMA linha de código lê ele — botão morto. Para
--      medir isso falta um fato: quando falamos com o lead pela primeira
--      vez. Nasce aqui como leads.primeiro_contato_em.
--   2. Lead marcado como perdido que volta a responder CONTINUA perdido: a
--      mensagem entra, ninguém é avisado, e ele fica fora de tudo. Quem
--      reabre é o webhook (código), com o interruptor abaixo.
--   3. Perdido nunca volta para a nutrição — mesmo o que sumiu há meses.
--
-- A trava de CPF fica na aplicação, de propósito: um índice único aqui
-- recusaria a importação da Genial inteira quando ela trouxer um documento
-- repetido. O aviso na tela resolve o caso real (briga de comissão) sem
-- travar o motor.
--
-- Script reexecutável.
-- =============================================================================

-- 1. Quando falamos com o lead pela primeira vez ------------------------------
alter table leads add column if not exists primeiro_contato_em timestamptz;

create or replace function leads_carimbar_primeiro_contato()
returns trigger
language plpgsql
set search_path = public
as $$
begin
  if new.tipo = 'mensagem_enviada' then
    update leads
    set primeiro_contato_em = new.criado_em
    where id = new.lead_id and primeiro_contato_em is null;
  end if;
  return new;
end;
$$;

drop trigger if exists interacoes_primeiro_contato on lead_interactions;
create trigger interacoes_primeiro_contato
  after insert on lead_interactions
  for each row execute function leads_carimbar_primeiro_contato();

-- Acerto do estoque: a primeira mensagem enviada de cada lead que já existe.
update leads l
set primeiro_contato_em = p.em
from (
  select lead_id, min(criado_em) as em
  from lead_interactions
  where tipo = 'mensagem_enviada'
  group by lead_id
) p
where p.lead_id = l.id and l.primeiro_contato_em is null;

-- O SLA varre "lead sem primeiro contato" ordenado por entrada.
create index if not exists leads_sem_primeiro_contato_idx
  on leads (criado_em)
  where primeiro_contato_em is null;

-- 2. Réguas de conversão, editáveis em Configurações ---------------------------
-- minutos_alerta_espera (0040, hoje morto) passa a ser o ALARME vermelho.
insert into settings (chave, valor, atualizado_em) values
  ('sla_atencao_min',              '5'::jsonb,  now()),
  ('sla_horario_comercial',        '1'::jsonb,  now()),
  ('reabrir_perdido_ao_responder', '1'::jsonb,  now()),
  ('nutrir_perdido_apos_dias',     '30'::jsonb, now()),
  ('travar_cpf_duplicado',         '1'::jsonb,  now())
on conflict (chave) do nothing;

insert into settings (chave, valor, atualizado_em)
values ('minutos_alerta_espera', '15'::jsonb, now())
on conflict (chave) do nothing;

comment on column leads.primeiro_contato_em is
  'Primeira mensagem NOSSA para este lead (trigger interacoes_primeiro_contato). '
  'Null = ninguém falou com ele ainda — é o que o SLA de primeiro contato mede.';

-- 3. Lead Ads: origem própria para o formulário do Facebook/Instagram --------
-- Sem isso o lead do anúncio entraria como "manual" e sumiria no relatório
-- por origem, que é onde se decide onde colocar verba.
alter type lead_entry_reason add value if not exists 'meta_lead_ads';
