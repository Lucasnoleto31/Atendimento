-- =============================================================================
-- CPF com zero à esquerda: o cliente não era reconhecido
-- =============================================================================
-- O diversificador/Excel trata CPF como número e come o zero da frente:
-- "01177961237" foi gravado como "1177961237". O lead que digita o CPF no
-- chat traz os 11 dígitos certos; o cliente na base tem 10 — não casam, e o
-- cliente não é reconhecido. Aconteceu com 614 dos ~1.500 clientes (40%).
--
-- Correção: uma forma canônica (11 dígitos p/ CPF, 14 p/ CNPJ, com zero à
-- esquerda), aplicada na base inteira e nos dois gatilhos de vínculo, mais um
-- religamento dos leads que passaram a casar.
--
-- Script reexecutável.
-- =============================================================================

create or replace function normalizar_documento(bruto text)
returns text
language sql
immutable
as $$
  with x as (select regexp_replace(coalesce(bruto, ''), '\D', '', 'g') as d)
  select case
    when d = '' then null
    when length(d) <= 11 then lpad(d, 11, '0')
    when length(d) <= 14 then lpad(d, 14, '0')
    else d
  end
  from x
$$;

-- 1. Recoloca o zero à esquerda na base inteira ------------------------------

update customers
set documento = normalizar_documento(documento)
where documento is not null
  and documento is distinct from normalizar_documento(documento);

update leads
set documento = normalizar_documento(documento)
where documento is not null
  and documento is distinct from normalizar_documento(documento);

-- 2. Gatilhos de vínculo passam a comparar a forma canônica ------------------

create or replace function vincular_cliente_por_documento()
returns trigger
language plpgsql
as $$
declare
  achou uuid;
begin
  if new.customer_id is null and new.documento is not null then
    select id into achou
    from customers
    where documento is not null
      and normalizar_documento(documento) = normalizar_documento(new.documento)
    limit 1;
    if achou is not null then
      new.customer_id = achou;
      new.cliente_confirmado_em = now();
    end if;
  end if;
  return new;
end;
$$;

create or replace function atualizar_documentos_leads()
returns integer
language plpgsql
security definer
set search_path = public
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
     and c.documento is not null
     and normalizar_documento(c.documento) = normalizar_documento(l.documento);
  get diagnostics n = row_count;
  return n;
end;
$$;

revoke execute on function atualizar_documentos_leads() from public, anon, authenticated;

-- 3. Religa quem passou a casar depois da normalização -----------------------
-- (o gatilho de ganho automático, se aplicado, marca esses leads como ganho.)

update leads l
set customer_id = c.id,
    cliente_confirmado_em = coalesce(l.cliente_confirmado_em, now())
from customers c
where l.customer_id is null
  and l.documento is not null
  and c.documento is not null
  and normalizar_documento(l.documento) = normalizar_documento(c.documento);
