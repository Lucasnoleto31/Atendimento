"use client";

import {
  useActionState,
  useId,
  useRef,
  useState,
  useTransition,
  type ReactNode,
} from "react";
import { useFormStatus } from "react-dom";
import { Download, Megaphone, Users } from "lucide-react";
import { Button, classesDoBotao } from "@/components/ui/button";
import { Spinner } from "@/components/ui/spinner";
import { AJUDA, ROTULO } from "@/components/app/form-styles";
import {
  LinhaInfo,
  LinhaLink,
  ListaEditor,
  TextoLinha,
  ValorLinha,
} from "../configuracoes/ui";
import {
  juntarEtiquetas,
  MODELO_CSV_HREF,
  MODELO_CSV_NOME,
  nomeSemExtensao,
} from "@/lib/imports/etiqueta";
import { contagem } from "../configuracoes/resultado";
import { MAX_IDS_FILTRO } from "../contatos/filtros";
import {
  previaImportacao,
  type PreviaImport,
  type ResultadoImport,
} from "./actions";

const ESTADO_INICIAL: ResultadoImport = {};

/** 1.234: contagem no formato brasileiro. */
function numero(valor: number | undefined | null) {
  return (valor ?? 0).toLocaleString("pt-BR");
}

/** O que o formulário sabe do arquivo, para os campos próprios dele. */
export type ContextoImport = {
  /** O nome do arquivo escolhido, sem a extensão ("" antes da escolha). */
  nomeDoArquivo: string;
  /** A prévia do arquivo; null antes da escolha e enquanto lê. */
  previa: PreviaImport | null;
  /** O "Só telefones novos" (name="somente_novos") está ligado. */
  somenteNovos: boolean;
};

function BotaoEnviar({ rotulo }: { rotulo: string }) {
  const { pending } = useFormStatus();
  return (
    <Button
      type="submit"
      size="lg"
      carregando={pending}
      className="w-full lg:h-[40px] lg:w-auto lg:self-start lg:px-2 lg:text-sm"
    >
      {pending ? "Importando…" : rotulo}
    </Button>
  );
}

/** A linha de exemplo do modelo, esquecida no arquivo: fica de fora
 *  (lib/imports/leads.ts). */
function LinhaExemplo({ quantas }: { quantas: number }) {
  return (
    <LinhaInfo>
      <TextoLinha
        titulo={
          quantas === 1
            ? "Linha de exemplo do modelo"
            : "Linhas de exemplo do modelo"
        }
        apoio="Fica de fora da importação"
      />
      <ValorLinha>{numero(quantas)}</ValorLinha>
    </LinhaInfo>
  );
}

/**
 * A prévia do arquivo escolhido, antes de gravar: quantas linhas, quantos
 * telefones servem, quantos já são contato, as colunas que foram
 * reconhecidas e as primeiras linhas com problema.
 */
function PreviaArquivo({
  previa,
  lendo,
}: {
  previa: PreviaImport | null;
  lendo: boolean;
}) {
  if (lendo) {
    return (
      <p
        role="status"
        className="tipo-nota inline-flex items-center gap-1 px-2 text-texto-2"
      >
        <Spinner tamanho={14} />
        Lendo o arquivo…
      </p>
    );
  }
  if (!previa) return <p role="status" className="sr-only" />;
  if (previa.erro) {
    return (
      <p role="alert" className="tipo-nota px-2 text-erro">
        {previa.erro}
      </p>
    );
  }
  return (
    <div role="status" className="flex flex-col gap-1">
      <ListaEditor rotulo="O que vai entrar">
        <LinhaInfo>
          <TextoLinha
            titulo="Telefones válidos"
            apoio={`de ${contagem(previa.linhas ?? 0, "linha", "linhas")}${
              previa.aba ? `, aba ${previa.aba}` : ""
            }`}
          />
          <ValorLinha>{numero(previa.validos)}</ValorLinha>
        </LinhaInfo>
        {/* jaContato soma contato e cliente da carteira; o cliente sem
            contato aparece à parte, como no sistema original. */}
        {previa.jaContato !== null && previa.jaContato !== undefined ? (
          <LinhaInfo>
            <TextoLinha titulo="Já são contato" />
            <ValorLinha>
              {numero(previa.jaContato - (previa.jaCliente ?? 0))}
            </ValorLinha>
          </LinhaInfo>
        ) : null}
        {previa.jaCliente ? (
          <LinhaInfo>
            <TextoLinha
              titulo="Já são cliente da carteira"
              apoio="Com “Só telefones novos”, ficam de fora"
            />
            <ValorLinha>{numero(previa.jaCliente)}</ValorLinha>
          </LinhaInfo>
        ) : null}
        {previa.duplicados ? (
          <LinhaInfo>
            <TextoLinha titulo="Repetidos no arquivo" />
            <ValorLinha>{numero(previa.duplicados)}</ValorLinha>
          </LinhaInfo>
        ) : null}
        {previa.exemplo ? <LinhaExemplo quantas={previa.exemplo} /> : null}
        <LinhaInfo>
          <TextoLinha titulo="Colunas reconhecidas" />
          <span className="tipo-corpo min-w-0 truncate text-right text-texto-2">
            {previa.colunas?.join(", ") || "nenhuma"}
          </span>
        </LinhaInfo>
        {previa.totalProblemas ? (
          <LinhaInfo>
            <TextoLinha titulo="Linhas com problema" />
            <ValorLinha tom="atencao">{numero(previa.totalProblemas)}</ValorLinha>
          </LinhaInfo>
        ) : null}
      </ListaEditor>
      {previa.problemas?.length ? (
        <ul className="tipo-nota flex flex-col gap-0.5 px-2 text-texto-2">
          {previa.problemas.map((p) => (
            <li key={p}>{p}</li>
          ))}
        </ul>
      ) : null}
    </div>
  );
}

/**
 * O formulário de importação de contatos, dentro do editor de
 * Administração › Importar contatos. Em dois tempos: escolhido o arquivo, a
 * prévia mostra o que vai entrar (sem gravar) e quantos contatos vão para
 * cada etiqueta com a escolha da tela; Importar grava. Embaixo do arquivo,
 * as colunas aceitas e o modelo da planilha, gerado aqui mesmo. O resultado
 * leva aos contatos que entraram e ao disparo, que é o motivo de importar.
 */
export function ImportForm({
  acao,
  extras,
  rotulo,
  ajudaArquivo,
}: {
  acao: (
    estado: ResultadoImport,
    formData: FormData,
  ) => Promise<ResultadoImport>;
  /** Campos próprios do formulário, entre o arquivo e o botão. Recebe o
   *  que o formulário sabe do arquivo (ContextoImport). */
  extras?: ReactNode | ((contexto: ContextoImport) => ReactNode);
  rotulo: string;
  ajudaArquivo: string;
}) {
  const [estado, formAction] = useActionState(acao, ESTADO_INICIAL);
  const inputId = useId();
  const ajudaId = `${inputId}-ajuda`;
  const [nomeArquivo, setNomeArquivo] = useState("");
  const [previa, setPrevia] = useState<PreviaImport | null>(null);
  // O "Só telefones novos" começa ligado (importar/tela.tsx); a prévia por
  // etiqueta conta só os novos enquanto ele estiver assim.
  const [somenteNovos, setSomenteNovos] = useState(true);
  const [lendo, iniciarLeitura] = useTransition();
  // Trocou de arquivo antes de a prévia do anterior chegar: só a última
  // leitura vale.
  const leitura = useRef(0);

  // O React 19 reseta o formulário a cada envio, deu certo ou não, mas não
  // o estado dos campos controlados lá dentro: o select da etiqueta voltava
  // na tela e o envio seguinte levava a etiqueta da importação anterior (a
  // segunda planilha do dia entrava no público de outra campanha). Remontar
  // a cada resposta nova põe tela e envio de acordo; a prévia e o nome do
  // arquivo voltam ao começo junto. Toda resposta do servidor chega como
  // objeto novo.
  const [versao, setVersao] = useState(0);
  const [respostaVista, setRespostaVista] = useState(estado);
  if (estado !== respostaVista) {
    setRespostaVista(estado);
    setVersao((v) => v + 1);
    setNomeArquivo("");
    setPrevia(null);
    setSomenteNovos(true);
  }

  const lerPrevia = (arquivo: File | undefined) => {
    setNomeArquivo(arquivo ? nomeSemExtensao(arquivo.name) : "");
    if (!arquivo) {
      setPrevia(null);
      return;
    }
    const dados = new FormData();
    dados.set("arquivo", arquivo);
    leitura.current += 1;
    const esta = leitura.current;
    iniciarLeitura(async () => {
      const r = await previaImportacao(dados).catch(() => ({
        erro: "Não deu para ler o arquivo. Tente de novo.",
      }));
      if (esta === leitura.current) setPrevia(r);
    });
  };

  // "Ver os contatos" com as etiquetas da lista (qualquer uma delas). O
  // filtro de Contatos aceita até MAX_IDS_FILTRO e corta o resto pela ordem
  // do id: o link já leva só as que mais receberam contatos (a lista vem
  // nessa ordem) e a linha avisa.
  const etiquetaIds = estado.ok ? (estado.etiquetaIds ?? []) : [];
  const idsDoLink = etiquetaIds.slice(0, MAX_IDS_FILTRO);
  const etiquetados = estado.etiquetados ?? 0;
  const aplicadas = estado.etiquetasAplicadas ?? [];

  return (
    <div className="flex flex-col gap-3">
      <form
        key={versao}
        action={formAction}
        onChange={(e) => {
          const campo = e.target;
          if (
            campo instanceof HTMLInputElement &&
            campo.name === "somente_novos"
          ) {
            setSomenteNovos(campo.checked);
          }
        }}
        className="flex flex-col gap-2"
      >
        <div className="flex flex-col gap-1">
          <label htmlFor={inputId} className={ROTULO}>
            Arquivo
          </label>
          <input
            id={inputId}
            name="arquivo"
            type="file"
            aria-describedby={ajudaId}
            accept=".csv,.xlsx,text/csv,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"
            required
            onChange={(e) => lerPrevia(e.currentTarget.files?.[0])}
            className="tipo-corpo block w-full min-w-0 cursor-pointer rounded-controle border border-dashed border-fio-forte bg-fundo p-0.5 text-texto-2 transition-colors duration-[120ms] file:mr-1.5 file:h-[40px] file:cursor-pointer file:rounded-celula file:border file:border-fio-forte file:bg-transparent file:px-1.5 file:text-sm file:font-semibold file:text-tinta hover:border-texto-3 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-tinta"
          />
          <p id={ajudaId} className={AJUDA}>
            {ajudaArquivo}
          </p>
          {/* O modelo sai do próprio navegador (data:), sem rota nova. */}
          <a
            href={MODELO_CSV_HREF}
            download={MODELO_CSV_NOME}
            className={classesDoBotao({
              variant: "secondary",
              size: "sm",
              className: "mt-0.5 self-start",
            })}
          >
            <Download size={16} strokeWidth={1.75} aria-hidden />
            Baixar modelo (.csv)
          </a>
        </div>

        <PreviaArquivo previa={previa} lendo={lendo} />

        {typeof extras === "function"
          ? extras({
              nomeDoArquivo: nomeArquivo,
              previa: lendo ? null : previa,
              somenteNovos,
            })
          : extras}

        <BotaoEnviar rotulo={rotulo} />
      </form>

      {estado.erro ? (
        <div role="alert" className="flex flex-col gap-1">
          <p className="tipo-corpo text-erro">{estado.erro}</p>
          {estado.exemplosErro?.length ? (
            <ul className="tipo-nota flex flex-col gap-0.5 text-texto-2">
              {estado.exemplosErro.map((e) => (
                <li key={e}>{e}</li>
              ))}
            </ul>
          ) : null}
        </div>
      ) : null}

      {estado.ok ? (
        <div role="status" className="flex flex-col gap-1.5">
          <ListaEditor rotulo="Última importação">
            <LinhaInfo>
              <TextoLinha titulo="Linhas importadas" />
              <ValorLinha>
                {numero(estado.linhasOk)} de {numero(estado.totalLinhas)}
              </ValorLinha>
            </LinhaInfo>
            {estado.leadsNovos !== undefined ? (
              <LinhaInfo>
                <TextoLinha titulo="Contatos novos" />
                <ValorLinha>{numero(estado.leadsNovos)}</ValorLinha>
              </LinhaInfo>
            ) : null}
            {/* leadsAtualizados inclui o cliente da carteira deixado de
                fora; ele aparece na linha de baixo. */}
            {(estado.leadsAtualizados ?? 0) - (estado.jaEramClientes ?? 0) >
            0 ? (
              <LinhaInfo>
                <TextoLinha
                  titulo="Já eram contato"
                  apoio={
                    estado.leadsIntactos
                      ? "Ficaram como estavam"
                      : "Ganharam a etiqueta da lista"
                  }
                />
                <ValorLinha>
                  {numero(
                    (estado.leadsAtualizados ?? 0) -
                      (estado.jaEramClientes ?? 0),
                  )}
                </ValorLinha>
              </LinhaInfo>
            ) : null}
            {estado.jaEramClientes ? (
              <LinhaInfo>
                <TextoLinha
                  titulo="Já eram cliente da carteira"
                  apoio="Ficaram de fora"
                />
                <ValorLinha>{numero(estado.jaEramClientes)}</ValorLinha>
              </LinhaInfo>
            ) : null}
            {estado.duplicadosNoArquivo ? (
              <LinhaInfo>
                <TextoLinha titulo="Repetidos no arquivo" />
                <ValorLinha>{numero(estado.duplicadosNoArquivo)}</ValorLinha>
              </LinhaInfo>
            ) : null}
            {estado.linhasExemplo ? (
              <LinhaExemplo quantas={estado.linhasExemplo} />
            ) : null}
            {estado.linhasErro ? (
              <LinhaInfo>
                <TextoLinha titulo="Linhas com problema" />
                <ValorLinha tom="atencao">{numero(estado.linhasErro)}</ValorLinha>
              </LinhaInfo>
            ) : null}
            {aplicadas.length === 1 ? (
              <LinhaInfo>
                <TextoLinha titulo="Etiqueta" />
                <span className="tipo-corpo min-w-0 truncate text-right text-texto-2">
                  {aplicadas[0]}
                </span>
              </LinhaInfo>
            ) : aplicadas.length > 1 ? (
              <LinhaInfo>
                <TextoLinha
                  titulo="Etiquetas"
                  apoio={juntarEtiquetas(aplicadas)}
                />
                <ValorLinha>{numero(aplicadas.length)}</ValorLinha>
              </LinhaInfo>
            ) : null}
          </ListaEditor>

          {estado.exemplosErro?.length ? (
            <ul className="tipo-nota flex flex-col gap-0.5 px-2 text-texto-2">
              {estado.exemplosErro.map((e) => (
                <li key={e}>{e}</li>
              ))}
            </ul>
          ) : null}

          {/* O próximo passo: ver quem entrou e mandar a campanha. */}
          {etiquetaIds.length > 0 && etiquetados > 0 ? (
            <ListaEditor rotulo="Depois de importar">
              <LinhaLink
                href={`/contatos?etiquetas=${encodeURIComponent(idsDoLink.join(","))}`}
              >
                <Users
                  size={20}
                  strokeWidth={1.75}
                  aria-hidden
                  className="-ml-0.5 shrink-0 text-texto-2"
                />
                {/* Sem número no título: a lista filtra pela etiqueta e
                    traz também quem já a tinha (a "Lista VIP" com 500
                    contatos e 10 novos mostra 510). */}
                <TextoLinha
                  titulo="Ver os contatos"
                  apoio={
                    etiquetaIds.length === 1
                      ? "Todos com a etiqueta da lista"
                      : etiquetaIds.length > idsDoLink.length
                        ? `Das ${MAX_IDS_FILTRO.toLocaleString("pt-BR")} etiquetas que mais receberam`
                        : "Todos com uma das etiquetas da lista"
                  }
                />
              </LinhaLink>
              {/* Disparos ainda não abre a campanha nova com a etiqueta
                  escolhida pelo endereço: a linha só leva até lá e diz o
                  passo que falta. */}
              <LinhaLink href="/campanhas">
                <Megaphone
                  size={20}
                  strokeWidth={1.75}
                  aria-hidden
                  className="-ml-0.5 shrink-0 text-texto-2"
                />
                <TextoLinha
                  titulo="Ir para Disparos"
                  apoio={
                    aplicadas.length === 1
                      ? `Em Nova campanha, escolha “${aplicadas[0]}” como público`
                      : "Em Nova campanha, escolha uma das etiquetas como público"
                  }
                />
              </LinhaLink>
            </ListaEditor>
          ) : null}
        </div>
      ) : null}
    </div>
  );
}
