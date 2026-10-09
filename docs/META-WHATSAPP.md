# Conexão direta do WhatsApp (Meta Cloud API)

> **Atualização (29/08/2026, Fase 8):** o código legado do Chatwoot foi
> REMOVIDO (webhook, cliente de API, fallback de canal). O canal é
> exclusivamente a Meta Cloud API — sem `META_WHATSAPP_TOKEN` o envio falha
> com aviso claro, não há rollback para o Chatwoot. As colunas
> `leads.chatwoot_*` e o histórico de conversas foram preservados no banco.
> O passo D abaixo vale só como registro histórico da migração.


Migração do número oficial do Chatwoot (zeveai.duqui.ai) para a conexão
direta com a Meta. Este guia usa os valores reais do projeto.

## Identificadores do projeto

| Item | Valor |
| --- | --- |
| App na Meta | `atendimento_zeve` — id `927774607050534` |
| Portfólio (business) | ZEVE AI LTDA — `2197613680684650` |
| WABA | "Zeve AI" — `704496635823197` |
| Número | +55 62 9994-4855 — `phone_number_id 948515215012009` |
| Webhook | `https://atendimento-sand.vercel.app/api/webhooks/meta` |

## Como funciona

- **Envio** — `META_WHATSAPP_TOKEN` no ambiente. Com ele, todo envio (texto,
  template, mídia) sai pela Cloud API (`src/lib/whatsapp.ts`); sem ele, o
  envio falha com aviso na tela. O `phone_number_id` vem de
  `META_PHONE_NUMBER_ID` ou, na falta, da primeira instância ativa cadastrada
  em Configurações.
- **Recebimento** — o webhook `/api/webhooks/meta` valida a assinatura
  (`META_APP_SECRET`; **em produção, sem essa env todos os eventos são
  recusados**), deduplica, baixa mídia para o bucket `midia-whatsapp` e cria
  contato + mensagem. Responsável: o da instância ou, sem ele, a distribuição
  automática (ligada em Configurações; entra quem está marcado "no rodízio"
  no Admin). Números BR sem o nono dígito são reconciliados com o contato
  existente. Contatos que chegarem antes de a instância ter `phone_number_id`
  são readotados quando ele for salvo.
- **Mensagem que falhou ao gravar** — fica em `webhook_events` com o erro e
  entra de novo na próxima passada de reprocessamento (até 5 tentativas,
  espalhadas por umas duas horas e meia; depois fica lá para investigar).
  Vale para o WhatsApp e para o Direct.
- **Recibos** — `sent/delivered/read/failed` viram os ✓✓ do chat; falha (ex.:
  janela de 24h, que a Meta aceita com 200 e recusa depois) marca a mensagem
  com o motivo traduzido.

## Lead Ads (formulário de anúncio do Facebook e do Instagram)

Quem preenche o formulário de um anúncio vira contato na hora, pelo mesmo
webhook (`/api/webhooks/meta`, campo `leadgen`; código em
`src/app/api/webhooks/lead-ads.ts`).

- **Leitura:** a Meta manda só os ids (`leadgen_id`, `form_id`, `ad_id`). As
  respostas vêm de uma leitura na Graph API com `META_PAGE_TOKEN` (sem ele, o
  `META_WHATSAPP_TOKEN`, que só serve se o usuário do sistema tiver a página e
  a permissão). O nome do formulário e o da campanha saem de duas leituras à
  parte; sem permissão para elas, o contato entra do mesmo jeito.
- **Contato:** nome, WhatsApp e e-mail do formulário; origem "Anúncio da
  Meta" na ficha. Telefone que já é contato não duplica (as duas grafias do
  nono dígito): ganha só a etiqueta e a nota. Responsável: a distribuição
  automática, quando ligada. Sem etapa nem status de funil.
- **Etiqueta:** o nome do formulário; sem ele, o da campanha; sem os dois,
  "Lead Ads" e o id do formulário. Criada se não existir (cor Grafite, como a
  da importação; aparece no Log como criada pelo "Sistema") e reativada se
  estava arquivada. É o público para o disparo: em Disparos, escolha a
  etiqueta. O mesmo nome fica em `leads.campanha`; os ids do formulário e do
  anúncio, em `utm_campaign` e `utm_content`.
- **Respostas:** as perguntas que não viraram nome, telefone ou e-mail entram
  numa nota do sistema na conversa ("Lead Ads (formulário): pergunta:
  resposta; …").
- **Onde aparece:** em Contatos (filtro pela etiqueta). O contato nasce sem
  conversa e por isso não entra na Caixa, que só lista quem trocou mensagem;
  a equipe fala com ele pelo disparo de template.
- **Falha:** sem token, sem permissão ou erro do banco ficam em
  `webhook_events` (`evento_id` = `leadgen-<id>`) com o motivo em `erro`, e o
  webhook responde 200 do mesmo jeito. O evento volta pela passada de
  reprocessamento, como a mensagem (até 5 tentativas em umas duas horas e
  meia): pôr o token nesse intervalo recupera o contato. Depois disso ele
  continua no Gerenciador de Anúncios, para baixar à mão. Formulário sem
  telefone, ou com telefone fora do formato, não volta (as respostas seriam
  as mesmas): a linha fecha na primeira tentativa com `processado` marcado e
  o motivo em `erro`.

### Ligar o Lead Ads

1. **Token da página:** token do System User com a página como ativo e as
   permissões `leads_retrieval` (ler as respostas), `pages_manage_ads` (nome
   do formulário), `pages_show_list`, `pages_read_engagement` e
   `pages_manage_metadata` (assinar o webhook). `ads_read` é opcional: só traz
   o nome da campanha. Vai em `META_PAGE_TOKEN` na Vercel, direto no painel.
2. **Webhook da página:** no app `atendimento_zeve`, Webhooks › objeto
   **Page**: a mesma URL e o mesmo verify token do WhatsApp, com o campo
   **`leadgen`** assinado.
3. **App instalado na página:** `POST /{page-id}/subscribed_apps` com
   `subscribed_fields=leadgen` e o token da página.
4. **Acesso aos leads:** se a página usa o Gerenciador de Acesso a Leads
   (Configurações do negócio › Integrações › Acesso a leads), dê acesso ao
   app ou ao System User. Sem isso a leitura volta sem permissão.
5. **Teste:** a Ferramenta de Teste de Anúncios de Cadastro da Meta
   (`developers.facebook.com/tools/lead-ads-testing`) manda um lead de teste.
   O contato aparece em Contatos com a etiqueta do formulário; se não
   aparecer, o motivo está em `webhook_events.erro`. O teste grava um contato
   de verdade no banco: apague depois.

## Respostas automáticas (fora do horário e boas-vindas)

Como no WhatsApp Business, em Configurações → Atendimento. Nascem desligadas;
o texto é editável e `{horario}` vira o horário por extenso ("de segunda a
sexta, das 9h às 18h"). Chaves em `settings`: `horario_atendimento`
(`{ dias, inicio, fim }`, 0 = domingo, hora de Brasília),
`resposta_fora_do_horario` e `resposta_boas_vindas` (`{ ativo, texto }`).

- **Fora do horário:** mensagem do contato (WhatsApp ou Direct) que chega
  fora do horário recebe a resposta. O fim não entra: com 18:00, quem
  escreve às 18h já está fora.
- **Boas-vindas:** só para o contato que o webhook acabou de criar, dentro do
  horário. Fora dele vale só a de fora do horário, nunca as duas.
- **Uma a cada 12h:** no máximo uma resposta automática por contato a cada
  12h, de qualquer tipo. Quem recebeu as boas-vindas às 17h59 não recebe a de
  fora do horário às 18h01.
- **Não respondem:** recibo, reação, aviso do sistema, o eco do que nós
  mandamos e a nova tentativa do reprocessamento (a mensagem é antiga).
- **Envio:** depois do 200 para a Meta (`after()`), por `src/lib/whatsapp.ts`
  e `src/lib/instagram.ts`, no canal em que a pessoa escreveu. No WhatsApp sai
  pelo número padrão; mensagem que chegou a outro `phone_number_id` não é
  respondida. Mudança em Configurações leva até 1 minuto para valer.
- **Registro:** nota em `lead_interactions`, autor nulo, `metadados
  { automatica, via, sistema, canal, message_id, status_envio, erro_envio }`.
  Nota, e não `mensagem_enviada`, para a conversa continuar esperando um
  atendente (a Caixa e o relatório leem mensagem enviada como resposta da
  equipe). No chat é bolha nossa com "Automático · fora do horário" ou
  "Automático · boas-vindas" e os ✓ do recibo do WhatsApp (o Direct não tem
  recibo nesta integração). Falha grava `status_envio: "failed"` com o
  motivo, e a bolha diz "Não entregue". Sem resposta da Meta no prazo não é
  falha, porque o envio pode ter chegado: o status fica nulo, `erro_envio`
  guarda "Envio sem confirmação da Meta" e a bolha mostra só esse texto. As
  duas vão para o log (`[resposta automática]`) e contam para as 12h.

## Variáveis de ambiente (produção)

| Variável | Valor / origem |
| --- | --- |
| `META_APP_SECRET` | App Settings → Basic do `atendimento_zeve` |
| `META_WHATSAPP_TOKEN` | token permanente do System User `admin` (nunca expira) |
| `META_WEBHOOK_VERIFY_TOKEN` | frase do `.env.local` (igual no painel do webhook) |
| `META_PHONE_NUMBER_ID` | `948515215012009` |
| `META_WABA_ID` | `704496635823197` (necessário para templates) |
| `META_PAGE_TOKEN` | token da página para o Lead Ads (permissões na seção "Ligar o Lead Ads") |
| `CRON_SECRET` | frase aleatória — protege `/api/cron/campanhas` (opcional) |

## Passo a passo da virada

**A. Código + envs no ar** — deploy com as envs acima em produção.

**B. Instância cadastrada** — Configurações → Instâncias: "Zeve AI" com o
`phone_number_id` (define o responsável pelos contatos novos; sem
responsável, vale a distribuição automática).

**C. App em modo Ao vivo** — painel do app → chave "Ao vivo" no topo. Em modo
desenvolvimento a Meta não entrega eventos de clientes reais.

**D. Virada do webhook (momento da migração)** — hoje quem recebe é o app
"Zeve AI" (`776760084696764`), inscrito no WABA com redirecionamento para
`zeveai.duqui.ai`. A virada é:
1. Configurar o webhook do `atendimento_zeve` (URL + verify token + campo
   `messages`) — feito via `POST /{app-id}/subscriptions`.
2. Inscrever o `atendimento_zeve` no WABA — `POST /{waba-id}/subscribed_apps`.
3. **Remover a inscrição dos apps "Zeve AI" e "ZEVE"** no WABA — a partir daqui
   o Chatwoot para de receber e o Zeve Atendimento assume.

**E. Teste** — mandar mensagem de um celular → conversa no Chat com
responsável; responder pelo chat → chega no celular com ✓✓; sem marca de
falha.

## Problemas comuns

| Sintoma | Causa provável |
| --- | --- |
| Webhook não verifica ("Forbidden") | `META_WEBHOOK_VERIFY_TOKEN` divergente ou deploy sem a env |
| Mensagem não aparece no chat | campo `messages` não assinado, app errado inscrito no WABA, app em modo desenvolvimento, ou `META_APP_SECRET` ausente em produção (recusa tudo) |
| Mensagem com "Janela de 24h fechada" | recibo `failed` 131047 — fora da janela só template aprovado (use o seletor de templates do chat) |
| "Token da Meta inválido ou expirado" | token de teste no lugar do permanente de System User |
| "Número fora da lista de destinatários de teste" | app em modo desenvolvimento |
| Mídia recebida sem anexo | bucket `midia-whatsapp` não criado no Supabase Storage (público) |
| Contato do Instagram sem foto, só iniciais | a foto é copiada para `midia-whatsapp/avatares/` quando a pessoa escreve; contato antigo ganha a foto na próxima mensagem. No WhatsApp é sempre iniciais: a Cloud API não entrega a foto do cliente |
| Anexo do Direct quebrado | a cópia para `midia-whatsapp/instagram/` falhou (ver log da função) |
| Conversa sem responsável | instância sem responsável e distribuição automática desligada (ou ninguém marcado para receber); confira Configurações e Admin |
| Lead do anúncio não aparece em Contatos, sem nada em `webhook_events` | campo `leadgen` não assinado no objeto Page, ou o app não está instalado na página (`subscribed_apps`) |
| `webhook_events.erro` com "Sem META_PAGE_TOKEN" | a variável não está na Vercel (ou o deploy é anterior a ela). Com "o token do WhatsApp não leu o formulário", a leitura foi tentada com o `META_WHATSAPP_TOKEN` no lugar e falhou pelo motivo que vem depois |
| `webhook_events.erro` com "A Meta recusou a leitura" | token sem `leads_retrieval`, ou o app fora do Gerenciador de Acesso a Leads da página |
| `webhook_events.erro` com "Formulário sem telefone" ou "fora do formato" | o formulário do anúncio não pede telefone, ou a pessoa digitou um número que não serve; o contato está só no Gerenciador de Anúncios |
| Etiqueta do Lead Ads com nome "Lead Ads" e um número | o token não lê o nome do formulário (`pages_manage_ads`) nem o da campanha (`ads_read`) |
