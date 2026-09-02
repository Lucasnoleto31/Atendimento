-- =============================================================================
-- 0066: Jornada (item 1 do mapa) — trilha do lead, eventos de trilha e a
--       ativação pagando comissão
-- =============================================================================
-- A jornada em si (Lead → Contato → Abrindo conta → Conta aberta → Ativado →
-- Recorrente → Em risco → Inativo → Reativado) NÃO ganha tabela: cada estado
-- já tem um fato com data e origem no banco (criado_em, primeira_resposta_em,
-- checklist, conta_aberta_em, primeiro lote, dias com giro, ciclo de vida da
-- carteira). O painel monta a régua a partir deles — ver src/lib/jornada.ts.
--
-- O que precisa nascer aqui:
--   1. a TRILHA de perfil do lead (Iniciante → RV → Sala ao Vivo / Apollo),
--      com cada upgrade registrado como evento (quem, quando, de onde);
--   2. a ATIVAÇÃO como evento com valor: produto ATIVACAO + função que abre a
--      venda sozinha quando o primeiro lote chega da Genial, para quem era o
--      dono do lead naquele momento.
--
-- Script reexecutável.
-- =============================================================================

-- 1. Trilha -------------------------------------------------------------------
alter table leads
  add column if not exists trilha text
    check (trilha in ('iniciante', 'renda_variavel', 'sala_ao_vivo', 'apollo'));
-- null = ainda não definida; a base antiga não é carimbada à força.

create table if not exists trilha_eventos (
  id        uuid primary key default gen_random_uuid(),
  lead_id   uuid not null references leads (id) on delete cascade,
  de        text,
  para      text not null,
  autor_id  uuid references profiles (id) on delete set null,
  origem    text not null default 'crm',
  criado_em timestamptz not null default now()
);
create index if not exists trilha_eventos_lead_idx
  on trilha_eventos (lead_id, criado_em desc);

alter table trilha_eventos enable row level security;
drop policy if exists trilha_eventos_le on trilha_eventos;
create policy trilha_eventos_le on trilha_eventos
  for select to authenticated using (true);
drop policy if exists trilha_eventos_insere on trilha_eventos;
create policy trilha_eventos_insere on trilha_eventos
  for insert to authenticated with check (true);
-- Evento é histórico: não se edita nem se apaga pela tela (sem policy).

-- 2. Ativação paga comissão ----------------------------------------------------
-- O produto nasce com valor ZERO: nada é pago até a gestão definir o valor em
-- Configurações → Produtos. A vigência é a data de criação do produto: só
-- ativações (1º lote) a partir de hoje geram venda — o passado não é pago
-- retroativamente.
insert into products (codigo, nome, valor_comissao_centavos, recorrencia)
select 'ATIVACAO', 'Ativação (1º lote na Genial)', 0, 'unica'
where not exists (select 1 from products where codigo = 'ATIVACAO');

-- Corrida entre o cron da Genial e o upload manual: sem unicidade, as duas
-- execuções passariam pelo "não existe ainda" e pagariam duas vezes.
create unique index if not exists sales_ativacao_automatica_unq
  on sales (customer_id, product_id)
  where observacao = 'Ativação automática — 1º lote na Genial';

create or replace function registrar_comissoes_ativacao()
returns integer
language plpgsql
set search_path = public
as $$
declare
  v_prod  products%rowtype;
  v_desde date;
  v_hoje  date := (now() at time zone 'America/Sao_Paulo')::date;
  v_qtd   integer;
begin
  select * into v_prod from products where codigo = 'ATIVACAO' and ativo;
  if not found or v_prod.valor_comissao_centavos <= 0 then
    return 0;
  end if;

  -- Vigência = o dia em que o valor passou a valer (primeira rodada com
  -- valor > 0), guardada em settings — NÃO a criação do produto. Definir o
  -- valor semanas depois da migração não paga o passado.
  select (valor #>> '{}')::date into v_desde
  from settings where chave = 'comissao_ativacao_desde';
  if v_desde is null then
    insert into settings (chave, valor, atualizado_em)
    values ('comissao_ativacao_desde', to_jsonb(v_hoje::text), now())
    on conflict (chave) do update set valor = excluded.valor;
    v_desde := v_hoje;
  end if;

  with primeiro as (
    -- Definição canônica de ativação (Fase 2): o primeiro lote da vida.
    -- Linha com quantidade 0 é "cliente na lista, sem operar" — não ativa.
    select customer_id, min(referencia_data) as primeiro_em
    from customer_lots
    where quantidade > 0
    group by customer_id
  ),
  alvos as (
    -- Um cliente pode ter mais de um lead: vale o ganho, senão o mais novo
    -- (nunca "o que alguém tocou por último"). Perdido não recebe. Janela
    -- de 45 dias após o 1º lote: card sem dono na hora ainda pode ganhar um
    -- e ser pago; depois disso a comissão vira decisão manual da gestão.
    select distinct on (p.customer_id)
      p.customer_id, p.primeiro_em, l.id as lead_id, l.responsavel_id
    from primeiro p
    join leads l on l.customer_id = p.customer_id
    where p.primeiro_em >= v_desde
      and p.primeiro_em >= v_hoje - 45
      and l.responsavel_id is not null
      and l.status <> 'perdido'
    order by p.customer_id, (l.status = 'ganho') desc, l.criado_em desc
  )
  insert into sales (
    lead_id, customer_id, product_id, vendedor_id,
    valor_comissao_centavos, ocorreu_em, observacao
  )
  select
    a.lead_id, a.customer_id, v_prod.id, a.responsavel_id,
    v_prod.valor_comissao_centavos,
    -- Meio-dia de Brasília: data pura virando timestamptz à meia-noite UTC
    -- cairia no dia anterior nas telas (o mesmo truque de instante()).
    (a.primeiro_em::timestamp + interval '12 hours') at time zone 'America/Sao_Paulo',
    'Ativação automática — 1º lote na Genial'
  from alvos a
  on conflict (customer_id, product_id)
    where observacao = 'Ativação automática — 1º lote na Genial'
    do nothing;

  get diagnostics v_qtd = row_count;
  return v_qtd;
end;
$$;

revoke execute on function registrar_comissoes_ativacao() from public, anon;
grant execute on function registrar_comissoes_ativacao() to authenticated;


-- 3. O funil de Pagamentos não pode contar a venda automática de ativação
--    como "comprou produto" — é a 0055 inteira, com UMA linha a mais no
--    'compraram' (product_id fora de ATIVACAO). Reexecutável.
create or replace function pagamentos_resumo(p_inicio timestamptz default null)
returns jsonb
language sql
stable
set search_path = public
as $$
with abertura as (
  select id from products where codigo = 'ABERTURA'
),
primeiro as (
  select customer_id, min(referencia_data) as primeiro_em
  from customer_lots
  group by customer_id
),
mes_atual as (
  select date_trunc('month', now() at time zone 'America/Sao_Paulo')::date as inicio
),
pessoas as (
  select id, nome from profiles where ativo
),
janela as (
  select greatest(
    (select min(referencia_data) from customer_lots),
    current_date - 180
  ) as corte
)
select jsonb_build_object(
  'tempo_medio_geral', (
    select jsonb_build_object(
      'dias', round(avg(p.primeiro_em - c.conta_aberta_em)),
      'n', count(*)
    )
    from primeiro p
    join customers c on c.id = p.customer_id
    where c.conta_aberta_em >= (select corte from janela)
      and p.primeiro_em >= c.conta_aberta_em
  ),

  'funil', jsonb_build_object(
    'contas', (
      select count(distinct s.lead_id) from sales s
      where s.product_id in (select id from abertura)
        and s.status <> 'cancelada'
        and (p_inicio is null or s.ocorreu_em >= p_inicio)
    ),
    'ativadas', (
      select count(*) from primeiro p
      where (p_inicio is null or p.primeiro_em >= p_inicio::date)
    ),
    'compraram', (
      select count(distinct s.customer_id) from sales s
      where s.status = 'confirmada'
        and s.customer_id is not null
        -- A venda automática de ativação (0066) é evento, não compra.
        and s.product_id not in (select id from products where codigo = 'ATIVACAO')
        and (p_inicio is null or s.ocorreu_em >= p_inicio)
    )
  ),

  'por_pessoa', (
    select coalesce(jsonb_agg(jsonb_build_object(
      'id', pe.id,
      'nome', pe.nome,
      'contas_mes', (
        select count(*) from sales s
        where s.vendedor_id = pe.id
          and s.product_id in (select id from abertura)
          and s.status <> 'cancelada'
          and s.ocorreu_em >= (select inicio from mes_atual)
      ),
      'ativacoes_mes', (
        select count(*) from primeiro p
        join customers c on c.id = p.customer_id
        where c.responsavel_id = pe.id
          and p.primeiro_em >= (select inicio from mes_atual)
      ),
      'tempo_medio_dias', (
        -- Só contas abertas DEPOIS do início do histórico de lotes (CTE
        -- janela): para cliente mais velho que o histórico, o "1º lote" que
        -- temos é só o primeiro importado — a média sairia anos inflada.
        select round(avg(p.primeiro_em - c.conta_aberta_em))
        from primeiro p
        join customers c on c.id = p.customer_id
        where c.responsavel_id = pe.id
          and c.conta_aberta_em >= (select corte from janela)
          and p.primeiro_em >= c.conta_aberta_em
      ),
      'tempo_medio_n', (
        select count(*)
        from primeiro p
        join customers c on c.id = p.customer_id
        where c.responsavel_id = pe.id
          and c.conta_aberta_em >= (select corte from janela)
          and p.primeiro_em >= c.conta_aberta_em
      )
    )), '[]'::jsonb)
    from pessoas pe
  ),

  'historico', (
    select coalesce(jsonb_agg(jsonb_build_object(
      'pessoa', h.pid,
      'mes', to_char(h.mes, 'YYYY-MM'),
      'comissao_centavos', h.comissao,
      'contas', h.contas,
      'ativacoes', h.ativ
    ) order by h.mes), '[]'::jsonb)
    from (
      select
        pe.id as pid,
        m.mes,
        coalesce((
          select sum(s.valor_comissao_centavos) from sales s
          where s.vendedor_id = pe.id
            and s.status = 'confirmada'
            and s.ocorreu_em >= m.mes
            and s.ocorreu_em < m.mes + interval '1 month'
        ), 0) as comissao,
        (
          select count(*) from sales s
          where s.vendedor_id = pe.id
            and s.product_id in (select id from abertura)
            and s.status <> 'cancelada'
            and s.ocorreu_em >= m.mes
            and s.ocorreu_em < m.mes + interval '1 month'
        ) as contas,
        (
          select count(*) from primeiro p
          join customers c on c.id = p.customer_id
          where c.responsavel_id = pe.id
            and p.primeiro_em >= m.mes::date
            and p.primeiro_em < (m.mes + interval '1 month')::date
        ) as ativ
      from pessoas pe
      cross join (
        select (date_trunc('month', now() at time zone 'America/Sao_Paulo')
                - (i || ' month')::interval)::date as mes
        from generate_series(0, 2) i
      ) m
    ) h
  )
)
$$;
