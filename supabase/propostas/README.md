# Propostas de banco — nada aqui foi aplicado

Esta pasta guarda SQL que **ainda não rodou em produção**. Fica fora de
`supabase/migrations/` de propósito: lá vale a regra de colar tudo em ordem
alfabética, e uma proposta não pode entrar nessa fila sem alguém decidir.
Quem decide e aplica é o Lucas.

## 0070_so_chat.sql — o banco acompanhando o chat

**Em uma frase:** o código só-chat já funciona com o banco de hoje; esta
proposta tira do banco o peso do CRM que continua rodando escondido a cada
mensagem, fecha algumas portas de segurança e faz uma tabela parar de
crescer. Não apaga tabela, coluna nem função — tudo tem desfazer.

O arquivo é dividido em seções. Cada uma diz no título se é
**[importante]** (ganho claro, aplicar) ou **[opcional]** (depende de uma
decisão ou de outra mudança), e termina com o bloco "Desfazer".

### Antes de começar

1. O código só-chat está no ar e foi usado de verdade: receber e mandar
   mensagem pelo WhatsApp e pelo Instagram, template, anexo, áudio, os
   tiques de entregue/lido, atribuir e transferir conversa, resolver,
   reabrir, adiar, disparo em massa e o relatório de atendimento.
2. Nenhum código no ar ainda depende do que os gatilhos gravam. Na raiz do
   repositório (funciona no PowerShell e no Git Bash):

   ```
   git grep -n -E "stage_id|primeiro_contato_em|cliente_confirmado_em|mudanca_etapa|quadro_equipe|ativacoes_registradas" -- src
   git grep -n -E "status: .perdido" -- src
   ```

   O primeiro tem de voltar vazio antes das seções 1 e 5; o segundo (alguém
   ainda MARCANDO perdido) tem de voltar vazio antes da seção 3.
3. Há backup recente do banco (painel do Supabase → Database → Backups).
   As seções 3 e 6 mexem em dados.

### Como aplicar

Uma seção por vez no SQL Editor, **cada uma num "Run" separado**. O SQL
Editor roda o que foi colado como um bloco só e segura os bloqueios de
tabela até o fim do bloco; juntar seções soma esses bloqueios.

| Passo | O quê | Quando |
|---|---|---|
| 1 | Deploy do código só-chat e a conferência acima | antes de tudo |
| 2 | Seção **1** | fora do expediente, de preferência: dura milissegundos, mas pede acesso exclusivo a `leads` e `lead_interactions` por um instante |
| 3 | Seção **2**, num Run à parte | **fora do expediente**: enquanto o índice é construído, mensagem nova espera para ser gravada |
| 4 | Conferir (consultas abaixo) e usar o chat um dia | — |
| 5 | Seções **3**, **4** e **5**, uma por vez, em qualquer ordem | dias depois |
| 6 | Seção **6** | quando quiser; a **6b** só se o pg_cron estiver ligado |
| 7 | Seção **1c** | só depois de decidir o "ramo de carteira" (fim deste texto) |

Depois da seção 3 o código pode trocar a Caixa de `v_leads_listas` para
`v_caixa_conversas` (mesmos nomes de coluna, menos `status`, que a view nova
não tem) e largar a leitura de status: `status` sai do `CAMPOS_VIEW` e o
"resolvida" de `carregarListaConversas` lê só `chat_resolvido_em`. Esquecer
o primeiro deixa a Caixa vazia (o PostgREST recusa a coluna que não existe).

**Registrar o que rodou:** copie exatamente o que foi aplicado para
`supabase/migrations/` com o próximo número livre (um arquivo por dia de
aplicação: 0070, 0071…) e atualize a regra 5 do README de migrations — a
fila de gatilhos de `leads` passa a ser só t01 e t08.

### O que cada parte ganha e o risco

**1 — Gatilhos de CRM no caminho de cada mensagem** [importante]
- *Ganha:* cada mensagem recebida deixa de fazer duas consultas às etapas do
  funil e uma atualização de lead. Cada atualização de lead (envio, leitura,
  atribuição, mensagem recebida) passa por 2 gatilhos em vez de 5. Contato
  novo deixa de procurar o cliente na base da corretora. O Realtime para de
  carregar as linhas de "mudança de etapa", que segundo o comentário do
  código eram 64% das inserções na tabela de mensagens.
- *Risco:* tela que ainda lesse etapa, status de funil ou "primeiro contato"
  ficaria parada — por isso o `git grep` acima. O assessor deixa de ver
  contato NOVO de cliente da carteira dele quando a conversa é de outra
  pessoa (sem o vínculo automático, o contato novo não ganha cliente).
- *Desfazer:* recriar os gatilhos; o texto está no arquivo.

**1c — Gatilhos da carteira** [opcional]
- *Ganha:* nada em velocidade. Nenhuma escrita do chat encosta mais na tabela
  de clientes.
- *Risco:* o "dono da carteira" para de acompanhar quem atende. Um assessor
  que transfere a conversa de um cliente da carteira dele continua vendo a
  conversa. Só afeta assessor e só contato ligado a cliente.

**2 — Índices do chat** [importante]
- *Ganha:* cada recibo de entregue/lido (até três por mensagem enviada)
  deixa de ler a tabela inteira de mensagens para achar a dele. A Caixa e a
  prévia das conversas leem uma entrada por conversa, em vez de pular notas,
  atribuições e mudanças de etapa até achar a última mensagem.
- *Risco:* enquanto o índice é construído, gravar mensagem espera (segundos
  com a tabela de hoje — não medi). Daí o fora do expediente.
- *Desfazer:* `drop index`, no arquivo.

**3 — Perdido vira resolvido nos dados + view enxuta da Caixa** [opcional]
- *Ganha:* a regra "perdido conta como resolvida" passa a morar num lugar
  só. A view nova `v_caixa_conversas` dá à Caixa as mesmas colunas sem quatro
  junções de CRM, sem a busca do último disparo em massa e com os campos que
  hoje exigem uma segunda consulta.
- *Risco:* baixo. O acerto só preenche "resolvida em" onde está vazio; a view
  não é usada até o código trocar de fonte.
- *Desfazer:* no arquivo (os leads acertados ficam com a data de resolvida
  igual à data da perda, e é por ela que o desfazer os acha).

**4 — Permissão das mensagens sem função por linha** [importante]
- *Ganha:* para atendente e assessor, cada linha lida de mensagens,
  etiquetas e agendadas chamava uma função que faz até quatro leituras;
  passa a ser uma busca direta na tabela de leads. Gestor, admin e
  compliance já não pagavam esse custo.
- *Risco:* é permissão. A regra é a mesma por construção (a função antiga e
  a consulta nova perguntam a mesma coisa à mesma regra de leads), mas
  **confira com o teste abaixo, antes e depois**.
- *Desfazer:* o laço da 0068, no arquivo.

**5 — Funções de CRM abertas a quem está logado** [importante]
- *Ganha:* seis funções que rodam com poder de dono do banco deixam de ser
  chamáveis por qualquer usuário logado. A pior é `mesclar_leads`, que apaga
  um contato.
- *Risco:* tela antiga que ainda as chame com a sessão do usuário quebra (a
  /hoje chamava duas). Por isso só depois do deploy.
- **5b** [opcional]: a prévia da última mensagem passa a respeitar quem pode
  ver o quê (hoje um atendente consegue a prévia de conversa alheia mandando
  o id) e lê uma entrada por conversa. Aplicar depois da 2.

**6 — Expurgo de `webhook_events`** [importante]
- *Ganha:* a tabela de eventos brutos da Meta para de crescer sem limite
  (hoje guarda tudo desde o expurgo único da 0040).
- *Risco:* apaga o payload bruto de evento já processado com mais de 30
  dias. A mensagem em si continua em `lead_interactions`. Não tem volta
  (só backup).
- **6b** [opcional]: a mesma limpeza todo dia às 03h30 de Brasília, se a
  extensão pg_cron estiver ligada. Sem ela o bloco só avisa.

### Como conferir

Gatilhos que sobraram:

```sql
select tgrelid::regclass as tabela, tgname as gatilho
from pg_trigger
where not tgisinternal
  and tgrelid in ('leads'::regclass, 'lead_interactions'::regclass,
                  'customers'::regclass, 'customer_lots'::regclass)
order by 1, 2;
```

Depois da seção 1: `lead_interactions` sem nenhum; em `leads`,
`leads_t01_carimbar_perda`, `leads_t08_atualizado_em` e
`leads_sincroniza_dono_carteira` (este some com a 1c, junto com
`customers_vincular_leads` e `customer_lots_saem_do_funil`).

Índices novos válidos e em uso:

```sql
select indexrelid::regclass as indice, indisvalid as valido
from pg_index
where indrelid = 'lead_interactions'::regclass;

explain select id from lead_interactions
where metadados ->> 'message_id' = 'wamid.teste';
-- esperado: Index Scan using lead_interactions_message_id_idx
```

Permissão igual antes e depois da seção 4 — rode **antes** e **depois**,
com o id de um atendente e depois de um assessor; os três números têm de
bater:

```sql
set local role authenticated;
select set_config('request.jwt.claims',
  '{"sub": "COLE-AQUI-O-ID-DO-PERFIL", "role": "authenticated", "aal": "aal2"}',
  true);
select current_user as rodando_como,
       (select count(*) from lead_interactions)  as mensagens,
       (select count(*) from lead_tags)          as etiquetas,
       (select count(*) from scheduled_messages) as agendadas;
```

`rodando_como` tem de sair `authenticated`; se sair `postgres`, o teste não
valeu (o SQL Editor também tem um seletor de papel para se passar por um
usuário). A contagem de antes pode demorar alguns segundos — é o custo que a
seção 4 tira.

### O que ficou de fora de propósito

- **Apagar as tabelas de CRM** (vendas, clientes, lotes, funil, cadência…).
  Antes disso é preciso: decidir o ramo de carteira, recriar `mesclar_leads`
  só com as tabelas do chat (se a fusão de contatos ficar), recriar
  `proteger_perfil_sensivel` sem as colunas de meta, aposentar a
  `v_leads_listas` e tirar as chaves estrangeiras de `leads`.
- **O ramo de carteira na permissão de leads.** Hoje o assessor vê, além das
  conversas dele e das sem dono, as de clientes da carteira dele. Tirar isso
  muda quem vê o quê — é decisão, não ajuste de velocidade.
- **`leads_edita` continua com `vejo_lead`.** Na conferência de uma
  atualização ela olha o lead como estava antes; uma regra escrita direto na
  policy olharia o lead já alterado e barraria, por exemplo, o atendente
  passando a conversa para um colega.
- **Índices de CRM em `leads`** (`leads_stage_idx`, `leads_status_idx`,
  `leads_channel_idx`, `leads_documento_idx`, `leads_chatwoot_contact_idx`,
  `leads_sem_primeiro_contato_idx`) e `lead_interactions_template_idx`. Toda
  mensagem atualiza `ultima_interacao_em`, que é indexada, então o Postgres
  grava uma entrada nova em TODOS os índices de `leads` a cada mensagem.
  Tirar os mortos alivia essa escrita; fica para quando o código antigo
  tiver saído de vez e um `git grep` confirmar que nenhuma consulta os usa.
  `leads_customer_idx` só depois da 1c (o gatilho da carteira consulta por
  ele).
- **Índice para os recibos de envio com vários anexos** (seção 2c, em
  comentário): só serve junto com uma mudança na consulta do webhook.

## 0071_privacidade.sql: privacidade entre pessoas da equipe

**Em uma frase:** a regra que o admin define em Administração ("o grupo
Aikon não vê as conversas de Artur e Lucas") passa a valer no banco, e não
só nas telas; sem isso, quem tem regra ainda lê as conversas ocultas pela
API e recebe as mensagens delas pelo tempo real. Não cria tabela nem coluna:
uma função, policies restritivas em `leads` e nas tabelas filhas e a policy
de `settings` dividida. `vejo_lead` não muda. Tudo tem desfazer.

Como funciona, o que esconde e o roteiro de teste: `docs/PRIVACIDADE.md`.

### Antes de começar

1. O código com a tela de privacidade está no ar (Administração mostra
   "Regras de privacidade" e "Grupos de privacidade" para o admin).
2. Seção 4 da 0070 aplicada ou não, a regra vale igual: as restritivas daqui
   ficam ao lado das permissivas, sem reescrevê-las. O custo que a 4 da 0070
   tira (`vejo_lead` por linha nas filhas, para atendente e assessor) existe
   hoje, com ou sem a 0071; a 0071 não soma nada a ele.
3. Se a 5b da 0070 ainda não rodou, rode junto: sem ela, `previas_conversas`
   devolve a última mensagem de qualquer lead pelo id, por fora de qualquer
   regra.

### Como aplicar

Uma seção por vez no SQL Editor, cada uma num "Run" separado, **na ordem**
(2 e 3 usam a função da 1):

| Passo | O quê | Quando |
|---|---|---|
| 1 | Seção **1** (a função) | quando quiser: não muda nada sozinha |
| 2 | Seção **4** (settings) | junto com a 1: fecha a chave para o admin antes de a regra valer no banco |
| 3 | Conferir (abaixo) com uma pessoa com regra e uma sem | anote os números de antes |
| 4 | Seções **2** e **3** | fora do expediente, de preferência: pedem lock rápido em `leads` e nas filhas |
| 5 | Conferir de novo, com as mesmas pessoas | logo depois |

**Registrar o que rodou:** como na 0070, copie o que foi aplicado para
`supabase/migrations/` com o próximo número livre.

### O que cada parte ganha e o risco

**1. `privacidade_ocultos()`**
- *Ganha:* a regra num lugar só do banco, lida de `settings` com o mesmo
  formato que a tela grava. Vazia para admin e para quem não tem regra.
- *Risco:* nenhum sozinha. O JSON é lido com tolerância (item quebrado é
  ignorado, id que não é uuid não é convertido), porque um erro aqui
  derrubaria toda leitura de `leads` depois da seção 2.

**2. `leads`: restritivas de leitura e de edição**
- *Ganha:* Caixa, Contatos, busca, `v_leads_listas` e o tempo real de
  `leads` deixam de devolver o lead do dono oculto, para qualquer papel
  menos admin. Quem tem regra também não altera esse lead (nem para se pôr
  como responsável), com filtro no comando ou sem.
- *Custo:* a lista de ocultos sai uma vez por consulta; por linha, só a
  comparação do responsável com ela.
- *Risco:* o Postgres confere a linha nova de um UPDATE contra as policies de
  leitura. Quem tem regra e passa uma conversa para alguém oculto dele pode
  levar "new row violates row-level security policy". **Teste antes**
  (roteiro no doc); se acontecer, a transferência para quem está oculto pede
  uma função própria.

**3. Filhas do lead: restritiva**
- *Ganha:* ninguém com regra lê, grava ou recebe pelo tempo real mensagens,
  notas, etiquetas e agendadas do dono oculto. Vale para gestor e
  compliance, que hoje passam direto pelo `ve_tudo()`, e para atendente e
  assessor, cuja permissiva (`vejo_lead`) não sabe da privacidade.
- *Custo:* para quem tem regra, uma busca de `leads` pela chave por linha,
  que passa pelo RLS de `leads` de quem lê (para o assessor,
  `leads_por_papel` pode chamar `minha_carteira`): o mesmo da seção 4 da
  0070. Para quem não tem, nada por linha: o primeiro termo vira `true` para
  a consulta inteira e a busca nem roda.
- *Custo para todo mundo, com regra ou sem:* `privacidade_ocultos()` roda
  uma vez por consulta (uma leitura de `profiles` e uma de `settings`). No
  tempo real, cada evento de mensagem é conferido numa consulta por pessoa
  conectada, então é essa leitura por evento e por pessoa. Nenhuma policy da
  0071 chama função por linha.

**Por que `vejo_lead` não muda.** Ela roda uma vez por linha nas permissivas
das filhas. Com a privacidade dentro dela, o assessor leria `settings` em
cada mensagem de cliente da carteira dele que tem outro responsável, com
regra ou sem, e no tempo real a cada evento: a função por linha que a 0068
tirou e que derrubou o app. As seções 2 e 3 cobrem o que ela cobriria.

**4. `settings`: a chave `privacidade` só para o admin**
- *Ganha:* hoje a gestão grava qualquer chave, e um gestor com regra pode
  apagar a própria regra pela API. Depois, só o admin grava esta chave.
- *Risco:* nenhum para a tela: a action já barra quem não é admin.

### Como conferir

Com o mesmo teste da 0070 (o `set_config` com o id do perfil), **antes** das
seções 2 e 3 (com a 1 já rodada, porque a consulta usa a função) e
**depois** delas, para uma pessoa com regra (um gestor, de preferência) e uma
sem. A segunda contagem pede o id de uma conversa de alguém que está oculto
para essa pessoa:

```sql
set local role authenticated;
select set_config('request.jwt.claims',
  '{"sub": "COLE-AQUI-O-ID-DO-PERFIL", "role": "authenticated", "aal": "aal2"}',
  true);
select current_user as rodando_como,
       privacidade_ocultos() as ocultos,
       (select count(*) from leads
         where responsavel_id = any (privacidade_ocultos())) as leads_ocultos_visiveis,
       (select count(*) from lead_interactions
         where lead_id = 'COLE-AQUI-O-ID-DA-CONVERSA-OCULTA') as mensagens_da_conversa_oculta;
```

A contagem de mensagens olha a conversa pelo id, sem passar por `leads`: só
a seção 3 a zera. Antes, as duas contagens saem maiores que 0 para o gestor
com regra; depois das seções 2 e 3, as duas saem 0. Para quem não tem regra,
`ocultos` sai `{}` e o resto do app não muda. A contagem da Caixa e de
Contatos de quem não tem regra tem de bater antes e depois.

A gravação (seção 4), como um gestor, tem de ser recusada:

```sql
update settings set atualizado_em = now() where chave = 'privacidade';
-- esperado: UPDATE 0 (a linha não é dele para gravar)
```
