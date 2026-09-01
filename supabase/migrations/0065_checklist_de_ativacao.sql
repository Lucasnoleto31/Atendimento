-- =============================================================================
-- 0065: checklist de ativação no painel do chat
-- =============================================================================
-- A ativação tem um roteiro (link de abertura → cadastro → conta → código do
-- assessor → STVM → depósito → plataforma → 1ª operação → grupo) e hoje cada
-- atendente carrega esse estado na cabeça. O painel do chat ganha o checklist:
-- uma linha aqui = um passo CONCLUÍDO daquele lead (pendente é ausência),
-- com carimbo de quando e de quem marcou.
--
-- Dois passos nem passam por esta tabela: "Conta aprovada" e "1ª operação"
-- vêm dos fatos (customers.conta_aberta_em e o primeiro lote em
-- customer_lots — a definição canônica de ativação da Fase 2). Etiqueta ou
-- marcação manual do que o sistema já sabe viraria mentira com o tempo.
--
-- Script reexecutável.
-- =============================================================================

create table if not exists ativacao_checklist (
  lead_id  uuid not null references leads (id) on delete cascade,
  passo    text not null,
  feito_em timestamptz not null default now(),
  autor_id uuid references profiles (id) on delete set null,
  primary key (lead_id, passo),
  -- Os dois passos automáticos ficam FORA do check de propósito: eles nunca
  -- passam por esta tabela, e uma linha inserida à mão viraria um "feito"
  -- que ninguém consegue desfazer pela tela.
  constraint ativacao_checklist_passo_chk check (passo in (
    'link_abertura', 'cadastro_iniciado',
    'codigo_assessor', 'stvm_custodia', 'deposito',
    'plataforma', 'grupo'
  ))
);

alter table ativacao_checklist enable row level security;

-- Mesma régua do resto do atendimento (0027): a equipe inteira lê e marca —
-- o checklist é trabalho colaborativo, não território de um dono.
drop policy if exists ativacao_checklist_le on ativacao_checklist;
create policy ativacao_checklist_le on ativacao_checklist
  for select to authenticated using (true);

drop policy if exists ativacao_checklist_insere on ativacao_checklist;
create policy ativacao_checklist_insere on ativacao_checklist
  for insert to authenticated with check (true);

-- O upsert do "marcar de novo" (clique duplo, corrida entre colegas) cai em
-- UPDATE — sem esta policy ele seria negado pelo RLS.
drop policy if exists ativacao_checklist_edita on ativacao_checklist;
create policy ativacao_checklist_edita on ativacao_checklist
  for update to authenticated using (true) with check (true);

drop policy if exists ativacao_checklist_apaga on ativacao_checklist;
create policy ativacao_checklist_apaga on ativacao_checklist
  for delete to authenticated using (true);
