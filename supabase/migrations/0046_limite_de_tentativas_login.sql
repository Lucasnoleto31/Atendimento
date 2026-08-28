-- =============================================================================
-- Etapa 1 do endurecimento do /entrar: limite de tentativas de login
-- =============================================================================
-- Não havia limite nenhum: dava para martelar senhas à vontade. Agora, 5
-- falhas em 15 minutos para o MESMO e-mail ou o MESMO IP bloqueiam novas
-- tentativas pelo período, com mensagem genérica (não revela se o e-mail
-- existe nem o tempo restante). Login correto zera o contador — apagando as
-- falhas daquele e-mail/IP. Tentativa bloqueada vai para a trilha de
-- auditoria (0040), visível só para gestão.
--
-- Postgres como limitador de propósito: a Vercel é serverless (memória não
-- sobrevive entre requisições) e não há Redis — e o volume aqui é de tela de
-- login de equipe, não de API pública.
--
-- Script reexecutável.
-- =============================================================================

create table if not exists login_tentativas (
  id        uuid primary key default gen_random_uuid(),
  email     text not null,
  ip        text not null,
  criado_em timestamptz not null default now()
);

create index if not exists login_tentativas_email_idx
  on login_tentativas (email, criado_em desc);
create index if not exists login_tentativas_ip_idx
  on login_tentativas (ip, criado_em desc);

-- RLS ligada e NENHUMA política: só o service role (o servidor) lê e grava.
-- Nem usuário logado enxerga a tabela.
alter table login_tentativas enable row level security;

comment on table login_tentativas is
  'Falhas de login dos últimos minutos. 5 em 15min por e-mail ou IP bloqueiam; sucesso apaga as linhas do e-mail/IP; expurgo de +24h no caminho do login.';
