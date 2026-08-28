-- =============================================================================
-- Mensagens padrão com anexo
-- =============================================================================
-- A equipe manda o mesmo PDF/print toda hora (roteiro do Profit Pro, tabela
-- de custos) e hoje precisa anexar à mão a cada conversa. A mensagem padrão
-- passa a carregar os arquivos junto: escolher a pronta no chat ("/") coloca
-- o texto na caixa E os anexos na fila de envio — nada sai sem o atendente
-- revisar e apertar Enviar.
--
-- anexos é jsonb [{tipo, url, nome}] apontando para o bucket público
-- midia-whatsapp (pasta mensagens-padrao/) — o mesmo lugar da mídia do chat.
--
-- Script reexecutável.
-- =============================================================================

alter table quick_replies
  add column if not exists anexos jsonb not null default '[]'::jsonb;

comment on column quick_replies.anexos is
  'Arquivos da mensagem padrão: [{tipo, url, nome}] no bucket midia-whatsapp/mensagens-padrao (0060). Máx. 5, validado na aplicação.';
