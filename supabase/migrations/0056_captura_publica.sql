-- =============================================================================
-- Fase 7.1: rate limit do formulário público de captura
-- =============================================================================
-- A página /captura aceita POST sem login — a primeira porta da internet
-- para dentro do CRM. O honeypot barra o robô burro; esta tabela barra o
-- resto: 5 envios em 15 minutos pelo MESMO IP ou MESMO telefone bloqueiam
-- novos envios pelo período, com mensagem genérica. Bloqueio vai para a
-- trilha de auditoria (0040); expurgo de +24h no próprio caminho do envio.
--
-- Postgres como limitador pelo mesmo motivo da 0046 (login_tentativas):
-- Vercel é serverless, memória não sobrevive entre requisições e não há
-- Redis. O limite honesto por IP também é o mesmo: atrás de CGNAT um IP
-- agrega muita gente — por isso o eixo adicional por telefone.
--
-- Script reexecutável.
-- =============================================================================

create table if not exists captura_tentativas (
  id        uuid primary key default gen_random_uuid(),
  ip        text not null,
  telefone  text,
  criado_em timestamptz not null default now()
);

create index if not exists captura_tentativas_ip_idx
  on captura_tentativas (ip, criado_em desc);
create index if not exists captura_tentativas_telefone_idx
  on captura_tentativas (telefone, criado_em desc);

-- RLS ligada e NENHUMA política: só o service role (o servidor) lê e grava.
alter table captura_tentativas enable row level security;

comment on table captura_tentativas is
  'Envios do formulário público /captura. 5 em 15min por IP ou telefone bloqueiam; expurgo de +24h no caminho do envio (Fase 7.1).';
