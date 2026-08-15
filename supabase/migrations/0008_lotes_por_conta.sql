-- =============================================================================
-- Lotes por conta
-- =============================================================================
-- O lote passa a ser gravado POR CONTA e por dia; o total do cliente é a soma
-- na leitura. Assim a ficha mostra o detalhe (conta 10010 — 50, conta 10011 —
-- 200, total 250) sem perder nada na importação.
--
-- v_customer_giro não muda: já soma por cliente.
--
-- Script reexecutável.
-- =============================================================================

alter table customer_lots add column if not exists conta text;

-- A unicidade global (cliente, dia) dá lugar a (conta, dia).
do $$
declare
  r record;
begin
  for r in
    select con.conname
    from pg_constraint con
    join pg_class rel on rel.oid = con.conrelid
    where rel.relname = 'customer_lots'
      and con.contype = 'u'
  loop
    execute format('alter table customer_lots drop constraint %I', r.conname);
  end loop;
end;
$$;

-- Índice pleno (não parcial): o upsert da aplicação precisa inferi-lo pelo
-- ON CONFLICT (conta, referencia_data). Linhas com conta nula não conflitam
-- entre si — NULLs são distintos no índice único.
create unique index if not exists customer_lots_conta_dia_unq
  on customer_lots (conta, referencia_data);

-- Linhas antigas sem conta continuam idempotentes por (cliente, dia).
create unique index if not exists customer_lots_cliente_dia_unq
  on customer_lots (customer_id, referencia_data)
  where conta is null;

create index if not exists customer_lots_conta_idx on customer_lots (conta);
