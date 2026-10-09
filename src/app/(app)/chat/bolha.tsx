"use client";

import { memo, useMemo, type ReactNode } from "react";
import {
  Ban,
  Check,
  CheckCheck,
  Clock,
  Forward,
  Info,
  Mic,
  TriangleAlert,
} from "lucide-react";
import { cn } from "@/lib/utils";
import { ROTULO_AUTOMATICA, tipoAutomaticaDaVia } from "@/lib/automaticas";
import { AvatarDaEquipe } from "./fotos";
import { textoEhRotulo } from "./metadados";
import { dataEHoraEmTexto, diaDaChave } from "./quando";
import type {
  ApagadaMensagem,
  Mensagem,
  ReacaoMensagem,
  RespostaCitada,
} from "./mensagem";
import {
  anelDeFoco,
  CartaoContato,
  CartaoLocalizacao,
  DocumentoNaBolha,
  Figurinha,
  GradeImagens,
  LinkNaBolha,
  VideoNaBolha,
} from "./midia";
import { PlayerAudio } from "./player-audio";

/*
 * As bolhas da conversa no jeito do WhatsApp: as nossas à direita na tinta,
 * as do contato à esquerda no cartão; rabinho na primeira de cada sequência
 * do mesmo remetente; hora e ✓/✓✓ dentro da bolha, no canto de baixo (a
 * lida em destaque, sem azul); o nome de quem da equipe mandou, pequeno e
 * com a foto (ou as iniciais), na primeira da sequência; o dia num chip que fica preso no alto enquanto a
 * conversa rola; imagens seguidas viram álbum; a resposta citada, a reação
 * embaixo da bolha certa e a mensagem apagada.
 *
 * Nota privada fica do nosso lado com o fio de atenção, sem rabinho; a nota
 * de sistema (resolver, adiar, atribuir) é uma linha fina no meio.
 */

/* ── Hora e dia, no fuso de Brasília ──────────────────────────────────── */

// Formatos de módulo: criar o formatador por bolha custava caro com 200
// bolhas a cada mensagem que chegava.
export const FORMATO_DIA = new Intl.DateTimeFormat("pt-BR", {
  timeZone: "America/Sao_Paulo",
});
const FORMATO_HORA = new Intl.DateTimeFormat("pt-BR", {
  timeZone: "America/Sao_Paulo",
  hour: "numeric",
  minute: "2-digit",
  hourCycle: "h23",
});

/** "9h", "9h05", "18h30": a hora no padrão brasileiro de texto. */
export function horaDaBolha(iso: string): string {
  const partes = FORMATO_HORA.formatToParts(new Date(iso));
  const h = Number(partes.find((p) => p.type === "hour")?.value ?? 0);
  const m = partes.find((p) => p.type === "minute")?.value ?? "00";
  return m === "00" ? `${h}h` : `${h}h${m}`;
}

const DIA_MS = 86_400_000;
const DIAS_DA_SEMANA = [
  "Domingo",
  "Segunda-feira",
  "Terça-feira",
  "Quarta-feira",
  "Quinta-feira",
  "Sexta-feira",
  "Sábado",
];

/** "07/10/2026" em milissegundos (UTC), para contar dias. */
function diaEmMs(chave: string): number | null {
  const m = /^(\d{2})\/(\d{2})\/(\d{4})$/.exec(chave);
  return m ? Date.UTC(Number(m[3]), Number(m[2]) - 1, Number(m[1])) : null;
}

/** "Hoje", "Ontem", o dia da semana até seis dias atrás, ou a data. */
function rotuloDoDia(chave: string, hoje: string, ontem: string): string {
  if (chave === hoje) return "Hoje";
  if (chave === ontem) return "Ontem";
  const dia = diaEmMs(chave);
  const agora = diaEmMs(hoje);
  if (dia !== null && agora !== null) {
    const diferenca = Math.round((agora - dia) / DIA_MS);
    if (diferenca > 1 && diferenca < 7) {
      return DIAS_DA_SEMANA[new Date(dia).getUTCDay()];
    }
  }
  return chave;
}

/* ── O que cada mensagem é ────────────────────────────────────────────── */

// Notas geradas por ação (adiar/resolver/atribuir) nascem com
// metadados.sistema = true; as antigas não têm o campo e se reconhecem pelo
// texto padrão que as actions sempre gravaram.
const PADROES_NOTA_SISTEMA = [
  /^Conversa (adiada|resolvida|reaberta)/,
  /^Atendimento atribuído/,
  /^Atendimento assumido/,
  /^Atendimento ficou sem/,
  /^Abriu conta na corretora/,
];

/**
 * A resposta automática do webhook (fora do horário, boas-vindas): gravada
 * como nota para a conversa continuar esperando um atendente, mas foi para
 * o contato. Na tela é bolha do nosso lado, como as enviadas.
 */
const respostaAutomatica = (m: Mensagem) =>
  m.tipo === "nota" ? tipoAutomaticaDaVia(m.metadados?.via) : null;

const ehNotaSistema = (m: Mensagem) =>
  m.tipo === "nota" &&
  respostaAutomatica(m) === null &&
  (m.metadados?.sistema === true ||
    PADROES_NOTA_SISTEMA.some((p) => p.test(m.conteudo ?? "")));

// Envio que saiu de um robô, não da mão do atendente: ganha a marca
// "Automático". As vias antigas seguem na lista para o histórico.
const VIAS_AUTOMACAO = new Set(["campanha", "cadencia", "disparo", "sync"]);

const ehAutomatica = (m: Mensagem) =>
  respostaAutomatica(m) !== null ||
  (m.tipo === "mensagem_enviada" && VIAS_AUTOMACAO.has(m.metadados?.via ?? ""));

/** Linhas que o webhook antigo gravava soltas, antes de reação, apagada e
 *  edição irem para a mensagem certa. Ficam como linha fina. */
const LEGADO_SOLTO: Record<string, string> = {
  reaction: "",
  revoke: "Apagou uma mensagem",
  edit: "Editou uma mensagem",
};

/**
 * O texto que a bolha mostra, ou null: o "[imagem]" e o nome do arquivo só
 * fazem sentido quando o anexo não aparece; localização, contato e o
 * formato não suportado têm cartão próprio.
 */
export function textoVisivel(m: Mensagem): string | null {
  const bruto = m.conteudo ?? "";
  if (!bruto.trim()) return null;
  const anexos = m.anexos ?? [];
  if (anexos.length > 0 && textoEhRotulo(bruto, anexos)) return null;
  if (m.localizacao && bruto.startsWith("[localização]")) return null;
  if ((m.contatos?.length ?? 0) > 0 && bruto.startsWith("[contato]")) return null;
  if (m.tipoMeta === "unsupported" && /^\[[^\]]+\]$/.test(bruto.trim())) {
    return null;
  }
  return bruto.replace(/\s+$/, "");
}

const ROTULO_MIDIA: Record<string, string> = {
  image: "Foto",
  sticker: "Figurinha",
  audio: "Áudio",
  video: "Vídeo",
  file: "Documento",
  link: "Link do Instagram",
};

/* ── Texto com a formatação do WhatsApp ───────────────────────────────── */

const LINK = /\b(?:https?:\/\/|www\.)[^\s<>"]+/gi;
const FIM_DE_LINK = /[.,;:!?)\]}'"]+$/;
// *negrito*, _itálico_, ~riscado~ e `código`: a marca encosta no texto por
// dentro e não fica no meio de palavra por fora (a regra do WhatsApp).
const MARCA = /(^|[^\p{L}\p{N}*_~`])([*_~`])(?=\S)([^\n]*?\S)\2(?![\p{L}\p{N}])/u;
const BLOCO_CODIGO = /```([\s\S]+?)```/g;

function emLinha(texto: string, chave: string): ReactNode[] {
  const saida: ReactNode[] = [];
  let resto = texto;
  let n = 0;
  while (resto) {
    const m = MARCA.exec(resto);
    if (!m) {
      saida.push(resto);
      break;
    }
    const antes = resto.slice(0, m.index) + m[1];
    if (antes) saida.push(antes);
    const k = `${chave}.${n++}`;
    const dentro = m[3];
    saida.push(
      m[2] === "*" ? (
        <strong key={k} className="font-semibold">
          {emLinha(dentro, k)}
        </strong>
      ) : m[2] === "_" ? (
        <em key={k}>{emLinha(dentro, k)}</em>
      ) : m[2] === "~" ? (
        <s key={k}>{emLinha(dentro, k)}</s>
      ) : (
        <code key={k} className="font-codigo">
          {dentro}
        </code>
      ),
    );
    resto = resto.slice(m.index + m[0].length);
  }
  return saida;
}

function comLinks(texto: string, chave: string, anel: string): ReactNode[] {
  const partes: ReactNode[] = [];
  let ultimo = 0;
  let n = 0;
  for (const m of texto.matchAll(LINK)) {
    const inicio = m.index ?? 0;
    const url = m[0].replace(FIM_DE_LINK, "");
    if (!url) continue;
    if (inicio > ultimo) {
      partes.push(...emLinha(texto.slice(ultimo, inicio), `${chave}t${n}`));
    }
    partes.push(
      <a
        key={`${chave}l${n}`}
        href={url.toLowerCase().startsWith("www.") ? `https://${url}` : url}
        target="_blank"
        rel="noopener noreferrer"
        className={cn("underline underline-offset-2", anel)}
      >
        {url}
      </a>,
    );
    ultimo = inicio + url.length;
    n++;
  }
  if (ultimo < texto.length) {
    partes.push(...emLinha(texto.slice(ultimo), `${chave}t${n}`));
  }
  return partes;
}

/** O texto da mensagem com link clicável e a formatação do WhatsApp. */
export function TextoFormatado({
  texto,
  sobreTinta = false,
}: {
  texto: string;
  sobreTinta?: boolean;
}) {
  const anel = anelDeFoco(sobreTinta);
  const partes: ReactNode[] = [];
  let ultimo = 0;
  let n = 0;
  for (const m of texto.matchAll(BLOCO_CODIGO)) {
    const inicio = m.index ?? 0;
    if (inicio > ultimo) {
      partes.push(...comLinks(texto.slice(ultimo, inicio), `b${n}`, anel));
    }
    partes.push(
      <code key={`c${n}`} className="font-codigo">
        {m[1]}
      </code>,
    );
    ultimo = inicio + m[0].length;
    n++;
  }
  if (ultimo < texto.length) {
    partes.push(...comLinks(texto.slice(ultimo), `b${n}`, anel));
  }
  return <>{partes}</>;
}

/** O trecho sem as marcas de formatação, para a citação e a legenda. */
function semMarcas(texto: string): string {
  return texto.replace(/```/g, "").replace(/(^|\s)[*_~`]+|[*_~`]+(?=\s|$)/g, "$1");
}

/* ── Peças da bolha ───────────────────────────────────────────────────── */

/**
 * Recibo do WhatsApp na bolha enviada: ✓ enviada, ✓✓ entregue, ✓✓ mais
 * forte e na cor do texto quando lida (ou ouvida, na mensagem de voz). A
 * falha sai embaixo da bolha, em texto.
 */
export function ReciboEnvio({
  status,
  classeLida,
}: {
  status: string | null | undefined;
  /** A cor da lida: a do texto da bolha (ou do chip sobre a imagem). */
  classeLida: string;
}) {
  if (status === "read" || status === "played") {
    return (
      <CheckCheck
        size={15}
        strokeWidth={2.75}
        aria-label={status === "played" ? "Ouvida" : "Lida"}
        className={cn("inline shrink-0", classeLida)}
      />
    );
  }
  if (status === "delivered") {
    return (
      <CheckCheck
        size={15}
        strokeWidth={1.75}
        aria-label="Entregue"
        className="inline shrink-0"
      />
    );
  }
  if (status === "sent") {
    return (
      <Check
        size={15}
        strokeWidth={1.75}
        aria-label="Enviada"
        className="inline shrink-0"
      />
    );
  }
  return null;
}

/** Hora, "Editada" e o recibo, no canto de baixo da bolha. */
function MetaBolha({
  m,
  comRecibo,
  sobreTinta,
  chip = false,
  espaco = false,
}: {
  m: Mensagem;
  comRecibo: boolean;
  sobreTinta: boolean;
  /** Sobre a foto: num chip, para ler em cima de qualquer imagem. */
  chip?: boolean;
  /** A cópia invisível que reserva o lugar no fim do texto. */
  espaco?: boolean;
}) {
  const classeLida = chip ? "text-tinta" : sobreTinta ? "text-fundo" : "text-tinta";
  return (
    <span
      aria-hidden={espaco || undefined}
      className={cn(
        "tipo-legenda inline-flex items-center gap-[3px] whitespace-nowrap tabular-nums",
        espaco && "invisible ml-1 align-baseline",
        chip
          ? "rounded-chip bg-fundo/85 px-0.5 py-[2px] text-tinta"
          : sobreTinta
            ? "text-primary-100"
            : "text-texto-2",
      )}
    >
      {/* Apagada não mostra a marca: o title da edição revelaria o texto
          que o contato apagou (ou que a equipe escondeu). */}
      {m.editada && !m.apagada ? (
        <span
          title={
            m.editada.original !== null
              ? `Antes da edição: ${m.editada.original}`
              : undefined
          }
        >
          Editada ·
        </span>
      ) : null}
      {m.pendente ? (
        <Clock size={12} strokeWidth={2} aria-label="Enviando" />
      ) : (
        <>
          <time dateTime={m.criado_em}>{horaDaBolha(m.criado_em)}</time>
          {comRecibo ? (
            <ReciboEnvio status={m.statusEnvio} classeLida={classeLida} />
          ) : null}
        </>
      )}
    </span>
  );
}

/** O rabinho da primeira bolha da sequência, no canto de cima. */
function Rabinho({ lado, classeCor }: { lado: Lado; classeCor: string }) {
  return (
    <svg
      aria-hidden
      viewBox="0 0 8 13"
      width="8"
      height="13"
      className={cn(
        "absolute top-0",
        lado === "nossa" ? "-right-[8px]" : "-left-[8px] -scale-x-100",
        classeCor,
      )}
    >
      <path d="M0 0h6.4c1.3 0 2 1.4 1.3 2.4L0 13z" fill="currentColor" />
    </svg>
  );
}

/** O texto da bolha apagada (pelo contato ou escondida pela equipe). Nota
 *  interna nunca chegou ao contato: sem a linha "Continua no aparelho". */
export function TextoApagada({
  apagada,
  sobreTinta,
  nota = false,
}: {
  apagada: ApagadaMensagem;
  sobreTinta: boolean;
  nota?: boolean;
}) {
  const apoio = sobreTinta ? "text-primary-100" : "text-texto-2";
  if (apagada.por === "contato") {
    return (
      <span className={cn("inline-flex items-center gap-0.5", apoio)}>
        <Ban size={16} strokeWidth={1.75} aria-hidden className="shrink-0" />
        Mensagem apagada
      </span>
    );
  }
  // A segunda linha fica em linha: a hora da bolha encosta no fim dela.
  return (
    <>
      <span className={cn("flex items-center gap-0.5", apoio)}>
        <Ban size={16} strokeWidth={1.75} aria-hidden className="shrink-0" />
        {apagada.nome ? `Apagada por ${apagada.nome}` : "Apagada pela equipe"}
      </span>
      {nota ? null : (
        <span className={cn("tipo-legenda", apoio)}>
          Continua no aparelho do contato.
        </span>
      )}
    </>
  );
}

/**
 * A mensagem citada no alto da bolha. Usa a citada carregada quando ela
 * está na tela (pega a marca de apagada, por exemplo) e o retrato gravado
 * quando não está. Tocar leva até ela.
 */
export function Citacao({
  resposta,
  citada,
  sobreTinta,
  aoIr,
}: {
  resposta: RespostaCitada;
  citada: Mensagem | null;
  sobreTinta: boolean;
  aoIr?: () => void;
}) {
  const apoio = sobreTinta ? "text-primary-100" : "text-texto-2";
  const caixa = cn(
    "mb-0.5 flex w-full min-w-0 overflow-hidden rounded-celula border-l-[3px] text-left",
    sobreTinta ? "border-primary-100 bg-tinta-hover" : "border-texto-3 bg-fundo",
  );

  if (resposta.story) {
    return (
      <div className={cn(caixa, "flex-col px-1 py-0.5")}>
        <span
          className={cn(
            "tipo-legenda font-semibold",
            sobreTinta ? "text-fundo" : "text-tinta",
          )}
        >
          Respondeu ao story
        </span>
        {resposta.story.url ? (
          <a
            href={resposta.story.url}
            target="_blank"
            rel="noreferrer"
            className={cn("tipo-nota underline underline-offset-2", apoio, anelDeFoco(sobreTinta))}
          >
            Ver o story (pode ter expirado)
          </a>
        ) : null}
      </div>
    );
  }

  const deContato = citada
    ? citada.tipo === "mensagem_recebida"
    : resposta.de === "contato";
  const autor = deContato
    ? (resposta.autor ?? "Contato")
    : (citada?.autor ??
      resposta.autor ??
      (citada && ehAutomatica(citada) ? "Automático" : "Equipe"));
  const apagada = citada?.apagada ?? null;
  const midia = citada ? (citada.anexos?.[0]?.tipo ?? null) : resposta.midia;
  const trechoBase = citada ? textoVisivel(citada) : resposta.trecho;
  const trecho = apagada
    ? "Mensagem apagada"
    : trechoBase
      ? semMarcas(trechoBase)
      : ((midia && ROTULO_MIDIA[midia]) ?? "Mensagem");
  const miniatura = apagada
    ? null
    : (citada?.anexos?.find((a) => a.tipo === "image")?.url ?? null);
  const IconeMidia = midia === "audio" ? Mic : null;

  return (
    <button
      type="button"
      onClick={aoIr}
      disabled={!aoIr}
      className={cn(
        caixa,
        "transition-colors duration-[120ms] disabled:cursor-default",
        sobreTinta ? "hover:bg-fundo/10" : "hover:bg-realce",
        anelDeFoco(sobreTinta),
      )}
    >
      <span className="sr-only">Ir para a mensagem citada: </span>
      <span className="min-w-0 flex-1 px-1 py-0.5">
        <span
          className={cn(
            "tipo-legenda block truncate font-semibold",
            sobreTinta ? "text-fundo" : "text-tinta",
          )}
        >
          {autor}
        </span>
        <span
          className={cn(
            "tipo-nota line-clamp-2 break-words",
            apoio,
            apagada && "inline-flex items-center gap-0.5",
          )}
        >
          {apagada ? <Ban size={13} strokeWidth={1.75} aria-hidden /> : null}
          {IconeMidia ? (
            <IconeMidia
              size={13}
              strokeWidth={1.75}
              aria-hidden
              className="mr-0.5 inline align-[-2px]"
            />
          ) : null}
          {trecho}
        </span>
      </span>
      {miniatura ? (
        // eslint-disable-next-line @next/next/no-img-element -- mídia do Storage, sem otimização do Next
        <img
          src={miniatura}
          alt=""
          loading="lazy"
          className="h-[56px] w-[56px] shrink-0 object-cover"
        />
      ) : null}
    </button>
  );
}

/**
 * As reações embaixo da bolha: os emojis, a contagem quando passa de um e,
 * para o leitor de tela, quem reagiu com o quê. `meuId` (de Bolhas, que a
 * Janela preenche com quem está usando) marca a pílula e o leitor diz "sua".
 */
export function ReacoesDaBolha({
  reacoes,
  lado,
  meuId,
}: {
  reacoes: ReacaoMensagem[];
  lado: Lado;
  meuId?: string | null;
}) {
  if (reacoes.length === 0) return null;
  const emojis = [...new Set(reacoes.map((r) => r.emoji))];
  const quem = reacoes
    .map(
      (r) =>
        `${r.emoji} ${
          r.de === "contato"
            ? "do contato"
            : r.de === meuId
              ? "sua"
              : `de ${r.nome ?? "alguém da equipe"}`
        }`,
    )
    .join(", ");
  const minha = Boolean(meuId) && reacoes.some((r) => r.de === meuId);
  return (
    <p
      title={quem}
      className={cn(
        "relative z-[1] -mt-[6px] inline-flex h-[28px] items-center gap-[2px] rounded-full border-2 border-fundo px-[6px]",
        minha ? "bg-selecao" : "bg-cartao",
        lado === "nossa" ? "mr-1" : "ml-1",
      )}
    >
      <span className="sr-only">Reações: {quem}</span>
      <span aria-hidden className="tipo-corpo leading-none">
        {emojis.join("")}
      </span>
      {reacoes.length > 1 ? (
        <span aria-hidden className="tipo-legenda text-texto-2 tabular-nums">
          {reacoes.length.toLocaleString("pt-BR")}
        </span>
      ) : null}
    </p>
  );
}

/* ── A montagem: dias, sequências e álbuns ────────────────────────────── */

type Lado = "nossa" | "deles";

type Bloco =
  | { tipo: "sistema"; m: Mensagem }
  | { tipo: "solta"; m: Mensagem; texto: string }
  | { tipo: "naoLidas"; quantidade: number; chave: string }
  | {
      tipo: "bolha";
      ms: Mensagem[];
      lado: Lado;
      remetente: string;
      primeira: boolean;
    };

type Dia = { chave: string; rotulo: string; blocos: Bloco[] };

/** Imagens que chegam com até 5 minutos entre uma e outra viram álbum. */
const ALBUM_MS = 5 * 60_000;

/** De quem é a bolha, para saber onde começa uma sequência nova. */
function remetente(m: Mensagem): string {
  if (m.tipo === "mensagem_recebida") return "contato";
  const resposta = respostaAutomatica(m);
  if (m.tipo === "nota" && resposta === null) return `nota:${m.autor ?? ""}`;
  return ehAutomatica(m)
    ? `auto:${resposta ?? m.metadados?.via ?? ""}`
    : `equipe:${m.autor ?? ""}`;
}

function falhouEnvio(m: Mensagem): boolean {
  return m.tipo !== "mensagem_recebida" && m.statusEnvio === "failed";
}

function semConfirmacao(m: Mensagem): boolean {
  return m.tipo !== "mensagem_recebida" && !m.statusEnvio && Boolean(m.erroEnvio);
}

/** Só imagem, sem texto, citação, marca nem aviso: pode entrar no álbum. */
function cabeNoAlbum(m: Mensagem): boolean {
  const anexos = m.anexos ?? [];
  return (
    anexos.length > 0 &&
    anexos.every((a) => a.tipo === "image") &&
    textoVisivel(m) === null &&
    !m.respostaA &&
    !m.apagada &&
    !m.encaminhada &&
    !m.pendente &&
    !falhouEnvio(m) &&
    !semConfirmacao(m)
  );
}

function montarDias(
  mensagens: Mensagem[],
  hoje: string,
  ontem: string,
  marca: MarcaNaoLidas | null,
): Dia[] {
  const dias: Dia[] = [];
  let dia: Dia | null = null;
  for (const m of mensagens) {
    const chave = FORMATO_DIA.format(new Date(m.criado_em));
    if (!dia || dia.chave !== chave) {
      dia = { chave, rotulo: rotuloDoDia(chave, hoje, ontem), blocos: [] };
      dias.push(dia);
    }
    if (marca && m.id === marca.id) {
      dia.blocos.push({
        tipo: "naoLidas",
        quantidade: marca.quantidade,
        chave: `nao-lidas-${m.id}`,
      });
    }
    if (ehNotaSistema(m)) {
      dia.blocos.push({ tipo: "sistema", m });
      continue;
    }
    const legado =
      m.tipo === "mensagem_recebida" && m.tipoMeta ? LEGADO_SOLTO[m.tipoMeta] : undefined;
    if (legado !== undefined) {
      dia.blocos.push({ tipo: "solta", m, texto: legado || (m.conteudo ?? "") });
      continue;
    }
    const quem = remetente(m);
    const anterior = dia.blocos[dia.blocos.length - 1];
    const mesmaSequencia = anterior?.tipo === "bolha" && anterior.remetente === quem;
    if (
      mesmaSequencia &&
      cabeNoAlbum(m) &&
      anterior.ms.every(cabeNoAlbum) &&
      Date.parse(m.criado_em) - Date.parse(anterior.ms[anterior.ms.length - 1].criado_em) <
        ALBUM_MS
    ) {
      anterior.ms.push(m);
      continue;
    }
    dia.blocos.push({
      tipo: "bolha",
      ms: [m],
      lado: m.tipo === "mensagem_recebida" ? "deles" : "nossa",
      remetente: quem,
      primeira: !mesmaSequencia,
    });
  }
  return dias;
}

/* ── A bolha ──────────────────────────────────────────────────────────── */

type PropsBolha = {
  ms: Mensagem[];
  lado: Lado;
  primeira: boolean;
  citada: Mensagem | null;
  destaque: boolean;
  meuId: string | null;
  aoAbrirImagem?: (mensagemId: string, url: string) => void;
  aoIrParaCitada?: (resposta: RespostaCitada) => void;
};

const Bolha = memo(
  function Bolha({
    ms,
    lado,
    primeira,
    citada,
    destaque,
    meuId,
    aoAbrirImagem,
    aoIrParaCitada,
  }: PropsBolha) {
    const m = ms[0];
    const ultima = ms[ms.length - 1];
    const resposta = respostaAutomatica(m);
    const nota = m.tipo === "nota" && resposta === null;
    const nossa = lado === "nossa";
    const sobreTinta = nossa && !nota;
    const automatica = ehAutomatica(m);
    const comRecibo = nossa && !nota;
    const apoio = sobreTinta ? "text-primary-100" : "text-texto-2";

    const anexos = ms.flatMap((x) =>
      (x.anexos ?? []).map((anexo) => ({ anexo, mensagemId: x.id })),
    );
    const apagada = ms.length === 1 ? (m.apagada ?? null) : null;
    const texto = apagada ? null : ms.length === 1 ? textoVisivel(m) : null;
    const naoSuportada =
      !apagada && m.tipoMeta === "unsupported" && texto === null && anexos.length === 0;
    const imagens = apagada ? [] : anexos.filter((a) => a.anexo.tipo === "image");
    const outros = apagada ? [] : anexos.filter((a) => a.anexo.tipo !== "image");
    const soFigurinha =
      !apagada &&
      texto === null &&
      !m.respostaA &&
      anexos.length > 0 &&
      anexos.every((a) => a.anexo.tipo === "sticker");
    const reacoes = apagada ? [] : ms.flatMap((x) => x.reacoes ?? []);
    const falhou = comRecibo && falhouEnvio(ultima);
    const avisoSemConfirmacao = comRecibo && semConfirmacao(ultima);

    // Onde a hora vai: no fim do texto; sobre a foto quando ela fecha a
    // bolha; na linha da duração do áudio; ou numa linha própria.
    const ultimoOutro = outros[outros.length - 1]?.anexo;
    const textual = Boolean(texto) || Boolean(apagada) || naoSuportada;
    const metaNaFoto =
      !textual &&
      imagens.length > 0 &&
      outros.length === 0 &&
      !m.localizacao &&
      (m.contatos?.length ?? 0) === 0;
    const metaNoAudio =
      !textual &&
      !metaNaFoto &&
      ultimoOutro?.tipo === "audio" &&
      !m.localizacao &&
      (m.contatos?.length ?? 0) === 0;
    const temMoldura = imagens.length > 0 || outros.some((a) => a.anexo.tipo === "video");
    const recuo = temMoldura ? "px-0.5" : "";

    const meta = (extra?: { chip?: boolean; espaco?: boolean }) => (
      <MetaBolha
        m={ultima}
        comRecibo={comRecibo}
        sobreTinta={sobreTinta}
        chip={extra?.chip}
        espaco={extra?.espaco}
      />
    );

    const nomeVisivel = primeira && nossa && !automatica && m.autor;
    const quemLe =
      lado === "deles"
        ? "Contato"
        : nota
          ? null
          : nomeVisivel
            ? null
            : (m.autor ?? (automatica ? "Automático" : "Equipe"));

    // A enviada por alguém da equipe leva, na primeira do grupo, a foto da
    // pessoa (ou as iniciais) pequena ao lado do nome.
    const cabecalho =
      nota || automatica ? (
        <p
          className={cn(
            "tipo-legenda truncate",
            recuo,
            temMoldura && "pt-0.5",
            nota ? "font-semibold text-atencao" : cn("font-semibold", apoio),
          )}
        >
          {nota
            ? `Nota privada${primeira && m.autor ? ` · ${m.autor}` : ""}`
            : `Automático${
                resposta
                  ? ` · ${ROTULO_AUTOMATICA[resposta]}`
                  : m.metadados?.campanha
                    ? ` · ${m.metadados.campanha}`
                    : ""
              }`}
        </p>
      ) : nomeVisivel ? (
        <p
          className={cn(
            "tipo-legenda flex min-w-0 items-center gap-0.5 font-semibold",
            recuo,
            temMoldura && "pt-0.5",
            apoio,
          )}
        >
          <AvatarDaEquipe id={m.autorId} nome={nomeVisivel} />
          <span className="min-w-0 truncate">{nomeVisivel}</span>
        </p>
      ) : null;

    const linhaEncaminhada = m.encaminhada ? (
      <p
        className={cn(
          "tipo-legenda inline-flex items-center gap-0.5",
          recuo,
          apoio,
        )}
      >
        <Forward size={13} strokeWidth={1.75} aria-hidden />
        {m.encaminhada === "muitas" ? "Encaminhada várias vezes" : "Encaminhada"}
      </p>
    ) : null;

    const listaImagens = imagens.map((a) => ({ url: a.anexo.url, nome: a.anexo.nome ?? null }));

    const corpo = soFigurinha ? (
      <div className="relative">
        <Figurinha anexo={anexos[0].anexo} />
        <span className="absolute right-0 bottom-0">{meta({ chip: true })}</span>
      </div>
    ) : (
      <div
        className={cn(
          "relative min-w-0 max-w-full rounded-painel",
          // Foto e vídeo: a bolha para em 320px de mídia, como no app; sem o
          // teto, a foto grande abria a bolha e a legenda ia junto.
          temMoldura ? "max-w-[min(100%,328px)] p-0.5" : "px-1 py-0.5",
          nota
            ? "border border-atencao bg-fundo text-tinta"
            : nossa
              ? cn("bg-tinta text-fundo", ultima.pendente && "opacity-70")
              : "bg-cartao text-tinta",
          primeira && !nota && (nossa ? "rounded-tr-none" : "rounded-tl-none"),
        )}
      >
        {primeira && !nota ? (
          <Rabinho lado={lado} classeCor={nossa ? "text-tinta" : "text-cartao"} />
        ) : null}
        {quemLe ? <span className="sr-only">{quemLe}: </span> : null}
        {cabecalho}
        {linhaEncaminhada}
        {m.respostaA && !apagada ? (
          <Citacao
            resposta={m.respostaA}
            citada={citada}
            sobreTinta={sobreTinta}
            aoIr={aoIrParaCitada ? () => aoIrParaCitada(m.respostaA!) : undefined}
          />
        ) : null}

        {imagens.length > 0 ? (
          <div className="relative w-fit max-w-full">
            <GradeImagens
              imagens={listaImagens}
              sobreTinta={sobreTinta}
              rotuloLado={nossa ? "enviada" : "do contato"}
              aoAbrir={(i) => aoAbrirImagem?.(imagens[i].mensagemId, imagens[i].anexo.url)}
            />
            {metaNaFoto ? (
              <span className="pointer-events-none absolute right-0.5 bottom-0.5">
                {meta({ chip: true })}
              </span>
            ) : null}
          </div>
        ) : null}

        {outros.length > 0 ? (
          <div className={cn("flex flex-col gap-0.5", imagens.length > 0 && "mt-0.5")}>
            {outros.map(({ anexo }, i) => {
              const chave = `${anexo.url}-${i}`;
              if (anexo.tipo === "audio") {
                return (
                  <PlayerAudio
                    key={chave}
                    url={anexo.url}
                    voz={anexo.voz}
                    sobreTinta={sobreTinta}
                    ouvida={ultima.statusEnvio === "played"}
                    rodape={metaNoAudio && i === outros.length - 1 ? meta() : undefined}
                  />
                );
              }
              if (anexo.tipo === "video") {
                return <VideoNaBolha key={chave} anexo={anexo} sobreTinta={sobreTinta} />;
              }
              if (anexo.tipo === "link") {
                return <LinkNaBolha key={chave} anexo={anexo} sobreTinta={sobreTinta} />;
              }
              if (anexo.tipo === "sticker") {
                return <Figurinha key={chave} anexo={anexo} />;
              }
              return <DocumentoNaBolha key={chave} anexo={anexo} sobreTinta={sobreTinta} />;
            })}
          </div>
        ) : null}

        {m.localizacao && !apagada ? (
          <div className={cn(anexos.length > 0 && "mt-0.5")}>
            <CartaoLocalizacao local={m.localizacao} sobreTinta={sobreTinta} />
          </div>
        ) : null}
        {!apagada && (m.contatos?.length ?? 0) > 0 ? (
          <div
            className={cn(
              "flex flex-col gap-0.5",
              (anexos.length > 0 || m.localizacao) && "mt-0.5",
            )}
          >
            {m.contatos!.map((c, i) => (
              <CartaoContato key={`${c.nome}-${i}`} contato={c} sobreTinta={sobreTinta} />
            ))}
          </div>
        ) : null}

        {textual ? (
          <p
            className={cn(
              "tipo-corpo break-words whitespace-pre-wrap",
              recuo,
              temMoldura && "pt-0.5",
            )}
          >
            {apagada ? (
              <TextoApagada apagada={apagada} sobreTinta={sobreTinta} nota={nota} />
            ) : naoSuportada ? (
              // Em linha, sem caixa flexível: a hora encosta no fim do texto.
              <span className={apoio}>
                <Info
                  size={16}
                  strokeWidth={1.75}
                  aria-hidden
                  className="mr-0.5 inline align-[-3px]"
                />
                Formato que a API do WhatsApp não mostra (enquete, evento ou
                visualização única).
              </span>
            ) : (
              <TextoFormatado texto={texto!} sobreTinta={sobreTinta} />
            )}
            {meta({ espaco: true })}
          </p>
        ) : null}

        {textual ? (
          <span className={cn("absolute bottom-0.5", temMoldura ? "right-1" : "right-1")}>
            {meta()}
          </span>
        ) : !metaNaFoto && !metaNoAudio ? (
          <p className={cn("flex justify-end pt-0.5", recuo)}>{meta()}</p>
        ) : null}
      </div>
    );

    return (
      <div
        data-msg={ms.map((x) => x.id).join(" ")}
        className={cn(
          "-mx-2 flex px-2 transition-colors duration-[700ms] md:-mx-3 md:px-3",
          nossa ? "justify-end" : "justify-start",
          primeira ? "mt-1.5" : "mt-0.5",
          destaque && "bg-selecao",
        )}
      >
        <div
          className={cn(
            "flex max-w-[min(80%,560px)] min-w-0 flex-col",
            nossa ? "items-end" : "items-start",
          )}
        >
          {corpo}
          {reacoes.length > 0 ? (
            <ReacoesDaBolha reacoes={reacoes} lado={lado} meuId={meuId} />
          ) : null}
          {falhou ? (
            <p className="tipo-nota mt-0.5 flex max-w-full items-start gap-0.5 text-erro">
              <TriangleAlert size={14} strokeWidth={2} aria-hidden className="mt-[2px] shrink-0" />
              <span className="min-w-0 break-words">
                Não entregue{ultima.erroEnvio ? `: ${ultima.erroEnvio}` : "."}
              </span>
            </p>
          ) : avisoSemConfirmacao ? (
            <p className="tipo-nota mt-0.5 flex max-w-full items-start gap-0.5 text-atencao">
              <TriangleAlert size={14} strokeWidth={2} aria-hidden className="mt-[2px] shrink-0" />
              <span className="min-w-0 break-words">{ultima.erroEnvio}</span>
            </p>
          ) : null}
        </div>
      </div>
    );
  },
  (a, b) =>
    a.lado === b.lado &&
    a.primeira === b.primeira &&
    a.citada === b.citada &&
    a.destaque === b.destaque &&
    a.meuId === b.meuId &&
    a.aoAbrirImagem === b.aoAbrirImagem &&
    a.aoIrParaCitada === b.aoIrParaCitada &&
    a.ms.length === b.ms.length &&
    a.ms.every((m, i) => m === b.ms[i]),
);

/* ── A lista ──────────────────────────────────────────────────────────── */

/** Onde começa o que ninguém viu, congelado na abertura da conversa. */
export type MarcaNaoLidas = { id: string; quantidade: number };

/**
 * As bolhas da conversa, memoizadas: cada tecla no compositor muda o estado
 * do pai, e sem isto as até 200 bolhas eram reconciliadas por tecla. Cada
 * bolha também é memoizada: a mensagem que chega só desenha a nova.
 */
export const Bolhas = memo(function Bolhas({
  mensagens,
  hojeChave,
  ontemChave,
  marcaNaoLidas = null,
  destaqueId = null,
  meuId = null,
  aoAbrirImagem,
  aoIrParaCitada,
}: {
  mensagens: Mensagem[];
  hojeChave: string;
  ontemChave: string;
  marcaNaoLidas?: MarcaNaoLidas | null;
  /** A mensagem marcada por um instante (a citada que a pessoa tocou). */
  destaqueId?: string | null;
  /** Quem está usando: a reação dele fica marcada e o leitor diz "sua". */
  meuId?: string | null;
  aoAbrirImagem?: (mensagemId: string, url: string) => void;
  aoIrParaCitada?: (resposta: RespostaCitada) => void;
}) {
  const dias = useMemo(
    () => montarDias(mensagens, hojeChave, ontemChave, marcaNaoLidas),
    [mensagens, hojeChave, ontemChave, marcaNaoLidas],
  );
  // A citada é procurada pela nossa linha ou pelo id da Meta.
  const busca = useMemo(() => {
    const porId = new Map<string, Mensagem>();
    const porIdMeta = new Map<string, Mensagem>();
    for (const m of mensagens) {
      porId.set(m.id, m);
      if (m.idMeta) porIdMeta.set(m.idMeta, m);
      for (const id of m.idsMeta ?? []) porIdMeta.set(id, m);
    }
    return { porId, porIdMeta };
  }, [mensagens]);
  const acharCitada = (r: RespostaCitada | null | undefined): Mensagem | null => {
    if (!r) return null;
    return (
      (r.interacaoId ? busca.porId.get(r.interacaoId) : undefined) ??
      (r.idMeta ? busca.porIdMeta.get(r.idMeta) : undefined) ??
      null
    );
  };

  return (
    <>
      {dias.map((dia) => (
        <div key={dia.chave}>
          {/* O dia fica preso no alto enquanto a conversa daquele dia passa. */}
          <div className="pointer-events-none sticky top-0 z-10 flex justify-center pt-1 pb-0.5">
            <p className="tipo-nota pointer-events-auto rounded-chip border border-fio bg-flutuante px-1 py-0.5 text-texto-2 tabular-nums">
              {dia.rotulo}
            </p>
          </div>
          {dia.blocos.map((bloco) => {
            if (bloco.tipo === "naoLidas") {
              return (
                <div
                  key={bloco.chave}
                  data-nao-lidas
                  className="mt-1.5 flex items-center gap-1"
                >
                  <span aria-hidden className="h-px flex-1 bg-fio" />
                  <p className="tipo-nota font-semibold text-tinta tabular-nums">
                    {bloco.quantidade === 1
                      ? "1 mensagem não lida"
                      : `${bloco.quantidade.toLocaleString("pt-BR")} mensagens não lidas`}
                  </p>
                  <span aria-hidden className="h-px flex-1 bg-fio" />
                </div>
              );
            }
            if (bloco.tipo === "sistema") {
              const m = bloco.m;
              // O agendamento do recontato diz quem, quando e por quê, nessa
              // ordem: "Ana agendou recontato para 12/10 às 9h: motivo". O
              // Desfazer do Feito e do Cancelar não é agendamento novo: "Ana
              // restaurou o recontato…".
              const r = m.recontato;
              const gesto = r?.restaurado
                ? "restaurou o recontato"
                : r?.reagendado
                  ? "reagendou o recontato"
                  : "agendou recontato";
              return (
                <p
                  key={m.id}
                  data-msg={m.id}
                  className="tipo-nota mx-auto mt-1.5 max-w-[min(80%,560px)] px-1 text-center text-texto-2"
                >
                  {r ? (
                    `${m.autor ?? "Alguém da equipe"} ${gesto} para ${dataEHoraEmTexto(r.quando, diaDaChave(hojeChave))}: ${r.motivo}`
                  ) : (
                    <>
                      {m.conteudo}
                      {m.autor ? ` · ${m.autor}` : ""}
                    </>
                  )}
                  <span className="tabular-nums"> · {horaDaBolha(m.criado_em)}</span>
                </p>
              );
            }
            if (bloco.tipo === "solta") {
              const m = bloco.m;
              return (
                <p
                  key={m.id}
                  data-msg={m.id}
                  className="tipo-nota mt-0.5 max-w-[min(80%,560px)] px-1 text-texto-2"
                >
                  {bloco.texto}
                  <span className="tabular-nums"> · {horaDaBolha(m.criado_em)}</span>
                </p>
              );
            }
            const primeiraMsg = bloco.ms[0];
            return (
              <Bolha
                key={primeiraMsg.id}
                ms={bloco.ms}
                lado={bloco.lado}
                primeira={bloco.primeira}
                citada={acharCitada(primeiraMsg.respostaA)}
                destaque={
                  destaqueId !== null && bloco.ms.some((m) => m.id === destaqueId)
                }
                meuId={meuId}
                aoAbrirImagem={aoAbrirImagem}
                aoIrParaCitada={aoIrParaCitada}
              />
            );
          })}
        </div>
      ))}
    </>
  );
});
