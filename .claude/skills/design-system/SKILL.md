---
name: design-system
description: Regras de design do projeto Atendimento (Zeve Atendimento) na ficha padrão do kit estético do Artur — tokens de cor, papéis tipográficos, raio, superfícies, casca (menu lateral no desktop, barra de abas no celular, paleta ⌘K) e componentes base com a API exata. Use SEMPRE que for criar ou alterar qualquer interface (páginas, componentes, telas, estilos, Tailwind, CSS) neste projeto, e ao revisar UI existente.
---

# Design System — Zeve Atendimento

> Segue a **ficha padrão do kit estético do Artur** desde 07/10/2026 (monocromática, Poppins).
> Os valores dessa ficha estão nas tabelas abaixo e em `src/app/globals.css`; este arquivo
> basta, sem consulta a nada de fora do repositório. Nada aqui é gosto: os números saíram de
> medição, e mudar um valor pede medir de novo.

Fonte única de verdade para a interface. Nenhum valor de cor, tipo, raio ou espaço é
inventado fora destas tabelas. Os tokens moram em `src/app/globals.css`; os componentes, em
`src/components/ui` e `src/components/app`.

**A tese:** a caixa de entrada é uma fila viva, não um painel de CRM. Preto, branco e cinza;
a tinta faz o destaque e só o estado (não lida, janela de 24h, sem dono, falha de envio) ganha
peso. Cartão chapado, sem sombra; sombra e vidro só no que flutua.

---

## 1. Tipografia

**Uma família: Poppins** (`next/font/google`, variável `--font-poppins`), pesos **400**, **600**
e **700**. Não há 500 carregado: `font-medium` resolve para 400 de propósito (o nome lido
contra o não lido da fila é medium contra semibold).

| Uso | Classe | Fonte |
|---|---|---|
| Interface, texto e **número** | `font-sans` (padrão do body) | Poppins |
| Número que muda (hora, contagem, valor, coluna) | `tabular-nums` | Poppins com algarismo tabular |
| Código, ID, chave, token | `font-codigo` | `ui-monospace` do sistema |
| `<code>`, `<kbd>`, `<samp>`, `<pre>` | (automático) | `ui-monospace` |

`font-mono` é **legado**: resolve para Poppins com algarismo tabular, porque as telas antigas o
usavam em número. Tela nova não usa `font-mono`; usa `tabular-nums` no número e `font-codigo`
no código.

### Papéis (bloco 3 do kit)

Utilitários `tipo-*`. O tamanho troca sozinho no breakpoint de tablet (48rem): até 767px vale
a coluna do telefone; do tablet para cima, a do desktop. A troca está escrita como complemento
exato do `min-width` (`@media not all and (min-width: 48rem)`), nunca como `max-width`.

| Utilitário | Telefone | Tablet e desktop | Peso | Uso |
|---|---|---|---|---|
| `tipo-titulo-grande` | 34/41 | 28/34 | 700 | Título da tela ("Caixa", "Contatos") |
| `tipo-titulo-1` | 28/34 | 24/30 | 600 | Título de seção grande, número de destaque |
| `tipo-titulo-2` | 22/28 | 20/25 | 600 | Título de diálogo e de folha |
| `tipo-titulo-3` | 20/25 | 17/22 | 600 | Título de painel e de grupo |
| `tipo-destaque` | 17/22 | 14/19 | 600 | Nome na linha, rótulo forte |
| `tipo-corpo` | 17/22 | 14/20 | 400 | Texto e linha de lista |
| `tipo-chamada` | 16/21 | 13/18 | 400 | Prévia da mensagem na fila |
| `tipo-subtitulo` | 15/20 | 13/18 | 400 | Linha de apoio sob o título |
| `tipo-nota` | 13/18 | 12/16 | 400 | Metadado, hora, ajuda |
| `tipo-legenda` | 12/16 | 11/14 | 400 | Legenda de gráfico |
| `tipo-legenda-2` | 11/13 | 10/13 | 400 | Rodapé mínimo |
| `tipo-rotulo-aba` | 10/12 | 10/12 | 600 | Só o rótulo da barra de abas |

- Peso, entrelinha e aperto saem por `var(--tw-*)`: `font-semibold`, `leading-*` e
  `tracking-*` na mesma classe vencem o papel, em qualquer ordem
  (`tipo-corpo font-semibold` = corpo em 600).
- Aperto negativo só nos títulos (já embutido). Títulos com `text-wrap: balance`.
- **Prefixo `tipo-`, nunca `text-<nome>`:** o `cn()` (tailwind-merge) lê qualquer
  `text-<nome>` desconhecido como cor e apaga a cor ao lado. Pelo mesmo motivo, não passe
  `text-h1`/`text-h2`/`text-h3`/`text-display` por `cn()` junto com uma cor: um dos dois some.
- Legado: `text-display`, `text-h1`, `text-h2` e `text-h3` seguem os papéis título grande,
  1, 2 e 3 (também trocam no tablet). `text-sm` (14/20), `text-base` (16/24) e `text-xs`
  (12/16, peso 400) ficam como estavam. No toque, `input`, `select` e `textarea` sobem para
  16px sozinhos (o Safari do iPhone dá zoom em campo menor).
- Formato brasileiro em tudo: `1.234,56` · `R$ 1.234,56` · `07/10/2026` · `21h45`.
  Número interpolado cru numa frase passa pelo formatador (`toLocaleString("pt-BR")`).

---

## 2. Espaçamento — grid base 8px

`--spacing: 0.5rem`: `p-1` = 8px, `p-0.5` = 4px. Todo espaço, altura e dimensão é múltiplo
de 8; o meio-passo de 4 só dentro de elemento pequeno (chip, ícone e rótulo).

| Token | px | Uso |
|---|---|---|
| `0.5` | 4 | Gap ícone/texto, padding de chip |
| `1` | 8 | Gap entre irmãos próximos, rótulo → campo |
| `1.5` | 12 | Gap entre controles vizinhos (mínimo do kit no toque) |
| `2` | 16 | Padding lateral do telefone, campo → campo |
| `2.5` | 20 | Respiro interno de cartão (kit, bloco 2), também no telefone |
| `3` | 24 | Padding lateral do desktop, entre grupos |
| `4` | 32 | Entre blocos |
| `6` | 48 | Entre seções |

- Proximidade: o espaço dentro do grupo é menor que entre grupos.
- Alturas de controle: 32 (sm), 40 (padrão), 48 (lg e linha de lista no celular). No toque,
  o alvo mínimo é 44px: campo e botão de ícone sobem para 44 sozinhos; controle de 32 ganha
  área estendida invisível (`pointer-coarse:after:-inset-y-[6px]`).
- Breakpoints: `md` 768 (tablet: troca a escala de tipo), `lg` 1024 (troca a casca). Entre
  768 e 1023 (iPad em pé, janela em meia tela) vale a barra de abas com o tipo do desktop:
  é a exceção registrada ao kit, que pede cabeçalho já no tablet; mudar o ponto da casca é
  decisão do Artur.

---

## 3. Cor

Sem acento cromático. A tinta faz o destaque; as semânticas só aparecem em **texto curto**
(e no delta), nunca no fundo. Tema por `data-theme="dark"` no `<html>` (cookie `tema`, lido no
SSR; o `AlternadorTema` troca sem recarregar). Variante `dark:` disponível.

### Vocabulário da ficha (use estes em tela nova)

| Token (utilitário `bg-` / `text-` / `border-`) | Claro | Escuro | Uso |
|---|---|---|---|
| `fundo` | `#FFFFFF` | `#0B0B0B` | Chão da página; texto sobre a tinta |
| `cartao` | `#F3F3F3` | `#151515` | Cartão chapado, grupo de linhas, chip |
| `flutuante` | `#FFFFFF` | `#1A1A1A` | Menu, popover, folha, diálogo |
| `elevado` | `#FFFFFF` | `#2A2A2A` | Segmento ativo do `Segmentado` |
| `tinta` | `#111111` | `#F5F5F5` | Texto principal, botão principal, foco |
| `tinta-hover` | `#2E2E2E` | `#D6D6D6` | Hover do botão principal |
| `texto-2` | `#555555` | `#9E9E9E` | Texto secundário |
| `texto-3` | `#666666` | `#8A8A8A` | Placeholder, ícone inativo, terciário |
| `fio` | `#E4E4E4` | `#262626` | Divisor, borda de cartão e de menu |
| `fio-forte` | `#C4C4C4` | `#3A3A3A` | Borda de campo e de botão secundário |
| `realce` | tinta a 6% | tinta a 6% | Hover (translúcido: vale sobre qualquer superfície) |
| `pressionado` | tinta a 10% | tinta a 10% | Toque/active |
| `selecao` | tinta a 8% | tinta a 8% | Item selecionado, aba ativa |
| `bom` | `#2E6F40` | `#31C47F` | Estado bom, em texto curto |
| `atencao` | `#A14A17` | `#F6A823` | Atenção (janela fechada, sem dono) |
| `erro` | `#B22222` | `#E86464` | Erro, falha, ação destrutiva |
| `overlay` | preto a 40% | preto a 60% | Fundo de diálogo e folha |

**Contraste conferido na conta** (WCAG, texto sobre fundo / cartão):
tinta 18,9 / 17,0 (escuro 18,1 / 16,8); texto-2 7,5 / 6,7 (escuro 7,4 / 6,8); texto-3 5,7 /
5,2 (escuro 5,7 / 5,3, 4,7 no hover); fundo sobre a tinta 18,9 (escuro 18,1); bom, atenção e
erro entre 5,4 e 9,9 nos dois temas; fundo sobre o erro 6,7 (escuro 6,0). O vidro tem 85 a 90%
de opacidade para o texto-2 passar AA sobre a cor composta no pior caso. A conta completa está
nos comentários do `globals.css`. O `#7A7A7A` da ficha (4,3:1) não entra em texto de tela.

### Escala legada (as telas antigas; continua valendo, já com os valores da ficha)

| Família | Mapeamento |
|---|---|
| `primary-*` | A tinta. `500` e `600` = tinta (o `focus-visible:outline-primary-500` vira o anel na tinta); `700` = hover do botão; `50` = selecionado; `100` = hover sobre selecionado e texto sobre a tinta (hora da bolha); `900` = texto sobre `50` |
| `neutral-*` | Cinzas puros. `0` = superfície (branco; no escuro `#151515`); `50` = zona cinza (área do chat, cabeçalho de tabela); `100` = hover e chip; `200` = fio; `300` = borda de campo; `400` = placeholder (5,7:1); `600` = texto secundário; `800`/`900` = tinta |
| `accent-*` | A semântica de atenção. `100` = fundo cinza; `300` = fio de destaque (nota interna); `500` = indicador; `700` = texto |
| `success` `warning` `danger` `info` | As semânticas da ficha; `info` = tinta. O par `-bg` é **cinza** de propósito (`#F3F3F3` / `#212121`): a cor fica no texto |
| `avatar-1` a `avatar-4` | Os quatro cinzas do avatar sem foto, iniciais na tinta |

### Regras de cor

- Um destaque por tela, na tinta. Cor de matiz só no estado e só no texto curto.
- Cor nunca é o único portador: estado sempre com rótulo (ou ícone).
- Cor de etiqueta escolhida pela equipe entra só como ponto de 8px (`Etiqueta`/`Chip` com
  `cor`), nunca no fundo.
- Nenhum hex solto em tela. Sem gradiente, sem sombra colorida, sem fundo tintado de
  semântica.

---

## 4. Raio, superfície e sombra

Uma escala, base 10 no controle (kit, bloco 0):

| Utilitário (novo) | Legado | px | Uso |
|---|---|---|---|
| `rounded-celula` | `rounded-xs` | 6 | Célula de grade, segmento dentro do trilho |
| `rounded-chip` | `rounded-sm` | 8 | Chip, etiqueta |
| `rounded-controle` | `rounded-md` | 10 | Botão, campo, item de menu |
| `rounded-painel` | `rounded-lg` | 12 | Cartão, menu, popover, grupo de linhas |
| `rounded-folha` | `rounded-xl` | 16 | Folha e diálogo |
| `rounded-full` | — | — | Avatar, badge de contagem e barra de abas (seguem o desenho do sistema, não a escala) |

- **Cartão chapado:** `rounded-painel bg-cartao p-2.5`, sem sombra e sem borda; a separação é
  tom e espaço. Sobre o `cartao`, superfície interna volta a `fundo`.
- **Sombra só no que flutua:** `shadow-lg` (menu, popover, diálogo), `shadow-flutuante`
  (folha, vidro). `shadow-sm` não desenha nada (as telas antigas o põem em todo cartão).
- **Vidro só no que flutua** (barra de abas, folha), sempre as três
  classes juntas: `vidro backdrop-blur-[16px] backdrop-saturate-150`. O desfoque vai no
  elemento, não no `@utility`: num projeto irmão o `backdrop-filter` de classe própria sumiu
  do CSS servido sem erro. Conferir por `getComputedStyle(el).backdropFilter`.
- **Superfícies do navegador** já temadas no `globals.css`: seleção de texto, caret, anel de
  foco padrão (2px na tinta, a 2px), barra de rolagem fina, `accent-color` na tinta,
  algarismo tabular em `table`, `time`, `output`, `kbd` e campo numérico.

---

## 5. A casca (`src/components/app/app-shell.tsx`)

| Onde | Desenho |
|---|---|
| Desktop (`lg`+) | **Menu na lateral**, como era antes da cápsula (pedido do Artur depois de ver a cápsula no topo). 240px no tom `cartao`, sem fio nem sombra (a separação do conteúdo é o tom), parado no alto (`sticky`, altura da janela). De cima para baixo: a marca (Z + "Atendimento", link para o /chat); o botão "Buscar" com a tecla da paleta (⌘K / Ctrl+K), num poço `bg-fundo`; as áreas principais (Chat com o badge de não lidas, Contatos, Disparos, Relatório) e, 24px abaixo, a **Administração** (uma entrada só desde 09/10/2026, no lugar de Log de acesso, Administração e Configurações; ícone de engrenagem; ativa em qualquer `/admin/*`); no pé, iniciais, nome e papel (um link para `/conta`, com a pílula quando a pessoa está lá), o tema e o Sair. Item de 40px (44px no toque: o iPad deitado já mostra o menu), ícone de 18, rótulo `tipo-corpo`; o ativo é a pílula `bg-selecao` com rótulo em 600 e traço 2.25; hover `realce`. No /chat o menu recolhe para um trilho de 64px só de ícones (rótulo no `title` e em `sr-only`, badge no canto do ícone), com "Expandir menu" / "Recolher menu" acima da conta; a escolha fica no cookie `menu-chat`, lido no SSR pelo `(app)/layout.tsx`. Alt+1 a Alt+4 (⌘1 a ⌘4 no Mac) levam às principais; a dica do item mostra a tecla. Tocar na área em que já se está sobe ao topo |
| Celular e tablet (abaixo de `lg`) | Sem menu nem cabeçalho. Barra de abas de vidro flutuando no pé, até cinco itens (as principais que o papel vê e "Mais"), ícone de 22px, rótulo de 10px, pílula tintada na ativa. "Mais" abre uma folha presa no pé (arrasta para fechar) com a conta, "Buscar pessoa ou área" (abre a paleta), a Administração e o grupo com "Minha conta", o tema e o Sair. A folha entra no histórico: o voltar do sistema a fecha (os links dela usam `replace`, e o voltar da tela nova não a reabre). A aba "Mais" fica ativa em `/conta` e em `/admin/*`. A barra some com o teclado aberto, com qualquer diálogo `aria-modal` aberto e com `data-sem-abas`, e respeita a área segura |
| Compliance | Faixa "Modo somente leitura" de 40px no topo da coluna do conteúdo, em qualquer largura (texto curto abaixo de `lg`) |
| Paleta | `PaletaGlobal`, montada uma vez na casca (seção 6) |

Quem vê cada área continua sendo decidido por `papeis` em `MODULOS`. A Administração aparece
para admin, gestor e compliance, e o endereço dela muda com o papel (`entradaDaAdministracao`,
em `lib/papeis.ts`): a gestão abre o índice `/admin`; o compliance vai direto ao Log de acesso
(`/admin/acessos`), que é tudo o que ele vê ali.

**A Administração por dentro** (`src/app/(app)/admin/`, endereços em `admin/rotas.ts`):

- `/admin` é um índice no desenho dos Ajustes do iPhone: grupos (Conversas, Contatos, Pessoas
  e acesso, Conexão com a Meta), cada linha com ícone de 20px em `texto-2`, o estado à direita
  ou embaixo e a seta. Cada linha abre a subpágina dela: `/admin/mensagens`, `/etiquetas`,
  `/atendimento`, `/importar`, `/equipe` e `/privacidade` (só admin), `/acessos` e `/whatsapp`.
- A subpágina tem "‹ Administração" acima do título (`CabecalhoSubpagina`, 40px e 44 no toque,
  chevron de 20). Com `?voltar=` de outra tela, o "‹" diz a origem ("‹ Voltar à conversa",
  "‹ Disparos").
- O editor aberto mora na URL (`?abrir=<chave>`, com uma entrada no histórico): o voltar do
  sistema fecha a folha em vez de sair da página, e qualquer tela abre um editor por link
  (`hrefDoEditor("etiqueta:nova", voltar)`), inclusive para a própria tela (o `?abrir=` é
  acompanhado, não só lido na montagem). Quem chega com `?abrir=` e `?voltar=` e grava volta
  sozinho para a origem, saindo das duas entradas da subpágina (`history.go(-2)`; sem histórico,
  troca pela origem). A entrada do editor leva a marca `{ editorAberto }`, regravada depois de
  cada render: a revalidação das actions a apaga. `/admin?abrir=<chave>` e o `/configuracoes`
  antigo (redirect no `next.config.ts`) levam à subpágina da chave.
- Fechar o editor com algo digitado e não gravado pergunta "Descartar o que foi escrito?" (X,
  Esc, fundo, arrasto, outra linha, link da lista ou de dentro do editor e o voltar do sistema);
  a senha temporária na tela pergunta do mesmo jeito. O menu e a paleta não perguntam.
- A paleta (⌘K) tem, além das áreas, destinos fixos por papel (`components/app/destinos.ts`):
  os editores da Administração e de Minha conta, com sinônimos ("tag" acha "Nova etiqueta").
  Aparecem com algo digitado; na tela que já tem o editor, vale o comando dela e o destino some.
  O destino para a própria tela sem aquele editor (WhatsApp com os 10 números) também some. Os
  sinônimos da área Administração seguem o papel: o compliance só acha o Log de acesso.
- Erro numa tela de dentro aparece dentro da casca (`(app)/error.tsx`): menu e barra de abas
  continuam à vista, com "Tentar de novo" e "Recarregar a página".

**Variáveis que a casca publica** (no elemento `[data-casca]`, herdadas por toda tela):

| Variável | Valor |
|---|---|
| `--casca-topo` | 0; 40px com a faixa do compliance (o menu lateral não come altura) |
| `--casca-pe` | Barra de abas + área segura + 8px de respiro no celular; 0 no desktop, com teclado aberto ou com a tela pedindo a tela inteira. Com diálogo aberto a barra some, mas o `--casca-pe` fica (zerar esticaria o `h-util` da tela de trás) |
| `--teclado` | Quanto o teclado cobre, em px (0 fechado), no `<html>` |
| `--vv-altura`, `--vv-topo` | A área visível medida pelo `visualViewport`, no `<html>` |
| `data-teclado="aberto"` | No `<html>`, com o teclado aberto |

**Utilitários da casca:** `h-util` / `min-h-util` = `100dvh − --casca-topo − --casca-pe −
--teclado`. Elemento fixo no pé usa `bottom-[calc(var(--casca-pe)+16px)]`.

**Tela inteira no celular:** a tela põe `data-sem-abas` em qualquer elemento dela (ou
renderiza `<EsconderAbas />`, exportado da casca, que funciona em componente de servidor).
Enquanto ele existir, a barra de abas some e `--casca-pe` zera. É puro CSS (`:has`), sem
efeito e sem piscada. O `/chat` usa isso com a conversa aberta no celular.

**Diálogo e atalhos:** `role="dialog"` só existe no DOM enquanto o diálogo está aberto (a folha
do "Mais" tira o papel ao fechar). O chat lê `[role="dialog"]` para desligar J/E/H, e uma folha
fechada com o papel parado desligava os atalhos dele para sempre.

**O `/chat`:** a casca trava o `<main>` em `h-util` e estica o filho direto até ela
(`[&>*]:h-full!`), seja qual for a altura que a tela pede. A tela do chat não precisa calcular
altura; o documento não rola.

**Telas fora da casca** (`/entrar`, código, esqueci, redefinir, erro, 404, "Acesso
desativado", "Perfil não encontrado" e o formulário público `/captura`): o desenho em duas
metades pedido pelo Artur em 09/10/2026 (`entrar/moldura.tsx`). No desktop (lg+), à esquerda a
metade escura com o fundo de malha do kit em cinzas e a marca no canto de cima, parada; à direita
o formulário centrado, até 480px, com título curto, subtítulo em `texto-2`, campos de linha (sem
caixa, fio embaixo, ícone à esquerda), "Lembrar meu e-mail" e "Esqueci a senha" na mesma linha,
botão principal na largura toda (cinza até preencher) e, quando há, um botão de contorno embaixo.
No celular e no tablet, a parte escura vira uma faixa de 64px no topo com a marca e o formulário
vem logo embaixo, no topo da tela por causa do teclado. Nada do BTG: só o arranjo. Todo Sair (o
de "Acesso desativado", o do menu lateral e o da folha "Mais") é um formulário comum para
`/entrar/sair` (POST), e não a server action: funciona antes da hidratação e com a conta
desativada, cujas server actions o middleware barra.

## 6. Componentes (API exata)

### `Button` — `@/components/ui/button`

```tsx
<Button variant="primary" | "secondary" | "ghost" | "danger"   // padrão primary
        size="sm" | "md" | "lg"                                // 32 / 40 / 48; padrão md
        icone={<Plus size={18} strokeWidth={1.75} aria-hidden />}
        carregando={salvando}                                  // só <button>
        href="/contatos/novo"                                  // vira <Link>
        className="w-full" {...propsDoButtonOuDoLink}>
  {salvando ? "Salvando…" : "Salvar"}
</Button>
```

| Variante | Fundo | Texto | Borda |
|---|---|---|---|
| `primary` | `tinta` | `fundo` | — |
| `secondary` | transparente | `tinta` | 1px `fio-forte` |
| `ghost` | transparente | `texto-2` (hover `tinta`) | — |
| `danger` | `erro` | `fundo` | — |

- Hover: `primary` vai a `tinta-hover`; os outros ganham `realce`. Toque: escala .97 (só com
  movimento liberado). Foco: anel de 2px na tinta, a 2px.
- `carregando`: desativa, marca `aria-busy`, troca o `icone` pelo `Spinner` (largura não muda)
  e **mantém a cor** do botão. O rótulo "Salvando…" é de quem usa.
- Desativado: `fio` de fundo, `texto-3` no texto.
- `classesDoBotao({ variant, size, className })` devolve as mesmas classes para um elemento
  que não é o Button (`<label>` de arquivo, `<summary>`).
- Um `primary` por tela ou por diálogo.

### `Field` — `@/components/ui/field`

```tsx
<Field id="email" label="E-mail" ajuda="Para o código de entrada." erro={erros.email}
       type="email" autoComplete="username" {...propsDoInput} />
```

Rótulo sempre visível em cima, ajuda e erro embaixo. `erro` liga `aria-invalid`,
`aria-describedby` e a borda na semântica de erro.

### Classes de formulário — `@/components/app/form-styles`

| Constante | Para |
|---|---|
| `CAMPO` | Campo de texto, número, data e `select` nativo (40px; 44 no toque) |
| `CAMPO_BASE` | O mesmo sem o tamanho de texto (o Field usa) |
| `CAMPO_SELECT` | `select` com a seta desenhada no cinza do tema |
| `AREA_TEXTO` | `textarea` (altura mínima 96) |
| `ROTULO` | `<label>` acima do campo (14, 400, tinta; como os rótulos das telas antigas) |
| `AJUDA` / `ERRO_CAMPO` | Linha embaixo do campo (`texto-2` / `erro`) |
| `BOTAO_ICONE` | Botão só de ícone, 40px (44 no toque); pede `aria-label` |

### `Etiqueta` e `Chip` — `@/components/ui/etiqueta`

```tsx
<Etiqueta tom="neutro" | "tinta" | "bom" | "atencao" | "erro" cor={etiqueta.cor}>Sem dono</Etiqueta>
<Chip ativo={filtro} onClick={alternar} cor={etiqueta.cor} icone={<User size={16} aria-hidden />}>Minhas</Chip>
```

- `Etiqueta`: leitura (22px, raio de chip, `text-xs`). Fundo sempre `cartao` (ou `tinta` no
  `tom="tinta"`, o único destaque da linha); a semântica fica no texto.
- `Chip`: filtro que liga e desliga (`aria-pressed`), 32px com área de toque de 44. Ligado na
  tinta; desligado só com o fio.
- `cor` (opcional, nos dois): a cor que a equipe deu à etiqueta, num ponto de 8px.

### `Segmentado` — `@/components/ui/segmentado` (client)

```tsx
<Segmentado rotulo="Visão" valor={visao} onMudar={setVisao}
  opcoes={[{ valor: "caixa", rotulo: "Caixa", contagem: 12 },
           { valor: "aguardando", rotulo: "Aguardando" }]}
  tamanho="md" | "sm" larguraTotal />
```

- Sem `href` nas opções: grupo de rádio (`role="radiogroup"`), setas trocam de opção.
- Com `href`: links (`aria-current`), para filtro que mora na URL em tela de servidor.
- Trilho em `realce`, segmento ativo em `elevado` com fio; `contagem` em algarismo tabular.

### `Spinner` — `@/components/ui/spinner`

`<Spinner tamanho={16} rotulo="Enviando" />` — gira só com movimento liberado; sem `rotulo` é
decorativo. Carregamento de tela usa esqueleto no formato da tela, não spinner.

### `Marca` e `MarcaZ` — `@/components/ui/marca`

`<Marca />` = Z da Zeve + "Atendimento" (o leitor de tela lê "Zeve Atendimento"). `<MarcaZ
className="h-[24px]" />` = só o Z, em `currentColor`. Use estes, não `<img>`: o
`public/marca/zeve-z.svg` (mesmo desenho, `fill="currentColor"`) passa pelo middleware e quem
não está logado é desviado para o /entrar.

### `AlternadorTema` — `@/components/app/alternador-tema`

`<AlternadorTema />` (botão de ícone, 40px) ou `<AlternadorTema variante="linha" />` (linha de
lista, para folha e configurações). `alternarTema()` exportado para quem precisar do gesto.

### `PaletaGlobal`, `useComandosDaTela`, `abrirPaleta` — `@/components/app/paleta-global` (client)

A paleta ⌘K (Ctrl+K fora do Mac) vale em qualquer tela, inclusive com o foco num campo, e não
abre por cima de outro diálogo. Grupos, nesta ordem: **Pessoas** (a partir de 2 letras ou 4
números, pela busca única; Enter abre `/chat?lead=<id>`, no /chat com os filtros da fila da URL
atual; Shift+Enter ou "Ficha" abre `/contatos/<id>`; fora do chat os dois levam o `?voltar=`
da tela atual), os comandos da tela, **Ir para** (as áreas do papel, com a tecla) e **Conta**
(tema). "Ir para" inclui "Minha conta". Padrão combobox: o foco fica no campo, as setas andam, Esc fecha e devolve o foco a
quem abriu; a ação roda depois da devolução, para poder mover o foco. A linha destacada é
guardada pela chave, não pela posição: as pessoas que chegam depois entram acima sem tirar o
destaque de onde ele estava.

```tsx
// A tela registra os comandos dela enquanto estiver montada:
useComandosDaTela([
  { id: "resolver", rotulo: "Resolver conversa", grupo: "Esta conversa", atalho: "E",
    executar: () => despachar(lead, "resolver") },
]);
abrirPaleta();            // abre por botão; abrirPaleta(elemento) diz para onde o foco volta
```

- `ComandoPaleta = { id; rotulo; grupo?; atalho?; executar }`. Sem `grupo`, cai em "Nesta
  tela". Comando que não vale agora não é passado (não há desativado). Array novo a cada
  render não custa nada: só id, rótulo, grupo ou tecla diferentes redesenham, e a execução usa
  a função mais nova.
- A busca de pessoas é a server action `buscarPessoas(termo)` de `@/app/(app)/busca/actions`
  (até 8 resultados, `PessoaEncontrada` com estado "aberta" | "adiada" | "resolvida" |
  "sem_conversa").

### `ContadorNaoLidas` — `@/components/app/nao-lidas` (client)

`<ContadorNaoLidas className="ring-2 ring-cartao" />`: badge de 20px na tinta com a contagem
(algarismo tabular, "99+" acima de 99) e o texto "N conversas não lidas" para o leitor de tela.
Esse texto só vale com o badge depois do rótulo. Com o badge antes (no canto do ícone, como na
barra de abas), use `<ContadorNaoLidas soVisual />` e ponha `<NaoLidasParaLeitor />` depois do
rótulo: o nome do link fica "Chat, 3 conversas não lidas", e não o contrário.
Onde ele fica é de quem usa. Não troque o elemento em volta entre dois desenhos: remontar religa
o canal de tempo real.

### `AvatarContato` — `@/components/app/avatar-contato`

Igual a antes; sem foto, um dos quatro cinzas (`corDoAvatar`) com as iniciais na tinta.

### Padrões sem componente (ainda)

- **Linha de lista no celular:** grupo `rounded-painel bg-cartao overflow-hidden`; linha de
  48px com ícone de 20px em `texto-2`, texto em `tipo-corpo`, seta `ChevronRight` em `texto-3`
  e separador encaixado (`border-t border-fio` no texto, `group-first:border-t-0`).
- **Menu/popover:** `rounded-painel border border-fio bg-flutuante p-0.5 shadow-lg`; itens de
  40px `rounded-controle`, hover `realce`, atual `selecao`.
- **Folha no celular:** presa no pé, `rounded-t-folha bg-flutuante shadow-flutuante`, pegador
  de 36×5, título `tipo-titulo-3`, X de 44px, arrasto para fechar, `aria-modal`, foco na
  folha (nunca num campo: abriria o teclado), Esc fecha. Modelo: `FolhaMais` na casca.
- **Diálogo no desktop:** janela centralizada com X, `rounded-folha`, 12px de margem da
  borda, altura limitada à área visível, rolagem própria e contida.
- **Tabela:** cabeçalho em `bg-neutral-50` (ou `bg-cartao`), número à direita com
  `tabular-nums`, linha de 48px, fio `fio` entre linhas.
- **Topo de fila** (o /chat; modelo em `conversas/topo-fila.tsx` e `conversas/barra-filtros.tsx`,
  escolha do Artur em 08/10/2026, funil em 09/10/2026): "Caixa ▾" (seletor da visão, com a
  contagem na linha de base em `tipo-legenda` tabular, some com zero), o **funil** e "Selecionar"
  com a palavra, os três na mesma linha e sem vão entre eles (o respiro é o do desenho; com 8px de
  vão, "Aguardando" cortava na fila de 360px); a busca; o escopo Todas · Minhas · Sem dono N num
  `Segmentado` na largura toda; e, só com algum filtro ligado, as **pílulas** dos ligados.
  - O funil (`FunilFiltros`): botão de ícone de 40px (área de 44 no toque), o número de filtros
    ligados num selo de 16px na tinta preso ao canto do ícone (quase todo fora dele, para a boca
    do funil se ler), "Filtros, N ativos" no nome, fundo `selecao` enquanto aberto. Abre a lista
    curta "Filtrar por": Período ›, Etiquetas ›, Atendentes › (só para quem vê a base inteira),
    Canal ›, Campanha ›, cada uma com o valor à direita quando ligada, e "Só não lidas", que liga e
    desliga ali mesmo, com a marca. A categoria abre o menu daquele filtro ancorado no funil, com
    "‹ Filtros" e o nome do filtro no topo; Esc volta um nível (do filtro para a lista; da lista,
    fecha) e o foco volta ao funil. No celular, a lista e os menus são a folha presa no pé, com o
    "‹ Filtros" no alto da rolagem. A paleta ("Filtros da fila") abre a lista.
  - As pílulas (`BarraFiltros`): o valor na tinta com X para limpar (o foco passa à vizinha, ou ao
    funil); tocar abre o mesmo menu ancorado na pílula. Quebram linha em vez de rolar de lado;
    "Limpar filtros" no fim com duas ou mais. Sem filtro ligado, a linha não existe (altura zero).
  - Lista vazia nunca some: o menu diz o que falta ("Nenhuma etiqueta cadastrada."). Período traz
    De e Até à vista, com Aplicar.
  - **Exceção pendente ao kit (decisão do Artur, aberta em 09/10/2026):** hoje o funil e o
    "Selecionar" ficam colados, sem vão, também no toque, e a área estendida do funil entra 2px
    no "Selecionar". Isso descumpre os 12px entre controles vizinhos no toque (seções 2 e 8). O
    respiro é o do desenho; com 8px de vão, "Aguardando" cortava na fila de 360px. Opções em
    aberto: (a) 12px só no toque, e o título corta mais no telefone e no iPad; (b) no telefone, o
    funil dentro da busca, à direita, e o título volta a caber; (c) aceitar sem vão e registrar
    aqui como exceção, como a da casca no `lg`. Até ele escolher, não vale como regra para
    outras telas.
  - No telefone de 375px, "Aguardando" e "Resolvidas" cortam com reticências: título de 34px, o
    funil e o "Selecionar" em 343px (medido com a Poppins; na bancada, "Aguardando" pede 216px e
    "Resolvidas" 183px para 178 livres). "Resolvidas" cabe a partir de 390px. No iPad de 820px e
    na coluna de 360px do desktop, cabe. Entra na mesma decisão do item acima.
  - **Seleção em massa no topo**, como o Gmail: o topo inteiro dá lugar à barra de ações
    ("Selecionar todas", "N selecionadas", Cancelar; Transferir, Etiquetas, Adiar, Resolver,
    Lida), sem barra no pé. Contatos segue o mesmo desenho desde 09/10/2026: funil à direita
    da busca, pílulas só dos filtros ligados e seleção no topo
    (`contatos/barra-filtros-contatos.tsx`, `contatos/lista-selecionavel.tsx`).
- **Filtro de etiquetas** (fila e Contatos, mesmas funções em `chat/mensagem.ts`): seletor
  "Qualquer uma · Todas" no topo do menu e "Sem etiqueta" no topo da lista (exclusivo com as
  etiquetas). No celular, o funil da fila fica dentro do campo de busca, à direita, com 12px de
  vão até o X da busca no toque.
- **Recontato** (`conversas/recontato.tsx`, `chat/recontato*.ts`): agendado pelo ⋯ com data,
  motivo e template opcional; no dia, a linha mostra "Recontato: motivo" em atenção e a conversa
  abre com a faixa "Recontato de hoje" (Enviar o template, Feito, Reagendar, Cancelar). A visão
  "Recontatos" no menu "Caixa ▾" agrupa Atrasados, Hoje e Próximos.
- **Foto da equipe** (`components/app/avatar-pessoa.tsx`): foto redonda ou iniciais no cinza da
  ficha; abaixo de 20px, uma inicial só. Aparece no menu, em Minha conta, na Equipe, nas bolhas
  da equipe, no dono da conversa e nas listas de Transferir e de Atendentes.
- **Conversa** (`chat/bolha.tsx`): bolha nossa à direita na tinta, do contato à esquerda no
  cartão, rabinho na primeira do grupo, hora e ✓ dentro da bolha; ações na seta (desktop) e no
  toque longo (celular); arrastar para a direita responde. Só Responder, Copiar e Apagar para a
  equipe: o Artur pediu o jeito do WhatsApp no essencial, "não precisa ser um novo WhatsApp".
- **Gráfico** (o Relatório; siga a skill `dataviz` dentro da ficha): tinta e cinzas por
  intensidade, semântica só em estado; um gráfico por painel, número antes do texto. Marca de
  gráfico (coluna, célula de mapa, trilho) pode ter raio de 2px e altura fora do grid de 8:
  é marca de dado, não superfície de interface. O que recebe foco segue a escala de raio.
  Sempre com a leitura acessível: tabela `sr-only` dentro de um `div` (solta, ela empurra a
  página de lado no celular) ou tabela de verdade com foco itinerante.
- **Ícones:** lucide, traço 1.75 (2.25 no item ativo da navegação: a lucide não tem versão
  preenchida). 18px no desktop, 20 a 22 no celular. Ícone que só ilustra o rótulo ao lado sai.

---

## 7. Movimento (kit, bloco 6)

| O quê | Como |
|---|---|
| Entrada de painel, menu, popover | `animate-entrada` (fade de 180ms), sem deslizar nem escalar |
| Toque em controle | `motion-safe:active:scale-[.97]` (aba da barra: .88) |
| Hover, cor | 120ms |
| Folha que entra e sai | `translate` em 280ms com `ease-padrao` (`cubic-bezier(0.32,0.72,0,1)`); solta pelo arrasto, fecha em 240ms ou volta em 340ms (kit, bloco 6; não medido no aparelho) |
| Menu lateral que recolhe | largura em 180ms com `ease-padrao` |
| Fundo de folha e diálogo | fade de 180ms |
| Carregando | esqueleto com `motion-safe:animate-pulse` |

- Anima o que muda de lugar, não o que só aparece. Nada em cascata, nada contando até o valor,
  nada crescendo no hover, nenhuma coreografia de abertura.
- `prefers-reduced-motion`: o `globals.css` zera duração de transição e animação; o
  `Spinner` para; use `motion-safe:` em tudo que mexe.

---

## 8. Acessibilidade (não negociável)

- Contraste AA conferido na conta (seção 3), também sobre vidro (cor composta).
- Alvo de toque de 44px no celular; 12px entre controles vizinhos no toque.
- Foco visível em tudo (anel de 2px na tinta). Nunca `outline-none` em controle.
- Operação completa por teclado no desktop. No chat: J/K andam na fila, E resolve, H adia, A
  assume a conversa sem dono. No compositor: ⌘Enter / Ctrl+Enter envia e resolve, Esc devolve
  o foco à fila (o rascunho fica). Em qualquer tela: ⌘K / Ctrl+K abre a paleta global (não é
  mais a paleta do chat) e Alt+1..4 / ⌘1..4 levam às áreas. Com folha ou diálogo aberto
  (`aria-modal="true"`), o teclado é deles.
- Ícone sem texto exige `aria-label`. Um `<h1>` por tela; níveis não pulam.
- Toda tela e todo fluxo tem caminho de volta visível ("← Caixa", X na folha, "Cancelar").
- "Pular para o conteúdo" já vem da casca (`#conteudo`).

---

## 9. Evite a estética genérica de IA

**Cor e superfície**
- Sem azul de SaaS, sem gradiente (em fundo, botão, borda ou texto), sem brilho nem sombra
  colorida, sem fundo tintado de semântica, sem selo colorido em cada linha.
- Sem vidro decorativo: vidro só no que flutua, e sempre sobre conteúdo que passa por baixo.
- Sem sombra em cartão; sem cartão dentro de cartão.

**Forma e layout**
- Sem raio fora da escala (`rounded-2xl`, `rounded-3xl`, botão `rounded-full`).
- Sem grade de cartões iguais de ícone, título e texto; sem "hero" de número com selo.
- Sem rótulo pequeno em caixa alta acima do título ("eyebrow"); o título fala sozinho.
- Texto e formulário alinhados à esquerda.

**Conteúdo**
- Sem ✨/🚀/emoji no lugar de ícone; uma família de ícones (lucide), um traço.
- Texto pt-BR sem cara de gerado (kit, bloco 4): número no lugar de metáfora, o verbo no
  botão ("Salvar", "Enviar template"), "Salvando…" enquanto grava, aviso sem exclamação,
  estado vazio que não consola ("Nenhuma conversa esperando."), erro perto do problema com o
  caminho. Sem travessão, sem frase em três partes, sem a tela falando de si.
- Jargão que a equipe usa fica (template, janela de 24h, lead).

**O teste:** se o componente pareceria idêntico em qualquer SaaS genérico, está errado. É uma
ferramenta que alguém usa oito horas por dia, no desktop e no celular.

---

## 10. Checklist antes de entregar UI

1. Toda cor vem de token (`fundo`, `cartao`, `tinta`, `texto-2`...), sem hex solto?
2. Tipo por papel (`tipo-*`), número com `tabular-nums`, código em `font-codigo`?
3. Raio da escala (`celula`, `chip`, `controle`, `painel`, `folha`)? Cartão chapado, sombra só
   no que flutua?
4. Conferido em 375px, 768px e 1280px, nos dois temas, sem rolagem lateral?
5. Contraste AA nos textos menores, no placeholder e sobre o vidro?
6. Foco visível, teclado funcionando, alvo de 44px no toque, teclado do celular previsto
   (nada fixo no pé coberto por ele)?
7. Estados: vazio, carregando (esqueleto), erro, desativado, densidade máxima?
8. Caminho de volta visível em toda tela e fluxo?
9. Texto lido fora do layout: sem cara de gerado, formato brasileiro?
10. Vidro conferido por `getComputedStyle(el).backdropFilter`, não pelo print?
