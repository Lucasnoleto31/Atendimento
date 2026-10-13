# Setup do ambiente

## 1. Criar o projeto no Supabase

1. Acesse [supabase.com](https://supabase.com) e crie um projeto novo.
2. Região: **South America (São Paulo)** — menor latência para a equipe. A
   função da Vercel roda na mesma região (`gru1`, fixada no `vercel.json`):
   cada página faz várias idas ao banco, e com a função em outro continente
   cada uma delas paga a viagem de ida e volta entre os dois.
3. Guarde a senha do banco que o painel gerar.

## 2. Rodar a estrutura do banco

Aplique **todas** as migrações de `supabase/migrations/`, **em ordem numérica**
(0001, 0002, 0003…): no painel do Supabase, abra **SQL Editor > New query**,
cole o conteúdo de cada arquivo e execute, uma por vez. A lista completa, com o
que cada migração faz, está em
[`supabase/migrations/README.md`](../supabase/migrations/README.md).

A 0001 cria a base (tabelas, visões, gatilhos de cruzamento por telefone, RLS,
canais e parâmetros); as seguintes evoluem o banco — partes do chat ficam
inertes ou quebram sem elas.

## 3. Configurar as variáveis de ambiente

```bash
cp .env.local.example .env.local
```

Preencha com os valores de **Project Settings > API** no painel do Supabase.
O arquivo `.env.local` não vai para o Git.

**Máquina de desenvolvimento ligada no banco de produção:** defina
`MOTORES_DESLIGADOS=1` no `.env.local`. Sem isto, abrir qualquer página local
roda o batimento das campanhas contra a base real. Na Vercel essa variável
nunca existe.

## 4. Criar o primeiro usuário

No dia a dia, quem cria e gerencia usuários é a **tela Admin** do próprio
sistema (menu Administração — exige papel admin). Mas ela precisa de um admin
logado, então o primeiro é criado por fora, via bootstrap:

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

## Storage (mídia do chat)

Crie um bucket **público** chamado `midia-whatsapp` em **Storage > New
bucket**. É onde ficam as fotos, áudios, vídeos e documentos das conversas
(os recebidos, que o webhook baixa da Meta, e os enviados pelo chat) e os
anexos das mensagens padrão, na pasta `mensagens-padrao/`. Sem o bucket, a
mensagem chega mas sem o anexo.

## Contatos que chegam de fora: formulário e Lead Ads

### Formulário público (`/captura`)

Página sem login para o link do anúncio: nome e WhatsApp, e a pessoa vira
contato. O link é o endereço do sistema com os parâmetros da campanha:

```text
https://atendimento-sand.vercel.app/captura?campanha=Black%20Friday&etiqueta=Black%20Friday&utm_source=instagram&utm_medium=stories
```

| Parâmetro | Vira |
|---|---|
| `campanha` | a origem do contato (`leads.campanha`); sem ele, o `utm_campaign` |
| `etiqueta` | a etiqueta do contato, **só se ela já existir e estiver ativa** (crie em Administração › Etiquetas antes de soltar o anúncio; o link público não cria etiqueta) |
| `utm_source`, `utm_medium`, `utm_campaign`, `utm_content` | gravados no contato, como antes |

- O contato nasce sem etapa nem status, com o responsável do cliente (quando
  o telefone já é de um cliente com dono) ou da distribuição automática
  (quando ligada). Sem conversa, ele não entra na Caixa: aparece em Contatos
  e na etiqueta, para o disparo de template.
- Telefone que já é contato (com ou sem o nono dígito) não duplica e vê a
  mesma tela de sucesso.
- Defesas: campo invisível para robô (preenchido, nada é gravado), freio de
  5 envios em 15 minutos pelo mesmo IP ou telefone (tabela
  `captura_tentativas`, migração 0056; o bloqueio aparece no Log de acesso
  como "Captura bloqueada") e a gravação só no servidor, com
  `SUPABASE_SERVICE_ROLE_KEY`.
- O sucesso é a mesma página com `?ok=1` e os parâmetros da campanha: é o
  endereço para o pixel do anúncio contar a conversão. O link "Enviar outro
  número", em cima, volta ao formulário com os mesmos parâmetros.
- Cada envio de teste grava um contato de verdade no banco. Teste com um
  número da equipe e apague o contato depois.

### Lead Ads

O formulário do próprio anúncio (Facebook e Instagram) chega pelo webhook da
Meta e vira contato com a etiqueta do formulário. Precisa de:

| Variável | O que é |
|---|---|
| `META_PAGE_TOKEN` | Token da página com `leads_retrieval`. Sem ele, o evento fica em `webhook_events` com o motivo e o webhook segue funcionando. |

E do campo **`leadgen`** assinado no webhook (objeto Page) do app da Meta. O
passo a passo e as permissões estão em
[`META-WHATSAPP.md`](META-WHATSAPP.md#lead-ads-formulário-de-anúncio-do-facebook-e-do-instagram).

## Entrada: só e-mail e senha

A entrada é e-mail e senha, sem segundo passo (o código por e-mail em
aparelho novo existiu e foi tirado em 10/2026, por decisão do Lucas).
"Esqueci a senha", na tela de entrada, manda um código de 6 dígitos no
e-mail (vale 10 minutos) para criar uma senha nova. Esse e-mail sai pelo
[Resend](https://resend.com).

Errar o código 5 vezes em 15 minutos (por e-mail ou por IP) trava a
conferência até a janela passar. Pedir nova senha tem três tetos: 5 em 15
minutos por e-mail ou IP, 10 em 24 horas por e-mail e 30 por hora no sistema
inteiro. Tudo isso usa a tabela `login_tentativas` da migração 0046, sem
tabela nova. Tentativa barrada e senha redefinida aparecem no Log de acesso.

**Cota do Resend.** Cada código de nova senha é um e-mail. O plano gratuito
do Resend tem teto por dia e por mês (100 por dia e 3.000 por mês quando
este texto foi escrito). Se a cota acabar, ninguém recebe código até ela
renovar; a entrada com a senha não depende de e-mail. "Esqueci a senha" não
exige login, e é por isso que tem os tetos de 24 horas e de hora: sem eles,
qualquer pessoa com a lista de e-mails da equipe gastaria a cota do dia.

### Variáveis (Vercel > Settings > Environment Variables)

| Variável | O que é |
|---|---|
| `RESEND_API_KEY` | Chave do Resend, só com permissão de envio. Sem ela, "Esqueci a senha" não manda o código (e o aviso de senha trocada não sai). |
| `EMAIL_REMETENTE` | Remetente num domínio verificado, por exemplo `Zeve Atendimento <acesso@zeve.com.br>`. |

As chaves vão direto no painel da Vercel. Não passe por chat nem por e-mail.

### Resend

1. Crie a conta em [resend.com](https://resend.com).
2. **Domains > Add Domain**: `zeve.com.br` (ou um subdomínio só para envio,
   como `mail.zeve.com.br`; o remetente tem de usar o domínio cadastrado).
   Região: São Paulo.
3. O Resend mostra os registros de DNS: um MX e um TXT (SPF) no subdomínio
   `send`, e um TXT de DKIM em `resend._domainkey`. Cadastre os três onde o DNS
   do domínio é gerenciado (o do `zeve.com.br` fica na Cloudflare). Eles não
   mexem no e-mail do Microsoft 365, que usa a raiz do domínio. **Não crie
   outro registro de DMARC:** o `zeve.com.br` já tem um (`p=quarantine`), e
   dois registros em `_dmarc` invalidam a política. Com o DKIM do Resend
   verificado, o e-mail passa nesse DMARC.
4. Espere o domínio ficar **Verified** no Resend (minutos, às vezes algumas
   horas, conforme o DNS).
5. **API Keys > Create API Key**: permissão **Sending access**, restrita ao
   domínio. Copie para `RESEND_API_KEY` na Vercel.
6. Preencha `EMAIL_REMETENTE` com um endereço desse domínio e faça o redeploy.

### Supabase

- **Authentication > Sign In / Providers > Email**: deixe **Email OTP
  Expiration** em `600` segundos. O e-mail de nova senha promete 10 minutos, e
  o sistema já recusa código mais velho que isso; com o painel em 600, o
  próprio Supabase também recusa. **Email OTP Length** pode ficar em 6 (a tela
  aceita de 6 a 10 dígitos).
- Os modelos de e-mail do Supabase não são usados: o código de nova senha é
  gerado pelo `generateLink` do admin e enviado pelo Resend.
- **Antes do primeiro deploy desta versão**, desligue o segundo fator que a
  migração 0067 pôs no banco. Sem isso, as policies `exige_segundo_fator`
  barram toda sessão sem o app autenticador e o sistema abre vazio:

  ```sql
  update settings set valor = '"0"' where chave = 'exigir_2fa';
  ```

- Os fatores do app autenticador que a equipe cadastrou continuam no Auth e
  não atrapalham a entrada. É por causa deles que a senha nova é gravada pela
  chave de serviço: o Supabase recusa troca de senha de quem tem fator
  cadastrado e entrou sem ele.

### Na máquina de desenvolvimento

Sem `RESEND_API_KEY`, o e-mail não sai e o código aparece no terminal do
`npm run dev`, numa linha que começa com `[email]`.

`SUPABASE_SERVICE_ROLE_KEY` também é obrigatória. Sem ela a tela de entrada
quebra ao clicar em Entrar: o freio da senha lê `login_tentativas` pela chave
de serviço antes de conferir a senha. Com um valor que não é a chave de verdade
(um marcador qualquer), a senha e o código funcionam, mas nada grava: os freios
não contam (a conferência do código segue sem freio, com o aviso
`[freio] código sem freio` no terminal), o Log de acesso não recebe linha
nenhuma e "Esqueci a senha" não gera código.

Para testar os freios na máquina local (errar o código 5 vezes e ver "Muitas
tentativas" na tela e "palpites de código bloqueados" no Log de acesso), o
`.env.local` precisa da chave de serviço válida do projeto. Atenção: se o
`.env.local` aponta para o banco de produção, o teste grava em
`login_tentativas` e na `auditoria` de produção, e "Esqueci a senha" troca a
senha real da conta e derruba as outras sessões dela. Use uma conta
descartável.

**Banco de produção ainda com `exigir_2fa` = "1":** a entrada por senha deixa
a sessão sem o app autenticador, e as telas abrem vazias (local e na Vercel).
Enquanto for assim, abra `/autenticador-local` (sem link no app) e digite o
código do app autenticador: a sessão sobe para o nível que o banco pede. A
página existe no `npm run dev`; no `npm run build` + `npm run start` local, só
com `AUTENTICADOR_LOCAL="1"` no `.env.local`. Na Vercel essa variável nunca
existe, e lá a página responde 404. Ela pode sair do código quando o
`exigir_2fa` for desligado.
