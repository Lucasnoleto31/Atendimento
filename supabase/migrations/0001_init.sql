-- =============================================================================
-- Zeve CRM — estrutura inicial
-- =============================================================================
-- Convenções:
--   * dinheiro em CENTAVOS (bigint). Nunca float.
--   * telefone sempre em E.164 sem símbolos: 5511988421170.
--     É a chave de cruzamento entre lead e cliente.
--   * datas de referência de importação são DATE (o lote é diário).
--   * toda tabela tem RLS ligado. Ninguém lê nada sem estar autenticado.
-- =============================================================================

create extension if not exists "pgcrypto";

-- =============================================================================
-- 1. Tipos
-- =============================================================================

create type user_role as enum ('admin', 'gestor', 'vendedor');

create type product_recurrence as enum ('unica', 'recorrente', 'por_operacao');

create type lead_status as enum (
  'novo',
  'em_atendimento',
  'sem_resposta',   -- nunca respondeu a equipe
  'ganho',
  'perdido'
);

-- Por que o lead entrou no CRM. Alimenta as listas de atendimento.
create type lead_entry_reason as enum (
  'manual',
  'importacao',
  'webhook_meta',
  'formulario',
  'queda_lotes',    -- caiu X% de lotes e voltou para a fila
  'sem_giro'        -- não gira há N dias
);

create type interaction_type as enum (
  'mensagem_enviada',
  'mensagem_recebida',
  'nota',
  'mudanca_etapa',
  'atribuicao'
);

create type sale_status as enum ('pendente', 'confirmada', 'cancelada');

create type import_kind as enum ('clientes', 'lotes');

create type import_status as enum ('processando', 'concluida', 'falhou');

-- =============================================================================
-- 2. Equipe
-- =============================================================================

-- Espelha auth.users. O admin cria o usuário; o perfil nasce por trigger.
create table profiles (
  id                    uuid primary key references auth.users (id) on delete cascade,
  nome                  text not null,
  email                 text not null unique,
  papel                 user_role not null default 'vendedor',
  ativo                 boolean not null default true,
  meta_mensal_centavos  bigint not null default 0 check (meta_mensal_centavos >= 0),
  criado_em             timestamptz not null default now(),
  atualizado_em         timestamptz not null default now()
);

comment on column profiles.meta_mensal_centavos is
  'Meta de venda do mês, em centavos. 0 = sem meta definida.';

create index profiles_papel_idx on profiles (papel) where ativo;

-- Até 10 instâncias, cada uma de um vendedor.
create table whatsapp_instances (
  id                    uuid primary key default gen_random_uuid(),
  nome                  text not null,
  telefone_e164         text not null unique,
  meta_phone_number_id  text unique,
  meta_waba_id          text,
  vendedor_id           uuid references profiles (id) on delete set null,
  ativa                 boolean not null default true,
  criado_em             timestamptz not null default now()
);

comment on table whatsapp_instances is
  'Números conectados à Cloud API oficial da Meta. Um vendedor por instância.';

-- =============================================================================
-- 3. Catálogo e configuração
-- =============================================================================

create table products (
  id                        uuid primary key default gen_random_uuid(),
  codigo                    text not null unique,
  nome                      text not null,
  valor_comissao_centavos   bigint not null check (valor_comissao_centavos >= 0),
  recorrencia               product_recurrence not null default 'unica',
  ativo                     boolean not null default true,
  criado_em                 timestamptz not null default now()
);

comment on column products.valor_comissao_centavos is
  'Quanto o vendedor ganha por venda deste produto. Ex.: conta aberta = 1500 (R$ 15,00).';

-- Canais de origem do lead. Fixos o bastante para agrupar relatório e gasto.
create table channels (
  id        uuid primary key default gen_random_uuid(),
  slug      text not null unique,
  nome      text not null,
  ativo     boolean not null default true
);

-- Quanto gastamos para trazer lead, por canal e campanha.
create table channel_spend (
  id                uuid primary key default gen_random_uuid(),
  channel_id        uuid not null references channels (id) on delete cascade,
  campanha          text,
  referencia_data   date not null,
  valor_centavos    bigint not null check (valor_centavos >= 0),
  criado_em         timestamptz not null default now(),
  unique (channel_id, campanha, referencia_data)
);

create table tags (
  id        uuid primary key default gen_random_uuid(),
  nome      text not null unique,
  ativo     boolean not null default true,
  criado_em timestamptz not null default now()
);

comment on table tags is 'Tags que a equipe usa durante a troca de mensagens com o lead.';

create table quick_replies (
  id        uuid primary key default gen_random_uuid(),
  titulo    text not null,
  corpo     text not null,
  ativo     boolean not null default true,
  criado_em timestamptz not null default now()
);

comment on table quick_replies is 'Mensagens padrão para disparar ao lead.';

-- Configuração global chave/valor: limite de queda de lotes, dias sem giro, etc.
create table settings (
  chave       text primary key,
  valor       jsonb not null,
  descricao   text,
  atualizado_em timestamptz not null default now()
);

-- Etapas do kanban. Ordem define a posição da coluna.
create table pipeline_stages (
  id        uuid primary key default gen_random_uuid(),
  nome      text not null,
  ordem     smallint not null unique,
  is_final  boolean not null default false,
  criado_em timestamptz not null default now()
);

-- =============================================================================
-- 4. Base de clientes e lotes
-- =============================================================================

-- Toda importação fica registrada: dá para auditar e refazer.
create table imports (
  id                uuid primary key default gen_random_uuid(),
  tipo              import_kind not null,
  arquivo_nome      text,
  arquivo_path      text,          -- caminho no Supabase Storage
  referencia_data   date not null, -- a que dia o arquivo se refere
  status            import_status not null default 'processando',
  total_linhas      integer not null default 0,
  linhas_ok         integer not null default 0,
  linhas_erro       integer not null default 0,
  erro_detalhe      text,
  criado_por        uuid references profiles (id) on delete set null,
  criado_em         timestamptz not null default now()
);

create index imports_tipo_data_idx on imports (tipo, referencia_data desc);

-- Base de clientes do banco. Telefone é a chave de cruzamento com o lead.
create table customers (
  id                uuid primary key default gen_random_uuid(),
  nome_completo     text not null,
  telefone_e164     text not null unique,
  documento         text,
  email             text,
  conta_aberta_em   date,
  ativo             boolean not null default true,
  dados_extras      jsonb not null default '{}'::jsonb,
  criado_em         timestamptz not null default now(),
  atualizado_em     timestamptz not null default now()
);

comment on column customers.telefone_e164 is
  'Somente dígitos, com DDI. Normalizado na importação.';

-- Lotes por cliente, por dia. Base para detectar queda de giro.
create table customer_lots (
  id                uuid primary key default gen_random_uuid(),
  customer_id       uuid not null references customers (id) on delete cascade,
  referencia_data   date not null,
  quantidade        numeric(14, 4) not null check (quantidade >= 0),
  import_id         uuid references imports (id) on delete set null,
  criado_em         timestamptz not null default now(),
  unique (customer_id, referencia_data)
);

create index customer_lots_data_idx on customer_lots (referencia_data desc);
create index customer_lots_customer_data_idx on customer_lots (customer_id, referencia_data desc);

-- =============================================================================
-- 5. Leads
-- =============================================================================

create table leads (
  id                  uuid primary key default gen_random_uuid(),
  nome                text not null,
  telefone_e164       text not null,
  email               text,

  -- Cruzamento: preenchido quando o telefone bate com a base de clientes.
  customer_id         uuid references customers (id) on delete set null,
  cliente_confirmado_em timestamptz,

  -- Origem
  channel_id          uuid references channels (id) on delete set null,
  campanha            text,
  utm_source          text,
  utm_medium          text,
  utm_campaign        text,
  utm_content         text,
  entrada_motivo      lead_entry_reason not null default 'manual',

  -- Atendimento
  stage_id            uuid references pipeline_stages (id) on delete set null,
  status              lead_status not null default 'novo',
  responsavel_id      uuid references profiles (id) on delete set null,
  whatsapp_instance_id uuid references whatsapp_instances (id) on delete set null,

  primeira_resposta_em timestamptz,   -- null = nunca nos respondeu
  ultima_interacao_em  timestamptz,
  entrou_na_etapa_em   timestamptz not null default now(),

  observacao          text,
  criado_em           timestamptz not null default now(),
  atualizado_em       timestamptz not null default now(),

  unique (telefone_e164)
);

comment on column leads.customer_id is
  'Null = ainda não é cliente. Preenchido pelo cruzamento por telefone.';
comment on column leads.primeira_resposta_em is
  'Null = lead nunca respondeu. Alimenta a lista "nunca nos respondeu".';

create index leads_stage_idx on leads (stage_id, entrou_na_etapa_em desc);
create index leads_responsavel_idx on leads (responsavel_id);
create index leads_status_idx on leads (status);
create index leads_channel_idx on leads (channel_id);
create index leads_customer_idx on leads (customer_id);

create table lead_tags (
  lead_id   uuid not null references leads (id) on delete cascade,
  tag_id    uuid not null references tags (id) on delete cascade,
  criado_em timestamptz not null default now(),
  primary key (lead_id, tag_id)
);

create table lead_interactions (
  id          uuid primary key default gen_random_uuid(),
  lead_id     uuid not null references leads (id) on delete cascade,
  tipo        interaction_type not null,
  conteudo    text,
  autor_id    uuid references profiles (id) on delete set null,
  metadados   jsonb not null default '{}'::jsonb,
  criado_em   timestamptz not null default now()
);

create index lead_interactions_lead_idx on lead_interactions (lead_id, criado_em desc);

-- =============================================================================
-- 6. Vendas e comissão
-- =============================================================================

create table sales (
  id                        uuid primary key default gen_random_uuid(),
  lead_id                   uuid references leads (id) on delete set null,
  customer_id               uuid references customers (id) on delete set null,
  product_id                uuid not null references products (id) on delete restrict,
  vendedor_id               uuid not null references profiles (id) on delete restrict,

  -- Snapshot: se o valor do produto mudar, a comissão já paga não muda.
  valor_comissao_centavos   bigint not null check (valor_comissao_centavos >= 0),
  status                    sale_status not null default 'confirmada',
  ocorreu_em                timestamptz not null default now(),
  observacao                text,
  criado_em                 timestamptz not null default now()
);

create index sales_vendedor_data_idx on sales (vendedor_id, ocorreu_em desc);
create index sales_produto_idx on sales (product_id);
create index sales_data_idx on sales (ocorreu_em desc);

comment on column sales.valor_comissao_centavos is
  'Cópia do valor do produto no momento da venda. Não recalcular a partir de products.';

-- =============================================================================
-- 7. Webhooks da Meta
-- =============================================================================

create table webhook_events (
  id                uuid primary key default gen_random_uuid(),
  origem            text not null default 'meta',
  evento_id         text,
  payload           jsonb not null,
  processado        boolean not null default false,
  erro              text,
  recebido_em       timestamptz not null default now(),
  unique (origem, evento_id)
);

create index webhook_events_pendentes_idx on webhook_events (recebido_em)
  where not processado;

-- =============================================================================
-- 8. Gatilhos de manutenção
-- =============================================================================

create or replace function set_atualizado_em()
returns trigger
language plpgsql
as $$
begin
  new.atualizado_em = now();
  return new;
end;
$$;

create trigger profiles_atualizado_em before update on profiles
  for each row execute function set_atualizado_em();
create trigger customers_atualizado_em before update on customers
  for each row execute function set_atualizado_em();
create trigger leads_atualizado_em before update on leads
  for each row execute function set_atualizado_em();

-- Cria o perfil quando o admin cadastra um usuário no Auth.
create or replace function handle_new_user()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  insert into public.profiles (id, nome, email, papel)
  values (
    new.id,
    coalesce(new.raw_user_meta_data ->> 'nome', split_part(new.email, '@', 1)),
    new.email,
    coalesce((new.raw_user_meta_data ->> 'papel')::user_role, 'vendedor')
  );
  return new;
end;
$$;

create trigger on_auth_user_created
  after insert on auth.users
  for each row execute function handle_new_user();

-- Registra a troca de etapa e reinicia o relógio da coluna.
create or replace function handle_stage_change()
returns trigger
language plpgsql
as $$
begin
  if new.stage_id is distinct from old.stage_id then
    new.entrou_na_etapa_em = now();
    insert into lead_interactions (lead_id, tipo, conteudo, autor_id)
    values (new.id, 'mudanca_etapa', new.stage_id::text, auth.uid());
  end if;
  return new;
end;
$$;

create trigger leads_stage_change before update on leads
  for each row execute function handle_stage_change();

-- Ao inserir/atualizar um lead, tenta casar o telefone com a base de clientes.
create or replace function vincular_cliente_por_telefone()
returns trigger
language plpgsql
as $$
declare
  achou uuid;
begin
  if new.customer_id is null then
    select id into achou from customers where telefone_e164 = new.telefone_e164;
    if achou is not null then
      new.customer_id = achou;
      new.cliente_confirmado_em = now();
    end if;
  end if;
  return new;
end;
$$;

create trigger leads_vincular_cliente before insert or update of telefone_e164 on leads
  for each row execute function vincular_cliente_por_telefone();

-- =============================================================================
-- 9. Visões das listas de atendimento
-- =============================================================================

-- Giro dos últimos 30 dias contra os 30 anteriores, por cliente.
create or replace view v_customer_giro as
select
  c.id as customer_id,
  c.nome_completo,
  c.telefone_e164,
  coalesce(sum(l.quantidade) filter (
    where l.referencia_data > current_date - interval '30 days'
  ), 0) as lotes_30d,
  coalesce(sum(l.quantidade) filter (
    where l.referencia_data <= current_date - interval '30 days'
      and l.referencia_data > current_date - interval '60 days'
  ), 0) as lotes_30d_anterior,
  max(l.referencia_data) filter (where l.quantidade > 0) as ultimo_giro_em
from customers c
left join customer_lots l on l.customer_id = c.id
group by c.id;

comment on view v_customer_giro is
  'Base para a regra de queda: compare lotes_30d com lotes_30d_anterior.';

-- As listas que a equipe atende.
create or replace view v_listas_atendimento as
select
  l.id as lead_id,
  l.nome,
  l.telefone_e164,
  l.status,
  l.responsavel_id,
  case
    when l.customer_id is null then 'nao_cliente'
    when g.ultimo_giro_em is null then 'nunca_girou'
    when g.lotes_30d > 0 then 'girou_30d'
    when g.ultimo_giro_em < current_date - interval '30 days' then 'sem_giro_30d'
    else 'so_abriu_conta'
  end as lista,
  l.primeira_resposta_em is null as nunca_respondeu,
  g.lotes_30d,
  g.lotes_30d_anterior,
  g.ultimo_giro_em
from leads l
left join v_customer_giro g on g.customer_id = l.customer_id;

-- =============================================================================
-- 10. RLS
-- =============================================================================

create or replace function meu_papel()
returns user_role
language sql
stable
security definer
set search_path = public
as $$
  select papel from profiles where id = auth.uid();
$$;

create or replace function sou_gestor()
returns boolean
language sql
stable
as $$
  select meu_papel() in ('admin', 'gestor');
$$;

alter table profiles            enable row level security;
alter table whatsapp_instances  enable row level security;
alter table products            enable row level security;
alter table channels            enable row level security;
alter table channel_spend       enable row level security;
alter table tags                enable row level security;
alter table quick_replies       enable row level security;
alter table settings            enable row level security;
alter table pipeline_stages     enable row level security;
alter table imports             enable row level security;
alter table customers           enable row level security;
alter table customer_lots       enable row level security;
alter table leads               enable row level security;
alter table lead_tags           enable row level security;
alter table lead_interactions   enable row level security;
alter table sales               enable row level security;
alter table webhook_events      enable row level security;

-- Leitura: toda a equipe autenticada enxerga a operação inteira.
-- (Mesa colaborativa: o vendedor precisa ver a fila toda para puxar atendimento.)
create policy leitura_equipe on profiles           for select to authenticated using (true);
create policy leitura_equipe on whatsapp_instances for select to authenticated using (true);
create policy leitura_equipe on products           for select to authenticated using (true);
create policy leitura_equipe on channels           for select to authenticated using (true);
create policy leitura_equipe on channel_spend      for select to authenticated using (sou_gestor());
create policy leitura_equipe on tags               for select to authenticated using (true);
create policy leitura_equipe on quick_replies      for select to authenticated using (true);
create policy leitura_equipe on settings           for select to authenticated using (true);
create policy leitura_equipe on pipeline_stages    for select to authenticated using (true);
create policy leitura_equipe on imports            for select to authenticated using (sou_gestor());
create policy leitura_equipe on customers          for select to authenticated using (true);
create policy leitura_equipe on customer_lots      for select to authenticated using (true);
create policy leitura_equipe on leads              for select to authenticated using (true);
create policy leitura_equipe on lead_tags          for select to authenticated using (true);
create policy leitura_equipe on lead_interactions  for select to authenticated using (true);
create policy leitura_equipe on sales              for select to authenticated using (true);

-- Escrita de atendimento: qualquer um da equipe mexe no lead e no histórico.
create policy escrita_equipe on leads
  for all to authenticated using (true) with check (true);
create policy escrita_equipe on lead_tags
  for all to authenticated using (true) with check (true);
create policy escrita_equipe on lead_interactions
  for all to authenticated using (true) with check (true);

-- Venda: o vendedor lança a própria; gestor lança de qualquer um.
create policy venda_propria on sales
  for insert to authenticated
  with check (vendedor_id = auth.uid() or sou_gestor());
create policy venda_edicao on sales
  for update to authenticated
  using (vendedor_id = auth.uid() or sou_gestor());
create policy venda_exclusao on sales
  for delete to authenticated
  using (sou_gestor());

-- Cadastro e configuração: só gestor/admin.
create policy gestao on products         for all to authenticated using (sou_gestor()) with check (sou_gestor());
create policy gestao on channels         for all to authenticated using (sou_gestor()) with check (sou_gestor());
create policy gestao on channel_spend    for all to authenticated using (sou_gestor()) with check (sou_gestor());
create policy gestao on tags             for all to authenticated using (sou_gestor()) with check (sou_gestor());
create policy gestao on quick_replies    for all to authenticated using (sou_gestor()) with check (sou_gestor());
create policy gestao on settings         for all to authenticated using (sou_gestor()) with check (sou_gestor());
create policy gestao on pipeline_stages  for all to authenticated using (sou_gestor()) with check (sou_gestor());
create policy gestao on whatsapp_instances for all to authenticated using (sou_gestor()) with check (sou_gestor());
create policy gestao on imports          for all to authenticated using (sou_gestor()) with check (sou_gestor());
create policy gestao on customers        for all to authenticated using (sou_gestor()) with check (sou_gestor());
create policy gestao on customer_lots    for all to authenticated using (sou_gestor()) with check (sou_gestor());

-- Perfil: cada um edita o próprio nome; papel e meta só o admin muda.
create policy perfil_proprio on profiles
  for update to authenticated
  using (id = auth.uid() or meu_papel() = 'admin')
  with check (id = auth.uid() or meu_papel() = 'admin');

-- webhook_events não tem policy: só o service_role (rota de API) escreve.

-- =============================================================================
-- 11. Dados iniciais
-- =============================================================================

insert into pipeline_stages (nome, ordem, is_final) values
  ('Novos', 1, false),
  ('Em contato', 2, false),
  ('Em negociação', 3, false),
  ('Aguardando documentos', 4, false),
  ('Conta aberta', 5, true),
  ('Perdido', 6, true);

insert into channels (slug, nome) values
  ('meta_ads', 'Meta Ads'),
  ('google_ads', 'Google Ads'),
  ('indicacao', 'Indicação'),
  ('site', 'Site'),
  ('organico', 'Orgânico'),
  ('lista_interna', 'Lista interna');

insert into settings (chave, valor, descricao) values
  ('queda_lotes_percentual', '25'::jsonb,
   'Queda percentual de lotes em 30 dias que joga o cliente de volta na fila.'),
  ('dias_sem_giro', '30'::jsonb,
   'Dias sem girar para o cliente entrar na lista de reativação.'),
  ('dias_sem_resposta', '3'::jsonb,
   'Dias sem resposta do lead para marcá-lo como sem_resposta.');
