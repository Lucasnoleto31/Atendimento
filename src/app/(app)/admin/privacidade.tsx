"use client";

import { useRef, useState } from "react";
import { rotuloPapel } from "@/lib/papeis";
import type {
  ConfigPrivacidade,
  GrupoPrivacidade,
  QuemPrivacidade,
  RegraPrivacidade,
} from "@/lib/privacidade-regra";
import { Field } from "@/components/ui/field";
import { ConfirmarAntes } from "../configuracoes/cancelar";
import {
  FormAcao,
  LinhaEditor,
  LinhaNova,
  type Editor,
} from "../configuracoes/editor";
import {
  CampoLista,
  Grupo,
  GrupoEscolha,
  LinhaInfo,
  OpcaoEscolha,
  TextoLinha,
  ValorLinha,
  ZonaPerigo,
} from "../configuracoes/ui";
import {
  excluirGrupoPrivacidade,
  excluirRegraPrivacidade,
  salvarGrupoPrivacidade,
  salvarRegraPrivacidade,
} from "./privacidade-actions";
import {
  avisoDasProprias,
  avisoDeAdmin,
  avisoDeAtendente,
  fraseDaRegra,
  listaDeNomes,
  nomeDeQuem,
  nomesDe,
  quantasPessoas,
  QUEM_NOVO_GRUPO,
  type PessoaPrivacidade,
} from "./privacidade-texto";

/*
 * Administração > Privacidade: os grupos (nome e pessoas) e as regras (quem
 * não vê as conversas de quem). A regra em si mora em lib/privacidade.ts;
 * aqui só a lista e os editores, no mesmo mestre e detalhe do resto da tela
 * (folha no celular, painel no desktop). Só o admin vê e grava.
 */

/** As chaves dos editores, também usadas pela paleta. */
export const COMANDOS_PRIVACIDADE = [
  { id: "privacidade-regra:nova", rotulo: "Nova regra de privacidade" },
  { id: "privacidade-grupo:novo", rotulo: "Novo grupo de privacidade" },
];

function mapaDaEquipe(equipe: readonly PessoaPrivacidade[]) {
  return new Map(equipe.map((p) => [p.id, p]));
}

function chaveDeQuem(quem: QuemPrivacidade) {
  return `${quem.tipo}:${quem.id}`;
}

function lerQuem(valor: string): QuemPrivacidade | null {
  const m = /^(pessoa|grupo):(.+)$/.exec(valor);
  return m ? { tipo: m[1] as QuemPrivacidade["tipo"], id: m[2] } : null;
}

/** O id provisório do grupo novo, só para a prévia da frase. */
const ID_PREVIA_GRUPO = "__grupo-novo";

/** Nome, papel e, se for o caso, a conta desativada. */
function TextoPessoa({ pessoa }: { pessoa: PessoaPrivacidade }) {
  return (
    <TextoLinha
      titulo={pessoa.nome}
      apoio={[rotuloPapel(pessoa.papel), pessoa.ativo ? null : "conta desativada"]
        .filter(Boolean)
        .join(" · ")}
      apagado={!pessoa.ativo}
    />
  );
}

/* ── Grupos ─────────────────────────────────────────────────────────── */

function EditorGrupo({
  grupo,
  equipe,
  regraDoGrupo,
}: {
  grupo?: GrupoPrivacidade;
  equipe: readonly PessoaPrivacidade[];
  /** As frases das regras que valem para este grupo (saem junto). */
  regraDoGrupo: string[];
}) {
  const sufixo = grupo?.id ?? "novo";
  const pergunta =
    regraDoGrupo.length === 0
      ? "Nenhuma regra usa este grupo. Ninguém ganha nem perde acesso."
      : regraDoGrupo.length === 1
        ? `Sai junto a regra dele: ${regraDoGrupo[0]}`
        : `Saem junto as ${regraDoGrupo.length.toLocaleString("pt-BR")} regras dele.`;

  return (
    <div className="flex flex-col gap-3">
      <FormAcao
        acao={salvarGrupoPrivacidade}
        fechar
        botao={grupo ? "Salvar grupo" : "Criar grupo"}
        botaoGravando={grupo ? "Salvando…" : "Criando…"}
        className="flex flex-col gap-2"
      >
        {grupo ? <input type="hidden" name="id" value={grupo.id} /> : null}
        <Field
          id={`privacidade-grupo-nome-${sufixo}`}
          name="nome"
          label="Nome"
          defaultValue={grupo?.nome}
          autoComplete="off"
          maxLength={60}
          required
        />
        <GrupoEscolha rotulo="Pessoas do grupo">
          {equipe.map((p) => (
            <OpcaoEscolha
              key={p.id}
              tipo="checkbox"
              name="membros"
              value={p.id}
              defaultChecked={grupo?.membros.includes(p.id)}
            >
              <TextoPessoa pessoa={p} />
            </OpcaoEscolha>
          ))}
        </GrupoEscolha>
      </FormAcao>

      {grupo ? (
        <ZonaPerigo>
          <FormAcao acao={excluirGrupoPrivacidade} fechar>
            <input type="hidden" name="id" value={grupo.id} />
            <ConfirmarAntes
              texto="Excluir grupo"
              rotulo={`Excluir o grupo ${grupo.nome}`}
              pergunta={pergunta}
            />
          </FormAcao>
        </ZonaPerigo>
      ) : null}
    </div>
  );
}

/* ── Regras ─────────────────────────────────────────────────────────── */

/**
 * Quem, de quem e a prévia em frase. O select é controlado (a lista de
 * "não vê" depende dele: a própria pessoa da regra sai dela); as caixas
 * ficam soltas e a prévia lê o que está marcado a cada mudança. A linha que
 * sai e volta (trocando a pessoa da regra) remonta com o que a prévia
 * mostrava, e a tela e o envio não discordam.
 */
function CamposRegra({
  regra,
  config,
  equipe,
  porId,
}: {
  regra?: RegraPrivacidade;
  config: ConfigPrivacidade;
  equipe: readonly PessoaPrivacidade[];
  porId: ReadonlyMap<string, PessoaPrivacidade>;
}) {
  const sufixo = regra?.id ?? "nova";
  const [valorQuem, setValorQuem] = useState(
    regra ? chaveDeQuem(regra.quem) : "",
  );
  const [marcados, setMarcados] = useState<string[]>(regra?.naoVe ?? []);
  const caixas = useRef<HTMLUListElement>(null);
  // "Várias pessoas (grupo novo)": o nome e as pessoas do grupo aparecem
  // aqui mesmo, e o Criar regra grava os dois juntos. Antes era preciso
  // fechar a regra, criar o grupo em outra seção e voltar.
  const novoGrupo = valorQuem === QUEM_NOVO_GRUPO;
  const [nomeGrupo, setNomeGrupo] = useState("");
  const [membrosNovos, setMembrosNovos] = useState<string[]>([]);
  const caixasGrupo = useRef<HTMLUListElement>(null);
  const lerMembros = () => {
    const lista = caixasGrupo.current;
    if (!lista) return;
    setMembrosNovos(
      Array.from(
        lista.querySelectorAll<HTMLInputElement>(
          'input[name="grupo_membros"]:checked',
        ),
      ).map((i) => i.value),
    );
  };
  // A prévia e os avisos leem o grupo novo como se ele já existisse.
  const configPrevia: ConfigPrivacidade = novoGrupo
    ? {
        ...config,
        grupos: [
          ...config.grupos,
          {
            id: ID_PREVIA_GRUPO,
            nome: nomeGrupo.trim() || "O grupo novo",
            membros: membrosNovos,
          },
        ],
      }
    : config;
  const quem: QuemPrivacidade | null = novoGrupo
    ? { tipo: "grupo", id: ID_PREVIA_GRUPO }
    : lerQuem(valorQuem);
  const pessoaDaRegra = quem?.tipo === "pessoa" ? quem.id : null;

  const lerMarcados = () => {
    const lista = caixas.current;
    if (!lista) return;
    setMarcados(
      Array.from(
        lista.querySelectorAll<HTMLInputElement>('input[name="nao_ve"]:checked'),
      ).map((i) => i.value),
    );
  };

  // Quem já tem regra não entra de novo (uma regra por pessoa ou grupo).
  const ocupados = new Set(
    config.regras
      .filter((r) => r.id !== regra?.id)
      .map((r) => chaveDeQuem(r.quem)),
  );

  const naoVe = marcados.filter((id) => id !== pessoaDaRegra);
  const previa = !quem
    ? "Escolha a pessoa ou o grupo."
    : novoGrupo && membrosNovos.length === 0
      ? "Marque as pessoas do grupo."
      : naoVe.length === 0
        ? `Marque as pessoas cujas conversas ${nomeDeQuem(quem, configPrevia, porId)} não vê.`
        : fraseDaRegra({ quem, naoVe }, configPrevia, porId);
  const admin = quem ? avisoDeAdmin(quem, configPrevia, porId) : null;
  const atendente = quem ? avisoDeAtendente(quem, configPrevia, porId) : null;
  const proprias = quem
    ? avisoDasProprias({ quem, naoVe }, configPrevia, porId)
    : null;

  return (
    <>
      <CampoLista
        id={`privacidade-regra-quem-${sufixo}`}
        name="quem"
        label="Quem"
        value={valorQuem}
        onChange={(e) => setValorQuem(e.target.value)}
        required
      >
        <option value="" disabled>
          Escolha uma pessoa ou um grupo
        </option>
        <option value={QUEM_NOVO_GRUPO}>Várias pessoas (grupo novo)…</option>
        {config.grupos.length > 0 ? (
          <optgroup label="Grupos">
            {config.grupos.map((g) => {
              const chave = `grupo:${g.id}`;
              const rotulo = `${g.nome} (${quantasPessoas(g.membros.length)})${
                ocupados.has(chave) ? " · já tem regra" : ""
              }`;
              return (
                <option key={g.id} value={chave} disabled={ocupados.has(chave)}>
                  {rotulo}
                </option>
              );
            })}
          </optgroup>
        ) : null}
        <optgroup label="Pessoas">
          {equipe.map((p) => {
            const chave = `pessoa:${p.id}`;
            const rotulo = [
              p.nome,
              rotuloPapel(p.papel),
              p.ativo ? null : "conta desativada",
              ocupados.has(chave) ? "já tem regra" : null,
            ]
              .filter(Boolean)
              .join(" · ");
            return (
              <option key={p.id} value={chave} disabled={ocupados.has(chave)}>
                {rotulo}
              </option>
            );
          })}
        </optgroup>
      </CampoLista>

      {novoGrupo ? (
        <div className="flex flex-col gap-2 rounded-painel border border-fio p-1.5">
          <Field
            id={`privacidade-regra-grupo-nome-${sufixo}`}
            name="grupo_nome"
            label="Nome do grupo"
            value={nomeGrupo}
            onChange={(e) => setNomeGrupo(e.target.value)}
            placeholder="Aikon"
            autoComplete="off"
            maxLength={60}
            required
          />
          <fieldset className="min-w-0" onChange={lerMembros}>
            <legend className="tipo-nota px-2 pb-1 text-texto-2">
              Pessoas do grupo
            </legend>
            <ul
              ref={caixasGrupo}
              className="overflow-hidden rounded-painel bg-cartao"
            >
              {equipe.map((p) => (
                <OpcaoEscolha
                  key={p.id}
                  tipo="checkbox"
                  name="grupo_membros"
                  value={p.id}
                  defaultChecked={membrosNovos.includes(p.id)}
                >
                  <TextoPessoa pessoa={p} />
                </OpcaoEscolha>
              ))}
            </ul>
            <p className="tipo-nota px-2 pt-1 text-texto-2">
              O grupo fica salvo em Grupos de privacidade, para outras regras.
            </p>
          </fieldset>
        </div>
      ) : null}

      {/* A mudança das caixas sobe até o fieldset: a prévia acompanha. */}
      <fieldset className="min-w-0" onChange={lerMarcados}>
        <legend className="tipo-nota px-2 pb-1 text-texto-2">
          Não vê as conversas de
        </legend>
        <ul ref={caixas} className="overflow-hidden rounded-painel bg-cartao">
          {equipe
            .filter((p) => p.id !== pessoaDaRegra)
            .map((p) => (
              <OpcaoEscolha
                key={p.id}
                tipo="checkbox"
                name="nao_ve"
                value={p.id}
                defaultChecked={marcados.includes(p.id)}
              >
                <TextoPessoa pessoa={p} />
              </OpcaoEscolha>
            ))}
        </ul>
        <p className="tipo-nota px-2 pt-1 text-texto-2">
          Some a conversa e o contato em que a pessoa marcada é a responsável.
          Sem dono continua visível.
        </p>
      </fieldset>

      <div role="status" className="flex flex-col gap-0.5 px-2">
        <p className="tipo-corpo break-words text-tinta">{previa}</p>
        {admin ? <p className="tipo-nota text-atencao">{admin}</p> : null}
        {atendente ? (
          <p className="tipo-nota text-texto-2">{atendente}</p>
        ) : null}
        {proprias ? (
          <p className="tipo-nota text-texto-2">{proprias}</p>
        ) : null}
      </div>
    </>
  );
}

function EditorRegra({
  regra,
  config,
  equipe,
  porId,
}: {
  regra?: RegraPrivacidade;
  config: ConfigPrivacidade;
  equipe: readonly PessoaPrivacidade[];
  porId: ReadonlyMap<string, PessoaPrivacidade>;
}) {
  return (
    <div className="flex flex-col gap-3">
      <FormAcao
        acao={salvarRegraPrivacidade}
        fechar
        botao={regra ? "Salvar regra" : "Criar regra"}
        botaoGravando={regra ? "Salvando…" : "Criando…"}
        className="flex flex-col gap-2"
      >
        {regra ? <input type="hidden" name="id" value={regra.id} /> : null}
        <CamposRegra
          regra={regra}
          config={config}
          equipe={equipe}
          porId={porId}
        />
      </FormAcao>

      {regra ? (
        <ZonaPerigo>
          <FormAcao acao={excluirRegraPrivacidade} fechar>
            <input type="hidden" name="id" value={regra.id} />
            <ConfirmarAntes
              texto="Excluir regra"
              rotulo={`Excluir a regra de ${nomeDeQuem(regra.quem, config, porId)}`}
              pergunta={`${nomeDeQuem(regra.quem, config, porId)} volta a ver as conversas de ${listaDeNomes(
                nomesDe(
                  regra.naoVe.filter(
                    (id) => !(regra.quem.tipo === "pessoa" && id === regra.quem.id),
                  ),
                  porId,
                ),
              )}.`}
            />
          </FormAcao>
        </ZonaPerigo>
      ) : null}
    </div>
  );
}

/* ── O que a tela de Administração monta ─────────────────────────────── */

/** Os editores da privacidade, pela chave da linha que abre cada um. */
export function editoresDaPrivacidade(
  config: ConfigPrivacidade,
  equipe: readonly PessoaPrivacidade[],
): Record<string, Editor> {
  const porId = mapaDaEquipe(equipe);
  const editores: Record<string, Editor> = {
    "privacidade-grupo:novo": {
      titulo: "Novo grupo",
      conteudo: <EditorGrupo equipe={equipe} regraDoGrupo={[]} />,
    },
    "privacidade-regra:nova": {
      titulo: "Nova regra",
      conteudo: <EditorRegra config={config} equipe={equipe} porId={porId} />,
    },
  };

  for (const g of config.grupos) {
    editores[`privacidade-grupo:${g.id}`] = {
      titulo: g.nome,
      conteudo: (
        <EditorGrupo
          grupo={g}
          equipe={equipe}
          regraDoGrupo={config.regras
            .filter((r) => r.quem.tipo === "grupo" && r.quem.id === g.id)
            .map((r) => fraseDaRegra(r, config, porId))}
        />
      ),
    };
  }

  for (const r of config.regras) {
    editores[`privacidade-regra:${r.id}`] = {
      titulo: `Regra de ${nomeDeQuem(r.quem, config, porId)}`,
      conteudo: (
        <EditorRegra regra={r} config={config} equipe={equipe} porId={porId} />
      ),
    };
  }

  return editores;
}

/** Os dois grupos de linhas da lista: grupos e regras. */
export function SecoesPrivacidade({
  config,
  equipe,
}: {
  /** null: a leitura falhou (a página não cai por isso). */
  config: ConfigPrivacidade | null;
  equipe: readonly PessoaPrivacidade[];
}) {
  if (!config) {
    return (
      <Grupo id="grupo-privacidade" titulo="Privacidade">
        <LinhaInfo>
          <TextoLinha
            titulo="Não deu para ler a privacidade. Recarregue a página."
            apagado
          />
        </LinhaInfo>
      </Grupo>
    );
  }

  const porId = mapaDaEquipe(equipe);
  return (
    <>
      <Grupo
        id="grupo-privacidade-regras"
        titulo="Regras de privacidade"
        direita={
          config.regras.length > 0
            ? config.regras.length.toLocaleString("pt-BR")
            : undefined
        }
        nota="Esconde as conversas e os contatos pelo responsável. Admin vê tudo; conversa sem dono continua visível."
      >
        {config.regras.length === 0 ? (
          <LinhaInfo>
            <TextoLinha titulo="Nenhuma regra." apagado />
          </LinhaInfo>
        ) : (
          config.regras.map((r) => {
            const aviso = avisoDeAdmin(r.quem, config, porId);
            return (
              <LinhaEditor key={r.id} id={`privacidade-regra:${r.id}`}>
                {/* A frase inteira, sem cortar: é ela que diz a regra. */}
                <span className="flex min-w-0 flex-1 flex-col">
                  <span className="tipo-corpo break-words text-tinta">
                    {fraseDaRegra(r, config, porId)}
                  </span>
                  {aviso ? (
                    <span className="tipo-nota text-atencao">{aviso}</span>
                  ) : null}
                </span>
              </LinhaEditor>
            );
          })
        )}
        <LinhaNova id="privacidade-regra:nova" rotulo="Nova regra" />
      </Grupo>

      <Grupo
        id="grupo-privacidade-grupos"
        titulo="Grupos de privacidade"
        direita={
          config.grupos.length > 0
            ? config.grupos.length.toLocaleString("pt-BR")
            : undefined
        }
      >
        {config.grupos.map((g) => (
          <LinhaEditor key={g.id} id={`privacidade-grupo:${g.id}`}>
            <TextoLinha
              titulo={g.nome}
              apoio={listaDeNomes(nomesDe(g.membros, porId))}
            />
            <ValorLinha>{quantasPessoas(g.membros.length)}</ValorLinha>
          </LinhaEditor>
        ))}
        <LinhaNova id="privacidade-grupo:novo" rotulo="Novo grupo" />
      </Grupo>
    </>
  );
}
