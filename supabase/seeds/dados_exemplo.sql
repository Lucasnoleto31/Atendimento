-- =============================================================================
-- Dados de exemplo — SOMENTE DESENVOLVIMENTO
-- =============================================================================
-- Cole no SQL Editor para ver as telas com conteúdo. Para limpar depois, use o
-- bloco do fim do arquivo.
--
-- Os leads são inseridos DEPOIS dos clientes de propósito: assim o gatilho
-- vincular_cliente_por_telefone casa telefone com telefone e você vê o selo de
-- cliente aparecer sozinho.
-- =============================================================================

-- Produtos ---------------------------------------------------------------
insert into products (codigo, nome, valor_comissao_centavos, recorrencia) values
  ('CT-PJ',  'Conta PJ',        1500, 'recorrente'),
  ('CT-PF',  'Conta PF',        1000, 'unica'),
  ('CMB-01', 'Câmbio',          2500, 'por_operacao'),
  ('SEG-01', 'Seguro empresarial', 3000, 'recorrente')
on conflict (codigo) do nothing;

-- Tags e mensagens padrão ------------------------------------------------
insert into tags (nome) values
  ('Quer proposta'), ('Sem interesse'), ('Retornar depois'),
  ('Documentação pendente'), ('Cliente antigo')
on conflict (nome) do nothing;

insert into quick_replies (titulo, corpo) values
  ('Primeiro contato',
   'Olá! Aqui é da Zeve. Vi que você demonstrou interesse em abrir conta com a gente. Posso te explicar como funciona?'),
  ('Retomada',
   'Oi! Passando para saber se você ainda tem interesse. Consigo agilizar a abertura hoje.'),
  ('Documentos',
   'Para seguir, preciso de: contrato social, documento do sócio e comprovante de endereço.');

-- Instâncias de WhatsApp -------------------------------------------------
insert into whatsapp_instances (nome, telefone_e164, ativa) values
  ('Mesa 01', '5511990000001', true),
  ('Mesa 02', '5511990000002', true)
on conflict (telefone_e164) do nothing;

-- Base de clientes -------------------------------------------------------
insert into customers (nome_completo, telefone_e164, conta_aberta_em) values
  ('Marina Alves de Souza',   '5511988421170', '2023-03-14'),
  ('Comercial Ravena Ltda',   '5511977310022', '2021-08-02'),
  ('Pedro Henrique Barros',   '5511966554433', '2024-11-20'),
  ('Distribuidora Ipê ME',    '5511955221144', '2022-05-09'),
  ('Juliana Costa Ferreira',  '5511944778899', '2025-01-30')
on conflict (telefone_e164) do nothing;

-- Lotes: Marina caindo forte, Ravena estável, Ipê parada há meses --------
insert into customer_lots (customer_id, referencia_data, quantidade)
select
  c.id,
  dias.d::date,
  case
    -- Marina: 12/dia até 30 dias atrás, 7/dia depois (queda de ~42%)
    when c.telefone_e164 = '5511988421170'
      then case when dias.d > current_date - interval '30 days' then 7 else 12 end
    -- Ravena: estável
    when c.telefone_e164 = '5511977310022' then 20
    -- Pedro: abriu conta e nunca girou
    when c.telefone_e164 = '5511966554433' then 0
    -- Ipê: girava e parou há 40 dias
    when c.telefone_e164 = '5511955221144'
      then case when dias.d > current_date - interval '40 days' then 0 else 15 end
    -- Juliana: girando pouco, mas girando
    else 3
  end
from customers c
cross join generate_series(
  current_date - interval '55 days',
  current_date - interval '1 day',
  interval '1 day'
) as dias(d)
on conflict do nothing;

-- Leads ------------------------------------------------------------------
-- Alguns telefones batem com a base de clientes (o gatilho vincula sozinho),
-- outros não — são os "não clientes".
insert into leads (
  nome, telefone_e164, channel_id, campanha, stage_id, status,
  responsavel_id, entrada_motivo, primeira_resposta_em, ultima_interacao_em
)
select
  v.nome,
  v.telefone,
  (select id from channels where slug = v.canal),
  v.campanha,
  (select id from pipeline_stages where nome = v.etapa),
  v.status::lead_status,
  (select id from profiles where papel = 'admin' order by criado_em limit 1),
  v.motivo::lead_entry_reason,
  case when v.respondeu then now() - interval '2 days' else null end,
  now() - (v.dias_parado || ' days')::interval
from (values
  ('Marina Alves de Souza', '5511988421170', 'meta_ads',    'conta-pj-abril',  'Em negociação',        'em_atendimento', 'queda_lotes',  true,  1),
  ('Comercial Ravena Ltda', '5511977310022', 'indicacao',   null,              'Conta aberta',         'ganho',          'manual',       true,  9),
  ('Pedro Henrique Barros', '5511966554433', 'site',        null,              'Em contato',           'em_atendimento', 'sem_giro',     true,  3),
  ('Distribuidora Ipê ME',  '5511955221144', 'lista_interna', null,            'Novos',                'novo',           'sem_giro',     false, 0),
  ('Juliana Costa Ferreira','5511944778899', 'meta_ads',    'reativacao-julho','Aguardando documentos','em_atendimento', 'manual',       true,  2),
  ('Bruno Tavares',         '5511933221100', 'meta_ads',    'conta-pj-abril',  'Novos',                'novo',           'webhook_meta', false, 0),
  ('Helena Prado',          '5511922110099', 'indicacao',   null,              'Novos',                'novo',           'manual',       false, 0),
  ('Igor Menezes',          '5511911009988', 'site',        null,              'Em contato',           'em_atendimento', 'formulario',   true,  4),
  ('Larissa Fontes',        '5511900998877', 'google_ads',  'conta-pf-agosto', 'Em contato',           'sem_resposta',   'formulario',   false, 6),
  ('Rodrigo Salles',        '5511899887766', 'organico',    null,              'Em negociação',        'em_atendimento', 'manual',       true,  1),
  ('Tatiane Moraes',        '5511888776655', 'meta_ads',    'reativacao-julho','Perdido',              'perdido',        'manual',       true, 15),
  ('Vinícius Camargo',      '5511877665544', 'google_ads',  'conta-pf-agosto', 'Novos',                'novo',           'webhook_meta', false, 0)
) as v(nome, telefone, canal, campanha, etapa, status, motivo, respondeu, dias_parado)
on conflict (telefone_e164) do nothing;

-- Vendas registradas -----------------------------------------------------
insert into sales (lead_id, customer_id, product_id, vendedor_id, valor_comissao_centavos, ocorreu_em)
select
  l.id,
  l.customer_id,
  p.id,
  (select id from profiles where papel = 'admin' order by criado_em limit 1),
  p.valor_comissao_centavos,
  now() - interval '6 days'
from leads l
join products p on p.codigo = 'CT-PJ'
where l.telefone_e164 = '5511977310022';

-- Gasto por canal --------------------------------------------------------
insert into channel_spend (channel_id, campanha, referencia_data, valor_centavos)
select c.id, v.campanha, current_date - interval '7 days', v.valor
from (values
  ('meta_ads',   'conta-pj-abril',   250000),
  ('meta_ads',   'reativacao-julho', 120000),
  ('google_ads', 'conta-pf-agosto',  180000)
) as v(slug, campanha, valor)
join channels c on c.slug = v.slug
on conflict (channel_id, campanha, referencia_data) do nothing;

-- =============================================================================
-- Para limpar os dados de exemplo:
-- =============================================================================
-- delete from sales;
-- delete from lead_interactions;
-- delete from lead_tags;
-- delete from leads;
-- delete from customer_lots;
-- delete from customers;
-- delete from channel_spend;
-- delete from quick_replies;
-- delete from tags;
-- delete from products;
-- delete from whatsapp_instances;
