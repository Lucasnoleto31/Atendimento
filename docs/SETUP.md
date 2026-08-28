# Setup do ambiente

## 1. Criar o projeto no Supabase

1. Acesse [supabase.com](https://supabase.com) e crie um projeto novo.
2. Região: **South America (São Paulo)** — menor latência para a equipe.
3. Guarde a senha do banco que o painel gerar.

## 2. Rodar a estrutura do banco

Aplique **todas** as migrações de `supabase/migrations/`, **em ordem numérica**
(0001, 0002, 0003…): no painel do Supabase, abra **SQL Editor > New query**,
cole o conteúdo de cada arquivo e execute, uma por vez. A lista completa, com o
que cada migração faz, está em
[`supabase/migrations/README.md`](../supabase/migrations/README.md).

A 0001 cria a base (tabelas, visões, gatilhos de cruzamento por telefone, RLS,
etapas do kanban, canais e parâmetros); as seguintes evoluem o banco — partes
do CRM ficam inertes ou quebram sem elas.

## 3. Configurar as variáveis de ambiente

```bash
cp .env.local.example .env.local
```

Preencha com os valores de **Project Settings > API** no painel do Supabase.
O arquivo `.env.local` não vai para o Git.

## 4. Criar o primeiro usuário

No dia a dia, quem cria e gerencia usuários é a **tela Admin** do próprio CRM
(menu Administração — exige papel admin). Mas ela precisa de um admin logado,
então o primeiro é criado por fora, via bootstrap:

```bash
node --env-file=.env.local scripts/usuario.mjs lucas@zeve.com.br "Lucas" admin
```

Exige `SUPABASE_SERVICE_ROLE_KEY` preenchida no `.env.local`. O script cria o
usuário com senha aleatória (exibida uma única vez) ou, se ele já existir,
apenas atualiza o papel — por isso também serve como recuperação de acesso.

A partir daí, cadastre o resto da equipe pela tela Admin.

## 5. Subir o projeto

```bash
npm run dev
```

## Storage (importações)

Crie um bucket **privado** chamado `importacoes` em **Storage > New bucket**. É
onde ficam os arquivos de clientes e de lotes enviados todo dia.
