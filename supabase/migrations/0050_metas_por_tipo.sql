-- =============================================================================
-- Fase 2: metas de contas abertas e de ativações por pessoa
-- =============================================================================
-- A mesa media a meta em R$ e em contatos/dia — mas o funil que paga é
-- conta ABERTA e cliente ATIVADO (1º giro). As duas ganham meta mensal por
-- pessoa, editável só pelo admin, visível para gestão.
--
-- A guarda é o gatilho da 0027 (RLS não trava coluna): ele é REESCRITO aqui
-- cobrindo as colunas novas — sem isso, qualquer um editaria a própria meta
-- nova por baixo dos panos.
--
-- Script reexecutável.
-- =============================================================================

alter table profiles
  add column if not exists meta_contas_mes    integer not null default 0
    check (meta_contas_mes >= 0),
  add column if not exists meta_ativacoes_mes integer not null default 0
    check (meta_ativacoes_mes >= 0);

comment on column profiles.meta_contas_mes is
  'Meta mensal de contas abertas (leads ganhos) da pessoa. 0 = sem meta.';
comment on column profiles.meta_ativacoes_mes is
  'Meta mensal de ativações (clientes que fizeram o 1º giro, pelo dia real da operação — referencia_data do primeiro lote). 0 = sem meta.';

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
       or new.meta_contas_mes is distinct from old.meta_contas_mes
       or new.meta_ativacoes_mes is distinct from old.meta_ativacoes_mes
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
