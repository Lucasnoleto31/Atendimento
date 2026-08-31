"use client";

import {
  Fragment,
  memo,
  useActionState,
  useCallback,
  useEffect,
  useMemo,
  useOptimistic,
  useRef,
  useState,
  useSyncExternalStore,
} from "react";
import { useFormStatus } from "react-dom";
import { ignorarEcoRealtime } from "./tempo-real";
import Link from "next/link";
import {
  ArrowDown,
  Check,
  CheckCheck,
  LoaderCircle,
  Paperclip,
  Send,
  Sparkles,
  SpellCheck,
  TriangleAlert,
  X,
  Zap,
} from "lucide-react";
import { cn } from "@/lib/utils";
import { sugestaoStore } from "./sugestao-store";
import type { TemplateWhatsapp } from "@/lib/whatsapp";
import { BotaoTemplates } from "./templates";
import { GravadorAudio } from "./gravador-audio";
import { createClient as criarClienteNavegador } from "@/lib/supabase/client";
import {
  enviarMensagemLead,
  marcarChatLido,
  prepararUploadAnexo,
  type ResultadoEnvio,
} from "./actions";
import { carregarMensagensAnteriores } from "@/app/(app)/hoje/actions";
import { corrigirTexto, sugerirResposta } from "./ia";

const ESTADO: ResultadoEnvio = {};
// 30s: o tempo real (Supabase) cobre o imediato; o polling é só rede de
// segurança. Intervalos curtos derrubavam o Safari do iPhone por memória.
// Rede de segurança, não motor: o Realtime cobre o ao-vivo; isto pega o
// que escapar (canal caído, aba dormida).
const INTERVALO_ATUALIZACAO = 60_000;

function assinarPonteiroGrosso(avisar: () => void) {
  const mq = window.matchMedia("(pointer: coarse)");
  mq.addEventListener("change", avisar);
  return () => mq.removeEventListener("change", avisar);
}

function lerPonteiroGrosso() {
  return window.matchMedia("(pointer: coarse)").matches;
}
const MAX_ANEXOS = 5;
const MAX_TAMANHO_ANEXO = 16 * 1024 * 1024; // teto do WhatsApp para mídia
const MAX_IMAGEM = 5 * 1024 * 1024; // o WhatsApp limita imagem a 5MB
const LIMIAR_FIM_PX = 80;

// Mesmo fuso usado no servidor para as chaves de dia dos separadores.
const FORMATO_DIA = new Intl.DateTimeFormat("pt-BR", {
  timeZone: "America/Sao_Paulo",
});

export type Anexo = { tipo: string; url: string; nome?: string | null };

/** O que a conversa precisa dos metadados da interação (page.tsx repassa). */
export type MetadadosMensagem = {
  /** Nota gerada por ação (adiar/resolver/atribuir) — vira linha de sistema. */
  sistema?: boolean;
  /** Por onde a mensagem saiu: "crm" (manual), "campanha", "cadencia"… */
  via?: string | null;
  /** Nome da campanha, quando o envio veio de uma. */
  campanha?: string | null;
};

export type Mensagem = {
  id: string;
  tipo: "mensagem_recebida" | "mensagem_enviada" | "nota";
  conteudo: string | null;
  criado_em: string;
  autor: string | null;
  anexos?: Anexo[];
  statusEnvio?: string | null;
  erroEnvio?: string | null;
  pendente?: boolean;
  metadados?: MetadadosMensagem | null;
};

export type MensagemPadrao = {
  id: string;
  titulo: string;
  corpo: string;
  /** Arquivos da mensagem padrão (0060) — entram na fila de anexos ao usar. */
  anexos?: Anexo[] | null;
};

const horario = (iso: string) =>
  new Date(iso).toLocaleString("pt-BR", {
    day: "2-digit",
    month: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
  });

// Notas geradas por ação (adiar/resolver/atribuir) nascem com
// metadados.sistema = true; as antigas não têm o campo — reconhece pelo
// texto padrão que as actions sempre gravaram.
const PADROES_NOTA_SISTEMA = [
  /^Conversa (adiada|resolvida|reaberta)/,
  /^Atendimento atribuído/,
  /^Abriu conta na corretora/,
];

const ehNotaSistema = (mensagem: Mensagem) =>
  mensagem.tipo === "nota" &&
  (mensagem.metadados?.sistema === true ||
    PADROES_NOTA_SISTEMA.some((p) => p.test(mensagem.conteudo ?? "")));

// Envio que saiu de um robô, não da mão do atendente — ganha o selo
// "automático" na bolha (auditoria: ~1.600 envios indistinguíveis).
const VIAS_AUTOMACAO = new Set(["campanha", "cadencia", "disparo", "sync"]);

/**
 * As bolhas da conversa, memoizadas: cada tecla no compositor muda o estado
 * `texto` do pai, e sem isto as até 200 bolhas eram reconciliadas por tecla
 * — o lag de digitação medido na auditoria.
 */
const Bolhas = memo(function Bolhas({
  mensagens,
  hojeChave,
  ontemChave,
}: {
  mensagens: Mensagem[];
  hojeChave: string;
  ontemChave: string;
}) {
  const rotuloDia = (iso: string) => {
    const chave = FORMATO_DIA.format(new Date(iso));
    return chave === hojeChave ? "Hoje" : chave === ontemChave ? "Ontem" : chave;
  };
  return (
    <>
      {mensagens.map((mensagem, i) => {
              const enviada = mensagem.tipo === "mensagem_enviada";
              const nota = mensagem.tipo === "nota";
              const anexos = mensagem.anexos ?? [];
              // O placeholder "[imagem]" só faz sentido quando o anexo não é exibido.
              const soPlaceholder =
                anexos.length > 0 && /^\[.+\]$/.test(mensagem.conteudo ?? "");
              const dia = rotuloDia(mensagem.criado_em);
              const mostraDia =
                i === 0 || rotuloDia(mensagens[i - 1].criado_em) !== dia;
              // Log de sistema não é conversa: vira uma linha fina no meio do
              // fluxo — a bolha âmbar fica só para nota escrita por gente.
              if (ehNotaSistema(mensagem)) {
                return (
                  <Fragment key={mensagem.id}>
                    {mostraDia ? (
                      <span className="self-center rounded-sm bg-neutral-100 px-1 py-0.5 text-xs font-medium text-neutral-600">
                        {dia}
                      </span>
                    ) : null}
                    <p className="max-w-[75%] self-center px-1 text-center text-xs text-neutral-400">
                      {mensagem.conteudo}
                      {mensagem.autor ? ` — ${mensagem.autor}` : ""}
                      <span className="font-mono tabular-nums">
                        {" · "}
                        {horario(mensagem.criado_em)}
                      </span>
                    </p>
                  </Fragment>
                );
              }
              const automatica =
                enviada &&
                VIAS_AUTOMACAO.has(mensagem.metadados?.via ?? "");
              return (
                <Fragment key={mensagem.id}>
                  {mostraDia ? (
                    <span className="self-center rounded-sm bg-neutral-100 px-1 py-0.5 text-xs font-medium text-neutral-600">
                      {dia}
                    </span>
                  ) : null}
                  <div
                    className={cn(
                      "max-w-[75%] px-1.5 py-1 shadow-sm",
                      nota
                        ? "self-end rounded-[16px] rounded-br-[4px] border border-accent-300 bg-accent-100"
                        : enviada
                          ? cn(
                              "self-end rounded-[16px] rounded-br-[4px]",
                              // Pendente clareia UM passo (não opacity: 70%
                              // sobre o azul derrubava o texto abaixo de AA).
                              mensagem.pendente
                                ? "bg-primary-500"
                                : "bg-primary-600",
                            )
                          : "self-start rounded-[16px] rounded-bl-[4px] border border-neutral-200 bg-neutral-0",
                      mensagem.pendente && !enviada ? "opacity-70" : "",
                    )}
                  >
                    {nota ? (
                      <p className="text-xs font-medium tracking-[0.06em] text-accent-700 uppercase">
                        Nota privada
                      </p>
                    ) : null}
                    {automatica ? (
                      <p className="text-xs text-primary-100">
                        automático
                        {mensagem.metadados?.campanha
                          ? ` · ${mensagem.metadados.campanha}`
                          : ""}
                      </p>
                    ) : null}
                    {anexos.length > 0 ? (
                      <div className="mb-0.5 flex flex-col gap-0.5">
                        {anexos.map((anexo, j) => (
                          <AnexoMensagem
                            key={j}
                            anexo={anexo}
                            sobreEscuro={enviada}
                          />
                        ))}
                      </div>
                    ) : null}
                    {!soPlaceholder ? (
                      <p
                        className={cn(
                          "text-sm break-words whitespace-pre-wrap",
                          enviada ? "text-neutral-0" : "text-neutral-800",
                        )}
                      >
                        {mensagem.conteudo}
                      </p>
                    ) : null}
                    <p
                      className={cn(
                        "mt-0.5 flex items-center justify-end gap-0.5 text-right font-mono text-xs tabular-nums",
                        enviada
                          ? // Sobre primary-500 (pendente) o primary-100 cai
                            // para 4,4:1 — o branco segura AA nos dois temas.
                            mensagem.pendente
                            ? "text-neutral-0"
                            : "text-primary-100"
                          : "text-neutral-400",
                      )}
                    >
                      {(enviada || nota) && mensagem.autor
                        ? `${mensagem.autor} · `
                        : ""}
                      {mensagem.pendente ? (
                        "enviando…"
                      ) : (
                        <>
                          {horario(mensagem.criado_em)}
                          {enviada ? (
                            <ReciboEnvio
                              status={mensagem.statusEnvio}
                              erro={mensagem.erroEnvio}
                            />
                          ) : null}
                        </>
                      )}
                    </p>
                  </div>
                </Fragment>
              );
            })}
    </>
  );
});

type AnexoRemotoEnvio = {
  caminho: string;
  nome: string;
  tipo: string;
  tamanho: number;
};

const BOTAO_FERRAMENTA =
  "inline-flex h-[40px] w-[40px] shrink-0 items-center justify-center rounded-md border border-neutral-300 bg-neutral-0 text-neutral-600 transition-colors duration-[120ms] hover:bg-neutral-100 hover:text-neutral-800 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-primary-500";

/**
 * Preferência de assinatura por navegador (localStorage) como store
 * externo — o formato que o React pede para fonte fora do estado.
 */
const assinaturaStore = {
  ouvintes: new Set<() => void>(),
  subscribe(cb: () => void) {
    assinaturaStore.ouvintes.add(cb);
    return () => {
      assinaturaStore.ouvintes.delete(cb);
    };
  },
  ler() {
    return localStorage.getItem("chat_assinar") === "1";
  },
  lerNoServidor() {
    return false;
  },
  gravar(valor: boolean) {
    localStorage.setItem("chat_assinar", valor ? "1" : "0");
    assinaturaStore.ouvintes.forEach((cb) => cb());
  },
};

/**
 * `sobreEscuro`: o anexo está dentro da bolha enviada (fundo primary-600).
 * O anel de foco padrão é primary-500 — sobre o azul ele fica em 1,4:1, ou
 * seja, invisível para quem navega por teclado. Lá o anel vira branco.
 */
function AnexoMensagem({
  anexo,
  sobreEscuro = false,
}: {
  anexo: Anexo;
  sobreEscuro?: boolean;
}) {
  const anel = sobreEscuro
    ? "focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-neutral-0"
    : "focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-primary-500";
  if (anexo.tipo === "image") {
    return (
      <a
        href={anexo.url}
        target="_blank"
        rel="noreferrer"
        className={cn("rounded-md", anel)}
      >
        {/* eslint-disable-next-line @next/next/no-img-element -- URL externa da mídia, sem otimização do Next */}
        <img
          src={anexo.url}
          alt={anexo.nome ?? "Imagem da conversa"}
          loading="lazy"
          className="max-h-[240px] w-auto max-w-full rounded-md border border-neutral-200"
        />
      </a>
    );
  }
  // Players nativos também recebem foco por Tab — sem o anel da casa sobra
  // só o do navegador, que sobre o azul da bolha some.
  if (anexo.tipo === "audio") {
    return <audio controls src={anexo.url} className={cn("max-w-full", anel)} />;
  }
  if (anexo.tipo === "video") {
    return (
      <video
        controls
        src={anexo.url}
        className={cn("max-h-[240px] w-auto max-w-full rounded-md", anel)}
      />
    );
  }
  // Documento: cartão com o nome do arquivo (o link solto "Abrir anexo" não
  // dizia nem o que era).
  return (
    <a
      href={anexo.url}
      target="_blank"
      rel="noreferrer"
      className={cn(
        "inline-flex max-w-full items-center gap-1 rounded-md border border-neutral-200 bg-neutral-0 px-1.5 py-1 text-sm text-neutral-800 transition-colors duration-[120ms] hover:bg-neutral-100",
        anel,
      )}
    >
      <Paperclip
        size={16}
        strokeWidth={1.5}
        aria-hidden
        className="shrink-0 text-neutral-400"
      />
      <span className="truncate">{anexo.nome ?? "Abrir documento"}</span>
    </a>
  );
}

/**
 * Recibo do WhatsApp: ✓ enviada, ✓✓ entregue, ✓✓ branco lida, alerta falhou.
 * Só existe em bolha enviada — as cores assumem o fundo primary-600 (o par
 * com neutral-0/primary-100 segura AA nos dois temas; falha vira chip
 * danger sobre danger-bg, o único par vermelho legível sobre o azul).
 */
function ReciboEnvio({
  status,
  erro,
}: {
  status: string | null | undefined;
  erro: string | null | undefined;
}) {
  if (status === "failed") {
    return (
      <span
        title={erro ?? "O WhatsApp recusou a mensagem."}
        className="inline-flex items-center gap-0.5 rounded-sm bg-danger-bg px-0.5 text-danger"
      >
        <TriangleAlert size={12} strokeWidth={1.5} aria-hidden />
        falhou
      </span>
    );
  }
  if (status === "read") {
    return (
      <CheckCheck
        size={14}
        strokeWidth={1.5}
        aria-label="Lida"
        className="inline text-neutral-0"
      />
    );
  }
  if (status === "delivered") {
    return (
      <CheckCheck
        size={14}
        strokeWidth={1.5}
        aria-label="Entregue"
        className="inline text-primary-100"
      />
    );
  }
  if (status === "sent") {
    return (
      <Check
        size={14}
        strokeWidth={1.5}
        aria-label="Enviada"
        className="inline text-primary-100"
      />
    );
  }
  return null;
}

function BotaoEnviar({
  desabilitado,
  nota,
}: {
  desabilitado: boolean;
  nota: boolean;
}) {
  const { pending } = useFormStatus();
  const rotulo = nota ? "Salvar nota privada" : "Enviar mensagem";
  return (
    <button
      type="submit"
      disabled={pending || desabilitado}
      aria-label={rotulo}
      title={rotulo}
      className={cn(
        "inline-flex h-[40px] w-[40px] shrink-0 items-center justify-center rounded-full text-neutral-0 transition-colors duration-[120ms] focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-primary-500 disabled:cursor-not-allowed disabled:opacity-60",
        nota
          ? "bg-accent-700 hover:bg-accent-700/90"
          : "bg-primary-600 hover:bg-primary-700",
      )}
    >
      {pending ? (
        <LoaderCircle
          size={18}
          strokeWidth={1.5}
          aria-hidden
          className="animate-spin"
        />
      ) : (
        <Send size={18} strokeWidth={1.5} aria-hidden />
      )}
    </button>
  );
}

/**
 * Situação da janela de 24h do WhatsApp para mensagem livre. O restante
 * vem calculado do servidor; aqui só desce um tique por minuto.
 */
function BannerJanela({ restanteInicialMs }: { restanteInicialMs: number }) {
  const [tique, setTique] = useState(0);

  // O servidor recalcula a cada atualização; zera o tique quando isso chega.
  const [baseAnterior, setBaseAnterior] = useState(restanteInicialMs);
  if (baseAnterior !== restanteInicialMs) {
    setBaseAnterior(restanteInicialMs);
    setTique(0);
  }

  useEffect(() => {
    const intervalo = setInterval(() => setTique((t) => t + 1), 60_000);
    return () => clearInterval(intervalo);
  }, []);

  const restanteMs = restanteInicialMs - tique * 60_000;
  if (restanteMs <= 0) {
    // Pílula com o par semântico da casa (warning sobre warning-bg), o mesmo
    // dos badges de status. Mede 3,5:1 no tema claro — dívida do design
    // system, não desta tela: mexer no token afeta todos os badges do app.
    return (
      <p className="inline-flex items-center gap-1 self-start rounded-full bg-warning-bg px-1 py-0.5 text-xs font-medium text-warning">
        <span
          aria-hidden
          className="h-[8px] w-[8px] shrink-0 rounded-full bg-warning"
        />
        Janela de 24h fechada — só template chega ao lead.
      </p>
    );
  }

  const horas = Math.floor(restanteMs / 3_600_000);
  const minutos = Math.floor((restanteMs % 3_600_000) / 60_000);
  return (
    <p className="flex items-center gap-1 px-0.5 text-xs text-neutral-600">
      <span
        aria-hidden
        className="h-[8px] w-[8px] shrink-0 rounded-full bg-success"
      />
      Janela aberta — fecha em{" "}
      <span className="font-mono tabular-nums">
        {horas > 0
          ? `${horas}h${String(minutos).padStart(2, "0")}`
          : `${minutos}min`}
      </span>
      .
    </p>
  );
}

function formatarTamanho(bytes: number) {
  return bytes >= 1024 * 1024
    ? `${(bytes / 1024 / 1024).toFixed(1)}MB`
    : `${Math.max(1, Math.round(bytes / 1024))}KB`;
}

export function Janela({
  leadId,
  temConversa,
  mensagens,
  mensagensPadrao,
  templates,
  restanteJanela,
  marketingBloqueado,
  hojeChave,
  ontemChave,
  aoEnviarComSucesso,
  aoRecarregarPeriodico,
  aoEnviarTemplate,
}: {
  leadId: string;
  temConversa: boolean;
  mensagens: Mensagem[];
  mensagensPadrao: MensagemPadrao[];
  templates: TemplateWhatsapp[];
  restanteJanela: number | null;
  marketingBloqueado: boolean;
  hojeChave: string;
  ontemChave: string;
  /** Chamado quando um envio conclui com sucesso (painel da /hoje usa). */
  aoEnviarComSucesso?: () => void;
  /** Rede de segurança de 60s da tela que hospeda a janela. Sem isto a
   *  Janela não recarrega nada sozinha — quem tem tempo real não passa. */
  aoRecarregarPeriodico?: () => void;
  /** Um template saiu: o painel de contexto precisa recontar. */
  aoEnviarTemplate?: () => void;
}) {
  const [estado, formAction, enviandoAcao] = useActionState(
    enviarMensagemLead,
    ESTADO,
  );
  const [texto, setTexto] = useState("");
  const [modo, setModo] = useState<"responder" | "nota">("responder");
  const assinar = useSyncExternalStore(
    assinaturaStore.subscribe,
    assinaturaStore.ler,
    assinaturaStore.lerNoServidor,
  );
  // Balão fantasma do Chat da Mesa: o palco pede a sugestão à IA e deposita
  // no store; ela só aparece enquanto a caixa está vazia e é DESTE lead.
  const sugestaoBruta = useSyncExternalStore(
    sugestaoStore.subscribe,
    sugestaoStore.ler,
    sugestaoStore.lerNoServidor,
  );
  // A condição completa vive mais abaixo (precisa de janelaFechada).

  const caixaRef = useRef<HTMLDivElement>(null);
  const formRef = useRef<HTMLFormElement>(null);
  const textareaRef = useRef<HTMLTextAreaElement>(null);

  // Confirmadas locais: sem revalidatePath no envio, a bolha otimista
  // reverteria quando a action termina — a interação que ela devolve entra
  // aqui e segura a mensagem na tela até um refresh natural alcançá-la
  // (aí o filtro por id descarta a cópia local).
  const [confirmadasLocais, setConfirmadasLocais] = useState<Mensagem[]>([]);
  // Histórico antigo trazido sob demanda (a conversa abre com as 200
  // últimas; conversa de cliente velho passa disso).
  const [anteriores, setAnteriores] = useState<Mensagem[]>([]);
  const [temAnteriores, setTemAnteriores] = useState(true);
  const [buscandoAnteriores, setBuscandoAnteriores] = useState(false);
  const baseMensagens = useMemo(() => {
    const base =
      anteriores.length > 0 ? [...anteriores, ...mensagens] : mensagens;
    if (confirmadasLocais.length === 0) return base;
    const noServidor = new Set(base.map((m) => m.id));
    const locais = confirmadasLocais.filter((m) => !noServidor.has(m.id));
    return locais.length > 0 ? [...base, ...locais] : base;
  }, [mensagens, anteriores, confirmadasLocais]);

  /**
   * Traz o lote anterior ao mais antigo que está na tela. A caixa é
   * ancorada pela altura para o conteúdo novo não empurrar a leitura.
   */
  const carregarAnteriores = async () => {
    const maisAntiga = baseMensagens[0];
    if (!maisAntiga || buscandoAnteriores) return;
    setBuscandoAnteriores(true);
    const caixa = caixaRef.current;
    const alturaAntes = caixa?.scrollHeight ?? 0;
    try {
      const r = await carregarMensagensAnteriores(leadId, maisAntiga.criado_em);
      if ("erro" in r) {
        setAvisoArquivo(r.erro);
      } else {
        setTemAnteriores(r.temMais);
        if (r.mensagens.length === 0) setTemAnteriores(false);
        else setAnteriores((a) => [...r.mensagens, ...a]);
      }
    } catch {
      setAvisoArquivo("Sem resposta do servidor — tente de novo.");
    } finally {
      setBuscandoAnteriores(false);
      // Mantém o olho onde estava: o conteúdo entrou ACIMA.
      requestAnimationFrame(() => {
        const c = caixaRef.current;
        if (c) c.scrollTop += c.scrollHeight - alturaAntes;
      });
    }
  };

  // Envio otimista: a mensagem aparece na hora, em cinza, enquanto viaja.
  const [listaMensagens, adicionarOtimista] = useOptimistic<
    Mensagem[],
    Mensagem
  >(baseMensagens, (lista, nova) => [...lista, nova]);
  const contadorOtimistaRef = useRef(0);

  // Mensagens prontas: painel abre pelo botão de raio ou digitando "/".
  const [prontasAbertas, setProntasAbertas] = useState(false);
  // Anexos de uma pronta ainda baixando — o Enviar espera terminar.
  const [baixandoPronta, setBaixandoPronta] = useState(false);
  const [busca, setBusca] = useState("");
  const [idxSel, setIdxSel] = useState(0);
  const [barraSuprimida, setBarraSuprimida] = useState(false);

  // Anexos: o estado espelha o input de arquivo (via DataTransfer), então o
  // form envia exatamente o que os chips mostram.
  const [arquivos, setArquivos] = useState<File[]>([]);
  const [avisoArquivo, setAvisoArquivo] = useState<string | null>(null);
  const inputArquivosRef = useRef<HTMLInputElement>(null);

  // IA (sugerir/corrigir) e erro de envio: declarados aqui em cima porque o
  // bloco de troca de lead (mais abaixo, durante o render) limpa os três.
  const [iaOcupada, setIaOcupada] = useState<"sugerir" | "corrigir" | null>(
    null,
  );
  const [erroIa, setErroIa] = useState<string | null>(null);
  // O menu único de IA (sugerir/corrigir) — um botão só na barra.
  const [iaAberta, setIaAberta] = useState(false);
  // O erro de envio mora num estado próprio (não direto no estado da action):
  // a action retém o erro até o PRÓXIMO envio concluir, e o slot único de
  // erro mostraria o erro velho por cima de avisos novos de anexo/IA.
  const [erroEnvio, setErroEnvio] = useState<string | null>(null);

  // Rolagem: só cola no fim se o atendente já estava perto do fim.
  const pertoDoFimRef = useRef(true);
  const [novasAbaixo, setNovasAbaixo] = useState(false);

  const chaveRascunho = `chat_rascunho_${leadId}`;

  // Restaura o rascunho salvo ao abrir/trocar de conversa.
  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect -- sincroniza com o armazenamento externo do rascunho ao trocar de conversa
    setTexto(localStorage.getItem(chaveRascunho) ?? "");
  }, [chaveRascunho]);

  const totalRef = useRef(mensagens.length);
  useEffect(() => {
    const caixa = caixaRef.current;
    if (!caixa || listaMensagens.length === totalRef.current) return;
    totalRef.current = listaMensagens.length;
    if (pertoDoFimRef.current) {
      caixa.scrollTop = caixa.scrollHeight;
    } else {
      setNovasAbaixo(true);
    }
  }, [listaMensagens.length]);

  useEffect(() => {
    const caixa = caixaRef.current;
    if (caixa) caixa.scrollTop = caixa.scrollHeight;
    // roda uma vez, ao montar/trocar de conversa
  }, [leadId]);

  // Abrir a conversa marca como lida — UMA vez, na montagem. Antes o servidor
  // marcava a cada render: a aba aberta de um colega apagava o "não lida" da
  // equipe a cada 30s e desfazia o "marcar como não lida".
  // Troca de conversa zera as confirmadas da anterior — ajuste de estado
  // durante o render (padrão do React para "estado derivado de prop"), sem
  // efeito e sem render em cascata.
  const [leadAnterior, setLeadAnterior] = useState(leadId);
  if (leadId !== leadAnterior) {
    setLeadAnterior(leadId);
    setConfirmadasLocais([]);
    setAnteriores([]);
    setTemAnteriores(true);
    // Erro e avisos são da conversa anterior — não podem vazar para esta.
    setErroEnvio(null);
    setAvisoArquivo(null);
    setErroIa(null);
  }

  useEffect(() => {
    void marcarChatLido(leadId);
  }, [leadId]);

  // Rede de segurança periódica — só onde a tela pede. O chat tem tempo
  // real e polling próprios: lá este intervalo refazia o server component
  // inteiro de minuto em minuto, justamente o que o redesign eliminou.
  // A callback vive num ref para o intervalo não reiniciar a cada render.
  const recargaPeriodicaRef = useRef(aoRecarregarPeriodico);
  useEffect(() => {
    recargaPeriodicaRef.current = aoRecarregarPeriodico;
  }, [aoRecarregarPeriodico]);
  const temRecargaPeriodica = Boolean(aoRecarregarPeriodico);
  useEffect(() => {
    if (!temRecargaPeriodica) return;
    const intervalo = setInterval(() => {
      if (document.visibilityState === "visible") {
        recargaPeriodicaRef.current?.();
      }
    }, INTERVALO_ATUALIZACAO);
    return () => clearInterval(intervalo);
  }, [temRecargaPeriodica]);

  // Teclado virtual (iPhone/Android): sem Shift+Enter, Enter deve quebrar
  // linha. Lido do cliente; no servidor assume teclado físico.
  const ehToque = useSyncExternalStore(
    assinarPonteiroGrosso,
    lerPonteiroGrosso,
    () => false,
  );

  // A caixa limpa no envio (aoEnviar); aqui só o desfecho: sucesso descarta o
  // backup, erro devolve texto e anexos para o atendente tentar de novo.
  const [backupEnvio, setBackupEnvio] = useState<{
    texto: string;
    arquivos: File[];
  } | null>(null);
  const [estadoAnterior, setEstadoAnterior] = useState(estado);
  if (estado !== estadoAnterior) {
    setEstadoAnterior(estado);
    if (estado.ok) {
      setBackupEnvio(null);
      setAvisoArquivo(null);
      setErroEnvio(null);
      aoEnviarComSucesso?.();
      if (estado.interacao) {
        // O eco do Realtime desta mensagem não custa refresh…
        ignorarEcoRealtime(estado.interacao.id);
        // …e ela fica na tela por conta própria, sem re-render da página.
        const nova: Mensagem = {
          id: estado.interacao.id,
          tipo: estado.interacao.tipo,
          conteudo: estado.interacao.conteudo,
          criado_em: estado.interacao.criado_em,
          autor: estado.interacao.autor,
          anexos: estado.interacao.anexos,
        };
        setConfirmadasLocais((atuais) =>
          atuais.some((m) => m.id === nova.id) ? atuais : [...atuais, nova],
        );
      }
    } else if (estado.erro) {
      setErroEnvio(estado.erro);
      if (backupEnvio) {
        setTexto(backupEnvio.texto);
        setArquivos(backupEnvio.arquivos);
        setBackupEnvio(null);
      }
    }
  }

  // O input de arquivo é externo ao React: espelha o estado num efeito — cobre
  // adicionar, remover, limpar no envio e restaurar depois de um erro.
  useEffect(() => {
    const input = inputArquivosRef.current;
    if (!input) return;
    const dt = new DataTransfer();
    arquivos.forEach((arquivo) => dt.items.add(arquivo));
    input.files = dt.files;
  }, [arquivos]);

  const atualizarTexto = (valor: string) => {
    setTexto(valor);
    setIdxSel(0);
    if (!valor.startsWith("/")) setBarraSuprimida(false);
    if (valor) localStorage.setItem(chaveRascunho, valor);
    else localStorage.removeItem(chaveRascunho);
  };

  const slashAtivo = texto.startsWith("/") && !barraSuprimida;
  const painelAberto =
    temConversa && (slashAtivo || prontasAbertas) ? true : false;
  const filtro = (slashAtivo ? texto.slice(1) : busca).trim().toLowerCase();
  const prontasFiltradas = filtro
    ? mensagensPadrao.filter(
        (m) =>
          m.titulo.toLowerCase().includes(filtro) ||
          m.corpo.toLowerCase().includes(filtro),
      )
    : mensagensPadrao;
  const idxAtivo = Math.min(idxSel, Math.max(prontasFiltradas.length - 1, 0));

  const fecharPainel = () => {
    setProntasAbertas(false);
    setBusca("");
    if (texto.startsWith("/")) setBarraSuprimida(true);
    textareaRef.current?.focus();
  };

  const aplicarPronta = (pronta: MensagemPadrao) => {
    atualizarTexto(pronta.corpo);
    setProntasAbertas(false);
    setBusca("");
    setIdxSel(0);
    textareaRef.current?.focus();

    // Anexos da pronta: baixa do bucket e coloca na fila de envio — o mesmo
    // caminho de um arquivo escolhido à mão, com prévia e revisão antes do
    // Enviar. As mesmas regras do colar/arrastar valem aqui: nota privada e
    // janela de 24h fechada não recebem anexo (avisa em vez de anexar).
    const anexosPronta = pronta.anexos ?? [];
    if (anexosPronta.length === 0) return;
    if (modo === "nota") {
      setAvisoArquivo(
        "Nota privada não leva anexo — os arquivos desta mensagem pronta ficaram de fora.",
      );
      return;
    }
    if (restanteJanela === null || restanteJanela <= 0) {
      setAvisoArquivo(
        "Janela de 24h fechada — só template chega. Os anexos da mensagem pronta ficaram de fora.",
      );
      return;
    }
    // Corte com nome e sobrenome: o atendente precisa saber QUAL arquivo da
    // pronta ficou de fora (o texto pode citar exatamente o PDF descartado).
    const espaco = MAX_ANEXOS - arquivos.length;
    const entram = anexosPronta.slice(0, Math.max(espaco, 0));
    const sobraram = anexosPronta.slice(Math.max(espaco, 0));
    if (sobraram.length > 0) {
      setAvisoArquivo(
        `A fila já tinha ${arquivos.length} arquivo(s) — ficaram de fora: ${sobraram
          .map((a) => a.nome || "anexo")
          .join(", ")}.`,
      );
    }
    if (entram.length === 0) return;
    // Enquanto baixa, o Enviar segura: sem isto, o Enter rápido mandava o
    // texto sem os arquivos e eles grudavam na mensagem SEGUINTE.
    setBaixandoPronta(true);
    void (async () => {
      try {
        const dt = new DataTransfer();
        for (const anexo of entram) {
          const resposta = await fetch(anexo.url);
          if (!resposta.ok) throw new Error(`HTTP ${resposta.status}`);
          const blob = await resposta.blob();
          dt.items.add(
            new File([blob], anexo.nome || "anexo", { type: blob.type }),
          );
        }
        adicionarArquivos(dt.files);
      } catch {
        setAvisoArquivo(
          "Não deu para carregar o anexo da mensagem pronta — envie o texto e anexe à mão.",
        );
      } finally {
        setBaixandoPronta(false);
      }
    })();
  };

  // IA: sugestão lê a conversa e propõe a próxima mensagem; correção arruma a
  // ortografia do que foi digitado. Nos dois casos o texto só CAI NA CAIXA —
  // nada vai ao lead sem o atendente revisar e apertar Enviar.
  const aplicarTextoIa = (valor: string) => {
    atualizarTexto(valor);
    textareaRef.current?.focus();
  };

  const pedirSugestao = () => {
    setErroIa(null);
    setAvisoArquivo(null); // aviso velho não pode mascarar o erro da IA
    setIaOcupada("sugerir");
    sugerirResposta(leadId)
      .then((r) => {
        if (r.erro) setErroIa(r.erro);
        else if (r.sugestao) aplicarTextoIa(r.sugestao);
      })
      .catch(() => setErroIa("Não deu para falar com a IA agora — tente de novo."))
      .finally(() => setIaOcupada(null));
  };

  const pedirCorrecao = () => {
    setErroIa(null);
    setAvisoArquivo(null); // aviso velho não pode mascarar o erro da IA
    setIaOcupada("corrigir");
    corrigirTexto(texto)
      .then((r) => {
        if (r.erro) setErroIa(r.erro);
        else if (r.corrigido) aplicarTextoIa(r.corrigido);
      })
      .catch(() => setErroIa("Não deu para falar com a IA agora — tente de novo."))
      .finally(() => setIaOcupada(null));
  };

  const anexarGravacao = (arquivo: File) => {
    const dt = new DataTransfer();
    dt.items.add(arquivo);
    adicionarArquivos(dt.files);
  };

  const adicionarArquivos = useCallback((novos: FileList | null) => {
    if (!novos || novos.length === 0) return;
    setAvisoArquivo(null);

    const aceitos: File[] = [];
    for (const arquivo of Array.from(novos)) {
      if (arquivo.size > MAX_TAMANHO_ANEXO) {
        setAvisoArquivo(
          `"${arquivo.name}" passa de 16MB — o WhatsApp não aceita.`,
        );
        continue;
      }
      if (arquivo.type.startsWith("image/") && arquivo.size > MAX_IMAGEM) {
        setAvisoArquivo(
          `"${arquivo.name}" passa de 5MB — o WhatsApp limita imagem a 5MB (envie como documento ou reduza).`,
        );
        continue;
      }
      aceitos.push(arquivo);
    }

    setArquivos((atuais) => {
      if (atuais.length + aceitos.length > MAX_ANEXOS) {
        setAvisoArquivo(`No máximo ${MAX_ANEXOS} anexos por mensagem.`);
      }
      return atuais;
    });
    setArquivos((atuais) => [...atuais, ...aceitos].slice(0, MAX_ANEXOS));
  }, []);

  const removerArquivo = (indice: number) => {
    setArquivos(arquivos.filter((_, i) => i !== indice));
  };

  // Ctrl+V em QUALQUER lugar da conversa anexa o print/imagem — como no
  // WhatsApp Web, sem exigir foco na caixa de texto. Colagem em outros
  // campos (busca, datas, variáveis de template) segue normal.
  useEffect(() => {
    const aoColar = (e: ClipboardEvent) => {
      if (modo === "nota" || !temConversa) return;
      if (restanteJanela === null || restanteJanela <= 0) return; // janela fechada
      const alvo = e.target as HTMLElement | null;
      if (
        alvo &&
        alvo !== textareaRef.current &&
        (alvo.tagName === "INPUT" ||
          alvo.tagName === "TEXTAREA" ||
          alvo.isContentEditable)
      ) {
        return;
      }
      const colados = Array.from(e.clipboardData?.files ?? []);
      if (colados.length === 0) return;
      e.preventDefault();
      const dt = new DataTransfer();
      colados.forEach((arquivo) => dt.items.add(arquivo));
      adicionarArquivos(dt.files);
    };
    window.addEventListener("paste", aoColar);
    return () => window.removeEventListener("paste", aoColar);
  }, [modo, temConversa, restanteJanela, adicionarArquivos]);

  // Arrastar um print para a janela: sem interceptar, o navegador NAVEGA
  // para o arquivo ("abre a imagem") e derruba a conversa. O preventDefault
  // vale SEMPRE que houver arquivo no arrasto — anexar é que depende das
  // mesmas condições do colar (modo, conversa, janela de 24h).
  useEffect(() => {
    const temArquivo = (e: DragEvent) =>
      Array.from(e.dataTransfer?.types ?? []).includes("Files");
    const aoArrastarSobre = (e: DragEvent) => {
      if (temArquivo(e)) e.preventDefault();
    };
    const aoSoltar = (e: DragEvent) => {
      if (!temArquivo(e)) return;
      e.preventDefault();
      if (modo === "nota" || !temConversa) return;
      if (restanteJanela === null || restanteJanela <= 0) return;
      const soltos = Array.from(e.dataTransfer?.files ?? []);
      if (soltos.length === 0) return;
      const dt = new DataTransfer();
      soltos.forEach((arquivo) => dt.items.add(arquivo));
      adicionarArquivos(dt.files);
    };
    window.addEventListener("dragover", aoArrastarSobre);
    window.addEventListener("drop", aoSoltar);
    return () => {
      window.removeEventListener("dragover", aoArrastarSobre);
      window.removeEventListener("drop", aoSoltar);
    };
  }, [modo, temConversa, restanteJanela, adicionarArquivos]);

  // Janela de 24h do WhatsApp: fora dela (ou se o lead nunca respondeu), a
  // Meta aceita a mensagem livre e DESCARTA depois — enviar é gritar no vazio.
  // O composer trava e aponta o template, que é o único que chega.
  const janelaFechada =
    modo === "responder" && (restanteJanela === null || restanteJanela <= 0);

  const podeEnviar =
    !baixandoPronta &&
    (modo === "nota"
      ? texto.trim().length > 0
      : !janelaFechada && (texto.trim().length > 0 || arquivos.length > 0));

  // O balão fantasma só aparece com a caixa vazia, em modo resposta, para
  // ESTE lead e com a janela de 24h aberta — fora dela o texto livre não
  // chega, e sugerir seria convidar a escrever para o vazio.
  const sugestaoFantasma =
    sugestaoBruta &&
    sugestaoBruta.leadId === leadId &&
    texto === "" &&
    modo === "responder" &&
    !janelaFechada
      ? sugestaoBruta.texto
      : null;

  // Um slot de erro só: três parágrafos empilhados brigavam por atenção.
  // Aviso de anexo primeiro (é sempre reação ao ÚLTIMO gesto), depois IA,
  // depois o erro de envio — que é estado próprio zerado a cada envio novo,
  // para um erro velho nunca mascarar um aviso fresco.
  const erroCompositor = avisoArquivo || erroIa || erroEnvio || null;

  const aoRolar = () => {
    const caixa = caixaRef.current;
    if (!caixa) return;
    const perto =
      caixa.scrollHeight - caixa.scrollTop - caixa.clientHeight < LIMIAR_FIM_PX;
    pertoDoFimRef.current = perto;
    if (perto && novasAbaixo) setNovasAbaixo(false);
  };

  const irParaFim = () => {
    const caixa = caixaRef.current;
    if (caixa) caixa.scrollTop = caixa.scrollHeight;
    pertoDoFimRef.current = true;
    setNovasAbaixo(false);
  };

  const aoEnviar = async (formData: FormData) => {
    // Anexos da pronta em voo: enviar agora mandaria o texto sem eles.
    if (baixandoPronta) return;
    // Envio novo zera os avisos da rodada anterior — o que aparecer a partir
    // daqui é deste envio.
    setErroEnvio(null);
    setAvisoArquivo(null);
    setErroIa(null);
    const textoEnvio = String(formData.get("texto") ?? "").trim();
    // O arquivo NÃO viaja no corpo da requisição (a Vercel corta em ~4,5MB e
    // a página quebrava): sobe direto do navegador ao Storage por URL
    // assinada, e a action recebe só as referências.
    formData.delete("arquivos");

    if (modo === "responder" && (textoEnvio || arquivos.length > 0)) {
      contadorOtimistaRef.current += 1;
      adicionarOtimista({
        id: `otimista-${contadorOtimistaRef.current}`,
        tipo: "mensagem_enviada",
        conteudo: textoEnvio || "[anexo]",
        criado_em: new Date().toISOString(),
        autor: null,
        pendente: true,
      });
      pertoDoFimRef.current = true; // envio próprio sempre desce a tela
    }

    if (modo === "responder" && arquivos.length > 0) {
      const remotos: AnexoRemotoEnvio[] = [];
      const storage = criarClienteNavegador().storage.from("midia-whatsapp");
      // Em paralelo: cinco anexos custavam dez idas em série (preparo +
      // upload de cada um); agora custam o tempo do mais lento.
      type ResultadoUpload =
        | { erro: string }
        | { erro?: undefined; remoto: AnexoRemotoEnvio };
      const resultados: ResultadoUpload[] = await Promise.all(
        arquivos.map(async (arquivo): Promise<ResultadoUpload> => {
          const preparo = await prepararUploadAnexo(arquivo.name);
          if (preparo.erro || !preparo.caminho || !preparo.token) {
            return { erro: preparo.erro ?? "Não deu para preparar o upload." };
          }
          const { error } = await storage.uploadToSignedUrl(
            preparo.caminho,
            preparo.token,
            arquivo,
          );
          if (error) {
            return { erro: `Falha ao subir "${arquivo.name}": ${error.message}` };
          }
          return {
            remoto: {
              caminho: preparo.caminho,
              nome: arquivo.name,
              tipo: arquivo.type,
              tamanho: arquivo.size,
            },
          };
        }),
      );
      for (const resultado of resultados) {
        if (resultado.erro !== undefined) {
          setAvisoArquivo(resultado.erro);
          return;
        }
        remotos.push(resultado.remoto);
      }
      formData.set("anexos_remotos", JSON.stringify(remotos));
    }

    // A caixa limpa no clique, não quando o servidor responder — se o envio
    // falhar, o texto e os anexos voltam (backup restaurado no estado.erro).
    // Nota privada não envia anexos: eles ficam para a resposta ao lead.
    setBackupEnvio({ texto, arquivos });
    setTexto("");
    // A sugestão morre no envio: ela é derivada de "caixa vazia", então sem
    // isto o balão RESSUSCITAVA logo depois do Enviar — oferecendo resposta
    // para a mensagem que acabou de sair.
    sugestaoStore.limpar(leadId);
    if (modo !== "nota") setArquivos([]);
    localStorage.removeItem(chaveRascunho);
    formAction(formData);
  };

  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <div className="relative min-h-0 flex-1">
        <div
          ref={caixaRef}
          onScroll={aoRolar}
          aria-label="Histórico da conversa"
          className="flex h-full flex-col gap-1 overflow-y-auto bg-neutral-50 p-2"
        >
          {/* Só aparece quando a conversa encheu o primeiro lote: conversa
              curta não precisa de botão nenhum. */}
          {temAnteriores && listaMensagens.length >= 200 ? (
            <button
              type="button"
              disabled={buscandoAnteriores}
              onClick={() => void carregarAnteriores()}
              className="mb-1 inline-flex h-[40px] self-center items-center rounded-md border border-neutral-300 bg-neutral-0 px-1.5 text-sm font-medium text-neutral-800 transition-colors duration-[120ms] hover:bg-neutral-100 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-primary-500 disabled:opacity-60"
            >
              {buscandoAnteriores
                ? "Carregando…"
                : "Carregar mensagens anteriores"}
            </button>
          ) : null}

          {listaMensagens.length === 0 ? (
            <p className="text-sm text-neutral-600">
              Nenhuma mensagem no histórico ainda.
            </p>
          ) : (
            <Bolhas
              mensagens={listaMensagens}
              hojeChave={hojeChave}
              ontemChave={ontemChave}
            />
          
          )}
        </div>

        {novasAbaixo ? (
          <button
            type="button"
            onClick={irParaFim}
            className="absolute bottom-1 left-1/2 inline-flex h-[32px] -translate-x-1/2 items-center gap-0.5 rounded-md border border-neutral-300 bg-neutral-0 px-1.5 text-sm font-medium text-neutral-800 shadow-md transition-colors duration-[120ms] hover:bg-neutral-100 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-primary-500"
          >
            <ArrowDown size={14} strokeWidth={1.5} aria-hidden />
            Novas mensagens
          </button>
        ) : null}
      </div>

      {temConversa ? (
        <form
          ref={formRef}
          action={aoEnviar}
          className={cn(
            "relative flex flex-col gap-1 border-t border-neutral-200 p-1.5",
            modo === "nota" ? "bg-accent-100/40" : "bg-neutral-0",
          )}
        >
          <input type="hidden" name="lead_id" value={leadId} />
          <input type="hidden" name="modo" value={modo} />
          <input type="hidden" name="assinar" value={assinar ? "1" : "0"} />

          <div className="flex items-center gap-1">
            <div
              role="tablist"
              aria-label="Modo do compositor"
              className="flex gap-0.5"
            >
              {(
                [
                  { chave: "responder", rotulo: "Responder" },
                  { chave: "nota", rotulo: "Nota privada" },
                ] as const
              ).map((aba) => (
                <button
                  key={aba.chave}
                  type="button"
                  role="tab"
                  aria-selected={modo === aba.chave}
                  onClick={() => setModo(aba.chave)}
                  className={cn(
                    "inline-flex h-[32px] items-center rounded-md px-1.5 text-sm transition-colors duration-[120ms] focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-primary-500",
                    modo === aba.chave
                      ? aba.chave === "nota"
                        ? "bg-accent-100 font-medium text-accent-700"
                        : "bg-primary-50 font-medium text-primary-900"
                      : "text-neutral-600 hover:bg-neutral-100 hover:text-neutral-800",
                  )}
                >
                  {aba.rotulo}
                </button>
              ))}
            </div>

            <label className="ml-auto flex cursor-pointer items-center gap-0.5 text-xs text-neutral-600">
              <input
                type="checkbox"
                checked={assinar}
                onChange={(e) => assinaturaStore.gravar(e.target.checked)}
                className="h-[16px] w-[16px] accent-primary-600"
              />
              Assinar com meu nome
            </label>
          </div>

          {modo === "responder" && marketingBloqueado ? (
            <p className="inline-flex items-center gap-1 self-start rounded-full bg-danger-bg px-1 py-0.5 text-xs font-medium text-danger">
              <span
                aria-hidden
                className="h-[8px] w-[8px] shrink-0 rounded-full bg-danger"
              />
              Cliente bloqueou marketing no WhatsApp — use template de
              utilidade ou responda na janela de 24h.
            </p>
          ) : null}

          {modo === "responder" && restanteJanela !== null ? (
            <BannerJanela restanteInicialMs={restanteJanela} />
          ) : null}

          {modo === "responder" && restanteJanela === null ? (
            <p className="inline-flex items-center gap-1 self-start rounded-full bg-warning-bg px-1 py-0.5 text-xs font-medium text-warning">
              <span
                aria-hidden
                className="h-[8px] w-[8px] shrink-0 rounded-full bg-warning"
              />
              Lead nunca respondeu — a janela de 24h não abriu; só template
              chega.
            </p>
          ) : null}

          {painelAberto ? (
            <div
              data-popover="prontas"
              className="absolute bottom-[calc(100%+4px)] left-1.5 z-30 w-[320px] rounded-lg border border-neutral-200 bg-neutral-0 shadow-lg"
            >
              {prontasAbertas ? (
                <div className="border-b border-neutral-200 p-1">
                  <label htmlFor="busca-prontas" className="sr-only">
                    Buscar mensagem pronta
                  </label>
                  <input
                    id="busca-prontas"
                    autoFocus
                    value={busca}
                    onChange={(e) => {
                      setBusca(e.target.value);
                      setIdxSel(0);
                    }}
                    onKeyDown={(e) => {
                      if (e.key === "Escape") {
                        e.preventDefault();
                        fecharPainel();
                      }
                      if (e.key === "ArrowDown") {
                        e.preventDefault();
                        setIdxSel((i) =>
                          Math.min(i + 1, prontasFiltradas.length - 1),
                        );
                      }
                      if (e.key === "ArrowUp") {
                        e.preventDefault();
                        setIdxSel((i) => Math.max(i - 1, 0));
                      }
                      if (e.key === "Enter") {
                        e.preventDefault();
                        const pronta = prontasFiltradas[idxAtivo];
                        if (pronta) aplicarPronta(pronta);
                      }
                    }}
                    placeholder="Buscar…"
                    className="h-[32px] w-full rounded-md border border-neutral-300 bg-neutral-0 px-1 text-sm text-neutral-800 placeholder:text-neutral-400 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-primary-500"
                  />
                </div>
              ) : null}

              {mensagensPadrao.length === 0 ? (
                <p className="p-1.5 text-sm text-neutral-600">
                  Nenhuma mensagem pronta cadastrada. Cadastre em{" "}
                  <Link
                    href="/configuracoes"
                    className="text-primary-500 underline underline-offset-2"
                  >
                    Configurações
                  </Link>{" "}
                  (administração e gestão).
                </p>
              ) : prontasFiltradas.length === 0 ? (
                <p className="p-1.5 text-sm text-neutral-600">
                  Nada encontrado para &ldquo;{filtro}&rdquo;.
                </p>
              ) : (
                <ul
                  role="listbox"
                  aria-label="Mensagens prontas"
                  className="max-h-[240px] overflow-y-auto py-0.5"
                >
                  {prontasFiltradas.map((pronta, i) => (
                    <li
                      key={pronta.id}
                      role="option"
                      aria-selected={i === idxAtivo}
                    >
                      <button
                        type="button"
                        onClick={() => aplicarPronta(pronta)}
                        onMouseEnter={() => setIdxSel(i)}
                        className={cn(
                          "block w-full px-1.5 py-1 text-left focus-visible:outline-2 focus-visible:-outline-offset-2 focus-visible:outline-primary-500",
                          i === idxAtivo
                            ? "bg-primary-50"
                            : "hover:bg-neutral-50",
                        )}
                      >
                        <span className="flex items-center gap-0.5 text-sm font-medium text-neutral-800">
                          <span className="truncate">{pronta.titulo}</span>
                          {(pronta.anexos?.length ?? 0) > 0 ? (
                            <span className="inline-flex h-[18px] shrink-0 items-center gap-0.5 rounded-sm bg-neutral-100 px-0.5 font-mono text-xs font-normal text-neutral-600 tabular-nums">
                              <Paperclip size={11} strokeWidth={1.5} aria-hidden />
                              {pronta.anexos!.length}
                            </span>
                          ) : null}
                        </span>
                        <span className="block truncate text-xs text-neutral-600">
                          {pronta.corpo}
                        </span>
                      </button>
                    </li>
                  ))}
                </ul>
              )}
            </div>
          ) : null}

          {arquivos.length > 0 && modo === "responder" ? (
            <div className="flex flex-wrap gap-0.5">
              {arquivos.map((arquivo, i) => (
                <span
                  key={`${arquivo.name}-${i}`}
                  className="inline-flex h-[24px] max-w-full items-center gap-0.5 rounded-sm bg-neutral-100 px-1 text-xs text-neutral-800"
                >
                  <Paperclip
                    size={12}
                    strokeWidth={1.5}
                    aria-hidden
                    className="shrink-0 text-neutral-400"
                  />
                  <span className="truncate">{arquivo.name}</span>
                  <span className="shrink-0 font-mono text-neutral-400">
                    {formatarTamanho(arquivo.size)}
                  </span>
                  <button
                    type="button"
                    aria-label={`Remover anexo ${arquivo.name}`}
                    onClick={() => removerArquivo(i)}
                    className="inline-flex h-[28px] w-[28px] shrink-0 items-center justify-center rounded-sm text-neutral-400 transition-colors duration-[120ms] -m-[6px] hover:bg-neutral-200 hover:text-neutral-800 focus-visible:outline-2 focus-visible:outline-primary-500"
                  >
                    <X size={12} strokeWidth={1.5} aria-hidden />
                  </button>
                </span>
              ))}
            </div>
          ) : null}

          {sugestaoFantasma ? (
            // role=status: o balão aparece SOZINHO e muda o que o Tab faz —
            // quem usa leitor de tela precisa ser avisado disso.
            <div
              role="status"
              aria-live="polite"
              className="mb-1 flex items-start gap-1 rounded-md border border-dashed border-primary-300 bg-primary-50 px-1.5 py-1"
            >
              <p className="min-w-0 flex-1 text-sm text-primary-900">
                <span className="sr-only">Sugestão da IA, Tab aceita: </span>
                {sugestaoFantasma}
              </p>
              <span
                aria-hidden
                className="shrink-0 font-mono text-xs text-primary-600"
              >
                Tab aceita
              </span>
              <button
                type="button"
                aria-label="Dispensar sugestão"
                onClick={() => sugestaoStore.limpar(leadId)}
                className="-my-1 -mr-1 inline-flex h-[40px] w-[40px] shrink-0 items-center justify-center rounded-md text-primary-600 hover:bg-primary-100 hover:text-primary-900 focus-visible:outline-2 focus-visible:-outline-offset-2 focus-visible:outline-primary-500"
              >
                <X size={14} strokeWidth={2} aria-hidden />
              </button>
            </div>
          ) : null}
          <label htmlFor="texto-mensagem" className="sr-only">
            Mensagem para o lead
          </label>
          <textarea
            id="texto-mensagem"
            name="texto"
            rows={3}
            // O corretor nativo depende do navegador saber o idioma do campo —
            // sem isso, vendedor com dicionário em inglês não via sublinhado.
            lang="pt-BR"
            spellCheck
            autoCorrect="on"
            autoCapitalize="sentences"
            ref={textareaRef}
            value={texto}
            onChange={(e) => atualizarTexto(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Tab" && sugestaoFantasma && !e.shiftKey) {
                // Tab aceita a sugestão; digitar qualquer coisa a ignora.
                // Para SAIR do campo com o balão na tela: Esc dispensa (logo
                // abaixo) ou Shift+Tab, que segue navegando normalmente.
                e.preventDefault();
                atualizarTexto(sugestaoFantasma);
                sugestaoStore.limpar(leadId);
                return;
              }
              if (e.key === "Escape" && sugestaoFantasma && !painelAberto) {
                e.preventDefault();
                e.stopPropagation();
                sugestaoStore.limpar(leadId);
                return;
              }
              if (painelAberto) {
                if (e.key === "ArrowDown") {
                  e.preventDefault();
                  setIdxSel((i) =>
                    Math.min(i + 1, prontasFiltradas.length - 1),
                  );
                  return;
                }
                if (e.key === "ArrowUp") {
                  e.preventDefault();
                  setIdxSel((i) => Math.max(i - 1, 0));
                  return;
                }
                if (e.key === "Enter" && !e.shiftKey) {
                  // Painel aberto: Enter nunca envia — sem resultado, só
                  // engole (antes mandava o "/busca" cru para o cliente).
                  e.preventDefault();
                  if (prontasFiltradas.length > 0) {
                    aplicarPronta(prontasFiltradas[idxAtivo]);
                  }
                  return;
                }
              }
              if (e.key === "Escape" && painelAberto) {
                e.preventDefault();
                fecharPainel();
                return;
              }
              if (e.key === "Escape" && iaAberta) {
                e.preventDefault();
                // Consome: senão o Esc seguia e fechava o painel inteiro da
                // /hoje por baixo do menu.
                e.stopPropagation();
                setIaAberta(false);
                return;
              }
              // No teclado do iPhone não existe Shift+Enter: lá o return
              // quebra linha e o envio é só pelo botão. Envio pendente
              // segura o Enter — segurar a tecla duplicava a mensagem.
              if (e.key === "Enter" && !e.shiftKey && !ehToque && !enviandoAcao) {
                e.preventDefault();
                if (podeEnviar) formRef.current?.requestSubmit();
              }
            }}
            placeholder={
              modo === "nota"
                ? ehToque
                  ? "Nota interna — o lead não vê…"
                  : "Nota interna — o lead não vê… (Enter salva)"
                : ehToque
                  ? 'Escreva a mensagem… ("/" para prontas)'
                  : 'Escreva a mensagem… ("/" para prontas, Enter envia)'
            }
            className={cn(
              "field-sizing-content max-h-[240px] min-h-[88px] w-full resize-y rounded-lg border px-1.5 py-1 text-sm text-neutral-800 placeholder:text-neutral-400 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-primary-500",
              modo === "nota"
                ? "border-accent-300 bg-accent-100/60"
                : "border-neutral-300 bg-neutral-0",
            )}
          />

          <div className="flex flex-wrap items-center gap-1">
            <button
              type="button"
              aria-label='Mensagens prontas (atalho "/")'
              aria-expanded={painelAberto}
              title='Mensagens prontas — atalho "/"'
              onClick={() => {
                setIaAberta(false);
                if (painelAberto) fecharPainel();
                else {
                  setProntasAbertas(true);
                  setIdxSel(0);
                }
              }}
              className={BOTAO_FERRAMENTA}
            >
              <Zap size={16} strokeWidth={1.5} aria-hidden />
            </button>

            {/* IA num botão só: o menu escolhe entre sugerir e corrigir —
                dois botões de faísca lado a lado confundiam a equipe. */}
            <span
              className="relative"
              onKeyDown={(e) => {
                if (e.key === "Escape" && iaAberta) {
                  e.preventDefault();
                  e.stopPropagation();
                  setIaAberta(false);
                  textareaRef.current?.focus();
                }
              }}
              onBlur={(e) => {
                // Tab para fora fecha o menu: aberto e sem foco dentro, ele
                // ficava pendurado na tela sem tecla que o alcançasse.
                if (iaAberta && !e.currentTarget.contains(e.relatedTarget)) {
                  setIaAberta(false);
                }
              }}
            >
              <button
                type="button"
                aria-label="Assistente de IA"
                aria-expanded={iaAberta}
                title="IA — sugerir resposta ou corrigir ortografia (nada sai sem você revisar)"
                disabled={iaOcupada !== null}
                onClick={() => {
                  // fecharPainel também some com o painel aberto pela "/".
                  if (painelAberto) fecharPainel();
                  setIaAberta((v) => !v);
                }}
                className={cn(
                  BOTAO_FERRAMENTA,
                  "disabled:cursor-not-allowed disabled:text-neutral-300 disabled:hover:bg-neutral-0",
                )}
              >
                {iaOcupada !== null ? (
                  <LoaderCircle
                    size={16}
                    strokeWidth={1.5}
                    aria-hidden
                    className="animate-spin"
                  />
                ) : (
                  <Sparkles size={16} strokeWidth={1.5} aria-hidden />
                )}
              </button>

              {iaAberta ? (
                <>
                  <button
                    type="button"
                    aria-label="Fechar menu de IA"
                    tabIndex={-1}
                    onClick={() => {
                      setIaAberta(false);
                      // O foco volta para a caixa — solto no body, a próxima
                      // letra digitada viraria atalho do palco (E resolve!).
                      textareaRef.current?.focus();
                    }}
                    className="fixed inset-0 z-20 cursor-default"
                  />
                  <div
                    role="menu"
                    data-popover="ia"
                    aria-label="Assistente de IA"
                    className="absolute bottom-[calc(100%+4px)] left-0 z-30 w-[288px] rounded-lg border border-neutral-200 bg-neutral-0 p-0.5 shadow-lg"
                  >
                    <button
                      type="button"
                      role="menuitem"
                      // Sem isto o mousedown tira o foco do gatilho, o onBlur
                      // fecha o menu e o clique morre antes do onClick
                      // (Safari e Firefox no macOS).
                      onMouseDown={(e) => e.preventDefault()}
                      disabled={modo === "nota" || janelaFechada}
                      onClick={() => {
                        setIaAberta(false);
                        textareaRef.current?.focus();
                        pedirSugestao();
                      }}
                      className="group flex w-full items-start gap-1 rounded-md px-1 py-1 text-left transition-colors duration-[120ms] hover:bg-neutral-50 focus-visible:outline-2 focus-visible:-outline-offset-2 focus-visible:outline-primary-500 disabled:cursor-not-allowed disabled:hover:bg-neutral-0"
                    >
                      <Sparkles
                        size={16}
                        strokeWidth={1.5}
                        aria-hidden
                        className="mt-[2px] shrink-0 text-neutral-600 group-disabled:text-neutral-400"
                      />
                      <span className="min-w-0">
                        {/* Desativado apaga o TÍTULO, não a frase que explica
                            o porquê — era ela que sumia com o opacity. */}
                        <span className="block text-sm font-medium text-neutral-800 group-disabled:text-neutral-400">
                          Sugerir resposta
                        </span>
                        <span className="block text-xs text-neutral-600">
                          {modo === "nota"
                            ? "Só em resposta ao lead."
                            : janelaFechada
                              ? "Janela de 24h fechada — use um template."
                              : "Lê a conversa e escreve um rascunho para você revisar."}
                        </span>
                      </span>
                    </button>
                    <button
                      type="button"
                      role="menuitem"
                      // Sem isto o mousedown tira o foco do gatilho, o onBlur
                      // fecha o menu e o clique morre antes do onClick
                      // (Safari e Firefox no macOS).
                      onMouseDown={(e) => e.preventDefault()}
                      disabled={texto.trim().length === 0}
                      onClick={() => {
                        setIaAberta(false);
                        textareaRef.current?.focus();
                        pedirCorrecao();
                      }}
                      className="group flex w-full items-start gap-1 rounded-md px-1 py-1 text-left transition-colors duration-[120ms] hover:bg-neutral-50 focus-visible:outline-2 focus-visible:-outline-offset-2 focus-visible:outline-primary-500 disabled:cursor-not-allowed disabled:hover:bg-neutral-0"
                    >
                      <SpellCheck
                        size={16}
                        strokeWidth={1.5}
                        aria-hidden
                        className="mt-[2px] shrink-0 text-neutral-600 group-disabled:text-neutral-400"
                      />
                      <span className="min-w-0">
                        {/* Desativado apaga o TÍTULO, não a frase que explica
                            o porquê — era ela que sumia com o opacity. */}
                        <span className="block text-sm font-medium text-neutral-800 group-disabled:text-neutral-400">
                          Corrigir ortografia
                        </span>
                        <span className="block text-xs text-neutral-600">
                          {texto.trim().length === 0
                            ? "Escreva algo primeiro."
                            : "Arruma acentos e erros sem mudar o que você escreveu."}
                        </span>
                      </span>
                    </button>
                  </div>
                </>
              ) : null}
            </span>

            <GravadorAudio
              desabilitado={modo === "nota" || janelaFechada}
              onGravado={anexarGravacao}
              onErro={setAvisoArquivo}
            />

            <button
              type="button"
              aria-label="Anexar arquivos"
              title={
                modo === "nota"
                  ? "Anexo só em resposta ao lead"
                  : janelaFechada
                    ? "Janela de 24h fechada — anexo não chega; use um template"
                    : "Anexar arquivos (máx. 5, até 16MB cada — imagem até 5MB)"
              }
              disabled={modo === "nota" || janelaFechada}
              onClick={() => inputArquivosRef.current?.click()}
              className={cn(
                BOTAO_FERRAMENTA,
                "disabled:cursor-not-allowed disabled:text-neutral-300 disabled:hover:bg-neutral-0",
              )}
            >
              <Paperclip size={16} strokeWidth={1.5} aria-hidden />
            </button>
            {/* Sem accept: o seletor aceita qualquer arquivo. O servidor
                decide o caminho — o WhatsApp entrega imagem/áudio/vídeo/pdf/
                office/texto como arquivo, e o resto (indicador .psf, .zip…)
                vai como link de download. */}
            <input
              ref={inputArquivosRef}
              type="file"
              name="arquivos"
              multiple
              className="hidden"
              onChange={(e) => adicionarArquivos(e.target.files)}
            />

            <span className="ml-auto flex items-center gap-1">
              {/* Janela fechada: só template chega — ele assume o lugar do
                  Enviar como a ação principal, em vez de deixar um Enviar
                  morto ao lado. Sem template cadastrado (Meta fora/sem
                  config), o Enviar desabilitado volta a ancorar a região. */}
              {janelaFechada ? (
                templates.length > 0 ? (
                  <BotaoTemplates
                    leadId={leadId}
                    templates={templates}
                    principal
                    aoEnviar={aoEnviarTemplate}
                  />
                ) : (
                  <BotaoEnviar desabilitado nota={false} />
                )
              ) : (
                <>
                  {modo === "responder" ? (
                    <BotaoTemplates
                      leadId={leadId}
                      templates={templates}
                      aoEnviar={aoEnviarTemplate}
                    />
                  ) : null}
                  <BotaoEnviar
                    desabilitado={!podeEnviar}
                    nota={modo === "nota"}
                  />
                </>
              )}
            </span>
          </div>

          {erroCompositor ? (
            <p role="alert" className="text-sm text-danger">
              {erroCompositor}
            </p>
          ) : null}
        </form>
      ) : (
        <div className="flex flex-wrap items-center justify-between gap-1 border-t border-neutral-200 bg-neutral-50 px-2 py-1.5">
          <p className="text-sm text-neutral-600">
            Sem canal de envio para este lead (falta telefone ou conversa) —
            o primeiro contato da empresa precisa ser um template aprovado.
          </p>
          <BotaoTemplates
            leadId={leadId}
            templates={templates}
            aoEnviar={aoEnviarTemplate}
          />
        </div>
      )}
    </div>
  );
}
