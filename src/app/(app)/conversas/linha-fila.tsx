"use client";

import { memo, useRef, useState } from "react";
import {
  Check,
  CheckCheck,
  Clock,
  RotateCcw,
  Undo2,
  UserPlus,
} from "lucide-react";
import { cn } from "@/lib/utils";
import { formatarDataCurta, formatarTelefone } from "@/lib/format";
import { AvatarContato } from "@/components/app/avatar-contato";
import { pontoDaEtiqueta } from "@/app/(app)/contatos/cor-etiqueta";
import type { PessoaEncontrada } from "@/app/(app)/busca/actions";
import {
  diaDaChave,
  diaEmTexto,
  horaEmTexto,
  partesEmBrasilia,
} from "@/app/(app)/chat/quando";
import { AvatarDaEquipe } from "@/app/(app)/chat/fotos";
import { recontatoDoDia } from "@/app/(app)/chat/recontato";
import type { LinhaConversa } from "./lista";

/*
 * A linha da fila e a linha de pessoa da busca. A linha diz de relance quem
 * espera e desde quando, se a janela de 24h está aberta e quem é o dono; o
 * peso fica só no estado (não lida, sem dono, só template). Lista do iOS:
 * sem cartão por linha, separador encaixado que começa no texto.
 */

/** De onde veio a abertura: decide se o compositor ganha o foco. */
export type OrigemAbertura = "ponteiro" | "toque" | "teclado";

const FORMATO_HORA = new Intl.DateTimeFormat("pt-BR", {
  timeZone: "America/Sao_Paulo",
  hour: "2-digit",
  minute: "2-digit",
});
const FORMATO_DIA_CURTO = new Intl.DateTimeFormat("pt-BR", {
  timeZone: "America/Sao_Paulo",
  day: "2-digit",
  month: "2-digit",
});
const FORMATO_DIA = new Intl.DateTimeFormat("pt-BR", {
  timeZone: "America/Sao_Paulo",
});

/** Prazo-sentinela do "adiar até responder" (ver chat/actions.ts). */
export function ateResponder(iso: string | null): boolean {
  return Boolean(iso?.startsWith("9999"));
}

/** Hoje vira hora ("21h45"); os outros dias, a data curta ("06/10"). */
export function horaOuDia(iso: string | null, hojeChave: string): string {
  if (!iso) return "";
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return "";
  return FORMATO_DIA.format(d) === hojeChave
    ? FORMATO_HORA.format(d).replace(":", "h")
    : FORMATO_DIA_CURTO.format(d);
}

/** Quando a adiada volta: "às 15h40" hoje (o "Por 1 hora"), a data nos
 *  outros dias ("12/10"). */
function voltaEmTexto(iso: string, hoje: string): string {
  const p = partesEmBrasilia(iso);
  return p.dia === hoje ? `às ${horaEmTexto(p.hora)}` : diaEmTexto(p.dia, hoje);
}

/** Quanto a pessoa espera: "12min", "3h", "2d". */
function rotuloEspera(horas: number): string {
  if (horas < 1) return `${Math.max(1, Math.round(horas * 60))}min`;
  if (horas < 48) return `${Math.floor(horas)}h`;
  return `${Math.floor(horas / 24)}d`;
}

/** Arrasto que vale: passou daqui, resolve (direita) ou adia (esquerda).
 *  Na conversa resolvida, só a esquerda vale, e reabre: resolver de novo
 *  gravaria outra nota "Conversa resolvida" e adiar não cabe. */
const LIMIAR = 72;
/** Toque longo que entra na seleção: parado (menos de 8px) por 450ms. */
const TOQUE_LONGO_MS = 450;
const TOLERANCIA_PX = 8;

const BOTAO_BANDEJA =
  "inline-flex h-[32px] w-[32px] items-center justify-center rounded-celula text-texto-2 transition-colors duration-[120ms] hover:bg-realce hover:text-tinta focus-visible:outline-2 focus-visible:outline-offset-1 focus-visible:outline-tinta disabled:text-texto-3";

/**
 * Uma linha da fila. Memoizada: com as callbacks estáveis do pai, uma
 * mensagem que chega refaz o render de UMA linha, não das 60 da página.
 */
export const LinhaFila = memo(function LinhaFila({
  linha,
  aberta,
  hojeChave,
  pendente,
  selecionando,
  selecionada,
  podeReativar,
  podeAssumir,
  somenteLeitura,
  modoRecontatos = false,
  coresEtiquetas,
  aoAbrir,
  aoAlternarSelecao,
  aoIniciarSelecao,
  aoResolver,
  aoAdiar,
  aoReativar,
  aoReabrir,
  aoAssumir,
}: {
  linha: LinhaConversa;
  aberta: boolean;
  hojeChave: string;
  pendente: boolean;
  /** Modo seleção em massa: o clique marca em vez de abrir. */
  selecionando: boolean;
  selecionada: boolean;
  /** Só na visão Adiadas: traz a conversa de volta antes do prazo. */
  podeReativar: boolean;
  /** O papel assume conversa sem dono (assessor, gestor, admin). */
  podeAssumir: boolean;
  /** O compliance só lê: sem bandeja, sem arrasto e sem toque longo (o
   *  servidor recusaria, e o gesto terminaria num erro). */
  somenteLeitura: boolean;
  /** Na visão Recontatos: a linha mostra o recontato (o motivo e a hora
   *  dele) mesmo antes do dia. */
  modoRecontatos?: boolean;
  /** A chave de cor de cada etiqueta, pelo id (catálogo da página). */
  coresEtiquetas: Map<string, string | null>;
  aoAbrir: (leadId: string, nome: string, origem: OrigemAbertura) => void;
  aoAlternarSelecao: (leadId: string) => void;
  /** Toque longo ou Shift/⌘ + clique: entra na seleção já com esta. */
  aoIniciarSelecao: (leadId: string) => void;
  aoResolver: (leadId: string) => void;
  aoAdiar: (leadId: string) => void;
  aoReativar: (leadId: string) => void;
  /** Conversa resolvida de volta à Caixa (o arrasto para a esquerda). */
  aoReabrir: (leadId: string) => void;
  aoAssumir: (leadId: string) => void;
}) {
  // A prévia e a hora entram de novo (fade) quando a conversa muda depois de
  // a linha estar na tela: é a marca da linha que se mexeu. Na primeira
  // pintura, nada anima.
  const [ultimaNaMontagem] = useState(linha.ultimaEm);
  const mudou = linha.ultimaEm !== ultimaNaMontagem;

  const [arrasto, setArrasto] = useState(0);
  const gestoRef = useRef<{ x: number; y: number; id: number } | null>(null);
  // O clique sintético chega DEPOIS do pointerup, quando o estado já voltou
  // a zero: só um ref segura a informação de que houve gesto.
  const engoleCliqueRef = useRef(false);
  const tipoPonteiroRef = useRef<string>("mouse");
  const toqueLongoRef = useRef<number | null>(null);
  // O dedo correu de lado, mesmo sem mover a linha (a resolvida para a
  // direita): o clique que vem depois do gesto não abre a conversa.
  const correuRef = useRef(false);
  const deslizando = arrasto !== 0;

  const cancelarToqueLongo = () => {
    if (toqueLongoRef.current !== null) {
      window.clearTimeout(toqueLongoRef.current);
      toqueLongoRef.current = null;
    }
  };

  const aoSoltar = () => {
    cancelarToqueLongo();
    const distancia = arrasto;
    gestoRef.current = null;
    setArrasto(0);
    if (Math.abs(distancia) >= TOLERANCIA_PX || correuRef.current) {
      engoleCliqueRef.current = true;
    }
    correuRef.current = false;
    if (distancia >= LIMIAR && !linha.resolvida) aoResolver(linha.leadId);
    else if (distancia <= -LIMIAR) {
      if (linha.resolvida) aoReabrir(linha.leadId);
      else if (podeReativar) aoReativar(linha.leadId);
      else aoAdiar(linha.leadId);
    }
  };

  const semDono = !linha.responsavelId;
  const adiadaNoPrazo = Boolean(linha.adiadaAte) && !linha.adiadaVencida;
  const esperando =
    linha.vez === "eles" &&
    linha.esperaHoras !== null &&
    !linha.resolvida &&
    !adiadaNoPrazo;

  // O recontato toma o lugar da prévia no dia (e atrasado), na cor de
  // atenção; na visão Recontatos, sempre, com a hora dele no lugar da hora
  // da mensagem.
  const hojeIso = diaDaChave(hojeChave);
  const recontato = linha.recontato;
  const recontatoVence = recontato ? recontatoDoDia(recontato, hojeIso) : false;
  const recontatoNaPrevia =
    recontato && (modoRecontatos || recontatoVence) ? recontato : null;
  let horaDoRecontato = "";
  if (recontato && modoRecontatos) {
    const p = partesEmBrasilia(recontato.quando);
    horaDoRecontato =
      p.dia === hojeIso ? horaEmTexto(p.hora) : diaEmTexto(p.dia, hojeIso);
  }
  // O recontato do dia já diz por que a conversa voltou: o "Adiamento
  // venceu" sai, para a linha não ter dois avisos de atenção.
  const voltouPeloRecontato = Boolean(recontatoNaPrevia && recontatoVence);

  // O que a linha diz embaixo, em texto curto: dono, estado, janela e
  // etiquetas. A cor só no estado, e nunca sozinha (sempre com a palavra).
  // O dono vem com a foto (ou as iniciais) do tamanho da linha.
  const meta: React.ReactNode[] = [];
  meta.push(
    semDono ? (
      <span key="dono" className="text-atencao">
        Sem dono
      </span>
    ) : (
      <span key="dono" className="flex items-center gap-0.5">
        {linha.responsavelNome ? (
          <AvatarDaEquipe
            id={linha.responsavelId}
            nome={linha.responsavelNome}
          />
        ) : null}
        {linha.responsavelNome}
      </span>
    ),
  );
  if (linha.resolvida) {
    meta.push(<span key="estado">Resolvida</span>);
  } else if (linha.adiadaVencida && !voltouPeloRecontato) {
    meta.push(
      <span key="estado" className="text-atencao">
        Adiamento venceu
      </span>,
    );
  } else if (linha.adiadaAte && !linha.adiadaVencida) {
    meta.push(
      <span key="estado">
        {ateResponder(linha.adiadaAte)
          ? "Adiada até responder"
          : `Volta ${voltaEmTexto(linha.adiadaAte, hojeIso)}`}
      </span>,
    );
  }
  if (!linha.resolvida && !linha.janelaAberta) {
    // Sem telefone não há template: o Direct fechado só reabre quando a
    // pessoa escreve.
    meta.push(
      <span key="janela" className="text-atencao">
        {linha.telefone ? "só template" : "Direct fechado"}
      </span>,
    );
  }
  // Uma etiqueta com o nome; as outras viram "+N". Duas lado a lado com o
  // estado viravam "V…" e "Supor…", e ninguém lia nenhuma.
  const [primeira, ...outras] = linha.etiquetas;
  if (primeira) {
    const ponto = pontoDaEtiqueta(coresEtiquetas.get(primeira.id));
    meta.push(
      <span key={`e-${primeira.id}`} className="inline-flex min-w-0 items-center gap-0.5">
        {ponto ? (
          <span
            aria-hidden
            className="h-[8px] w-[8px] shrink-0 rounded-full"
            style={{ backgroundColor: ponto }}
          />
        ) : null}
        <span className="truncate">{primeira.nome}</span>
        {outras.length > 0 ? (
          <span className="shrink-0 tabular-nums">+{outras.length}</span>
        ) : null}
      </span>,
    );
  }

  const previa =
    linha.previa ??
    (linha.instagram
      ? `@${linha.instagram}`
      : linha.telefone
        ? formatarTelefone(linha.telefone)
        : "");


  return (
    <div
      role="listitem"
      data-lead={linha.leadId}
      aria-busy={pendente || undefined}
      className="group/fila relative overflow-hidden"
    >
      {deslizando ? (
        // A pista atrás da linha enquanto o dedo arrasta: resolver à
        // esquerda, adiar (ou voltar) à direita. Chapada; a palavra diz o
        // que vai acontecer.
        <div
          aria-hidden
          className={cn(
            "absolute inset-0 flex items-center bg-cartao px-2 tipo-destaque",
            arrasto > 0 ? "justify-start" : "justify-end",
            Math.abs(arrasto) >= LIMIAR ? "text-tinta" : "text-texto-2",
          )}
        >
          <span className="inline-flex items-center gap-0.5">
            {arrasto > 0 ? (
              <>
                <Check size={18} strokeWidth={2.25} aria-hidden />
                {arrasto >= LIMIAR ? "Resolver" : "Arraste"}
              </>
            ) : (
              <>
                {arrasto <= -LIMIAR
                  ? linha.resolvida
                    ? "Reabrir"
                    : podeReativar
                      ? "Voltar à Caixa"
                      : "Adiar"
                  : "Arraste"}
                {linha.resolvida ? (
                  <Undo2 size={18} strokeWidth={1.75} aria-hidden />
                ) : podeReativar ? (
                  <RotateCcw size={18} strokeWidth={1.75} aria-hidden />
                ) : (
                  <Clock size={18} strokeWidth={1.75} aria-hidden />
                )}
              </>
            )}
          </span>
        </div>
      ) : null}

      <div
        className={cn(
          "relative flex touch-pan-y select-none [-webkit-touch-callout:none]",
          // O anel por dentro: o invólucro do gesto recorta o de fora. Só
          // para teclado (:focus-visible): o toque que volta da conversa
          // não deixa a linha com moldura.
          "has-[button:focus-visible]:ring-2 has-[button:focus-visible]:ring-tinta has-[button:focus-visible]:ring-inset",
          deslizando
            ? "bg-fundo"
            : "transition-colors duration-[120ms]",
          !deslizando &&
            (selecionada
              ? "bg-selecao"
              : aberta
                ? "bg-selecao"
                : "bg-fundo hover:bg-realce"),
          pendente && "opacity-60",
        )}
        style={
          deslizando ? { transform: `translateX(${arrasto}px)` } : undefined
        }
        onPointerDown={(e) => {
          tipoPonteiroRef.current = e.pointerType;
          if (e.pointerType === "mouse" || pendente || somenteLeitura) return;
          gestoRef.current = { x: e.clientX, y: e.clientY, id: e.pointerId };
          engoleCliqueRef.current = false;
          correuRef.current = false;
          cancelarToqueLongo();
          if (e.pointerType === "touch" && !selecionando) {
            toqueLongoRef.current = window.setTimeout(() => {
              toqueLongoRef.current = null;
              gestoRef.current = null;
              engoleCliqueRef.current = true;
              aoIniciarSelecao(linha.leadId);
            }, TOQUE_LONGO_MS);
          }
        }}
        onPointerMove={(e) => {
          const inicio = gestoRef.current;
          if (!inicio || inicio.id !== e.pointerId) return;
          const dx = e.clientX - inicio.x;
          const dy = e.clientY - inicio.y;
          if (Math.abs(dx) >= TOLERANCIA_PX || Math.abs(dy) >= TOLERANCIA_PX) {
            cancelarToqueLongo();
          }
          if (selecionando) return;
          // Rolagem vertical vence: o dedo desce a lista muito mais do que
          // arrasta a linha.
          if (arrasto === 0 && Math.abs(dy) > Math.abs(dx)) {
            gestoRef.current = null;
            return;
          }
          if (arrasto === 0 && Math.abs(dx) < TOLERANCIA_PX) return;
          correuRef.current = true;
          if (arrasto === 0) {
            // Captura só agora, quando já se sabe que o gesto é horizontal:
            // capturar no pointerdown atrapalharia a rolagem da lista.
            try {
              e.currentTarget.setPointerCapture(e.pointerId);
            } catch {
              // sem captura: o gesto ainda vale dentro da linha
            }
          }
          // Resolvida não vai para a direita: não há o que resolver.
          setArrasto(Math.max(-140, Math.min(linha.resolvida ? 0 : 140, dx)));
        }}
        onPointerUp={aoSoltar}
        onPointerCancel={() => {
          cancelarToqueLongo();
          gestoRef.current = null;
          setArrasto(0);
        }}
        onContextMenu={(e) => {
          // O toque longo é da seleção, não do menu do sistema.
          if (tipoPonteiroRef.current === "touch") e.preventDefault();
        }}
      >
        {/* O conteúdo é um BOTÃO: alcançável por Tab e anunciado pelo leitor
            de tela. Resolver, adiar e assumir são irmãos, não filhos: botão
            dentro de botão é HTML inválido. */}
        <button
          type="button"
          aria-current={aberta ? "true" : undefined}
          aria-pressed={selecionando ? selecionada : undefined}
          onClick={(e) => {
            if (engoleCliqueRef.current) {
              engoleCliqueRef.current = false;
              return;
            }
            if (selecionando) {
              aoAlternarSelecao(linha.leadId);
              return;
            }
            if (e.shiftKey || e.metaKey || e.ctrlKey) {
              aoIniciarSelecao(linha.leadId);
              return;
            }
            const origem: OrigemAbertura =
              e.detail === 0
                ? "teclado"
                : tipoPonteiroRef.current === "touch"
                  ? "toque"
                  : "ponteiro";
            aoAbrir(linha.leadId, linha.nome, origem);
          }}
          className="flex min-w-0 flex-1 items-start gap-1.5 pl-2 text-left outline-none"
        >
          {selecionando ? (
            <span
              aria-hidden
              className={cn(
                "mt-[22px] flex h-[22px] w-[22px] shrink-0 items-center justify-center rounded-celula border md:mt-[18px]",
                selecionada
                  ? "border-tinta bg-tinta text-fundo"
                  : "border-fio-forte bg-fundo",
              )}
            >
              {selecionada ? <Check size={16} strokeWidth={2.5} /> : null}
            </span>
          ) : null}
          <AvatarContato
            nome={linha.nome}
            leadId={linha.leadId}
            instagram={linha.direct}
            className="mt-1 h-[44px] w-[44px] tipo-nota font-semibold md:h-[40px] md:w-[40px]"
          />
          {/* Separador encaixado: o fio começa onde o texto começa. */}
          <span className="flex min-w-0 flex-1 flex-col border-t border-fio py-1 pr-2 group-first/fila:border-t-0">
            <span className="flex items-baseline gap-1">
              <span
                className={cn(
                  "tipo-destaque min-w-0 flex-1 truncate text-tinta",
                  linha.naoLida ? "font-semibold" : "font-medium",
                )}
              >
                {linha.nome}
              </span>
              {horaDoRecontato ? (
                <span
                  className={cn(
                    "tipo-nota shrink-0 tabular-nums",
                    recontatoVence ? "text-atencao" : "text-texto-2",
                  )}
                >
                  {horaDoRecontato}
                </span>
              ) : (
                <span
                  key={linha.ultimaEm ?? ""}
                  className={cn(
                    "tipo-nota shrink-0 tabular-nums",
                    esperando ? "font-semibold text-tinta" : "text-texto-2",
                    mudou && "animate-entrada",
                  )}
                >
                  {esperando
                    ? `há ${rotuloEspera(linha.esperaHoras ?? 0)}`
                    : horaOuDia(linha.ultimaEm, hojeChave)}
                </span>
              )}
            </span>
            <span className="mt-[2px] flex items-center gap-0.5">
              {recontatoNaPrevia ? (
                <span
                  className={cn(
                    "tipo-chamada min-w-0 flex-1 truncate",
                    recontatoVence ? "text-atencao" : "text-texto-2",
                  )}
                >
                  Recontato: {recontatoNaPrevia.motivo}
                </span>
              ) : (
                <>
                  {linha.vez === "nos" ? (
                    <CheckCheck
                      size={15}
                      strokeWidth={1.75}
                      aria-label="Última mensagem da equipe"
                      className="shrink-0 text-texto-3"
                    />
                  ) : null}
                  <span
                    key={linha.ultimaEm ?? ""}
                    className={cn(
                      "tipo-chamada min-w-0 flex-1 truncate",
                      linha.naoLida ? "text-tinta" : "text-texto-2",
                      mudou && "animate-entrada",
                    )}
                  >
                    {previa}
                  </span>
                </>
              )}
              {linha.naoLida ? (
                <span className="ml-0.5 flex h-[16px] shrink-0 items-center">
                  <span
                    aria-hidden
                    className="h-[10px] w-[10px] rounded-full bg-tinta"
                  />
                  <span className="sr-only">, não lida</span>
                </span>
              ) : null}
            </span>
            <span className="tipo-nota mt-[2px] flex min-w-0 items-center gap-0.5 overflow-hidden whitespace-nowrap text-texto-2">
              {meta.map((parte, i) => (
                <span
                  key={i}
                  className={cn(
                    "flex items-center gap-0.5",
                    i === meta.length - 1 && i > 0 ? "min-w-0 shrink" : "shrink-0",
                  )}
                >
                  {i > 0 ? (
                    <span aria-hidden className="shrink-0 text-texto-3">
                      ·
                    </span>
                  ) : null}
                  {parte}
                </span>
              ))}
            </span>
            {linha.sub && !voltouPeloRecontato ? (
              <span className="tipo-nota mt-[2px] truncate text-texto-2">
                {linha.sub}
              </span>
            ) : null}
          </span>
        </button>

        {/* No mouse, as ações da linha aparecem no hover e no foco de
            teclado. No toque valem o arrasto e o toque longo. O compliance
            não tem bandeja: só lê. */}
        {!selecionando && !somenteLeitura ? (
          <div className="absolute top-1/2 right-1.5 hidden -translate-y-1/2 gap-0.5 rounded-controle border border-fio bg-flutuante p-0.5 shadow-lg group-hover/fila:flex group-has-[:focus-visible]/fila:flex">
            {podeAssumir && semDono && !linha.resolvida ? (
              <button
                type="button"
                aria-label={`Assumir a conversa com ${linha.nome}`}
                title="Assumir"
                disabled={pendente}
                onClick={() => aoAssumir(linha.leadId)}
                className={BOTAO_BANDEJA}
              >
                <UserPlus size={17} strokeWidth={1.75} aria-hidden />
              </button>
            ) : null}
            {!linha.resolvida ? (
              <button
                type="button"
                aria-label={`Resolver a conversa com ${linha.nome}`}
                title="Resolver"
                disabled={pendente}
                onClick={() => aoResolver(linha.leadId)}
                className={BOTAO_BANDEJA}
              >
                <Check size={17} strokeWidth={2} aria-hidden />
              </button>
            ) : null}
            {podeReativar ? (
              <button
                type="button"
                aria-label={`Trazer a conversa com ${linha.nome} de volta para a Caixa`}
                title="Voltar para a Caixa"
                disabled={pendente}
                onClick={() => aoReativar(linha.leadId)}
                className={BOTAO_BANDEJA}
              >
                <RotateCcw size={17} strokeWidth={1.75} aria-hidden />
              </button>
            ) : !linha.resolvida ? (
              <button
                type="button"
                aria-label={`Adiar a conversa com ${linha.nome} até amanhã`}
                title="Adiar até amanhã"
                disabled={pendente}
                onClick={() => aoAdiar(linha.leadId)}
                className={BOTAO_BANDEJA}
              >
                <Clock size={17} strokeWidth={1.75} aria-hidden />
              </button>
            ) : (
              <button
                type="button"
                aria-label={`Reabrir a conversa com ${linha.nome}`}
                title="Reabrir"
                disabled={pendente}
                onClick={() => aoReabrir(linha.leadId)}
                className={BOTAO_BANDEJA}
              >
                <Undo2 size={17} strokeWidth={1.75} aria-hidden />
              </button>
            )}
          </div>
        ) : null}
      </div>
    </div>
  );
});

/* ── Pessoa achada pela busca única ───────────────────────────────────── */

const ROTULO_ESTADO: Record<PessoaEncontrada["estado"], string> = {
  aberta: "Em aberto",
  adiada: "Adiada",
  resolvida: "Resolvida",
  sem_conversa: "Sem conversa",
};

/**
 * Quem a busca achou fora da visão em uso (resolvida, adiada, contato que
 * nunca conversou). Escolher abre a conversa no palco, como uma linha da
 * fila; contato sem conversa abre com o template como saída.
 */
export function LinhaPessoa({
  pessoa,
  aoAbrir,
}: {
  pessoa: PessoaEncontrada;
  aoAbrir: (leadId: string, nome: string, origem: OrigemAbertura) => void;
}) {
  const tipoPonteiroRef = useRef("mouse");
  const contato = pessoa.telefone
    ? formatarTelefone(pessoa.telefone)
    : pessoa.instagram
      ? `@${pessoa.instagram}`
      : null;
  const estado =
    pessoa.estado === "adiada" && pessoa.adiadaAte
      ? ateResponder(pessoa.adiadaAte)
        ? "Adiada até responder"
        : `Adiada até ${formatarDataCurta(pessoa.adiadaAte)}`
      : ROTULO_ESTADO[pessoa.estado];
  return (
    <li className="group/fila">
      <button
        type="button"
        onPointerDown={(e) => {
          tipoPonteiroRef.current = e.pointerType;
        }}
        onClick={(e) =>
          aoAbrir(
            pessoa.leadId,
            pessoa.nome,
            e.detail === 0
              ? "teclado"
              : tipoPonteiroRef.current === "touch"
                ? "toque"
                : "ponteiro",
          )
        }
        className="flex w-full items-start gap-1.5 pl-2 text-left transition-colors duration-[120ms] outline-none hover:bg-realce focus-visible:ring-2 focus-visible:ring-tinta focus-visible:ring-inset"
      >
        <AvatarContato
          nome={pessoa.nome}
          leadId={pessoa.leadId}
          instagram={false}
          className="mt-1 h-[44px] w-[44px] tipo-nota font-semibold md:h-[40px] md:w-[40px]"
        />
        <span className="flex min-w-0 flex-1 flex-col border-t border-fio py-1 pr-2 group-first/fila:border-t-0">
          <span className="tipo-destaque truncate font-medium text-tinta">
            {pessoa.nome}
          </span>
          <span className="tipo-nota mt-[2px] truncate text-texto-2">
            {[contato, estado, pessoa.responsavelNome ?? "Sem dono"]
              .filter(Boolean)
              .join(" · ")}
          </span>
        </span>
      </button>
    </li>
  );
}
