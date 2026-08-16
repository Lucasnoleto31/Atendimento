"use client";

import {
  Fragment,
  useActionState,
  useEffect,
  useOptimistic,
  useRef,
  useState,
  useSyncExternalStore,
} from "react";
import { useFormStatus } from "react-dom";
import { useRouter } from "next/navigation";
import Link from "next/link";
import {
  ArrowDown,
  Check,
  CheckCheck,
  Paperclip,
  Send,
  Smile,
  TriangleAlert,
  X,
  Zap,
} from "lucide-react";
import { cn } from "@/lib/utils";
import type { TemplateWhatsapp } from "@/lib/chatwoot";
import { BotaoTemplates } from "./templates";
import { enviarMensagemLead, type ResultadoEnvio } from "./actions";

const ESTADO: ResultadoEnvio = {};
const INTERVALO_ATUALIZACAO = 5_000;
const MAX_ANEXOS = 5;
const MAX_TAMANHO_ANEXO = 16 * 1024 * 1024; // teto do WhatsApp para mídia
const LIMIAR_FIM_PX = 80;

const EMOJIS = [
  "😀", "😂", "😉", "😊", "😍", "🤔", "😅", "😎", "🥳", "😢",
  "😮", "🙄", "👍", "👎", "🙏", "👏", "🤝", "💪", "🙌", "🤙",
  "🎉", "🔥", "❤️", "💚", "⭐", "✅", "❌", "⚠️", "⏰", "📄",
  "📎", "💰", "📈", "📉", "🚀", "☕",
];

// Mesmo fuso usado no servidor para as chaves de dia dos separadores.
const FORMATO_DIA = new Intl.DateTimeFormat("pt-BR", {
  timeZone: "America/Sao_Paulo",
});

export type Anexo = { tipo: string; url: string };

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
};

export type MensagemPadrao = { id: string; titulo: string; corpo: string };

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

function AnexoMensagem({ anexo }: { anexo: Anexo }) {
  if (anexo.tipo === "image") {
    return (
      <a href={anexo.url} target="_blank" rel="noreferrer">
        {/* eslint-disable-next-line @next/next/no-img-element -- URL externa do Chatwoot, sem otimização do Next */}
        <img
          src={anexo.url}
          alt="Imagem recebida na conversa"
          loading="lazy"
          className="max-h-[240px] w-auto max-w-full rounded-md border border-neutral-200"
        />
      </a>
    );
  }
  if (anexo.tipo === "audio") {
    return <audio controls src={anexo.url} className="max-w-full" />;
  }
  if (anexo.tipo === "video") {
    return (
      <video
        controls
        src={anexo.url}
        className="max-h-[240px] w-auto max-w-full rounded-md"
      />
    );
  }
  return (
    <a
      href={anexo.url}
      target="_blank"
      rel="noreferrer"
      className="text-sm text-primary-500 underline underline-offset-2"
    >
      Abrir anexo
    </a>
  );
}

/** Recibo do WhatsApp: ✓ enviada, ✓✓ entregue, ✓✓ azul lida, alerta falhou. */
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
        className="inline-flex items-center gap-0.5 text-danger"
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
        className="inline text-info"
      />
    );
  }
  if (status === "delivered") {
    return (
      <CheckCheck
        size={14}
        strokeWidth={1.5}
        aria-label="Entregue"
        className="inline text-neutral-400"
      />
    );
  }
  if (status === "sent") {
    return (
      <Check
        size={14}
        strokeWidth={1.5}
        aria-label="Enviada"
        className="inline text-neutral-400"
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
  return (
    <button
      type="submit"
      disabled={pending || desabilitado}
      aria-label={nota ? "Salvar nota privada" : "Enviar mensagem"}
      className={cn(
        "inline-flex h-[40px] shrink-0 items-center gap-0.5 rounded-md px-2 text-sm font-medium text-neutral-0 transition-colors duration-[120ms] focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-primary-500 disabled:cursor-not-allowed disabled:opacity-60",
        nota
          ? "bg-accent-700 hover:bg-accent-700/90"
          : "bg-primary-600 hover:bg-primary-700",
      )}
    >
      <Send size={16} strokeWidth={1.5} aria-hidden />
      {pending ? "…" : nota ? "Salvar nota" : "Enviar"}
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
    return (
      <p className="rounded-md bg-warning-bg px-1.5 py-0.5 text-xs font-medium text-warning">
        Janela de 24h fechada — mensagem livre não chega ao lead. Use um
        template.
      </p>
    );
  }

  const horas = Math.floor(restanteMs / 3_600_000);
  const minutos = Math.floor((restanteMs % 3_600_000) / 60_000);
  return (
    <p className="px-0.5 text-xs text-neutral-600">
      Janela do WhatsApp aberta — fecha em{" "}
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
  urlMaisAntigas,
  hojeChave,
  ontemChave,
}: {
  leadId: string;
  temConversa: boolean;
  mensagens: Mensagem[];
  mensagensPadrao: MensagemPadrao[];
  templates: TemplateWhatsapp[];
  restanteJanela: number | null;
  urlMaisAntigas: string | null;
  hojeChave: string;
  ontemChave: string;
}) {
  const [estado, formAction] = useActionState(enviarMensagemLead, ESTADO);
  const [texto, setTexto] = useState("");
  const [modo, setModo] = useState<"responder" | "nota">("responder");
  const assinar = useSyncExternalStore(
    assinaturaStore.subscribe,
    assinaturaStore.ler,
    assinaturaStore.lerNoServidor,
  );

  const caixaRef = useRef<HTMLDivElement>(null);
  const formRef = useRef<HTMLFormElement>(null);
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const router = useRouter();

  // Envio otimista: a mensagem aparece na hora, em cinza, enquanto viaja.
  const [listaMensagens, adicionarOtimista] = useOptimistic<
    Mensagem[],
    Mensagem
  >(mensagens, (lista, nova) => [...lista, nova]);
  const contadorOtimistaRef = useRef(0);

  // Mensagens prontas: painel abre pelo botão de raio ou digitando "/".
  const [prontasAbertas, setProntasAbertas] = useState(false);
  const [busca, setBusca] = useState("");
  const [idxSel, setIdxSel] = useState(0);
  const [barraSuprimida, setBarraSuprimida] = useState(false);

  const [emojiAberto, setEmojiAberto] = useState(false);

  // Anexos: o estado espelha o input de arquivo (via DataTransfer), então o
  // form envia exatamente o que os chips mostram.
  const [arquivos, setArquivos] = useState<File[]>([]);
  const [avisoArquivo, setAvisoArquivo] = useState<string | null>(null);
  const inputArquivosRef = useRef<HTMLInputElement>(null);

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

  // Mensagens novas aparecem sozinhas (aba visível).
  useEffect(() => {
    const intervalo = setInterval(() => {
      if (document.visibilityState === "visible") router.refresh();
    }, INTERVALO_ATUALIZACAO);
    return () => clearInterval(intervalo);
  }, [router]);

  // Limpa campo e anexos após envio (ajuste durante o render).
  const [estadoAnterior, setEstadoAnterior] = useState(estado);
  if (estado !== estadoAnterior) {
    setEstadoAnterior(estado);
    if (estado.ok) {
      setTexto("");
      setArquivos([]);
      setAvisoArquivo(null);
    }
  }

  // Input de arquivo e rascunho são externos ao React — limpa num efeito.
  useEffect(() => {
    if (estado.ok) {
      if (inputArquivosRef.current) inputArquivosRef.current.value = "";
      localStorage.removeItem(chaveRascunho);
    }
  }, [estado, chaveRascunho]);

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
  };

  const inserirEmoji = (emoji: string) => {
    const area = textareaRef.current;
    const posicao = area?.selectionStart ?? texto.length;
    atualizarTexto(texto.slice(0, posicao) + emoji + texto.slice(posicao));
    setEmojiAberto(false);
    area?.focus();
  };

  const sincronizarInput = (lista: File[]) => {
    const input = inputArquivosRef.current;
    if (!input) return;
    const dt = new DataTransfer();
    lista.forEach((arquivo) => dt.items.add(arquivo));
    input.files = dt.files;
  };

  const adicionarArquivos = (novos: FileList | null) => {
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
      aceitos.push(arquivo);
    }

    if (arquivos.length + aceitos.length > MAX_ANEXOS) {
      setAvisoArquivo(`No máximo ${MAX_ANEXOS} anexos por mensagem.`);
    }
    const combinado = [...arquivos, ...aceitos].slice(0, MAX_ANEXOS);
    setArquivos(combinado);
    sincronizarInput(combinado);
  };

  const removerArquivo = (indice: number) => {
    const restantes = arquivos.filter((_, i) => i !== indice);
    setArquivos(restantes);
    sincronizarInput(restantes);
  };

  const podeEnviar =
    modo === "nota"
      ? texto.trim().length > 0
      : texto.trim().length > 0 || arquivos.length > 0;

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

  const aoEnviar = (formData: FormData) => {
    const textoEnvio = String(formData.get("texto") ?? "").trim();
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
    formAction(formData);
  };

  const horario = (iso: string) =>
    new Date(iso).toLocaleString("pt-BR", {
      day: "2-digit",
      month: "2-digit",
      hour: "2-digit",
      minute: "2-digit",
    });

  const rotuloDia = (iso: string) => {
    const chave = FORMATO_DIA.format(new Date(iso));
    return chave === hojeChave ? "Hoje" : chave === ontemChave ? "Ontem" : chave;
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
          {urlMaisAntigas ? (
            <Link
              href={urlMaisAntigas}
              className="self-center rounded-md border border-neutral-300 bg-neutral-0 px-1.5 py-0.5 text-xs font-medium text-neutral-600 transition-colors duration-[120ms] hover:bg-neutral-100 hover:text-neutral-800 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-primary-500"
            >
              Carregar mensagens anteriores
            </Link>
          ) : null}

          {listaMensagens.length === 0 ? (
            <p className="text-sm text-neutral-600">
              Nenhuma mensagem no histórico ainda.
            </p>
          ) : (
            listaMensagens.map((mensagem, i) => {
              const enviada = mensagem.tipo === "mensagem_enviada";
              const nota = mensagem.tipo === "nota";
              const anexos = mensagem.anexos ?? [];
              // O placeholder "[imagem]" só faz sentido quando o anexo não é exibido.
              const soPlaceholder =
                anexos.length > 0 && /^\[.+\]$/.test(mensagem.conteudo ?? "");
              const dia = rotuloDia(mensagem.criado_em);
              const mostraDia =
                i === 0 || rotuloDia(listaMensagens[i - 1].criado_em) !== dia;
              return (
                <Fragment key={mensagem.id}>
                  {mostraDia ? (
                    <span className="self-center rounded-sm bg-neutral-100 px-1 py-0.5 text-xs font-medium text-neutral-600">
                      {dia}
                    </span>
                  ) : null}
                  <div
                    className={cn(
                      "max-w-[75%] rounded-md px-1.5 py-1 shadow-sm",
                      nota
                        ? "self-end border border-accent-300 bg-accent-100"
                        : enviada
                          ? "self-end border border-primary-100 bg-primary-50"
                          : "self-start border border-neutral-200 bg-neutral-0",
                      mensagem.pendente ? "opacity-70" : "",
                    )}
                  >
                    {nota ? (
                      <p className="text-xs font-medium tracking-[0.06em] text-accent-700 uppercase">
                        Nota privada
                      </p>
                    ) : null}
                    {anexos.length > 0 ? (
                      <div className="mb-0.5 flex flex-col gap-0.5">
                        {anexos.map((anexo, j) => (
                          <AnexoMensagem key={j} anexo={anexo} />
                        ))}
                      </div>
                    ) : null}
                    {!soPlaceholder ? (
                      <p className="text-sm break-words whitespace-pre-wrap text-neutral-800">
                        {mensagem.conteudo}
                      </p>
                    ) : null}
                    <p className="mt-0.5 flex items-center justify-end gap-0.5 text-right font-mono text-xs text-neutral-400 tabular-nums">
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
            })
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

          {modo === "responder" && restanteJanela !== null ? (
            <BannerJanela restanteInicialMs={restanteJanela} />
          ) : null}

          {painelAberto ? (
            <div className="absolute bottom-[calc(100%+4px)] left-1.5 z-30 w-[320px] rounded-[10px] border border-neutral-200 bg-neutral-0 shadow-lg">
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
                        <span className="block text-sm font-medium text-neutral-800">
                          {pronta.titulo}
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

          {emojiAberto ? (
            <>
              <button
                type="button"
                aria-label="Fechar emojis"
                tabIndex={-1}
                onClick={() => setEmojiAberto(false)}
                className="fixed inset-0 z-20 cursor-default"
              />
              <div
                role="group"
                aria-label="Escolher emoji"
                className="absolute bottom-[calc(100%+4px)] left-1.5 z-30 grid w-[288px] grid-cols-9 gap-0.5 rounded-[10px] border border-neutral-200 bg-neutral-0 p-1 shadow-lg"
              >
                {EMOJIS.map((emoji) => (
                  <button
                    key={emoji}
                    type="button"
                    onClick={() => inserirEmoji(emoji)}
                    className="inline-flex h-[28px] w-[28px] items-center justify-center rounded-sm text-base hover:bg-neutral-100 focus-visible:outline-2 focus-visible:outline-primary-500"
                  >
                    {emoji}
                  </button>
                ))}
              </div>
            </>
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
                    className="inline-flex h-[16px] w-[16px] shrink-0 items-center justify-center rounded-sm text-neutral-400 transition-colors duration-[120ms] hover:bg-neutral-200 hover:text-neutral-800 focus-visible:outline-2 focus-visible:outline-primary-500"
                  >
                    <X size={12} strokeWidth={1.5} aria-hidden />
                  </button>
                </span>
              ))}
            </div>
          ) : null}

          <div className="flex items-end gap-1">
            <button
              type="button"
              aria-label='Mensagens prontas (atalho "/")'
              aria-expanded={painelAberto}
              title='Mensagens prontas — atalho "/"'
              onClick={() => {
                setEmojiAberto(false);
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

            <button
              type="button"
              aria-label="Inserir emoji"
              aria-expanded={emojiAberto}
              title="Emoji"
              onClick={() => {
                setProntasAbertas(false);
                setEmojiAberto((v) => !v);
              }}
              className={BOTAO_FERRAMENTA}
            >
              <Smile size={16} strokeWidth={1.5} aria-hidden />
            </button>

            <button
              type="button"
              aria-label="Anexar arquivos"
              title={
                modo === "nota"
                  ? "Anexo só em resposta ao lead"
                  : "Anexar arquivos (máx. 5, até 16MB cada)"
              }
              disabled={modo === "nota"}
              onClick={() => inputArquivosRef.current?.click()}
              className={cn(
                BOTAO_FERRAMENTA,
                "disabled:cursor-not-allowed disabled:text-neutral-300 disabled:hover:bg-neutral-0",
              )}
            >
              <Paperclip size={16} strokeWidth={1.5} aria-hidden />
            </button>
            <input
              ref={inputArquivosRef}
              type="file"
              name="arquivos"
              multiple
              accept="image/*,audio/*,video/*,.pdf,.doc,.docx,.xls,.xlsx,.csv,.txt"
              className="hidden"
              onChange={(e) => adicionarArquivos(e.target.files)}
            />

            <label htmlFor="texto-mensagem" className="sr-only">
              Mensagem para o lead
            </label>
            <textarea
              id="texto-mensagem"
              name="texto"
              rows={2}
              ref={textareaRef}
              value={texto}
              onChange={(e) => atualizarTexto(e.target.value)}
              onKeyDown={(e) => {
                if (painelAberto && prontasFiltradas.length > 0) {
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
                    e.preventDefault();
                    aplicarPronta(prontasFiltradas[idxAtivo]);
                    return;
                  }
                }
                if (e.key === "Escape" && painelAberto) {
                  e.preventDefault();
                  fecharPainel();
                  return;
                }
                if (e.key === "Enter" && !e.shiftKey) {
                  e.preventDefault();
                  if (podeEnviar) formRef.current?.requestSubmit();
                }
              }}
              placeholder={
                modo === "nota"
                  ? "Nota interna — o lead não vê… (Enter salva)"
                  : 'Escreva a mensagem… ("/" para prontas, Enter envia)'
              }
              className={cn(
                "min-h-[56px] min-w-0 flex-1 rounded-md border px-1.5 py-1 text-sm text-neutral-800 placeholder:text-neutral-400 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-primary-500",
                modo === "nota"
                  ? "border-accent-300 bg-accent-100/60"
                  : "border-neutral-300 bg-neutral-0",
              )}
            />
            {modo === "responder" ? (
              <BotaoTemplates leadId={leadId} templates={templates} />
            ) : null}
            <BotaoEnviar desabilitado={!podeEnviar} nota={modo === "nota"} />
          </div>

          {avisoArquivo ? (
            <p role="alert" className="text-sm text-danger">
              {avisoArquivo}
            </p>
          ) : null}
          {estado.erro ? (
            <p role="alert" className="text-sm text-danger">
              {estado.erro}
            </p>
          ) : null}
        </form>
      ) : (
        <div className="flex flex-wrap items-center justify-between gap-1 border-t border-neutral-200 bg-neutral-50 px-2 py-1.5">
          <p className="text-sm text-neutral-600">
            Sem conversa no WhatsApp ainda — o primeiro contato da empresa
            precisa ser um template aprovado (regra do WhatsApp).
          </p>
          <BotaoTemplates leadId={leadId} templates={templates} />
        </div>
      )}
    </div>
  );
}
