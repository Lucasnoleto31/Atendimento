"use client";

import { Field } from "@/components/ui/field";
import { formatarDataHora, formatarTelefone } from "@/lib/format";
import {
  alternarInstancia,
  atualizarInstancia,
  criarInstancia,
  excluirInstancia,
} from "../../configuracoes/actions";
import { ConfirmarAntes } from "../../configuracoes/cancelar";
import {
  FormAcao,
  Interruptor,
  LinhaEditor,
  LinhaNova,
  MestreDetalhe,
  type Editor,
} from "../../configuracoes/editor";
import { contagem } from "../../configuracoes/resultado";
import {
  CampoLista,
  Grupo,
  LinhaInfo,
  ListaEditor,
  TextoLinha,
  ValorLinha,
  ZonaPerigo,
} from "../../configuracoes/ui";
import { BotaoCopiar } from "../copiar";
import { CabecalhoSubpagina, MolduraSubpagina } from "../subpagina";
import type { EventosWebhook, SituacaoWebhook } from "../webhook";

/*
 * Administração › WhatsApp: os números (o phone_number_id liga as mensagens
 * que chegam a cada um) e, logo abaixo, o webhook da Meta. O passo a passo
 * do webhook e as variáveis de ambiente são do admin; a gestão vê uma linha
 * de estado e, faltando algo, o "fale com o admin".
 */

const MAX_NUMEROS = 10;

export type Instancia = {
  id: string;
  nome: string;
  telefone_e164: string;
  vendedor_id: string | null;
  ativa: boolean;
  meta_phone_number_id: string | null;
};

export type PessoaAtendente = { id: string; nome: string };

export function TelaWhatsapp({
  ehAdmin,
  numeros,
  equipe,
  webhookUrl,
  webhook,
  eventos,
  voltar,
}: {
  ehAdmin: boolean;
  numeros: Instancia[];
  /** A equipe ativa, para o atendente responsável. */
  equipe: PessoaAtendente[];
  /** O endereço completo do webhook (page.tsx). */
  webhookUrl: string;
  webhook: SituacaoWebhook;
  /** O último evento e os que falharam; null sem como ler. */
  eventos: EventosWebhook | null;
  voltar: string | null;
}) {
  const nomeDe = new Map(equipe.map((p) => [p.id, p.nome]));
  const conectados = numeros.filter((n) => n.meta_phone_number_id).length;
  const variaveisOk = webhook.tokenOk && webhook.segredoOk;
  const tudoLigado =
    variaveisOk && numeros.length > 0 && conectados === numeros.length;

  const opcoesAtendente = (
    <>
      <option value="">Sem atendente</option>
      {equipe.map((p) => (
        <option key={p.id} value={p.id}>
          {p.nome}
        </option>
      ))}
    </>
  );

  const editores: Record<string, Editor> = {};

  for (const inst of numeros) {
    editores[`numero:${inst.id}`] = {
      titulo: inst.nome,
      conteudo: (
        <div className="flex flex-col gap-3">
          <ListaEditor>
            <LinhaInfo>
              <TextoLinha titulo={<span id={`ativo-${inst.id}`}>Ativo</span>} />
              <FormAcao acao={alternarInstancia} erroNoAviso>
                <input type="hidden" name="id" value={inst.id} />
                <input type="hidden" name="ativa" value={inst.ativa ? "0" : "1"} />
                <Interruptor ligado={inst.ativa} rotuloId={`ativo-${inst.id}`} />
              </FormAcao>
            </LinhaInfo>
            <LinhaInfo>
              <TextoLinha titulo="Telefone" />
              <ValorLinha>{formatarTelefone(inst.telefone_e164)}</ValorLinha>
            </LinhaInfo>
          </ListaEditor>
          {/* O atendente salvo na key: o select não relê o defaultValue
              depois de montado. */}
          <FormAcao
            key={inst.vendedor_id ?? ""}
            acao={atualizarInstancia}
            fechar
            botao="Salvar"
            botaoGravando="Salvando…"
            className="flex flex-col gap-2"
          >
            <input type="hidden" name="id" value={inst.id} />
            <Field
              id={`numero-nome-${inst.id}`}
              name="nome"
              label="Nome"
              defaultValue={inst.nome}
              autoComplete="off"
              required
            />
            <CampoLista
              id={`numero-atendente-${inst.id}`}
              name="vendedor_id"
              label="Atendente responsável"
              ajuda="Contato novo que chega por este número fica com esta pessoa."
              defaultValue={inst.vendedor_id ?? ""}
            >
              {opcoesAtendente}
            </CampoLista>
            <Field
              id={`numero-pnid-${inst.id}`}
              name="meta_phone_number_id"
              label="phone_number_id da Meta"
              ajuda="Do painel da Meta. Liga as mensagens que chegam a este número."
              defaultValue={inst.meta_phone_number_id ?? ""}
              autoComplete="off"
              spellCheck={false}
              className="font-codigo"
            />
          </FormAcao>
          <ZonaPerigo>
            <FormAcao acao={excluirInstancia} fechar>
              <input type="hidden" name="id" value={inst.id} />
              <ConfirmarAntes
                texto="Excluir número"
                rotulo={`Excluir o número ${inst.nome}`}
                pergunta="O número sai da lista. Os contatos e as conversas continuam."
              />
            </FormAcao>
          </ZonaPerigo>
        </div>
      ),
    };
  }

  // No limite, nem o formulário (a paleta abria um que o servidor recusa).
  if (numeros.length < MAX_NUMEROS) {
    editores["numero:novo"] = {
      titulo: "Novo número",
      conteudo: (
        <FormAcao
          acao={criarInstancia}
          fechar
          botao="Adicionar número"
          botaoGravando="Adicionando…"
          className="flex flex-col gap-2"
        >
          <Field
            id="novo-numero-nome"
            name="nome"
            label="Nome"
            placeholder="Mesa 01"
            autoComplete="off"
            required
          />
          <Field
            id="novo-numero-telefone"
            name="telefone"
            label="Telefone"
            placeholder="11 98842-1170"
            inputMode="tel"
            autoComplete="off"
            required
            className="tabular-nums"
          />
          <CampoLista
            id="novo-numero-atendente"
            name="vendedor_id"
            label="Atendente responsável"
            ajuda="Contato novo que chega por este número fica com esta pessoa."
            defaultValue=""
          >
            {opcoesAtendente}
          </CampoLista>
          <Field
            id="novo-numero-pnid"
            name="meta_phone_number_id"
            label="phone_number_id da Meta (opcional)"
            ajuda="Do painel da Meta. Dá para preencher depois."
            autoComplete="off"
            spellCheck={false}
            className="font-codigo"
          />
        </FormAcao>
      ),
    };
  }

  // A linha do último evento: é ela que diz se a Meta está mandando.
  const linhasEventos = eventos ? (
    <>
      <LinhaInfo>
        <TextoLinha titulo="Último evento recebido" />
        <ValorLinha>
          {eventos.ultimo ? formatarDataHora(eventos.ultimo) : "Nenhum"}
        </ValorLinha>
      </LinhaInfo>
      {eventos.comErro > 0 ? (
        <LinhaInfo>
          <TextoLinha
            titulo="Sem gravar nas últimas 48 horas"
            apoio="O sistema tenta de novo sozinho."
          />
          <ValorLinha tom="atencao">
            {contagem(eventos.comErro, "evento", "eventos")}
          </ValorLinha>
        </LinhaInfo>
      ) : null}
    </>
  ) : null;

  return (
    <MolduraSubpagina>
      <CabecalhoSubpagina titulo="WhatsApp" voltar={voltar} />

      <div className="mt-3">
        <MestreDetalhe
          editores={editores}
          voltar={voltar}
          grupoComandos="Administração"
          comandos={[{ id: "numero:novo", rotulo: "Novo número de WhatsApp" }]}
        >
          <div className="flex flex-col gap-4">
            <Grupo
              id="grupo-whatsapp"
              titulo="Números de WhatsApp"
              direita={`${numeros.length.toLocaleString("pt-BR")} de ${MAX_NUMEROS}`}
            >
              {numeros.map((inst) => (
                <LinhaEditor key={inst.id} id={`numero:${inst.id}`}>
                  <TextoLinha
                    titulo={inst.nome}
                    apagado={!inst.ativa}
                    apoio={`${formatarTelefone(inst.telefone_e164)} · ${
                      (inst.vendedor_id && nomeDe.get(inst.vendedor_id)) ||
                      "Sem atendente"
                    }`}
                  />
                  {!inst.ativa ? (
                    <ValorLinha>Desativado</ValorLinha>
                  ) : !inst.meta_phone_number_id ? (
                    <ValorLinha tom="atencao">Sem ID da Meta</ValorLinha>
                  ) : null}
                </LinhaEditor>
              ))}
              {numeros.length < MAX_NUMEROS ? (
                <LinhaNova id="numero:novo" rotulo="Novo número" />
              ) : (
                <LinhaInfo>
                  <TextoLinha
                    titulo={`Limite de ${MAX_NUMEROS} números`}
                    apagado
                  />
                </LinhaInfo>
              )}
            </Grupo>

            {ehAdmin ? (
              <Grupo
                id="grupo-webhook"
                titulo="Webhook da Meta"
                nota={
                  !tudoLigado ? (
                    <ol className="flex list-decimal flex-col gap-0.5 pl-2">
                      {!variaveisOk ? (
                        <li>
                          Preencha META_WEBHOOK_VERIFY_TOKEN e META_APP_SECRET
                          no ambiente e publique de novo.
                        </li>
                      ) : null}
                      <li>
                        No Meta for Developers, aponte o webhook do WhatsApp
                        para o endereço acima, com o token, e assine o campo{" "}
                        <code>messages</code>.
                      </li>
                      <li>Preencha o phone_number_id em cada número acima.</li>
                    </ol>
                  ) : undefined
                }
              >
                {/* O endereço inteiro, quebrando onde precisar: cortado com
                    reticências, ninguém conferia o que estava colando. */}
                <LinhaInfo>
                  <span className="flex min-w-0 flex-1 flex-col">
                    <span className="tipo-corpo text-tinta">Endereço</span>
                    <code className="tipo-nota break-all text-texto-2">
                      {webhookUrl}
                    </code>
                  </span>
                  <BotaoCopiar
                    texto={webhookUrl}
                    rotulo="Copiar o endereço do webhook"
                  />
                </LinhaInfo>
                <LinhaInfo>
                  <TextoLinha titulo="Token de verificação" />
                  <ValorLinha tom={webhook.tokenOk ? "neutro" : "atencao"}>
                    {webhook.tokenOk ? "Configurado" : "Falta"}
                  </ValorLinha>
                </LinhaInfo>
                <LinhaInfo>
                  <TextoLinha titulo="App secret" />
                  <ValorLinha tom={webhook.segredoOk ? "neutro" : "atencao"}>
                    {webhook.segredoOk ? "Configurado" : "Falta"}
                  </ValorLinha>
                </LinhaInfo>
                {linhasEventos}
              </Grupo>
            ) : (
              <Grupo id="grupo-webhook" titulo="Webhook da Meta">
                <LinhaInfo>
                  <TextoLinha
                    titulo="Situação"
                    apoio={
                      variaveisOk ? undefined : "Fale com o admin para configurar."
                    }
                  />
                  <ValorLinha tom={tudoLigado ? "neutro" : "atencao"}>
                    {!variaveisOk
                      ? "Falta configurar"
                      : `Conectado: ${conectados.toLocaleString("pt-BR")} de ${numeros.length.toLocaleString("pt-BR")}`}
                  </ValorLinha>
                </LinhaInfo>
                {linhasEventos}
              </Grupo>
            )}
          </div>
        </MestreDetalhe>
      </div>
    </MolduraSubpagina>
  );
}
