-- =============================================================================
-- Retroalimentação de telefones nos leads
-- =============================================================================
-- Quando a base de clientes chega com telefone (re-export limpo do
-- diversificador), os leads criados sem telefone — caso da reativação em
-- massa — recebem o telefone do cliente vinculado. Roda ao fim de cada
-- importação de clientes.
-- =============================================================================

create or replace function atualizar_telefones_leads()
returns integer
language plpgsql
security definer
set search_path = public
as $$
declare
  n integer;
begin
  with atualizados as (
    update leads l
    set telefone_e164 = c.telefone_e164
    from customers c
    where l.customer_id = c.id
      and l.telefone_e164 is null
      and c.telefone_e164 is not null
      -- Respeita a unicidade: se outro lead já usa esse telefone, não copia.
      and not exists (
        select 1 from leads l2 where l2.telefone_e164 = c.telefone_e164
      )
    returning 1
  )
  select count(*) into n from atualizados;

  return n;
end;
$$;

revoke execute on function atualizar_telefones_leads() from public, anon;
grant execute on function atualizar_telefones_leads() to authenticated;
