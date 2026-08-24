-- =============================================================================
-- Etapas do kanban de Atendimento
-- =============================================================================
-- As etapas semeadas na 0001 vinham de um funil genérico de corretora
-- ("Aguardando documentos", "Em negociação"). A mesa decidiu o funil real:
--
--   Novo → Em Contato → Conta Aberta → Ativação → Perdido
--
-- A mudança que importa é a ATIVAÇÃO virar coluna. Ela é a fila de trabalho do
-- maior gargalo de receita: cliente com conta aberta que ainda não operou. Sem
-- coluna, esse trabalho não tinha onde viver e sumia dentro de "Conta aberta".
--
-- "Em negociação" sai porque, na prática, negociar é atender: os leads voltam
-- para Em Contato em vez de esperar numa coluna própria.
--
-- Conta Aberta deixa de ser is_final — o funil não termina ali, termina quando
-- o cliente opera.
--
-- Script reexecutável: só mexe no kanban padrão e só no que ainda não está no
-- formato novo.
-- =============================================================================

do $$
declare
  p_id uuid;
  s_novo uuid; s_contato uuid; s_conta uuid; s_ativ uuid; s_perdido uuid;
  s_negoc uuid; s_docs uuid;
begin
  select id into p_id from pipelines where padrao limit 1;
  if p_id is null then return; end if;

  select id into s_novo    from pipeline_stages where pipeline_id = p_id and nome in ('Novo','Novos');
  select id into s_contato from pipeline_stages where pipeline_id = p_id and nome in ('Em Contato','Em contato');
  select id into s_conta   from pipeline_stages where pipeline_id = p_id and nome in ('Conta Aberta','Conta aberta');
  select id into s_perdido from pipeline_stages where pipeline_id = p_id and nome = 'Perdido';
  select id into s_negoc   from pipeline_stages where pipeline_id = p_id and nome = 'Em negociação';
  select id into s_docs    from pipeline_stages where pipeline_id = p_id and nome = 'Aguardando documentos';

  -- Leads das colunas que somem voltam para Em Contato: seguem em atendimento.
  if s_negoc is not null and s_contato is not null then
    update leads set stage_id = s_contato, entrou_na_etapa_em = now()
    where stage_id = s_negoc;
  end if;
  if s_docs is not null and s_contato is not null then
    update leads set stage_id = s_contato, entrou_na_etapa_em = now()
    where stage_id = s_docs;
  end if;

  -- Ordem é única por kanban: passa por valores negativos antes de reatribuir.
  update pipeline_stages set ordem = -ordem where pipeline_id = p_id;

  delete from pipeline_stages where id in (s_negoc, s_docs);

  update pipeline_stages set nome = 'Novo',         ordem = 1, is_final = false where id = s_novo;
  update pipeline_stages set nome = 'Em Contato',   ordem = 2, is_final = false where id = s_contato;
  update pipeline_stages set nome = 'Conta Aberta', ordem = 3, is_final = false where id = s_conta;

  select id into s_ativ from pipeline_stages where pipeline_id = p_id and nome = 'Ativação';
  if s_ativ is null then
    insert into pipeline_stages (pipeline_id, nome, ordem, is_final)
    values (p_id, 'Ativação', 4, false)
    returning id into s_ativ;
  else
    update pipeline_stages set ordem = 4, is_final = false where id = s_ativ;
  end if;

  update pipeline_stages set ordem = 5, is_final = true where id = s_perdido;

  -- Quem tem conta aberta e nunca operou pertence à Ativação, não a "Conta
  -- Aberta" — é lá que o roteiro do Profit Pro é trabalhado.
  if s_ativ is not null and s_conta is not null then
    update leads l
    set stage_id = s_ativ, entrou_na_etapa_em = now()
    from v_customer_giro g
    where l.stage_id = s_conta
      and g.customer_id = l.customer_id
      and g.ultimo_giro_em is null;
  end if;
end;
$$;
