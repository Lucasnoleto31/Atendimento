-- =============================================================================
-- Lead vira "ganho" sozinho quando abre conta
-- =============================================================================
-- Sem isso a coluna Ganhos do relatório fica zerada, e o custo por ganho de
-- cada campanha não tem denominador: dá para ver o dinheiro saindo em
-- template, nunca o retorno.
--
-- A marca vale para a CONVERSÃO: o lead entrou sem cliente e ganhou um
-- customer_id depois (cruzamento por telefone, por CPF no chat, ou vínculo
-- manual). Lead que já nasce com cliente — reativação da carteira e
-- importação que casou na hora — não é conversão de campanha nenhuma e fica
-- de fora de propósito: marcá-lo tiraria a carteira inteira das filas de
-- contato de /leads, que ignoram ganho e perdido.
--
-- Script reexecutável.
-- =============================================================================

create or replace function marcar_lead_ganho()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  -- `new.status is not distinct from old.status`: só marca ganho quando o
  -- UPDATE foi um vínculo PURO de cliente (telefone/CPF/manual) e não mexeu
  -- no status. O motor de reativação reabre o lead mudando o status para
  -- 'em_atendimento' no MESMO update que preenche o customer_id — aí o
  -- status muda, a guarda falha, e o resgate não é atropelado por 'ganho'.
  if old.customer_id is null
     and new.customer_id is not null
     and new.status is not distinct from old.status
     and new.status is distinct from 'ganho' then

    new.status = 'ganho';
    new.cliente_confirmado_em = coalesce(new.cliente_confirmado_em, now());

    -- Fica registrado por que o status mudou sozinho.
    insert into lead_interactions (lead_id, tipo, conteudo, metadados)
    values (
      new.id,
      'nota',
      'Abriu conta na corretora — marcado como ganho automaticamente.',
      jsonb_build_object('via', 'automatico', 'customer_id', new.customer_id)
    );
  end if;

  return new;
end;
$$;

-- O nome começa com "zz" de propósito: gatilhos BEFORE disparam em ordem
-- alfabética, e este precisa rodar DEPOIS de leads_vincular_cliente e
-- leads_vincular_cliente_documento, que são quem preenche o customer_id.
-- E é "before update" sem lista de colunas porque aqueles gatilhos escrevem
-- new.customer_id num UPDATE que mexe só no telefone ou no documento.
drop trigger if exists leads_zz_marcar_ganho on leads;
create trigger leads_zz_marcar_ganho
  before update on leads
  for each row
  execute function marcar_lead_ganho();

-- Quem já converteu antes deste gatilho existir: entrou como lead e só
-- depois virou cliente (a folga de 1 minuto separa isso de quem já nasceu
-- vinculado, onde as duas datas são o mesmo instante).
update leads
set status = 'ganho'
where customer_id is not null
  and status is distinct from 'ganho'
  and cliente_confirmado_em is not null
  and cliente_confirmado_em > criado_em + interval '1 minute';
