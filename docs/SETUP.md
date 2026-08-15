# Setup do ambiente

## 1. Criar o projeto no Supabase

1. Acesse [supabase.com](https://supabase.com) e crie um projeto novo.
2. Região: **South America (São Paulo)** — menor latência para a equipe.
3. Guarde a senha do banco que o painel gerar.

## 2. Rodar a estrutura do banco

No painel do Supabase, abra **SQL Editor > New query**, cole todo o conteúdo de
[`supabase/migrations/0001_init.sql`](../supabase/migrations/0001_init.sql) e execute.

Isso cria as tabelas, as visões das listas de atendimento, os gatilhos de
cruzamento por telefone e as políticas de acesso (RLS), além de já inserir as
etapas do kanban, os canais e os parâmetros padrão.

## 3. Configurar as variáveis de ambiente

```bash
cp .env.local.example .env.local
```

Preencha com os valores de **Project Settings > API** no painel do Supabase.
O arquivo `.env.local` não vai para o Git.

## 4. Criar o primeiro usuário

Ainda não existe tela de cadastro — por decisão de projeto, quem cria usuário é o
admin. O administrador do sistema é **lucas@zeve.com.br**.

### Opção A — pelo painel

1. Painel do Supabase > **Authentication > Users > Add user**.
2. Informe e-mail e senha, e marque *Auto Confirm User*.
3. Em **User Metadata**, adicione:

```json
{ "nome": "Lucas", "papel": "admin" }
```

O gatilho `handle_new_user` cria o perfil correspondente automaticamente. Se o
usuário já existia antes com outro papel, rode
[`supabase/scripts/promover_admin.sql`](../supabase/scripts/promover_admin.sql)
no SQL Editor.

### Opção B — pelo script

Exige `SUPABASE_SERVICE_ROLE_KEY` preenchida no `.env.local`:

```bash
node --env-file=.env.local scripts/usuario.mjs lucas@zeve.com.br "Lucas" admin
```

Cria o usuário com senha aleatória (exibida uma única vez) ou, se ele já existir,
apenas atualiza o papel. O mesmo comando serve para cadastrar os vendedores até a
tela de Administração ficar pronta.

## 5. Subir o projeto

```bash
npm run dev
```

## Storage (importações)

Crie um bucket **privado** chamado `importacoes` em **Storage > New bucket**. É
onde ficam os arquivos de clientes e de lotes enviados todo dia.
