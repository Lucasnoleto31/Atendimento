-- =============================================================================
-- 0070 (PROPOSTA, NÃO APLICADA): o banco acompanha o código só-chat
-- =============================================================================
-- Mora em supabase/propostas/ de propósito: fora de migrations/, ninguém cola
-- isto na ordem alfabética sem querer. Só faz sentido DEPOIS que o código
-- só-chat estiver no ar e conferido — a ordem está no README.md desta pasta.
--
-- O código só-chat roda no schema de hoje, com os gatilhos de CRM vivos: eles
-- seguem gravando etapa, status e mudanca_etapa por baixo e a tela não olha.
-- Funciona, mas cada mensagem ainda paga o funil. Aqui sai esse peso, sem
-- apagar tabela, coluna nem função:
--
--   1.  [importante] gatilhos de CRM no caminho de cada mensagem
--   1c. [opcional]   gatilhos da carteira (ressalva de permissão)
--   2.  [importante] dois índices que o chat pede (recibo e última mensagem)
--   3.  [opcional]   perdido vira resolvido nos dados + view enxuta da Caixa
--   4.  [importante] RLS das tabelas filhas do lead sem função por linha
--   5.  [importante] fecha funções SECURITY DEFINER de CRM abertas a quem
--                    está logado
--   5b. [opcional]   prévia das conversas respeitando o RLS
--   6.  [importante] expurgo de webhook_events processados
--   6b. [opcional]   o mesmo expurgo todo dia pelo pg_cron
--
-- COMO APLICAR: uma seção por vez no SQL Editor, cada uma num "Run" próprio.
-- O SQL Editor roda o texto colado como uma transação só (0044:63-65), e os
-- locks de uma seção ficam presos até ela terminar: colar a 1 (DROP TRIGGER
-- pede lock exclusivo) junto com a 2 (índice sem CONCURRENTLY) deixaria
-- lead_interactions trancada até para leitura durante a construção do índice.
--
-- Cada seção que mexe em tabela abre com lock_timeout de 5 s: se uma consulta
-- longa estiver segurando a tabela, a seção desiste em vez de enfileirar o
-- chat inteiro atrás dela. Desistiu? Rode a mesma seção de novo.
--
-- Desfazer é recriar gatilho, índice, policy ou grant: o bloco "Desfazer" no
-- fim de cada seção traz o texto pronto.
--
-- Script reexecutável, seção por seção.
-- =============================================================================


-- =============================================================================
-- 1. Gatilhos de CRM no caminho de cada mensagem                  [importante]
-- =============================================================================
-- Saem só os GATILHOS; as funções ficam no banco. Desfazer vira uma linha por
-- gatilho, sem recopiar corpo de função.
--
-- Depois desta seção a fila de leads (regra 5 do README de migrations) é só:
--
--   · t01 (leads_t01_carimbar_perda, 0063) FICA. O código só-chat ainda TIRA
--     lead de 'perdido' (mensagem nova pelo webhook, reabrir no chat), e é o
--     t01 que limpa perda_motivo, perda_detalhe e perdido_em nessa saída. Sem
--     ele o lead voltaria à Caixa com a perda antiga gravada. Não lê tabela
--     nenhuma: só atribui colunas da própria linha.
--   · t08 (leads_t08_atualizado_em) FICA: carimbo de manutenção, sem leitura.
--
-- Pré-requisito: nenhum código no ar lê stage_id, primeiro_contato_em,
-- cliente_confirmado_em nem linhas 'mudanca_etapa'. Antes do deploy só-chat,
-- kanban, /hoje e SLA dependiam destes gatilhos.
--
-- Efeito colateral na permissão (só papel assessor, valor 'vendedor'): sem o
-- t02, contato novo não ganha mais customer_id, e o ramo de carteira da policy
-- de leads (0068:37) deixa de valer para ele. O assessor passa a ver o contato
-- novo só se for dele ou sem dono — como qualquer conversa.

set local lock_timeout = '5s';

-- 1a. lead_interactions: dois gatilhos AFTER INSERT, um por linha.
--   · interacoes_lead_respondeu (0040:89-92): a cada mensagem RECEBIDA faz
--     dois SELECT em pipeline_stages + pipelines e um UPDATE em leads
--     (consultando v_customer_giro). Na primeira mensagem recebida de cada
--     lead esse UPDATE muda a etapa: roda a fila inteira de gatilhos de leads
--     e o t07 grava uma linha 'mudanca_etapa' que atravessa o Realtime à toa.
--   · interacoes_primeiro_contato (0069:42-45): a cada mensagem ENVIADA tenta
--     um UPDATE em leads (primeiro_contato_em, só o SLA lia), com o RLS de
--     quem envia.
drop trigger if exists interacoes_lead_respondeu   on lead_interactions;
drop trigger if exists interacoes_primeiro_contato on lead_interactions;

-- 1b. leads: t02 a t07 (0043:45-74). O chat faz UPDATE em leads a cada
--     mensagem, envio, leitura e atribuição, e cada UPDATE passa por t01,
--     t05, t06, t07 e t08; depois desta seção, só t01 e t08.
--   · t02 (vínculo por telefone) roda também no INSERT: todo contato novo do
--     webhook procura o cliente em customers pelas duas grafias do celular.
--   · t03 (vínculo por CPF/CNPJ lido na conversa) e t04 (lead de cliente
--     herda o telefone da ficha): vínculo com a base da corretora.
--   · t05 (vira 'ganho' e grava nota quando ganha cliente), t06 (espelho do
--     kanban) e t07 (registra mudança de etapa e reinicia o relógio da coluna).
drop trigger if exists leads_t02_vincular_telefone  on leads;
drop trigger if exists leads_t03_vincular_documento on leads;
drop trigger if exists leads_t04_completa_telefone  on leads;
drop trigger if exists leads_t05_marcar_ganho       on leads;
drop trigger if exists leads_t06_espelha_etapa      on leads;
drop trigger if exists leads_t07_stage_change       on leads;

-- Desfazer 1 (mesmo texto da 0040, 0069 e 0043; as funções continuam lá):
--
--   create trigger interacoes_lead_respondeu
--     after insert on lead_interactions
--     for each row execute function lead_respondeu_avanca();
--   create trigger interacoes_primeiro_contato
--     after insert on lead_interactions
--     for each row execute function leads_carimbar_primeiro_contato();
--   create trigger leads_t02_vincular_telefone
--     before insert or update of telefone_e164 on leads
--     for each row execute function vincular_cliente_por_telefone();
--   create trigger leads_t03_vincular_documento
--     before insert or update of documento on leads
--     for each row execute function vincular_cliente_por_documento();
--   create trigger leads_t04_completa_telefone
--     before insert or update of customer_id on leads
--     for each row execute function completar_telefone_do_lead();
--   create trigger leads_t05_marcar_ganho
--     before update on leads
--     for each row execute function marcar_lead_ganho();
--   create trigger leads_t06_espelha_etapa
--     before update on leads
--     for each row execute function lead_ganho_espelha_etapa();
--   create trigger leads_t07_stage_change
--     before update on leads
--     for each row execute function handle_stage_change();
--
-- O que aconteceu com os gatilhos desligados não volta sozinho. Para pôr em
-- dia: o acerto de estoque da 0069:47-56 (primeiro_contato_em) e o da
-- 0026:97-99 (vínculo cliente-lead por telefone).


-- =============================================================================
-- 1c. Gatilhos da carteira                                           [opcional]
-- =============================================================================
-- Cole SEPARADO da seção 1. Não dá velocidade ao chat:
-- customers_vincular_leads e customer_lots_saem_do_funil só disparam quando
-- customers ou customer_lots são gravados (importação da base e de lotes), e
-- o código só-chat não grava mais lá. leads_sincroniza_dono_carteira dispara
-- na atribuição de conversa e sai cedo quando o lead não tem cliente. O ganho
-- é desacoplar: nenhuma escrita do chat encosta mais em customers.
--
-- POR QUE É OPCIONAL: a policy de leads ainda tem o ramo de carteira
-- (0068:37) — o assessor enxerga lead de outro dono quando o cliente
-- vinculado é da carteira dele (customers.responsavel_id). Hoje
-- leads_sincroniza_dono_carteira (0031:58-62) faz esse dono acompanhar o
-- atendente do lead. Sem o gatilho, o dono congela no valor do dia: o
-- assessor A passa a conversa de um cliente "dele" para B e continua vendo a
-- conversa pela carteira. Só afeta o papel assessor e só lead com
-- customer_id. Vale decidir junto com o ramo de carteira (README): se ele
-- sair da policy, este gatilho perde a função e sai sem efeito nenhum.

set local lock_timeout = '5s';

drop trigger if exists leads_sincroniza_dono_carteira on leads;
drop trigger if exists customers_vincular_leads        on customers;
drop trigger if exists customer_lots_saem_do_funil     on customer_lots;

-- Desfazer 1c (texto da 0031, 0026 e 0040):
--
--   create trigger leads_sincroniza_dono_carteira
--     after insert or update of responsavel_id, customer_id on leads
--     for each row execute function sincronizar_dono_carteira();
--   create trigger customers_vincular_leads
--     after insert or update of telefone_e164 on customers
--     for each row execute function vincular_leads_por_telefone_cliente();
--   create trigger customer_lots_saem_do_funil
--     after insert on customer_lots
--     referencing new table as lotes_novos
--     for each statement execute function lotes_tiram_do_funil();


-- =============================================================================
-- 2. Índices do chat                                              [importante]
-- =============================================================================
-- FORA DO EXPEDIENTE. No SQL Editor não há CONCURRENTLY (tudo roda numa
-- transação, 0044:63-65): CREATE INDEX comum segura INSERT e UPDATE em
-- lead_interactions até terminar. Enquanto constrói, a mensagem recebida
-- espera (o webhook demora a responder à Meta) e o envio pelo chat fica
-- pendurado. Com a tabela de hoje deve levar segundos; não medi.
--
-- Com psql ou supabase CLI dá para usar
--   create index concurrently if not exists ...
-- uma instrução por vez, fora de transação, sem travar escrita. Se uma
-- construção CONCURRENTLY falhar no meio, o índice fica INVÁLIDO: conferir
-- com a consulta do README e, se for o caso, drop index e rodar de novo.

set local lock_timeout = '5s';

-- 2a. Recibo da Meta (sent, delivered, read, failed). O webhook procura a
--     mensagem por metadados->>'message_id' (api/webhooks/meta/route.ts,
--     bloco dos recibos) e nenhuma migration indexa essa expressão: cada
--     recibo varre lead_interactions inteira, e são até três recibos por
--     mensagem enviada. A expressão é a mesma que o PostgREST gera para
--     .eq("metadados->>message_id", id).
--     Parcial em "is not null": o "=" da consulta implica o predicado (o
--     operador é estrito), então o planejador usa o índice, que fica só com
--     as linhas que têm wamid — nota, atribuição e afins ficam de fora.
create index if not exists lead_interactions_message_id_idx
  on lead_interactions ((metadados ->> 'message_id'))
  where (metadados ->> 'message_id') is not null;

-- 2b. Última mensagem de cada conversa. A Caixa (LATERAL ult e rec de
--     v_leads_listas, 0062:217-232) e a prévia (previas_conversas,
--     0045:33-37) pedem só recebida e enviada, mas o índice que existe
--     (lead_id, criado_em desc, 0001:283) tem tudo: nota, atribuição e
--     mudanca_etapa (64% dos inserts, pelo comentário de
--     conversas/tempo-real.tsx) são lidas e descartadas uma a uma, e quem
--     nunca respondeu tem o histórico inteiro lido pelo LATERAL rec.
--     O predicado tem o mesmo texto das consultas; tipo = 'mensagem_recebida'
--     também cai nele (um valor da lista implica a lista).
create index if not exists lead_interactions_msgs_idx
  on lead_interactions (lead_id, criado_em desc)
  where tipo in ('mensagem_recebida', 'mensagem_enviada');

-- 2c. [opcional, só junto com uma mudança no webhook — NÃO roda aqui]
--     Envio com vários anexos guarda os wamids em metadados.message_ids, e o
--     recibo que não acha por message_id tenta
--     .contains("metadados", { message_ids: [...] }): outra varredura
--     inteira. Acontece do 2º anexo em diante e em todo recibo de mensagem
--     que não está no sistema. GIN no metadados inteiro pesaria em todo
--     insert e em todo recibo; o enxuto é indexar só a lista
--
--       create index if not exists lead_interactions_message_ids_idx
--         on lead_interactions using gin ((metadados -> 'message_ids') jsonb_path_ops);
--
--     e o webhook perguntar pela mesma expressão
--     (metadados -> 'message_ids' @> '["wamid..."]'), não pelo metadados
--     inteiro — sem essa troca o índice não é usado.

-- Desfazer 2:
--
--   drop index if exists lead_interactions_message_id_idx;
--   drop index if exists lead_interactions_msgs_idx;


-- =============================================================================
-- 3. Perdido vira resolvido nos dados                                [opcional]
-- =============================================================================
-- O código só-chat MOSTRA lead 'perdido' como conversa resolvida (fica em
-- Resolvidas, fora da Caixa) lendo o status — é a última leitura de status
-- que sobrou na tela. Com o resolvido gravado no próprio lead, a regra passa
-- a morar num lugar só (chat_resolvido_em) e a Caixa pode largar o status.
--
-- Fica coerente daqui em diante porque, depois do deploy só-chat, ninguém
-- MARCA perdido: o webhook e o "reabrir" do chat só TIRAM de perdido (status
-- vira 'em_atendimento' no mesmo update que zera chat_resolvido_em). Feito o
-- acerto uma vez, todo lead perdido está resolvido e continua.
--
-- Ordem: 3a e 3b juntos, e só DEPOIS o código troca a Caixa para a view nova
-- — sem o acerto, perdido sem resolvido apareceria na Caixa.

set local lock_timeout = '5s';

-- 3a. Acerto do estoque. Só onde ainda não há resolvido: não reescreve quem
--     já foi resolvido à mão, e rodar de novo não muda nada. Todo perdido tem
--     perdido_em desde a 0063 (o t01 carimba no insert e no update, e o
--     acerto de lá cobriu os antigos); o now() é só rede.
update leads
set chat_resolvido_em = coalesce(chat_resolvido_em, perdido_em, now())
where status = 'perdido'
  and chat_resolvido_em is null;

-- 3b. v_caixa_conversas: a Caixa sem o funil.
--     A v_leads_listas (0062) monta, para CADA lead visível, quatro junções
--     de CRM (v_customer_giro, que lê mv_customer_giro; customers; channels;
--     pipeline_stages) e o LATERAL disp do disparo em massa, que lê o
--     histórico inteiro de quem nunca recebeu disparo. A Caixa consulta a
--     view cinco vezes por carga (duas listas e três contagens) e não pede
--     nenhuma dessas colunas, mas LEFT JOIN LATERAL com LIMIT não é removível
--     pelo planejador: paga-se sempre.
--
--     View NOVA em vez de mexer na v_leads_listas: "create or replace view"
--     não tira coluna, e drop + create derrubaria quem ainda lê a velha
--     (quadro_equipe e resumo_do_dia a citam pelo nome). As duas convivem até
--     o corte definitivo.
--
--     Colunas: os nomes que a Caixa já pede (CAMPOS_VIEW em
--     src/app/(app)/conversas/lista.ts), MENOS status, mais em_aberto e
--     etiqueta_ids, que ela filtra, com as expressões copiadas da 0062
--     tirando só "status <> 'perdido'" — coberto pelo 3a. E as colunas de
--     leads que a Caixa hoje busca numa segunda consulta (CAMPOS_EXTRAS, no
--     mesmo arquivo: instagram_id, instagram_usuario, chat_lido_em,
--     chat_adiado_em, chat_adiado_ate, chat_resolvido_em) e o criado_em:
--     lidas daqui, essa ida ao banco some. O instagram_id é o que diz à fila
--     que o contato veio pelo Direct.
--
--     A view NÃO tem status. Na troca de fonte, status sai do CAMPOS_VIEW e
--     o "resolvida" de cada linha (carregarListaConversas, no mesmo arquivo)
--     passa a ler só chat_resolvido_em, porque o 3a já converteu todo
--     perdido em resolvido. Trocar só o nome da view faz o PostgREST recusar
--     a consulta (column v_caixa_conversas.status does not exist) e a Caixa
--     fica vazia.
--
--     security_invoker no próprio create: "create or replace view" troca as
--     opções da view pelas do comando, e sem ela a view rodaria como dona do
--     banco, sem RLS.
create or replace view v_caixa_conversas
with (security_invoker = true)
as
select
  l.id as lead_id,
  l.nome,
  l.telefone_e164,
  l.customer_id,
  l.instagram_id,
  l.instagram_usuario,
  l.responsavel_id,
  p.nome as responsavel_nome,
  l.criado_em,
  l.ultima_interacao_em,
  l.chat_lido_em,
  l.chat_adiado_em,
  l.chat_adiado_ate,
  l.chat_resolvido_em,

  -- Conversa viva: não resolvida e não adiada AINDA NO PRAZO. Adiamento com
  -- hora marcada usa chat_adiado_ate (0042); o que foi adiado antes dela,
  -- sem prazo gravado, volta em 3 dias.
  (
    l.chat_resolvido_em is null
    and not (
      l.chat_adiado_em is not null
      and (
        (l.chat_adiado_ate is not null and l.chat_adiado_ate > now())
        or (l.chat_adiado_ate is null
            and l.chat_adiado_em >= now() - interval '3 days')
      )
    )
  ) as em_aberto,

  -- Quem falou por último e quando o cliente falou pela última vez.
  ult.tipo as ultimo_tipo,
  ult.criado_em as ultima_mensagem_em,
  rec.criado_em as ultima_recebida_em,

  -- AGUARDANDO NÓS: o cliente mandou a última mensagem e ninguém voltou.
  -- Mesma regra de prazo do em_aberto.
  (
    ult.tipo = 'mensagem_recebida'
    and l.chat_resolvido_em is null
    and not (
      l.chat_adiado_em is not null
      and (
        (l.chat_adiado_ate is not null and l.chat_adiado_ate > now())
        or (l.chat_adiado_ate is null
            and l.chat_adiado_em >= now() - interval '3 days')
      )
    )
  ) as aguardando_resposta,

  -- Horas que o cliente está esperando (null quando não está esperando).
  case
    when ult.tipo = 'mensagem_recebida'
      then extract(epoch from (now() - ult.criado_em)) / 3600
  end as horas_esperando,

  -- JANELA DE 24h: dá para mandar mensagem livre agora (sem template).
  (rec.criado_em is not null and rec.criado_em > now() - interval '24 hours')
    as janela_aberta,

  (l.responsavel_id is null) as sem_dono,

  -- Adiada com o prazo vencido e sem resposta do cliente depois do
  -- adiamento: volta para a Caixa.
  (
    l.chat_adiado_em is not null
    and l.chat_resolvido_em is null
    and not (
      l.chat_adiado_em is not null
      and (
        (l.chat_adiado_ate is not null and l.chat_adiado_ate > now())
        or (l.chat_adiado_ate is null
            and l.chat_adiado_em >= now() - interval '3 days')
      )
    )
    and (rec.criado_em is null or rec.criado_em < l.chat_adiado_em)
  ) as adiado_vencido,

  -- Etiquetas em array: o filtro da Caixa é um `contains`, numa consulta só.
  coalesce(et.ids, '{}'::uuid[]) as etiqueta_ids,
  coalesce(et.nomes, '{}'::text[]) as etiquetas

from leads l
left join profiles p on p.id = l.responsavel_id
left join lateral (
  select i.tipo, i.criado_em
  from lead_interactions i
  where i.lead_id = l.id
    and i.tipo in ('mensagem_recebida', 'mensagem_enviada')
  order by i.criado_em desc
  limit 1
) ult on true
left join lateral (
  select i.criado_em
  from lead_interactions i
  where i.lead_id = l.id
    and i.tipo = 'mensagem_recebida'
  order by i.criado_em desc
  limit 1
) rec on true
left join lateral (
  select array_agg(t.id order by t.nome)   as ids,
         array_agg(t.nome order by t.nome) as nomes
  from lead_tags lt
  join tags t on t.id = lt.tag_id
  where lt.lead_id = l.id
) et on true;

-- Chave pública sem sessão não tem o que ler aqui (o RLS de leads já
-- devolveria vazio); tirar o grant padrão fecha a porta de vez.
revoke all on v_caixa_conversas from anon;

-- Desfazer 3:
--
--   3b, só com o código de volta na v_leads_listas:
--     drop view if exists v_caixa_conversas;
--   3a, os leads que o acerto resolveu têm chat_resolvido_em = perdido_em:
--     update leads set chat_resolvido_em = null
--     where status = 'perdido' and chat_resolvido_em = perdido_em;


-- =============================================================================
-- 4. RLS das tabelas filhas do lead sem função por linha          [importante]
-- =============================================================================
-- A 0068 embrulhou em (select ...) as chamadas SEM argumento, mas
-- vejo_lead(lead_id) depende da linha: para atendente e assessor, cada linha
-- lida de lead_interactions, lead_tags e scheduled_messages chama uma função
-- SECURITY DEFINER, que o planejador não embute e que por dentro lê leads,
-- lê profiles até duas vezes (ve_tudo e sou_atendente, via meu_papel_texto)
-- e, para assessor, customers (minha_carteira). Abrir uma conversa lê até 200
-- linhas; a Caixa, pelos LATERAL, muitas mais; o Realtime confere uma por
-- evento e por pessoa conectada. Gestor, admin e compliance não pagam: o
-- InitPlan (select ve_tudo()) já decide.
--
-- No lugar: "o lead existe e EU o enxergo", perguntado direto à tabela leads.
-- A subconsulta roda com o RLS de quem lê, então quem decide é a policy
-- leads_por_papel (0068:28-40) — o MESMO predicado que vejo_lead repete por
-- dentro (0067:60-80). A restritiva do segundo fator também vale ali, mas a
-- tabela filha já tem a sua. Mesma permissão, linha por linha; o custo vira
-- uma busca pela chave primária de leads, com os InitPlans do papel
-- calculados uma vez por consulta.
--
-- Por que EXISTS e não "lead_id in (select id from leads)": dentro de um OR
-- o Postgres não transforma IN em junção; vira um SubPlan com hash, que lê
-- TODOS os leads visíveis uma vez por consulta e roda a policy de leads em
-- cada um (para assessor, minha_carteira lead a lead). Em consulta grande
-- isso compensa; nas pequenas, que são as mais frequentes (o Realtime
-- confere uma linha por evento, o insert de cada mensagem confere uma),
-- troca uma busca por chave por uma varredura de leads inteira. O EXISTS
-- correlacionado custa uma busca por chave por linha em qualquer caso.
--
-- Mesmos nomes de policy da 0067/0068; só o texto da regra muda.
-- leads_edita (UPDATE de leads) fica com vejo_lead(id) DE PROPÓSITO: no
-- WITH CHECK, vejo_lead consulta a linha como estava antes do UPDATE (função
-- STABLE enxerga o retrato do início do comando). Uma regra escrita direto
-- na policy olharia a linha nova e recusaria, por exemplo, o atendente
-- passando a conversa para um colega.

set local lock_timeout = '5s';

do $$
declare
  t record;
  regra text;
begin
  for t in
    select * from (values
      ('lead_interactions',  'interacoes_le', 'interacoes_insere'),
      ('lead_tags',          'etiquetas_le',  'etiquetas_escreve'),
      ('scheduled_messages', 'agendadas_le',  'agendadas_escreve')
    ) as v(tabela, pol_le, pol_escreve)
  loop
    regra := format(
      '((select ve_tudo()) or exists (select 1 from leads l where l.id = %I.lead_id))',
      t.tabela);

    execute format('drop policy if exists %I on %I', t.pol_le, t.tabela);
    execute format('create policy %I on %I for select to authenticated using (%s)',
                   t.pol_le, t.tabela, regra);

    execute format('drop policy if exists %I on %I', t.pol_escreve, t.tabela);
    -- lead_interactions é o histórico: a equipe só insere (editar e apagar
    -- são as policies de gestor da 0027, que não mudam).
    if t.tabela = 'lead_interactions' then
      execute format('create policy %I on %I for insert to authenticated with check (%s)',
                     t.pol_escreve, t.tabela, regra);
    else
      execute format('create policy %I on %I for all to authenticated using (%s) with check (%s)',
                     t.pol_escreve, t.tabela, regra, regra);
    end if;
  end loop;
end $$;

-- Desfazer 4 (o mesmo laço com a regra da 0068):
--
--   do $$
--   declare t record; regra text := '((select ve_tudo()) or vejo_lead(lead_id))';
--   begin
--     for t in select * from (values
--       ('lead_interactions',  'interacoes_le', 'interacoes_insere'),
--       ('lead_tags',          'etiquetas_le',  'etiquetas_escreve'),
--       ('scheduled_messages', 'agendadas_le',  'agendadas_escreve')
--     ) as v(tabela, pol_le, pol_escreve) loop
--       execute format('drop policy if exists %I on %I', t.pol_le, t.tabela);
--       execute format('create policy %I on %I for select to authenticated using (%s)',
--                      t.pol_le, t.tabela, regra);
--       execute format('drop policy if exists %I on %I', t.pol_escreve, t.tabela);
--       if t.tabela = 'lead_interactions' then
--         execute format('create policy %I on %I for insert to authenticated with check (%s)',
--                        t.pol_escreve, t.tabela, regra);
--       else
--         execute format('create policy %I on %I for all to authenticated using (%s) with check (%s)',
--                        t.pol_escreve, t.tabela, regra, regra);
--       end if;
--     end loop;
--   end $$;


-- =============================================================================
-- 5. Funções SECURITY DEFINER de CRM abertas a quem está logado   [importante]
-- =============================================================================
-- No Supabase toda função nova em public nasce com EXECUTE para anon e
-- authenticated (privilégio padrão do projeto). As migrations fecharam public
-- e anon, mas estas ficaram com authenticated — e SECURITY DEFINER roda como
-- dona do banco, sem RLS. Qualquer usuário logado chama pelo PostgREST
-- (/rest/v1/rpc/...) com a chave pública do navegador:
--
--   gerar_leads_reativacao()                  grant 0002:91   cria leads, tarefas e eventos
--   atualizar_telefones_leads()               grant 0005:39   reescreve telefone em massa
--   mesclar_leads(uuid, uuid)                 só public/anon 0036:117   move histórico e APAGA um lead
--   atualizar_giro()                          só public/anon 0044:74    refresh sem CONCURRENTLY trava a mv
--   ativacoes_registradas(uuid, timestamptz)  grant 0047:39   conta ativações de qualquer responsável
--   quadro_equipe(timestamptz)                grant 0048:96   tem porteiro por dentro; fecha por higiene
--
-- O código só-chat não chama nenhuma. O código antigo chamava
-- atualizar_telefones_leads e atualizar_giro com service role (que não perde
-- nada aqui) e ativacoes_registradas e quadro_equipe com a sessão do usuário,
-- na /hoje — por isso esta seção só depois do deploy.
--
-- Ficam como estão: as funções de visibilidade (meu_papel, meu_papel_texto,
-- ve_tudo, vejo_lead, minha_carteira, vejo_cliente, exige_2fa), que as
-- policies usam; previas_conversas, que é do chat (5b); e as de CRM que NÃO
-- são definer (relatorio_leads, pagamentos_resumo,
-- registrar_comissoes_ativacao), que rodam com o RLS de quem chama.
-- mesclar_clientes, atualizar_ciclo_vida, atualizar_documentos_leads e
-- resumo_do_dia já foram fechadas nas migrations delas. Função de gatilho
-- não entra: o Postgres recusa chamá-la fora de gatilho.

do $$
declare
  f text;
begin
  foreach f in array array[
    'gerar_leads_reativacao()',
    'atualizar_telefones_leads()',
    'mesclar_leads(uuid, uuid)',
    'atualizar_giro()',
    'ativacoes_registradas(uuid, timestamptz)',
    'quadro_equipe(timestamptz)'
  ] loop
    if to_regprocedure('public.' || f) is not null then
      execute format(
        'revoke execute on function public.%s from public, anon, authenticated', f);
    end if;
  end loop;
end $$;

-- Desfazer 5 (uma linha por função que precisar voltar):
--
--   grant execute on function gerar_leads_reativacao() to authenticated;
--   grant execute on function atualizar_telefones_leads() to authenticated;
--   grant execute on function mesclar_leads(uuid, uuid) to authenticated;
--   grant execute on function atualizar_giro() to authenticated;
--   grant execute on function ativacoes_registradas(uuid, timestamptz) to authenticated;
--   grant execute on function quadro_equipe(timestamptz) to authenticated;


-- =============================================================================
-- 5b. previas_conversas respeitando o RLS                            [opcional]
-- =============================================================================
-- Depois da 2 (e de preferência da 4). Hoje (0045) ela é SECURITY DEFINER:
-- devolve a última mensagem de QUALQUER lead cujo id receba — um atendente
-- que mande ids de leads alheios lê a prévia deles, por fora da regra da
-- 0067. E o "distinct on" lê todas as mensagens dos leads pedidos para ficar
-- com uma de cada.
--
-- Mesma assinatura e mesmo retorno; mudam o corpo e a segurança:
--   · security invoker: lead_interactions passa pelo RLS de quem chama, com
--     uma linha só por lead;
--   · um LATERAL com limit 1 por lead pedido, em cima do índice parcial da
--     2b: uma entrada de índice por conversa.
-- A Caixa só pede prévia de lead que ela mesma listou (e a lista já passa
-- pelo RLS), então a tela não muda. "create or replace" mantém dono e grants
-- (0045:40-41).

create or replace function previas_conversas(p_lead_ids uuid[])
returns table (
  lead_id uuid,
  tipo interaction_type,
  conteudo text,
  criado_em timestamptz
)
language sql
stable
security invoker
set search_path = public
as $$
  select ult.lead_id, ult.tipo, ult.conteudo, ult.criado_em
  from (select distinct unnest(p_lead_ids) as id) as pedido
  cross join lateral (
    select i.lead_id, i.tipo, i.conteudo, i.criado_em
    from lead_interactions i
    where i.lead_id = pedido.id
      and i.tipo in ('mensagem_recebida', 'mensagem_enviada')
    order by i.criado_em desc
    limit 1
  ) as ult
$$;

-- Desfazer 5b: rodar de novo a 0045_chat_rapido.sql inteira.


-- =============================================================================
-- 6. webhook_events: expurgo dos processados                      [importante]
-- =============================================================================
-- Cada evento da Meta e do Instagram guarda o payload bruto (jsonb) para o
-- dedup e para investigação. O expurgo de 30 dias da 0040 (item 4f) rodou uma
-- vez só, e nenhum código apaga: a tabela cresce a cada mensagem e a cada
-- recibo. O dedup só precisa dos eventos recentes (a Meta reenvia em minutos
-- ou horas), e o que deu erro (processado = false) fica para investigar.
--
-- Sem índice de propósito: uma varredura por dia sai mais barato que manter
-- mais um índice a cada evento recebido.

set local lock_timeout = '5s';

delete from webhook_events
where processado
  and recebido_em < now() - interval '30 days';

-- Desfazer 6: não tem. Apaga só payload bruto de evento já processado (a
-- mensagem em si está em lead_interactions); voltar, só por backup.


-- =============================================================================
-- 6b. O mesmo expurgo todo dia, pelo pg_cron                         [opcional]
-- =============================================================================
-- Cole SEPARADO. Só agenda se a extensão pg_cron estiver ligada (Database →
-- Extensions no painel; não conferi se está). Sem ela o bloco só avisa e não
-- faz nada — aí o expurgo fica à mão (seção 6) ou numa rota de cron do app.
-- 06h30 UTC = 03h30 de Brasília. Rodar de novo atualiza o job de mesmo nome,
-- não duplica.

do $$
begin
  if exists (select 1 from pg_extension where extname = 'pg_cron') then
    perform cron.schedule(
      'expurgo-webhook-events',
      '30 6 * * *',
      $job$delete from public.webhook_events where processado and recebido_em < now() - interval '30 days'$job$
    );
  else
    raise notice 'pg_cron não está ligada: o expurgo fica à mão (seção 6) ou numa rota de cron do app.';
  end if;
end $$;

-- Desfazer 6b:
--
--   select cron.unschedule('expurgo-webhook-events');
