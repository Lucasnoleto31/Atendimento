# Zeve Atendimento

Chat de atendimento da Zeve: as conversas do WhatsApp (Meta Cloud API) e do
Instagram Direct chegam numa caixa de entrada compartilhada pela equipe, com
atribuição, etiquetas, templates da Meta, mensagens padrão, anexos e áudio.
Em volta do chat ficam a lista de contatos (com importação por planilha e
exportação em CSV), os disparos em massa, o relatório de atendimento da
equipe e o log de acesso.

## Stack

- **Next.js 16** (App Router, Server Actions) — aplicação e API em um só deploy.
- **Supabase** — Postgres com RLS, Auth, Storage e Realtime.
- **Resend** — e-mail do código de 6 dígitos da recuperação de senha e do
  aviso de senha trocada.
- **Meta WhatsApp Cloud API** e **API do Instagram** (Direct) — envio e
  recebimento direto, sem intermediário.
- **Vercel** — função na região `gru1` (São Paulo), a mesma do Supabase
  (`vercel.json`).

## Como começar

1. Siga o passo a passo de [`docs/SETUP.md`](docs/SETUP.md) — projeto Supabase,
   migrações, variáveis de ambiente e primeiro usuário.
2. Para conectar o número do WhatsApp, veja
   [`docs/META-WHATSAPP.md`](docs/META-WHATSAPP.md).
3. As migrações do banco (ordem e estado de cada uma) estão documentadas em
   [`supabase/migrations/README.md`](supabase/migrations/README.md).
4. Para subir o sistema para outra empresa, com o nome e a marca dela, veja
   [`docs/NOVO-CLIENTE.md`](docs/NOVO-CLIENTE.md).

```bash
npm install
npm run dev
```

A aplicação sobe em [http://localhost:3000](http://localhost:3000). Se o
`.env.local` apontar para o banco de produção, defina `MOTORES_DESLIGADOS=1`
antes de abrir qualquer página (ver `.env.local.example`).

## Scripts úteis

- `scripts/usuario.mjs` — cria o primeiro admin / recuperação de acesso
  (a tela Admin cobre o dia a dia).
