---
name: design-system
description: Regras de design do projeto Atendimento — escala tipográfica, grid de 8px, tokens de cor e padrões de componente. Use SEMPRE que for criar ou alterar qualquer interface (páginas, componentes, telas, estilos, Tailwind, CSS) neste projeto, e ao revisar UI existente.
---

# Design System — Atendimento (Zeve)

Fonte única de verdade para a interface. Nenhum valor de tipografia, espaçamento ou cor
deve ser inventado fora desta tabela. Se algo que você precisa não existe aqui, use o
valor mais próximo da escala — não crie um novo passo.

---

## 1. Tipografia

**Famílias**

| Uso | Fonte | Fallback |
|---|---|---|
| Interface e texto | Geist Sans (`--font-geist-sans`) | `system-ui, sans-serif` |
| Números, código, IDs, timestamps | Geist Mono (`--font-geist-mono`) | `ui-monospace, monospace` |

Nunca use mais de duas famílias na mesma tela.

**Escala** — base 16px, razão ~1.2, arredondada para múltiplos de 2px.

| Token | Tamanho | Line-height | Peso | Tracking | Uso |
|---|---|---|---|---|---|
| `text-display` | 48px | 52px (1.08) | 600 | -0.02em | Título único de landing. Máx. 1 por página. |
| `text-h1` | 32px | 40px (1.25) | 600 | -0.015em | Título de página |
| `text-h2` | 24px | 32px (1.33) | 600 | -0.01em | Seção |
| `text-h3` | 20px | 28px (1.4) | 600 | 0 | Subseção, título de card |
| `text-lg` | 18px | 28px (1.55) | 400 | 0 | Lead, texto de destaque |
| `text-base` | 16px | 24px (1.5) | 400 | 0 | Corpo padrão |
| `text-sm` | 14px | 20px (1.43) | 400 | 0 | UI densa, labels, tabelas |
| `text-xs` | 12px | 16px (1.33) | 500 | 0.01em | Badges, metadados, timestamps |

**Regras**

- Pesos permitidos: **400** (corpo), **500** (label/ênfase), **600** (título). Não use 700+ nem 300.
- Máximo **três** tamanhos distintos por tela. Hierarquia se resolve com peso e cor antes de tamanho.
- Largura de leitura: `max-w-[68ch]` em texto corrido.
- Nunca centralize blocos com mais de duas linhas.
- `text-xs` nunca abaixo de 12px — inclusive em legendas e tooltips.
- MAIÚSCULAS só em `text-xs` com `tracking-[0.06em]`, e apenas para rótulos de seção.

---

## 2. Espaçamento — grid base 8px

Todo espaçamento, altura e dimensão é múltiplo de **8px**. O único meio-passo permitido
é **4px**, restrito a espaçamento interno de elementos pequenos (badge, ícone + label,
gap dentro de um chip).

| Token | px | Uso |
|---|---|---|
| `space-0.5` | 4 | Meio-passo (gap ícone/texto, padding de badge) |
| `space-1` | 8 | Gap entre elementos irmãos próximos |
| `space-2` | 16 | Padding interno padrão, gap de formulário |
| `space-3` | 24 | Padding de card, gap entre grupos |
| `space-4` | 32 | Separação entre blocos |
| `space-5` | 40 | — |
| `space-6` | 48 | Separação entre seções |
| `space-8` | 64 | Respiro de seção em página densa |
| `space-10` | 80 | Respiro de seção em landing |
| `space-12` | 96 | Topo/base de página |

**Regras**

- Proibido: 5, 7, 10, 14, 15, 18, 30px etc. Se aparecer, é bug.
- **Proximidade**: o espaço *dentro* de um grupo é sempre menor que o espaço *entre* grupos.
  Label→input = 8px; campo→campo = 16px; grupo→grupo = 32px.
- Altura de linha e altura de componente também respeitam o grid: 32 / 40 / 48px.
- Gutter de grid: 24px (desktop), 16px (mobile).
- Container: `max-w-[1200px]`, padding lateral 24px (desktop) / 16px (mobile).
- Breakpoints: 640 / 768 / 1024 / 1280px.

---

## 3. Tokens de cor

Três famílias: **primária**, **neutra**, **destaque**. Semânticas apenas para estado.
Nenhum hex solto no código — sempre via token.

### Primária — azul-tinta (ação, links, seleção)

| Token | Hex | Uso |
|---|---|---|
| `primary-50` | `#F1F5FA` | Fundo de estado selecionado |
| `primary-100` | `#DEE9F4` | Hover sutil, borda de foco suave |
| `primary-300` | `#91B4D7` | Bordas, ícones desativados sobre fundo claro |
| `primary-500` | `#3A6DA3` | Cor de marca, links |
| `primary-600` | `#275685` | **Fundo de botão primário** |
| `primary-700` | `#1D4369` | Hover do botão primário |
| `primary-900` | `#12293F` | Texto sobre fundo primário claro |

### Neutra — cinzas quentes (superfícies e texto)

Cinza puro (`#808080`) é proibido — os neutros têm leve viés quente.

| Token | Hex | Uso |
|---|---|---|
| `neutral-0` | `#FFFFFF` | Superfície elevada (card, modal) |
| `neutral-50` | `#FAFAF9` | Fundo de página |
| `neutral-100` | `#F4F3F1` | Fundo de área secundária, linha zebrada |
| `neutral-200` | `#E7E5E1` | **Bordas e divisores** |
| `neutral-300` | `#D3D0CB` | Borda de input, estado desativado |
| `neutral-400` | `#A8A49D` | Placeholder, ícone inativo |
| `neutral-600` | `#57534E` | **Texto secundário** |
| `neutral-800` | `#292725` | **Texto primário** |
| `neutral-900` | `#1A1917` | Títulos, fundo do tema escuro |

### Destaque — âmbar (usar com parcimônia)

Marca no máximo **um** elemento por tela. Nunca em botão primário.

| Token | Hex | Uso |
|---|---|---|
| `accent-100` | `#FDF0DC` | Fundo de aviso/destaque |
| `accent-300` | `#F5C888` | Borda de destaque |
| `accent-500` | `#E08A2B` | Indicador de atenção, badge "novo" |
| `accent-700` | `#B06818` | Texto sobre `accent-100` |

### Semânticas (estado, não decoração)

| Token | Hex | Uso |
|---|---|---|
| `success` | `#1E7A4D` | Atendimento resolvido, confirmação |
| `warning` | `#B5730C` | SLA em risco, pendência |
| `danger` | `#B3261E` | Erro, ação destrutiva, SLA estourado |
| `info` | `#3A6DA3` | Informativo (= `primary-500`) |

Cada semântica tem par de fundo: `-bg` = mesma matiz a ~95% de luminosidade.

### Regras de cor

- Contraste mínimo **4.5:1** para texto, **3:1** para ícone/borda funcional (WCAG AA).
- Cor nunca é o único portador de informação: status sempre tem **cor + rótulo** (ou ícone).
- Máximo 3 cores não-neutras por tela.
- Gradiente: apenas monocromático e sutil (dois tons vizinhos da mesma família, ≤ 8% de diferença). Gradiente multicolorido é proibido.
- Sombra é neutra e discreta — nunca colorida:
  - `shadow-sm`: `0 1px 2px rgba(26,25,23,0.06)`
  - `shadow-md`: `0 4px 12px rgba(26,25,23,0.08)`
  - `shadow-lg`: `0 12px 32px rgba(26,25,23,0.12)` (só em modal/popover)
- Tema escuro inverte a escala neutra (`neutral-900` como fundo, `neutral-50` como texto) e usa `primary-400`/`accent-300` para manter contraste. Defina todo token no `:root` claro e apenas redefina no bloco escuro.

### Declaração (Tailwind 4)

Tokens vivem em `src/app/globals.css` dentro de `@theme`:

```css
@theme {
  --color-primary-600: #275685;
  --color-neutral-200: #E7E5E1;
  --color-accent-500: #E08A2B;
  --spacing: 0.5rem; /* base do grid de 8px */
  --radius-md: 6px;
}
```

---

## 4. Padrões de componente

**Raio de borda** — `4px` (badge, input pequeno), `6px` (padrão: botão, input, select),
`10px` (card, modal), `999px` (só em avatar e badge de contagem). Nunca `2xl`/`3xl` em card.

**Bordas** — 1px `neutral-200`. Card se define por borda + `shadow-sm`, não por sombra pesada.

### Botão

| Variante | Fundo | Texto | Borda |
|---|---|---|---|
| Primário | `primary-600` | `neutral-0` | — |
| Secundário | `neutral-0` | `neutral-800` | 1px `neutral-300` |
| Sutil (ghost) | transparente | `neutral-600` | — |
| Destrutivo | `danger` | `neutral-0` | — |

- Alturas: `sm` 32px, `md` 40px (padrão), `lg` 48px. Padding horizontal: 16px (`md`).
- Hover: escurece um passo. Active: dois passos + sem deslocamento.
- Foco: `outline: 2px solid primary-500; outline-offset: 2px`. **Nunca** remover o foco visível.
- Desativado: `neutral-200` de fundo, `neutral-400` de texto, `cursor: not-allowed`.
- Carregando: spinner substitui o ícone, largura do botão **não muda**, texto permanece.
- Máximo **um** botão primário por tela ou por diálogo.

### Input / campo de formulário

- Altura 40px, padding 12px, borda 1px `neutral-300`, raio 6px, texto `text-base`.
- Label sempre visível acima do campo (`text-sm`, peso 500, `neutral-800`), gap 8px. Placeholder não substitui label.
- Texto de ajuda: `text-xs`, `neutral-600`, 4px abaixo.
- Erro: borda `danger`, mensagem `text-xs` em `danger` abaixo do campo, e `aria-invalid` + `aria-describedby`.
- Foco igual ao do botão.

### Card

- Fundo `neutral-0`, borda 1px `neutral-200`, raio 10px, padding 24px, `shadow-sm`.
- Título em `text-h3`, corpo em `text-sm`/`text-base`, gap interno 16px.
- Card não é clicável inteiro sem indicar afetação: use hover de borda (`neutral-300`) e um alvo focável real.

### Badge de status (fila de atendimento)

- Altura 20px, padding 4px/8px, raio 4px, `text-xs` peso 500.
- Fundo = semântica `-bg`, texto = semântica. Sempre com rótulo textual.

### Tabela / lista de conversas

- Altura de linha 48px, padding horizontal 16px, divisor 1px `neutral-200`.
- Cabeçalho: `text-xs` MAIÚSCULAS, `neutral-600`, fundo `neutral-50`, fixo no scroll.
- Alinhe números e horários à direita, em Geist Mono, tabular-nums.
- Hover de linha: `neutral-50`. Linha selecionada: `primary-50` + barra de 2px `primary-600` à esquerda.
- Estado vazio: título `text-h3`, uma frase explicando e **uma** ação. Sem ilustração decorativa.

### Modal / diálogo

- Largura máx. 560px, raio 10px, padding 24px, `shadow-lg`, overlay `rgba(26,25,23,0.4)`.
- Foco preso dentro do diálogo, `Esc` fecha, foco retorna ao gatilho ao fechar.
- Ações no rodapé, alinhadas à direita, gap 8px, primária por último.

### Movimento (framer-motion)

- Durações: 120ms (micro: hover, cor), 180ms (padrão: entrada de elemento), 240ms (modal/painel). Nada acima de 300ms.
- Easing: `[0.2, 0, 0, 1]` para entrada, `[0.4, 0, 1, 1]` para saída.
- Anime apenas `opacity` e `transform`. Deslocamento de entrada: 4–8px, nunca mais.
- Nada anima em loop, nada pulsa, nada faz "bounce".
- Respeite `prefers-reduced-motion: reduce` — desligue transições, mantenha a mudança de estado.

### Acessibilidade (não negociável)

- Alvo de toque mínimo 40×40px.
- Todo controle alcançável e operável por teclado, em ordem lógica.
- Ícone sem texto exige `aria-label`.
- Um `<h1>` por página; níveis de heading não pulam.

---

## 5. Evite a estética genérica de IA

Interface gerada por IA tem um "sotaque" reconhecível. Ele é proibido aqui. Concretamente:

**Cor e superfície**
- Sem gradiente roxo→azul (`#6366F1`→`#A855F7`) em fundo, botão, borda ou texto.
- Sem glassmorphism (`backdrop-blur` + fundo translúcido) usado como decoração.
- Sem "glow", neon, brilho colorido ou sombra colorida.
- Sem fundo escuro com acento neon quando o produto não pediu tema escuro.
- Sem gradiente aplicado a texto de título.

**Forma e layout**
- Sem `border-radius` gigante (16px+) em tudo, e sem sombra grande e difusa em cada card.
- Sem grade de três cards idênticos com ícone-círculo em cima só para preencher a página.
- Sem tudo centralizado: texto corrido e formulários alinham à esquerda.
- Sem "hero" de 100vh quando a tela é uma ferramenta de trabalho.

**Conteúdo e ícone**
- Sem ícone de ✨/🚀/🎯 e sem emoji no lugar de ícone. Use um conjunto de ícones consistente, com traço de 1.5px.
- Sem texto de preenchimento vago: "Experiência perfeita", "Poderoso e intuitivo", "Revolucione seu atendimento". Escreva o que a coisa faz.
- Sem menção a "IA" na interface a menos que o usuário esteja de fato interagindo com um recurso de IA.
- Sem microcopy exclamativo e efusivo. Tom: direto, curto, específico. "3 conversas aguardando" e não "Uau! Você tem novidades! 🎉".

**Comportamento**
- Sem fade-in escalonado em cada elemento ao carregar a página.
- Sem parallax, sem contador animado, sem partícula de fundo.
- Skeleton só onde o carregamento passa de ~300ms — e com a forma real do conteúdo.

**O teste**: se o componente pareceria idêntico em qualquer outro app SaaS genérico,
ele está errado. A interface deve parecer uma ferramenta que alguém usa oito horas por
dia — densa, legível, sem enfeite —, não um material de divulgação.

---

## 6. Checklist antes de entregar UI

1. Todo espaçamento é múltiplo de 8 (ou 4 nos casos permitidos)?
2. No máximo três tamanhos de texto e três cores não-neutras na tela?
3. Todas as cores vêm de tokens, sem hex solto?
4. Contraste AA verificado no texto menor e nos estados desativados?
5. Foco visível em todos os controles, navegação por teclado funcionando?
6. Estados cobertos: vazio, carregando, erro, densidade máxima de dados?
7. Nenhum item da seção 5 presente?
