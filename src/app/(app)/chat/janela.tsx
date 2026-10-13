"use client";

import dynamic from "next/dynamic";
import {
  memo,
  startTransition,
  useActionState,
  useCallback,
  useEffect,
  useLayoutEffect,
  useMemo,
  useOptimistic,
  useRef,
  useState,
  useSyncExternalStore,
} from "react";
import { useFormStatus } from "react-dom";
import Link from "next/link";
import {
  ArrowDown,
  Check,
  FileIcon,
  FileText,
  ImageIcon,
  MoreHorizontal,
  NotebookPen,
  Paperclip,
  PenLine,
  Search,
  Send,
  SpellCheck,
  X,
  Zap,
} from "lucide-react";
import { cn } from "@/lib/utils";
import type { TemplateWhatsapp } from "@/lib/whatsapp";
import { TETO_LEGENDA_WHATSAPP } from "@/lib/formato-anexo";
import { Button, classesDoBotao } from "@/components/ui/button";
import { Spinner } from "@/components/ui/spinner";
import { BOTAO_ICONE, CAMPO } from "@/components/app/form-styles";
import {
  Folha,
  Grupo,
  ItemAcao,
  ItemSecao,
  ItensSecao,
  LinhaGrupo,
  MenuSuspenso,
  useTelaMd,
  useToque,
} from "@/app/(app)/conversas/folha";
import { BotaoTemplates, DialogoTemplate } from "./templates";
import { GravadorAudio } from "./gravador-audio";
import { PreviaAnexos, ordemDoEnvio, type ItemAnexo } from "./previa-anexos";
import { createClient as criarClienteNavegador } from "@/lib/supabase/client";
import {
  enviarMensagemLead,
  prepararUploadAnexo,
  type EuNoChat,
  type InteracaoCriada,
  type ResultadoEnvio,
} from "./actions";
import { CamadaDaBolha } from "./gestos-bolha";
import {
  PaineisDaMensagem,
  citacaoChegaAoContato,
  lerEuNoChat,
  retratoDaMensagem,
  type AlvoMensagem,
  type AvisoDaLista,
} from "./menu-mensagem";
import { carregarMensagensAnteriores } from "./conversa";
import { corrigirTexto, sugerirResposta } from "./ia";
import {
  ehTipoMensagem,
  paraMensagem,
  type CanalConversa,
  type LinhaBrutaInteracao,
  type Mensagem,
  type MensagemPadrao,
  type RespostaCitada,
} from "./mensagem";
import { Bolhas, FORMATO_DIA, textoVisivel, type MarcaNaoLidas } from "./bolha";
import type { ItemVisualizador } from "./visualizador";
import { ouvirAtualizacoesDaConversa } from "./tempo-real";

// O visualizador de fotos só existe depois de um toque numa imagem: vai num
// pedaço de JS à parte, fora do carregamento do chat.
const Visualizador = dynamic(
  () => import("./visualizador").then((m) => m.Visualizador),
  { ssr: false },
);

const ESTADO: ResultadoEnvio = {};

/** Devolve o texto que não saiu ao rascunho da conversa, sem passar por
 *  cima de um rascunho que já esteja lá. */
function devolverAoRascunho(leadId: string, texto: string) {
  if (!leadId || !texto.trim()) return;
  try {
    const chave = `chat_rascunho_${leadId}`;
    if (!localStorage.getItem(chave)) localStorage.setItem(chave, texto);
  } catch {
    // armazenamento bloqueado: o texto volta só para a caixa na tela
  }
}

/**
 * O envio com a rede no meio. Action que estoura (a conexão caiu) vira erro
 * na tela em vez de derrubar a conversa, e o desfecho sempre chega: é ele
 * que solta a conversa presa pelo envio em voo. Erro sem nada entregue
 * devolve o texto ao rascunho, para quem saiu da tela antes da resposta (o
 * menu do app, outra página) o achar ao voltar.
 */
async function enviarComRede(
  anterior: ResultadoEnvio,
  dados: FormData,
): Promise<ResultadoEnvio> {
  let r: ResultadoEnvio;
  try {
    r = await enviarMensagemLead(anterior, dados);
  } catch {
    r = { erro: "A conexão não respondeu. Tente de novo." };
  }
  if (r.erro && !r.interacao) {
    devolverAoRascunho(
      String(dados.get("lead_id") ?? ""),
      String(dados.get("texto") ?? ""),
    );
  }
  return r;
}

const MAX_ANEXOS = 5;
const MAX_TAMANHO_ANEXO = 16 * 1024 * 1024; // teto do WhatsApp para mídia
const LIMIAR_FIM_PX = 80;
/** A seta para o fim aparece quando a pessoa sobe mais que isso. */
const LIMIAR_SETA_PX = 240;
/** Quanto tempo a citada fica marcada depois do salto. */
const DESTAQUE_MS = 1600;
/** Lotes do histórico antigo que o salto até a citada busca, no máximo. */
const RODADAS_CITADA = 5;
/** Quanto a rolagem suave do salto até a citada leva, com folga. */
const SALTO_MS = 1000;
/** Quanto tempo o "Resolver e seguir" fica oferecido depois do envio. */
const OFERTA_RESOLVER_MS = 8000;

const DIA_MS = 86_400_000;
const FORMATO_RELOGIO_BRASILIA = new Intl.DateTimeFormat("pt-BR", {
  timeZone: "America/Sao_Paulo",
  hour: "2-digit",
  minute: "2-digit",
  second: "2-digit",
  hourCycle: "h23",
});

/** Quanto falta para a próxima meia-noite de Brasília. */
function msAteMeiaNoiteBrasilia(agoraMs: number): number {
  const partes = FORMATO_RELOGIO_BRASILIA.formatToParts(agoraMs);
  const parte = (tipo: Intl.DateTimeFormatPartTypes) =>
    Number(partes.find((p) => p.type === tipo)?.value ?? 0);
  const decorrido =
    parte("hour") * 3_600_000 +
    parte("minute") * 60_000 +
    parte("second") * 1000 +
    (agoraMs % 1000);
  return Math.max(DIA_MS - decorrido, 0);
}

/** A mensagem otimista e o retrato da conversa no clique de enviar: o eco
 *  do tempo real é a mensagem_enviada que não estava no retrato. */
type EnvioOtimista = {
  mensagem: Mensagem;
  idsAntes: ReadonlySet<string>;
  texto: string;
  primeiroAnexo: string | null;
};

/** A linha gravada pelo servidor corresponde a este envio? O texto pode
 *  vir com a assinatura na frente; só anexo grava o nome do primeiro. */
function ehEcoDoEnvio(m: Mensagem, envio: EnvioOtimista): boolean {
  if (m.pendente || m.tipo !== "mensagem_enviada") return false;
  if (envio.idsAntes.has(m.id)) return false;
  const conteudo = m.conteudo ?? "";
  if (envio.texto) {
    return conteudo === envio.texto || conteudo.endsWith(`\n${envio.texto}`);
  }
  return (
    envio.primeiroAnexo !== null &&
    (conteudo === envio.primeiroAnexo ||
      conteudo.startsWith(`${envio.primeiroAnexo} (`))
  );
}

/** O estado otimista: as bolhas e os ecos que já esconderam uma otimista
 *  (um eco esconde uma só: dois "ok" seguidos não somem juntos). */
type ListaOtimista = { mensagens: Mensagem[]; ecos: ReadonlySet<string> };

/** O que o UPDATE do tempo real muda numa bolha que já está na tela.
 *  `conteudo` ausente: o payload não trouxe o texto (fica o que estava). */
type MensagemViva = Pick<Mensagem, "reacoes" | "apagada" | "editada"> & {
  rev: number;
  conteudo?: string | null;
};

/** A primeira recebida que ninguém da equipe viu, e quantas são. */
function marcaDasNaoLidas(mensagens: Mensagem[]): MarcaNaoLidas | null {
  const i = mensagens.findIndex((m) => m.naoLida);
  if (i === -1) return null;
  return {
    id: mensagens[i].id,
    quantidade: mensagens.slice(i).filter((m) => m.naoLida).length,
  };
}

/** A mensagem citada entre as carregadas: pela nossa linha ou pelo id da
 *  Meta. */
function acharCitada(
  resposta: RespostaCitada,
  lista: Mensagem[],
): Mensagem | null {
  return (
    lista.find(
      (m) =>
        (resposta.interacaoId !== null && m.id === resposta.interacaoId) ||
        (resposta.idMeta !== null &&
          (m.idMeta === resposta.idMeta ||
            (m.idsMeta ?? []).includes(resposta.idMeta))),
    ) ?? null
  );
}

/** Com menos movimento pedido, o salto é seco. */
function comportamentoDaRolagem(): ScrollBehavior {
  return typeof window !== "undefined" &&
    window.matchMedia("(prefers-reduced-motion: reduce)").matches
    ? "auto"
    : "smooth";
}

type AnexoRemotoEnvio = {
  caminho: string;
  nome: string;
  tipo: string;
  tamanho: number;
  documento: boolean;
};

let contadorAnexo = 0;
function novoItem(arquivo: File, documento: boolean): ItemAnexo {
  contadorAnexo += 1;
  return { id: `anexo-${contadorAnexo}`, arquivo, documento };
}

/**
 * Preferência de assinatura por navegador (localStorage) como store
 * externo, o formato que o React pede para fonte fora do estado.
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
    try {
      return localStorage.getItem("chat_assinar") === "1";
    } catch {
      return false;
    }
  },
  lerNoServidor() {
    return false;
  },
  gravar(valor: boolean) {
    try {
      localStorage.setItem("chat_assinar", valor ? "1" : "0");
    } catch {
      // armazenamento bloqueado: vale só nesta tela
    }
    assinaturaStore.ouvintes.forEach((cb) => cb());
  },
};

/** O Enviar (ou Salvar nota): o único botão principal do compositor. */
function BotaoEnviar({
  desabilitado,
  nota,
  ocupado,
  tituloAtalho,
}: {
  desabilitado: boolean;
  nota: boolean;
  ocupado: boolean;
  tituloAtalho: string;
}) {
  const { pending } = useFormStatus();
  const carregando = pending || ocupado;
  const rotulo = nota ? "Salvar nota" : "Enviar";
  return (
    <button
      type="submit"
      disabled={carregando || desabilitado}
      aria-busy={carregando || undefined}
      aria-label={nota ? "Salvar nota privada" : "Enviar mensagem"}
      title={tituloAtalho}
      className={classesDoBotao({
        variant: "primary",
        size: "md",
        className:
          "w-[40px] px-0 pointer-coarse:h-[44px] pointer-coarse:w-[44px] md:w-auto md:px-2",
      })}
    >
      {carregando ? (
        <Spinner tamanho={18} />
      ) : nota ? (
        <Check size={18} strokeWidth={2.25} aria-hidden />
      ) : (
        <Send size={18} strokeWidth={1.75} aria-hidden />
      )}
      <span className="hidden md:inline">{rotulo}</span>
    </button>
  );
}

/**
 * A janela de 24h numa linha só, no alto do compositor. O restante vem do
 * servidor; aqui só desce um tique por minuto.
 */
function StatusJanela({
  restanteInicialMs,
  vencida,
  canal,
  aceitaTemplate,
}: {
  restanteInicialMs: number | null;
  /** O timer da Janela viu o prazo vencer: fecha junto com o compositor. */
  vencida: boolean;
  canal: CanalConversa;
  aceitaTemplate: boolean;
}) {
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

  const direct = canal === "instagram";
  if (restanteInicialMs === null) {
    return (
      <Estado tom="atencao">
        {direct
          ? "A pessoa ainda não escreveu pelo Direct. Dá para responder quando ela mandar mensagem."
          : aceitaTemplate
            ? "O contato nunca escreveu: a janela de 24h não abriu. Só template chega."
            : "O contato nunca escreveu e não tem telefone."}
      </Estado>
    );
  }
  const restanteMs = restanteInicialMs - tique * 60_000;
  if (vencida || restanteMs <= 0) {
    return (
      <Estado tom="atencao">
        {direct
          ? aceitaTemplate
            ? "Passou de 24h no Direct. Dá para mandar template pelo WhatsApp."
            : "Passou de 24h no Direct. O Instagram não tem template: só dá para responder quando a pessoa escrever de novo."
          : "Janela de 24h fechada. Só template chega."}
      </Estado>
    );
  }
  const horas = Math.floor(restanteMs / 3_600_000);
  const minutos = Math.floor((restanteMs % 3_600_000) / 60_000);
  return (
    <Estado tom="bom">
      {direct ? "Janela do Direct aberta" : "Janela aberta"} · fecha em{" "}
      <span className="tabular-nums">
        {horas > 0 ? `${horas}h${String(minutos).padStart(2, "0")}` : `${minutos}min`}
      </span>
    </Estado>
  );
}

/** Uma linha de estado: ponto de 8px e o texto. A cor nunca vem sozinha. */
function Estado({
  tom,
  children,
}: {
  tom: "bom" | "atencao" | "erro" | "neutro";
  children: React.ReactNode;
}) {
  return (
    <p
      className={cn(
        "tipo-nota flex min-w-0 items-start gap-0.5",
        tom === "atencao" ? "text-atencao" : tom === "erro" ? "text-erro" : "text-texto-2",
      )}
    >
      <span
        aria-hidden
        className={cn(
          "mt-[5px] h-[8px] w-[8px] shrink-0 rounded-full",
          tom === "bom"
            ? "bg-bom"
            : tom === "atencao"
              ? "bg-atencao"
              : tom === "erro"
                ? "bg-erro"
                : "bg-texto-3",
        )}
      />
      <span className="min-w-0">{children}</span>
    </p>
  );
}

const ROTULO_MIDIA_CITADA: Record<string, string> = {
  image: "Foto",
  sticker: "Figurinha",
  audio: "Áudio",
  video: "Vídeo",
  file: "Documento",
  link: "Link do Instagram",
};

/**
 * "Respondendo a Fulano" e o trecho da citada, acima do campo, com o X.
 * Tocar no trecho leva até a mensagem. Quando a citação não vai ao contato
 * (Direct, ou mensagem sem id do WhatsApp), a linha de baixo avisa.
 */
function BarraResposta({
  citada,
  nomeContato,
  eu,
  soNaEquipe,
  aoIr,
  aoCancelar,
}: {
  citada: Mensagem;
  nomeContato: string | null;
  eu: EuNoChat | null;
  soNaEquipe: boolean;
  aoIr: () => void;
  aoCancelar: () => void;
}) {
  const autor =
    citada.tipo === "mensagem_recebida"
      ? (nomeContato ?? "Contato")
      : eu && citada.autor === eu.nome
        ? "você"
        : (citada.autor ?? "Equipe");
  const texto = textoVisivel(citada);
  const midia = citada.anexos?.[0]?.tipo;
  const trecho = texto
    ? texto.replace(/[*_~`]/g, "")
    : midia
      ? (ROTULO_MIDIA_CITADA[midia] ?? "Arquivo")
      : citada.localizacao
        ? "Localização"
        : (citada.contatos?.length ?? 0) > 0
          ? "Contato"
          : "Mensagem";
  const miniatura =
    citada.anexos?.find((a) => a.tipo === "image")?.url ?? null;
  return (
    <div className="pb-1">
      <div className="flex items-stretch gap-0.5 rounded-controle bg-cartao">
        <button
          type="button"
          onClick={aoIr}
          className="flex min-w-0 flex-1 items-stretch gap-1 rounded-controle py-0.5 pl-1 text-left transition-colors duration-[120ms] hover:bg-realce focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-tinta"
        >
          <span aria-hidden className="my-0.5 w-[3px] shrink-0 bg-tinta" />
          <span className="min-w-0 flex-1 py-0.5">
            <span className="tipo-nota block truncate text-texto-2">
              Respondendo a{" "}
              <span className="font-semibold text-tinta">{autor}</span>
            </span>
            <span className="tipo-nota block truncate text-tinta">{trecho}</span>
          </span>
          {miniatura ? (
            // eslint-disable-next-line @next/next/no-img-element -- mídia do Storage, sem otimização do Next
            <img
              src={miniatura}
              alt=""
              className="my-0.5 h-[40px] w-[40px] shrink-0 rounded-celula object-cover"
            />
          ) : null}
        </button>
        <button
          type="button"
          onClick={aoCancelar}
          aria-label="Cancelar a resposta"
          title="Cancelar a resposta (Esc)"
          className={cn(BOTAO_ICONE, "self-center")}
        >
          <X size={18} strokeWidth={1.75} aria-hidden />
        </button>
      </div>
      {soNaEquipe ? (
        <p className="tipo-nota pt-0.5 text-texto-2">
          A citação fica só na equipe: o contato recebe a mensagem sem ela.
        </p>
      ) : null}
    </div>
  );
}

/** O que a fila precisa saber de um envio que deu certo. */
export type EnvioConcluido = { leadId: string; assumiu: boolean };

/** De onde sai o envio no ar: o compositor ou o diálogo de template. Os
 *  dois podem voar juntos na mesma conversa. */
export type OrigemEnvio = "texto" | "template";

/**
 * Histórico e compositor da conversa aberta. Memoizada: o palco muda de
 * estado o tempo todo (fila, resumo, menus) e a Janela só precisa render de
 * novo quando a conversa dela muda: as props são dado e callbacks estáveis.
 */
export const Janela = memo(function Janela({
  leadId,
  temConversa,
  mensagens,
  mensagensPadrao,
  templates,
  restanteJanela,
  marketingBloqueado,
  hojeChave,
  ontemChave,
  canal,
  aceitaTemplate,
  focarAoAbrir = false,
  pedidoProntas = 0,
  podeConfigurar = false,
  aoEnviarComSucesso,
  aoEnviarEResolver,
  aoResolverESeguir,
  aoSairDoCompositor,
  aoEnvioEmVoo,
  nomeContato = null,
  somenteLeitura = false,
}: {
  leadId: string;
  /** O perfil só lê (compliance): no lugar do compositor, a linha "Perfil
   *  de compliance: só leitura." com o estado da janela de 24h à vista. O
   *  servidor já recusa o envio; aqui só some o que terminaria em erro. */
  somenteLeitura?: boolean;
  /** O nome do contato, para a barra "Respondendo a" e as reações dele.
   *  Sem ele, a tela diz "Contato". */
  nomeContato?: string | null;
  temConversa: boolean;
  mensagens: Mensagem[];
  /** null = a leitura falhou (a lista de prontas avisa em vez de dizer
   *  que não há nenhuma). */
  mensagensPadrao: MensagemPadrao[] | null;
  /** [] = Meta sem template ou não configurada; null = não carregou. */
  templates: TemplateWhatsapp[] | null;
  restanteJanela: number | null;
  marketingBloqueado: boolean;
  hojeChave: string;
  ontemChave: string;
  /** Por onde sai a resposta livre: no Direct não existe template. */
  canal: CanalConversa;
  /** Tem telefone: o template alcança o contato. */
  aceitaTemplate: boolean;
  /** Aberta por clique de mouse no desktop: o compositor ganha o foco. */
  focarAoAbrir?: boolean;
  /** Cada número novo abre as mensagens prontas (a paleta pediu). */
  pedidoProntas?: number;
  /** Gestão: sem prontas cadastradas, o aviso aponta Configurações. */
  podeConfigurar?: boolean;
  /** Um envio (texto, anexo ou template) concluiu: a fila tira a linha da
   *  espera e, se o servidor assumiu a conversa, mostra o dono. */
  aoEnviarComSucesso?: (envio: EnvioConcluido) => void;
  /** "Enviar e resolver" (⌘Enter) saiu resolvido no servidor: a fila só
   *  reflete e segue para a próxima. */
  aoEnviarEResolver?: (leadId: string) => void;
  /** O "Resolver e seguir" do celular, oferecido depois do envio. */
  aoResolverESeguir?: (leadId: string) => void;
  /** Esc no compositor: o foco volta para a fila (J, E e H valem de novo). */
  aoSairDoCompositor?: () => void;
  /** Um envio saiu (true) ou teve desfecho (false): enquanto voa, a fila
   *  segura o que desmontaria a Janela (E, H, J, K, Resolver, trocar de
   *  conversa), senão o erro e o texto de volta sumiriam com ela. */
  aoEnvioEmVoo?: (leadId: string, emVoo: boolean, origem?: OrigemEnvio) => void;
}) {
  const [estado, formAction, enviandoAcao] = useActionState(
    enviarComRede,
    ESTADO,
  );
  const [texto, setTexto] = useState("");
  const [modo, setModo] = useState<"responder" | "nota">("responder");
  const assinar = useSyncExternalStore(
    assinaturaStore.subscribe,
    assinaturaStore.ler,
    assinaturaStore.lerNoServidor,
  );
  const prontas = useMemo(() => mensagensPadrao ?? [], [mensagensPadrao]);
  const listaTemplates = templates ?? [];
  const direct = canal === "instagram";
  // Template só existe no WhatsApp: sem telefone, nenhum botão de template
  // aparece (o servidor recusaria).
  const oferecerTemplates = aceitaTemplate && listaTemplates.length > 0;

  const caixaRef = useRef<HTMLDivElement>(null);
  const formRef = useRef<HTMLFormElement>(null);
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const gatilhoMaisRef = useRef<HTMLButtonElement>(null);
  const gatilhoProntasRef = useRef<HTMLButtonElement>(null);
  // De quem é a resposta da IA que acabou de chegar: trocar de conversa no
  // meio da chamada não pode jogar o rascunho de um contato na caixa do
  // outro.
  const leadAtualRef = useRef(leadId);
  useEffect(() => {
    leadAtualRef.current = leadId;
    return () => {
      leadAtualRef.current = "";
    };
  }, [leadId]);

  // Confirmadas locais: sem revalidatePath no envio, a bolha otimista
  // reverteria quando a action termina. A interação devolvida entra aqui e
  // segura a mensagem na tela até o tempo real trazer a mesma linha.
  const [confirmadasLocais, setConfirmadasLocais] = useState<Mensagem[]>([]);
  // Histórico antigo trazido sob demanda (a conversa abre com as 200
  // últimas; conversa de cliente velho passa disso).
  const [anteriores, setAnteriores] = useState<Mensagem[]>([]);
  const [temAnteriores, setTemAnteriores] = useState(true);
  const [buscandoAnteriores, setBuscandoAnteriores] = useState(false);
  // Reação, apagada e edição que chegaram pelo UPDATE do tempo real: a fila
  // repassa só o recibo e os anexos, e a Janela escuta o resto pelo mesmo
  // canal (ouvirAtualizacoesDaConversa). Entre duas versões, vale a de rev
  // maior; a recarga da conversa traz a do banco e passa na frente.
  const [vivas, setVivas] = useState<ReadonlyMap<string, MensagemViva>>(
    () => new Map(),
  );
  // Aviso da área das mensagens (o histórico que não veio, a citada que
  // não está mais lá, o "Mensagem apagada · Desfazer"). Some sozinho.
  const [avisoLista, setAvisoLista] = useState<AvisoDaLista | null>(null);
  // As ações na mensagem: a linha em cena (menu, folha ou diálogo) e a
  // mensagem que o compositor está respondendo.
  const [alvoAcoes, setAlvoAcoes] = useState<AlvoMensagem | null>(null);
  const [respondendoA, setRespondendoA] = useState<Mensagem | null>(null);
  // Quem está usando (uma leitura por página): o que a bolha oferece.
  const [eu, setEu] = useState<EuNoChat | null>(null);
  useEffect(() => {
    let vivo = true;
    void lerEuNoChat().then((quem) => {
      if (vivo) setEu(quem);
    });
    return () => {
      vivo = false;
    };
  }, []);
  const baseMensagens = useMemo(() => {
    const juntas =
      anteriores.length > 0 ? [...anteriores, ...mensagens] : mensagens;
    let base = juntas;
    if (confirmadasLocais.length > 0) {
      const noServidor = new Set(juntas.map((m) => m.id));
      const locais = confirmadasLocais.filter((m) => !noServidor.has(m.id));
      if (locais.length > 0) base = [...juntas, ...locais];
    }
    if (vivas.size === 0) return base;
    return base.map((m) => {
      const viva = vivas.get(m.id);
      if (!viva || viva.rev <= (m.rev ?? 0)) return m;
      return {
        ...m,
        reacoes: viva.reacoes,
        apagada: viva.apagada,
        editada: viva.editada,
        ...(viva.conteudo !== undefined ? { conteudo: viva.conteudo } : {}),
        rev: viva.rev,
      };
    });
  }, [mensagens, anteriores, confirmadasLocais, vivas]);

  useEffect(
    () =>
      ouvirAtualizacoesDaConversa(leadId, (linha) => {
        if (!ehTipoMensagem(linha.tipo) || !linha.id) return;
        // UPDATE que não mexeu nos metadados pode chegar sem eles.
        if (!linha.metadados || typeof linha.metadados !== "object") return;
        const nova = paraMensagem(linha as LinhaBrutaInteracao, null);
        const viva: MensagemViva = {
          rev: nova.rev ?? 0,
          reacoes: nova.reacoes,
          apagada: nova.apagada,
          editada: nova.editada,
          // Texto longo que não mudou pode vir sem o campo (TOAST).
          ...(typeof linha.conteudo === "string" ? { conteudo: linha.conteudo } : {}),
        };
        setVivas((atuais) => {
          const antes = atuais.get(nova.id);
          if (antes && antes.rev >= viva.rev) return atuais;
          return new Map(atuais).set(nova.id, viva);
        });
      }),
    [leadId],
  );

  /** Traz o lote anterior ao mais antigo na tela, ancorando a leitura. */
  const carregarAnteriores = async () => {
    const maisAntiga = baseMensagens[0];
    if (!maisAntiga || buscandoAnteriores) return;
    setBuscandoAnteriores(true);
    const caixa = caixaRef.current;
    const alturaAntes = caixa?.scrollHeight ?? 0;
    try {
      const r = await carregarMensagensAnteriores(leadId, maisAntiga.criado_em);
      if ("erro" in r) {
        setAvisoLista({ texto: r.erro });
      } else {
        setTemAnteriores(r.temMais);
        if (r.mensagens.length === 0) setTemAnteriores(false);
        else setAnteriores((a) => [...r.mensagens, ...a]);
      }
    } catch {
      setAvisoLista({ texto: "A conexão não respondeu. Tente de novo." });
    } finally {
      setBuscandoAnteriores(false);
      // Mantém o olho onde estava: o conteúdo entrou ACIMA.
      requestAnimationFrame(() => {
        const c = caixaRef.current;
        if (c) c.scrollTop += c.scrollHeight - alturaAntes;
      });
    }
  };

  // Envio otimista: a mensagem aparece na hora enquanto viaja. O eco do
  // tempo real pode chegar antes de a action responder: quando ele entra,
  // toma o lugar da otimista, em vez de a mensagem aparecer duas vezes.
  const baseOtimista = useMemo<ListaOtimista>(
    () => ({ mensagens: baseMensagens, ecos: new Set<string>() }),
    [baseMensagens],
  );
  const [otimista, adicionarOtimista] = useOptimistic<
    ListaOtimista,
    EnvioOtimista
  >(baseOtimista, (atual, envio) => {
    const eco = atual.mensagens.find(
      (m) => !atual.ecos.has(m.id) && ehEcoDoEnvio(m, envio),
    );
    return eco
      ? { mensagens: atual.mensagens, ecos: new Set(atual.ecos).add(eco.id) }
      : { mensagens: [...atual.mensagens, envio.mensagem], ecos: atual.ecos };
  });
  const listaMensagens = otimista.mensagens;
  const contadorOtimistaRef = useRef(0);

  // Mensagens prontas: abrem pelo raio, pela paleta ou digitando "/".
  const [prontasAbertas, setProntasAbertas] = useState(false);
  // Anexos de uma pronta ainda baixando: o Enviar espera terminar.
  const [baixandoPronta, setBaixandoPronta] = useState(false);
  const [busca, setBusca] = useState("");
  const [idxSel, setIdxSel] = useState(0);
  const [barraSuprimida, setBarraSuprimida] = useState(false);

  // Anexos da caixa (a prévia mostra cada um como vai sair). Os dois
  // seletores do "Anexar": fotos e vídeos, ou documento.
  const [anexos, setAnexos] = useState<ItemAnexo[]>([]);
  const [avisoArquivo, setAvisoArquivo] = useState<string | null>(null);
  const [anexarAberto, setAnexarAberto] = useState(false);
  const gatilhoAnexarRef = useRef<HTMLButtonElement>(null);
  const inputFotosRef = useRef<HTMLInputElement>(null);
  const inputDocumentoRef = useRef<HTMLInputElement>(null);
  // Da largada do microfone ao áudio pronto, a barra de ferramentas é do
  // gravador.
  const [gravandoAudio, setGravandoAudio] = useState(false);

  const [iaOcupada, setIaOcupada] = useState<"sugerir" | "corrigir" | null>(
    null,
  );
  const [erroIa, setErroIa] = useState<string | null>(null);
  // O ⋯ do compositor: IA e template.
  const [maisAberto, setMaisAberto] = useState(false);
  const [templateAberto, setTemplateAberto] = useState(false);
  // O erro de envio mora num estado próprio: a action retém o erro até o
  // PRÓXIMO envio concluir, e o slot único de erro mostraria o velho por
  // cima de avisos novos.
  const [erroEnvio, setErroEnvio] = useState<string | null>(null);
  // A mensagem saiu e algo depois dela não gravou (o resolver do ⌘Enter).
  const [avisoEnvio, setAvisoEnvio] = useState<string | null>(null);
  // O "Resolver e seguir" do celular: o lead do envio que deu certo.
  const [ofertaResolver, setOfertaResolver] = useState<string | null>(null);

  // Enquanto os anexos sobem, o pending da action ainda é falso: sem esta
  // trava, um segundo Enter mandava a mesma legenda e os mesmos arquivos de
  // novo.
  const enviandoRef = useRef(false);
  // ⌘Enter marca o envio para sair resolvido.
  const resolverAposEnvioRef = useRef(false);

  // Rolagem: só cola no fim se o atendente já estava perto do fim. Longe
  // dele, aparece a seta, com quantas chegaram enquanto ele lia lá em cima.
  const pertoDoFimRef = useRef(true);
  // Até quando o salto até a citada está rolando: nesse meio tempo, o
  // observador de altura não cola a tela no fim.
  const saltoAteRef = useRef(0);
  const [longeDoFim, setLongeDoFim] = useState(false);
  const [novasAbaixo, setNovasAbaixo] = useState(0);
  // Onde começa o que ninguém viu, congelado na abertura: a conversa abre
  // ali, como no WhatsApp, e a marca fica até sair da conversa.
  const [marcaNaoLidas, setMarcaNaoLidas] = useState<MarcaNaoLidas | null>(
    () => marcaDasNaoLidas(mensagens),
  );
  // A citada que a pessoa tocou fica marcada por um instante.
  const [destaqueId, setDestaqueId] = useState<string | null>(null);
  const [visualizador, setVisualizador] = useState<{
    itens: ItemVisualizador[];
    inicial: number;
  } | null>(null);
  const conteudoRef = useRef<HTMLDivElement>(null);

  const chaveRascunho = `chat_rascunho_${leadId}`;

  // Restaura o rascunho salvo ao abrir/trocar de conversa.
  useEffect(() => {
    let salvo = "";
    try {
      salvo = localStorage.getItem(chaveRascunho) ?? "";
    } catch {
      salvo = "";
    }
    // eslint-disable-next-line react-hooks/set-state-in-effect -- sincroniza com o armazenamento externo do rascunho ao trocar de conversa
    setTexto(salvo);
  }, [chaveRascunho]);

  // Mensagem nova no FIM (as antigas que entram em cima não contam): perto
  // do fim, a tela desce junto; longe, a seta conta as recebidas.
  const ultimaRef = useRef<{ id: string; em: number } | null>(null);
  useEffect(() => {
    const ultima = listaMensagens[listaMensagens.length - 1];
    const antes = ultimaRef.current;
    ultimaRef.current = ultima
      ? { id: ultima.id, em: Date.parse(ultima.criado_em) }
      : null;
    const caixa = caixaRef.current;
    if (!caixa || !ultima || !antes || ultima.id === antes.id) return;
    if (pertoDoFimRef.current) {
      caixa.scrollTop = caixa.scrollHeight;
      return;
    }
    const novas = listaMensagens.filter(
      (m) => m.tipo === "mensagem_recebida" && Date.parse(m.criado_em) > antes.em,
    ).length;
    if (novas > 0) setNovasAbaixo((n) => n + novas);
  }, [listaMensagens]);

  // Ao abrir: na primeira não lida (com o dia preso no alto à vista), ou no
  // fim. Antes da pintura, para a conversa não aparecer no topo e pular.
  useLayoutEffect(() => {
    // Um salto da conversa anterior não segura a nova.
    saltoAteRef.current = 0;
    const caixa = caixaRef.current;
    if (!caixa) return;
    const marco = caixa.querySelector<HTMLElement>("[data-nao-lidas]");
    if (!marco) {
      caixa.scrollTop = caixa.scrollHeight;
      pertoDoFimRef.current = true;
      return;
    }
    const topo =
      marco.getBoundingClientRect().top -
      caixa.getBoundingClientRect().top +
      caixa.scrollTop -
      48;
    caixa.scrollTop = Math.max(topo, 0);
    const distancia = caixa.scrollHeight - caixa.scrollTop - caixa.clientHeight;
    pertoDoFimRef.current = distancia < LIMIAR_FIM_PX;
    if (distancia > LIMIAR_SETA_PX) {
      setLongeDoFim(true);
      setNovasAbaixo(marcaNaoLidas?.quantidade ?? 0);
    }
    // A marca só muda junto com a conversa: o efeito roda uma vez por
    // abertura.
  }, [leadId, marcaNaoLidas]);

  // Foto que termina de carregar (e vídeo, e o lote antigo) muda a altura:
  // quem estava no fim continua no fim. A lista só existe com bolha.
  const temBolhas = listaMensagens.length > 0;
  useEffect(() => {
    const conteudo = conteudoRef.current;
    const caixa = caixaRef.current;
    if (!conteudo || !caixa || typeof ResizeObserver === "undefined") return;
    const observador = new ResizeObserver(() => {
      if (!pertoDoFimRef.current) return;
      // Os primeiros passos da rolagem suave ainda estão perto do fim: colar
      // ali cancelaria o salto até a citada.
      if (performance.now() < saltoAteRef.current) return;
      caixa.scrollTop = caixa.scrollHeight;
    });
    observador.observe(conteudo);
    return () => observador.disconnect();
  }, [temBolhas]);

  // A marca da citada some sozinha; o aviso da lista também.
  useEffect(() => {
    if (!destaqueId) return;
    const t = window.setTimeout(() => setDestaqueId(null), DESTAQUE_MS);
    return () => window.clearTimeout(t);
  }, [destaqueId]);
  useEffect(() => {
    if (!avisoLista) return;
    // Com "Desfazer", fica mais tempo para dar tempo de desistir.
    const t = window.setTimeout(
      () => setAvisoLista(null),
      avisoLista.acao ? 8000 : 5000,
    );
    return () => window.clearTimeout(t);
  }, [avisoLista]);

  const ehToque = useToque();
  // Abaixo de 768px o ⋯ do compositor abre folha: o menu de 300px passava
  // da borda da tela e o main cortava.
  const telaMd = useTelaMd();

  // Aberta por clique de mouse: o foco vai para o compositor (aberta pelo
  // teclado, pela paleta ou pelo avanço da fila, ele fica onde estava e os
  // atalhos seguem valendo). No toque nunca: abriria o teclado.
  useEffect(() => {
    if (!focarAoAbrir || ehToque) return;
    textareaRef.current?.focus({ preventScroll: true });
  }, [focarAoAbrir, leadId, ehToque]);

  // Troca de conversa zera o que era da anterior (ajuste durante o render).
  const [leadAnterior, setLeadAnterior] = useState(leadId);
  if (leadId !== leadAnterior) {
    setLeadAnterior(leadId);
    setConfirmadasLocais([]);
    setAnteriores([]);
    setTemAnteriores(true);
    setVivas(new Map());
    setAvisoLista(null);
    setMarcaNaoLidas(marcaDasNaoLidas(mensagens));
    setNovasAbaixo(0);
    setLongeDoFim(false);
    setDestaqueId(null);
    setVisualizador(null);
    setErroEnvio(null);
    setAvisoEnvio(null);
    setAvisoArquivo(null);
    setErroIa(null);
    setOfertaResolver(null);
    setMaisAberto(false);
    setTemplateAberto(false);
    setAlvoAcoes(null);
    setRespondendoA(null);
    // Os anexos são da conversa em que foram escolhidos: na seguinte, iriam
    // para o contato errado. O gravador sai junto (a chave dele é a
    // conversa) e o áudio em gravação vai fora.
    setAnexos([]);
    setAnexarAberto(false);
    setGravandoAudio(false);
  }

  // A paleta pediu as mensagens prontas (ajuste durante o render).
  const [pedidoVisto, setPedidoVisto] = useState(pedidoProntas);
  if (pedidoProntas !== pedidoVisto) {
    setPedidoVisto(pedidoProntas);
    if (temConversa) {
      setProntasAbertas(true);
      setIdxSel(0);
      setBusca("");
    }
  }

  // A janela de 24h vence sozinha com a conversa aberta: um timer até o
  // vencimento trava o compositor junto com o aviso. Lendo só a prop, o
  // texto livre seguia liberado e a Meta o descartava depois.
  const [janelaVenceu, setJanelaVenceu] = useState(false);
  const [prazoAnterior, setPrazoAnterior] = useState({
    leadId,
    restanteJanela,
  });
  if (
    prazoAnterior.leadId !== leadId ||
    prazoAnterior.restanteJanela !== restanteJanela
  ) {
    setPrazoAnterior({ leadId, restanteJanela });
    setJanelaVenceu(false);
  }
  useEffect(() => {
    // Nunca passa de 24h: cabe folgado no teto do setTimeout.
    if (restanteJanela === null || restanteJanela <= 0) return;
    const timer = window.setTimeout(
      () => setJanelaVenceu(true),
      restanteJanela,
    );
    return () => window.clearTimeout(timer);
  }, [restanteJanela, leadId]);
  const janelaAberta =
    restanteJanela !== null && restanteJanela > 0 && !janelaVenceu;

  // "Hoje" e "Ontem" viram na meia-noite de Brasília com a conversa aberta.
  const [chavesDoRelogio, setChavesDoRelogio] = useState<{
    hoje: string;
    ontem: string;
  } | null>(null);
  const [hojeDoServidor, setHojeDoServidor] = useState(hojeChave);
  if (hojeChave !== hojeDoServidor) {
    setHojeDoServidor(hojeChave);
    setChavesDoRelogio(null);
  }
  useEffect(() => {
    // O segundo a mais garante que o timer já cai no dia novo.
    const timer = window.setTimeout(() => {
      const agora = Date.now();
      setChavesDoRelogio({
        hoje: FORMATO_DIA.format(agora),
        ontem: FORMATO_DIA.format(agora - DIA_MS),
      });
    }, msAteMeiaNoiteBrasilia(Date.now()) + 1000);
    return () => window.clearTimeout(timer);
  }, [chavesDoRelogio]);
  const hojeNaTela = chavesDoRelogio?.hoje ?? hojeChave;
  const ontemNaTela = chavesDoRelogio?.ontem ?? ontemChave;

  // A caixa limpa no envio (aoEnviar); aqui só o desfecho: sucesso descarta o
  // backup, erro devolve texto e anexos para tentar de novo.
  const [backupEnvio, setBackupEnvio] = useState<{
    /** null: o envio não levou o texto da caixa (o áudio gravado). */
    texto: string | null;
    /** Na ordem em que saíram (a da legenda). */
    anexos: ItemAnexo[];
    /** A citada do "responder": volta para a barra se o envio falhar. */
    citada: Mensagem | null;
  } | null>(null);

  /** A interação que a action criou entra na conversa por conta própria. */
  const confirmarLocal = (interacao: InteracaoCriada | undefined) => {
    if (!interacao) return;
    const nova: Mensagem = {
      id: interacao.id,
      tipo: interacao.tipo,
      conteudo: interacao.conteudo,
      criado_em: interacao.criado_em,
      autor: interacao.autor,
      autorId: interacao.autorId ?? null,
      anexos: interacao.anexos,
      respostaA: interacao.respostaA ?? null,
    };
    setConfirmadasLocais((atuais) =>
      atuais.some((m) => m.id === nova.id) ? atuais : [...atuais, nova],
    );
  };

  const [estadoAnterior, setEstadoAnterior] = useState(estado);
  if (estado !== estadoAnterior) {
    setEstadoAnterior(estado);
    // Falha parcial (o texto e parte dos anexos chegaram) também devolve a
    // interação: o que saiu tem de aparecer na conversa.
    confirmarLocal(estado.interacao);
    if (estado.ok) {
      setBackupEnvio(null);
      setAvisoArquivo(null);
      setErroEnvio(null);
      // A mensagem saiu e a marca de resolvida não gravou: o aviso diz, e o
      // texto não volta para a caixa (ele chegou).
      setAvisoEnvio(estado.resolvida === false ? (estado.aviso ?? null) : null);
      // No celular, depois de uma resposta, o resolver fica junto do
      // polegar por alguns segundos.
      if (
        ehToque &&
        estado.interacao?.tipo !== "nota" &&
        estado.resolvida === undefined
      ) {
        setOfertaResolver(estado.leadId ?? leadId);
      }
    } else if (estado.erro) {
      setErroEnvio(estado.erro);
      setAvisoEnvio(null);
      // O desfecho é o último acontecimento: o "O áudio ficou nos anexos",
      // dado enquanto este envio voava, não pode esconder a falha dele.
      setAvisoArquivo(null);
      if (backupEnvio) {
        // Os que voltam entram antes dos que a pessoa anexou depois do
        // clique. O áudio gravado que não saiu volta como anexo: o Enviar
        // tenta de novo.
        const voltam = estado.interacao
          ? // Falha parcial: o texto (se havia) e os primeiros anexos já
            // chegaram. Voltam só o arquivo que falhou e os seguintes, que
            // nem foram tentados; o texto não volta, ou sairia duas vezes.
            backupEnvio.anexos.slice(estado.anexosEnviados ?? 0)
          : backupEnvio.anexos;
        if (voltam.length > 0) {
          setAnexos((atuais) => [...voltam, ...atuais].slice(0, MAX_ANEXOS));
        }
        if (!estado.interacao) {
          if (backupEnvio.texto !== null) setTexto(backupEnvio.texto);
          if (backupEnvio.citada) setRespondendoA(backupEnvio.citada);
        }
        setBackupEnvio(null);
      }
    }
  }

  // O "Resolver e seguir" some sozinho.
  useEffect(() => {
    if (!ofertaResolver) return;
    const t = window.setTimeout(() => setOfertaResolver(null), OFERTA_RESOLVER_MS);
    return () => window.clearTimeout(t);
  }, [ofertaResolver]);

  // Avisar a fila é efeito, não render: ela muda o estado de outro
  // componente, o que o React não aceita no meio de um render.
  const avisosRef = useRef({
    aoEnviarComSucesso,
    aoEnviarEResolver,
    aoEnvioEmVoo,
  });
  useEffect(() => {
    avisosRef.current = { aoEnviarComSucesso, aoEnviarEResolver, aoEnvioEmVoo };
  });

  // O envio no ar (da caixa limpa ao desfecho): de que conversa ele é.
  const vooRef = useRef<{ leadId: string | null }>({ leadId: null });
  const soltarVoo = useCallback(() => {
    const voando = vooRef.current.leadId;
    if (!voando) return;
    vooRef.current.leadId = null;
    avisosRef.current.aoEnvioEmVoo?.(voando, false);
  }, []);
  // Desmontou com o envio no ar (saiu da tela por um caminho que a fila não
  // segura): a conversa não pode ficar presa para sempre.
  useEffect(() => soltarVoo, [soltarVoo]);
  // O template voa pelo diálogo, fora do envio do compositor: avisa a fila
  // com a origem dele, e o fim de um envio não solta o outro.
  const aoTemplateEmVoo = useCallback(
    (doLead: string, emVoo: boolean) =>
      avisosRef.current.aoEnvioEmVoo?.(doLead, emVoo, "template"),
    [],
  );

  // Nota privada não fala com o contato: não tira a conversa da espera nem
  // a assume (o servidor só assume quem escreveu para o contato).
  useEffect(() => {
    // O desfecho chegou: a conversa deixa de estar presa antes de qualquer
    // aviso à fila (o ⌘Enter segue para a próxima logo abaixo).
    soltarVoo();
    if (!estado.ok || estado.interacao?.tipo === "nota") return;
    const doEnvio = estado.leadId ?? leadAtualRef.current;
    if (!doEnvio) return;
    avisosRef.current.aoEnviarComSucesso?.({
      leadId: doEnvio,
      assumiu: estado.assumiu === true,
    });
    if (estado.resolvida === true) {
      avisosRef.current.aoEnviarEResolver?.(doEnvio);
    }
  }, [estado, soltarVoo]);

  // A caixa cresce com o texto, de uma linha até o teto (o CSS corta e
  // rola dali para cima).
  useLayoutEffect(() => {
    const el = textareaRef.current;
    if (!el) return;
    el.style.height = "auto";
    el.style.height = `${el.scrollHeight + 2}px`;
  }, [texto, modo]);

  const atualizarTexto = (valor: string) => {
    setTexto(valor);
    setIdxSel(0);
    if (valor) setOfertaResolver(null);
    if (!valor.startsWith("/")) setBarraSuprimida(false);
    try {
      if (valor) localStorage.setItem(chaveRascunho, valor);
      else localStorage.removeItem(chaveRascunho);
    } catch {
      // armazenamento bloqueado: o rascunho vale só nesta tela
    }
  };

  const slashAtivo = texto.startsWith("/") && !barraSuprimida;
  const painelProntas = temConversa && (slashAtivo || prontasAbertas);
  // No toque, o raio abre a folha; a "/" digitada abre a lista sobre o
  // compositor (a folha cobriria o que se escreve).
  const prontasEmFolha = ehToque && prontasAbertas && !slashAtivo;
  const filtro = (slashAtivo ? texto.slice(1) : busca).trim().toLowerCase();
  const prontasFiltradas = filtro
    ? prontas.filter(
        (m) =>
          m.titulo.toLowerCase().includes(filtro) ||
          m.corpo.toLowerCase().includes(filtro),
      )
    : prontas;
  const idxAtivo = Math.min(idxSel, Math.max(prontasFiltradas.length - 1, 0));

  const fecharProntas = () => {
    setProntasAbertas(false);
    setBusca("");
    if (texto.startsWith("/")) setBarraSuprimida(true);
    if (!ehToque) textareaRef.current?.focus();
  };

  const aplicarPronta = (pronta: MensagemPadrao) => {
    atualizarTexto(pronta.corpo);
    setProntasAbertas(false);
    setBusca("");
    setIdxSel(0);
    if (!ehToque) textareaRef.current?.focus();

    // Anexos da pronta: baixa e coloca na fila de envio, o mesmo caminho de
    // um arquivo escolhido à mão. Nota privada e janela de 24h fechada não
    // recebem anexo (avisa em vez de anexar).
    const anexosPronta = pronta.anexos ?? [];
    if (anexosPronta.length === 0) return;
    if (modo === "nota") {
      setAvisoArquivo(
        "Nota privada não leva anexo. Os arquivos desta mensagem pronta ficaram de fora.",
      );
      return;
    }
    if (!janelaAberta) {
      setAvisoArquivo(
        direct
          ? aceitaTemplate
            ? "Passou de 24h no Direct. Dá para mandar template pelo WhatsApp. Os anexos da mensagem pronta ficaram de fora."
            : "Janela de 24h do Direct fechada; espere a pessoa escrever de novo. Os anexos ficaram de fora."
          : "Janela de 24h fechada: só template chega. Os anexos da mensagem pronta ficaram de fora.",
      );
      return;
    }
    // Corte com nome: o atendente precisa saber QUAL arquivo ficou de fora.
    const espaco = MAX_ANEXOS - anexos.length;
    const entram = anexosPronta.slice(0, Math.max(espaco, 0));
    const sobraram = anexosPronta.slice(Math.max(espaco, 0));
    if (sobraram.length > 0) {
      setAvisoArquivo(
        `Já havia ${anexos.length.toLocaleString("pt-BR")} arquivo(s) na mensagem. Ficaram de fora: ${sobraram
          .map((a) => a.nome || "anexo")
          .join(", ")}.`,
      );
    }
    if (entram.length === 0) return;
    // Enquanto baixa, o Enviar segura: o Enter rápido mandava o texto sem
    // os arquivos, e eles grudavam na mensagem SEGUINTE.
    setBaixandoPronta(true);
    void (async () => {
      try {
        const baixados: File[] = [];
        for (const anexo of entram) {
          const resposta = await fetch(anexo.url);
          if (!resposta.ok) throw new Error(`HTTP ${resposta.status}`);
          const blob = await resposta.blob();
          baixados.push(
            new File([blob], anexo.nome || "anexo", { type: blob.type }),
          );
        }
        adicionarArquivos(baixados, false);
      } catch {
        setAvisoArquivo(
          "O anexo da mensagem pronta não carregou. Envie o texto e anexe à mão.",
        );
      } finally {
        setBaixandoPronta(false);
      }
    })();
  };

  // IA: sugestão e correção só CAEM NA CAIXA; nada vai ao contato sem o
  // atendente revisar e apertar Enviar. Cada pedido ganha um número; a
  // resposta de um pedido desistido (ou de outra conversa) é jogada fora.
  const pedidoIaRef = useRef(0);
  const iaValeAinda = (pedidoDe: string, pedido: number) =>
    leadAtualRef.current === pedidoDe && pedidoIaRef.current === pedido;
  const aplicarTextoIa = (valor: string) => {
    atualizarTexto(valor);
    if (!ehToque) textareaRef.current?.focus();
  };

  const pedirSugestao = () => {
    const pedidoDe = leadId;
    const pedido = ++pedidoIaRef.current;
    setErroIa(null);
    setAvisoArquivo(null);
    setIaOcupada("sugerir");
    sugerirResposta(pedidoDe)
      .then((r) => {
        if (!iaValeAinda(pedidoDe, pedido)) return;
        if (r.erro) setErroIa(r.erro);
        else if (r.sugestao) aplicarTextoIa(r.sugestao);
      })
      .catch(() => {
        if (!iaValeAinda(pedidoDe, pedido)) return;
        setErroIa("A IA não respondeu. Tente de novo.");
      })
      .finally(() => {
        if (pedidoIaRef.current === pedido) setIaOcupada(null);
      });
  };

  const pedirCorrecao = () => {
    const pedidoDe = leadId;
    const pedido = ++pedidoIaRef.current;
    setErroIa(null);
    setAvisoArquivo(null);
    setIaOcupada("corrigir");
    corrigirTexto(texto)
      .then((r) => {
        if (!iaValeAinda(pedidoDe, pedido)) return;
        if (r.erro) setErroIa(r.erro);
        else if (r.corrigido) aplicarTextoIa(r.corrigido);
      })
      .catch(() => {
        if (!iaValeAinda(pedidoDe, pedido)) return;
        setErroIa("A IA não respondeu. Tente de novo.");
      })
      .finally(() => {
        if (pedidoIaRef.current === pedido) setIaOcupada(null);
      });
  };

  const cancelarIa = () => {
    pedidoIaRef.current++;
    setIaOcupada(null);
    if (!ehToque) textareaRef.current?.focus();
  };

  /** Põe na caixa. Foto acima do teto e formato que o canal não aceita
   *  entram e a prévia diz como vão sair (link); só o que passa do teto do
   *  envio fica de fora. `documento`: veio do "Documento" do Anexar. */
  const adicionarArquivos = useCallback(
    (novos: File[], documento: boolean) => {
      if (novos.length === 0) return;
      setAvisoArquivo(null);
      const aceitos: ItemAnexo[] = [];
      for (const arquivo of novos) {
        if (arquivo.size > MAX_TAMANHO_ANEXO) {
          setAvisoArquivo(`"${arquivo.name}" passa de 16 MB, o teto do envio.`);
          continue;
        }
        aceitos.push(novoItem(arquivo, documento));
      }
      if (aceitos.length === 0) return;
      setAnexos((atuais) => {
        if (atuais.length + aceitos.length > MAX_ANEXOS) {
          setAvisoArquivo(`No máximo ${MAX_ANEXOS} anexos por mensagem.`);
        }
        return [...atuais, ...aceitos].slice(0, MAX_ANEXOS);
      });
    },
    [],
  );

  const tirarAnexo = useCallback((id: string) => {
    setAnexos((atuais) => atuais.filter((item) => item.id !== id));
    setAvisoArquivo(null);
  }, []);
  const tirarTodos = useCallback(() => {
    setAnexos([]);
    setAvisoArquivo(null);
    if (!ehToque) textareaRef.current?.focus({ preventScroll: true });
  }, [ehToque]);

  /** Escolha no seletor do Anexar. O valor zera para a mesma escolha
   *  disparar de novo. */
  const aoEscolher = (
    e: React.ChangeEvent<HTMLInputElement>,
    documento: boolean,
  ) => {
    adicionarArquivos(Array.from(e.target.files ?? []), documento);
    e.target.value = "";
  };

  const abrirSeletor = (documento: boolean) => {
    // O clique no seletor precisa sair dentro do gesto, antes de o menu
    // fechar.
    (documento ? inputDocumentoRef : inputFotosRef).current?.click();
    setAnexarAberto(false);
  };

  // Ctrl+V em QUALQUER lugar da conversa anexa o print, como no WhatsApp
  // Web. Colagem em outros campos (busca, variáveis) segue normal.
  useEffect(() => {
    const aoColar = (e: ClipboardEvent) => {
      if (somenteLeitura || modo === "nota" || !temConversa || !janelaAberta) {
        return;
      }
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
      adicionarArquivos(colados, false);
    };
    window.addEventListener("paste", aoColar);
    return () => window.removeEventListener("paste", aoColar);
  }, [modo, temConversa, janelaAberta, adicionarArquivos, somenteLeitura]);

  // Arrastar um print para a janela: sem interceptar, o navegador NAVEGA
  // para o arquivo e derruba a conversa.
  useEffect(() => {
    const temArquivo = (e: DragEvent) =>
      Array.from(e.dataTransfer?.types ?? []).includes("Files");
    const aoArrastarSobre = (e: DragEvent) => {
      if (temArquivo(e)) e.preventDefault();
    };
    const aoSoltar = (e: DragEvent) => {
      if (!temArquivo(e)) return;
      e.preventDefault();
      if (somenteLeitura || modo === "nota" || !temConversa || !janelaAberta) {
        return;
      }
      const soltos = Array.from(e.dataTransfer?.files ?? []);
      if (soltos.length === 0) return;
      adicionarArquivos(soltos, false);
    };
    window.addEventListener("dragover", aoArrastarSobre);
    window.addEventListener("drop", aoSoltar);
    return () => {
      window.removeEventListener("dragover", aoArrastarSobre);
      window.removeEventListener("drop", aoSoltar);
    };
  }, [modo, temConversa, janelaAberta, adicionarArquivos, somenteLeitura]);

  // Janela de 24h fechada: a Meta aceita a mensagem livre e DESCARTA
  // depois. O compositor trava; no WhatsApp o template vira a saída.
  const janelaFechada = modo === "responder" && !janelaAberta;

  const podeEnviar =
    !baixandoPronta &&
    (modo === "nota"
      ? texto.trim().length > 0
      : !janelaFechada && (texto.trim().length > 0 || anexos.length > 0));

  // Campo vazio e nada anexado: o microfone fica no lugar do Enviar, como
  // no WhatsApp. Gravando, ele segura o lugar mesmo que alguém escreva.
  const mostrarMicrofone =
    gravandoAudio ||
    (modo === "responder" &&
      !janelaFechada &&
      texto.trim().length === 0 &&
      anexos.length === 0 &&
      !baixandoPronta);

  // O texto como o servidor manda (com a assinatura na frente): acima do
  // teto de legenda ele sai antes dos anexos, e a prévia diz isso.
  const textoLimpo = texto.trim();
  const textoLongo =
    (assinar && textoLimpo
      ? `*${eu?.nome ?? ""}:*\n${textoLimpo}`
      : textoLimpo
    ).length > TETO_LEGENDA_WHATSAPP;

  // Templates que não carregaram só importam quando são a única saída.
  const avisoTemplates =
    aceitaTemplate && templates === null && (janelaFechada || !temConversa)
      ? "Os templates da Meta não carregaram. Recarregue a página."
      : null;

  // Um slot de erro só: aviso de anexo primeiro (reação ao ÚLTIMO gesto),
  // depois IA, depois o erro de envio, depois o dos templates.
  const erroCompositor =
    avisoArquivo || erroIa || erroEnvio || avisoTemplates || null;

  // O template enviado entra na conversa na hora, como a mensagem de texto.
  const aoTemplateEnviado = (resultado: ResultadoEnvio) => {
    pertoDoFimRef.current = true;
    confirmarLocal(resultado.interacao);
    aoEnviarComSucesso?.({
      leadId: resultado.leadId ?? leadId,
      assumiu: resultado.assumiu === true,
    });
  };

  const aoRolar = () => {
    const caixa = caixaRef.current;
    if (!caixa) return;
    const distancia = caixa.scrollHeight - caixa.scrollTop - caixa.clientHeight;
    const perto = distancia < LIMIAR_FIM_PX;
    pertoDoFimRef.current = perto;
    if (perto && novasAbaixo > 0) setNovasAbaixo(0);
    const longe = distancia > LIMIAR_SETA_PX;
    if (longe !== longeDoFim) setLongeDoFim(longe);
  };

  const irParaFim = () => {
    const caixa = caixaRef.current;
    if (caixa) {
      caixa.scrollTo({ top: caixa.scrollHeight, behavior: comportamentoDaRolagem() });
    }
    pertoDoFimRef.current = true;
    saltoAteRef.current = 0;
    setNovasAbaixo(0);
  };
  const setaParaOFim = longeDoFim || novasAbaixo > 0;

  // A bolha que a citação aponta: rola até ela, marca por um instante e
  // leva o foco do teclado junto (sem rolar de novo).
  const mostrarMensagem = useCallback((id: string): boolean => {
    const caixa = caixaRef.current;
    const el = caixa?.querySelector<HTMLElement>(`[data-msg~="${CSS.escape(id)}"]`);
    if (!caixa || !el) return false;
    // Se a tela vai sair do lugar, ela deixa de estar "no fim" já agora.
    // Sem isso, o observador de altura (o lote antigo que acabou de entrar
    // em cima) via a tela no fim, puxava de volta e cancelava a rolagem
    // suave: a citada ficava fora de vista. A rolagem acerta a marca quando
    // chega, e o observador espera o salto terminar.
    const caixaR = caixa.getBoundingClientRect();
    const elR = el.getBoundingClientRect();
    const maximo = caixa.scrollHeight - caixa.clientHeight;
    const destino = Math.min(
      Math.max(
        caixa.scrollTop + elR.top + elR.height / 2 - (caixaR.top + caixaR.height / 2),
        0,
      ),
      maximo,
    );
    if (Math.abs(destino - caixa.scrollTop) >= 1) {
      pertoDoFimRef.current = false;
      saltoAteRef.current = performance.now() + SALTO_MS;
    }
    el.scrollIntoView({ block: "center", behavior: comportamentoDaRolagem() });
    el.tabIndex = -1;
    el.focus({ preventScroll: true });
    setDestaqueId(id);
    return true;
  }, []);

  // A citada que veio do histórico antigo aparece no próximo desenho.
  const mostrarDepoisRef = useRef<string | null>(null);
  useLayoutEffect(() => {
    const id = mostrarDepoisRef.current;
    if (id && mostrarMensagem(id)) mostrarDepoisRef.current = null;
  }, [listaMensagens, mostrarMensagem]);

  /**
   * Tocar na citação: leva até a original. Se ela é mais antiga que o
   * carregado, busca o histórico em lotes até ela (no máximo cinco), e só
   * avisa quando não acha.
   */
  const irParaCitada = async (resposta: RespostaCitada) => {
    const naTela = acharCitada(resposta, listaMensagens);
    if (naTela) {
      mostrarMensagem(naTela.id);
      return;
    }
    const maisAntiga = baseMensagens[0];
    const alcanca =
      temAnteriores &&
      maisAntiga &&
      resposta.em &&
      Date.parse(resposta.em) < Date.parse(maisAntiga.criado_em);
    if (!alcanca || buscandoAnteriores) {
      if (!buscandoAnteriores) {
        setAvisoLista({ texto: "A mensagem citada não está mais no histórico." });
      }
      return;
    }
    const doLead = leadId;
    setBuscandoAnteriores(true);
    const juntadas: Mensagem[] = [];
    let antesDe = maisAntiga.criado_em;
    let mais = true;
    let achada: Mensagem | null = null;
    let falha: string | null = null;
    try {
      for (let rodada = 0; rodada < RODADAS_CITADA && mais && !achada; rodada++) {
        const r = await carregarMensagensAnteriores(doLead, antesDe);
        if ("erro" in r) {
          falha = r.erro;
          break;
        }
        juntadas.unshift(...r.mensagens);
        mais = r.temMais && r.mensagens.length > 0;
        achada = acharCitada(resposta, r.mensagens);
        if (r.mensagens.length > 0) antesDe = r.mensagens[0].criado_em;
        // Passou da data da citada sem achar: ela não está no histórico.
        if (resposta.em && Date.parse(antesDe) <= Date.parse(resposta.em)) break;
      }
    } catch {
      falha = "A conexão não respondeu. Tente de novo.";
    } finally {
      setBuscandoAnteriores(false);
    }
    if (leadAtualRef.current !== doLead) return;
    if (juntadas.length > 0) {
      setAnteriores((a) => [...juntadas, ...a]);
      setTemAnteriores(mais);
    }
    if (achada) {
      mostrarDepoisRef.current = achada.id;
    } else {
      setAvisoLista({
        texto: falha ?? "A mensagem citada não está mais no histórico.",
      });
    }
  };

  // As imagens da conversa, na ordem, para o visualizador andar entre elas.
  const listaRef = useRef(listaMensagens);
  useEffect(() => {
    listaRef.current = listaMensagens;
  });
  const abrirImagem = useCallback((mensagemId: string, url: string) => {
    const itens: ItemVisualizador[] = [];
    let inicial = 0;
    for (const m of listaRef.current) {
      if (m.apagada) continue;
      for (const anexo of m.anexos ?? []) {
        if (anexo.tipo !== "image") continue;
        if (m.id === mensagemId && anexo.url === url) inicial = itens.length;
        itens.push({
          url: anexo.url,
          nome: anexo.nome ?? null,
          legenda: textoVisivel(m),
          autor:
            m.tipo === "mensagem_recebida" ? "Contato" : (m.autor ?? "Equipe"),
          em: m.criado_em,
        });
      }
    }
    if (itens.length > 0) setVisualizador({ itens, inicial });
  }, []);
  // A citação chama a versão mais nova (ela lê a lista do render).
  const irParaCitadaRef = useRef(irParaCitada);
  useEffect(() => {
    irParaCitadaRef.current = irParaCitada;
  });
  const aoTocarCitacao = useCallback((resposta: RespostaCitada) => {
    void irParaCitadaRef.current(resposta);
  }, []);

  // Responder (pelo menu ou arrastando a bolha): a barra aparece acima do
  // campo e o foco vai para ele; no toque, o teclado abre, como no app.
  const responder = useCallback((m: Mensagem) => {
    setRespondendoA(m);
    textareaRef.current?.focus({ preventScroll: true });
  }, []);
  const fecharAcoes = useCallback(() => setAlvoAcoes(null), []);
  // A citada como está agora na lista (reação, apagada): a barra lê dela.
  const citadaNaTela = respondendoA
    ? (listaMensagens.find((m) => m.id === respondendoA.id) ?? respondendoA)
    : null;
  // A citada foi apagada (pela equipe ou pelo contato) enquanto a resposta
  // era escrita: a barra fecha e avisa. Aberta, ela mostrava o texto que
  // sumiu da conversa, e o envio saía sem citação, calado (lerCitada
  // descarta a apagada). Ajuste durante o render, como na troca de conversa.
  if (citadaNaTela?.apagada) {
    setRespondendoA(null);
    setAvisoLista({ texto: "A mensagem que você respondia foi apagada." });
  }
  // A citação só aparece para o contato no WhatsApp, citando wamid. Na nota
  // ela é da equipe de qualquer jeito.
  const citacaoSoNaEquipe =
    citadaNaTela !== null &&
    modo === "responder" &&
    !citacaoChegaAoContato(citadaNaTela, canal);

  /**
   * O envio do compositor. Sem `audio`: o texto e os anexos da caixa. Com
   * ele: só o áudio gravado, que não mexe no que está escrito nem nos
   * anexos da caixa.
   */
  const enviar = async (formData: FormData, audio: File | null) => {
    // Anexos da pronta em voo: enviar agora mandaria o texto sem eles.
    if (baixandoPronta && !audio) return;
    if (enviandoRef.current) return;
    enviandoRef.current = true;
    const resolver =
      !audio && resolverAposEnvioRef.current && modo === "responder";
    resolverAposEnvioRef.current = false;
    // Daqui ao desfecho a fila segura o que desmontaria a Janela.
    vooRef.current.leadId = leadId;
    aoEnvioEmVoo?.(leadId, true);
    // A action saiu: quem solta a conversa é o desfecho dela (efeito do
    // estado). Antes disso (upload que falhou), solta aqui.
    let despachado = false;
    try {
      // Envio novo zera os avisos da rodada anterior.
      setErroEnvio(null);
      setAvisoEnvio(null);
      setAvisoArquivo(null);
      setErroIa(null);
      setOfertaResolver(null);
      if (audio) formData.set("texto", "");
      const textoEnvio = String(formData.get("texto") ?? "").trim();
      if (resolver) formData.set("resolver", "1");
      // A citada sai do estado, não do campo: é o que a barra mostra agora.
      // Vale para o texto, para os anexos e para o áudio.
      const citada = respondendoA;
      if (citada) formData.set("responder_a", citada.id);
      else formData.delete("responder_a");
      // Nota privada não leva anexo: eles ficam na caixa para a resposta.
      // No WhatsApp, o anexo que leva a legenda vai na frente.
      const itens: ItemAnexo[] =
        modo !== "responder"
          ? []
          : audio
            ? [novoItem(audio, false)]
            : ordemDoEnvio(anexos, canal, textoEnvio.length > 0);

      if (modo === "responder" && (textoEnvio || itens.length > 0)) {
        contadorOtimistaRef.current += 1;
        adicionarOtimista({
          mensagem: {
            id: `otimista-${contadorOtimistaRef.current}`,
            tipo: "mensagem_enviada",
            conteudo: textoEnvio || (audio ? "[áudio]" : "[anexo]"),
            criado_em: new Date().toISOString(),
            autor: null,
            pendente: true,
            respostaA: citada ? retratoDaMensagem(citada, nomeContato) : null,
          },
          idsAntes: new Set(baseMensagens.map((m) => m.id)),
          texto: textoEnvio,
          primeiroAnexo: itens[0]?.arquivo.name ?? null,
        });
        pertoDoFimRef.current = true; // envio próprio sempre desce a tela
      }

      // O arquivo NÃO viaja no corpo da requisição (a Vercel corta em ~4,5
      // MB): sobe direto do navegador ao Storage por URL assinada, e a
      // action recebe só as referências.
      if (itens.length > 0) {
        const remotos: AnexoRemotoEnvio[] = [];
        const storage = criarClienteNavegador().storage.from("midia-whatsapp");
        // Em paralelo: cinco anexos custam o tempo do mais lento.
        type ResultadoUpload =
          | { erro: string }
          | { erro?: undefined; remoto: AnexoRemotoEnvio };
        const resultados: ResultadoUpload[] = await Promise.all(
          itens.map(async ({ arquivo, documento }): Promise<ResultadoUpload> => {
            try {
              const preparo = await prepararUploadAnexo(arquivo.name);
              if (preparo.erro || !preparo.caminho || !preparo.token) {
                return { erro: preparo.erro ?? "O upload não começou." };
              }
              const { error } = await storage.uploadToSignedUrl(
                preparo.caminho,
                preparo.token,
                arquivo,
              );
              if (error) {
                return { erro: `"${arquivo.name}" não subiu: ${error.message}` };
              }
              return {
                remoto: {
                  caminho: preparo.caminho,
                  nome: arquivo.name,
                  tipo: arquivo.type,
                  tamanho: arquivo.size,
                  documento,
                },
              };
            } catch {
              return {
                erro: `"${arquivo.name}" não subiu: a conexão não respondeu.`,
              };
            }
          }),
        );
        for (const resultado of resultados) {
          if (resultado.erro !== undefined) {
            // O áudio que não subiu fica na caixa, para o Enviar tentar
            // de novo; os anexos da caixa nem saíram dela.
            if (audio) setAnexos((atuais) => [...itens, ...atuais].slice(0, MAX_ANEXOS));
            setAvisoArquivo(resultado.erro);
            return;
          }
          remotos.push(resultado.remoto);
        }
        formData.set("anexos_remotos", JSON.stringify(remotos));
      }

      // A caixa limpa no clique, não quando o servidor responder: se o
      // envio falhar, o texto e os anexos voltam (backup).
      setBackupEnvio({ texto: audio ? null : texto, anexos: itens, citada });
      setRespondendoA(null);
      if (!audio) {
        setTexto("");
        if (modo === "responder") setAnexos([]);
        try {
          localStorage.removeItem(chaveRascunho);
        } catch {
          // armazenamento bloqueado
        }
        // Enviado pelo clique, o foco estava no Enviar, que dá lugar ao
        // microfone: ele volta ao campo. Solto no body, a próxima letra
        // viraria atalho do palco (E resolve a conversa).
        const ativo = document.activeElement;
        if (
          !ehToque &&
          ativo !== textareaRef.current &&
          formRef.current?.contains(ativo)
        ) {
          textareaRef.current?.focus({ preventScroll: true });
        }
      }
      // Na transição: depois dos uploads o envio já saiu do contexto do
      // formulário, e o pending da action volta a valer.
      startTransition(() => formAction(formData));
      despachado = true;
    } finally {
      enviandoRef.current = false;
      if (!despachado) soltarVoo();
    }
  };

  const aoEnviar = (formData: FormData) => enviar(formData, null);

  /** O áudio do microfone sai na hora, com a citação da barra. Com outro
   *  envio no ar (subindo arquivos ou ainda no servidor), ele fica na caixa
   *  como anexo, e o Enviar manda quando aquele terminar. Com a janela de
   *  24h fechada no meio da gravação, nada sai: só o aviso. */
  const enviarAudio = (arquivo: File) => {
    const form = formRef.current;
    // Nos dois desvios o microfone sai da barra (dá lugar ao Enviar ou ao
    // template). Com o foco nele, o foco vai ao campo: solto no body, a
    // próxima letra viraria atalho do palco (E resolve a conversa).
    const focarCampo = () => {
      if (!ehToque && formRef.current?.contains(document.activeElement)) {
        textareaRef.current?.focus({ preventScroll: true });
      }
    };
    if (modo === "responder" && !janelaAberta) {
      setAvisoArquivo(
        "A janela de 24h fechou durante a gravação. O áudio não foi enviado.",
      );
      focarCampo();
      return;
    }
    // O backup do envio tem uma vaga só: dois envios no ar ao mesmo tempo
    // trocavam o que volta para a caixa quando um deles falha. O vooRef vale
    // da largada do envio ao desfecho, mesmo antes de o pending aparecer.
    if (
      !form ||
      enviandoRef.current ||
      enviandoAcao ||
      vooRef.current.leadId !== null ||
      modo !== "responder"
    ) {
      adicionarArquivos([arquivo], false);
      setAvisoArquivo("O áudio ficou nos anexos. Use Enviar para mandar.");
      focarCampo();
      return;
    }
    const dados = new FormData(form);
    startTransition(async () => {
      await enviar(dados, arquivo);
    });
  };

  const tituloEnviar = ehToque
    ? modo === "nota"
      ? "Salvar nota privada"
      : "Enviar"
    : modo === "nota"
      ? "Salvar nota (Enter)"
      : "Enviar (Enter) · Enviar e resolver (⌘Enter ou Ctrl+Enter)";

  const listaProntas = (variante: "popover" | "folha") => {
    if (mensagensPadrao === null) {
      return (
        <p className="tipo-corpo p-1.5 text-texto-2">
          As mensagens prontas não carregaram. Recarregue a página.
        </p>
      );
    }
    if (prontas.length === 0) {
      return (
        <p className="tipo-corpo p-1.5 text-texto-2">
          Nenhuma mensagem pronta cadastrada.
          {podeConfigurar ? (
            <>
              {" "}
              <Link
                href="/configuracoes"
                className="font-semibold text-tinta underline underline-offset-2"
              >
                Cadastrar em Configurações
              </Link>
            </>
          ) : null}
        </p>
      );
    }
    if (prontasFiltradas.length === 0) {
      return (
        <p className="tipo-corpo p-1.5 text-texto-2">
          Nenhuma pronta com “{filtro}”.
        </p>
      );
    }
    if (variante === "folha") {
      return (
        <Grupo>
          {prontasFiltradas.map((pronta) => (
            <LinhaGrupo key={pronta.id}>
              <button
                type="button"
                onClick={() => aplicarPronta(pronta)}
                className="flex min-h-[56px] w-full items-center pl-1.5 text-left transition-colors duration-[120ms] hover:bg-realce active:bg-pressionado focus-visible:outline-2 focus-visible:-outline-offset-2 focus-visible:outline-tinta"
              >
                <span className="flex min-w-0 flex-1 items-center gap-1 self-stretch border-t border-fio py-1 pr-1.5 group-first/linha:border-t-0">
                  <span className="min-w-0 flex-1">
                    <span className="tipo-destaque block truncate text-tinta">
                      {pronta.titulo}
                    </span>
                    <span className="tipo-nota block truncate text-texto-2">
                      {pronta.corpo}
                    </span>
                  </span>
                  {(pronta.anexos?.length ?? 0) > 0 ? (
                    <span className="tipo-nota inline-flex shrink-0 items-center gap-0.5 text-texto-2 tabular-nums">
                      <Paperclip size={14} strokeWidth={1.75} aria-hidden />
                      {pronta.anexos!.length}
                      <span className="sr-only"> anexos</span>
                    </span>
                  ) : null}
                </span>
              </button>
            </LinhaGrupo>
          ))}
        </Grupo>
      );
    }
    return (
      <ul
        role="listbox"
        aria-label="Mensagens prontas"
        className="max-h-[280px] overflow-y-auto overscroll-contain p-0.5"
      >
        {prontasFiltradas.map((pronta, i) => (
          <li key={pronta.id} role="option" aria-selected={i === idxAtivo}>
            <button
              type="button"
              tabIndex={-1}
              onClick={() => aplicarPronta(pronta)}
              onMouseEnter={() => setIdxSel(i)}
              className={cn(
                "block w-full rounded-controle px-1 py-1 text-left transition-colors duration-[120ms]",
                i === idxAtivo ? "bg-selecao" : "hover:bg-realce",
              )}
            >
              <span className="flex items-center gap-0.5">
                <span className="tipo-destaque min-w-0 flex-1 truncate text-tinta">
                  {pronta.titulo}
                </span>
                {(pronta.anexos?.length ?? 0) > 0 ? (
                  <span className="tipo-nota inline-flex shrink-0 items-center gap-0.5 text-texto-2 tabular-nums">
                    <Paperclip size={13} strokeWidth={1.75} aria-hidden />
                    {pronta.anexos!.length}
                  </span>
                ) : null}
              </span>
              <span className="tipo-nota block truncate text-texto-2">
                {pronta.corpo}
              </span>
            </button>
          </li>
        ))}
      </ul>
    );
  };

  const motivoSemIa =
    modo === "nota"
      ? "Só na resposta"
      : janelaFechada
        ? direct
          ? "Direct fechado"
          : "Janela fechada"
        : undefined;

  /** As duas portas do Anexar, como no WhatsApp: fotos e vídeos (a galeria
   *  e a câmera no celular) ou documento (qualquer arquivo, que vai como
   *  arquivo e não como foto). */
  const itensAnexar = (menu: boolean) => {
    const variante = menu ? "menu" : "folha";
    return (
      <ItensSecao menu={menu}>
        <ItemSecao menu={menu}>
          <ItemAcao
            variante={variante}
            icone={<ImageIcon size={18} strokeWidth={1.75} />}
            onClick={() => abrirSeletor(false)}
          >
            Fotos e vídeos
          </ItemAcao>
        </ItemSecao>
        <ItemSecao menu={menu}>
          <ItemAcao
            variante={variante}
            icone={<FileIcon size={18} strokeWidth={1.75} />}
            onClick={() => abrirSeletor(true)}
          >
            Documento
          </ItemAcao>
        </ItemSecao>
      </ItensSecao>
    );
  };

  /** O que o ⋯ do compositor oferece, no menu (tablet para cima) ou na
   *  folha (celular). */
  const itensMais = (menu: boolean) => {
    const variante = menu ? "menu" : "folha";
    return (
      <ItensSecao menu={menu}>
        <ItemSecao menu={menu}>
          <ItemAcao
            variante={variante}
            icone={<PenLine size={18} strokeWidth={1.75} />}
            disabled={motivoSemIa !== undefined || iaOcupada !== null}
            detalhe={motivoSemIa}
            onClick={() => {
              setMaisAberto(false);
              pedirSugestao();
            }}
          >
            Sugerir resposta
          </ItemAcao>
        </ItemSecao>
        <ItemSecao menu={menu}>
          <ItemAcao
            variante={variante}
            icone={<SpellCheck size={18} strokeWidth={1.75} />}
            disabled={texto.trim().length === 0 || iaOcupada !== null}
            detalhe={texto.trim().length === 0 ? "Caixa vazia" : undefined}
            onClick={() => {
              setMaisAberto(false);
              pedirCorrecao();
            }}
          >
            Corrigir ortografia
          </ItemAcao>
        </ItemSecao>
        {oferecerTemplates && !janelaFechada ? (
          <>
            {menu ? (
              <div role="separator" className="my-0.5 border-t border-fio" />
            ) : null}
            <ItemSecao menu={menu}>
              <ItemAcao
                variante={variante}
                icone={<FileText size={18} strokeWidth={1.75} />}
                onClick={() => {
                  setMaisAberto(false);
                  setTemplateAberto(true);
                }}
              >
                Enviar template
              </ItemAcao>
            </ItemSecao>
          </>
        ) : null}
      </ItensSecao>
    );
  };

  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <div className="relative min-h-0 flex-1">
        {/* O histórico recebe o foco (Tab): as setas andam entre as
            mensagens e Enter abre as ações (gestos-bolha.tsx). A linha em
            cena fica marcada (data-acoes); no toque, a bolha não seleciona
            texto nem abre o menu do sistema, e só arrasta na horizontal
            (o arrasto responde; a rolagem e a pinça que amplia seguem com
            o navegador). */}
        <div
          ref={caixaRef}
          onScroll={aoRolar}
          tabIndex={0}
          role="region"
          aria-label="Histórico da conversa"
          aria-describedby={`dica-historico-${leadId}`}
          className="flex h-full flex-col overflow-x-hidden overflow-y-auto overscroll-contain px-2 pt-0.5 pb-2 focus-visible:outline-offset-[-2px] md:px-3 [&_[data-acoes]]:bg-selecao [&_div[data-msg]]:[touch-action:pan-y_pinch-zoom] [&_div[data-msg]:focus-visible]:outline-offset-[-2px] pointer-coarse:[&_div[data-msg]]:select-none pointer-coarse:[&_div[data-msg]_*]:[-webkit-touch-callout:none]"
        >
          <p id={`dica-historico-${leadId}`} className="sr-only">
            Setas para cima e para baixo andam entre as mensagens; Enter abre
            as ações da mensagem.
          </p>
          {/* Só aparece quando a conversa encheu o primeiro lote. */}
          {temAnteriores && listaMensagens.length >= 200 ? (
            <Button
              type="button"
              variant="secondary"
              size="sm"
              disabled={buscandoAnteriores}
              carregando={buscandoAnteriores}
              onClick={() => void carregarAnteriores()}
              className="mt-1 self-center"
            >
              {buscandoAnteriores ? "Carregando…" : "Mensagens anteriores"}
            </Button>
          ) : null}

          {listaMensagens.length === 0 ? (
            <p className="tipo-corpo m-auto max-w-[36ch] text-center text-texto-2">
              Nenhuma mensagem com este contato ainda.
            </p>
          ) : (
            <div ref={conteudoRef} className="relative">
              <Bolhas
                mensagens={listaMensagens}
                hojeChave={hojeNaTela}
                ontemChave={ontemNaTela}
                marcaNaoLidas={marcaNaoLidas}
                destaqueId={destaqueId}
                meuId={eu?.id ?? null}
                aoAbrirImagem={abrirImagem}
                aoIrParaCitada={aoTocarCitacao}
              />
              <CamadaDaBolha
                caixaRef={caixaRef}
                conteudoRef={conteudoRef}
                mensagens={listaMensagens}
                podeResponder={temConversa && eu !== null && !eu.leitura}
                aoAbrir={setAlvoAcoes}
                aoResponder={responder}
              />
            </div>
          )}
        </div>

        {avisoLista ? (
          <div
            role="status"
            className={cn(
              "tipo-nota absolute inset-x-2 mx-auto flex w-fit max-w-[calc(100%-80px)] items-center gap-1.5 rounded-controle border border-fio bg-flutuante px-1.5 py-1 text-tinta shadow-lg motion-safe:transition-[bottom] motion-safe:duration-[180ms] md:inset-x-3",
              // Com a seta para o fim à vista, o aviso sobe por cima dela: no
              // celular de 375px a seta cobria o fim do texto.
              setaParaOFim ? "bottom-8" : "bottom-1.5",
            )}
          >
            <span className="min-w-0">{avisoLista.texto}</span>
            {avisoLista.acao ? (
              <button
                type="button"
                onClick={() => {
                  const acao = avisoLista.acao;
                  setAvisoLista(null);
                  acao?.fazer();
                }}
                className="relative shrink-0 rounded-celula font-semibold text-tinta underline underline-offset-2 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-tinta pointer-coarse:after:absolute pointer-coarse:after:-inset-[12px]"
              >
                {avisoLista.acao.rotulo}
              </button>
            ) : null}
          </div>
        ) : null}

        {/* A seta para o fim, como no WhatsApp: aparece quando a pessoa
            sobe, com quantas chegaram enquanto ela lia lá em cima. */}
        {setaParaOFim ? (
          <button
            type="button"
            onClick={irParaFim}
            aria-label={
              novasAbaixo > 0
                ? `Ir para o fim: ${
                    novasAbaixo === 1
                      ? "1 mensagem nova"
                      : `${novasAbaixo.toLocaleString("pt-BR")} mensagens novas`
                  }`
                : "Ir para o fim da conversa"
            }
            title="Ir para o fim"
            className="absolute right-2 bottom-1.5 inline-flex h-[40px] w-[40px] animate-entrada items-center justify-center rounded-controle border border-fio bg-flutuante text-tinta shadow-lg transition-colors duration-[120ms] hover:bg-realce focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-tinta pointer-coarse:h-[44px] pointer-coarse:w-[44px] md:right-3"
          >
            <ArrowDown size={20} strokeWidth={1.75} aria-hidden />
            {novasAbaixo > 0 ? (
              <span
                aria-hidden
                className="tipo-legenda absolute -top-[10px] -left-[10px] inline-flex h-[20px] min-w-[20px] items-center justify-center rounded-full bg-tinta px-[5px] font-semibold text-fundo tabular-nums"
              >
                {novasAbaixo > 99 ? "99+" : novasAbaixo.toLocaleString("pt-BR")}
              </span>
            ) : null}
          </button>
        ) : null}
      </div>

      {visualizador ? (
        <Visualizador
          itens={visualizador.itens}
          inicial={visualizador.inicial}
          aoFechar={() => setVisualizador(null)}
        />
      ) : null}

      <PaineisDaMensagem
        alvo={alvoAcoes}
        aoFechar={fecharAcoes}
        leadId={leadId}
        eu={eu}
        nomeContato={nomeContato}
        mensagens={listaMensagens}
        temConversa={temConversa}
        aoResponder={responder}
        aoAvisar={setAvisoLista}
      />

      {somenteLeitura ? (
        <div className="shrink-0 border-t border-fio bg-fundo px-2 pt-1 pb-[max(12px,env(safe-area-inset-bottom))] md:px-3 md:pb-1.5">
          {temConversa ? (
            <div className="pb-0.5">
              <StatusJanela
                restanteInicialMs={restanteJanela}
                vencida={janelaVenceu}
                canal={canal}
                aceitaTemplate={aceitaTemplate}
              />
            </div>
          ) : null}
          <Estado tom="neutro">Perfil de compliance: só leitura.</Estado>
        </div>
      ) : temConversa ? (
        <form
          ref={formRef}
          action={aoEnviar}
          // Com o teclado aberto o pé encosta nele: a área segura de baixo
          // fica atrás do teclado e sobraria como faixa vazia.
          className="relative shrink-0 border-t border-fio bg-fundo px-2 pt-1 pb-[max(8px,env(safe-area-inset-bottom))] md:px-3 md:pb-1.5 [html[data-teclado=aberto]_&]:pb-1"
        >
          <input type="hidden" name="lead_id" value={leadId} />
          <input type="hidden" name="modo" value={modo} />
          <input type="hidden" name="assinar" value={assinar ? "1" : "0"} />
          {/* Os seletores do Anexar, sem nome: os arquivos sobem direto ao
              Storage e não viajam no formulário. O Documento aceita
              qualquer arquivo; a prévia diz como cada um vai sair. */}
          <input
            ref={inputFotosRef}
            type="file"
            accept="image/*,video/*"
            multiple
            tabIndex={-1}
            aria-hidden
            className="hidden"
            onChange={(e) => aoEscolher(e, false)}
          />
          <input
            ref={inputDocumentoRef}
            type="file"
            multiple
            tabIndex={-1}
            aria-hidden
            className="hidden"
            onChange={(e) => aoEscolher(e, true)}
          />

          {ofertaResolver && ofertaResolver === leadId ? (
            <div className="pb-1">
              <Button
                type="button"
                variant="secondary"
                size="lg"
                className="w-full"
                icone={<Check size={20} strokeWidth={2} aria-hidden />}
                onClick={() => {
                  setOfertaResolver(null);
                  aoResolverESeguir?.(leadId);
                }}
              >
                Resolver e seguir
              </Button>
            </div>
          ) : null}

          {/* A linha de estado: a janela de 24h (ou a nota) e a assinatura,
              que continua aqui, à mão. */}
          <div className="flex min-h-[28px] items-center gap-1 pb-0.5">
            <div className="min-w-0 flex-1">
              {modo === "nota" ? (
                <Estado tom="atencao">
                  Nota privada: só a equipe vê.
                </Estado>
              ) : (
                <StatusJanela
                  restanteInicialMs={restanteJanela}
                  vencida={janelaVenceu}
                  canal={canal}
                  aceitaTemplate={aceitaTemplate}
                />
              )}
            </div>
            {/* Com a janela fechada não sai texto livre: a assinatura não tem
                o que assinar, e o aviso da janela fica com a linha inteira. */}
            {!janelaFechada ? (
              <label className="tipo-nota relative inline-flex shrink-0 cursor-pointer items-center gap-0.5 text-texto-2 select-none pointer-coarse:after:absolute pointer-coarse:after:-inset-y-[10px] pointer-coarse:after:inset-x-0">
                <input
                  type="checkbox"
                  checked={assinar}
                  onChange={(e) => assinaturaStore.gravar(e.target.checked)}
                  className="h-[16px] w-[16px]"
                />
                <span className="md:hidden">Assinar</span>
                <span className="hidden md:inline">Assinar com meu nome</span>
              </label>
            ) : null}
          </div>

          {modo === "responder" && marketingBloqueado ? (
            <div className="pb-0.5">
              <Estado tom="erro">
                Bloqueou marketing no WhatsApp. Use template de utilidade ou
                responda dentro da janela.
              </Estado>
            </div>
          ) : null}

          {painelProntas && !prontasEmFolha ? (
            <div
              data-popover="prontas"
              className="absolute bottom-[calc(100%+4px)] left-2 z-30 w-[360px] max-w-[calc(100%-32px)] animate-entrada rounded-painel border border-fio bg-flutuante shadow-lg md:left-3"
              onKeyDown={(e) => {
                // Esc fecha com o foco em qualquer ponto do painel e não
                // segue para o palco.
                if (e.key === "Escape") {
                  e.preventDefault();
                  e.stopPropagation();
                  fecharProntas();
                }
              }}
            >
              <div className="flex items-center gap-1 border-b border-fio py-0.5 pr-0.5 pl-1.5">
                <p className="tipo-nota min-w-0 flex-1 font-semibold text-texto-2">
                  Mensagens prontas
                </p>
                <button
                  type="button"
                  onClick={fecharProntas}
                  aria-label="Fechar as mensagens prontas"
                  title="Fechar (Esc)"
                  className={cn(BOTAO_ICONE, "h-[32px] w-[32px] pointer-coarse:h-[44px] pointer-coarse:w-[44px]")}
                >
                  <X size={16} strokeWidth={1.75} aria-hidden />
                </button>
              </div>
              {prontasAbertas && !slashAtivo ? (
                <div className="border-b border-fio p-0.5">
                  <label htmlFor="busca-prontas" className="sr-only">
                    Buscar mensagem pronta
                  </label>
                  <input
                    id="busca-prontas"
                    autoFocus
                    value={busca}
                    autoComplete="off"
                    onChange={(e) => {
                      setBusca(e.target.value);
                      setIdxSel(0);
                    }}
                    onKeyDown={(e) => {
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
                    placeholder="Buscar pronta"
                    className={cn(CAMPO, "h-[36px] w-full")}
                  />
                </div>
              ) : null}
              {listaProntas("popover")}
            </div>
          ) : null}

          <Folha
            aberta={prontasEmFolha}
            aoFechar={fecharProntas}
            titulo="Mensagens prontas"
            retorno={gatilhoProntasRef}
          >
            <label className="relative mt-0.5 mb-1 block">
              <span className="sr-only">Buscar mensagem pronta</span>
              <Search
                size={18}
                strokeWidth={1.75}
                aria-hidden
                className="pointer-events-none absolute top-1/2 left-1.5 -translate-y-1/2 text-texto-3"
              />
              <input
                type="search"
                value={busca}
                autoComplete="off"
                enterKeyHint="search"
                onChange={(e) => setBusca(e.target.value)}
                placeholder="Buscar pronta"
                className={cn(CAMPO, "w-full bg-cartao pl-4")}
              />
            </label>
            {listaProntas("folha")}
          </Folha>

          {anexos.length > 0 && modo === "responder" ? (
            <PreviaAnexos
              itens={anexos}
              canal={canal}
              textoLongo={textoLongo}
              toque={ehToque}
              aoTirar={tirarAnexo}
              aoTirarTodos={tirarTodos}
            />
          ) : null}

          {citadaNaTela ? (
            <BarraResposta
              citada={citadaNaTela}
              nomeContato={nomeContato}
              eu={eu}
              soNaEquipe={citacaoSoNaEquipe}
              aoIr={() => {
                if (!mostrarMensagem(citadaNaTela.id)) {
                  setAvisoLista({ texto: "A mensagem citada não está mais na tela." });
                }
              }}
              aoCancelar={() => {
                setRespondendoA(null);
                if (!ehToque) textareaRef.current?.focus();
              }}
            />
          ) : null}

          <div
            className={cn(
              "rounded-controle border bg-fundo transition-colors duration-[120ms] focus-within:outline-2 focus-within:outline-offset-1 focus-within:outline-tinta",
              modo === "nota" ? "border-atencao" : "border-fio-forte",
            )}
          >
            <label htmlFor={`texto-${leadId}`} className="sr-only">
              {modo === "nota" ? "Nota privada" : "Mensagem para o contato"}
            </label>
            <textarea
              id={`texto-${leadId}`}
              name="texto"
              rows={1}
              // O corretor nativo depende do navegador saber o idioma do
              // campo: sem isso, quem usa dicionário em inglês não via o
              // sublinhado.
              lang="pt-BR"
              spellCheck
              autoCorrect="on"
              autoCapitalize="sentences"
              enterKeyHint={ehToque ? "enter" : "send"}
              ref={textareaRef}
              value={texto}
              onChange={(e) => atualizarTexto(e.target.value)}
              onKeyDown={(e) => {
                if (painelProntas && !prontasEmFolha) {
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
                    // Painel aberto: Enter nunca envia; sem resultado, só
                    // engole (antes mandava o "/busca" cru para o cliente).
                    e.preventDefault();
                    if (prontasFiltradas.length > 0) {
                      aplicarPronta(prontasFiltradas[idxAtivo]);
                    }
                    return;
                  }
                  if (e.key === "Escape") {
                    e.preventDefault();
                    e.stopPropagation();
                    fecharProntas();
                    return;
                  }
                }
                if (e.key === "Escape") {
                  if (e.defaultPrevented) return;
                  // Respondendo: o primeiro Esc desiste da citação.
                  if (respondendoA) {
                    e.preventDefault();
                    setRespondendoA(null);
                    return;
                  }
                  // Sem painel aberto, o Esc devolve o foco para a fila:
                  // dali, E resolve, H adia e J anda. O rascunho fica salvo.
                  if (!aoSairDoCompositor) return;
                  e.preventDefault();
                  aoSairDoCompositor();
                  return;
                }
                if (e.key !== "Enter" || ehToque) return;
                // ⌘Enter (Ctrl+Enter): envia e resolve, e a fila segue.
                if (e.metaKey || e.ctrlKey) {
                  e.preventDefault();
                  if (!podeEnviar || enviandoAcao || enviandoRef.current) return;
                  resolverAposEnvioRef.current = modo === "responder";
                  formRef.current?.requestSubmit();
                  return;
                }
                // Enter envia; Shift+Enter quebra a linha. No teclado do
                // celular não há Shift+Enter: lá o Enter quebra e o envio é
                // pelo botão. Envio pendente segura o Enter.
                if (e.shiftKey) return;
                e.preventDefault();
                if (podeEnviar && !enviandoAcao && !enviandoRef.current) {
                  formRef.current?.requestSubmit();
                }
              }}
              placeholder={
                modo === "nota"
                  ? "Nota para a equipe"
                  : janelaFechada
                    ? oferecerTemplates
                      ? "Janela fechada: envie um template ou escreva uma nota"
                      : "Janela fechada: só nota para a equipe"
                    : anexos.length > 0
                      ? "Legenda"
                      : ehToque
                        ? "Mensagem"
                        : 'Mensagem ("/" abre as prontas)'
              }
              className="tipo-corpo block max-h-[132px] min-h-[42px] w-full resize-none overflow-y-auto bg-transparent px-1.5 py-[10px] text-tinta placeholder:text-texto-3 focus:outline-none md:max-h-[240px] md:min-h-[60px]"
            />
          </div>

          <div className="mt-1 flex items-center gap-0.5 pointer-coarse:gap-1">
            {/* Gravando, a barra é do microfone: o relógio, o Cancelar e o
                Enviar (ou o arraste para cancelar, no toque). */}
            {!gravandoAudio ? (
              <>
                <button
                  type="button"
                  aria-pressed={modo === "nota"}
                  onClick={() => {
                    setModo((m) => (m === "nota" ? "responder" : "nota"));
                    if (!ehToque) textareaRef.current?.focus();
                  }}
                  title={
                    modo === "nota"
                      ? "Voltar a responder o contato"
                      : "Nota privada: só a equipe vê"
                  }
                  // Ligada é estado (seleção), não destaque: o destaque na tinta
                  // é do "Salvar nota", logo ao lado.
                  className={cn(
                    "tipo-nota inline-flex h-[40px] min-w-[40px] shrink-0 items-center justify-center gap-0.5 rounded-controle px-1 font-semibold transition-colors duration-[120ms] focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-tinta pointer-coarse:h-[44px] pointer-coarse:min-w-[44px] motion-safe:active:scale-[.97]",
                    modo === "nota"
                      ? "bg-selecao text-tinta hover:bg-pressionado"
                      : "text-texto-2 hover:bg-realce hover:text-tinta",
                  )}
                >
                  <NotebookPen size={19} strokeWidth={1.75} aria-hidden />
                  <span className="hidden md:inline">Nota</span>
                  <span className="sr-only md:hidden">Nota privada</span>
                </button>

                <button
                  ref={gatilhoProntasRef}
                  type="button"
                  aria-label='Mensagens prontas (atalho "/")'
                  aria-expanded={painelProntas}
                  aria-haspopup={ehToque ? "dialog" : "listbox"}
                  title='Mensagens prontas (atalho "/")'
                  onClick={() => {
                    setMaisAberto(false);
                    setAnexarAberto(false);
                    if (painelProntas) fecharProntas();
                    else {
                      setProntasAbertas(true);
                      setIdxSel(0);
                    }
                  }}
                  className={cn(BOTAO_ICONE, painelProntas && "bg-realce text-tinta")}
                >
                  <Zap size={20} strokeWidth={1.75} aria-hidden />
                </button>

                {/* Anexar só vale na resposta com a janela aberta: fora disso
                    sai da barra (desativado, empurrava o template para fora da
                    tela no celular). */}
                {modo === "responder" && !janelaFechada ? (
                  <div className="relative">
                    <button
                      ref={gatilhoAnexarRef}
                      type="button"
                      aria-label="Anexar"
                      title="Anexar fotos, vídeos ou documento (até 5, de 16 MB cada)"
                      aria-haspopup={telaMd ? "menu" : "dialog"}
                      aria-expanded={anexarAberto}
                      onClick={() => {
                        if (painelProntas) fecharProntas();
                        setMaisAberto(false);
                        setAnexarAberto((v) => !v);
                      }}
                      className={cn(BOTAO_ICONE, anexarAberto && "bg-realce text-tinta")}
                    >
                      <Paperclip size={20} strokeWidth={1.75} aria-hidden />
                    </button>
                    {telaMd ? (
                      <MenuSuspenso
                        aberto={anexarAberto}
                        aoFechar={() => setAnexarAberto(false)}
                        gatilho={gatilhoAnexarRef}
                        rotulo="Anexar"
                        direcao="cima"
                        alinhar="inicio"
                        className="w-[240px]"
                      >
                        {itensAnexar(true)}
                      </MenuSuspenso>
                    ) : (
                      <Folha
                        aberta={anexarAberto}
                        aoFechar={() => setAnexarAberto(false)}
                        titulo="Anexar"
                        retorno={gatilhoAnexarRef}
                      >
                        {itensAnexar(false)}
                      </Folha>
                    )}
                  </div>
                ) : null}

                <div className="relative">
                  <button
                    ref={gatilhoMaisRef}
                    type="button"
                    aria-label="IA e template"
                    title="IA e template"
                    aria-haspopup={telaMd ? "menu" : "dialog"}
                    aria-expanded={maisAberto}
                    onClick={() => {
                      if (painelProntas) fecharProntas();
                      setAnexarAberto(false);
                      setMaisAberto((v) => !v);
                    }}
                    className={cn(BOTAO_ICONE, maisAberto && "bg-realce text-tinta")}
                  >
                    {iaOcupada !== null ? (
                      <Spinner tamanho={18} rotulo="A IA está escrevendo" />
                    ) : (
                      <MoreHorizontal size={20} strokeWidth={1.75} aria-hidden />
                    )}
                  </button>
                  {telaMd ? (
                    <MenuSuspenso
                      aberto={maisAberto}
                      aoFechar={() => setMaisAberto(false)}
                      gatilho={gatilhoMaisRef}
                      rotulo="IA e template"
                      direcao="cima"
                      alinhar="inicio"
                      className="w-[300px]"
                    >
                      {itensMais(true)}
                    </MenuSuspenso>
                  ) : (
                    <Folha
                      aberta={maisAberto}
                      aoFechar={() => setMaisAberto(false)}
                      titulo="IA e template"
                      retorno={gatilhoMaisRef}
                    >
                      {itensMais(false)}
                    </Folha>
                  )}
                </div>

                {/* A IA demora alguns segundos e escreve por cima da caixa ao
                    voltar: dá para desistir enquanto ela trabalha. */}
                {iaOcupada !== null ? (
                  <button
                    type="button"
                    onClick={cancelarIa}
                    className="tipo-nota inline-flex h-[40px] shrink-0 items-center rounded-controle px-1 font-semibold text-texto-2 transition-colors duration-[120ms] hover:bg-realce hover:text-tinta focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-tinta pointer-coarse:h-[44px]"
                  >
                    Cancelar
                  </button>
                ) : null}
              </>
            ) : null}

            <span
              className={cn(
                "ml-auto flex shrink-0 items-center gap-1",
                gravandoAudio && "ml-0 min-w-0 flex-1",
              )}
            >
              {/* Janela fechada no WhatsApp: o template assume o lugar do
                  Enviar como a ação principal. No Direct não há template, e
                  o Enviar desativado continua ancorando o lugar. Com o
                  campo vazio, o microfone fica no lugar do Enviar. A chave
                  é a conversa: trocar de conversa desliga o microfone e
                  joga fora o que gravava. A janela que fecha no meio da
                  gravação espera o gravador terminar: desmontado, ele
                  jogava o áudio fora sem aviso. */}
              {janelaFechada && oferecerTemplates && !gravandoAudio ? (
                <BotaoTemplates
                  key="template-principal"
                  leadId={leadId}
                  nomeContato={nomeContato}
                  templates={listaTemplates}
                  principal
                  aoEnviar={aoTemplateEnviado}
                  aoEnvioEmVoo={aoTemplateEmVoo}
                />
              ) : mostrarMicrofone ? (
                <GravadorAudio
                  key={`gravador-${leadId}`}
                  canal={canal}
                  toque={ehToque}
                  aoGravado={enviarAudio}
                  aoErro={setAvisoArquivo}
                  aoOcupar={setGravandoAudio}
                />
              ) : (
                <BotaoEnviar
                  desabilitado={!podeEnviar}
                  nota={modo === "nota"}
                  ocupado={enviandoAcao}
                  tituloAtalho={tituloEnviar}
                />
              )}
            </span>
          </div>

          {erroCompositor ? (
            <p role="alert" className="tipo-nota pt-1 text-erro">
              {erroCompositor}
            </p>
          ) : avisoEnvio ? (
            <p role="status" className="tipo-nota pt-1 text-atencao">
              {avisoEnvio}
            </p>
          ) : null}

          <DialogoTemplate
            aberto={templateAberto}
            aoFechar={() => setTemplateAberto(false)}
            leadId={leadId}
            nomeContato={nomeContato}
            templates={listaTemplates}
            aoEnviar={aoTemplateEnviado}
            aoEnvioEmVoo={aoTemplateEmVoo}
            retorno={gatilhoMaisRef}
          />
        </form>
      ) : (
        <div className="shrink-0 border-t border-fio bg-fundo px-2 pt-1.5 pb-[max(12px,env(safe-area-inset-bottom))] md:px-3">
          <Estado tom="atencao">
            {aceitaTemplate
              ? "Ainda não há conversa. O primeiro contato é um template aprovado."
              : direct
                ? "O contato só tem o Direct e ainda não escreveu. A conversa começa quando ele mandar mensagem."
                : "Sem telefone nem Direct. Cadastre o telefone na ficha para enviar template."}
          </Estado>
          {avisoTemplates ? (
            <p role="alert" className="tipo-nota pt-1 text-erro">
              {avisoTemplates}
            </p>
          ) : null}
          {oferecerTemplates ? (
            <div className="flex justify-end pt-1">
              <BotaoTemplates
                leadId={leadId}
                nomeContato={nomeContato}
                templates={listaTemplates}
                principal
                aoEnviar={aoTemplateEnviado}
                aoEnvioEmVoo={aoTemplateEmVoo}
              />
            </div>
          ) : null}
        </div>
      )}
    </div>
  );
});
