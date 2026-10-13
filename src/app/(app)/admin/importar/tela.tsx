"use client";

import { formatarData } from "@/lib/format";
import { COLUNAS_ACEITAS } from "@/lib/imports/etiqueta";
import { ConfirmarAntes } from "../../configuracoes/cancelar";
import {
  FormAcao,
  LinhaEditor,
  MestreDetalhe,
  type Editor,
} from "../../configuracoes/editor";
import {
  CampoInterruptor,
  Grupo,
  LinhaInfo,
  ListaEditor,
  TextoLinha,
  ValorLinha,
  ZonaPerigo,
} from "../../configuracoes/ui";
import { excluirImportacao, importarLeads } from "../actions";
import { EtiquetaLista } from "../etiqueta-lista";
import { ImportForm } from "../import-form";
import { CabecalhoSubpagina, MolduraSubpagina } from "../subpagina";

/*
 * Administração › Importar contatos: cada contato da planilha entra com uma
 * etiqueta (a escolhida, a da coluna campanha da linha ou o nome do
 * arquivo), que vira o público das campanhas. O editor mostra a prévia do arquivo antes
 * de gravar e, depois, leva aos contatos que entraram e ao disparo. O
 * histórico fica embaixo, cada importação com o resultado e o excluir.
 */

export type Importacao = {
  id: string;
  arquivo_nome: string | null;
  referencia_data: string;
  status: "processando" | "concluida" | "falhou";
  total_linhas: number;
  linhas_ok: number | null;
  linhas_erro: number | null;
  erro_detalhe?: string | null;
  criado_em: string;
  autor: { nome: string } | null;
};

const ROTULO_STATUS: Record<Importacao["status"], string> = {
  processando: "Processando",
  concluida: "Concluída",
  falhou: "Falhou",
};

const TOM_STATUS = {
  processando: "neutro",
  concluida: "neutro",
  falhou: "erro",
} as const;

export function TelaImportar({
  historico,
  etiquetas,
  arquivadas,
  voltar,
}: {
  historico: Importacao[];
  /** Etiquetas ativas, para a lista da importação. */
  etiquetas: { id: string; nome: string }[];
  /** As arquivadas, para a prévia avisar quando um nome cai numa delas. */
  arquivadas: { id: string; nome: string }[];
  voltar: string | null;
}) {
  const editores: Record<string, Editor> = {};

  editores.importar = {
    titulo: "Importar contatos",
    conteudo: (
      <ImportForm
        acao={importarLeads}
        rotulo="Importar"
        ajudaArquivo={`CSV ou Excel (.xlsx). Colunas: ${COLUNAS_ACEITAS}.`}
        extras={({ nomeDoArquivo, previa, somenteNovos }) => (
          <>
            <EtiquetaLista
              etiquetas={etiquetas}
              arquivadas={arquivadas}
              nomeSugerido={nomeDoArquivo}
              previa={previa}
              somenteNovos={somenteNovos}
            />
            <ListaEditor rotulo="Ao importar">
              <CampoInterruptor
                name="somente_novos"
                value="sim"
                rotulo="Só telefones novos"
                ajuda="Quem já é contato ou cliente fica como está, sem a etiqueta."
                defaultChecked
              />
              <CampoInterruptor
                name="distribuir"
                rotulo="Dividir entre a equipe"
                ajuda="Quem está no rodízio fica com uma parte igual."
                defaultChecked
              />
            </ListaEditor>
          </>
        )}
      />
    ),
  };

  for (const imp of historico) {
    editores[`importacao:${imp.id}`] = {
      titulo: imp.arquivo_nome ?? "Importação sem nome",
      conteudo: (
        <div className="flex flex-col gap-3">
          <ListaEditor>
            <LinhaInfo>
              <TextoLinha titulo="Situação" />
              <ValorLinha tom={TOM_STATUS[imp.status]}>
                {ROTULO_STATUS[imp.status]}
              </ValorLinha>
            </LinhaInfo>
            <LinhaInfo>
              <TextoLinha titulo="Linhas importadas" />
              <ValorLinha>
                {(imp.linhas_ok ?? 0).toLocaleString("pt-BR")} de{" "}
                {imp.total_linhas.toLocaleString("pt-BR")}
              </ValorLinha>
            </LinhaInfo>
            {imp.linhas_erro ? (
              <LinhaInfo>
                <TextoLinha titulo="Linhas com problema" />
                <ValorLinha tom="atencao">
                  {imp.linhas_erro.toLocaleString("pt-BR")}
                </ValorLinha>
              </LinhaInfo>
            ) : null}
            <LinhaInfo>
              <TextoLinha titulo="Data" />
              <ValorLinha>{formatarData(imp.referencia_data)}</ValorLinha>
            </LinhaInfo>
            <LinhaInfo>
              <TextoLinha titulo="Por" />
              <ValorLinha>{imp.autor?.nome ?? "Sem autor"}</ValorLinha>
            </LinhaInfo>
          </ListaEditor>
          {imp.status === "falhou" && imp.erro_detalhe ? (
            <p className="tipo-nota px-2 text-texto-2">
              Motivo: {imp.erro_detalhe}
            </p>
          ) : null}
          <ZonaPerigo>
            <FormAcao acao={excluirImportacao} fechar>
              <input type="hidden" name="import_id" value={imp.id} />
              <ConfirmarAntes
                texto="Excluir do histórico"
                rotulo={`Excluir a importação ${imp.arquivo_nome ?? "sem nome"} do histórico`}
                pergunta="Sai o registro e o arquivo guardado. Os contatos importados continuam."
              />
            </FormAcao>
          </ZonaPerigo>
        </div>
      ),
    };
  }

  return (
    <MolduraSubpagina>
      <CabecalhoSubpagina titulo="Importar contatos" voltar={voltar} />

      <div className="mt-3">
        <MestreDetalhe
          editores={editores}
          voltar={voltar}
          grupoComandos="Administração"
          comandos={[{ id: "importar", rotulo: "Importar contatos" }]}
        >
          <div className="flex flex-col gap-4">
            <Grupo
              id="grupo-importar"
              titulo="Planilha"
              nota="Cada contato entra com uma etiqueta: a escolhida, a da coluna campanha da linha ou o nome do arquivo. É ela que o disparo usa de público."
            >
              <LinhaEditor id="importar">
                <TextoLinha
                  titulo="Importar contatos"
                  apoio="CSV ou Excel, com etiqueta"
                />
              </LinhaEditor>
            </Grupo>

            <Grupo
              id="grupo-importacoes"
              titulo="Últimas importações"
              direita={
                historico.length > 0
                  ? historico.length.toLocaleString("pt-BR")
                  : undefined
              }
            >
              {historico.length === 0 ? (
                <LinhaInfo>
                  <TextoLinha titulo="Nenhuma importação ainda." apagado />
                </LinhaInfo>
              ) : (
                historico.map((imp) => (
                  <LinhaEditor key={imp.id} id={`importacao:${imp.id}`}>
                    <TextoLinha
                      titulo={imp.arquivo_nome ?? "Sem nome"}
                      apoio={`${formatarData(imp.referencia_data)} · ${
                        imp.autor?.nome ?? "sem autor"
                      }`}
                    />
                    <ValorLinha tom={TOM_STATUS[imp.status]}>
                      {imp.status === "concluida"
                        ? `${(imp.linhas_ok ?? 0).toLocaleString("pt-BR")} de ${imp.total_linhas.toLocaleString("pt-BR")}`
                        : ROTULO_STATUS[imp.status]}
                    </ValorLinha>
                  </LinhaEditor>
                ))
              )}
            </Grupo>
          </div>
        </MestreDetalhe>
      </div>
    </MolduraSubpagina>
  );
}
