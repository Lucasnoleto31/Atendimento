# Privacidade entre pessoas da equipe

O admin define quem não vê as conversas de quem. Exemplo do pedido: "o grupo
Aikon não vê as conversas do Artur e do Lucas", ou "a Ana não vê as conversas
do Artur".

## Como funciona

Em **Administração**, só para o admin, há dois grupos de linhas:

- **Regras de privacidade.** Cada regra tem um "Quem" (uma pessoa ou um
  grupo) e "Não vê as conversas de" (uma ou mais pessoas). A linha mostra a
  regra numa frase: "Aikon (3 pessoas) não vê as conversas de Artur e Lucas."
- **Grupos de privacidade.** Nome e pessoas. Servem para escrever uma regra
  só para várias pessoas. Excluir um grupo apaga junto a regra dele (a tela
  mostra qual antes de confirmar).

A regra, por extenso:

1. A pessoa P não vê conversas nem contatos cujo **responsável** esteja na
   lista de "não vê" de alguma regra que vale para ela: a regra dela mesma
   ou a de um grupo em que ela está. Várias regras somam.
2. **Sem dono continua visível.** A regra olha o responsável; conversa sem
   responsável não é de ninguém para esconder.
3. **Admin vê tudo**, sempre. Regra que alcança um admin aparece com o aviso
   "Admin vê tudo; esta regra não vale para Fulano."
4. **Ninguém fica oculto de si mesmo.** Se a Ana está no grupo Aikon e a
   regra do Aikon esconde a Ana, ela continua vendo as próprias conversas (a
   prévia da regra diz isso).
5. Uma regra por pessoa e uma por grupo. A pessoa pode ter a regra dela e
   estar num grupo com outra: vale a soma.

O que a regra muda depende do papel, porque ela só esconde o que o papel
já mostrava:

| Papel | Hoje vê | Com regra |
|---|---|---|
| Atendente | só as conversas em que é o responsável | nada muda (a prévia avisa) |
| Assessor | as dele, as sem dono e as de clientes da carteira dele | some o que vinha de outro responsável oculto pela carteira |
| Gestor | tudo | some o que é do responsável oculto |
| Compliance | tudo | some o que é do responsável oculto (cuidado ao criar regra para o compliance) |
| Admin | tudo | nada muda |

### Onde fica gravado

Uma linha da tabela `settings`, chave `privacidade` (sem linha, sem regra):

```json
{
  "grupos": [{ "id": "…", "nome": "Aikon", "membros": ["<id de profiles>"] }],
  "regras": [{ "id": "…", "quem": { "tipo": "grupo", "id": "…" },
               "naoVe": ["<id de profiles>"] }]
}
```

Só o admin grava: a action confere o papel (a policy de `settings` de hoje
deixaria a gestão gravar). Cada mudança vai para o **Log de acesso**: "criou
um grupo de privacidade", "mudou uma regra de privacidade" e assim por
diante. O grupo aparece pelo nome, com quem entrou e quem saiu dele ("grupo
Aikon · 3 pessoas · entrou Bia · saiu Ana"; na criação, todos entram). A
regra aparece pela frase, e a de antes quando muda.

### No código

| Arquivo | O quê |
|---|---|
| `src/lib/privacidade-regra.ts` | A regra pura (tipos, leitura do JSON, `ocultosPara`, `donoOculto`), com os testes de mesa no comentário. Pode ir para o navegador. |
| `src/lib/privacidade.ts` | O lado do servidor: `lerPrivacidade()`, `donosOcultosParaMim()` (uma leitura por request) e `podeVerLead(leadId)`. Reexporta a regra pura. Não importar em componente de cliente (puxa `next/headers`). |
| `src/app/(app)/admin/privacidade*.ts(x)` | A tela, as actions e os textos (a frase da regra e os avisos). |
| `supabase/propostas/0071_privacidade.sql` | A mesma regra no banco. **Não aplicada.** |

Como uma tela usa:

- Página de servidor: `const ocultos = await donosOcultosParaMim()` e filtra
  a lista com `donoOculto(lead.responsavel_id, ocultos)`, ou passa
  `donosOcultos={ocultos}` para o componente de cliente que recebe eventos
  do tempo real.
- Componente de cliente: `import { donoOculto } from "@/lib/privacidade-regra"`
  e descarta o evento cuja conversa é de um dono oculto.
- Quem abre conversa ou ficha pelo id (URL, paleta, action): `podeVerLead(id)`
  antes de mostrar ou de agir.

Erro ao ler a configuração não vira "sem regra": `lerPrivacidade()` lança, e a
tela cai no erro em vez de mostrar o que devia esconder. Em Administração a
seção avisa "Não deu para ler a privacidade" e o resto da tela segue.

## O que esconde

Nas telas que aplicam a regra (cada uma chama as funções acima; confira na
lista de mudanças de cada entrega): a Caixa e a conversa aberta no chat, a
lista de Contatos e a ficha, a busca da paleta (⌘K ou Ctrl+K) e os avisos de
mensagem nova do tempo real.

## O que NÃO protege enquanto a 0071 não for aplicada

A regra mora no código das telas. O banco continua com o RLS de hoje, que
não sabe dela. Quem tem regra e sabe usar as ferramentas do navegador ainda
alcança o que a tela esconde:

- **A API.** A chave pública do Supabase vai para o navegador (é assim que o
  tempo real funciona) e a sessão também. Com as duas, uma chamada direta ao
  PostgREST (`/rest/v1/leads`, `/rest/v1/lead_interactions`) devolve tudo o
  que o papel vê hoje: para gestor e compliance, todas as conversas e
  mensagens; para assessor, as da carteira.
- **O tempo real.** O canal de mensagens novas entrega ao navegador o evento
  de toda conversa que o RLS deixa, **com o texto da mensagem**. A tela
  descarta o da conversa oculta, mas o dado chegou e aparece nas
  ferramentas de rede do navegador.
- **A própria regra.** A policy de `settings` deixa a gestão gravar qualquer
  chave. Um gestor com regra consegue, pela API, apagar a regra dele, e isso
  não passa pelo Log de acesso.
- **A prévia das conversas** (`previas_conversas`, 0045) devolve a última
  mensagem de qualquer lead pelo id, com ou sem regra. A seção 5b da 0070
  corrige.
- **Exportação de contatos** (`/api/exportar/contatos`): lê com a sessão e
  só respeita a regra se a rota filtrar por `donosOcultosParaMim()`.

Para a equipe que só usa as telas, a regra vale. Para quem quer contornar,
ainda não: é o que a 0071 fecha.

### Mesmo com a 0071 aplicada, fica de fora

- `previas_conversas` sem a 5b da 0070.
- `campanha_envios` segue legível para a equipe (id do lead e situação do
  envio, sem o texto da conversa).
- A configuração segue legível para a equipe: qualquer pessoa logada pode ler
  pela API quais regras existem. O conteúdo das conversas, não.
- Caminhos com a chave de serviço (webhook da Meta, links assinados de
  anexo, envio de mídia): não passam por RLS, e quem protege é o código. Um
  link assinado de anexo já entregue abre até vencer.
- O relatório mostra contagens por atendente, sem conteúdo de conversa.
- **Mídia das conversas:** fotos, áudios e arquivos ficam no bucket público
  `midia-whatsapp` do Storage, servidos por URL pública (`getPublicUrl`). A
  regra esconde a mensagem, mas quem já tem o endereço de um arquivo (porque
  viu a conversa antes da regra, ou recebeu o link) continua abrindo. O
  endereço não é adivinhável, e o bucket não lista arquivos para quem não tem
  a chave de serviço. Fechar de vez é tornar o bucket privado e servir a mídia
  por link assinado, que é mudança de Storage e de código.

## Como testar

Use contas de teste e apague as regras no fim. **O banco ligado nas
máquinas de desenvolvimento é o de produção**: grupo e regra criados ali
valem para a equipe na hora.

### Nas telas (sem a 0071)

1. Escolha um gestor de teste (G) e uma pessoa com conversas (P). Entre como
   G e anote quantas conversas de P aparecem na Caixa, em "Tudo".
2. Como admin, em Administração: "Novo grupo", nome "Teste", com G. Depois
   "Nova regra": Quem = Teste, não vê as conversas de P. A prévia tem de
   dizer "Teste (1 pessoa) não vê as conversas de P." Salve.
3. No Log de acesso, as duas linhas novas: "criou um grupo de privacidade"
   (grupo Teste, 1 pessoa, entrou G) e "criou uma regra de privacidade" (a
   frase). Edite o grupo, troque G por outra pessoa e salve: a linha de
   "mudou um grupo de privacidade" diz quem entrou e quem saiu. Volte G.
4. Como G: as conversas de P somem da Caixa, de Contatos e da busca ⌘K.
   Abrir `/chat?lead=<id de uma conversa de P>` e `/contatos/<id>` não mostra
   a conversa. Uma mensagem nova numa conversa de P não aparece, não toca e
   não conta como não lida. As conversas sem dono e as de G continuam.
5. Como admin: tudo visível, como antes.
6. Edite a regra e ponha um admin no "Quem" (ou no grupo): aparece o aviso
   "Admin vê tudo; esta regra não vale para …". Ponha um atendente: a prévia
   avisa que para ele nada muda.
7. Exclua o grupo "Teste": a confirmação mostra a regra que sai junto. Como G,
   tudo volta.

### No banco (depois da 0071)

O roteiro de `supabase/propostas/README.md` ("Como conferir" da 0071), com o
id de G e o de uma conversa de P: antes das seções 2 e 3 as contagens de
leads e de mensagens ocultas saem maiores que 0; depois, 0. Repita com uma
pessoa sem regra: nada muda.

Confira também, com G logado e a regra valendo:

- **Tempo real:** mande uma mensagem do WhatsApp para uma conversa de P. Nas
  ferramentas do navegador de G (Rede, WS), nenhum evento dela chega.
- **Transferência e cadastro:** como G, passe uma conversa dele para P, e
  cadastre um contato em Contatos > Novo com responsável P. O banco recusa
  os dois ("new row violates row-level security policy"), porque a linha
  nova sai da vista de quem grava. A saída é a mesma para os dois: uma
  função security definer que confere a permissão e grava sem o RETURNING,
  antes de a 0071 ir para produção. O atendente que passa a conversa para um
  colega, sem regra nenhuma, já cai no mesmo caso com as policies de hoje.
- **Gravação da regra:** como G (gestor), um `update` na linha `privacidade`
  de `settings` volta com 0 linhas.
