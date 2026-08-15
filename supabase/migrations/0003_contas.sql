-- =============================================================================
-- Contas por cliente
-- =============================================================================
-- O arquivo real da corretora (modelo_contratos.xlsx) identifica o cliente pela
-- CONTA, não pelo telefone — e um cliente pode ter várias contas. O telefone
-- passa a ser opcional (segue único quando existe) e vira a ponte com o lead
-- do WhatsApp; a conta vira a ponte com os lotes.
--
-- Script reexecutável: cada passo tolera já ter sido aplicado.
-- =============================================================================

-- Telefone opcional.
alter table customers alter column telefone_e164 drop not null;

-- Remove QUALQUER restrição/índice de unicidade antigo sobre o telefone,
-- seja qual for o nome que recebeu na criação.
do $$
declare
  r record;
begin
  for r in
    select con.conname
    from pg_constraint con
    join pg_class rel on rel.oid = con.conrelid
    join pg_attribute att
      on att.attrelid = rel.oid and att.attnum = any (con.conkey)
    where rel.relname = 'customers'
      and con.contype = 'u'
      and att.attname = 'telefone_e164'
  loop
    execute format('alter table customers drop constraint %I', r.conname);
  end loop;
end;
$$;

drop index if exists customers_telefone_unq;

-- Único apenas quando preenchido.
create unique index customers_telefone_unq
  on customers (telefone_e164)
  where telefone_e164 is not null;

-- Contas da corretora, N por cliente.
create table if not exists customer_accounts (
  conta        text primary key,
  customer_id  uuid not null references customers (id) on delete cascade,
  criado_em    timestamptz not null default now()
);

create index if not exists customer_accounts_customer_idx
  on customer_accounts (customer_id);

comment on table customer_accounts is
  'Conta Sinacor (com dígito) -> cliente. Chave de vínculo dos lotes diários.';

alter table customer_accounts enable row level security;

drop policy if exists leitura_equipe on customer_accounts;
create policy leitura_equipe on customer_accounts
  for select to authenticated using (true);

drop policy if exists gestao on customer_accounts;
create policy gestao on customer_accounts
  for all to authenticated using (sou_gestor()) with check (sou_gestor());
