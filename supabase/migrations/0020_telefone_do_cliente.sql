-- =============================================================================
-- Telefone preenchido no cliente encontra o lead sozinho
-- =============================================================================
-- O cruzamento existia só na direção lead -> cliente (gatilho em leads). Como
-- a equipe vai completar o cadastro dos clientes aos poucos, o telefone chega
-- pelo OUTRO lado — e sem isto o cliente continuaria invisível no atendimento.
--
-- 1. Gatilho em customers: ao gravar telefone, adota o lead que já tem esse
--    número (e confirma o vínculo).
-- 2. v_carteira passa a expor o telefone do cliente, não só o do lead, para a
--    tela saber quem já dá para contatar.
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

  update leads
  set customer_id = new.id,
      cliente_confirmado_em = coalesce(cliente_confirmado_em, now())
  where telefone_e164 = new.telefone_e164
    and (customer_id is null or customer_id <> new.id);

  return new;
end;
$$;

drop trigger if exists customers_vincular_leads on customers;
create trigger customers_vincular_leads
  after insert or update of telefone_e164 on customers
  for each row
  execute function vincular_leads_por_telefone_cliente();

-- Passa o que já está cadastrado pelo gatilho (idempotente).
update customers set telefone_e164 = telefone_e164
where telefone_e164 is not null;

-- v_carteira: o telefone do cliente entra ao lado do telefone do lead.
drop view if exists v_carteira;
create view v_carteira as
select
  c.id                                   as customer_id,
  c.nome_completo,
  c.status,
  c.segmento,
  c.conta_aberta_em,
  c.churned_em,
  c.motivo_churn,
  c.responsavel_id,
  p.nome                                 as responsavel_nome,
  g.lotes_30d,
  g.lotes_30d_anterior,
  g.ultimo_giro_em,
  case
    when g.ultimo_giro_em is null then null
    else (current_date - g.ultimo_giro_em)
  end                                    as dias_sem_giro,
  r.receita_30d_centavos,
  r.ltv_centavos,
  l.id                                   as lead_id,
  -- Telefone do lead quando existe; senão o do cadastro do cliente.
  coalesce(l.telefone_e164, c.telefone_e164) as telefone_e164,
  c.telefone_e164                        as telefone_cliente,
  l.ultima_interacao_em,
  case
    when l.ultima_interacao_em is null then null
    else extract(day from now() - l.ultima_interacao_em)::integer
  end                                    as dias_sem_contato
from customers c
left join v_customer_giro g on g.customer_id = c.id
left join v_customer_receita r on r.customer_id = c.id
left join profiles p on p.id = c.responsavel_id
left join lateral (
  select l.id, l.telefone_e164, l.ultima_interacao_em
  from leads l
  where l.customer_id = c.id
  order by l.criado_em desc
  limit 1
) l on true
where c.ativo;

alter view v_carteira set (security_invoker = true);

revoke execute on function vincular_leads_por_telefone_cliente() from public, anon;
