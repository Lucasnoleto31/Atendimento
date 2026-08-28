-- =============================================================================
-- Fase 7.2: resumo diário do gestor no WhatsApp
-- =============================================================================
-- Às 18h30 de dia útil, o batimento envia por template aprovado o dia da
-- mesa para os gestores/admins com WhatsApp cadastrado. Três peças:
--
--   profiles.whatsapp_e164 — para ONDE enviar (não existia telefone de
--                            usuário em lugar nenhum);
--   resumo_do_dia(p_inicio) — os 5 números num round-trip, SEM porteiro:
--                            quem chama é o batimento (service role, sem
--                            sessão) — a quadro_equipe da 0048 voltaria
--                            VAZIA em silêncio (auth.uid() nulo). Por isso
--                            o execute é só do service_role;
--   settings.resumo_gestor_ativo — nasce DESLIGADO; liga em Configurações.
--
-- Script reexecutável.
-- =============================================================================

alter table profiles add column if not exists whatsapp_e164 text;

comment on column profiles.whatsapp_e164 is
  'WhatsApp da própria pessoa (E.164, só dígitos) — destino do resumo diário do gestor (7.2). Nada a ver com leads.';

create or replace function resumo_do_dia(p_inicio timestamptz)
returns jsonb
language sql
stable
security definer
set search_path = public
as $$
select jsonb_build_object(
  -- Contas abertas hoje: leads marcados ganho no dia (o carimbo é na hora
  -- do vínculo — a data da Genial só chega no arquivo do dia seguinte).
  'contas', (
    select count(*) from leads
    where status = 'ganho' and cliente_confirmado_em >= p_inicio
  ),
  -- Ativações REGISTRADAS hoje: cliente cujo primeiro lote da vida entrou
  -- na importação de hoje (mesma régua do placar da /hoje, 0047).
  'ativacoes', (
    select count(distinct l.customer_id)
    from customer_lots l
    where l.criado_em >= p_inicio
      and not exists (
        select 1 from customer_lots a
        where a.customer_id = l.customer_id and a.criado_em < p_inicio
      )
  ),
  'vendas', (
    select count(*) from sales
    where status = 'confirmada' and ocorreu_em >= p_inicio
  ),
  'aguardando_24h', (
    select count(*) from v_leads_listas
    where aguardando_resposta and coalesce(horas_esperando, 0) >= 24
  ),
  -- Mesmo critério do Giro em risco da /hoje e da Carteira: já girou e
  -- zerou, ou caiu 25%+ — comparação coluna×coluna só existe aqui no SQL.
  'giro_risco', (
    select count(*) from v_carteira
    where ultimo_giro_em is not null
      and (
        coalesce(lotes_30d, 0) = 0
        or (coalesce(lotes_30d_anterior, 0) > 0
            and lotes_30d < lotes_30d_anterior * 0.75)
      )
  )
)
$$;

revoke execute on function resumo_do_dia(timestamptz) from public, anon, authenticated;
grant execute on function resumo_do_dia(timestamptz) to service_role;

-- Nasce desligado: liga em Configurações → Parâmetros quando o template
-- estiver aprovado na Meta e os WhatsApps preenchidos.
insert into settings (chave, valor, descricao) values
  ('resumo_gestor_ativo', '0'::jsonb,
   'Resumo diário do gestor no WhatsApp às 18h30 (1 liga, 0 desliga). Exige template resumo_diario aprovado e whatsapp_e164 nos perfis.')
on conflict (chave) do nothing;
