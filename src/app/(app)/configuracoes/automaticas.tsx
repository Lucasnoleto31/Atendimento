"use client";

import { useState } from "react";
import { cn } from "@/lib/utils";
import { Field } from "@/components/ui/field";
import { AJUDA } from "@/components/app/form-styles";
import {
  horarioPorExtenso,
  LIMITE_TEXTO,
  MARCADOR_HORARIO,
  nomeDoDia,
  ORDEM_SEMANA,
  textoDaResposta,
  type HorarioAtendimento,
  type RespostaAutomatica,
  type TipoAutomatica,
} from "@/lib/automaticas";
import { salvarHorario, salvarRespostaAutomatica } from "./actions";
import { FormAcao } from "./editor";
import { CampoTexto, GrupoEscolha, OpcaoEscolha } from "./ui";

/*
 * Os editores das respostas automáticas (regra em lib/automaticas.ts): o
 * horário de atendimento e as duas respostas, a de fora do horário e as
 * boas-vindas. Quem manda é o webhook; aqui só se grava em settings.
 */

/** Campo de hora nativo: no iOS ele ignora a largura e centraliza o valor
 *  (kit, bloco 8). */
const CAMPO_HORA =
  "appearance-none text-left tabular-nums [&::-webkit-date-and-time-value]:text-left";

export function EditorHorario({ horario }: { horario: HorarioAtendimento }) {
  return (
    <FormAcao
      acao={salvarHorario}
      fechar
      botao="Salvar"
      botaoGravando="Salvando…"
      className="flex flex-col gap-2"
    >
      <GrupoEscolha rotulo="Dias">
        {ORDEM_SEMANA.map((dia) => (
          <OpcaoEscolha
            key={dia}
            tipo="checkbox"
            name="dias"
            value={String(dia)}
            defaultChecked={horario.dias.includes(dia)}
          >
            <span className="tipo-corpo min-w-0 flex-1 truncate text-tinta">
              {nomeDoDia(dia)}
            </span>
          </OpcaoEscolha>
        ))}
      </GrupoEscolha>
      <div className="flex flex-col gap-1">
        <div className="grid grid-cols-2 gap-1.5">
          <Field
            id="horario-inicio"
            name="inicio"
            type="time"
            label="Início"
            defaultValue={horario.inicio}
            required
            aria-describedby="horario-ajuda"
            className={CAMPO_HORA}
          />
          <Field
            id="horario-fim"
            name="fim"
            type="time"
            label="Fim"
            defaultValue={horario.fim}
            required
            aria-describedby="horario-ajuda"
            className={CAMPO_HORA}
          />
        </div>
        <p id="horario-ajuda" className={AJUDA}>
          Hora de Brasília.
        </p>
      </div>
    </FormAcao>
  );
}

/** O título da linha e do editor de cada resposta automática. */
export const TITULO_RESPOSTA: Record<TipoAutomatica, string> = {
  fora_do_horario: "Fora do horário",
  boas_vindas: "Boas-vindas",
};

/** Para quem cada resposta sai, embaixo do texto. */
const PARA_QUEM: Record<TipoAutomatica, string> = {
  fora_do_horario: "Sai para quem escreve fora do horário.",
  boas_vindas: "Sai para quem escreve pela primeira vez, dentro do horário.",
};

/**
 * O texto e a prévia do que sai para o contato, com o {horario} já trocado.
 * O contador conta essa saída, que é o que o canal recebe. Ligar e desligar
 * moram na chave da linha (Administração › Atendimento), que pergunta antes
 * com o texto à vista; aqui o estado só vai junto, escondido, para salvar o
 * texto não ligar nem desligar nada.
 */
export function EditorResposta({
  tipo,
  resposta,
  horario,
}: {
  tipo: TipoAutomatica;
  resposta: RespostaAutomatica;
  horario: HorarioAtendimento;
}) {
  const [texto, setTexto] = useState(resposta.texto);
  const saida = textoDaResposta(texto, horario);
  const passou = saida.length > LIMITE_TEXTO;
  const idTexto = `resposta-${tipo}-texto`;
  const idApoio = `${idTexto}-apoio`;

  return (
    <FormAcao
      acao={salvarRespostaAutomatica}
      fechar
      botao="Salvar"
      botaoGravando="Salvando…"
      className="flex flex-col gap-2"
    >
      <input type="hidden" name="tipo" value={tipo} />
      <input type="hidden" name="ativo" value={resposta.ativo ? "1" : ""} />
      <p className="tipo-nota px-2 text-texto-2">
        {PARA_QUEM[tipo]}{" "}
        {resposta.ativo
          ? "Ligada."
          : "Desligada. Para ligar, use a chave ao lado do nome, na lista."}
      </p>

      <div className="flex flex-col gap-1">
        <CampoTexto
          id={idTexto}
          name="texto"
          label="Texto"
          value={texto}
          onChange={(e) => setTexto(e.target.value)}
          rows={5}
          maxLength={LIMITE_TEXTO}
          aria-describedby={idApoio}
          aria-invalid={passou || undefined}
        />
        <div id={idApoio} className="flex items-start justify-between gap-1.5">
          <p className={cn(AJUDA, "min-w-0")}>
            {MARCADOR_HORARIO} vira “{horarioPorExtenso(horario)}”.
          </p>
          <p
            className={cn(
              "shrink-0 text-xs tabular-nums",
              passou ? "text-erro" : "text-texto-2",
            )}
          >
            {saida.length.toLocaleString("pt-BR")} de{" "}
            {LIMITE_TEXTO.toLocaleString("pt-BR")}
          </p>
        </div>
      </div>

      <div>
        <p className="tipo-nota px-2 pb-1 text-texto-2">Como vai sair</p>
        <div className="flex rounded-painel bg-cartao p-1.5">
          {saida ? (
            <p className="tipo-corpo ml-auto max-w-[85%] rounded-painel rounded-br-celula bg-tinta px-1.5 py-1 break-words whitespace-pre-wrap text-fundo">
              {saida}
            </p>
          ) : (
            <p className="tipo-nota text-texto-2">
              Sem texto, a resposta não sai.
            </p>
          )}
        </div>
      </div>
    </FormAcao>
  );
}
