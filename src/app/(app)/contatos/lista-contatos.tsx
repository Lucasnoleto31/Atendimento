"use client";

import { useEffect, useRef } from "react";
import Link from "next/link";
import { Check, MessageSquare, Minus } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Etiqueta } from "@/components/ui/etiqueta";
import { AvatarContato } from "@/components/app/avatar-contato";
import { BOTAO_ICONE } from "@/components/app/form-styles";
import { cn } from "@/lib/utils";
import { pontoDaEtiqueta } from "./cor-etiqueta";
import { IrParaPrimeira, LimparFiltros } from "./navegacao-lista";

/*
 * As duas formas da lista de contatos, só desenho (os dados vêm da página e
 * a seleção, de lista-selecionavel). A troca é pela largura do conteúdo
 * (container query no invólucro sem recuo da página, o @container/pagina),
 * que vale com o menu lateral aberto ou recolhido: abaixo de 768px de
 * conteúdo, linhas; daí para cima, a tabela densa, que ganha a coluna de
 * etiquetas a partir de 1024px.
 *
 * Na seleção, a linha inteira marca e desmarca (no celular, como no
 * WhatsApp e no Mail do iPhone; na tabela, com Shift para levar o
 * intervalo), e a ficha e a conversa saem de cena até ela acabar.
 */

// Os links das linhas não pré-carregam: com 60 linhas, cada uma pediria ao
// servidor a ficha e a conversa (e cada pedido passa pelo middleware, que
// confere a sessão no Supabase). A ficha tem esqueleto próprio, que chega
// na primeira resposta do clique.

/** Quantas etiquetas cabem na célula antes de virar "+N". */
const ETIQUETAS_NA_LINHA = 2;

/** Toque longo que entra na seleção, e quanto o dedo pode andar nele (os
 *  mesmos da fila do chat). */
const TOQUE_LONGO_MS = 450;
const TOLERANCIA_PX = 8;

export type EtiquetaCatalogo = {
  id: string;
  nome: string;
  cor: string | null;
  ativo: boolean;
};

/** A linha já pronta para as duas formas da lista (celular e tabela). */
export type Contato = {
  id: string;
  nome: string;
  foto: boolean;
  /** Telefone formatado ou @ do Instagram. */
  contato: string | null;
  dono: string | null;
  /** Última interação (ISO) e o texto dela, contado no servidor ("há 3
   *  dias"): contado de novo no navegador, a hidratação discordaria na
   *  virada do minuto. */
  quando: string | null;
  quandoTexto: string | null;
  quandoTitulo: string | null;
  etiquetas: EtiquetaCatalogo[];
  ficha: string;
  conversa: string;
};

/** O estado da seleção que as duas formas leem. */
export type Selecao = {
  ativa: boolean;
  marcados: ReadonlySet<string>;
  /** Marca ou desmarca; com `faixa` (Shift), o intervalo desde a última
   *  linha mexida vai junto. */
  alternar: (id: string, faixa?: boolean) => void;
  /** Toque longo numa linha fora da seleção: entra nela já com a linha. */
  iniciar: (id: string) => void;
};

/* ── Caixa de marcar ──────────────────────────────────────────────────── */

/**
 * O checkbox nativo (Espaço marca, o leitor de tela anuncia o estado), com
 * o desenho da seleção do chat: quadrado com raio de célula, fio forte
 * vazio e tinta marcado. `misto` é o "alguns" do marcar todos.
 */
export function CaixaMarcar({
  marcado,
  misto = false,
  onMudar,
  rotulo,
  className,
}: {
  marcado: boolean;
  misto?: boolean;
  onMudar: (faixa: boolean) => void;
  /** Nome para o leitor de tela quando não há <label> com texto. */
  rotulo?: string;
  className?: string;
}) {
  const caixa = useRef<HTMLInputElement>(null);
  useEffect(() => {
    if (caixa.current) caixa.current.indeterminate = misto;
  }, [misto]);

  return (
    <span className={cn("relative inline-flex h-[20px] w-[20px] shrink-0", className)}>
      <input
        ref={caixa}
        type="checkbox"
        checked={marcado && !misto}
        aria-label={rotulo}
        onChange={(e) => {
          // O change do checkbox nasce de um clique (ou do Espaço, que o
          // navegador também entrega como clique): o Shift vem nele.
          const evento = e.nativeEvent as Event & { shiftKey?: boolean };
          onMudar(Boolean(evento.shiftKey));
        }}
        className="peer h-full w-full cursor-pointer appearance-none rounded-celula border border-fio-forte bg-fundo transition-colors duration-[120ms] checked:border-tinta checked:bg-tinta indeterminate:border-tinta indeterminate:bg-tinta focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-tinta"
      />
      <Check
        aria-hidden
        size={14}
        strokeWidth={2.5}
        className="pointer-events-none absolute inset-0 m-auto hidden text-fundo peer-checked:block"
      />
      <Minus
        aria-hidden
        size={14}
        strokeWidth={2.5}
        className="pointer-events-none absolute inset-0 m-auto hidden text-fundo peer-indeterminate:block"
      />
    </span>
  );
}

/* ── Celular: linhas ───────────────────────────────────────────────────── */

/**
 * Fora da seleção, a linha toda abre a ficha (o link estica por cima dela) e
 * o botão de conversa fica por cima do link, com 44px de alvo; o toque
 * longo entra na seleção com a linha marcada. Na seleção, a linha é o
 * rótulo da caixa de marcar. Separador encaixado: começa onde o texto
 * começa.
 */
export function ListaCelular({
  contatos,
  comDono,
  selecao,
}: {
  contatos: Contato[];
  comDono: boolean;
  /** null: o papel não tem ação em massa, e o toque longo não faz nada. */
  selecao: Selecao | null;
}) {
  const toque = useRef<{
    ponteiro: number;
    x: number;
    y: number;
    relogio: number;
  } | null>(null);
  // O clique que o navegador ainda entrega ao soltar o toque longo: a linha
  // já entrou marcada (e virou rótulo da caixa), e ele a desmarcaria.
  const engolir = useRef(false);
  const ultimoPonteiro = useRef("mouse");

  const cancelarToque = () => {
    if (!toque.current) return;
    window.clearTimeout(toque.current.relogio);
    toque.current = null;
  };
  /** Sem o clique depois do toque longo (o Android não manda), a trava sai
   *  sozinha e o próximo toque vale. */
  const soltarTrava = () => {
    if (!engolir.current) return;
    window.setTimeout(() => {
      engolir.current = false;
    }, 400);
  };
  // O toque longo pendente não dispara depois que a lista sai.
  useEffect(() => {
    const t = toque;
    return () => {
      if (t.current) window.clearTimeout(t.current.relogio);
    };
  }, []);

  const selecionando = selecao?.ativa ?? false;

  // O gesto mora na lista, e não na linha: ao entrar na seleção a linha é
  // redesenhada embaixo do dedo, e o soltar chega a outro elemento.
  return (
    <ul
      className={cn(
        "-mx-2 md:-mx-3 @3xl/pagina:hidden",
        // O toque longo é da seleção: sem o menu do link nem a lupa de
        // texto do iPhone.
        selecao && "select-none [-webkit-touch-callout:none]",
      )}
      onPointerDown={(e) => {
        ultimoPonteiro.current = e.pointerType;
        engolir.current = false;
        cancelarToque();
        if (!selecao || selecionando || e.pointerType !== "touch") return;
        const linha = (e.target as Element).closest<HTMLElement>(
          "[data-contato]",
        );
        const id = linha?.dataset.contato;
        if (!id) return;
        toque.current = {
          ponteiro: e.pointerId,
          x: e.clientX,
          y: e.clientY,
          relogio: window.setTimeout(() => {
            toque.current = null;
            engolir.current = true;
            selecao.iniciar(id);
          }, TOQUE_LONGO_MS),
        };
      }}
      onPointerMove={(e) => {
        const t = toque.current;
        if (!t || t.ponteiro !== e.pointerId) return;
        if (
          Math.abs(e.clientX - t.x) >= TOLERANCIA_PX ||
          Math.abs(e.clientY - t.y) >= TOLERANCIA_PX
        ) {
          cancelarToque();
        }
      }}
      onPointerUp={() => {
        cancelarToque();
        soltarTrava();
      }}
      onPointerCancel={() => {
        cancelarToque();
        soltarTrava();
      }}
      onContextMenu={(e) => {
        if (selecao && ultimoPonteiro.current === "touch") e.preventDefault();
      }}
      onClickCapture={(e) => {
        if (!engolir.current) return;
        engolir.current = false;
        e.preventDefault();
        e.stopPropagation();
      }}
    >
      {contatos.map((c) => {
        if (selecionando && selecao) {
          const marcado = selecao.marcados.has(c.id);
          return (
            <li
              key={c.id}
              data-contato={c.id}
              className={cn(
                "group transition-colors duration-[120ms]",
                marcado
                  ? "bg-selecao"
                  : "hover:bg-realce active:bg-pressionado",
              )}
            >
              <label className="flex cursor-pointer items-center gap-1.5 pl-2 md:pl-3">
                <CaixaMarcar
                  marcado={marcado}
                  onMudar={() => selecao.alternar(c.id)}
                  rotulo={`Selecionar ${c.nome}`}
                />
                <AvatarContato
                  nome={c.nome}
                  leadId={c.id}
                  instagram={c.foto}
                  className="h-[44px] w-[44px] tipo-nota font-semibold"
                />
                <span className="flex min-h-[64px] min-w-0 flex-1 flex-col justify-center border-t border-fio py-1 pr-2 group-first:border-t-0 md:pr-3">
                  <TextoDaLinha contato={c} comDono={comDono} />
                </span>
              </label>
            </li>
          );
        }

        return (
          <li
            key={c.id}
            data-contato={c.id}
            className="group relative flex items-center gap-1.5 pl-2 transition-colors duration-[120ms] hover:bg-realce has-[a:active]:bg-pressionado md:pl-3"
          >
            <AvatarContato
              nome={c.nome}
              leadId={c.id}
              instagram={c.foto}
              className="h-[44px] w-[44px] tipo-nota font-semibold"
            />
            <div className="flex min-h-[64px] min-w-0 flex-1 items-center gap-0.5 border-t border-fio py-1 pr-1 group-first:border-t-0 md:pr-2">
              <Link
                href={c.ficha}
                prefetch={false}
                draggable={false}
                className="min-w-0 flex-1 rounded-controle after:absolute after:inset-0 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-tinta"
              >
                <TextoDaLinha contato={c} comDono={comDono} />
              </Link>
              <BotaoConversa href={c.conversa} nome={c.nome} />
            </div>
          </li>
        );
      })}
    </ul>
  );
}

/** Nome e última interação em cima; telefone ou @ e o dono embaixo. */
function TextoDaLinha({
  contato: c,
  comDono,
}: {
  contato: Contato;
  comDono: boolean;
}) {
  return (
    <>
      <span className="flex items-baseline gap-1">
        <span className="min-w-0 flex-1 truncate tipo-destaque text-tinta">
          {c.nome}
        </span>
        <Quando contato={c} className="shrink-0 tipo-nota" />
      </span>
      {/* O telefone não encolhe: é ele que se procura na linha; o nome do
          dono corta primeiro. */}
      <span className="mt-0.5 flex min-w-0 items-baseline gap-0.5 overflow-hidden tipo-nota text-texto-2">
        <span className="shrink-0 tabular-nums">
          {c.contato ?? "Sem telefone"}
        </span>
        {comDono ? (
          <>
            <span aria-hidden>·</span>
            <Dono nome={c.dono} className="min-w-0 truncate" />
          </>
        ) : null}
      </span>
    </>
  );
}

/* ── Desktop: tabela ───────────────────────────────────────────────────── */

export function TabelaContatos({
  contatos,
  comDono,
  selecao,
}: {
  contatos: Contato[];
  comDono: boolean;
  selecao: Selecao | null;
}) {
  const selecionando = Boolean(selecao?.ativa);

  // Separada e sem espaçamento: no modelo colapsado o navegador ignora o raio
  // das células do cabeçalho. Por isso o fio vai em cada célula, não na linha.
  return (
    <table className="hidden w-full table-fixed border-separate border-spacing-0 text-left @3xl/pagina:table">
      <caption className="sr-only">
        Contatos, da interação mais recente para a mais antiga
      </caption>
      <thead>
        <tr>
          {selecionando ? (
            <Th className="w-[56px]">
              <span className="sr-only">Selecionado</span>
            </Th>
          ) : null}
          <Th>Nome</Th>
          <Th className="w-[192px]">Telefone ou Instagram</Th>
          <Th className="hidden w-[232px] @5xl/pagina:table-cell">Etiquetas</Th>
          {comDono ? <Th className="w-[168px]">Responsável</Th> : null}
          <Th className="w-[128px] text-right">Última interação</Th>
          <Th className="w-[64px]">
            <span className="sr-only">Conversa</span>
          </Th>
        </tr>
      </thead>
      <tbody>
        {contatos.map((c) => {
          const extras = c.etiquetas.slice(ETIQUETAS_NA_LINHA);
          const marcado = selecionando && Boolean(selecao?.marcados.has(c.id));
          return (
            <tr
              key={c.id}
              // A âncora da rolagem ao ligar e desligar a seleção.
              data-contato={c.id}
              onClick={
                selecionando && selecao
                  ? (e) => {
                      // A caixa da linha cuida do próprio clique.
                      if ((e.target as Element).closest("label, input")) return;
                      selecao.alternar(c.id, e.shiftKey);
                    }
                  : undefined
              }
              className={cn(
                "transition-colors duration-[120ms] [&>td]:border-b [&>td]:border-fio",
                selecionando && "cursor-pointer select-none",
                marcado ? "bg-selecao" : "hover:bg-realce",
              )}
            >
              {selecionando && selecao ? (
                <td className="h-[48px] pl-1.5">
                  {/* O rótulo estende o alvo à célula inteira. */}
                  <label className="flex h-[48px] cursor-pointer items-center">
                    <CaixaMarcar
                      marcado={marcado}
                      onMudar={(faixa) => selecao.alternar(c.id, faixa)}
                      rotulo={`Selecionar ${c.nome}`}
                    />
                  </label>
                </td>
              ) : null}
              <td className="h-[48px] px-1.5">
                <div className="flex min-w-0 items-center gap-1">
                  <AvatarContato
                    nome={c.nome}
                    leadId={c.id}
                    instagram={c.foto}
                    className="h-[32px] w-[32px] text-xs"
                  />
                  {selecionando ? (
                    <span className="min-w-0 truncate tipo-destaque text-tinta">
                      {c.nome}
                    </span>
                  ) : (
                    <Link
                      href={c.ficha}
                      prefetch={false}
                      className="min-w-0 truncate rounded-chip tipo-destaque text-tinta underline-offset-2 hover:underline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-tinta"
                    >
                      {c.nome}
                    </Link>
                  )}
                </div>
              </td>
              <td className="truncate px-1.5 tipo-corpo text-texto-2 tabular-nums">
                {c.contato ?? <span className="text-texto-3">—</span>}
              </td>
              <td className="hidden px-1.5 @5xl/pagina:table-cell">
                {c.etiquetas.length === 0 ? (
                  <span className="tipo-corpo text-texto-3">—</span>
                ) : (
                  <ul className="flex min-w-0 gap-0.5">
                    {c.etiquetas.slice(0, ETIQUETAS_NA_LINHA).map((t) => (
                      <li key={t.id} className="min-w-0">
                        <Etiqueta
                          cor={pontoDaEtiqueta(t.cor)}
                          className="max-w-[112px]"
                        >
                          {t.nome}
                        </Etiqueta>
                      </li>
                    ))}
                    {extras.length > 0 ? (
                      <li className="shrink-0">
                        <Etiqueta title={extras.map((t) => t.nome).join(", ")}>
                          +{extras.length}
                        </Etiqueta>
                      </li>
                    ) : null}
                  </ul>
                )}
              </td>
              {comDono ? (
                <td className="truncate px-1.5 tipo-corpo text-texto-2">
                  <Dono nome={c.dono} />
                </td>
              ) : null}
              <td className="px-1.5 text-right tipo-corpo">
                <Quando contato={c} />
              </td>
              <td className="px-1 text-right">
                {selecionando ? null : (
                  <BotaoConversa href={c.conversa} nome={c.nome} />
                )}
              </td>
            </tr>
          );
        })}
      </tbody>
    </table>
  );
}

function Th({
  children,
  className,
}: {
  children: React.ReactNode;
  className?: string;
}) {
  return (
    <th
      scope="col"
      className={cn(
        "h-[40px] bg-cartao px-1.5 tipo-nota font-normal text-texto-2 first:rounded-l-controle last:rounded-r-controle",
        className,
      )}
    >
      {children}
    </th>
  );
}

/* ── Pedaços ───────────────────────────────────────────────────────────── */

/** Sem dono é estado: é o que a gestão procura para distribuir. */
function Dono({ nome, className }: { nome: string | null; className?: string }) {
  return nome ? (
    <span className={className}>{nome}</span>
  ) : (
    <span className={cn("text-atencao", className)}>Sem dono</span>
  );
}

function Quando({
  contato: c,
  className,
}: {
  contato: Contato;
  className?: string;
}) {
  if (!c.quando || !c.quandoTexto) {
    return <span className={cn("text-texto-3", className)}>nunca</span>;
  }
  return (
    <time
      dateTime={c.quando}
      title={c.quandoTitulo ?? undefined}
      className={cn("text-texto-2 tabular-nums", className)}
    >
      {c.quandoTexto}
    </time>
  );
}

function BotaoConversa({ href, nome }: { href: string; nome: string }) {
  return (
    <Link
      href={href}
      prefetch={false}
      aria-label={`Abrir conversa com ${nome}`}
      title="Abrir conversa"
      // Por cima do link esticado da linha no celular.
      className={cn(BOTAO_ICONE, "relative z-10")}
    >
      <MessageSquare size={18} strokeWidth={1.75} aria-hidden />
    </Link>
  );
}

/**
 * A lista sem linhas. O título aceita foco (tabIndex -1): quando uma ação
 * em massa esvazia a lista, o foco vem para cá em vez de cair no body.
 *
 * Com a busca que não achou ninguém, quem cadastra ganha o "Cadastrar
 * “11 98765-4321”", que abre o cadastro com o termo já no campo (telefone
 * ou nome, decide a página): antes era subir ao + e digitar de novo.
 */
export function Vazio({
  pagina,
  busca,
  filtrando,
  primeira,
  cadastrar,
}: {
  pagina: number;
  busca: string;
  filtrando: boolean;
  primeira: string;
  /** O cadastro com o termo da busca; null quando não cabe (o papel não
   *  cadastra, a busca tem @ ou mistura letras com poucos números). */
  cadastrar: string | null;
}) {
  if (pagina > 1) {
    return (
      <div className="rounded-painel bg-cartao p-2.5">
        <h2 tabIndex={-1} className="tipo-titulo-3 text-tinta">
          Esta página está vazia.
        </h2>
        <IrParaPrimeira href={primeira} />
      </div>
    );
  }
  if (filtrando) {
    return (
      <div className="rounded-painel bg-cartao p-2.5">
        <h2 tabIndex={-1} className="tipo-titulo-3 break-words text-tinta">
          {busca
            ? `Nenhum contato com “${busca}”.`
            : "Nenhum contato com esses filtros."}
        </h2>
        {busca ? (
          <p className="mt-0.5 tipo-corpo text-texto-2">
            A busca olha nome (com ou sem acento), e-mail, @ do Instagram e
            telefone a partir de 4 dígitos.
          </p>
        ) : null}
        <div className="flex flex-wrap gap-x-1.5">
          {cadastrar ? (
            // Secundário: o principal da tela é o "+" do topo.
            <Button
              href={cadastrar}
              variant="secondary"
              size="sm"
              className="mt-1.5 max-w-full min-w-0"
            >
              <span className="truncate">Cadastrar “{busca}”</span>
            </Button>
          ) : null}
          <LimparFiltros />
        </div>
      </div>
    );
  }
  return (
    <div className="rounded-painel bg-cartao p-2.5">
      <h2 tabIndex={-1} className="tipo-titulo-3 text-tinta">
        Nenhum contato ainda.
      </h2>
    </div>
  );
}
