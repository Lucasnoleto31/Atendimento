-- =============================================================================
-- Campanhas com ritmo diário + importação de leads
-- =============================================================================
-- Uma lista de 900 pessoas não pode sair de uma vez: a Meta limita conversas
-- iniciadas por dia (250 sem verificação, 1.000 no Tier 1) e bloqueio em massa
-- derruba a qualidade do número — que hoje é o canal de TODO o atendimento.
--
-- A campanha guarda o público (etiqueta), o template e a cota diária. O motor
-- envia até `por_dia` por dia útil e para sozinho quando acaba a lista.
--
-- Script reexecutável.
-- =============================================================================

-- Importação de leads passa a existir no histórico de arquivos.
alter type import_kind add value if not exists 'leads';

create table if not exists campanhas (
  id              uuid primary key default gen_random_uuid(),
  nome            text not null,
  template_nome   text not null,
  template_idioma text not null default 'pt_BR',
  -- Valores fixos das variáveis do template; aceita o token {nome}.
  parametros      jsonb not null default '{}'::jsonb,
  -- Público: leads com esta etiqueta. Sem etiqueta, a campanha não roda.
  etiqueta_id     uuid references tags (id) on delete set null,
  por_dia         smallint not null default 30 check (por_dia between 1 and 500),
  dias_uteis      boolean not null default true,
  hora_inicio     smallint not null default 9  check (hora_inicio between 0 and 23),
  hora_fim        smallint not null default 18 check (hora_fim between 1 and 24),
  status          text not null default 'pausada'
    check (status in ('ativa', 'pausada', 'concluida')),
  criado_por      uuid references profiles (id) on delete set null,
  criado_em       timestamptz not null default now(),
  concluida_em    timestamptz
);

comment on table campanhas is
  'Disparo de template em ritmo diário para o público de uma etiqueta.';

create table if not exists campanha_envios (
  campanha_id uuid not null references campanhas (id) on delete cascade,
  lead_id     uuid not null references leads (id) on delete cascade,
  enviado_em  timestamptz not null default now(),
  message_id  text,
  erro        text,
  primary key (campanha_id, lead_id)
);

create index if not exists campanha_envios_dia_idx
  on campanha_envios (campanha_id, enviado_em desc);

alter table campanhas       enable row level security;
alter table campanha_envios enable row level security;

drop policy if exists leitura_equipe on campanhas;
create policy leitura_equipe on campanhas
  for select to authenticated using (true);

drop policy if exists gestao on campanhas;
create policy gestao on campanhas
  for all to authenticated using (sou_gestor()) with check (sou_gestor());

drop policy if exists leitura_equipe on campanha_envios;
create policy leitura_equipe on campanha_envios
  for select to authenticated using (true);
