"use client";

import { useEffect, useRef, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Search, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Spinner } from "@/components/ui/spinner";
import { useComandosDaTela } from "@/components/app/paleta-global";
import { CAMPO } from "@/components/app/form-styles";
import { cn } from "@/lib/utils";
import {
  contarFiltros,
  FILTROS_VAZIOS,
  urlContatos,
  type FiltrosContatos,
} from "./filtros";
import type { EtiquetaCatalogo } from "./lista-contatos";
import {
  FunilFiltrosContatos,
  PilulasFiltrosContatos,
  type CampanhaDoFiltro,
  type FiltroAbertoContatos,
  type MembroDoFiltro,
  type Opcao,
  type PropsFiltrosContatos,
} from "./barra-filtros-contatos";
import { useRastro, useRelerSeMudou } from "./rastro";
import { useSelecaoLigada } from "./selecao-na-tela";

/** Respiro entre a última tecla e a busca: uma consulta por pausa. */
const RESPIRO_MS = 300;

const numero = new Intl.NumberFormat("pt-BR");

/** O tamanho da lista na tela: o total até esta página e se há mais. */
export type ResultadoLista = { total: number; mais: boolean };

/**
 * Busca e filtros da lista de contatos. A URL continua sendo a fonte dos
 * filtros (a página lê de lá, o CSV também, e o ?voltar= da ficha guarda a
 * lista como estava): digitar troca a URL depois do respiro, e cada escolha
 * num menu da barra troca na hora. Sem botão de filtrar.
 *
 * Os filtros são os da fila do chat (barra-filtros-contatos.tsx): o funil à
 * direita da busca e, embaixo dela, só as pílulas dos filtros ligados.
 * Enquanto a lista nova não chega, a tela já mostra os filtros pedidos: a
 * caixa marcada não pisca de volta no meio de dois toques seguidos.
 *
 * Sem JavaScript a busca continua valendo: é um GET para /contatos com os
 * mesmos nomes de campo (os filtros ligados vão junto, ocultos), e o Enter
 * envia.
 */
export function FiltrosLista({
  filtros,
  etiquetas,
  equipe,
  nomesEquipe,
  campanhas,
  filtraResponsavel,
  resultado,
  novo,
  chave,
}: {
  filtros: FiltrosContatos;
  /** O catálogo inteiro (o nome no botão); o menu oferece as ativas e a
   *  arquivada que está no filtro. null = a leitura falhou. */
  etiquetas: EtiquetaCatalogo[] | null;
  /** Quem pode virar filtro de responsável (sem os donos ocultos); null =
   *  a leitura falhou. */
  equipe: Opcao[] | null;
  /** Os nomes dos responsáveis que vieram na URL: a equipe ativa com os
   *  donos ocultos, mais os desativados do filtro. null = a leitura falhou. */
  nomesEquipe: MembroDoFiltro[] | null;
  /** As campanhas mais recentes; null = a leitura falhou. */
  campanhas: CampanhaDoFiltro[] | null;
  /** O papel vê contatos de outras pessoas e escolhe responsáveis. Sem
   *  isso (o atendente), o botão só aparece com responsáveis vindos na
   *  URL, para tirar o recorte. */
  filtraResponsavel: boolean;
  /** Para o pé da folha no celular; null quando não se sabe (erro, página
   *  vazia). */
  resultado: ResultadoLista | null;
  /** Endereço do cadastro, para a paleta (null: o papel não cadastra). */
  novo: string | null;
  /** A lista como está (filtros e página): o rastro do "← Contatos" da
   *  ficha (rastro.ts) grava a passagem a cada troca. */
  chave: string;
}) {
  const router = useRouter();
  const [pendente, iniciar] = useTransition();
  const campo = useRef<HTMLInputElement>(null);
  const funilRef = useRef<HTMLButtonElement>(null);
  const relogio = useRef<ReturnType<typeof setTimeout> | null>(null);

  const [texto, setTexto] = useState(filtros.busca);
  // A última busca mandada para a URL. A resposta de uma busca chega
  // enquanto a pessoa ainda digita: se fosse copiada para o campo, apagaria
  // as letras digitadas depois dela.
  const [enviado, setEnviado] = useState(filtros.busca);
  // Os filtros pedidos, à frente da URL enquanto a lista nova viaja.
  const [atuais, setAtuais] = useState(filtros);

  // O que está aberto nos filtros (um por vez): a lista do funil ou o
  // menu de um filtro.
  const [filtroAberto, setFiltroAberto] =
    useState<FiltroAbertoContatos | null>(null);

  useRastro(chave);
  // Voltou da ficha que mudou um contato: a lista do cache relê uma vez.
  useRelerSeMudou();

  // A URL mudou por fora (Limpar filtros da lista vazia, o voltar): os
  // campos seguem a URL. Ajuste na renderização, sem efeito, para não
  // piscar; e só com a navegação parada, senão a resposta de um toque
  // desfaria o toque seguinte, ainda a caminho.
  const [daUrl, setDaUrl] = useState(() => urlContatos(filtros));
  const urlAgora = urlContatos(filtros);
  if (!pendente && urlAgora !== daUrl) {
    setDaUrl(urlAgora);
    if (filtros.busca !== enviado) {
      setTexto(filtros.busca);
      setEnviado(filtros.busca);
    }
    // Sem etiqueta marcada a URL não leva o modo das etiquetas (o contrato
    // da fila). Chegou a URL que a própria tela pediu: o modo fica o da
    // tela, como na fila (desmarcar a última etiqueta não volta o seletor
    // para "Qualquer uma"). Veio de fora: vale a URL inteira.
    setAtuais(
      urlAgora === urlContatos(atuais)
        ? { ...filtros, etiquetasModo: atuais.etiquetasModo }
        : filtros,
    );
  }

  function cancelarRespiro() {
    if (relogio.current) clearTimeout(relogio.current);
    relogio.current = null;
  }

  function navegar(mudanca: Partial<FiltrosContatos>) {
    cancelarRespiro();
    // A mesma limpeza do lerFiltros, para comparar com o que a URL terá.
    const busca = (mudanca.busca ?? texto).trim().slice(0, 120);
    const proximo: FiltrosContatos = { ...atuais, ...mudanca, busca };
    if (!proximo.de && !proximo.ate) proximo.data = "interacao";
    // Espaço a mais no fim da busca não é busca nova; o mesmo filtro
    // tocado duas vezes, também não. A troca que não muda o endereço (o
    // modo das etiquetas sem etiqueta marcada) só muda a tela, sem
    // recarregar a lista, como na fila.
    if (urlContatos(proximo) === urlContatos({ ...atuais, busca: enviado })) {
      setAtuais(proximo);
      return;
    }
    setEnviado(busca);
    setAtuais(proximo);
    // replace: cada letra não vira uma entrada no histórico. A lista volta à
    // primeira página, porque a página 3 de outro filtro não quer dizer nada.
    iniciar(() => router.replace(urlContatos(proximo), { scroll: false }));
  }

  // Tira os filtros da barra; a busca fica (ela tem o X dela).
  const limparFiltros = () =>
    navegar({ ...FILTROS_VAZIOS, busca: texto });

  // O respiro pendente não dispara depois que a tela sai.
  useEffect(() => {
    const r = relogio;
    return () => {
      if (r.current) clearTimeout(r.current);
    };
  }, []);

  // "/" leva à busca, fora de campo e sem diálogo nem menu aberto (com o
  // menu aberto, a tecla é dele).
  useEffect(() => {
    function aoTeclar(e: KeyboardEvent) {
      if (e.key !== "/" || e.ctrlKey || e.metaKey || e.altKey) return;
      if (e.defaultPrevented) return;
      const alvo = e.target as HTMLElement | null;
      if (
        alvo &&
        (alvo.isContentEditable ||
          ["INPUT", "TEXTAREA", "SELECT"].includes(alvo.tagName))
      ) {
        return;
      }
      if (
        document.querySelector(
          '[aria-modal="true"], dialog[open], [data-popover]',
        )
      ) {
        return;
      }
      // Na seleção a busca sai de cena (a barra da seleção toma o topo): a
      // tecla segue livre.
      if (!campo.current || campo.current.offsetParent === null) return;
      e.preventDefault();
      campo.current.focus();
      campo.current.select();
    }
    window.addEventListener("keydown", aoTeclar);
    return () => window.removeEventListener("keydown", aoTeclar);
  }, []);

  const ativos = contarFiltros(atuais);

  // Os comandos desta tela na paleta (⌘K / Ctrl+K). Na seleção, a busca e
  // o funil saem de cena (a barra da seleção toma o topo), e os comandos
  // deles saem da paleta até ela acabar. A conferência de estar à vista
  // fica para o instante entre o aviso da seleção e o efeito da paleta.
  const selecionando = useSelecaoLigada();
  const aVista = (el: HTMLElement | null) =>
    el !== null && el.offsetParent !== null;
  const focarBusca = () => {
    if (!aVista(campo.current)) return;
    campo.current?.focus();
    campo.current?.select();
  };
  useComandosDaTela([
    ...(selecionando
      ? []
      : [
          {
            id: "contatos-buscar",
            rotulo: "Buscar nesta lista",
            grupo: "Contatos",
            atalho: "/",
            executar: focarBusca,
          },
          {
            // Abre a lista do funil, como o "Filtros da fila" no chat.
            id: "contatos-filtros",
            rotulo: "Filtrar contatos",
            grupo: "Contatos",
            executar: () => {
              if (aVista(funilRef.current)) setFiltroAberto({ qual: "lista" });
            },
          },
        ]),
    ...(ativos > 0
      ? [
          {
            id: "contatos-limpar-filtros",
            rotulo: "Limpar filtros",
            grupo: "Contatos",
            executar: limparFiltros,
          },
        ]
      : []),
    ...(novo
      ? [
          {
            id: "contatos-novo",
            rotulo: "Novo contato",
            grupo: "Contatos",
            executar: () => router.push(novo),
          },
        ]
      : []),
  ]);

  // O pé da folha de Etiquetas e de Responsáveis no celular (as escolhas
  // múltiplas, que ficam abertas para combinar): quantos contatos a lista
  // mostra com o que está escolhido, e o toque fecha a folha sobre eles.
  const rodapeFiltros = (
    <Button
      className="w-full pointer-coarse:h-[44px]"
      onClick={() => setFiltroAberto(null)}
    >
      {pendente
        ? "Filtrando…"
        : resultado === null
          ? "Ver contatos"
          : resultado.total === 0
            ? "Fechar"
            : `Ver ${numero.format(resultado.total)}${resultado.mais ? "+" : ""} ${resultado.total === 1 && !resultado.mais ? "contato" : "contatos"}`}
    </Button>
  );

  // Os filtros ligados vão no GET da busca sem JavaScript.
  const camposOcultos = [
    ...new URLSearchParams(
      urlContatos({ ...atuais, busca: "" }).split("?")[1] ?? "",
    ).entries(),
  ];

  const propsFiltros: PropsFiltrosContatos = {
    filtros: atuais,
    aberto: filtroAberto,
    aoAbrir: setFiltroAberto,
    escolheResponsaveis: filtraResponsavel,
    equipe,
    nomesEquipe,
    etiquetas,
    campanhas,
    aoMudar: navegar,
    aoLimpar: limparFiltros,
    funilRef,
    rodapeFolha: rodapeFiltros,
  };

  return (
    <div data-pendente={pendente ? "" : undefined}>
      {/* A busca e o funil na mesma linha: o campo estica até o funil no
          telefone e para em 320px do tablet para cima. 12px de vão no
          toque, 8 no mouse. */}
      <div className="flex items-center gap-1 pointer-coarse:gap-1.5">
        <form
          role="search"
          action="/contatos"
          method="get"
          onSubmit={(e) => {
            e.preventDefault();
            navegar({ busca: texto });
            // No toque, o Enter fecha o teclado para a lista aparecer. Lido no
            // evento, não na montagem: aparelho híbrido troca de ponteiro.
            if (window.matchMedia("(pointer: coarse)").matches) {
              campo.current?.blur();
            }
          }}
          className="relative min-w-0 flex-1 @2xl:max-w-[320px]"
        >
          {camposOcultos.map(([nome, valor]) => (
            <input key={nome} type="hidden" name={nome} value={valor} />
          ))}
          <label htmlFor="busca" className="sr-only">
            Buscar por nome, telefone, e-mail ou @ do Instagram
          </label>
          <span className="pointer-events-none absolute inset-y-0 left-1.5 flex items-center text-texto-3">
            {pendente ? (
              <Spinner tamanho={18} rotulo="Buscando" />
            ) : (
              <Search size={18} strokeWidth={1.75} aria-hidden />
            )}
          </span>
          <input
            ref={campo}
            id="busca"
            name="busca"
            type="search"
            value={texto}
            onChange={(e) => {
              const valor = e.target.value;
              setTexto(valor);
              cancelarRespiro();
              relogio.current = setTimeout(
                () => navegar({ busca: valor }),
                RESPIRO_MS,
              );
            }}
            placeholder="Nome, telefone, e-mail ou @"
            enterKeyHint="search"
            autoComplete="off"
            autoCorrect="off"
            spellCheck={false}
            aria-keyshortcuts="/"
            className={cn(
              CAMPO,
              "w-full pr-5 pl-5 pointer-coarse:pr-[44px] [&::-webkit-search-cancel-button]:appearance-none",
            )}
          />
          {texto ? (
            <button
              type="button"
              aria-label="Limpar a busca"
              onClick={() => {
                setTexto("");
                navegar({ busca: "" });
                campo.current?.focus();
              }}
              className="absolute inset-y-0 right-0 flex w-[40px] items-center justify-center rounded-r-controle text-texto-3 transition-colors duration-[120ms] hover:text-tinta focus-visible:outline-2 focus-visible:-outline-offset-2 focus-visible:outline-tinta pointer-coarse:w-[44px]"
            >
              <X size={18} strokeWidth={1.75} aria-hidden />
            </button>
          ) : null}
        </form>
        <FunilFiltrosContatos {...propsFiltros} />
      </div>

      <PilulasFiltrosContatos {...propsFiltros} />
    </div>
  );
}
