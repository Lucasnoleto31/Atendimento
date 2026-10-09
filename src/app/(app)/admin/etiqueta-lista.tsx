"use client";

import { useId, useState } from "react";
import {
  AJUDA,
  CAMPO_BASE,
  CAMPO_SELECT,
  ROTULO,
} from "@/components/app/form-styles";
import {
  chaveDaEtiqueta,
  etiquetaDaLinha,
  MAX_NOME_ETIQUETA,
} from "@/lib/imports/etiqueta";
import { cn } from "@/lib/utils";
import {
  LinhaInfo,
  ListaEditor,
  TextoLinha,
  ValorLinha,
} from "../configuracoes/ui";
import type { PreviaImport } from "./actions";

/** Uma etiqueta nova, com o nome no campo de texto. */
const NOVA = "__nova";
/** A etiqueta de cada linha sai da coluna campanha (sem ela, do arquivo). */
const COLUNA = "__coluna";

/** Quantas etiquetas a prévia mostra uma a uma; o resto vem somado. */
const LINHAS_VISIVEIS = 5;

type Etiqueta = { id: string; nome: string };

type LinhaDistribuicao = {
  nome: string;
  contatos: number;
  /** "nova": ainda não existe e nasce na importação; "arquivada": existe,
   *  arquivada, e volta a valer (admin/actions.ts, garantirEtiquetas). */
  situacao: "nova" | "arquivada" | null;
};

type Distribuicao = {
  linhas: LinhaDistribuicao[];
  /** As que passaram de LINHAS_VISIVEIS, somadas. */
  resto: { etiquetas: number; contatos: number } | null;
};

/** As etiquetas que existem, pela chave do nome: as ativas primeiro, e a
 *  arquivada só quando nenhuma ativa tem o mesmo nome. */
function mapaDeExistentes(
  etiquetas: Etiqueta[],
  arquivadas: Etiqueta[],
): Map<string, { nome: string; arquivada: boolean }> {
  const mapa = new Map<string, { nome: string; arquivada: boolean }>();
  for (const e of etiquetas) {
    const chave = chaveDaEtiqueta(e.nome);
    if (!mapa.has(chave)) mapa.set(chave, { nome: e.nome, arquivada: false });
  }
  for (const e of arquivadas) {
    const chave = chaveDaEtiqueta(e.nome);
    if (!mapa.has(chave)) mapa.set(chave, { nome: e.nome, arquivada: true });
  }
  return mapa;
}

/**
 * Os contatos por etiqueta com a escolha atual, pela mesma regra da
 * importação (lib/imports/etiqueta.ts): a etiqueta da lista vale para todos;
 * sem ela, o nome escrito; sem nome, a campanha de cada linha e, por último,
 * o nome do arquivo. Com "Só telefones novos", só quem ainda não é contato
 * nem cliente da carteira conta (é quem recebe a etiqueta). O nome que casa com uma arquivada entra
 * nela, que volta a valer; com uma ativa e uma arquivada no mesmo nome, vale
 * a ativa, como no servidor.
 */
function distribuir({
  previa,
  escolha,
  nomeEscrito,
  nomeDoArquivo,
  etiquetas,
  arquivadas,
  somenteNovos,
}: {
  previa: PreviaImport;
  escolha: string;
  nomeEscrito: string;
  nomeDoArquivo: string;
  etiquetas: Etiqueta[];
  arquivadas: Etiqueta[];
  somenteNovos: boolean;
}): Distribuicao {
  const conta = (g: { contatos: number; novos: number | null }) =>
    somenteNovos && g.novos !== null ? g.novos : g.contatos;

  const daLista = etiquetas.find((e) => e.id === escolha);
  if (daLista) {
    const contatos = conta({
      contatos: previa.validos ?? 0,
      novos:
        previa.jaContato === null || previa.jaContato === undefined
          ? null
          : (previa.validos ?? 0) - previa.jaContato,
    });
    return {
      linhas:
        contatos > 0 ? [{ nome: daLista.nome, contatos, situacao: null }] : [],
      resto: null,
    };
  }

  // A grafia de quem já existe manda: é nela que os contatos entram.
  const existentes = mapaDeExistentes(etiquetas, arquivadas);
  const escrita = escolha === NOVA ? nomeEscrito : "";
  const porChave = new Map<string, LinhaDistribuicao>();
  const somar = (nome: string, contatos: number) => {
    const chave = chaveDaEtiqueta(nome);
    const existente = existentes.get(chave);
    const atual = porChave.get(chave) ?? {
      nome: existente?.nome ?? nome,
      contatos: 0,
      situacao: !existente ? "nova" : existente.arquivada ? "arquivada" : null,
    };
    atual.contatos += contatos;
    porChave.set(chave, atual);
  };

  for (const g of previa.porCampanha ?? []) {
    somar(etiquetaDaLinha(escrita, g.campanha, nomeDoArquivo), conta(g));
  }

  // As campanhas que a prévia mandou somadas: com nome escrito, vão todas
  // para ele; sem nome, cada uma seria uma etiqueta e ficam no "mais".
  let foraDaPrevia: { etiquetas: number; contatos: number } | null = null;
  const outras = previa.outrasCampanhas;
  if (outras) {
    if (escrita.trim()) {
      somar(etiquetaDaLinha(escrita, null, nomeDoArquivo), conta(outras));
    } else if (conta(outras) > 0) {
      foraDaPrevia = { etiquetas: outras.campanhas, contatos: conta(outras) };
    }
  }

  const todas = [...porChave.values()]
    .filter((l) => l.contatos > 0)
    .sort(
      (a, b) => b.contatos - a.contatos || a.nome.localeCompare(b.nome, "pt-BR"),
    );
  const escondidas = todas.slice(LINHAS_VISIVEIS);
  const resto =
    escondidas.length > 0 || foraDaPrevia
      ? {
          etiquetas: escondidas.length + (foraDaPrevia?.etiquetas ?? 0),
          contatos:
            escondidas.reduce((s, l) => s + l.contatos, 0) +
            (foraDaPrevia?.contatos ?? 0),
        }
      : null;
  return { linhas: todas.slice(0, LINHAS_VISIVEIS), resto };
}

/**
 * Etiqueta da lista de contatos: um campo de escolha com três caminhos, como
 * no sistema original. "Pela coluna campanha da planilha" dá a cada contato
 * a etiqueta da própria campanha (e o nome do arquivo a quem vem sem);
 * "Etiqueta nova" vale para a lista inteira, com o nome já escrito a partir
 * do arquivo; e as etiquetas que já existem.
 *
 * O padrão é sempre a coluna, como no original (a precedência: etiqueta
 * escolhida > campanha da linha > nome do arquivo), e não depende da
 * prévia. Quando dependia, a prévia que chegava trocava o campo sozinho
 * (de "Etiqueta nova", com o nome já digitado, para a coluna) e, enquanto
 * o arquivo era lido, o Importar gravava todos com o nome do arquivo. Sem a
 * coluna no arquivo, o servidor cai no nome do arquivo: o resultado é o
 * mesmo. Quem digita o nome manda nele: trocar de arquivo depois não apaga
 * o que foi escrito.
 *
 * O rótulo da primeira opção é o do original. Mede 283px na Poppins de
 * 16px, e o campo tem 297 livres no telefone de 375px. O texto pedido,
 * "Etiqueta de cada linha pela coluna campanha", pede 374 e cortava no
 * meio da palavra.
 *
 * Embaixo, os contatos por etiqueta com a escolha da tela, a partir da
 * prévia do arquivo (sem gravar nada).
 *
 * O servidor recebe os mesmos dois campos de sempre: etiqueta_id (a que já
 * existe) ou etiqueta (o nome da nova; sem ele, a campanha de cada linha e
 * depois o nome do arquivo). O formulário que a contém remonta a cada
 * resposta da importação (import-form.tsx): a escolha volta ao começo na
 * tela e no envio, juntas.
 */
export function EtiquetaLista({
  etiquetas,
  arquivadas = [],
  nomeSugerido = "",
  previa = null,
  somenteNovos = true,
}: {
  /** As ativas: são as que aparecem para escolher. */
  etiquetas: Etiqueta[];
  /** As arquivadas: não se escolhem, mas o nome que casa com uma delas a
   *  faz voltar a valer, e a prévia avisa. */
  arquivadas?: Etiqueta[];
  /** O nome do arquivo escolhido, sem a extensão. */
  nomeSugerido?: string;
  /** A prévia do arquivo; null antes da escolha e enquanto lê. */
  previa?: PreviaImport | null;
  /** O "Só telefones novos" está ligado. */
  somenteNovos?: boolean;
}) {
  // null: ninguém escolheu ainda, e vale a coluna campanha.
  const [escolhaFeita, setEscolhaFeita] = useState<string | null>(null);
  const [nome, setNome] = useState(nomeSugerido);
  const [editou, setEditou] = useState(false);
  // Arquivo novo e nome ainda não mexido: o campo acompanha o arquivo.
  const [sugestaoVista, setSugestaoVista] = useState(nomeSugerido);
  if (nomeSugerido !== sugestaoVista) {
    setSugestaoVista(nomeSugerido);
    if (!editou) setNome(nomeSugerido);
  }
  const id = useId();
  const idNome = `${id}-nome`;
  const ajudaId = `${id}-ajuda`;
  const temCampanha = previa?.temCampanha === true;
  // O nome só aparece com "Etiqueta nova", que já é uma escolha: o padrão
  // não precisa olhar para ele.
  const escolha = escolhaFeita ?? COLUNA;
  const ehNova = escolha === NOVA;
  const ehColuna = escolha === COLUNA;
  const existente =
    ehNova && nome.trim()
      ? mapaDeExistentes(etiquetas, arquivadas).get(chaveDaEtiqueta(nome))
      : undefined;

  const ajuda = ehColuna
    ? previa && !previa.erro && !temCampanha
      ? "O arquivo não tem a coluna campanha preenchida: todos entram com o nome do arquivo."
      : "Cada contato entra na etiqueta da coluna campanha da linha dele; linha sem campanha fica com o nome do arquivo."
    : ehNova
      ? existente?.arquivada
        ? `A etiqueta ${existente.nome} está arquivada: ela volta a valer e os contatos entram nela.`
        : existente
          ? `Já existe a etiqueta ${existente.nome}: os contatos entram nela.`
          : nome.trim()
            ? "A etiqueta vira o público dos disparos."
            : "Sem nome, vale a campanha de cada linha e, sem ela, o nome do arquivo."
      : "Todos os contatos da lista entram nela.";

  const distribuicao =
    previa && !previa.erro && (previa.validos ?? 0) > 0
      ? distribuir({
          previa,
          escolha,
          nomeEscrito: nome,
          nomeDoArquivo: nomeSugerido,
          etiquetas,
          arquivadas,
          somenteNovos,
        })
      : null;

  return (
    <div className="flex flex-col gap-1.5">
      <div className="flex flex-col gap-1">
        <label htmlFor={id} className={ROTULO}>
          Etiqueta da lista
        </label>

        <select
          id={id}
          value={escolha}
          aria-describedby={ajudaId}
          onChange={(e) => setEscolhaFeita(e.target.value)}
          className={cn(CAMPO_SELECT, "w-full min-w-0")}
        >
          <option value={COLUNA}>Pela coluna campanha da planilha</option>
          <option value={NOVA}>Etiqueta nova</option>
          {etiquetas.length > 0 ? (
            <optgroup label="Etiquetas que já existem">
              {etiquetas.map((e) => (
                <option key={e.id} value={e.id}>
                  {e.nome}
                </option>
              ))}
            </optgroup>
          ) : null}
        </select>

        <input
          type="hidden"
          name="etiqueta_id"
          value={ehNova || ehColuna ? "" : escolha}
        />

        {ehNova ? (
          <>
            <label htmlFor={idNome} className="sr-only">
              Nome da etiqueta nova
            </label>
            <input
              id={idNome}
              name="etiqueta"
              type="text"
              value={nome}
              onChange={(e) => {
                setNome(e.target.value);
                setEditou(true);
              }}
              maxLength={MAX_NOME_ETIQUETA}
              autoComplete="off"
              placeholder="Nome da etiqueta"
              aria-describedby={ajudaId}
              className={cn(CAMPO_BASE, "w-full min-w-0 text-base")}
            />
          </>
        ) : null}

        <p id={ajudaId} className={AJUDA}>
          {ajuda}
        </p>
      </div>

      {distribuicao ? (
        <ListaEditor
          rotulo={
            somenteNovos ? "Contatos novos por etiqueta" : "Contatos por etiqueta"
          }
        >
          {distribuicao.linhas.length === 0 ? (
            <LinhaInfo>
              <TextoLinha
                titulo={
                  somenteNovos
                    ? "Nenhum contato novo para etiquetar."
                    : "Nenhum contato para etiquetar."
                }
                apagado
              />
            </LinhaInfo>
          ) : null}
          {distribuicao.linhas.map((l) => (
            <LinhaInfo key={chaveDaEtiqueta(l.nome)}>
              <TextoLinha
                titulo={l.nome}
                apoio={
                  l.situacao === "nova"
                    ? "Etiqueta nova"
                    : l.situacao === "arquivada"
                      ? "Estava arquivada e volta a valer"
                      : undefined
                }
              />
              <ValorLinha>{l.contatos.toLocaleString("pt-BR")}</ValorLinha>
            </LinhaInfo>
          ))}
          {distribuicao.resto ? (
            <LinhaInfo>
              <TextoLinha
                titulo={
                  distribuicao.resto.etiquetas === 1
                    ? "Mais 1 etiqueta"
                    : `Mais ${distribuicao.resto.etiquetas.toLocaleString("pt-BR")} etiquetas`
                }
                apagado
              />
              <ValorLinha>
                {distribuicao.resto.contatos.toLocaleString("pt-BR")}
              </ValorLinha>
            </LinhaInfo>
          ) : null}
        </ListaEditor>
      ) : null}
    </div>
  );
}
