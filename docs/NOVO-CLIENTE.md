# Subir o sistema para outro cliente

O mesmo código serve a mais de uma empresa, uma implantação por empresa:
Supabase próprio, projeto próprio na Vercel, app próprio na Meta e o nome
e a marca dela na tela. Nada é compartilhado com a Zeve. A primeira foi a
Incell, loja de iPhones (outubro de 2026); a ficha dela está no fim.

Tudo o que amarra uma implantação a uma conta fica em variáveis de
ambiente e no banco dela. Por isso dá para mudar de conta depois (ver
"Mudar de casa").

## 1. Nome e marca

Quatro variáveis `NEXT_PUBLIC_*`, embutidas no código na hora do build
(mudou, faz o build de novo). Em branco, vale a Zeve. Lidas em
`src/lib/marca.ts`.

| Variável | O que muda | Em branco |
| --- | --- | --- |
| `NEXT_PUBLIC_NOME_DA_EMPRESA` | Marca, favicon (a inicial), `/captura`, prompts da IA | `Zeve` (com o Z) |
| `NEXT_PUBLIC_NOME_DO_PRODUTO` | Título das páginas, marca por extenso, e-mails, metadados do áudio | `<empresa> Atendimento` |
| `NEXT_PUBLIC_RAMO_DO_NEGOCIO` | Sobre o que a IA do chat entende que a equipe conversa | `investimentos e abertura de conta em corretora` |
| `NEXT_PUBLIC_QUEM_ATENDE` | Quem chama o lead de volta, na `/captura` ("um vendedor") | `um assessor` |

O Z da Zeve só aparece quando a empresa é a Zeve e não há tema. Sem tema,
outra empresa usa o nome em texto e, no favicon e na barra recolhida, a
inicial.

### A cara do cliente: o tema

A quinta variável, `NEXT_PUBLIC_TEMA`, aponta para uma pasta em
`public/temas/<tema>/` com cinco arquivos. É o que troca a marca e as cores
pela do cliente, sem mexer no código:

| Arquivo | O que é |
| --- | --- |
| `tema.css` | Os tokens de cor de `src/app/globals.css` que mudam, nos dois temas (`html:root` e `html[data-theme="dark"]`), com a ficha do projeto do kit estético no comentário do topo. O que não está lá fica como no sistema. |
| `logo.svg` | A marca por extenso para o tema claro (texto na tinta clara). |
| `logo-escuro.svg` | A mesma marca para o tema escuro. Dois arquivos porque o SVG num `<img>` não herda a cor do texto. |
| `simbolo.svg` | Só o símbolo, para a barra lateral recolhida. |
| `icone.svg` | O favicon: fundo arredondado de 64×64 com o símbolo, e a `@media (prefers-color-scheme: dark)` para o fundo escuro. |

Regras do kit que valem em todo tema: um acento por tela, o neutro sai do
acento (mesma matiz, saturação de 10% a 20%), a tinta continua sendo texto e
botão principal, contraste de 4,5:1 medido, e a mesma Poppins. Degradê da
marca só no símbolo; botão, selo e chamada ficam cheios.

A primeira pasta é `public/temas/incell/`, montada em 20/10/2026 a partir
dos arquivos da marca (`IN-CELL.ai`/`.pdf`, preto e branco, e o PNG colorido
de onde o degradê foi medido). Serve de modelo: copie a pasta, troque os
SVGs e os valores do `tema.css`, e preencha a ficha no topo.

## 2. Supabase

Siga `docs/SETUP.md`, resumido aqui:

1. Projeto novo, região **South America (São Paulo)**, nome com o do
   cliente (`incell-atendimento`). Guarde a senha do banco no cofre.
2. Rode **todas** as migrações de `supabase/migrations/`, em ordem
   numérica, uma por vez no SQL Editor. As de `supabase/propostas/` não
   entram: são propostas para o banco da Zeve, não parte da instalação.
3. **Storage**: bucket público `midia-whatsapp`.
4. **Authentication › Providers › Email**: OTP Expiration em `600`.
5. Desligue o segundo fator, que a migração 0067 liga:
   `update settings set valor = '"0"' where chave = 'exigir_2fa';`
6. Primeiro admin, pela máquina de quem instala, com o `.env.local`
   apontando para esse projeto:
   `node --env-file=.env.local scripts/usuario.mjs <e-mail> "<Nome>" admin`.
   O resto da equipe entra pela tela Administração › Equipe.

## 3. Vercel

1. Projeto novo a partir deste repositório (`Lucasnoleto31/Atendimento`),
   branch de produção `main`. A região `gru1` já vem do `vercel.json`.
   O nome do projeto vira o endereço provisório (`<nome>.vercel.app`);
   o domínio do cliente entra em Settings › Domains.
2. Variáveis de ambiente, direto no painel (nunca por chat ou e-mail):

| Variável | Origem |
| --- | --- |
| `NEXT_PUBLIC_SUPABASE_URL`, `NEXT_PUBLIC_SUPABASE_ANON_KEY`, `SUPABASE_SERVICE_ROLE_KEY` | Supabase do cliente › Project Settings › API |
| `NEXT_PUBLIC_NOME_DA_EMPRESA`, `NEXT_PUBLIC_TEMA` e as outras três da seção 1 | a ficha do cliente |
| `META_APP_SECRET` | App do cliente › App Settings › Basic |
| `META_WHATSAPP_TOKEN` | token permanente do System User do BM do cliente (seção 4) |
| `META_WEBHOOK_VERIFY_TOKEN` | frase aleatória, a mesma no painel do webhook |
| `META_PHONE_NUMBER_ID`, `META_WABA_ID` | App do cliente › WhatsApp › API Setup |
| `RESEND_API_KEY`, `EMAIL_REMETENTE` | opcionais; sem eles o "Esqueci a senha" não manda e-mail (seção 5) |
| `ANTHROPIC_API_KEY` | opcional; liga o resumo e a sugestão de resposta no chat |
| `META_PAGE_TOKEN`, `INSTAGRAM_*`, `CRON_SECRET` | opcionais, como no `.env.local.example` |

   `MOTORES_DESLIGADOS` e `AUTENTICADOR_LOCAL` nunca vão para a Vercel.

3. Deploy e conferência: o cabeçalho `x-vercel-id` da resposta tem de
   trazer `gru1`.

## 4. Meta, no Business Manager do cliente

Tudo no BM **do cliente**: o número é dele e a conta de WhatsApp Business
(WABA) é dele. Quem instala precisa de acesso de administrador a esse BM.
O guia completo, com os problemas comuns, é `docs/META-WHATSAPP.md`.

1. **App** no painel de desenvolvedor (`developers.facebook.com/apps`),
   tipo Empresa, ligado ao portfólio do cliente, com o produto WhatsApp.
   Anote o id do app.
2. **Número**: em WhatsApp › API Setup, o número verificado do cliente.
   Anote `phone_number_id` e `WABA ID`.
3. **Token permanente**: Configurações do negócio › Usuários › Usuários do
   sistema › criar um usuário de sistema (admin) › Adicionar ativos: o app
   e a conta do WhatsApp › Gerar token, com `whatsapp_business_messaging`
   e `whatsapp_business_management`, sem validade. Vai direto para
   `META_WHATSAPP_TOKEN` na Vercel. Token de teste do painel expira em
   24 horas e não serve.
4. **App Secret**: App Settings › Basic › Chave secreta do app, para
   `META_APP_SECRET`. Em produção, sem ela o webhook recusa tudo.
5. **Webhook**: WhatsApp › Configuration › Webhook: URL
   `https://<domínio do cliente>/api/webhooks/meta`, o verify token da
   Vercel, e o campo **`messages`** assinado. A verificação só passa com
   o deploy no ar com `META_WEBHOOK_VERIFY_TOKEN`.
6. **App inscrito no WABA**: a assinatura dos campos vale para a WABA
   quando o app está inscrito nela (`POST /{waba-id}/subscribed_apps`
   com o token do System User, ou pelo próprio painel do WhatsApp ao
   configurar o webhook).
7. **Modo Ao vivo**: a chave no topo do painel do app. Em desenvolvimento
   a Meta só entrega mensagens de números de teste.
8. **Instância no sistema**: Administração › WhatsApp › novo número, com
   o nome do cliente e o `phone_number_id`. O atendente responsável, se
   houver, recebe os contatos novos; sem ele vale a distribuição
   automática.

## 5. Resend (e-mail do "Esqueci a senha")

Opcional, mas sem ele ninguém redefine a senha sozinho (o admin gera senha
nova em Administração › Equipe). Domínio ou subdomínio **do cliente** no
Resend, com os registros de DNS que ele mostra; depois `RESEND_API_KEY`
(só envio) e `EMAIL_REMETENTE` com um endereço desse domínio. Passo a
passo em `docs/SETUP.md`.

## 6. Teste de ponta a ponta

1. Entrar com o admin; a aba e a marca mostram o nome do cliente.
2. Mandar mensagem de um celular para o número do cliente: a conversa
   aparece no Chat, com responsável.
3. Responder pelo chat: chega no celular com ✓✓.
4. Mandar um áudio e uma foto nos dois sentidos: anexos abrem (bucket).
5. Abrir `/captura` e enviar um contato de teste: aparece em Contatos.
   Apagar o contato depois.
6. "Esqueci a senha" (se o Resend estiver ligado): o código chega.

## 7. Mudar de casa

A implantação não depende de conta nenhuma em particular. Para levar o
cliente para outra conta (dele, de outro sócio, de outro provedor):

- **Banco e mídia (Supabase)**: backup do projeto (Database › Backups ou
  `pg_dump`), projeto novo na conta de destino, restaurar, copiar o bucket
  `midia-whatsapp` e os usuários do Auth (exportáveis pelo painel). Trocar
  as três variáveis `SUPABASE_*` na Vercel. É o único passo com dado.
- **Aplicação (Vercel)**: projeto novo na conta de destino a partir do
  mesmo repositório, as mesmas variáveis, e o domínio do cliente apontado
  para lá. Nada fica no projeto antigo.
- **WhatsApp (Meta)**: nada muda; só a URL do webhook, se o domínio mudar.
  O número e a WABA já são do cliente.
- **Código**: o repositório é um só. Se o cliente precisar de código
  próprio um dia, é um fork; até lá, deploy da `main`.

O que anotar por cliente, no cofre, nunca no repositório: senha do banco,
ids da Meta (app, WABA, `phone_number_id`), onde está cada token. Os
valores das variáveis públicas (`NEXT_PUBLIC_*`) podem ficar na ficha
abaixo.

## Ficha: Incell

Loja de iPhones. Implantação em outubro de 2026, nas contas do Lucas, com
o BM e o número da própria Incell (app criado e número verificado pelo
Lucas).

| Variável | Valor |
| --- | --- |
| `NEXT_PUBLIC_NOME_DA_EMPRESA` | `Incell` |
| `NEXT_PUBLIC_NOME_DO_PRODUTO` | em branco (`Incell Atendimento`) |
| `NEXT_PUBLIC_RAMO_DO_NEGOCIO` | `iPhones, acessórios e assistência` |
| `NEXT_PUBLIC_QUEM_ATENDE` | `um vendedor` |
| `NEXT_PUBLIC_TEMA` | `incell` (pasta `public/temas/incell/`) |

Ids da Meta, domínio e Supabase: a preencher no cofre quando a instalação
fechar.
