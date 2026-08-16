-- =============================================================================
-- Cor nas etiquetas
-- =============================================================================
-- A etiqueta ganha cor para ser reconhecida de relance na lista de conversas
-- (faixa lateral) e no kanban. A paleta é fechada nos tokens do design system
-- — nada de hex livre — e o nome continua sempre visível ao lado da cor.
--
-- Script reexecutável.
-- =============================================================================

alter table tags
  add column if not exists cor text not null default 'neutro'
    check (cor in ('azul', 'ambar', 'verde', 'vermelho', 'neutro'));

comment on column tags.cor is
  'Token da paleta do design system; a UI resolve para as classes de cor.';

-- Etiquetas que já existem ganham cores distintas, em rodízio, para nascerem
-- distinguíveis sem ninguém precisar editar uma a uma.
with numeradas as (
  select id, row_number() over (order by criado_em, nome) - 1 as pos
  from tags
  where cor = 'neutro'
)
update tags t
set cor = (array['azul', 'ambar', 'verde', 'vermelho'])[(n.pos % 4) + 1]
from numeradas n
where n.id = t.id;
