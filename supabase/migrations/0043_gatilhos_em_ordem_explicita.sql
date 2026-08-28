-- =============================================================================
-- Fase 2: a ordem dos gatilhos de leads vira contrato explícito
-- =============================================================================
-- Oito gatilhos BEFORE disparam em leads e a ordem entre eles era ALFABÉTICA
-- por convenção de nome ("aa_" para rodar antes, "zz_" para rodar depois) —
-- o próximo gatilho criado com nome "errado" mudaria a semântica de ganho e
-- perda sem nenhum erro. Foi essa classe de bug que estacionou leads ganhos
-- na coluna Perdido (corrigidos na 0039).
--
-- A ideia original era um orquestrador único, mas função de gatilho não pode
-- ser chamada por outra função — consolidar exigiria copiar a lógica das oito
-- para dentro de uma, criando o risco de drift que queremos matar. Em vez
-- disso, a ordem vira contrato NUMERADO no próprio nome: leads_t01_… até
-- leads_t08_. As funções não mudam; só os nomes dos gatilhos (e as condições
-- de coluna, preservadas). Regra da casa: gatilho novo em leads OBRIGA a
-- escolher um número — e o número diz onde ele entra na fila.
--
-- Ordem deliberada (e uma correção que ela destrava): stage_change agora roda
-- DEPOIS do espelho (t06 → t07) — o movimento de card feito pelos gatilhos
-- automáticos volta a ser registrado no histórico do lead, o que não
-- acontecia quando stage_change (alfabeticamente "s") rodava antes de
-- zzz_espelha ("z").
--
-- Script reexecutável.
-- =============================================================================

-- Some a geração antiga…
drop trigger if exists leads_aa_carimbar_perda        on leads;
drop trigger if exists leads_vincular_cliente          on leads;
drop trigger if exists leads_vincular_cliente_documento on leads;
drop trigger if exists leads_completa_telefone         on leads;
drop trigger if exists leads_zz_marcar_ganho           on leads;
drop trigger if exists leads_zzz_espelha_etapa         on leads;
drop trigger if exists leads_stage_change              on leads;
drop trigger if exists leads_atualizado_em             on leads;

-- …e entra a fila numerada (mesmas funções, mesmas condições de coluna).

-- t01: sair de 'perdido' limpa motivo e carimbo antes de qualquer leitura.
create trigger leads_t01_carimbar_perda
  before update on leads
  for each row execute function leads_carimbar_perda();

-- t02–t03: vínculo com a base de clientes (telefone nas duas grafias, CPF).
create trigger leads_t02_vincular_telefone
  before insert or update of telefone_e164 on leads
  for each row execute function vincular_cliente_por_telefone();

create trigger leads_t03_vincular_documento
  before insert or update of documento on leads
  for each row execute function vincular_cliente_por_documento();

-- t04: lead do cliente sem telefone herda o número da ficha.
create trigger leads_t04_completa_telefone
  before insert or update of customer_id on leads
  for each row execute function completar_telefone_do_lead();

-- t05: vínculo puro de cliente marca 'ganho' (depois de t02/t03 preencherem
-- customer_id — era o papel do prefixo "zz").
create trigger leads_t05_marcar_ganho
  before update on leads
  for each row execute function marcar_lead_ganho();

-- t06: o espelho decide a coluna (Ativação / fora do funil).
create trigger leads_t06_espelha_etapa
  before update on leads
  for each row execute function lead_ganho_espelha_etapa();

-- t07: SÓ AGORA o stage_change lê a etapa final — registra a mudança no
-- histórico e reinicia o relógio da coluna, inclusive para movimentos que
-- os gatilhos acima acabaram de fazer.
create trigger leads_t07_stage_change
  before update on leads
  for each row execute function handle_stage_change();

-- t08: o carimbo de atualização fecha a fila.
create trigger leads_t08_atualizado_em
  before update on leads
  for each row execute function set_atualizado_em();
