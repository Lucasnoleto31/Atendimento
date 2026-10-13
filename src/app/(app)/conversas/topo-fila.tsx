"use client";

import { useState, type RefObject } from "react";
import { Check, ChevronDown, Minus } from "lucide-react";
import { cn } from "@/lib/utils";
import {
  Folha,
  ItemAcao,
  ItemSecao,
  ItensSecao,
  MenuSuspenso,
  useTelaMd,
} from "./folha";
import type { CargaAtendente, Contagens, VisaoConversas } from "./lista";

/*
 * O topo da fila: o título é o seletor da visão ("Caixa ▾"), com a contagem
 * dela ao lado e, à direita na mesma linha, o funil dos filtros e o
 * "Selecionar". Embaixo, no chat (app.tsx), vêm a busca, o escopo e as
 * pílulas dos filtros ligados (o funil e as pílulas moram em
 * barra-filtros.tsx). Na seleção em massa, tudo isso dá lugar à barra de
 * ações (massa.tsx).
 *
 * As cinco visões não cabiam lado a lado na fila de 360px nem no celular:
 * o trilho rolava de lado e escondia o "Tudo". No título elas cabem todas,
 * com a contagem de cada uma, num menu suspenso no desktop e numa folha
 * presa no pé no celular.
 */

export const VISOES: { chave: VisaoConversas; rotulo: string }[] = [
  { chave: "caixa", rotulo: "Caixa" },
  { chave: "aguardando", rotulo: "Aguardando" },
  { chave: "adiadas", rotulo: "Adiadas" },
  { chave: "recontatos", rotulo: "Recontatos" },
  { chave: "resolvidas", rotulo: "Resolvidas" },
  { chave: "tudo", rotulo: "Tudo" },
];

export const NOME_DA_VISAO: Record<VisaoConversas, string> = {
  caixa: "Caixa",
  aguardando: "Aguardando",
  adiadas: "Adiadas",
  recontatos: "Recontatos",
  resolvidas: "Resolvidas",
  tudo: "Tudo",
};

/* ── Título que troca a visão ─────────────────────────────────────────── */

/**
 * "Caixa ▾" no tamanho do título da tela. A contagem fica ao lado, na linha
 * de base do título, em legenda: é o tamanho da fila, não um selo.
 *
 * Esc fecha o menu (e a folha) e o foco volta ao título. Os atalhos G→C e
 * G→A continuam no teclado do chat; com o menu aberto, a tecla é dele.
 */
export function TituloVisao({
  visao,
  contagens,
  contagem,
  aoMudar,
  gatilhoRef,
}: {
  visao: VisaoConversas;
  contagens: Contagens | null;
  /** O número ao lado do título ("12", "60+", "150 de 212"); null não
   *  mostra nada. */
  contagem: string | null;
  aoMudar: (v: VisaoConversas) => void;
  /** O botão do título. O chat também devolve o foco a ele quando a linha
   *  que tinha o foco sai da fila. */
  gatilhoRef: RefObject<HTMLButtonElement | null>;
}) {
  const menu = useTelaMd();
  const [aberto, setAberto] = useState(false);
  const fechar = () => setAberto(false);

  const itens = VISOES.map((v) => {
    // Tudo não é contado (é o acervo); as outras vêm do servidor junto com
    // a fila. Sem contagem (falhou), o item vai sem número. Recontatos conta
    // os de hoje e os atrasados.
    const n =
      v.chave === "tudo" || !contagens ? null : (contagens[v.chave] ?? null);
    return (
      <ItemSecao key={v.chave} menu={menu}>
        <ItemAcao
          variante={menu ? "menu" : "folha"}
          papel="menuitemradio"
          marcado={v.chave === visao}
          detalhe={
            n === null ? undefined : (
              <>
                {n.toLocaleString("pt-BR")}
                <span className="sr-only">
                  {v.chave === "recontatos"
                    ? n === 1
                      ? " para hoje ou atrasado"
                      : " para hoje ou atrasados"
                    : n === 1
                      ? " conversa"
                      : " conversas"}
                </span>
              </>
            )
          }
          onClick={() => {
            fechar();
            aoMudar(v.chave);
          }}
        >
          {v.rotulo}
        </ItemAcao>
      </ItemSecao>
    );
  });

  return (
    // Espaços de 4px, para sobrar lugar ao funil e ao "Selecionar" na mesma
    // linha. Na fila de 360px cabem "Aguardando ▾", o funil e o
    // "Selecionar"; a contagem sai quando não cabe. A seta já tem folga
    // própria no desenho, que faz as vezes do respiro à direita do realce.
    <div className="relative flex min-w-0 flex-1 items-baseline">
      {/* O nome da visão não encolhe enquanto couber: é o h1 da tela. Num
          telefone de 375px, "Aguarda…" e "Resolvi…" cortavam para dar
          lugar à contagem. Só corta quando nem ele sozinho cabe. */}
      <h1 className="max-w-full shrink-0">
        <button
          ref={gatilhoRef}
          type="button"
          aria-haspopup={menu ? "menu" : "dialog"}
          aria-expanded={aberto}
          title="Trocar a visão"
          onClick={() => setAberto((a) => !a)}
          // O -ml-1 com o pl-1 põe o texto na margem da busca e deixa o
          // realce do hover passar um pouco para fora dela.
          className="tipo-titulo-grande -ml-1 inline-flex min-h-[44px] max-w-[calc(100%+8px)] items-center gap-0.5 rounded-controle pl-1 text-left text-tinta transition-[background-color,scale] duration-[120ms] hover:bg-realce focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-tinta active:bg-pressionado motion-safe:active:scale-[.97]"
        >
          <span className="min-w-0 truncate">{NOME_DA_VISAO[visao]}</span>
          <ChevronDown
            size={22}
            strokeWidth={1.75}
            aria-hidden
            className={cn(
              "shrink-0 text-texto-2 md:size-[20px] motion-safe:transition-transform motion-safe:duration-[150ms]",
              aberto && "rotate-180",
            )}
          />
        </button>
      </h1>
      {contagem ? (
        // A contagem sai inteira quando não cabe ao lado do nome, em vez de
        // cortar o nome ou a si mesma: numa linha só, com o espaço invisível
        // na frente, o número que não cabe desce para a segunda linha, que
        // o overflow esconde. O leitor de tela continua lendo. Ela segue no
        // menu das visões.
        <span className="tipo-legenda flex h-[1lh] min-w-0 flex-wrap overflow-hidden text-texto-2 tabular-nums">
          <span aria-hidden>&#8203;</span>
          <span className="ml-0.5 whitespace-nowrap">
            {contagem}
            <span className="sr-only"> conversas</span>
          </span>
        </span>
      ) : null}
      {menu ? (
        <MenuSuspenso
          aberto={aberto}
          aoFechar={fechar}
          gatilho={gatilhoRef}
          rotulo="Visão da fila"
          alinhar="inicio"
          className="w-[240px]"
        >
          {itens}
        </MenuSuspenso>
      ) : (
        <Folha
          aberta={aberto}
          aoFechar={fechar}
          titulo="Visão da fila"
          retorno={gatilhoRef}
        >
          <ItensSecao menu={false}>{itens}</ItensSecao>
        </Folha>
      )}
    </div>
  );
}

/* ── "Selecionar" ──────────────────────────────────────────────────── */

/**
 * "Selecionar", com a palavra, na linha do título: liga a seleção em massa
 * (as caixas nas linhas e a barra de ações no lugar do topo). Só com o
 * ícone, ninguém achava como selecionar várias. Sai da tela junto com o
 * topo quando a seleção liga; quem chama leva o foco ao "Selecionar
 * todas" da barra. O -mr-1 alinha a palavra com a borda da busca e deixa o
 * realce do hover passar um pouco para fora dela.
 */
export function BotaoSelecionar({
  aoIniciar,
  botaoRef,
}: {
  aoIniciar: () => void;
  botaoRef: RefObject<HTMLButtonElement | null>;
}) {
  return (
    <button
      ref={botaoRef}
      type="button"
      aria-label="Selecionar conversas"
      title="Selecionar conversas"
      onClick={aoIniciar}
      className={cn(
        "tipo-corpo -mr-1 inline-flex h-[44px] shrink-0 items-center justify-center rounded-controle px-1 font-semibold text-tinta transition-[background-color,color,scale] duration-[120ms] hover:bg-realce active:bg-pressionado motion-safe:active:scale-[.97] focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-tinta",
        "md:h-[40px] md:pointer-coarse:h-[44px]",
      )}
    >
      Selecionar
    </button>
  );
}

/* ── Peças que os menus usam ──────────────────────────────────────────── */

/** Estado da carga da equipe, para a coluna "Abertas" do atendente. O erro
 *  leva o texto do servidor ("Sessão expirada. Entre de novo."). */
export type EstadoCarga =
  | { tipo: "fora" }
  | { tipo: "lendo" }
  | { tipo: "erro"; texto: string }
  | { tipo: "pronta"; equipe: CargaAtendente[] };

/**
 * Item que marca e desmarca, com a caixa à esquerda (a mesma das linhas da
 * fila na seleção): os filtros de escolha múltipla e as etiquetas da ação em
 * massa. `estado` "misto" é o traço de "algumas têm" (aria-checked="mixed").
 * 40px no menu, 48px na folha, com o separador encaixado.
 */
export function ItemMarcavel({
  menu,
  estado,
  ponto,
  icone,
  detalhe,
  children,
  className,
  ...props
}: {
  menu: boolean;
  estado: boolean | "misto";
  /** A cor da etiqueta, num ponto de 8px antes do nome. */
  ponto?: string | null;
  /** O que vai antes do nome, em 20px: a foto da pessoa no filtro de
   *  Atendentes. Decorativo: o nome diz quem é. */
  icone?: React.ReactNode;
  /** Texto à direita, em algarismo tabular (a carga da pessoa). */
  detalhe?: React.ReactNode;
  children: React.ReactNode;
  className?: string;
} & Omit<React.ComponentProps<"button">, "className" | "children">) {
  const marcado = estado === true;
  return (
    <button
      type="button"
      data-item=""
      role="checkbox"
      aria-checked={estado === "misto" ? "mixed" : estado}
      className={cn(
        "group/item flex w-full items-center text-left text-tinta transition-colors duration-[120ms] outline-none focus-visible:outline-2 focus-visible:-outline-offset-2 focus-visible:outline-tinta disabled:cursor-not-allowed disabled:text-texto-3",
        menu
          ? "min-h-[40px] gap-1 rounded-controle px-1 hover:bg-realce focus:bg-realce active:bg-pressionado pointer-coarse:min-h-[44px]"
          : "min-h-[48px] gap-1.5 pl-1.5 hover:bg-realce active:bg-pressionado",
        className,
      )}
      {...props}
    >
      <span
        aria-hidden
        className={cn(
          "flex h-[20px] w-[20px] shrink-0 items-center justify-center rounded-celula border",
          estado === false
            ? "border-fio-forte bg-fundo"
            : "border-tinta bg-tinta text-fundo",
        )}
      >
        {marcado ? (
          <Check size={14} strokeWidth={2.5} />
        ) : estado === "misto" ? (
          <Minus size={14} strokeWidth={2.5} />
        ) : null}
      </span>
      {/* O ícone fica fora do span com borda, como no ItemAcao: na folha o
          separador encaixado começa no nome, e não na foto. */}
      {icone ? (
        <span
          aria-hidden
          className="flex w-[20px] shrink-0 justify-center text-texto-2 group-disabled/item:text-texto-3"
        >
          {icone}
        </span>
      ) : null}
      <span
        className={cn(
          "flex min-w-0 flex-1 items-center gap-1 self-stretch",
          menu
            ? "py-0.5"
            : "border-t border-fio py-1 pr-1.5 group-first/linha:border-t-0",
        )}
      >
        {ponto ? (
          <span
            aria-hidden
            className="h-[8px] w-[8px] shrink-0 rounded-full"
            style={{ backgroundColor: ponto }}
          />
        ) : null}
        <span className="tipo-corpo min-w-0 flex-1 truncate">{children}</span>
        {detalhe !== undefined && detalhe !== null ? (
          <span className="tipo-nota shrink-0 text-texto-2 tabular-nums">
            {detalhe}
          </span>
        ) : null}
      </span>
    </button>
  );
}
