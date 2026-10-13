import Link from "next/link";
import { ChevronLeft, ChevronRight } from "lucide-react";
import { cn } from "@/lib/utils";
import { pontoDaEtiqueta } from "@/lib/etiquetas";
import {
  AJUDA,
  AREA_TEXTO,
  CAMPO_SELECT,
  ROTULO,
} from "@/components/app/form-styles";

/*
 * As peças de lista de Configurações e Administração, no desenho dos Ajustes
 * do iOS (kit, blocos 2 e 7): grupo de seção com o rótulo fora do cartão,
 * linhas de 48px com o separador encaixado (começa onde o texto começa), valor
 * à direita e seta quando a linha abre alguma coisa. Ação não mora na linha:
 * editar e excluir ficam no editor que ela abre.
 *
 * Sem "use client": servem à página de servidor e aos componentes de cliente.
 */

/** Linha clicável (botão ou link): fundo de hover e toque, foco por dentro
 *  do cartão (o overflow do grupo cortaria o anel de fora). */
export const LINHA_ACAO =
  "flex min-h-[48px] w-full items-stretch text-left text-tinta transition-colors duration-[120ms] hover:bg-realce active:bg-pressionado focus-visible:outline-2 focus-visible:-outline-offset-2 focus-visible:outline-tinta";

/** O miolo da linha: recuo de 16px e o fio de cima a partir dali, menos na
 *  primeira linha do grupo. */
export const MIOLO_LINHA =
  "ml-2 flex min-w-0 flex-1 items-center gap-1.5 border-t border-fio py-1 pr-1.5 group-first/linha:border-t-0";

/** Título grande da tela e o espaço até o primeiro grupo. */
export function CabecalhoPagina({
  titulo,
  acoes,
}: {
  titulo: string;
  /** Ação da tela, à direita do título (exportar, por exemplo). */
  acoes?: React.ReactNode;
}) {
  return (
    <div className="flex flex-wrap items-end justify-between gap-x-2 gap-y-1.5">
      <h1 className="tipo-titulo-grande text-tinta">{titulo}</h1>
      {acoes ? <div className="flex items-center gap-1">{acoes}</div> : null}
    </div>
  );
}

/**
 * Grupo de seção: rótulo apagado fora do cartão, alinhado ao texto das
 * linhas, com valor opcional à direita ("3 de 10"); embaixo, uma nota curta
 * quando a regra não é óbvia.
 */
export function Grupo({
  id,
  titulo,
  direita,
  nota,
  children,
  className,
}: {
  id: string;
  titulo: string;
  direita?: React.ReactNode;
  nota?: React.ReactNode;
  children: React.ReactNode;
  className?: string;
}) {
  return (
    <section aria-labelledby={id} className={className}>
      <div className="flex items-end justify-between gap-2 px-2 pb-1">
        {/* Focável pelo código: é para onde o foco volta quando o editor
            fecha e a linha que o abriu não existe mais (editor.tsx). */}
        <h2
          id={id}
          tabIndex={-1}
          className="tipo-nota tracking-[0.04em] text-texto-2 uppercase outline-none"
        >
          {titulo}
        </h2>
        {direita ? (
          <p className="tipo-nota text-texto-2 tabular-nums">{direita}</p>
        ) : null}
      </div>
      <ul className="overflow-hidden rounded-painel bg-cartao">{children}</ul>
      {/* div e não p: a nota pode ser uma lista de passos. */}
      {nota ? (
        <div className="tipo-nota max-w-[60ch] px-2 pt-1 text-texto-2">
          {nota}
        </div>
      ) : null}
    </section>
  );
}

/** Texto da linha: o nome e, se houver, uma linha de apoio embaixo. */
export function TextoLinha({
  titulo,
  apoio,
  forte = false,
  apagado = false,
}: {
  titulo: React.ReactNode;
  apoio?: React.ReactNode;
  forte?: boolean;
  /** Item desligado (conta desativada, etiqueta arquivada). */
  apagado?: boolean;
}) {
  return (
    <span className="flex min-w-0 flex-1 flex-col">
      <span
        className={cn(
          "tipo-corpo truncate",
          forte && "font-semibold",
          apagado ? "text-texto-2" : "text-tinta",
        )}
      >
        {titulo}
      </span>
      {apoio ? (
        <span className="tipo-nota truncate text-texto-2">{apoio}</span>
      ) : null}
    </span>
  );
}

/** Valor à direita da linha, em algarismo tabular. */
export function ValorLinha({
  children,
  tom = "neutro",
}: {
  children: React.ReactNode;
  tom?: "neutro" | "bom" | "atencao" | "erro";
}) {
  return (
    <span
      className={cn(
        "tipo-corpo shrink-0 text-right tabular-nums",
        tom === "neutro" && "text-texto-2",
        tom === "bom" && "text-bom",
        tom === "atencao" && "text-atencao",
        tom === "erro" && "text-erro",
      )}
    >
      {children}
    </span>
  );
}

export function Seta() {
  return (
    <ChevronRight
      size={18}
      strokeWidth={1.75}
      aria-hidden
      className="-mr-0.5 shrink-0 text-texto-3"
    />
  );
}

/** Linha que só informa (sem toque). */
export function LinhaInfo({ children }: { children: React.ReactNode }) {
  return (
    <li className="group/linha">
      <div className="flex min-h-[48px]">
        <div className={MIOLO_LINHA}>{children}</div>
      </div>
    </li>
  );
}

/** Linha que leva a outra tela. */
export function LinhaLink({
  href,
  children,
}: {
  href: string;
  children: React.ReactNode;
}) {
  return (
    <li className="group/linha">
      <Link href={href} className={LINHA_ACAO}>
        <span className={MIOLO_LINHA}>
          {children}
          <Seta />
        </span>
      </Link>
    </li>
  );
}

/** O ponto de 8px com a cor que a equipe deu à etiqueta (a cor nunca vai no
 *  fundo; o nome sempre vem junto). Sem cor (neutro), o lugar do ponto fica
 *  vazio, para os nomes da lista continuarem alinhados. */
export function PontoCor({ cor }: { cor: string | null | undefined }) {
  const ponto = pontoDaEtiqueta(cor);
  return (
    <span
      aria-hidden
      className="h-[8px] w-[8px] shrink-0 rounded-full"
      style={ponto ? { backgroundColor: ponto } : undefined}
    />
  );
}

/**
 * O desenho da chave liga/desliga (48×28). Ligada na tinta com a bolinha no
 * fundo; desligada no fio forte. No escuro a bolinha desligada fica no cinza
 * terciário: no fundo preto ela sumiria no trilho.
 */
export function TrilhoInterruptor({
  ligado,
  apagado = false,
}: {
  ligado: boolean;
  apagado?: boolean;
}) {
  return (
    <span
      aria-hidden
      className={cn(
        "relative inline-block h-[28px] w-[48px] shrink-0 rounded-full transition-colors duration-[120ms]",
        ligado ? "bg-tinta" : "bg-fio-forte",
        apagado && "opacity-50",
      )}
    >
      <span
        className={cn(
          "absolute top-[2px] left-[2px] h-[24px] w-[24px] rounded-full transition-[translate,background-color] duration-[180ms] ease-padrao",
          ligado ? "translate-x-[20px] bg-fundo" : "bg-fundo dark:bg-texto-3",
        )}
      />
    </span>
  );
}

/**
 * Chave liga/desliga que é campo de formulário (vai junto no envio), em
 * linha de 48px com rótulo e ajuda. É um checkbox de verdade, com
 * role="switch"; o trilho acompanha pelo :has() do rótulo.
 */
export function CampoInterruptor({
  name,
  value,
  rotulo,
  ajuda,
  defaultChecked,
}: {
  name: string;
  value?: string;
  rotulo: string;
  ajuda?: string;
  defaultChecked?: boolean;
}) {
  return (
    <li className="group/linha">
      <label className="group/chave flex min-h-[48px] cursor-pointer">
        <span className={MIOLO_LINHA}>
          <span className="flex min-w-0 flex-1 flex-col">
            <span className="tipo-corpo text-tinta">{rotulo}</span>
            {ajuda ? (
              <span className="tipo-nota text-texto-2">{ajuda}</span>
            ) : null}
          </span>
          <input
            type="checkbox"
            role="switch"
            name={name}
            value={value}
            defaultChecked={defaultChecked}
            className="sr-only"
          />
          <span
            aria-hidden
            className="relative inline-block h-[28px] w-[48px] shrink-0 rounded-full bg-fio-forte transition-colors duration-[120ms] group-has-[:checked]/chave:bg-tinta group-has-[:focus-visible]/chave:outline-2 group-has-[:focus-visible]/chave:outline-offset-2 group-has-[:focus-visible]/chave:outline-tinta"
          >
            <span className="absolute top-[2px] left-[2px] h-[24px] w-[24px] rounded-full bg-fundo transition-[translate,background-color] duration-[180ms] ease-padrao group-has-[:checked]/chave:translate-x-[20px] dark:bg-texto-3 dark:group-has-[:checked]/chave:bg-fundo" />
          </span>
        </span>
      </label>
    </li>
  );
}

/**
 * Escolha única em linhas (papel, cor), como as listas de opção do iOS: o
 * marcado ganha o visto à direita. É um rádio de verdade, escondido; o foco
 * do teclado aparece na linha inteira. Com `tipo="checkbox"`, a mesma linha
 * vira escolha de vários (os dias do horário, como o "Repetir" do alarme).
 */
export function OpcaoEscolha({
  name,
  value,
  defaultChecked,
  disabled,
  tipo = "radio",
  children,
}: {
  name: string;
  value: string;
  defaultChecked?: boolean;
  disabled?: boolean;
  tipo?: "radio" | "checkbox";
  children: React.ReactNode;
}) {
  return (
    <li className="group/linha">
      <label
        className={cn(
          "group/opcao flex min-h-[48px] cursor-pointer transition-colors duration-[120ms] hover:bg-realce has-[:focus-visible]:outline-2 has-[:focus-visible]:-outline-offset-2 has-[:focus-visible]:outline-tinta",
          disabled && "cursor-not-allowed opacity-60 hover:bg-transparent",
        )}
      >
        <span className={MIOLO_LINHA}>
          <input
            type={tipo}
            name={name}
            value={value}
            defaultChecked={defaultChecked}
            disabled={disabled}
            className="sr-only"
          />
          {children}
          <svg
            aria-hidden
            viewBox="0 0 24 24"
            className="invisible h-[20px] w-[20px] shrink-0 fill-none stroke-tinta stroke-[2.25] group-has-[:checked]/opcao:visible"
          >
            <path d="M20 6 9 17l-5-5" strokeLinecap="round" strokeLinejoin="round" />
          </svg>
        </span>
      </label>
    </li>
  );
}

/** As opções de uma escolha única, com o nome do grupo para o leitor de
 *  tela e para quem olha. */
export function GrupoEscolha({
  rotulo,
  children,
  ajuda,
}: {
  rotulo: string;
  children: React.ReactNode;
  ajuda?: React.ReactNode;
}) {
  return (
    <fieldset className="min-w-0">
      <legend className="tipo-nota px-2 pb-1 text-texto-2">{rotulo}</legend>
      <ul className="overflow-hidden rounded-painel bg-cartao">{children}</ul>
      {ajuda ? (
        <p className="tipo-nota px-2 pt-1 text-texto-2">{ajuda}</p>
      ) : null}
    </fieldset>
  );
}

/** Lista de linhas dentro de um editor: mesmo cartão do grupo, sem rótulo. */
export function ListaEditor({
  rotulo,
  children,
}: {
  /** Rótulo acima da lista (fica no lugar do <legend> visual). */
  rotulo?: string;
  children: React.ReactNode;
}) {
  return (
    <div>
      {rotulo ? (
        <p className="tipo-nota px-2 pb-1 text-texto-2">{rotulo}</p>
      ) : null}
      <ul className="overflow-hidden rounded-painel bg-cartao">{children}</ul>
    </div>
  );
}

/** Texto longo com rótulo em cima e ajuda embaixo, como o Field. */
export function CampoTexto({
  id,
  label,
  ajuda,
  className,
  ...props
}: {
  id: string;
  label: string;
  ajuda?: string;
} & React.ComponentProps<"textarea">) {
  const ajudaId = ajuda ? `${id}-ajuda` : undefined;
  return (
    <div className="flex flex-col gap-1">
      <label htmlFor={id} className={ROTULO}>
        {label}
      </label>
      <textarea
        id={id}
        aria-describedby={ajudaId}
        className={cn(AREA_TEXTO, "text-base lg:text-sm", className)}
        {...props}
      />
      {ajuda ? (
        <p id={ajudaId} className={AJUDA}>
          {ajuda}
        </p>
      ) : null}
    </div>
  );
}

/** Lista suspensa nativa com rótulo em cima (no celular abre a roda do
 *  sistema, que é o que a pessoa espera para escolher um nome). */
export function CampoLista({
  id,
  label,
  ajuda,
  children,
  className,
  ...props
}: {
  id: string;
  label: string;
  ajuda?: string;
  children: React.ReactNode;
} & React.ComponentProps<"select">) {
  const ajudaId = ajuda ? `${id}-ajuda` : undefined;
  return (
    <div className="flex flex-col gap-1">
      <label htmlFor={id} className={ROTULO}>
        {label}
      </label>
      <select
        id={id}
        aria-describedby={ajudaId}
        className={cn(CAMPO_SELECT, "w-full", className)}
        {...props}
      >
        {children}
      </select>
      {ajuda ? (
        <p id={ajudaId} className={AJUDA}>
          {ajuda}
        </p>
      ) : null}
    </div>
  );
}

/** O fim do editor, separado do resto: a ação destrutiva fica por último. */
export function ZonaPerigo({ children }: { children: React.ReactNode }) {
  return <div className="mt-1 border-t border-fio pt-2">{children}</div>;
}

/**
 * Esqueleto da tela enquanto o servidor responde: o título e grupos de
 * linhas no formato da tela que vem (kit: carregamento no formato, não
 * spinner). `linhas` dá quantas linhas tem cada grupo.
 */
export function EsqueletoGrupos({
  titulo,
  linhas,
  volta,
}: {
  titulo: string;
  linhas: number[];
  /** O "‹ Administração" das subpágina, no mesmo lugar (sem link: a tela
   *  de verdade chega em seguida e o título não pula). */
  volta?: string;
}) {
  return (
    <div
      aria-busy
      aria-label={`Carregando ${titulo}`}
      className={
        volta
          ? "px-2 pt-2 pb-6 md:px-3 md:pt-3 lg:pt-3"
          : "px-2 pt-3 pb-6 md:px-3 lg:pt-4"
      }
    >
      {volta ? (
        <div aria-hidden className="mb-1.5">
          <p className="tipo-corpo -my-1 -ml-1 inline-flex h-[40px] items-center gap-0.5 pr-1 pl-0.5 text-texto-2 pointer-coarse:h-[44px]">
            <ChevronLeft size={20} strokeWidth={1.75} aria-hidden />
            {volta}
          </p>
        </div>
      ) : null}
      <h1 className="tipo-titulo-grande text-tinta">{titulo}</h1>
      <div className="mt-3 flex max-w-[720px] flex-col gap-4">
        {linhas.map((n, g) => (
          <div key={g}>
            <div className="mx-2 mb-1.5 h-[12px] w-[96px] rounded-celula bg-cartao motion-safe:animate-pulse" />
            <div className="overflow-hidden rounded-painel bg-cartao">
              {Array.from({ length: n }, (_, i) => (
                <div
                  key={i}
                  className="ml-2 flex h-[48px] items-center border-t border-fio pr-2 first:border-t-0"
                >
                  <span className="h-[12px] w-2/5 rounded-celula bg-realce motion-safe:animate-pulse" />
                </div>
              ))}
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}
