-- =============================================================================
-- Nono dígito: as duas grafias do mesmo celular são a mesma pessoa
-- =============================================================================
-- O WhatsApp registra números antigos SEM o nono dígito (wa_id
-- "556296073230"); as pessoas digitam COM ("5562996073230"). Os gatilhos
-- comparavam por igualdade exata: telefone preenchido na ficha não achava o
-- lead que já conversava com a mesa, e a Carteira abria uma conversa nova em
-- vez da existente.
--
-- Script reexecutável.
-- =============================================================================

create or replace function variantes_telefone(tel text)
returns text[]
language sql
immutable
as $$
  select case
    when tel is null then array[]::text[]
    when tel like '55%' and length(tel) = 12
      then array[tel, substr(tel, 1, 4) || '9' || substr(tel, 5)]
    when tel like '55%' and length(tel) = 13 and substr(tel, 5, 1) = '9'
      then array[tel, substr(tel, 1, 4) || substr(tel, 6)]
    else array[tel]
  end
$$;

-- Lead novo/editado casa com o cliente por qualquer grafia.
create or replace function vincular_cliente_por_telefone()
returns trigger
language plpgsql
as $$
declare
  achou uuid;
begin
  if new.customer_id is null and new.telefone_e164 is not null then
    select id into achou
    from customers
    where telefone_e164 = any (variantes_telefone(new.telefone_e164))
    limit 1;
    if achou is not null then
      new.customer_id = achou;
      new.cliente_confirmado_em = now();
    end if;
  end if;
  return new;
end;
$$;

-- Telefone gravado na ficha do cliente adota o lead por qualquer grafia e,
-- na falta de lead com o número, completa o lead sem telefone (0024).
create or replace function vincular_leads_por_telefone_cliente()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if new.telefone_e164 is null then
    return new;
  end if;

  -- (a) Lead que usa esse número, com ou sem o nono dígito.
  update leads
  set customer_id = new.id,
      cliente_confirmado_em = coalesce(cliente_confirmado_em, now())
  where telefone_e164 = any (variantes_telefone(new.telefone_e164))
    and (customer_id is null or customer_id <> new.id);

  -- (b) Lead deste cliente sem telefone herda o número — só quando nenhuma
  --     grafia dele já existe em outro lead.
  update leads
  set telefone_e164 = new.telefone_e164
  where id = (
    select l.id
    from leads l
    where l.customer_id = new.id
      and l.telefone_e164 is null
    order by l.criado_em
    limit 1
  )
  and not exists (
    select 1 from leads o
    where o.telefone_e164 = any (variantes_telefone(new.telefone_e164))
  );

  return new;
end;
$$;

drop trigger if exists customers_vincular_leads on customers;
create trigger customers_vincular_leads
  after insert or update of telefone_e164 on customers
  for each row
  execute function vincular_leads_por_telefone_cliente();

-- Reprocessa o que já está cadastrado pelas regras novas (idempotente).
update customers set telefone_e164 = telefone_e164
where telefone_e164 is not null;
