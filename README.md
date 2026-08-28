# Zeve CRM

CRM de atendimento e carteira da Zeve: leads chegam pelo WhatsApp (e Instagram),
passam pelo kanban de atendimento e viram clientes acompanhados por giro,
receita e cadência de follow-up.

## Stack

- **Next.js 16** (App Router, Server Actions) — aplicação e API em um só deploy.
- **Supabase** — Postgres com RLS, Auth, Storage e Realtime.
- **Meta WhatsApp Cloud API** — envio e recebimento direto, sem intermediário.

## Como começar

1. Siga o passo a passo de [`docs/SETUP.md`](docs/SETUP.md) — projeto Supabase,
   migrações, variáveis de ambiente e primeiro usuário.
2. Para conectar o número do WhatsApp, veja
   [`docs/META-WHATSAPP.md`](docs/META-WHATSAPP.md).
3. As migrações do banco (ordem e estado de cada uma) estão documentadas em
   [`supabase/migrations/README.md`](supabase/migrations/README.md).

```bash
npm install
npm run dev
```

A aplicação sobe em [http://localhost:3000](http://localhost:3000).

## Scripts úteis

- `scripts/usuario.mjs` — cria o primeiro admin / recuperação de acesso
  (a tela Admin cobre o dia a dia).
