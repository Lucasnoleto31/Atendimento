-- =============================================================================
-- Fase 2: o giro vira materialized view — calcula uma vez, lê mil vezes
-- =============================================================================
-- v_customer_giro reagrega customer_lots inteira A CADA consulta e é a raiz
-- de quase tudo: v_carteira, v_leads_listas, relatório, motor de resgate,
-- ciclo de vida. O giro só muda quando lotes são importados (uma vez por
-- dia) — recalcular a cada tecla é pagar todo dia mais caro por um número
-- que não mudou. Com 10× o volume, cada tela pagaria uma varredura completa.
--
-- O truque que preserva TODOS os dependentes sem derrubar nada: a
-- materialized view nova (mv_customer_giro) guarda o agregado, e
-- v_customer_giro — MESMO nome, MESMAS colunas — vira uma casca sobre ela
-- (create or replace view não exige recriar quem depende).
--
-- A janela de 30 dias é relativa a current_date, então a foto envelhece
-- mesmo sem importação: o app pede refresh no batimento diário
-- (lib/giro.ts) e ao fim de cada importação de lotes.
--
-- Script reexecutável.
-- =============================================================================

-- IF NOT EXISTS, não drop: depois da primeira rodada a casca v_customer_giro
-- depende da mv, e um drop aqui derrubaria a cadeia inteira na reexecução.
create materialized view if not exists mv_customer_giro as
select
  c.id as customer_id,
  c.nome_completo,
  c.telefone_e164,
  coalesce(sum(l.quantidade) filter (
    where l.referencia_data > current_date - interval '30 days'
  ), 0) as lotes_30d,
  coalesce(sum(l.quantidade) filter (
    where l.referencia_data <= current_date - interval '30 days'
      and l.referencia_data > current_date - interval '60 days'
  ), 0) as lotes_30d_anterior,
  max(l.referencia_data) filter (where l.quantidade > 0) as ultimo_giro_em
from customers c
left join customer_lots l on l.customer_id = c.id
group by c.id;

-- Índice único: acelera os joins por customer_id e deixa a porta aberta
-- para REFRESH CONCURRENTLY no futuro.
create unique index if not exists mv_customer_giro_pk
  on mv_customer_giro (customer_id);

-- A casca: mesmo nome e mesmo contrato de colunas — nenhum dependente muda.
create or replace view v_customer_giro as
select customer_id, nome_completo, telefone_e164,
       lotes_30d, lotes_30d_anterior, ultimo_giro_em
from mv_customer_giro;

comment on view v_customer_giro is
  'Casca sobre mv_customer_giro (0044). O agregado atualiza no refresh — importação de lotes e batimento diário do app.';

-- O app chama esta função ao importar lotes e uma vez por dia no batimento.
create or replace function atualizar_giro()
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  -- Refresh SIMPLES de propósito: CONCURRENTLY não roda dentro de transação,
  -- e tanto o SQL Editor quanto o RPC do PostgREST embrulham tudo numa. Com
  -- ~1,5 mil clientes o refresh leva milissegundos; se um dia travar leitura,
  -- o caminho é pg_cron + concurrently, não mudar o contrato.
  refresh materialized view mv_customer_giro;
  insert into settings (chave, valor)
  values ('giro_atualizado_em', to_jsonb(now()))
  on conflict (chave) do update set valor = to_jsonb(now());
end;
$$;

revoke execute on function atualizar_giro() from public, anon;

-- A mv nasce populada (create ... with data é o padrão); só carimba a hora.
insert into settings (chave, valor)
values ('giro_atualizado_em', to_jsonb(now()))
on conflict (chave) do update set valor = to_jsonb(now());
