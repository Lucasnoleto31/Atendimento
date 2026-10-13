-- =============================================================================
-- 0071 (PROPOSTA, NÃO APLICADA): privacidade entre pessoas da equipe
-- =============================================================================
-- Mora em supabase/propostas/ de propósito: ninguém cola isto na fila de
-- migrations/ sem o Lucas decidir.
--
-- O QUE É. O admin define em Administração quem não vê as conversas de quem
-- ("o grupo Aikon não vê as conversas de Artur e Lucas"). A configuração é
-- uma linha de settings, chave 'privacidade' (jsonb):
--
--   { "grupos": [{ "id": "...", "nome": "Aikon", "membros": [id de profiles] }],
--     "regras": [{ "id": "...", "quem": { "tipo": "pessoa" | "grupo", "id": "..." },
--                  "naoVe": [id de profiles] }] }
--
-- A regra: a pessoa P não vê lead (conversa e contato) cujo responsavel_id
-- esteja na união dos naoVe das regras em que "quem" é P ou um grupo que
-- contém P. Lead sem dono continua visível. Admin vê tudo sempre. Ninguém
-- fica oculto de si mesmo. Sem linha em settings = sem regra.
--
-- O código já aplica essa regra nas telas (src/lib/privacidade.ts, com os
-- testes de mesa em src/lib/privacidade-regra.ts). O banco ainda não sabe
-- dela: quem tem a chave pública do navegador e a própria sessão lê pela
-- API (PostgREST) e recebe pelo tempo real (Realtime) tudo o que o RLS de
-- hoje deixa. Este arquivo põe a MESMA regra no banco.
--
-- O QUE MUDA PARA CADA PAPEL. Só para quem tem regra; sem regra, nada muda.
--   atendente   nada: já só vê as conversas em que é o responsável (0067),
--               e ninguém fica oculto de si. Num grupo com outros papéis, a
--               regra pesa para os outros.
--   assessor    deixa de ver as conversas e os contatos do dono oculto que
--               hoje entram pelo ramo da carteira dele (cliente da carteira
--               dele atendido por outra pessoa).
--   gestor      deixa de ver as conversas, as mensagens, as etiquetas e as
--               agendadas do dono oculto (hoje vê tudo).
--   compliance  idem ao gestor. Cuidado: regra sobre o compliance esconde
--               do compliance.
--   admin       nada: vê tudo sempre, mesmo citado numa regra.
--   settings    a chave 'privacidade' passa a ser gravada só pelo admin. Hoje
--               a gestão grava qualquer chave (policy gestao da 0001), e um
--               gestor com regra conseguia apagar a própria regra pela API.
--
-- O QUE CONTINUA DE FORA (docs/PRIVACIDADE.md tem a lista inteira):
--   · previas_conversas (0045) é SECURITY DEFINER: devolve a última
--     mensagem de qualquer lead cujo id receba. A seção 5b da 0070 a passa
--     a respeitar o RLS; aplique as duas.
--   · campanha_envios segue legível para a equipe (id de lead e situação do
--     envio, sem o texto da conversa).
--   · A própria configuração (settings) segue legível para a equipe.
--   · Caminhos com a chave de serviço (webhook, links de anexo) não passam
--     por RLS; quem os protege é o código.
--
-- SEÇÕES (cada uma num "Run" separado do SQL Editor; a ordem importa):
--   1. a função privacidade_ocultos()
--   2. leads: policies restritivas de leitura e de edição
--   3. tabelas filhas do lead: policy restritiva
--   4. settings: a chave 'privacidade' só para o admin
--
-- Policy RESTRITIVA = AND com as permissivas: não abre nada, só fecha, e não
-- precisa reescrever leads_por_papel, leads_edita nem as policies das filhas
-- (vale com a seção 4 da 0070 aplicada ou não).
--
-- vejo_lead NÃO muda: fica como na 0067. Ela roda uma vez por linha nas
-- permissivas das filhas (atendente e assessor, 0068). Pôr a privacidade
-- dentro dela faria o assessor ler settings em cada mensagem de cliente da
-- carteira dele com outro responsável, com regra ou sem, e no tempo real a
-- cada evento: o custo por linha que a 0068 tirou. As seções 2 e 3 já
-- cobrem a leitura, a gravação nas filhas e o UPDATE de leads.
--
-- Custo (pelo plano, não medido):
--   · Por consulta: privacidade_ocultos() roda uma vez (InitPlan, o padrão
--     da 0068), para todo mundo, com regra ou sem: uma leitura de profiles e
--     uma de settings a mais. No tempo real cada evento é conferido numa
--     consulta por pessoa conectada, então é essa leitura por evento e por
--     pessoa (o mesmo tipo de custo do "(select ve_tudo())" que já está lá).
--   · Por linha, em leads: comparar o responsavel_id com a lista. Nenhuma
--     função.
--   · Por linha, nas filhas: nada para quem não tem regra (o primeiro termo
--     vira "true" para a consulta inteira). Quem tem regra paga uma busca de
--     leads pela chave, que passa pelo RLS de leads de quem lê (para o
--     assessor, leads_por_papel pode chamar minha_carteira). É o mesmo custo
--     da seção 4 da 0070.
--
-- O "::uuid[]" em "= any ((select ...)::uuid[])" (seção 2) não é enfeite:
-- os parênteses a mais sozinhos ainda podem ser lidos como "any
-- (subconsulta)", que compara uuid com uuid[] e falha.
--
-- Script reexecutável, seção por seção.
-- =============================================================================


-- =============================================================================
-- 1. Quem está oculto para quem está logado
-- =============================================================================
-- privacidade_ocultos(): os responsáveis ocultos para auth.uid(). Vazio para
-- admin e sem sessão (service role, gatilho, cron). SECURITY DEFINER para ler
-- settings e profiles sem depender das policies deles.
--
-- O JSON é gravado pela tela de Administração, mas a função não confia nele:
-- item que não é objeto, lista que não é lista e id que não é uuid são
-- ignorados (o CASE garante a ordem: o cast para uuid só roda depois do
-- teste). Um erro aqui derrubaria toda leitura de leads.

create or replace function privacidade_ocultos()
returns uuid[]
language sql
stable
security definer
set search_path = public
as $$
  with eu as (
    select p.id
    from profiles p
    where p.id = auth.uid()
      and p.papel::text <> 'admin'
  ),
  cfg as (
    select
      case when jsonb_typeof(s.valor -> 'grupos') = 'array'
           then s.valor -> 'grupos' else '[]'::jsonb end as grupos,
      case when jsonb_typeof(s.valor -> 'regras') = 'array'
           then s.valor -> 'regras' else '[]'::jsonb end as regras
    from settings s
    where s.chave = 'privacidade'
  ),
  meus_grupos as (
    select g ->> 'id' as id
    from cfg
    cross join eu
    cross join lateral jsonb_array_elements(cfg.grupos) as g
    where case when jsonb_typeof(g -> 'membros') = 'array'
               then (g -> 'membros') ? eu.id::text
               else false end
  ),
  minhas_regras as (
    select case when jsonb_typeof(r -> 'naoVe') = 'array'
                then r -> 'naoVe' else '[]'::jsonb end as nao_ve
    from cfg
    cross join eu
    cross join lateral jsonb_array_elements(cfg.regras) as r
    where (r -> 'quem' ->> 'tipo' = 'pessoa'
           and r -> 'quem' ->> 'id' = eu.id::text)
       or (r -> 'quem' ->> 'tipo' = 'grupo'
           and r -> 'quem' ->> 'id' in (select mg.id from meus_grupos mg))
  ),
  donos as (
    select case
             when jsonb_typeof(d) = 'string'
              and (d #>> '{}') ~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'
             then (d #>> '{}')::uuid
           end as dono
    from minhas_regras mr
    cross join lateral jsonb_array_elements(mr.nao_ve) as d
  )
  -- Ninguém fica oculto de si mesmo.
  select coalesce(array_agg(distinct donos.dono), '{}'::uuid[])
  from donos
  cross join eu
  where donos.dono is not null
    and donos.dono <> eu.id;
$$;

revoke execute on function privacidade_ocultos() from public, anon;
grant execute on function privacidade_ocultos() to authenticated;

-- Conferir (como um usuário; o bloco "Como conferir" do README explica o
-- set_config): select privacidade_ocultos();
--
-- Desfazer 1 (só depois de desfazer 2 e 3, que dependem dela):
--   drop function if exists privacidade_ocultos();


-- =============================================================================
-- 2. leads: policies restritivas de leitura e de edição
-- =============================================================================
-- leads_por_papel (0068:28-40) escreve a regra do papel direto na policy,
-- sem vejo_lead: a privacidade entra numa restritiva ao lado dela. A lista
-- de ocultos é calculada uma vez por consulta; por linha sobra comparar o
-- responsavel_id com ela. Com lista vazia (admin, quem não tem regra), a
-- condição é sempre verdadeira.
--
-- Vale também para o que lê leads por baixo com o RLS de quem chama:
-- v_leads_listas (security_invoker, 0062), a busca, o Realtime de leads, a
-- seção 3 daqui e a seção 4 da 0070 (as duas, para cada linha das filhas,
-- perguntam a leads "este lead existe para mim?").
--
-- Edição: leads_edita (0068, com vejo_lead) não muda. A restritiva de
-- edição tira da conta o lead do dono oculto em todo UPDATE, com WHERE ou
-- sem: quem tem regra não muda esse lead (ele fica de fora, sem erro), nem
-- para se pôr como responsável e passar a ver a conversa. Ela olha só a
-- linha como estava ("with check (true)"); a linha nova é o assunto do
-- parágrafo abaixo. O DELETE (só a gestão, leads_apaga) passa pela
-- restritiva de leitura sempre que tem filtro.
--
-- Efeito que vem junto: o Postgres confere a linha NOVA de um INSERT ou
-- UPDATE contra as policies de leitura quando o comando lê a tabela (WHERE
-- ou RETURNING; o PostgREST usa os dois). Quem tem regra RECEBE "new row
-- violates row-level security policy" em dois casos: ao passar uma conversa
-- para alguém oculto dele e ao cadastrar um contato com responsável oculto
-- (Contatos > Novo faz insert com RETURNING id). A linha sairia da vista de
-- quem grava. O atendente que passa a conversa para um colega cai no mesmo
-- caso com as policies de hoje. A saída é a mesma para os dois: uma função
-- security definer para transferir e cadastrar, que confere a permissão e
-- grava sem o RETURNING. O roteiro em docs/PRIVACIDADE.md testa os dois.

set local lock_timeout = '5s';

drop policy if exists privacidade_le on leads;
create policy privacidade_le on leads
  as restrictive
  for select to authenticated
  using (
    responsavel_id is null
    or not (responsavel_id = any ((select privacidade_ocultos())::uuid[]))
  );

drop policy if exists privacidade_edita on leads;
create policy privacidade_edita on leads
  as restrictive
  for update to authenticated
  using (
    responsavel_id is null
    or not (responsavel_id = any ((select privacidade_ocultos())::uuid[]))
  )
  with check (true);

-- Desfazer 2:
--   drop policy if exists privacidade_edita on leads;
--   drop policy if exists privacidade_le on leads;


-- =============================================================================
-- 3. Tabelas filhas do lead: policy restritiva
-- =============================================================================
-- As permissivas das filhas são "(select ve_tudo()) or vejo_lead(lead_id)"
-- (0068) ou, com a seção 4 da 0070, "(select ve_tudo()) or exists (lead
-- visível)". Nas duas, gestor e compliance passam pelo ve_tudo() sem olhar o
-- lead, e vejo_lead não sabe da privacidade (fica como na 0067). A
-- restritiva fecha os dois caminhos, para todos os papéis: a linha só vale
-- se o lead dela existe para quem lê, perguntado à tabela leads com o RLS de
-- quem lê (que desde a seção 2 inclui a privacidade).
--
-- Quem não tem regra não paga nada por linha: o primeiro termo é um InitPlan
-- que vira "true" para a consulta inteira, e a busca em leads nem roda. Sobra
-- a chamada de privacidade_ocultos() uma vez por consulta (no Realtime, uma
-- por evento e por pessoa conectada). Quem tem regra paga a busca em leads
-- por linha.
--
-- Vale para ler e para gravar (for all): mensagem, nota, etiqueta e
-- agendada em conversa oculta não entram nem saem. lead_interactions é a
-- tabela que o Realtime do chat assina: evento de conversa oculta para de
-- chegar ao navegador.

set local lock_timeout = '5s';

do $$
declare
  t text;
  regra text;
begin
  foreach t in array array[
    'lead_interactions', 'lead_tags', 'scheduled_messages',
    'lead_tasks', 'ativacao_checklist', 'trilha_eventos'
  ] loop
    if to_regclass('public.' || t) is null then
      continue;
    end if;
    regra := format(
      '((select cardinality(privacidade_ocultos())) = 0 or exists (select 1 from leads l where l.id = %I.lead_id))',
      t);
    execute format('drop policy if exists privacidade on %I', t);
    execute format(
      'create policy privacidade on %I as restrictive for all to authenticated using (%s) with check (%s)',
      t, regra, regra);
  end loop;
end $$;

-- Desfazer 3:
--
--   do $$
--   declare t text;
--   begin
--     foreach t in array array[
--       'lead_interactions', 'lead_tags', 'scheduled_messages',
--       'lead_tasks', 'ativacao_checklist', 'trilha_eventos'
--     ] loop
--       if to_regclass('public.' || t) is not null then
--         execute format('drop policy if exists privacidade on %I', t);
--       end if;
--     end loop;
--   end $$;


-- =============================================================================
-- 4. settings: a chave 'privacidade' só para o admin
-- =============================================================================
-- Hoje (0001:544): "gestao on settings for all using (sou_gestor())". Vira
-- duas: a gestão continua gravando todas as outras chaves; a 'privacidade'
-- só o admin grava. A leitura não muda (leitura_equipe, 0001:509, using
-- true): o servidor lê a configuração com a sessão de quem pede para
-- montar as telas.
--
-- A action da tela já barra quem não é admin (src/app/(app)/admin/
-- privacidade-actions.ts); aqui a mesma regra vale contra a API.

set local lock_timeout = '5s';

drop policy if exists gestao on settings;
create policy gestao on settings
  for all to authenticated
  using ((select sou_gestor()) and chave <> 'privacidade')
  with check ((select sou_gestor()) and chave <> 'privacidade');

drop policy if exists privacidade_admin on settings;
create policy privacidade_admin on settings
  for all to authenticated
  using (chave = 'privacidade' and (select meu_papel_texto()) = 'admin')
  with check (chave = 'privacidade' and (select meu_papel_texto()) = 'admin');

-- Desfazer 4 (a policy da 0001):
--   drop policy if exists privacidade_admin on settings;
--   drop policy if exists gestao on settings;
--   create policy gestao on settings for all to authenticated
--     using (sou_gestor()) with check (sou_gestor());
