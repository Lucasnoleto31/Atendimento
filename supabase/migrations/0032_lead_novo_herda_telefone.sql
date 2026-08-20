-- =============================================================================
-- Lead que nasce vinculado a um cliente já herda o telefone dele
-- =============================================================================
-- A 0024 fez o telefone descer do cliente para o lead, mas o gatilho vive em
-- `customers` e só dispara quando o CLIENTE muda. O lead que nasce depois —
-- reativação, resgate da carteira, etiquetagem em massa — entra sem telefone
-- e nada mais o preenche.
--
-- O efeito aparece na hora de usar: 47 leads da etiqueta "Resgate" estavam
-- sem número enquanto o cadastro do cliente tinha um, e a campanha simplesmente
-- pularia essas pessoas (o motor exige telefone no lead).
--
-- Fecha pelo outro lado: gatilho em `leads` e backfill do que já passou.
--
-- Script reexecutável.
-- =============================================================================

create or replace function completar_telefone_do_lead()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  numero text;
begin
  if new.telefone_e164 is not null or new.customer_id is null then
    return new;
  end if;

  select c.telefone_e164 into numero
  from customers c
  where c.id = new.customer_id;

  if numero is null then
    return new;
  end if;

  -- O telefone é único entre leads (índice parcial da 0004): se outro lead já
  -- usa o número, este fica sem — duplicar quebraria o insert inteiro.
  if exists (select 1 from leads o where o.telefone_e164 = numero) then
    return new;
  end if;

  new.telefone_e164 := numero;
  return new;
end;
$$;

comment on function completar_telefone_do_lead() is
  'Lead vinculado a cliente nasce com o telefone do cadastro, quando tem.';

drop trigger if exists leads_completa_telefone on leads;
create trigger leads_completa_telefone
  before insert or update of customer_id on leads
  for each row
  execute function completar_telefone_do_lead();

revoke execute on function completar_telefone_do_lead() from public, anon;

-- Backfill do que já entrou sem número. Um lead por cliente, o mais antigo,
-- e só quando ninguém mais usa aquele telefone.
update leads l
set telefone_e164 = c.telefone_e164
from customers c
where c.id = l.customer_id
  and l.telefone_e164 is null
  and c.telefone_e164 is not null
  and l.id = (
    select x.id
    from leads x
    where x.customer_id = l.customer_id
      and x.telefone_e164 is null
    order by x.criado_em
    limit 1
  )
  and not exists (
    select 1 from leads o where o.telefone_e164 = c.telefone_e164
  );
