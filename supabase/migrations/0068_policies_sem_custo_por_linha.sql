-- =============================================================================
-- 0068: as policies da 0067 ficaram caras demais — o app parou
-- =============================================================================
-- Sintoma: /leads mostrava "Rode a migração 0032", /chat e /hoje falhavam. A
-- consulta do usuário estourava o tempo-limite do Supabase e o erro genérico
-- da tela culpava a view errada — a view está lá e responde em 300ms.
--
-- Causa: as policies da 0067 chamam ve_tudo()/vejo_lead()/vejo_cliente()
-- DIRETO na expressão. O Postgres avalia isso UMA VEZ POR LINHA — em
-- lead_interactions são ~13 mil chamadas, cada uma com um EXISTS dentro.
--
-- Correção (padrão recomendado pelo próprio Supabase): envolver toda chamada
-- sem argumento em `(select f())`. Vira InitPlan — avaliado UMA vez por
-- consulta e reaproveitado. Para quem vê tudo (gestão e compliance) a policy
-- colapsa em `true` e o custo some; para atendente/assessor sobra a
-- comparação por linha, que os índices abaixo resolvem.
--
-- Nada de PERMISSÃO muda aqui: as regras são exatamente as mesmas da 0067.
--
-- Script reexecutável.
-- =============================================================================

-- Índices que as policies passam a usar (responsável e dono da carteira).
create index if not exists leads_responsavel_idx on leads (responsavel_id);
create index if not exists customers_responsavel_idx on customers (responsavel_id);

-- 1. Leads --------------------------------------------------------------------
drop policy if exists leads_por_papel on leads;
create policy leads_por_papel on leads
  for select to authenticated using (
    (select ve_tudo())
    or responsavel_id = (select auth.uid())
    or (
      not (select sou_atendente())
      and (
        responsavel_id is null
        or (customer_id is not null and minha_carteira(customer_id))
      )
    )
  );

drop policy if exists leads_edita on leads;
create policy leads_edita on leads
  for update to authenticated
  using ((select ve_tudo()) or vejo_lead(id))
  with check ((select ve_tudo()) or vejo_lead(id));

-- 2. Tabelas filhas do lead ----------------------------------------------------
do $$
declare
  t record;
  regra text;
begin
  for t in
    select * from (values
      ('lead_interactions', 'interacoes_le', 'interacoes_insere'),
      ('lead_tasks',        'tarefas_le',    'tarefas_escreve'),
      ('lead_tags',         'etiquetas_le',  'etiquetas_escreve'),
      ('scheduled_messages','agendadas_le',  'agendadas_escreve'),
      ('trilha_eventos',    'trilha_eventos_le', 'trilha_eventos_insere')
    ) as v(tabela, pol_le, pol_escreve)
  loop
    regra := '((select ve_tudo()) or vejo_lead(lead_id))';
    execute format('drop policy if exists %I on %I', t.pol_le, t.tabela);
    execute format('create policy %I on %I for select to authenticated using (%s)',
                   t.pol_le, t.tabela, regra);
    execute format('drop policy if exists %I on %I', t.pol_escreve, t.tabela);
    if t.tabela in ('lead_interactions', 'trilha_eventos') then
      execute format('create policy %I on %I for insert to authenticated with check (%s)',
                     t.pol_escreve, t.tabela, regra);
    else
      execute format('create policy %I on %I for all to authenticated using (%s) with check (%s)',
                     t.pol_escreve, t.tabela, regra, regra);
    end if;
  end loop;
end $$;

-- Checklist tem os quatro comandos separados.
drop policy if exists ativacao_checklist_le on ativacao_checklist;
create policy ativacao_checklist_le on ativacao_checklist
  for select to authenticated using ((select ve_tudo()) or vejo_lead(lead_id));
drop policy if exists ativacao_checklist_insere on ativacao_checklist;
create policy ativacao_checklist_insere on ativacao_checklist
  for insert to authenticated with check ((select ve_tudo()) or vejo_lead(lead_id));
drop policy if exists ativacao_checklist_edita on ativacao_checklist;
create policy ativacao_checklist_edita on ativacao_checklist
  for update to authenticated
  using ((select ve_tudo()) or vejo_lead(lead_id))
  with check ((select ve_tudo()) or vejo_lead(lead_id));
drop policy if exists ativacao_checklist_apaga on ativacao_checklist;
create policy ativacao_checklist_apaga on ativacao_checklist
  for delete to authenticated using ((select ve_tudo()) or vejo_lead(lead_id));

-- 3. Carteira ------------------------------------------------------------------
drop policy if exists clientes_por_papel on customers;
create policy clientes_por_papel on customers
  for select to authenticated using (
    (select ve_tudo())
    or (not (select sou_atendente()) and responsavel_id = (select auth.uid()))
  );

do $$
declare t record;
begin
  for t in
    select * from (values
      ('customer_lots',     'lotes_por_papel'),
      ('customer_accounts', 'contas_por_papel'),
      ('customer_events',   'eventos_por_papel')
    ) as v(tabela, pol)
  loop
    execute format('drop policy if exists %I on %I', t.pol, t.tabela);
    execute format(
      'create policy %I on %I for select to authenticated using ((select ve_tudo()) or vejo_cliente(customer_id))',
      t.pol, t.tabela);
  end loop;
end $$;

-- 4. Comissão, log e importações ------------------------------------------------
drop policy if exists vendas_por_papel on sales;
create policy vendas_por_papel on sales
  for select to authenticated using (
    (select ve_tudo()) or vendedor_id = (select auth.uid())
  );

drop policy if exists auditoria_le on auditoria;
create policy auditoria_le on auditoria
  for select to authenticated using ((select ve_tudo()));

drop policy if exists imports_le on imports;
create policy imports_le on imports
  for select to authenticated using ((select ve_tudo()));

-- 5. As restritivas (compliance e segundo fator) também por consulta ------------
do $$
declare t record;
begin
  for t in
    select tablename from pg_tables where schemaname = 'public' and rowsecurity
  loop
    execute format('drop policy if exists compliance_nao_insere on %I', t.tablename);
    execute format(
      'create policy compliance_nao_insere on %I as restrictive for insert to authenticated with check (not (select sou_compliance()))',
      t.tablename);
    execute format('drop policy if exists compliance_nao_edita on %I', t.tablename);
    execute format(
      'create policy compliance_nao_edita on %I as restrictive for update to authenticated using (not (select sou_compliance())) with check (not (select sou_compliance()))',
      t.tablename);
    execute format('drop policy if exists compliance_nao_apaga on %I', t.tablename);
    execute format(
      'create policy compliance_nao_apaga on %I as restrictive for delete to authenticated using (not (select sou_compliance()))',
      t.tablename);

    if t.tablename <> 'profiles' then
      execute format('drop policy if exists exige_segundo_fator on %I', t.tablename);
      execute format(
        'create policy exige_segundo_fator on %I as restrictive for all to authenticated using ((select not exige_2fa()) or (select coalesce(auth.jwt() ->> ''aal'', ''aal1'')) = ''aal2'') with check ((select not exige_2fa()) or (select coalesce(auth.jwt() ->> ''aal'', ''aal1'')) = ''aal2'')',
        t.tablename);
    end if;
  end loop;
end $$;
