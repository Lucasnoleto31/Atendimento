-- =============================================================================
-- Hoje, fase 5: soneca — "voltar amanhã" para item que não é conversa
-- =============================================================================
-- Conversa que precisa esperar já tem mecanismo (adiar com prazo, 0042). Mas
-- a fila de ativação e o giro em risco não são conversas: sonecá-los não
-- pode mexer no lead nem nos motores. Esta tabela só ESCONDE o item da fila
-- daquela pessoa até o horário marcado — de manhã ele volta sozinho.
--
-- Script reexecutável.
-- =============================================================================

create table if not exists hoje_soneca (
  pessoa    uuid not null references profiles (id) on delete cascade,
  tipo      text not null check (tipo in ('ativacao', 'risco')),
  alvo      uuid not null,
  ate       timestamptz not null,
  criado_em timestamptz not null default now(),
  primary key (pessoa, tipo, alvo)
);

create index if not exists hoje_soneca_ate_idx on hoje_soneca (pessoa, ate);

alter table hoje_soneca enable row level security;

-- Cada um mexe na própria soneca; gestão enxerga e soneca pela equipe
-- (o "Ver o dia de…" soneca a fila de quem está sendo visto).
drop policy if exists propria on hoje_soneca;
create policy propria on hoje_soneca
  for all to authenticated
  using (pessoa = auth.uid() or sou_gestor())
  with check (pessoa = auth.uid() or sou_gestor());
