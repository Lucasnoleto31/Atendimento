-- =============================================================================
-- Fechar os buracos de escrita do RLS
-- =============================================================================
-- O cliente do navegador usa a chave anônima com a sessão do usuário, então
-- toda policy vale contra o que um vendedor consegue rodar pelo console. Três
-- brechas:
--
--   1. profiles: a policy de auto-edição não trava a coluna `papel` — um
--      vendedor se promovia a admin com um update.
--   2. leads / lead_interactions: escrita_equipe era `for all using(true)`,
--      e `for all` inclui DELETE — dava para apagar a base inteira e o log
--      de auditoria.
--   3. atualizar_documentos_leads: security definer sem revoke, aberta a
--      anon, disparava mutação em leads ignorando o RLS.
--
-- O modelo colaborativo (todo mundo lê e escreve o atendimento) continua: só
-- o DELETE e a edição do log saem das mãos da equipe, e a coluna papel/metas
-- fica só com o admin. INSERT/UPDATE de leads seguem abertos (o chat depende
-- disso pelo cliente anônimo).
--
-- Script reexecutável.
-- =============================================================================

-- 1. Perfil: ninguém muda o próprio papel/metas -------------------------------
-- Guarda por gatilho porque RLS não trava coluna. Admin muda de qualquer um;
-- service role (as actions de gestão) tem auth.uid() nulo e passa.

create or replace function proteger_perfil_sensivel()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if auth.uid() is not null
     and meu_papel() is distinct from 'admin'
     and (
       new.papel is distinct from old.papel
       or new.meta_mensal_centavos is distinct from old.meta_mensal_centavos
       or new.meta_contatos_dia is distinct from old.meta_contatos_dia
       or new.ativo is distinct from old.ativo
     )
  then
    raise exception 'Só a administração altera papel, metas ou status da conta.';
  end if;
  return new;
end;
$$;

drop trigger if exists profiles_protege_sensivel on profiles;
create trigger profiles_protege_sensivel
  before update on profiles
  for each row
  execute function proteger_perfil_sensivel();

-- 2. leads / lead_interactions: tirar DELETE (e edição do log) da equipe ------

drop policy if exists escrita_equipe on leads;
create policy leads_insere on leads
  for insert to authenticated with check (true);
create policy leads_edita on leads
  for update to authenticated using (true) with check (true);
create policy leads_apaga on leads
  for delete to authenticated using (sou_gestor());

-- lead_interactions é o log de auditoria: a equipe só INSERE. Editar e apagar
-- é coisa de gestor (o webhook e os motores escrevem via service role, que
-- ignora o RLS).
drop policy if exists escrita_equipe on lead_interactions;
create policy interacoes_insere on lead_interactions
  for insert to authenticated with check (true);
create policy interacoes_edita on lead_interactions
  for update to authenticated using (sou_gestor()) with check (sou_gestor());
create policy interacoes_apaga on lead_interactions
  for delete to authenticated using (sou_gestor());

-- lead_tags segue liberado: pôr e tirar etiqueta é operação normal da equipe.

-- 3. Função definer exposta a anon: fechar como as outras --------------------

do $$
begin
  if exists (
    select 1 from pg_proc where proname = 'atualizar_documentos_leads'
  ) then
    execute 'alter function atualizar_documentos_leads() set search_path = public';
    execute 'revoke execute on function atualizar_documentos_leads() from public, anon, authenticated';
  end if;
end;
$$;
