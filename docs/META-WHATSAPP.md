# Conexão direta do WhatsApp (Meta Cloud API)

> **Atualização (29/08/2026, Fase 8):** o código legado do Chatwoot foi
> REMOVIDO do CRM (webhook, cliente de API, fallback de canal). O canal é
> exclusivamente a Meta Cloud API — sem `META_WHATSAPP_TOKEN` o envio falha
> com aviso claro, não há mais rollback para o Chatwoot. As colunas
> `leads.chatwoot_*` e o histórico de conversas foram preservados no banco.
> Os passos abaixo que citam Chatwoot valem só como registro histórico.


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

- **Interruptor do envio** — `META_WHATSAPP_TOKEN` no ambiente. Com ele, todo
  envio (texto, template, mídia) sai pela Cloud API (`src/lib/canal.ts` decide);
  sem ele, tudo volta ao Chatwoot. O `phone_number_id` vem de
  `META_PHONE_NUMBER_ID` ou, na falta, da primeira instância ativa cadastrada
  em Configurações.
- **Recebimento** — o webhook `/api/webhooks/meta` valida a assinatura
  (`META_APP_SECRET`; **em produção, sem essa env todos os eventos são
  recusados**), deduplica, baixa mídia para o bucket `midia-whatsapp` e cria
  lead + interação. Vendedor: o da instância ou round-robin. Números BR sem o
  nono dígito são reconciliados com o lead existente. Leads que chegarem antes
  de a instância ter `phone_number_id` são readotados quando ele for salvo.
- **Recibos** — `sent/delivered/read/failed` viram os ✓✓ do chat; falha (ex.:
  janela de 24h, que a Meta aceita com 200 e recusa depois) marca a mensagem
  com o motivo traduzido.
- **Transição sem perda** — o webhook do Chatwoot continua ingerindo mensagens
  recebidas mesmo com o canal Meta ativo. Ou seja: com o token no ar o envio
  já sai pela Meta, e o recebimento segue via Chatwoot até a virada do webhook
  (passo D) — sem janela de perda.

## Variáveis de ambiente (produção)

| Variável | Valor / origem |
| --- | --- |
| `META_APP_SECRET` | App Settings → Basic do `atendimento_zeve` |
| `META_WHATSAPP_TOKEN` | token permanente do System User `admin` (nunca expira) |
| `META_WEBHOOK_VERIFY_TOKEN` | frase do `.env.local` (igual no painel do webhook) |
| `META_PHONE_NUMBER_ID` | `948515215012009` |
| `META_WABA_ID` | `704496635823197` (necessário para templates) |
| `CRON_SECRET` | frase aleatória — protege `/api/cron/cadencia` |

## Passo a passo da virada

**A. Código + envs no ar** — deploy com as envs acima em produção.

**B. Instância cadastrada** — Configurações → Instâncias: "Zeve AI" com o
`phone_number_id` (define o vendedor dos leads novos; sem vendedor, round-robin).

**C. App em modo Ao vivo** — painel do app → chave "Ao vivo" no topo. Em modo
desenvolvimento a Meta não entrega eventos de clientes reais.

**D. Virada do webhook (momento da migração)** — hoje quem recebe é o app
"Zeve AI" (`776760084696764`), inscrito no WABA com redirecionamento para
`zeveai.duqui.ai`. A virada é:
1. Configurar o webhook do `atendimento_zeve` (URL + verify token + campo
   `messages`) — feito via `POST /{app-id}/subscriptions`.
2. Inscrever o `atendimento_zeve` no WABA — `POST /{waba-id}/subscribed_apps`.
3. **Remover a inscrição dos apps "Zeve AI" e "ZEVE"** no WABA — a partir daqui
   o Chatwoot para de receber e o CRM assume.

**E. Teste** — mandar mensagem de um celular → lead no Chat com vendedor;
responder pelo CRM → chega no celular com ✓✓; sem marca de falha.

## Rollback

Reinscrever o app "Zeve AI" no WABA (o override para o duqui.ai é preservado
na inscrição) e remover o `atendimento_zeve`. Para o envio voltar ao Chatwoot,
remova `META_WHATSAPP_TOKEN` do ambiente e redeploy.

**Exceção:** leads criados no período Meta não têm conversa no Chatwoot — o
envio para eles só volta quando mandarem nova mensagem (que recria a conversa
via webhook do Chatwoot).

## Problemas comuns

| Sintoma | Causa provável |
| --- | --- |
| Webhook não verifica ("Forbidden") | `META_WEBHOOK_VERIFY_TOKEN` divergente ou deploy sem a env |
| Mensagem não vira lead | campo `messages` não assinado, app errado inscrito no WABA, app em modo desenvolvimento, ou `META_APP_SECRET` ausente em produção (recusa tudo) |
| Mensagem com "Janela de 24h fechada" | recibo `failed` 131047 — fora da janela só template aprovado (use o seletor de templates do chat) |
| "Token da Meta inválido ou expirado" | token de teste no lugar do permanente de System User |
| "Número fora da lista de destinatários de teste" | app em modo desenvolvimento |
| Mídia recebida sem anexo | bucket `midia-whatsapp` não criado no Supabase Storage (público) |
| Lead sem vendedor | instância sem vendedor → round-robin; confira Configurações |
