-- =============================================================================
-- Carteira: o dono acompanha quem atende, e o contato olha a conversa viva
-- =============================================================================
-- Dois defeitos que faziam a tela mentir:
--
-- 1. DONO PARADO. customers.responsavel_id só era preenchido pelo backfill da
--    0015 e pela edição manual da ficha. Todo lead atribuído depois (rodízio,
--    troca de atendente no chat) não chegava à carteira: a coluna
--    "Responsável" continuava mostrando o dono antigo ou "sem dono" para
--    sempre. Agora um gatilho espelha o atendente do lead principal, e a view
--    ainda cai no atendente do lead quando o cliente não tem dono gravado.
--
-- 2. LEAD ERRADO. A view pegava o lead mais RECÉM-CRIADO do cliente. Quem tem
--    mais de um lead (importação criou um, o WhatsApp já tinha outro) via o
--    contato e o botão do chat apontando para a conversa morta — disparar o
--    template na conversa viva não mexia em nada na tela. Agora vale o lead
--    com interação mais recente, que é onde a conversa realmente acontece.
--
-- Script reexecutável.
-- =============================================================================

-- 1. Dono da carteira acompanha o atendente do lead ---------------------------

create or replace function sincronizar_dono_carteira()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  principal uuid;
begin
  if new.customer_id is null then
    return new;
  end if;

  -- O mesmo critério da v_carteira: manda o lead com conversa mais viva.
  select l.responsavel_id into principal
  from leads l
  where l.customer_id = new.customer_id
  order by l.ultima_interacao_em desc nulls last, l.criado_em desc
  limit 1;

  if principal is not null then
    update customers
    set responsavel_id = principal
    where id = new.customer_id
      and responsavel_id is distinct from principal;
  end if;

  return new;
end;
$$;

comment on function sincronizar_dono_carteira() is
  'Espelha o atendente do lead principal no dono da carteira do cliente.';

drop trigger if exists leads_sincroniza_dono_carteira on leads;
create trigger leads_sincroniza_dono_carteira
  after insert or update of responsavel_id, customer_id on leads
  for each row
  execute function sincronizar_dono_carteira();

revoke execute on function sincronizar_dono_carteira() from public, anon;

-- Põe em dia o que ficou para trás desde a 0015 (idempotente). Sem LATERAL:
-- o alvo do UPDATE não pode ser referenciado de dentro do FROM.
update customers c
set responsavel_id = principal.responsavel_id
from (
  select distinct on (l.customer_id)
         l.customer_id,
         l.responsavel_id
  from leads l
  where l.customer_id is not null
    and l.responsavel_id is not null
  order by l.customer_id,
           l.ultima_interacao_em desc nulls last,
           l.criado_em desc
) principal
where principal.customer_id = c.id
  and c.responsavel_id is distinct from principal.responsavel_id;

-- 2. v_carteira: lead da conversa viva + dono com plano B ---------------------

drop view if exists v_carteira;
create view v_carteira as
select
  c.id                                   as customer_id,
  c.nome_completo,
  c.status,
  c.segmento,
  c.conta_aberta_em,
  c.churned_em,
  c.motivo_churn,
  -- Cliente sem dono gravado herda o atendente do lead: a tela mostra quem
  -- de fato está falando com ele, mesmo antes do gatilho passar por ali.
  coalesce(c.responsavel_id, l.responsavel_id) as responsavel_id,
  p.nome                                 as responsavel_nome,
  g.lotes_30d,
  g.lotes_30d_anterior,
  g.ultimo_giro_em,
  case
    when g.ultimo_giro_em is null then null
    else (current_date - g.ultimo_giro_em)
  end                                    as dias_sem_giro,
  r.receita_30d_centavos,
  r.ltv_centavos,
  l.id                                   as lead_id,
  -- Telefone do lead quando existe; senão o do cadastro do cliente.
  coalesce(l.telefone_e164, c.telefone_e164) as telefone_e164,
  c.telefone_e164                        as telefone_cliente,
  l.marketing_bloqueado_em,
  l.ultima_interacao_em,
  case
    when l.ultima_interacao_em is null then null
    else extract(day from now() - l.ultima_interacao_em)::integer
  end                                    as dias_sem_contato
from customers c
left join lateral (
  select l.id, l.telefone_e164, l.ultima_interacao_em, l.responsavel_id,
         l.marketing_bloqueado_em
  from leads l
  where l.customer_id = c.id
  -- Conversa viva primeiro; empate (nenhum falou) desempata pelo mais novo.
  order by l.ultima_interacao_em desc nulls last, l.criado_em desc
  limit 1
) l on true
left join v_customer_giro g on g.customer_id = c.id
left join v_customer_receita r on r.customer_id = c.id
left join profiles p on p.id = coalesce(c.responsavel_id, l.responsavel_id)
where c.ativo;

alter view v_carteira set (security_invoker = true);
