-- =============================================================================
-- mesclar_clientes: não estourar a unique do telefone, e não perder histórico
-- =============================================================================
-- Ao unir dois clientes duplicados, a função copiava o telefone do removido
-- para o mantido ANTES de apagar o removido — por um instante os dois tinham
-- o mesmo telefone, e o índice único parcial (telefone_e164 não nulo) estoura
-- com "duplicate key ... customers_telefone_unq". Ficou visível agora porque a
-- normalização de CPF (0029) passou a casar mais clientes, gerando mais
-- mesclas.
--
-- Correção: mover todas as dependências (inclusive customer_events, que antes
-- era apagado em cascata — perda de histórico de ciclo de vida), guardar os
-- escalares do removido, APAGAR o removido para liberar o telefone único, e só
-- então o mantido herda o que lhe faltava.
--
-- Script reexecutável.
-- =============================================================================

create or replace function mesclar_clientes(manter uuid, remover uuid)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  r_tel      text;
  r_doc      text;
  r_email    text;
  r_abertura date;
  r_resp     uuid;
  r_seg      text;
begin
  if manter = remover or manter is null or remover is null then
    return;
  end if;

  -- Contas do removido passam para o mantido.
  update customer_accounts set customer_id = manter where customer_id = remover;

  -- Lotes: dias que existem nos dois somam no mantido; o resto migra.
  update customer_lots l
  set quantidade = l.quantidade + d.quantidade
  from customer_lots d
  where l.customer_id = manter
    and d.customer_id = remover
    and d.referencia_data = l.referencia_data;

  delete from customer_lots d
  using customer_lots l
  where d.customer_id = remover
    and l.customer_id = manter
    and l.referencia_data = d.referencia_data;

  update customer_lots set customer_id = manter where customer_id = remover;

  update leads set customer_id = manter where customer_id = remover;
  update sales set customer_id = manter where customer_id = remover;

  -- Histórico de ciclo de vida não some na mescla (era apagado em cascata).
  -- Guarda no bloco: sem a migração 0015 a tabela não existe.
  begin
    update customer_events set customer_id = manter where customer_id = remover;
  exception when undefined_table then
    null;
  end;

  -- Escalares do removido, para o mantido herdar o que lhe faltar.
  select telefone_e164, documento, email, conta_aberta_em
    into r_tel, r_doc, r_email, r_abertura
    from customers where id = remover;

  -- responsavel_id e segmento existem a partir da 0015 — busca à parte para
  -- degradar quando as colunas não existem.
  begin
    execute 'select responsavel_id, segmento from customers where id = $1'
      into r_resp, r_seg using remover;
  exception when undefined_column then
    r_resp := null;
    r_seg := null;
  end;

  -- Apaga o removido ANTES de copiar o telefone: assim o número fica livre e
  -- o mantido pode herdá-lo sem colidir com ele mesmo no meio da transação.
  delete from customers where id = remover;

  update customers k
  set telefone_e164   = coalesce(k.telefone_e164, r_tel),
      documento       = coalesce(k.documento, r_doc),
      email           = coalesce(k.email, r_email),
      conta_aberta_em = least(
        coalesce(k.conta_aberta_em, r_abertura),
        coalesce(r_abertura, k.conta_aberta_em)
      )
  where k.id = manter;

  -- Dono da carteira e segmento: preenche o que o mantido não tinha.
  begin
    execute '
      update customers k
      set responsavel_id = coalesce(k.responsavel_id, $2),
          segmento       = coalesce(k.segmento, $3)
      where k.id = $1'
    using manter, r_resp, r_seg;
  exception when undefined_column then
    null;
  end;
end;
$$;

revoke execute on function mesclar_clientes(uuid, uuid) from public, anon, authenticated;
