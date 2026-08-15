-- =============================================================================
-- Contas por cliente
-- =============================================================================
-- O arquivo real da corretora (modelo_contratos.xlsx) identifica o cliente pela
-- CONTA, não pelo telefone — e um cliente pode ter várias contas. O telefone
-- passa a ser opcional (segue único quando existe) e vira a ponte com o lead
-- do WhatsApp; a conta vira a ponte com os lotes.
-- =============================================================================

-- Telefone opcional, único apenas quando preenchido.
alter table customers alter column telefone_e164 drop not null;
alter table customers drop constraint customers_telefone_e164_key;
create unique index customers_telefone_unq
  on customers (telefone_e164)
  where telefone_e164 is not null;

-- Contas da corretora, N por cliente.
create table customer_accounts (
  conta        text primary key,
  customer_id  uuid not null references customers (id) on delete cascade,
  criado_em    timestamptz not null default now()
);

create index customer_accounts_customer_idx on customer_accounts (customer_id);

comment on table customer_accounts is
  'Conta Sinacor -> cliente. Chave de vínculo dos lotes diários.';

alter table customer_accounts enable row level security;

create policy leitura_equipe on customer_accounts
  for select to authenticated using (true);
create policy gestao on customer_accounts
  for all to authenticated using (sou_gestor()) with check (sou_gestor());
