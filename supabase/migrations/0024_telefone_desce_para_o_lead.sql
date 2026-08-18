-- =============================================================================
-- Telefone gravado na ficha do cliente desce para o lead
-- =============================================================================
-- O gatilho da 0020 procura lead PELO NÚMERO. Só que o lead de reativação
-- nasce a partir da carteira: já vem com customer_id e SEM telefone, porque
-- a base da corretora veio sem telefone utilizável. Quando o telefone é
-- preenchido na ficha depois, nenhum lead casa pelo número — o vínculo já
-- existe pelo customer_id — e o lead continua sem telefone. Resultado: a
-- conversa abre no chat mas o envio falha com "este lead não tem telefone".
--
-- Passa a fazer as duas coisas: adotar o lead que tem o número (como antes)
-- e completar o telefone do lead que já é daquele cliente e está sem.
--
-- Script reexecutável.
-- =============================================================================

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

  -- (a) Lead que já usa esse número passa a ser deste cliente.
  update leads
  set customer_id = new.id,
      cliente_confirmado_em = coalesce(cliente_confirmado_em, now())
  where telefone_e164 = new.telefone_e164
    and (customer_id is null or customer_id <> new.id);

  -- (b) Lead deste cliente que está sem telefone herda o número agora.
  --     Um só: o telefone é único entre leads (índice parcial da 0004), e o
  --     `not exists` evita colidir com o lead que o passo (a) acabou de
  --     adotar com esse mesmo número.
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
    select 1 from leads o where o.telefone_e164 = new.telefone_e164
  );

  return new;
end;
$$;

drop trigger if exists customers_vincular_leads on customers;
create trigger customers_vincular_leads
  after insert or update of telefone_e164 on customers
  for each row
  execute function vincular_leads_por_telefone_cliente();

-- Passa o que já está cadastrado pelo gatilho corrigido (idempotente).
update customers set telefone_e164 = telefone_e164
where telefone_e164 is not null;
