-- =============================================================================
-- 0018 — CPF/CNPJ dito pelo lead no chat
--
-- O webhook detecta um documento válido na mensagem e grava em leads.documento.
-- O vínculo com a base de clientes acontece aqui, no banco:
--   * na hora, pelo gatilho (se o cliente já está na base);
--   * na próxima importação, pela função atualizar_documentos_leads().
-- Identidade mais forte que telefone — o diversificador nem sempre traz fone.
-- =============================================================================

alter table leads add column if not exists documento text;

create index if not exists leads_documento_idx
  on leads (documento) where documento is not null;

-- Vincula na hora se o cliente já está na base (espelho do gatilho de telefone).
create or replace function vincular_cliente_por_documento()
returns trigger
language plpgsql
as $$
declare
  achou uuid;
begin
  if new.customer_id is null and new.documento is not null then
    select id into achou from customers where documento = new.documento limit 1;
    if achou is not null then
      new.customer_id = achou;
      new.cliente_confirmado_em = now();
    end if;
  end if;
  return new;
end;
$$;

drop trigger if exists leads_vincular_cliente_documento on leads;
create trigger leads_vincular_cliente_documento
  before insert or update of documento on leads
  for each row execute function vincular_cliente_por_documento();

-- Pós-importação da base: casa os leads pendentes pelo documento.
create or replace function atualizar_documentos_leads()
returns integer
language plpgsql
security definer
as $$
declare
  n integer;
begin
  update leads l
     set customer_id = c.id,
         cliente_confirmado_em = now()
    from customers c
   where l.customer_id is null
     and l.documento is not null
     and c.documento = l.documento;
  get diagnostics n = row_count;
  return n;
end;
$$;
