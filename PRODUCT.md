# Product

<!-- impeccable:product-schema 1 -->

## Platform

web

## Users

A equipe de atendimento da Zeve Investimentos, um escritório de assessoria de investimentos:
atendentes que respondem leads e clientes, gestores que distribuem o trabalho e acompanham a
equipe, e um papel de compliance que só lê. A equipe usa o sistema no desktop e no celular na
mesma medida (confirmado pelo Artur em 07/10/2026): o celular não é apoio, é metade do uso.

## Product Purpose

Uma caixa de entrada compartilhada para as conversas que chegam pelo WhatsApp (API oficial da
Meta) e pelo Instagram Direct. A pessoa abre a conversa, responde, atribui, etiqueta, adia ou
resolve, e segue para a próxima. Em volta da caixa: contatos, disparos de template por etiqueta
com ritmo diário, um relatório de atendimento (mensagens por atendente e tempo da primeira
resposta) e a administração da equipe. Sucesso é nenhuma conversa esperando sem dono e a
resposta saindo rápido.

## Positioning

Ligado direto à Meta, sem intermediário e sem CRM no meio. Até outubro de 2026 o sistema era um
CRM (funil, carteira, comissão); em 07/10/2026 virou só atendimento, no estilo Chatwoot e
WhatsApp Business, feito para a mesa da Zeve.

## Operating Context

- Mensagens chegam em tempo real; a caixa compartilhada tem visões Caixa, Aguardando, Adiadas,
  Resolvidas e Tudo, e escopo Todas, Minhas e Sem dono.
- Regra da Meta: fora da janela de 24h desde a última mensagem do cliente, só sai template
  aprovado. O compositor tem de deixar isso claro.
- Áudio é comum; anexos e mensagens padrão (com anexo) também.
- Atalhos de teclado no desktop. No chat: J/K para andar na fila, E resolve, H adia, A assume a
  conversa sem dono. No compositor: ⌘Enter (Ctrl+Enter fora do Mac) envia e resolve, Esc volta
  o foco para a fila. Em qualquer tela: ⌘K (Ctrl+K) abre a paleta global (pessoa, área ou
  comando da tela) e Alt+1 a Alt+4 (⌘1 a ⌘4 no Mac) trocam de área.
- Entrada: e-mail e senha, sem segundo passo. "Esqueci a senha" manda um código de 6 dígitos
  no e-mail.
- Banco Supabase em São Paulo; função na Vercel em São Paulo.

## Capabilities and Constraints

- Chat (WhatsApp e Instagram), contatos, disparos em massa (campanhas por etiqueta), relatório
  de atendimento, administração (usuários, importar contatos, status do webhook),
  configurações (etiquetas, mensagens padrão, instâncias de WhatsApp, distribuição automática,
  teto diário de envios), log de acesso.
- Papéis: atendente, assessor, gestor, admin e compliance (só leitura).
- O banco de produção não muda sem o Lucas; o código funciona com o schema atual.
- A Meta não entrega a foto de perfil do WhatsApp; no Instagram, a foto vem do perfil.
- Toda tela e todo fluxo tem caminho de volta visível (regra do Artur).

## Brand Commitments

- Nome: Zeve Atendimento.
- Identidade visual: a ficha padrão do kit estético do Artur (`design/kit-estetico.md` e
  `design/ficha-padrao.md` na pasta "3. Claude"), por pedido explícito em 07/10/2026
  ("use o material de mídia kit para redesenhar").
- Texto em português do Brasil, direto, sem marketing e sem cara de texto gerado; número,
  moeda, data e hora no formato brasileiro.
- O dono do repositório é o Lucas; mudanças passam pela aprovação dele antes do deploy.

## Evidence on Hand

Conversas, contatos e etiquetas reais no banco de produção. Não há depoimento, número de
clientes nem métrica de desempenho publicada; nada disso deve ser inventado em tela.

## Product Principles

1. A fila manda: responder e seguir para a próxima com o mínimo de gestos, no teclado e no
   toque.
2. Estado sempre à vista: quem é o dono, se a janela de 24h está aberta, o que não foi lido,
   se a mensagem chegou.
3. Celular e desktop com a mesma capacidade, cada um no seu desenho.
4. Nada some sem caminho de volta; o que é reversível fica a um gesto.
5. Dado de cliente é sensível: acesso registrado, nada exposto além do necessário.

## Accessibility & Inclusion

Contraste AA, operação completa por teclado no desktop, alvo de toque de 44px no celular,
respeito a prefers-reduced-motion.
