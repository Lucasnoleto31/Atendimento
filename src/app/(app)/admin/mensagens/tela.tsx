"use client";

import { useState } from "react";
import { Paperclip } from "lucide-react";
import { Field } from "@/components/ui/field";
import {
  atualizarMensagem,
  criarMensagem,
  excluirMensagem,
} from "../../configuracoes/actions";
import {
  AnexosMensagem,
  type AnexoMensagem,
} from "../../configuracoes/anexos-mensagem";
import { ConfirmarAntes } from "../../configuracoes/cancelar";
import {
  FormAcao,
  LinhaEditor,
  LinhaNova,
  MestreDetalhe,
  type Editor,
} from "../../configuracoes/editor";
import {
  CampoTexto,
  Grupo,
  LinhaInfo,
  TextoLinha,
  ZonaPerigo,
} from "../../configuracoes/ui";
import { CabecalhoSubpagina, MolduraSubpagina } from "../subpagina";

/*
 * Administração › Mensagens prontas: as respostas que o chat oferece
 * no compositor. Cada linha abre o editor (folha no celular, painel ao lado
 * no desktop). O chat abre o editor de mensagem nova já com o texto
 * (?abrir=mensagem:nova&texto=…) e, com ?voltar=, quem grava volta para a
 * conversa.
 */

export type Mensagem = {
  id: string;
  titulo: string;
  corpo: string;
  anexos?: AnexoMensagem[] | null;
};

/** A primeira linha do texto, para a prévia na lista. */
function primeiraLinha(texto: string) {
  return texto.split("\n").find((l) => l.trim())?.trim() ?? "";
}

export function TelaMensagens({
  mensagens,
  comAnexos,
  textoInicial,
  voltar,
}: {
  mensagens: Mensagem[];
  /** A coluna de anexos existe (migração 0060). */
  comAnexos: boolean;
  /** O texto que veio pela URL para a mensagem nova. */
  textoInicial: string;
  voltar: string | null;
}) {
  // O texto da URL vale só para a primeira mensagem nova: fechado o editor,
  // a próxima começa em branco.
  const [textoNova, setTextoNova] = useState(textoInicial);

  const editores: Record<string, Editor> = {};

  for (const msg of mensagens) {
    editores[`mensagem:${msg.id}`] = {
      titulo: msg.titulo,
      conteudo: (
        <div className="flex flex-col gap-3">
          <FormAcao
            acao={atualizarMensagem}
            fechar
            botao="Salvar"
            botaoGravando="Salvando…"
            className="flex flex-col gap-2"
          >
            <input type="hidden" name="id" value={msg.id} />
            <Field
              id={`msg-titulo-${msg.id}`}
              name="titulo"
              label="Título"
              defaultValue={msg.titulo}
              autoComplete="off"
              required
            />
            <CampoTexto
              id={`msg-corpo-${msg.id}`}
              name="corpo"
              label="Texto"
              defaultValue={msg.corpo}
              rows={6}
              required
            />
            {comAnexos ? (
              <AnexosMensagem idBase={msg.id} existentes={msg.anexos ?? []} />
            ) : null}
          </FormAcao>
          <ZonaPerigo>
            <FormAcao acao={excluirMensagem} fechar>
              <input type="hidden" name="id" value={msg.id} />
              <ConfirmarAntes
                texto="Excluir mensagem"
                rotulo={`Excluir a mensagem ${msg.titulo}`}
                pergunta="A mensagem sai da lista do chat para toda a equipe."
              />
            </FormAcao>
          </ZonaPerigo>
        </div>
      ),
    };
  }

  editores["mensagem:nova"] = {
    titulo: "Nova mensagem pronta",
    conteudo: (
      <FormAcao
        acao={criarMensagem}
        fechar
        botao="Criar mensagem"
        botaoGravando="Criando…"
        className="flex flex-col gap-2"
      >
        <Field
          id="nova-msg-titulo"
          name="titulo"
          label="Título"
          placeholder="Primeiro contato"
          autoComplete="off"
          ajuda={textoNova ? "O texto já veio da conversa." : undefined}
          required
        />
        <CampoTexto
          id="nova-msg-corpo"
          name="corpo"
          label="Texto"
          defaultValue={textoNova}
          rows={6}
          required
        />
        {comAnexos ? <AnexosMensagem idBase="nova" existentes={[]} /> : null}
      </FormAcao>
    ),
  };

  return (
    <MolduraSubpagina>
      <CabecalhoSubpagina titulo="Mensagens prontas" voltar={voltar} />

      <div className="mt-3">
        <MestreDetalhe
          editores={editores}
          voltar={voltar}
          grupoComandos="Administração"
          comandos={[{ id: "mensagem:nova", rotulo: "Nova mensagem pronta" }]}
          aoFechar={(chave) => {
            if (chave === "mensagem:nova") setTextoNova("");
          }}
        >
          <Grupo
            id="grupo-mensagens"
            titulo="Mensagens prontas"
            direita={
              mensagens.length > 0
                ? mensagens.length.toLocaleString("pt-BR")
                : undefined
            }
            nota="Aparecem no chat, no botão de mensagens do compositor, para toda a equipe."
          >
            {mensagens.length === 0 ? (
              <LinhaInfo>
                <TextoLinha titulo="Nenhuma mensagem pronta ainda." apagado />
              </LinhaInfo>
            ) : null}
            {mensagens.map((msg) => {
              const anexos = msg.anexos?.length ?? 0;
              return (
                <LinhaEditor key={msg.id} id={`mensagem:${msg.id}`}>
                  <TextoLinha
                    titulo={msg.titulo}
                    apoio={primeiraLinha(msg.corpo)}
                  />
                  {anexos > 0 ? (
                    <span className="tipo-nota inline-flex shrink-0 items-center gap-0.5 text-texto-2 tabular-nums">
                      <Paperclip size={14} strokeWidth={1.75} aria-hidden />
                      {anexos}
                      <span className="sr-only">
                        {anexos === 1 ? " anexo" : " anexos"}
                      </span>
                    </span>
                  ) : null}
                </LinhaEditor>
              );
            })}
            <LinhaNova id="mensagem:nova" rotulo="Nova mensagem" />
          </Grupo>
        </MestreDetalhe>
      </div>
    </MolduraSubpagina>
  );
}
