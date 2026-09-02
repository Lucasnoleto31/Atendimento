-- =============================================================================
-- 0067: Perfis de acesso (item 2 do mapa)
-- =============================================================================
-- Cinco papéis e permissão POR OBJETO no banco — a matriz aprovada:
--
--   Atendente   → só os próprios leads e conversas; sem carteira/custódia
--   Assessor    → (valor 'vendedor' no enum) próprios leads + os da própria
--                 carteira; a própria carteira, custódia e comissão
--   Gestor      → tudo; edita regras, redistribui, aprova
--   Admin/Fin.  → (valor 'admin') tudo + usuários, integrações, fechamento
--   Compliance  → vê TUDO, exporta, e não grava nada (policies restritivas
--                 em toda tabela com RLS)
--
-- 'vendedor' continua sendo o valor gravado para o assessor: toda a base
-- compara com esse literal; o rótulo muda na tela (src/lib/papeis.ts).
--
-- Papéis são comparados como TEXTO (meu_papel_texto()) de propósito: valor
-- novo de enum não pode ser usado na mesma transação em que foi criado.
--
-- Script reexecutável.
-- =============================================================================

-- 1. Papéis novos ---------------------------------------------------------------
alter type user_role add value if not exists 'atendente';
alter type user_role add value if not exists 'compliance';

-- 2. Quem sou eu (para as policies) -------------------------------------------
create or replace function meu_papel_texto()
returns text
language sql stable security definer
set search_path = public
as $$ select papel::text from profiles where id = auth.uid(); $$;

create or replace function sou_compliance()
returns boolean language sql stable
as $$ select coalesce(meu_papel_texto() = 'compliance', false); $$;

create or replace function sou_atendente()
returns boolean language sql stable
as $$ select coalesce(meu_papel_texto() = 'atendente', false); $$;

-- Gestão + compliance: a base inteira.
create or replace function ve_tudo()
returns boolean language sql stable
as $$ select coalesce(meu_papel_texto() in ('admin', 'gestor', 'compliance'), false); $$;

-- Cliente da MINHA carteira (definer: não depende da policy de customers).
create or replace function minha_carteira(cid uuid)
returns boolean
language sql stable security definer
set search_path = public
as $$
  select exists (
    select 1 from customers where id = cid and responsavel_id = auth.uid()
  );
$$;

-- A regra de visibilidade de um lead, num lugar só. Definer: as tabelas
-- filhas (interações, tarefas, checklist…) perguntam aqui sem recursão.
create or replace function vejo_lead(lid uuid)
returns boolean
language sql stable security definer
set search_path = public
as $$
  select exists (
    select 1 from leads l
    where l.id = lid
      and (
        ve_tudo()
        or l.responsavel_id = auth.uid()
        or (
          not sou_atendente()
          and (
            l.responsavel_id is null
            or (l.customer_id is not null and minha_carteira(l.customer_id))
          )
        )
      )
  );
$$;

create or replace function vejo_cliente(cid uuid)
returns boolean
language sql stable security definer
set search_path = public
as $$
  select ve_tudo() or (not sou_atendente() and minha_carteira(cid));
$$;

revoke execute on function meu_papel_texto(), minha_carteira(uuid), vejo_lead(uuid), vejo_cliente(uuid) from public, anon;
grant execute on function meu_papel_texto(), sou_compliance(), sou_atendente(), ve_tudo(), minha_carteira(uuid), vejo_lead(uuid), vejo_cliente(uuid) to authenticated;

-- 3. Leads e conversas --------------------------------------------------------
drop policy if exists leitura_equipe on leads;
drop policy if exists leads_por_papel on leads;
create policy leads_por_papel on leads
  for select to authenticated using (
    ve_tudo()
    or responsavel_id = auth.uid()
    or (
      not sou_atendente()
      and (
        responsavel_id is null
        or (customer_id is not null and minha_carteira(customer_id))
      )
    )
  );
drop policy if exists leads_edita on leads;
create policy leads_edita on leads
  for update to authenticated using (vejo_lead(id)) with check (vejo_lead(id));

-- Tabelas filhas: só o que pende de um lead que eu vejo.
drop policy if exists leitura_equipe on lead_interactions;
drop policy if exists interacoes_le on lead_interactions;
create policy interacoes_le on lead_interactions
  for select to authenticated using (vejo_lead(lead_id));
drop policy if exists interacoes_insere on lead_interactions;
create policy interacoes_insere on lead_interactions
  for insert to authenticated with check (vejo_lead(lead_id));

drop policy if exists leitura_equipe on lead_tasks;
drop policy if exists escrita_equipe on lead_tasks;
drop policy if exists tarefas_le on lead_tasks;
drop policy if exists tarefas_escreve on lead_tasks;
create policy tarefas_le on lead_tasks
  for select to authenticated using (vejo_lead(lead_id));
create policy tarefas_escreve on lead_tasks
  for all to authenticated using (vejo_lead(lead_id)) with check (vejo_lead(lead_id));

drop policy if exists leitura_equipe on lead_tags;
drop policy if exists escrita_equipe on lead_tags;
drop policy if exists etiquetas_le on lead_tags;
drop policy if exists etiquetas_escreve on lead_tags;
create policy etiquetas_le on lead_tags
  for select to authenticated using (vejo_lead(lead_id));
create policy etiquetas_escreve on lead_tags
  for all to authenticated using (vejo_lead(lead_id)) with check (vejo_lead(lead_id));

drop policy if exists leitura_equipe on scheduled_messages;
drop policy if exists escrita_equipe on scheduled_messages;
drop policy if exists agendadas_le on scheduled_messages;
drop policy if exists agendadas_escreve on scheduled_messages;
create policy agendadas_le on scheduled_messages
  for select to authenticated using (vejo_lead(lead_id));
create policy agendadas_escreve on scheduled_messages
  for all to authenticated using (vejo_lead(lead_id)) with check (vejo_lead(lead_id));

drop policy if exists ativacao_checklist_le on ativacao_checklist;
drop policy if exists ativacao_checklist_insere on ativacao_checklist;
drop policy if exists ativacao_checklist_edita on ativacao_checklist;
drop policy if exists ativacao_checklist_apaga on ativacao_checklist;
create policy ativacao_checklist_le on ativacao_checklist
  for select to authenticated using (vejo_lead(lead_id));
create policy ativacao_checklist_insere on ativacao_checklist
  for insert to authenticated with check (vejo_lead(lead_id));
create policy ativacao_checklist_edita on ativacao_checklist
  for update to authenticated using (vejo_lead(lead_id)) with check (vejo_lead(lead_id));
create policy ativacao_checklist_apaga on ativacao_checklist
  for delete to authenticated using (vejo_lead(lead_id));

drop policy if exists trilha_eventos_le on trilha_eventos;
drop policy if exists trilha_eventos_insere on trilha_eventos;
create policy trilha_eventos_le on trilha_eventos
  for select to authenticated using (vejo_lead(lead_id));
create policy trilha_eventos_insere on trilha_eventos
  for insert to authenticated with check (vejo_lead(lead_id));

-- 4. Carteira, custódia e receita ----------------------------------------------
drop policy if exists leitura_equipe on customers;
drop policy if exists clientes_por_papel on customers;
create policy clientes_por_papel on customers
  for select to authenticated using (vejo_cliente(id));

drop policy if exists leitura_equipe on customer_lots;
drop policy if exists lotes_por_papel on customer_lots;
create policy lotes_por_papel on customer_lots
  for select to authenticated using (vejo_cliente(customer_id));

drop policy if exists leitura_equipe on customer_accounts;
drop policy if exists contas_por_papel on customer_accounts;
create policy contas_por_papel on customer_accounts
  for select to authenticated using (vejo_cliente(customer_id));

drop policy if exists leitura_equipe on customer_events;
drop policy if exists eventos_por_papel on customer_events;
create policy eventos_por_papel on customer_events
  for select to authenticated using (vejo_cliente(customer_id));

-- A foto do giro (mv_customer_giro / v_customer_giro) fica como está: é
-- lida por gatilhos e motores que rodam SEM usuário (auth.uid() nulo) e
-- sob a v_carteira/v_leads_listas de todo mundo — um WHERE por papel ali
-- cegaria a reativação, a cadência e o espelho do kanban. O que é dinheiro
-- (customer_lots, receita) já está atrás do RLS de clientes.

-- 4b. Gatilhos que cruzam lead × cliente rodam com quem grava: com o RLS
--     novo, atendente/assessor não enxergam o cliente e o vínculo se
--     perderia. Passam a definer — a regra deles não depende de quem grava.
do $$
declare f text;
begin
  foreach f in array array[
    'vincular_cliente_por_telefone', 'vincular_cliente_por_documento',
    'completar_telefone_do_lead'
  ] loop
    if exists (select 1 from pg_proc where proname = f) then
      execute format('alter function %I() security definer set search_path = public', f);
    end if;
  end loop;
end $$;

-- 5. Comissão: o próprio extrato; gestão e compliance, tudo --------------------
drop policy if exists leitura_equipe on sales;
drop policy if exists vendas_por_papel on sales;
create policy vendas_por_papel on sales
  for select to authenticated using (ve_tudo() or vendedor_id = auth.uid());

-- 6. Log de acesso e importações: gestão e compliance --------------------------
-- A tela e o CSV filtram por data; com uma linha por conversa aberta a
-- tabela cresce rápido.
create index if not exists auditoria_criado_idx on auditoria (criado_em desc);
drop policy if exists gestao on auditoria;
drop policy if exists auditoria_le on auditoria;
create policy auditoria_le on auditoria
  for select to authenticated using (ve_tudo());

drop policy if exists leitura_equipe on imports;
drop policy if exists imports_le on imports;
create policy imports_le on imports
  for select to authenticated using (ve_tudo());

-- 7. Compliance não grava NADA: policies restritivas em toda tabela com RLS.
--    Restritiva = AND com as permissivas — não abre nada, só fecha.
do $$
declare t record;
begin
  for t in
    select tablename from pg_tables where schemaname = 'public' and rowsecurity
  loop
    execute format('drop policy if exists compliance_nao_insere on %I', t.tablename);
    execute format(
      'create policy compliance_nao_insere on %I as restrictive for insert to authenticated with check (not sou_compliance())',
      t.tablename);
    execute format('drop policy if exists compliance_nao_edita on %I', t.tablename);
    execute format(
      'create policy compliance_nao_edita on %I as restrictive for update to authenticated using (not sou_compliance()) with check (not sou_compliance())',
      t.tablename);
    execute format('drop policy if exists compliance_nao_apaga on %I', t.tablename);
    execute format(
      'create policy compliance_nao_apaga on %I as restrictive for delete to authenticated using (not sou_compliance())',
      t.tablename);
  end loop;
end $$;

-- 8. Segundo fator TAMBÉM no banco. O middleware só protege as rotas do
--    Next; com a anon key (pública) e a senha, um token aal1 falaria com o
--    PostgREST direto. Policy restritiva em toda tabela com RLS: sem aal2,
--    nada. Interruptor de emergência: settings.exigir_2fa = "0" (e
--    EXIGIR_2FA=0 na Vercel para o middleware).
insert into settings (chave, valor, atualizado_em)
values ('exigir_2fa', '"1"'::jsonb, now())
on conflict (chave) do nothing;

create or replace function exige_2fa()
returns boolean
language sql stable security definer
set search_path = public
as $$
  select coalesce((select valor #>> '{}' from settings where chave = 'exigir_2fa'), '1') <> '0';
$$;
grant execute on function exige_2fa() to authenticated;

-- profiles fica de FORA: o layout do app lê o próprio perfil com a sessão
-- ainda em aal1 (a pessoa está indo digitar o código) e, sem essa exceção,
-- veria "Perfil não encontrado" no lugar da tela do segundo fator. Ler o
-- próprio nome/papel não é dado de cliente.
do $$
declare t record;
begin
  for t in
    select tablename from pg_tables
    where schemaname = 'public' and rowsecurity and tablename <> 'profiles'
  loop
    execute format('drop policy if exists exige_segundo_fator on %I', t.tablename);
    execute format(
      'create policy exige_segundo_fator on %I as restrictive for all to authenticated using (not exige_2fa() or coalesce(auth.jwt() ->> ''aal'', ''aal1'') = ''aal2'') with check (not exige_2fa() or coalesce(auth.jwt() ->> ''aal'', ''aal1'') = ''aal2'')',
      t.tablename);
  end loop;
end $$;
drop policy if exists exige_segundo_fator on profiles;
