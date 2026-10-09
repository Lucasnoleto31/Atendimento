"use client";

import { Field } from "@/components/ui/field";
import {
  criarTag,
  excluirTag,
  renomearTag,
} from "../../configuracoes/actions";
import { ConfirmarAntes } from "../../configuracoes/cancelar";
import { EscolhaCorEtiqueta, OpcoesCor } from "../../configuracoes/cor-tag";
import {
  FormAcao,
  LinhaEditor,
  LinhaNova,
  MestreDetalhe,
  type Editor,
} from "../../configuracoes/editor";
import { contagem } from "../../configuracoes/resultado";
import {
  Grupo,
  LinhaInfo,
  LinhaLink,
  ListaEditor,
  PontoCor,
  TextoLinha,
  ValorLinha,
  ZonaPerigo,
} from "../../configuracoes/ui";
import { CabecalhoSubpagina, MolduraSubpagina } from "../subpagina";

/*
 * Administração › Etiquetas: o público das campanhas e o filtro da fila.
 * O editor muda o nome e a cor, leva aos contatos que têm a etiqueta e às
 * campanhas que a usam, e exclui por último. Disparos e o chat abrem o
 * editor de etiqueta nova pelo endereço (?abrir=etiqueta:nova&voltar=…).
 */

export type Tag = {
  id: string;
  nome: string;
  cor?: string | null;
  ativo?: boolean | null;
  lead_tags?: { count: number }[];
};

export type Campanha = {
  id: string;
  nome: string;
  status: "ativa" | "pausada" | "concluida";
  etiqueta_id: string | null;
};

const ROTULO_CAMPANHA: Record<Campanha["status"], string> = {
  ativa: "Enviando",
  pausada: "Pausada",
  concluida: "Concluída",
};

/** Os contatos com a etiqueta, na lista de Contatos já filtrada. */
function contatosDa(id: string) {
  return `/contatos?etiquetas=${encodeURIComponent(id)}`;
}

export function TelaEtiquetas({
  tags,
  campanhas,
  voltar,
}: {
  tags: Tag[];
  /** Campanhas ativas ou pausadas. */
  campanhas: Campanha[];
  voltar: string | null;
}) {
  const editores: Record<string, Editor> = {};

  for (const tag of tags) {
    const contatos = tag.lead_tags?.[0]?.count;
    const emUso = campanhas.filter((c) => c.etiqueta_id === tag.id);
    editores[`etiqueta:${tag.id}`] = {
      titulo: tag.nome,
      conteudo: (
        <div className="flex flex-col gap-3">
          {/* O nome salvo na key do campo (e não do form): o campo relê o
              valor gravado, e o foco fica no botão. */}
          <FormAcao
            acao={renomearTag}
            botao="Salvar nome"
            botaoGravando="Salvando…"
            className="flex flex-col gap-2"
          >
            <input type="hidden" name="id" value={tag.id} />
            <Field
              key={tag.nome}
              id={`etiqueta-nome-${tag.id}`}
              name="nome"
              label="Nome"
              defaultValue={tag.nome}
              autoComplete="off"
              maxLength={60}
              ajuda="Os contatos e as campanhas continuam com ela."
              required
            />
          </FormAcao>

          <EscolhaCorEtiqueta id={tag.id} cor={tag.cor} />

          {contatos !== undefined || emUso.length > 0 ? (
            <ListaEditor rotulo="Onde ela está">
              {contatos !== undefined ? (
                <LinhaLink href={contatosDa(tag.id)}>
                  <TextoLinha titulo="Contatos com ela" />
                  <ValorLinha>{contatos.toLocaleString("pt-BR")}</ValorLinha>
                </LinhaLink>
              ) : null}
              {emUso.map((c) => (
                <LinhaLink key={c.id} href="/campanhas">
                  <TextoLinha titulo={c.nome} apoio="Público da campanha" />
                  <ValorLinha>{ROTULO_CAMPANHA[c.status]}</ValorLinha>
                </LinhaLink>
              ))}
            </ListaEditor>
          ) : null}

          <ZonaPerigo>
            {emUso.length > 0 ? (
              <p className="tipo-nota text-texto-2">
                {emUso.length === 1
                  ? "A etiqueta é o público de uma campanha que ainda não terminou."
                  : `A etiqueta é o público de ${emUso.length.toLocaleString("pt-BR")} campanhas que ainda não terminaram.`}{" "}
                Para excluí-la, exclua antes a campanha em Disparos.
              </p>
            ) : (
              <FormAcao acao={excluirTag} fechar>
                <input type="hidden" name="id" value={tag.id} />
                <ConfirmarAntes
                  texto="Excluir etiqueta"
                  rotulo={`Excluir a etiqueta ${tag.nome}`}
                  pergunta={
                    contatos
                      ? `A etiqueta sai de ${contagem(contatos, "contato", "contatos")}.`
                      : "A etiqueta sai de todos os contatos."
                  }
                />
              </FormAcao>
            )}
          </ZonaPerigo>
        </div>
      ),
    };
  }

  editores["etiqueta:nova"] = {
    titulo: "Nova etiqueta",
    conteudo: (
      <FormAcao
        acao={criarTag}
        fechar
        botao="Criar etiqueta"
        botaoGravando="Criando…"
        className="flex flex-col gap-2"
      >
        <Field
          id="nova-etiqueta-nome"
          name="nome"
          label="Nome"
          placeholder="VIP outubro"
          autoComplete="off"
          maxLength={60}
          required
        />
        <OpcoesCor selecionada="neutro" />
      </FormAcao>
    ),
  };

  return (
    <MolduraSubpagina>
      <CabecalhoSubpagina titulo="Etiquetas" voltar={voltar} />

      <div className="mt-3">
        <MestreDetalhe
          editores={editores}
          voltar={voltar}
          grupoComandos="Administração"
          comandos={[{ id: "etiqueta:nova", rotulo: "Nova etiqueta" }]}
        >
          <Grupo
            id="grupo-etiquetas"
            titulo="Etiquetas"
            direita={
              tags.length > 0 ? tags.length.toLocaleString("pt-BR") : undefined
            }
            nota="A etiqueta é o público das campanhas e o filtro da caixa."
          >
            {tags.length === 0 ? (
              <LinhaInfo>
                <TextoLinha titulo="Nenhuma etiqueta ainda." apagado />
              </LinhaInfo>
            ) : null}
            {tags.map((tag) => {
              const contatos = tag.lead_tags?.[0]?.count;
              const campanha = campanhas.find((c) => c.etiqueta_id === tag.id);
              return (
                <LinhaEditor key={tag.id} id={`etiqueta:${tag.id}`}>
                  <PontoCor cor={tag.cor} />
                  <TextoLinha
                    titulo={tag.nome}
                    apagado={tag.ativo === false}
                    apoio={
                      tag.ativo === false
                        ? "Arquivada"
                        : campanha
                          ? `Público de ${campanha.nome}`
                          : undefined
                    }
                  />
                  {contatos !== undefined ? (
                    <ValorLinha>
                      {contagem(contatos, "contato", "contatos")}
                    </ValorLinha>
                  ) : null}
                </LinhaEditor>
              );
            })}
            <LinhaNova id="etiqueta:nova" rotulo="Nova etiqueta" />
          </Grupo>
        </MestreDetalhe>
      </div>
    </MolduraSubpagina>
  );
}
