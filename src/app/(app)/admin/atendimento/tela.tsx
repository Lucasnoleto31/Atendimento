"use client";

import { Field } from "@/components/ui/field";
import { rotuloPapel } from "@/lib/papeis";
import {
  horarioCurto,
  TIPOS_AUTOMATICA,
  textoDaResposta,
  type HorarioAtendimento,
  type RespostaAutomatica,
  type TipoAutomatica,
} from "@/lib/automaticas";
import {
  salvarParametro,
  salvarRespostaAutomatica,
} from "../../configuracoes/actions";
import {
  EditorHorario,
  EditorResposta,
  TITULO_RESPOSTA,
} from "../../configuracoes/automaticas";
import {
  FormAcao,
  Interruptor,
  LinhaComChave,
  LinhaEditor,
  MestreDetalhe,
  type Editor,
} from "../../configuracoes/editor";
import { contagem } from "../../configuracoes/resultado";
import {
  Grupo,
  LinhaInfo,
  ListaEditor,
  TextoLinha,
  ValorLinha,
} from "../../configuracoes/ui";
import { alternarRecebeLeads } from "../usuarios-actions";
import { CabecalhoSubpagina, MolduraSubpagina } from "../subpagina";

/*
 * Administração › Atendimento: como a conversa nova chega a alguém. A
 * distribuição automática e as respostas automáticas ligam e desligam na
 * linha; quem entra no rodízio (com as conversas abertas de cada um), o
 * horário, o texto das respostas e o teto de envios abrem o editor.
 *
 * Ligar uma resposta automática pergunta antes, com o texto que vai sair:
 * ela manda mensagem a cliente (e só deve ser ligada depois do OK do Lucas,
 * MUDANCAS-PARA-O-LUCAS.md, quarta rodada).
 */

export type Pessoa = {
  id: string;
  nome: string;
  papel: string;
  recebe_leads?: boolean | null;
  /** Conversas abertas agora; null se a conta não veio. */
  abertas?: number | null;
};

export function TelaAtendimento({
  ehAdmin,
  equipe,
  comRodizio,
  distribuicao,
  teto,
  horario,
  respostas,
  voltar,
}: {
  ehAdmin: boolean;
  /** A equipe ativa. */
  equipe: Pessoa[];
  /** A coluna do rodízio existe (migração 0041). */
  comRodizio: boolean;
  distribuicao: boolean;
  teto: number;
  /** Horário de atendimento, em Brasília (settings.horario_atendimento). */
  horario: HorarioAtendimento;
  /** A resposta de fora do horário e as boas-vindas. */
  respostas: Record<TipoAutomatica, RespostaAutomatica>;
  voltar: string | null;
}) {
  const noRodizio = equipe.filter((p) => p.recebe_leads).length;

  const editores: Record<string, Editor> = {};

  editores.rodizio = {
    titulo: "Quem entra no rodízio",
    conteudo: (
      <div className="flex flex-col gap-2">
        {!comRodizio ? (
          <p className="tipo-corpo text-texto-2">
            Rode a migração 0041 para escolher quem entra no rodízio.
          </p>
        ) : equipe.length === 0 ? (
          <p className="tipo-corpo text-texto-2">Ninguém ativo na equipe.</p>
        ) : (
          <ListaEditor>
            {equipe.map((p) => (
              <LinhaInfo key={p.id}>
                <TextoLinha
                  titulo={<span id={`rodizio-${p.id}`}>{p.nome}</span>}
                  apoio={[
                    rotuloPapel(p.papel),
                    typeof p.abertas === "number"
                      ? `${contagem(p.abertas, "conversa aberta", "conversas abertas")}`
                      : null,
                  ]
                    .filter(Boolean)
                    .join(" · ")}
                />
                {ehAdmin ? (
                  <FormAcao acao={alternarRecebeLeads} erroNoAviso>
                    <input type="hidden" name="id" value={p.id} />
                    <input
                      type="hidden"
                      name="recebe"
                      value={p.recebe_leads ? "0" : "1"}
                    />
                    <Interruptor
                      ligado={Boolean(p.recebe_leads)}
                      rotuloId={`rodizio-${p.id}`}
                    />
                  </FormAcao>
                ) : (
                  <ValorLinha>{p.recebe_leads ? "No rodízio" : "Fora"}</ValorLinha>
                )}
              </LinhaInfo>
            ))}
          </ListaEditor>
        )}
        {comRodizio ? (
          <p className="tipo-nota px-2 text-texto-2">
            {ehAdmin
              ? "Com a distribuição ligada, a conversa nova vai para quem está no rodízio e tem menos conversas abertas."
              : "Só o admin muda quem entra no rodízio."}
          </p>
        ) : null}
      </div>
    ),
  };

  editores.teto = {
    titulo: "Teto de envios",
    conteudo: (
      <FormAcao
        acao={salvarParametro}
        fechar
        botao="Salvar"
        botaoGravando="Salvando…"
        className="flex flex-col gap-2"
      >
        <input type="hidden" name="chave" value="envios_teto_dia" />
        <Field
          id="teto-envios"
          name="valor"
          label="Envios por dia"
          ajuda="Soma de todas as campanhas no número. Suba aos poucos enquanto a qualidade estiver verde."
          inputMode="numeric"
          autoComplete="off"
          defaultValue={String(teto)}
          required
          className="tabular-nums"
        />
      </FormAcao>
    ),
  };

  editores.horario = {
    titulo: "Horário de atendimento",
    conteudo: <EditorHorario horario={horario} />,
  };

  for (const tipo of TIPOS_AUTOMATICA) {
    editores[`resposta:${tipo}`] = {
      titulo: TITULO_RESPOSTA[tipo],
      conteudo: (
        <EditorResposta
          tipo={tipo}
          resposta={respostas[tipo]}
          horario={horario}
        />
      ),
    };
  }

  return (
    <MolduraSubpagina>
      <CabecalhoSubpagina titulo="Atendimento" voltar={voltar} />

      <div className="mt-3">
        <MestreDetalhe
          editores={editores}
          voltar={voltar}
          grupoComandos="Administração"
          comandos={[
            { id: "rodizio", rotulo: "Quem entra no rodízio" },
            { id: "horario", rotulo: "Horário de atendimento" },
            {
              id: "resposta:fora_do_horario",
              rotulo: "Resposta automática fora do horário",
            },
            { id: "resposta:boas_vindas", rotulo: "Mensagem de boas-vindas" },
            { id: "teto", rotulo: "Teto de envios por dia" },
          ]}
        >
          <div className="flex flex-col gap-4">
            <Grupo
              id="grupo-distribuicao"
              titulo="Distribuição"
              nota="Com a distribuição ligada, contato novo vai para quem está no rodízio e tem menos conversas abertas. Número com atendente fixo passa na frente."
            >
              <LinhaInfo>
                <TextoLinha
                  titulo={
                    <span id="rotulo-distribuicao">Distribuição automática</span>
                  }
                />
                <FormAcao acao={salvarParametro} erroNoAviso>
                  <input
                    type="hidden"
                    name="chave"
                    value="distribuicao_automatica"
                  />
                  <input
                    type="hidden"
                    name="valor"
                    value={distribuicao ? "0" : "1"}
                  />
                  <Interruptor
                    ligado={distribuicao}
                    rotuloId="rotulo-distribuicao"
                  />
                </FormAcao>
              </LinhaInfo>
              <LinhaEditor id="rodizio">
                <TextoLinha titulo="Quem entra no rodízio" />
                <ValorLinha>
                  {comRodizio
                    ? `${noRodizio.toLocaleString("pt-BR")} de ${equipe.length.toLocaleString("pt-BR")}`
                    : ""}
                </ValorLinha>
              </LinhaEditor>
            </Grupo>

            <Grupo
              id="grupo-respostas"
              titulo="Respostas automáticas"
              nota="No máximo uma resposta automática por contato a cada 12 horas, contando as duas. Tocar no nome muda o texto."
            >
              <LinhaEditor id="horario">
                <TextoLinha
                  titulo="Horário de atendimento"
                  apoio={horarioCurto(horario)}
                />
              </LinhaEditor>
              {TIPOS_AUTOMATICA.map((tipo) => {
                const r = respostas[tipo];
                const idRotulo = `rotulo-resposta-${tipo}`;
                const saida = textoDaResposta(r.texto, horario);
                return (
                  <LinhaComChave
                    key={tipo}
                    id={`resposta:${tipo}`}
                    chave={
                      <FormAcao acao={salvarRespostaAutomatica} erroNoAviso>
                        <input type="hidden" name="tipo" value={tipo} />
                        <input type="hidden" name="texto" value={r.texto} />
                        <input
                          type="hidden"
                          name="ativo"
                          value={r.ativo ? "" : "1"}
                        />
                        <Interruptor
                          ligado={r.ativo}
                          rotuloId={idRotulo}
                          confirmar={
                            r.ativo
                              ? undefined
                              : saida
                                ? `Ligar “${TITULO_RESPOSTA[tipo]}”? O contato vai receber:\n\n${saida}`
                                : undefined
                          }
                        />
                      </FormAcao>
                    }
                  >
                    <TextoLinha
                      titulo={<span id={idRotulo}>{TITULO_RESPOSTA[tipo]}</span>}
                      apoio={r.ativo ? "Ligada" : "Desligada"}
                    />
                  </LinhaComChave>
                );
              })}
            </Grupo>

            <Grupo id="grupo-teto" titulo="Disparos">
              <LinhaEditor id="teto">
                <TextoLinha titulo="Teto de envios por dia" />
                <ValorLinha>{teto.toLocaleString("pt-BR")}</ValorLinha>
              </LinhaEditor>
            </Grupo>
          </div>
        </MestreDetalhe>
      </div>
    </MolduraSubpagina>
  );
}
