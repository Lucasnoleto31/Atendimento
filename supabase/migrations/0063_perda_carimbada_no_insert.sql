-- 0063: perdido_em carimbado também no INSERT
--
-- O gatilho da 0038 (renumerado t01 na 0043) era BEFORE UPDATE apenas: um
-- lead que já NASCE como 'perdido' (importação, seed, insert à mão) ficava
-- sem perdido_em — e o bloqueio de template de 30 dias, que conta a partir
-- desse carimbo, nunca armava para ele. Todos os caminhos do app marcam
-- perdido via UPDATE, então produção não foi afetada até aqui; isto fecha a
-- porta para os caminhos que ainda não existem.

create or replace function leads_carimbar_perda()
returns trigger
language plpgsql
as $$
begin
  if new.status = 'perdido' then
    -- No INSERT não existe OLD — todo insert já perdido ganha o carimbo.
    if tg_op = 'INSERT' or old.status is distinct from 'perdido' then
      new.perdido_em = coalesce(new.perdido_em, now());
    end if;
  else
    -- Reabriu (ou nasceu vivo): a perda antiga não pode continuar somando.
    new.perda_motivo  = null;
    new.perda_detalhe = null;
    new.perdido_em    = null;
  end if;
  return new;
end;
$$;

-- Mesmo nome da 0043 para manter a posição t01 na fila de gatilhos.
drop trigger if exists leads_t01_carimbar_perda on leads;
create trigger leads_t01_carimbar_perda
  before insert or update on leads
  for each row execute function leads_carimbar_perda();

-- Acerto do estoque: perdidos que nasceram assim e ficaram sem carimbo.
update leads
set perdido_em = coalesce(perdido_em, entrou_na_etapa_em, atualizado_em, criado_em)
where status = 'perdido'
  and perdido_em is null;
