"use client";

import { useRef, useState, type RefObject } from "react";
import { Check, ChevronDown, Minus } from "lucide-react";
import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import { Spinner } from "@/components/ui/spinner";
import { pontoDaEtiqueta } from "@/app/(app)/contatos/cor-etiqueta";
import type { PrazoAdiar } from "@/app/(app)/chat/actions";
import { IconeDaPessoa } from "@/app/(app)/chat/fotos";
import type {
  EtiquetaCatalogo,
  MembroEquipe,
} from "@/app/(app)/chat/mensagem";
import {
  CampoBuscaMenu,
  filtrarPorNome,
  ITENS_SEM_BUSCA,
  MensagemMenu,
  PainelEscolha,
} from "./barra-filtros";
import { PRAZOS_ADIAR, ROTULO_ESCOLHER_DATA } from "./ferramentas-palco";
import { ItemAcao, ItemSecao, ItensSecao } from "./folha";
import { ItemMarcavel } from "./topo-fila";

/*
 * A seleção em massa da fila: a barra de ações no lugar do topo da fila,
 * com a caixa de "Selecionar todas", e as ações (Transferir, Etiquetas,
 * Adiar, Resolver e Lida). Escolher a ação vira a confirmação com o destino
 * escrito, na própria barra; quem executa é o chat (app.tsx), que sabe do
 * envio no ar, da fila e do badge.
 */

/** O que a confirmação da ação em massa vai fazer. */
export type AcaoMassa =
  | { tipo: "transferir"; id: string | null; nome: string }
  | {
      tipo: "etiquetas";
      por: { id: string; nome: string }[];
      tirar: { id: string; nome: string }[];
    }
  | {
      tipo: "adiar";
      prazo: PrazoAdiar;
      /** Só no prazo "data": o instante escolhido (ISO). */
      ate?: string;
      /** "por 1 hora", "até 12/10 às 15h": entra na pergunta e no aviso. */
      frase: string;
    }
  | { tipo: "resolver" }
  | { tipo: "lidas"; lidas: boolean };

/** O teto das ações em massa no servidor (MAX_EM_MASSA, em chat/actions.ts
 *  e em acoes-massa.ts): a seleção maior sai em lotes deste tamanho. */
export const LOTE_MASSA = 200;

function quantas(n: number): string {
  return n === 1 ? "1 conversa" : `${n.toLocaleString("pt-BR")} conversas`;
}

/** "VIP", "VIP e Retorno", "VIP, Retorno e Frio"; acima de três, "4
 *  etiquetas". */
function listaDeNomes(nomes: string[]): string {
  if (nomes.length > 3) return `${nomes.length.toLocaleString("pt-BR")} etiquetas`;
  if (nomes.length <= 1) return nomes[0] ?? "";
  return `${nomes.slice(0, -1).join(", ")} e ${nomes[nomes.length - 1]}`;
}

/** A pergunta da confirmação, com o destino escrito. */
export function perguntaDaMassa(a: AcaoMassa, n: number): string {
  const q = quantas(n);
  switch (a.tipo) {
    case "transferir":
      return a.id ? `Transferir ${q} para ${a.nome}?` : `Deixar ${q} sem dono?`;
    case "etiquetas": {
      const partes: string[] = [];
      if (a.por.length > 0) partes.push(`pôr ${listaDeNomes(a.por.map((t) => t.nome))}`);
      if (a.tirar.length > 0) {
        partes.push(`tirar ${listaDeNomes(a.tirar.map((t) => t.nome))}`);
      }
      return `Em ${q}, ${partes.join(", ")}?`;
    }
    case "adiar":
      return `Adiar ${q} ${a.frase}?`;
    case "resolver":
      return `Resolver ${q}?`;
    case "lidas":
      return `Marcar ${q} como ${a.lidas ? "lidas" : "não lidas"}?`;
  }
}

/** O botão que confirma: o verbo e o número. */
export function botaoDaMassa(a: AcaoMassa, n: number): string {
  const qtd = n.toLocaleString("pt-BR");
  switch (a.tipo) {
    case "transferir":
      return a.id ? `Transferir ${qtd} para ${a.nome}` : `Deixar ${qtd} sem dono`;
    case "etiquetas":
      return `Aplicar em ${qtd}`;
    case "adiar":
      return `Adiar ${qtd} ${a.frase}`;
    case "resolver":
      return `Resolver ${qtd}`;
    case "lidas":
      return `Marcar ${qtd} como ${a.lidas ? "lidas" : "não lidas"}`;
  }
}

/** O aviso depois da ação em massa: "12 conversas transferidas para Ana". */
export function avisoDaMassa(a: AcaoMassa, n: number): string {
  const q = quantas(n);
  const s = n === 1 ? "" : "s";
  switch (a.tipo) {
    case "transferir":
      return a.id ? `${q} transferida${s} para ${a.nome}` : `${q} sem dono`;
    case "etiquetas":
      return `Etiquetas aplicadas em ${q}`;
    case "adiar":
      return `${q} adiada${s} ${a.frase}`;
    case "resolver":
      return `${q} resolvida${s}`;
    case "lidas":
      return `${q} marcada${s} como ${a.lidas ? "lida" : "não lida"}${s}`;
  }
}

/**
 * Faz a ação em lotes de LOTE_MASSA, um depois do outro. Parou no meio, o
 * erro diz quantas já foram (essas ficaram gravadas).
 */
export async function emLotes(
  ids: string[],
  fazer: (lote: string[]) => Promise<{ erro?: string }>,
): Promise<{ erro?: string; feitas: number }> {
  let feitas = 0;
  for (let i = 0; i < ids.length; i += LOTE_MASSA) {
    const lote = ids.slice(i, i + LOTE_MASSA);
    let r: { erro?: string };
    try {
      r = await fazer(lote);
    } catch {
      r = { erro: "A conexão não respondeu. Tente de novo." };
    }
    if (r.erro) {
      return {
        erro:
          feitas > 0
            ? `Parou em ${feitas.toLocaleString("pt-BR")} de ${ids.length.toLocaleString("pt-BR")}. ${r.erro}`
            : r.erro,
        feitas,
      };
    }
    feitas += lote.length;
  }
  return { feitas };
}

/* ── A barra de ações ─────────────────────────────────────────────────── */

type MenuMassa = "transferir" | "etiquetas" | "adiar" | "lidas";

/** O estado de partida de cada etiqueta nas selecionadas. */
type Partida = boolean | "misto";

/** O próximo estado do toque: da partida para marcado, desmarcado e volta. */
function proximo(partida: Partida, atual: Partida): Partida {
  const ciclo: Partida[] =
    partida === true
      ? [true, false]
      : partida === false
        ? [false, true]
        : ["misto", true, false];
  return ciclo[(ciclo.indexOf(atual) + 1) % ciclo.length];
}

/** A seta dos botões que abrem escolhas, como na barra de filtros. */
function Seta() {
  return (
    <ChevronDown
      size={14}
      strokeWidth={2}
      aria-hidden
      className="-mr-0.5 shrink-0"
    />
  );
}

/**
 * A barra da seleção, no lugar do topo da fila (título, busca, escopo e
 * filtros), como no Gmail. Primeira linha: a caixa de "Selecionar todas",
 * quantas estão marcadas, com o recorte embaixo em linha fina ("Tudo · Sem
 * dono · VIP"), e o "Cancelar". Com todas as carregadas marcadas e mais
 * conversas no recorte, a linha "Marcar as 212 de Tudo" (`linhaTodas`, que o
 * chat monta). Depois, Transferir, Etiquetas, Adiar, Resolver e Lida, que
 * quebram em duas linhas na coluna de 360px em vez de cortar; sem nenhuma
 * marcada, ficam desativadas. Com uma ação escolhida, a barra vira a
 * confirmação com o destino escrito, o recorte e o "Voltar".
 */
export function BarraSelecao({
  barraRef,
  todasRef,
  menu,
  total,
  marcadas,
  foraDaTela,
  recorte,
  linhaTodas,
  confirmar,
  pendente,
  erro,
  espera,
  equipe,
  cargaPorPessoa,
  etiquetas,
  etiquetasDasMarcadas,
  aoAlternarTodas,
  aoPedir,
  aoVoltar,
  aoConfirmar,
  aoCancelar,
  aoAbrirTransferir,
  aoEscolherData,
}: {
  barraRef: RefObject<HTMLDivElement | null>;
  /** A caixa de "Selecionar todas": o foco vai para ela quando a seleção
   *  liga pelo botão ou pela paleta. */
  todasRef: RefObject<HTMLButtonElement | null>;
  /** Do tablet para cima, menu suspenso; no celular, folha. */
  menu: boolean;
  /** Quantas linhas a fila mostra (o "Selecionar todas"). */
  total: number;
  /** Quantas estão marcadas, contando as que a tela não carregou. */
  marcadas: number;
  /** Das marcadas, as que a tela não carregou ("Marcar as 212"): delas
   *  não se sabe as etiquetas, e cada etiqueta parte como "algumas têm". */
  foraDaTela: number;
  /** De onde são as marcadas: "Tudo · Sem dono · VIP". */
  recorte: string;
  /** "As 60 à vista estão marcadas. Marcar as 212 de Tudo." ou nada. */
  linhaTodas: React.ReactNode;
  confirmar: AcaoMassa | null;
  pendente: boolean;
  erro: string | null;
  /** O lote espera um envio no ar terminar. */
  espera: boolean;
  /** A equipe para transferir; null = não carregou (fica o "Sem dono"). */
  equipe: MembroEquipe[] | null;
  /** As conversas abertas de cada pessoa (gestão); null sem a coluna. */
  cargaPorPessoa: Map<string, number> | null;
  /** Só as ativas; null = não carregaram. */
  etiquetas: EtiquetaCatalogo[] | null;
  /** Em quantas das marcadas cada etiqueta já está. */
  etiquetasDasMarcadas: Map<string, number>;
  /** Marca todas as linhas à vista ou, com todas marcadas, nenhuma. */
  aoAlternarTodas: () => void;
  aoPedir: (acao: AcaoMassa) => void;
  aoVoltar: () => void;
  aoConfirmar: () => void;
  aoCancelar: () => void;
  /** O "Transferir" abriu: a carga da equipe relê. */
  aoAbrirTransferir: () => void;
  /** "Escolher data e hora…" do Adiar: o menu fecha e o diálogo abre; a
   *  data escolhida volta como pedido de confirmação. */
  aoEscolherData: () => void;
}) {
  const [aberto, setAberto] = useState<MenuMassa | null>(null);
  // O que o toque mudou em cada etiqueta, sobre a partida.
  const [mudancas, setMudancas] = useState<Map<string, Partida>>(
    () => new Map(),
  );
  const [buscaEtiqueta, setBuscaEtiqueta] = useState("");
  const [buscaPessoa, setBuscaPessoa] = useState("");
  const gatilhoTransferir = useRef<HTMLButtonElement>(null);
  const gatilhoEtiquetas = useRef<HTMLButtonElement>(null);
  const gatilhoAdiar = useRef<HTMLButtonElement>(null);
  const gatilhoLidas = useRef<HTMLButtonElement>(null);
  const nenhuma = marcadas === 0;
  const variante = menu ? "menu" : "folha";
  // A caixa de "Selecionar todas" diz das linhas à vista; as de fora da
  // tela só tiram o "nenhuma".
  const naTela = marcadas - foraDaTela;
  const todas: boolean | "misto" =
    marcadas === 0
      ? false
      : naTela >= total && total > 0
        ? true
        : "misto";

  const alternar = (qual: MenuMassa) => {
    setAberto((a) => (a === qual ? null : qual));
    if (qual === "etiquetas") {
      setMudancas(new Map());
      setBuscaEtiqueta("");
    }
    if (qual === "transferir") {
      setBuscaPessoa("");
      aoAbrirTransferir();
    }
  };
  const fechar = () => setAberto(null);
  const pedir = (acao: AcaoMassa) => {
    setAberto(null);
    aoPedir(acao);
  };

  const listaEtiquetas = etiquetas ?? [];
  // Com marcadas fora da tela, não se sabe quem já tem cada etiqueta: todas
  // partem de "algumas têm", e o toque passa por pôr e por tirar.
  const partidaDe = (id: string): Partida => {
    if (foraDaTela > 0) return "misto";
    const n = etiquetasDasMarcadas.get(id) ?? 0;
    return n === 0 ? false : n >= marcadas ? true : "misto";
  };
  const estadoDe = (id: string): Partida => mudancas.get(id) ?? partidaDe(id);
  const por = listaEtiquetas.filter(
    (t) => mudancas.has(t.id) && estadoDe(t.id) === true && partidaDe(t.id) !== true,
  );
  const tirar = listaEtiquetas.filter(
    (t) => mudancas.has(t.id) && estadoDe(t.id) === false && partidaDe(t.id) !== false,
  );
  const aplicarEtiquetas =
    listaEtiquetas.length > 0 ? (
      <Button
        className="w-full pointer-coarse:h-[44px]"
        disabled={por.length + tirar.length === 0}
        onClick={() =>
          pedir({
            tipo: "etiquetas",
            por: por.map((t) => ({ id: t.id, nome: t.nome })),
            tirar: tirar.map((t) => ({ id: t.id, nome: t.nome })),
          })
        }
      >
        Aplicar
      </Button>
    ) : null;
  const etiquetasVisiveis = filtrarPorNome(listaEtiquetas, buscaEtiqueta);

  const destinos = [{ id: "", nome: "Sem dono" }, ...(equipe ?? [])];
  // Com a busca, o menu tem um campo: vira diálogo, e os itens, botões.
  const transferirComBusca = destinos.length > ITENS_SEM_BUSCA;
  const destinosVisiveis = filtrarPorNome(destinos, buscaPessoa);

  return (
    <div
      ref={barraRef}
      role="region"
      aria-label="Conversas selecionadas"
      className="pb-0.5"
    >
      {confirmar ? (
        <div className="flex flex-col gap-1 pt-0.5">
          <div>
            <p className="tipo-corpo text-tinta">
              {perguntaDaMassa(confirmar, marcadas)}
            </p>
            {recorte ? (
              <p className="tipo-nota truncate text-texto-2">{recorte}</p>
            ) : null}
          </div>
          <div className="flex gap-1.5">
            <Button
              variant="secondary"
              disabled={pendente}
              onClick={aoVoltar}
              className="pointer-coarse:h-[44px]"
            >
              Voltar
            </Button>
            {/* Durante o lote o botão não se desativa (o carregando do
                Button desativaria): desativado, ele largava o foco no body
                por todo o lote, e o leitor de tela perdia o lugar. Fica
                aria-disabled, com o indicador, e o toque é ignorado. */}
            <Button
              className="min-w-0 flex-1 pointer-coarse:h-[44px]"
              disabled={nenhuma}
              aria-disabled={pendente || undefined}
              aria-busy={pendente || undefined}
              icone={pendente ? <Spinner tamanho={16} /> : undefined}
              onClick={() => {
                if (!pendente) aoConfirmar();
              }}
            >
              <span className="truncate">
                {pendente ? "Aplicando…" : botaoDaMassa(confirmar, marcadas)}
              </span>
            </Button>
          </div>
        </div>
      ) : (
        <>
          <div className="flex min-h-[48px] items-center gap-1">
            {/* A caixa fica na mesma coluna das caixas das linhas (16px da
                borda): o -ml-1 com o pl-1 a põe lá, num alvo de 44px. */}
            <button
              ref={todasRef}
              type="button"
              role="checkbox"
              aria-checked={todas === "misto" ? "mixed" : todas}
              aria-label={`Selecionar todas (${total.toLocaleString("pt-BR")})`}
              title={`Selecionar todas (${total.toLocaleString("pt-BR")})`}
              disabled={total === 0}
              onClick={aoAlternarTodas}
              className="group/todas -ml-1 flex h-[44px] w-[44px] shrink-0 items-center rounded-controle pl-1 transition-colors duration-[120ms] hover:bg-realce active:bg-pressionado focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-tinta disabled:cursor-not-allowed disabled:hover:bg-transparent"
            >
              <span
                aria-hidden
                className={cn(
                  "flex h-[22px] w-[22px] shrink-0 items-center justify-center rounded-celula border group-disabled/todas:border-fio",
                  todas === false
                    ? "border-fio-forte bg-fundo"
                    : "border-tinta bg-tinta text-fundo",
                )}
              >
                {todas === true ? (
                  <Check size={16} strokeWidth={2.5} />
                ) : todas === "misto" ? (
                  <Minus size={16} strokeWidth={2.5} />
                ) : null}
              </span>
            </button>
            <div className="min-w-0 flex-1">
              <p
                role="status"
                className={cn(
                  nenhuma
                    ? "tipo-corpo text-texto-2"
                    : "tipo-destaque truncate text-tinta tabular-nums",
                )}
              >
                {nenhuma
                  ? "Marque as conversas na lista"
                  : marcadas === 1
                    ? "1 selecionada"
                    : `${marcadas.toLocaleString("pt-BR")} selecionadas`}
              </p>
              {recorte ? (
                <p className="tipo-nota truncate text-texto-2">{recorte}</p>
              ) : null}
            </div>
            <Button
              variant="ghost"
              className="-mr-1 shrink-0 px-1 pointer-coarse:h-[44px]"
              disabled={pendente}
              onClick={aoCancelar}
              title="Sair da seleção (Esc)"
            >
              Cancelar
            </Button>
          </div>
          {linhaTodas}
          <div
            data-acoes-massa=""
            className="mt-0.5 flex flex-wrap gap-1 pointer-coarse:gap-1.5"
          >
            <div className="relative">
              <Button
                ref={gatilhoTransferir}
                variant="secondary"
                size="sm"
                className="gap-0.5"
                aria-haspopup={menu && !transferirComBusca ? "menu" : "dialog"}
                aria-expanded={aberto === "transferir"}
                disabled={nenhuma}
                onClick={() => alternar("transferir")}
              >
                Transferir
                <Seta />
              </Button>
              <PainelEscolha
                menu={menu}
                aberta={aberto === "transferir"}
                aoFechar={fechar}
                titulo="Transferir para"
                gatilho={gatilhoTransferir}
                papel={transferirComBusca ? "dialog" : "menu"}
                topo={
                  transferirComBusca ? (
                    <CampoBuscaMenu
                      valor={buscaPessoa}
                      aoMudar={setBuscaPessoa}
                      rotulo="Buscar pessoa"
                      placeholder="Buscar pessoa"
                    />
                  ) : null
                }
              >
                {destinosVisiveis.length === 0 ? (
                  <MensagemMenu menu={menu}>
                    Ninguém com “{buscaPessoa.trim()}”.
                  </MensagemMenu>
                ) : (
                  <ItensSecao menu={menu}>
                    {destinosVisiveis.map((p) => {
                      const carga = p.id ? cargaPorPessoa?.get(p.id) : undefined;
                      return (
                        <ItemSecao key={p.id || "ninguem"} menu={menu}>
                          <ItemAcao
                            variante={variante}
                            papel={transferirComBusca ? "button" : "menuitem"}
                            icone={
                              <IconeDaPessoa id={p.id || null} nome={p.nome} />
                            }
                            detalhe={
                              carga !== undefined ? (
                                <>
                                  {carga.toLocaleString("pt-BR")}
                                  <span className="sr-only">
                                    {carga === 1 ? " aberta" : " abertas"}
                                  </span>
                                </>
                              ) : undefined
                            }
                            onClick={() =>
                              pedir({
                                tipo: "transferir",
                                id: p.id || null,
                                nome: p.nome,
                              })
                            }
                          >
                            {p.nome}
                          </ItemAcao>
                        </ItemSecao>
                      );
                    })}
                  </ItensSecao>
                )}
                {equipe === null ? (
                  <MensagemMenu menu={menu} erro>
                    Não deu para carregar a equipe.
                  </MensagemMenu>
                ) : null}
              </PainelEscolha>
            </div>
            <div className="relative">
              <Button
                ref={gatilhoEtiquetas}
                variant="secondary"
                size="sm"
                className="gap-0.5"
                aria-haspopup="dialog"
                aria-expanded={aberto === "etiquetas"}
                disabled={nenhuma}
                onClick={() => alternar("etiquetas")}
              >
                Etiquetas
                <Seta />
              </Button>
              <PainelEscolha
                menu={menu}
                aberta={aberto === "etiquetas"}
                aoFechar={fechar}
                titulo="Etiquetas"
                gatilho={gatilhoEtiquetas}
                topo={
                  listaEtiquetas.length > ITENS_SEM_BUSCA ? (
                    <CampoBuscaMenu
                      valor={buscaEtiqueta}
                      aoMudar={setBuscaEtiqueta}
                      rotulo="Buscar etiqueta"
                      placeholder="Buscar etiqueta"
                    />
                  ) : null
                }
                pe={aplicarEtiquetas}
                rodapeFolha={aplicarEtiquetas}
              >
                {etiquetas === null ? (
                  <MensagemMenu menu={menu} erro>
                    Não deu para carregar as etiquetas.
                  </MensagemMenu>
                ) : listaEtiquetas.length === 0 ? (
                  <MensagemMenu menu={menu}>
                    Nenhuma etiqueta cadastrada.
                  </MensagemMenu>
                ) : etiquetasVisiveis.length === 0 ? (
                  <MensagemMenu menu={menu}>
                    Nenhuma etiqueta com “{buscaEtiqueta.trim()}”.
                  </MensagemMenu>
                ) : (
                  <ItensSecao menu={menu}>
                    {etiquetasVisiveis.map((t) => (
                      <ItemSecao key={t.id} menu={menu}>
                        <ItemMarcavel
                          menu={menu}
                          estado={estadoDe(t.id)}
                          ponto={pontoDaEtiqueta(t.cor)}
                          onClick={() =>
                            setMudancas((m) => {
                              const novo = new Map(m);
                              const seguinte = proximo(
                                partidaDe(t.id),
                                estadoDe(t.id),
                              );
                              if (seguinte === partidaDe(t.id)) novo.delete(t.id);
                              else novo.set(t.id, seguinte);
                              return novo;
                            })
                          }
                        >
                          {t.nome}
                        </ItemMarcavel>
                      </ItemSecao>
                    ))}
                  </ItensSecao>
                )}
              </PainelEscolha>
            </div>
            <div className="relative">
              <Button
                ref={gatilhoAdiar}
                variant="secondary"
                size="sm"
                className="gap-0.5"
                aria-haspopup={menu ? "menu" : "dialog"}
                aria-expanded={aberto === "adiar"}
                disabled={nenhuma}
                onClick={() => alternar("adiar")}
              >
                Adiar
                <Seta />
              </Button>
              <PainelEscolha
                menu={menu}
                aberta={aberto === "adiar"}
                aoFechar={fechar}
                titulo="Adiar até quando"
                gatilho={gatilhoAdiar}
                papel="menu"
                largura="w-[260px]"
              >
                <ItensSecao menu={menu}>
                  {PRAZOS_ADIAR.map((p) => (
                    <ItemSecao key={p.prazo} menu={menu}>
                      <ItemAcao
                        variante={variante}
                        onClick={() =>
                          pedir({ tipo: "adiar", prazo: p.prazo, frase: p.frase })
                        }
                      >
                        {p.rotulo}
                      </ItemAcao>
                    </ItemSecao>
                  ))}
                  <ItemSecao menu={menu}>
                    <ItemAcao
                      variante={variante}
                      aria-haspopup="dialog"
                      onClick={() => {
                        setAberto(null);
                        aoEscolherData();
                      }}
                    >
                      {ROTULO_ESCOLHER_DATA}
                    </ItemAcao>
                  </ItemSecao>
                </ItensSecao>
              </PainelEscolha>
            </div>
            <Button
              variant="secondary"
              size="sm"
              disabled={nenhuma}
              onClick={() => pedir({ tipo: "resolver" })}
            >
              Resolver
            </Button>
            <div className="relative">
              <Button
                ref={gatilhoLidas}
                variant="secondary"
                size="sm"
                className="gap-0.5"
                aria-label="Marcar como lida ou não lida"
                aria-haspopup={menu ? "menu" : "dialog"}
                aria-expanded={aberto === "lidas"}
                disabled={nenhuma}
                onClick={() => alternar("lidas")}
              >
                Lida
                <Seta />
              </Button>
              <PainelEscolha
                menu={menu}
                aberta={aberto === "lidas"}
                aoFechar={fechar}
                titulo="Marcar como"
                gatilho={gatilhoLidas}
                papel="menu"
                alinhar="fim"
                largura="w-[240px]"
              >
                <ItensSecao menu={menu}>
                  <ItemSecao menu={menu}>
                    <ItemAcao
                      variante={variante}
                      onClick={() => pedir({ tipo: "lidas", lidas: true })}
                    >
                      Marcar como lida
                    </ItemAcao>
                  </ItemSecao>
                  <ItemSecao menu={menu}>
                    <ItemAcao
                      variante={variante}
                      onClick={() => pedir({ tipo: "lidas", lidas: false })}
                    >
                      Marcar como não lida
                    </ItemAcao>
                  </ItemSecao>
                </ItensSecao>
              </PainelEscolha>
            </div>
          </div>
        </>
      )}
      {erro ? (
        <p role="alert" className="tipo-nota pt-1 text-erro">
          {erro}
        </p>
      ) : null}
      <p role="status" className="tipo-nota pt-0.5 text-texto-2 empty:sr-only">
        {espera ? "Esperando o envio terminar." : ""}
      </p>
    </div>
  );
}
