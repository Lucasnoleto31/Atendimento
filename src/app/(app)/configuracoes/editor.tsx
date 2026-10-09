"use client";

import {
  createContext,
  startTransition,
  useActionState,
  useCallback,
  useContext,
  useEffect,
  useId,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
  useSyncExternalStore,
} from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { Check, Plus, X } from "lucide-react";
import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import { BOTAO_ICONE } from "@/components/app/form-styles";
import {
  useComandosDaTela,
  type ComandoPaleta,
} from "@/components/app/paleta-global";
import { PARAM_ABRIR, PARAMS_DO_EDITOR } from "../admin/rotas";
import type { ResultadoAcao } from "./resultado";
import { LINHA_ACAO, MIOLO_LINHA, Seta, TrilhoInterruptor } from "./ui";

/*
 * O editor da Administração e de Minha conta (kit, blocos 7 e 8): a linha da
 * lista mostra o estado e abre o editor; editar, ligar e excluir moram nele,
 * a ação destrutiva por último e separada.
 *
 * - Celular e tablet: folha presa no pé, com pegador, arrasto para fechar,
 *   X de 44px e Esc. Fica em cima do teclado (--teclado, medido pela casca)
 *   e esconde a barra de abas enquanto aberta.
 * - Desktop (lg): painel ao lado da lista, preso no alto ao rolar. Não é
 *   modal: tocar em outra linha troca o que está aberto.
 * - O editor aberto mora na URL (?abrir=<chave>), com uma entrada no
 *   histórico: o voltar do sistema (a borda do iPhone, o botão do Android)
 *   fecha a folha em vez de sair da página, e outra tela abre um editor
 *   direto pelo endereço (também um link para a própria tela: o ?abrir= é
 *   acompanhado, não só lido na montagem). Quem chegou com ?voltar= e grava
 *   volta sozinho para a origem, saindo das duas entradas da subpágina.
 * - Fechar pergunta antes de perder alguma coisa: o que foi digitado e não
 *   gravado ("Descartar o que foi escrito?") e o que some ao fechar (a senha
 *   temporária, pela trava). Vale para o X, o Esc, o fundo, o arrasto, outra
 *   linha, os links da lista e os de dentro do editor (a linha de
 *   Privacidade da pessoa, "Contatos com ela") e o voltar do sistema. O menu
 *   do app e a paleta não passam pela pergunta.
 *
 * Os formulários gravam por server action devolvendo { ok, erro }, sem
 * redirecionar: deu certo, sai o aviso curto e o editor fecha; deu errado, o
 * erro aparece acima do botão com tudo o que foi digitado (o reset automático
 * do React 19 só vale para <form action>, e aqui o envio sai pelo onSubmit).
 */

const EASE_PADRAO = "cubic-bezier(0.32, 0.72, 0, 1)";
const CONSULTA_DESKTOP = "(min-width: 64rem)";
const ARRASTO_FECHA_PX = 120;
const ARRASTO_VELOCIDADE = 0.5;

/** A pergunta antes de perder o que foi digitado. */
const DESCARTAR = "Descartar o que foi escrito?";

/* ── Aviso curto depois de gravar ─────────────────────────────────────── */

type Aviso = { texto: string; tom: "ok" | "erro"; id: number };

let avisoAtual: Aviso | null = null;
let ultimoAviso = 0;
const ouvintesAviso = new Set<() => void>();

/** Mostra o aviso flutuante da tela ("Mensagem salva"). */
export function avisar(texto: string, tom: Aviso["tom"] = "ok") {
  ultimoAviso += 1;
  avisoAtual = { texto, tom, id: ultimoAviso };
  ouvintesAviso.forEach((avisarOuvinte) => avisarOuvinte());
}

function assinarAviso(ouvinte: () => void) {
  ouvintesAviso.add(ouvinte);
  return () => {
    ouvintesAviso.delete(ouvinte);
  };
}

/**
 * O aviso em pílula no pé da tela, acima da barra de abas. A região viva
 * existe sempre (o leitor de tela só anuncia mudança em região que já estava
 * lá); o texto some sozinho depois de alguns segundos.
 */
function AvisoFlutuante() {
  const aviso = useSyncExternalStore(
    assinarAviso,
    () => avisoAtual,
    () => null,
  );
  // O aviso que já estava no ar quando a tela montou (de outra tela) não
  // volta.
  const [vencido, setVencido] = useState(() => avisoAtual?.id ?? 0);

  useEffect(() => {
    if (!aviso) return;
    const prazo = window.setTimeout(
      () => setVencido(aviso.id),
      aviso.tom === "erro" ? 6000 : 3500,
    );
    return () => window.clearTimeout(prazo);
  }, [aviso]);

  const visivel = aviso && aviso.id > vencido ? aviso : null;

  // A altura no celular é a da barra de abas (a mesma conta do --casca-pe do
  // globals.css) mais 16px, escrita por inteiro: o --casca-pe zera enquanto
  // a folha existe (data-sem-abas), e o aviso que sai junto com o fechar
  // aparecia rente ao pé e pulava quando a folha sumia. Com o teclado
  // aberto, sobe junto com ele. A pílula não tem nada para tocar: no celular
  // ela fica em cima da folha, e o toque atravessa para o que está embaixo.
  return (
    <div
      role="status"
      className="pointer-events-none fixed inset-x-0 bottom-[calc(var(--teclado,0px)+64px+max(12px,env(safe-area-inset-bottom))+24px)] z-[60] flex justify-center px-2 lg:bottom-3"
    >
      {visivel ? (
        <p
          key={visivel.id}
          className={cn(
            "tipo-corpo pointer-events-none flex min-h-[44px] max-w-[min(480px,100%)] animate-entrada items-center gap-1 rounded-full px-2 py-1 shadow-lg",
            visivel.tom === "ok"
              ? "bg-tinta text-fundo"
              : "border border-fio bg-flutuante text-erro",
          )}
        >
          {visivel.tom === "ok" ? (
            <Check size={18} strokeWidth={2.25} aria-hidden className="shrink-0" />
          ) : null}
          {visivel.texto}
        </p>
      ) : null}
    </div>
  );
}

/* ── O editor na URL ──────────────────────────────────────────────────── */

/** O endereço de agora sem o editor (o ?voltar= e o resto ficam). */
function urlSemEditor(): string {
  const url = new URL(window.location.href);
  for (const p of PARAMS_DO_EDITOR) url.searchParams.delete(p);
  return url.pathname + url.search + url.hash;
}

/** O endereço de agora com o editor da chave aberto. */
function urlComEditor(chave: string): string {
  const url = new URL(urlSemEditor(), window.location.origin);
  url.searchParams.set(PARAM_ABRIR, chave);
  return url.pathname + url.search + url.hash;
}

/** A chave do editor na URL; "editar" é o nome antigo do parâmetro. */
function editorDaUrl(): string | null {
  const p = new URLSearchParams(window.location.search);
  return p.get(PARAM_ABRIR) ?? p.get("editar");
}

/** A entrada do histórico foi empurrada por este editor (e não pelo Next)? */
function entradaDoEditor(chave: string): boolean {
  const estado = window.history.state as { editorAberto?: unknown } | null;
  return estado?.editorAberto === chave;
}

/** O endereço de agora é o destino (mesmo caminho e mesma query, em
 *  qualquer ordem)? */
function estaEm(destino: string): boolean {
  const alvo = new URL(destino, window.location.origin);
  const agora = new URL(window.location.href);
  if (alvo.pathname !== agora.pathname) return false;
  alvo.searchParams.sort();
  agora.searchParams.sort();
  return alvo.searchParams.toString() === agora.searchParams.toString();
}

/** Quanto esperar o popstate do history.go() antes de concluir que não há
 *  para onde voltar (a aba abriu direto no editor). */
const ESPERA_VOLTA_MS = 600;

/** O link troca de página? mailto:, tel: e a âncora da própria página não
 *  trocam (e não precisam da pergunta antes de sair). */
function saiDaPagina(link: Element): boolean {
  try {
    const url = new URL(link.getAttribute("href") ?? "", window.location.href);
    if (url.protocol !== "http:" && url.protocol !== "https:") return false;
    return !(
      url.hash &&
      url.pathname === window.location.pathname &&
      url.search === window.location.search
    );
  } catch {
    return true;
  }
}

/* ── Mestre e detalhe ─────────────────────────────────────────────────── */

export type Editor = {
  titulo: string;
  conteudo: React.ReactNode;
};

type ContextoEditor = {
  aberto: string | null;
  abrir: (id: string, origem: HTMLElement | null) => void;
  /** Fecha o editor aberto (com a folha descendo, no celular). */
  fechar: () => void;
  /**
   * Gravou: o formulário deixa de contar como "escrito e não gravado" (sem
   * formulário, nenhum conta). Quem grava fora do FormAcao chama isto antes
   * de fechar, senão o fechar perguntaria "Descartar o que foi escrito?".
   */
  gravou: (form?: HTMLFormElement | null) => void;
  /** Gravou e fecha. Aberto pelo endereço com ?voltar=, volta à origem. */
  concluir: () => void;
  /**
   * Trava o editor aberto enquanto há na tela algo que some ao fechar (a
   * senha temporária): fechar pelo X, Esc, fundo, arrasto, voltar do sistema,
   * trocando de linha ou saindo por um link pergunta antes, com este texto.
   * null destrava.
   */
  travar: (motivo: string | null) => void;
};

const Contexto = createContext<ContextoEditor | null>(null);

/** O editor aberto e o jeito de fechá-lo, para quem está dentro dele. */
export function useEditor() {
  return useContext(Contexto);
}

function assinarDesktop(avisarMudanca: () => void) {
  const consulta = window.matchMedia(CONSULTA_DESKTOP);
  consulta.addEventListener("change", avisarMudanca);
  return () => consulta.removeEventListener("change", avisarMudanca);
}

/** Desktop pela consulta de mídia, acompanhando a mudança (janela que
 *  encolhe, tablet que gira), não só a da montagem. */
function useDesktop() {
  return useSyncExternalStore(
    assinarDesktop,
    () => window.matchMedia(CONSULTA_DESKTOP).matches,
    () => false,
  );
}

/** A lista e a posição da linha (o <li>) que tem o elemento. */
function lugarDaLinha(el: HTMLElement | null) {
  const linha = el?.closest("li");
  const lista = linha?.parentElement;
  if (!linha || !lista) return null;
  return { lista, indice: Array.from(lista.children).indexOf(linha) };
}

/** Como o editor está fechando: pelo X (e afins), pelo voltar do sistema
 *  (o histórico já andou) ou porque gravou. */
type ModoFechar = "normal" | "historia" | "gravou";

/**
 * A lista (children) e o editor aberto. `editores` traz o título e o
 * conteúdo de cada um, pela chave que a linha usa ("mensagem:<id>",
 * "etiqueta:nova"). `comandos` vão para a paleta (⌘K ou Ctrl+K) e abrem o
 * editor da chave deles. `voltar`: o ?voltar= da página; quem abriu o editor
 * pelo endereço e grava volta para lá.
 */
export function MestreDetalhe({
  editores,
  comandos,
  grupoComandos,
  voltar = null,
  aoFechar,
  children,
}: {
  editores: Record<string, Editor>;
  comandos?: { id: string; rotulo: string }[];
  /** Título do grupo dos comandos na paleta ("Administração"). */
  grupoComandos?: string;
  voltar?: string | null;
  /** O editor da chave fechou (a tela limpa o texto que veio pela URL). */
  aoFechar?: (chave: string) => void;
  children: React.ReactNode;
}) {
  const router = useRouter();
  const [aberto, setAberto] = useState<string | null>(null);
  const origem = useRef<HTMLElement | null>(null);
  // Onde estava a linha que abriu (a lista e a posição): se ela sumir (item
  // excluído), o foco vai para a que ficou no lugar.
  const lugar = useRef<{ lista: Element; indice: number } | null>(null);
  const lista = useRef<HTMLDivElement>(null);
  const fecharAnimado = useRef<(() => boolean) | null>(null);
  const devolverFoco = useRef(false);
  // O editor aberto depois do último commit (o estado, visto dos efeitos e
  // dos cliques).
  const ultimoAberto = useRef<string | null>(null);
  const trava = useRef<string | null>(null);
  // Os formulários do editor com algo digitado e ainda não gravado.
  const sujos = useRef(new Set<HTMLFormElement>());
  const modoFechar = useRef<ModoFechar>("normal");
  // O histórico: a entrada de agora é deste editor (empurrada por ele)? Um
  // history.back() pedido e ainda não chegado? Um editor esperando por ele?
  // A origem do ?voltar= esperando o history.go(-2) de quem gravou, e o
  // relógio que desiste dele (sem histórico, o go não faz nada).
  const historia = useRef({
    empurrou: false,
    voltaPendente: false,
    empurrarDepois: null as string | null,
    origemPendente: null as string | null,
    reserva: 0,
  });
  // A chave que veio no endereço: gravar nela devolve à origem (?voltar=).
  const abertoPelaUrl = useRef<string | null>(null);
  const editoresRef = useRef(editores);
  const voltarRef = useRef(voltar);
  const aoFecharRef = useRef(aoFechar);
  useEffect(() => {
    editoresRef.current = editores;
    voltarRef.current = voltar;
    aoFecharRef.current = aoFechar;
  });
  const desktopAgora = useDesktop();
  const desktopRef = useRef(desktopAgora);
  useEffect(() => {
    desktopRef.current = desktopAgora;
  }, [desktopAgora]);
  // Travado, o editor fica no modo em que estava (painel ou folha): girar o
  // tablet ou cruzar o lg trocaria a key do Painel, remontaria o formulário
  // e levaria a senha embora sem pergunta.
  const [modoTravado, setModoTravado] = useState<boolean | null>(null);
  const desktop = modoTravado ?? desktopAgora;

  const editor = aberto !== null ? editores[aberto] : undefined;
  // O item do editor aberto sumiu da lista (excluído aqui ou por outra
  // pessoa): o editor fecha junto.
  if (aberto !== null && !editor) setAberto(null);

  /* História: empurra ao abrir, volta ao fechar. */
  const empurrar = useCallback((chave: string) => {
    const h = historia.current;
    // O back de quem acabou de fechar ainda não chegou: empurrar agora
    // deixaria o back andar a partir da entrada nova.
    if (h.voltaPendente) {
      h.empurrarDepois = chave;
      return;
    }
    const estado = { editorAberto: chave };
    // Trocar de editor (o painel do desktop) troca a entrada, não empilha:
    // o voltar fecha o editor, e não passa por cada linha aberta antes.
    if (h.empurrou) window.history.replaceState(estado, "", urlComEditor(chave));
    else window.history.pushState(estado, "", urlComEditor(chave));
    h.empurrou = true;
  }, []);

  const tirarDaHistoria = useCallback(() => {
    const h = historia.current;
    h.empurrarDepois = null;
    if (h.empurrou) {
      h.empurrou = false;
      h.voltaPendente = true;
      window.history.back();
      return;
    }
    if (editorDaUrl() !== null) {
      window.history.replaceState(null, "", urlSemEditor());
    }
  }, []);

  const fecharDeVez = useCallback(() => {
    const chave = ultimoAberto.current;
    const modo = modoFechar.current;
    modoFechar.current = "normal";
    devolverFoco.current = true;
    sujos.current.clear();
    setAberto(null);
    if (chave) aoFecharRef.current?.(chave);

    // Gravou o que veio pelo endereço, com origem: volta para ela, saindo das
    // duas entradas da subpágina (a sem o editor e a com ele, da montagem).
    // Trocar só a do editor deixava [origem, subpágina, origem], e o voltar
    // do sistema na origem levava de novo à Administração. A entrada de
    // baixo costuma ser a própria origem; se não for, ela vira a origem, e
    // sem entrada nenhuma (aba aberta direto aqui) a do editor vira.
    // Fechado de qualquer jeito, o editor deixa de ser "o do endereço".
    const destino = voltarRef.current;
    const veioPelaUrl = chave !== null && chave === abertoPelaUrl.current;
    abertoPelaUrl.current = null;
    if (modo === "gravou" && destino && veioPelaUrl) {
      const h = historia.current;
      h.empurrou = false;
      h.empurrarDepois = null;
      h.voltaPendente = true;
      h.origemPendente = destino;
      window.clearTimeout(h.reserva);
      h.reserva = window.setTimeout(() => {
        if (h.origemPendente !== destino) return;
        h.voltaPendente = false;
        h.origemPendente = null;
        router.replace(destino);
      }, ESPERA_VOLTA_MS);
      window.history.go(-2);
      return;
    }
    if (modo !== "historia") tirarDaHistoria();
  }, [router, tirarDaHistoria]);

  const registrarFechar = useCallback((fechar: (() => boolean) | null) => {
    fecharAnimado.current = fechar;
  }, []);

  /** Pode sair do editor aberto? Travado (senha na tela) ou com algo
   *  digitado e não gravado, só confirmando. */
  const podeSair = useCallback(() => {
    const sujo = [...sujos.current].some((f) => f.isConnected);
    const motivo = trava.current ?? (sujo ? DESCARTAR : null);
    if (!motivo) return true;
    if (!window.confirm(motivo)) return false;
    trava.current = null;
    sujos.current.clear();
    setModoTravado(null);
    return true;
  }, []);

  const travar = useCallback((motivo: string | null) => {
    trava.current = motivo;
    setModoTravado(motivo ? desktopRef.current : null);
  }, []);

  const gravou = useCallback((form?: HTMLFormElement | null) => {
    if (form) sujos.current.delete(form);
    else sujos.current.clear();
  }, []);

  const marcarSujo = useCallback((form: HTMLFormElement) => {
    sujos.current.add(form);
  }, []);

  /** Fecha com a folha descendo; sem painel montado, na hora. */
  const fecharComo = useCallback(
    (modo: ModoFechar) => {
      modoFechar.current = modo;
      if (fecharAnimado.current) {
        if (!fecharAnimado.current()) modoFechar.current = "normal";
      } else {
        fecharDeVez();
      }
    },
    [fecharDeVez],
  );

  // Abre pela linha (com a origem) ou pela paleta (sem). Trocar de editor
  // no desktop também passa pela pergunta.
  const abrirEditor = useCallback(
    (id: string, el: HTMLElement | null) => {
      if (id === ultimoAberto.current) return;
      if (!podeSair()) return;
      // Aberto pela lista ou pela paleta: gravar fica na tela.
      abertoPelaUrl.current = null;
      origem.current = el;
      lugar.current = lugarDaLinha(el);
      setAberto(id);
      empurrar(id);
    },
    [podeSair, empurrar],
  );

  const valor = useMemo<ContextoEditor>(
    () => ({
      aberto,
      abrir: abrirEditor,
      fechar: () => fecharComo("normal"),
      gravou,
      concluir: () => {
        sujos.current.clear();
        fecharComo("gravou");
      },
      travar,
    }),
    [aberto, abrirEditor, fecharComo, gravou, travar],
  );

  // O endereço chegou com ?abrir=: abre o editor. Na montagem, a entrada
  // vira duas (a página sem o editor e, em cima, a com ele), para o voltar do
  // sistema fechar a folha em vez de sair. Depois dela, o ?abrir= continua
  // acompanhado: o Next não remonta a página quando só a query muda, e um
  // link (ou a paleta) para esta mesma tela com ?abrir= não abria nada. Aí a
  // entrada que o Next acabou de pôr vira a do editor (a de baixo já é a
  // página). O que o próprio editor empurrou e o voltar do sistema já foram
  // tratados e passam reto. Num setTimeout: o efeito do filho roda antes do
  // efeito do App Router que acompanha o pushState, e chamado antes disso o
  // router não fica sabendo.
  const busca = useSearchParams();
  const chaveNaBusca = busca.get(PARAM_ABRIR) ?? busca.get("editar");
  const montou = useRef(false);
  useEffect(() => {
    const id = window.setTimeout(() => {
      const primeira = !montou.current;
      montou.current = true;
      const daUrl = editorDaUrl();
      if (daUrl === null) return;
      const h = historia.current;
      if (
        !primeira &&
        (h.voltaPendente ||
          daUrl === ultimoAberto.current ||
          entradaDoEditor(daUrl))
      ) {
        return;
      }
      if (!editoresRef.current[daUrl]) {
        // Chave que esta página não tem (item excluído, link velho): sai da
        // URL, para não reabrir nada no próximo voltar.
        window.history.replaceState(null, "", urlSemEditor());
        return;
      }
      if (primeira) {
        abertoPelaUrl.current = daUrl;
        if (!entradaDoEditor(daUrl)) {
          window.history.replaceState(null, "", urlSemEditor());
          window.history.pushState(
            { editorAberto: daUrl },
            "",
            urlComEditor(daUrl),
          );
        }
        h.empurrou = true;
        setAberto(daUrl);
        return;
      }
      // Link para a própria tela com outro editor aberto: pergunta antes,
      // como trocar de linha. Desistindo, o endereço volta ao editor aberto.
      // Indo em frente, a entrada do editor anterior fica embaixo e o voltar
      // passa por ela já fechada (nenhum link de hoje faz isso).
      const atual = ultimoAberto.current;
      if (atual !== null && !podeSair()) {
        window.history.replaceState(
          { editorAberto: atual },
          "",
          urlComEditor(atual),
        );
        return;
      }
      // Aberto por link da própria tela: gravar fica nela, como pela lista.
      abertoPelaUrl.current = null;
      origem.current = null;
      lugar.current = null;
      window.history.replaceState(
        { editorAberto: daUrl },
        "",
        urlComEditor(daUrl),
      );
      h.empurrou = true;
      setAberto(daUrl);
    }, 0);
    return () => window.clearTimeout(id);
  }, [chaveNaBusca, podeSair]);

  // O voltar e o avançar do sistema: a URL decide qual editor fica aberto.
  // Com algo digitado (ou a senha na tela), pergunta antes; desistindo, a
  // entrada do editor volta para o histórico.
  useEffect(() => {
    const aoAndar = () => {
      const h = historia.current;
      if (h.origemPendente !== null) {
        // O go(-2) de quem gravou com ?voltar=: chegou à entrada de antes da
        // subpágina. Se ela não é a origem, passa a ser.
        const destino = h.origemPendente;
        h.origemPendente = null;
        h.voltaPendente = false;
        window.clearTimeout(h.reserva);
        if (!estaEm(destino)) router.replace(destino);
        return;
      }
      if (h.voltaPendente) {
        // O back que o próprio editor pediu ao fechar.
        h.voltaPendente = false;
        const depois = h.empurrarDepois;
        h.empurrarDepois = null;
        if (depois) empurrar(depois);
        return;
      }
      const daUrl = editorDaUrl();
      const valido = daUrl !== null && Boolean(editoresRef.current[daUrl]);
      const atual = ultimoAberto.current;
      if (daUrl === atual) {
        h.empurrou = atual !== null;
        return;
      }
      if (atual !== null) {
        if (!podeSair()) {
          window.history.pushState(
            { editorAberto: atual },
            "",
            urlComEditor(atual),
          );
          h.empurrou = true;
          return;
        }
        if (valido) {
          h.empurrou = true;
          setAberto(daUrl);
          return;
        }
        h.empurrou = false;
        fecharComo("historia");
        return;
      }
      if (valido) {
        h.empurrou = true;
        setAberto(daUrl);
      }
    };
    window.addEventListener("popstate", aoAndar);
    return () => window.removeEventListener("popstate", aoAndar);
  }, [empurrar, fecharComo, podeSair, router]);

  // Saindo da tela, a desistência do go(-2) sai junto.
  useEffect(() => {
    const h = historia.current;
    return () => window.clearTimeout(h.reserva);
  }, []);

  // A entrada do editor leva a marca { editorAberto }. Toda action da
  // Administração revalida a página, e o Next regrava a entrada de agora sem
  // ela (replaceState com o estado só dele): quem saía por um link e voltava
  // pelo voltar do sistema ganhava uma entrada repetida da página e perdia o
  // histórico para a frente. A marca volta depois de cada render e antes de
  // um link levar para outra tela.
  const carimbar = useCallback((chave: string | null) => {
    const h = historia.current;
    if (chave === null || !h.empurrou || h.voltaPendente) return;
    if (editorDaUrl() !== chave || entradaDoEditor(chave)) return;
    const estado = window.history.state as Record<string, unknown> | null;
    window.history.replaceState(
      { ...(estado ?? {}), editorAberto: chave },
      "",
      window.location.href,
    );
  }, []);
  useEffect(() => {
    carimbar(aberto);
  });

  // A lista chega nova a cada render do servidor: a chave em texto segura o
  // registro na paleta enquanto os comandos forem os mesmos.
  const chaveComandos = JSON.stringify(
    (comandos ?? []).filter((c) => editores[c.id]),
  );
  const comandosDaPaleta = useMemo<ComandoPaleta[]>(
    () =>
      (JSON.parse(chaveComandos) as { id: string; rotulo: string }[]).map(
        (c) => ({
          id: `editor-${c.id}`,
          rotulo: c.rotulo,
          grupo: grupoComandos,
          executar: () => abrirEditor(c.id, null),
        }),
      ),
    [chaveComandos, grupoComandos, abrirEditor],
  );
  useComandosDaTela(comandosDaPaleta);

  // Fechado (pelo X, por gravar ou porque o item sumiu), o foco volta para a
  // linha que abriu. Sem ela (aberto pela paleta, item excluído), vai para a
  // linha deste editor, a que ficou no lugar (a seguinte ou a LinhaNova), a
  // de cima ou o título do grupo: nunca fica perdido no body.
  useEffect(() => {
    if (aberto !== null) {
      ultimoAberto.current = aberto;
      return;
    }
    const fechado = ultimoAberto.current;
    ultimoAberto.current = null;
    const pedido = devolverFoco.current;
    devolverFoco.current = false;
    if (fechado === null) return;
    // Fechou sem passar pelo fecharDeVez (o item sumiu da lista, excluído
    // por outra pessoa): a entrada do editor sai do histórico também, senão
    // o próximo voltar não faria nada na tela.
    if (historia.current.empurrou && !historia.current.voltaPendente) {
      tirarDaHistoria();
    }
    const ativo = document.activeElement;
    if (!pedido && ativo && ativo !== document.body) return;

    const focar = (el: Element | null | undefined) => {
      if (!(el instanceof HTMLElement)) return false;
      el.focus({ preventScroll: true });
      return true;
    };
    const el = origem.current;
    if (el?.isConnected && focar(el)) return;
    if (
      focar(
        lista.current?.querySelector(`[data-editor="${CSS.escape(fechado)}"]`),
      )
    ) {
      return;
    }
    const l = lugar.current;
    if (!l?.lista.isConnected) return;
    const itens = l.lista.children;
    const vizinha = itens[l.indice] ?? itens[l.indice - 1];
    if (focar(vizinha?.querySelector("button, a[href]"))) return;
    focar(l.lista.closest("section")?.querySelector("h2"));
  }, [aberto, tirarDaHistoria]);

  return (
    <Contexto.Provider value={valor}>
      <div
        // Com um editor aberto, o link que leva a outra tela pergunta antes
        // de perder o que foi escrito ou a senha temporária: os da lista (no
        // desktop ela fica do lado do editor) e os de dentro do editor (a
        // linha de Privacidade da pessoa, "Contatos com ela"). A folha do
        // celular é filha deste div, sem portal, e passa por aqui também.
        // Clique que abre em outra aba (Ctrl, target, download) não sai
        // daqui e não pergunta.
        onClickCapture={(e) => {
          const atual = ultimoAberto.current;
          if (atual === null) return;
          if (!(e.target instanceof Element)) return;
          const link = e.target.closest("a[href]");
          if (!link || !e.currentTarget.contains(link)) return;
          const alvo = link.getAttribute("target");
          if (
            (alvo && alvo !== "_self") ||
            link.hasAttribute("download") ||
            e.metaKey ||
            e.ctrlKey ||
            e.shiftKey ||
            e.altKey
          ) {
            return;
          }
          if (!saiDaPagina(link)) return;
          if (!podeSair()) {
            e.preventDefault();
            return;
          }
          // A entrada que fica para trás é a do editor: o voltar do sistema
          // reabre ele, sem entrada repetida.
          carimbar(atual);
        }}
        className={cn(
          "max-w-[720px]",
          editor &&
            "lg:grid lg:max-w-[1160px] lg:grid-cols-[minmax(0,1fr)_minmax(340px,400px)] lg:items-start lg:gap-3",
        )}
      >
        <div ref={lista} className="min-w-0">
          {children}
        </div>
        {editor && aberto !== null ? (
          <Painel
            key={`${aberto}-${desktop ? "d" : "c"}`}
            titulo={editor.titulo}
            modal={!desktop}
            fecharDeVez={fecharDeVez}
            podeFechar={podeSair}
            registrarFechar={registrarFechar}
            aoDigitar={marcarSujo}
          >
            {editor.conteudo}
          </Painel>
        ) : null}
      </div>
      <AvisoFlutuante />
    </Contexto.Provider>
  );
}

/** Linha da lista que abre um editor. */
export function LinhaEditor({
  id,
  children,
  seta = true,
  rotulo,
}: {
  id: string;
  children: React.ReactNode;
  seta?: boolean;
  /** Nome acessível, quando o texto visível não basta. */
  rotulo?: string;
}) {
  const contexto = useContext(Contexto);
  const ativo = contexto?.aberto === id;
  return (
    <li className="group/linha">
      <button
        type="button"
        aria-expanded={ativo}
        aria-label={rotulo}
        // Por onde o foco volta quando o editor foi aberto pela paleta.
        data-editor={id}
        onClick={(e) => contexto?.abrir(id, e.currentTarget)}
        className={cn(LINHA_ACAO, ativo && "bg-selecao hover:bg-selecao")}
      >
        <span className={MIOLO_LINHA}>
          {children}
          {seta ? <Seta /> : null}
        </span>
      </button>
    </li>
  );
}

/**
 * Linha que abre um editor e tem a chave de liga e desliga ao lado, fora do
 * botão (botão dentro de botão é HTML inválido): o texto abre o editor, a
 * chave grava no toque. É a linha das respostas automáticas.
 */
export function LinhaComChave({
  id,
  chave,
  children,
}: {
  id: string;
  /** O FormAcao com o Interruptor. */
  chave: React.ReactNode;
  children: React.ReactNode;
}) {
  const contexto = useContext(Contexto);
  const ativo = contexto?.aberto === id;
  return (
    <li className="group/linha">
      <div
        className={cn(
          "flex min-h-[48px] items-stretch transition-colors duration-[120ms]",
          ativo && "bg-selecao",
        )}
      >
        <button
          type="button"
          aria-expanded={ativo}
          data-editor={id}
          onClick={(e) => contexto?.abrir(id, e.currentTarget)}
          className={cn(
            LINHA_ACAO,
            "w-auto min-w-0 flex-1",
            ativo && "hover:bg-selecao",
          )}
        >
          <span className={cn(MIOLO_LINHA, "pr-1")}>
            {children}
            <Seta />
          </span>
        </button>
        {/* O fio de cima continua por baixo da chave. */}
        <span className="flex shrink-0 items-center border-t border-fio pr-1.5 group-first/linha:border-t-0">
          {chave}
        </span>
      </div>
    </li>
  );
}

/** A última linha do grupo, que cria um item novo. */
export function LinhaNova({ id, rotulo }: { id: string; rotulo: string }) {
  return (
    <LinhaEditor id={id} seta={false}>
      <Plus
        size={20}
        strokeWidth={2.25}
        aria-hidden
        className="-ml-0.5 shrink-0 text-tinta"
      />
      <span className="tipo-corpo flex-1 font-semibold text-tinta">
        {rotulo}
      </span>
    </LinhaEditor>
  );
}

/* ── O painel (desktop) e a folha (celular) ──────────────────────────── */

function semMovimento() {
  return window.matchMedia("(prefers-reduced-motion: reduce)").matches;
}

function Painel({
  titulo,
  modal,
  fecharDeVez,
  podeFechar,
  registrarFechar,
  aoDigitar,
  children,
}: {
  titulo: string;
  modal: boolean;
  fecharDeVez: () => void;
  /** A pergunta do editor: false quando a pessoa desiste de fechar. */
  podeFechar: () => boolean;
  registrarFechar: (fechar: (() => boolean) | null) => void;
  /** Alguém digitou (ou marcou) num formulário do editor. */
  aoDigitar: (form: HTMLFormElement) => void;
  children: React.ReactNode;
}) {
  const idTitulo = useId();
  const fundo = useRef<HTMLDivElement>(null);
  const saindo = useRef(false);
  // O gesto chama o fechar mais novo: ele depende da folha, que é do gancho.
  const fecharPeloGesto = useRef<() => boolean>(() => false);
  const { folha: caixa, arrasto } = useArrastarParaFechar(() =>
    fecharPeloGesto.current(),
  );

  // A folha desce antes de sumir; no desktop e sem movimento, fecha na hora.
  // Devolve se fechou: com algo a perder, a pessoa pode desistir.
  const fechar = useCallback((): boolean => {
    if (saindo.current) return true;
    if (!podeFechar()) return false;
    const el = caixa.current;
    if (!modal || !el || semMovimento()) {
      fecharDeVez();
      return true;
    }
    saindo.current = true;
    fundo.current?.animate([{ opacity: 1 }, { opacity: 0 }], {
      duration: 180,
      fill: "forwards",
    });
    el.animate([{ translate: "0 0" }, { translate: "0 100%" }], {
      duration: 240,
      easing: EASE_PADRAO,
      fill: "forwards",
    }).finished.then(fecharDeVez, fecharDeVez);
    return true;
  }, [modal, fecharDeVez, podeFechar, caixa]);

  useEffect(() => {
    fecharPeloGesto.current = fechar;
    registrarFechar(fechar);
    return () => registrarFechar(null);
  }, [fechar, registrarFechar]);

  // O que a pessoa digita ou marca (só o gesto dela, não o que o código
  // muda) deixa o formulário "escrito e não gravado".
  useEffect(() => {
    const el = caixa.current;
    if (!el) return;
    const aoMexer = (e: Event) => {
      if (!e.isTrusted || !(e.target instanceof Element)) return;
      const form = e.target.closest("form");
      if (form) aoDigitar(form);
    };
    el.addEventListener("input", aoMexer, true);
    el.addEventListener("change", aoMexer, true);
    return () => {
      el.removeEventListener("input", aoMexer, true);
      el.removeEventListener("change", aoMexer, true);
    };
  }, [caixa, aoDigitar]);

  // Entrada: antes da pintura, para a folha não aparecer um quadro no lugar
  // final. O foco vai para a folha, não para um campo (no toque, abriria o
  // teclado sem ninguém pedir).
  useLayoutEffect(() => {
    const el = caixa.current;
    el?.focus({ preventScroll: true });
    if (!modal || !el || semMovimento()) return;
    el.animate([{ translate: "0 100%" }, { translate: "0 0" }], {
      duration: 280,
      easing: EASE_PADRAO,
    });
    fundo.current?.animate([{ opacity: 0 }, { opacity: 1 }], {
      duration: 180,
    });
  }, [modal, caixa]);

  // Folha aberta: a página de trás não rola, Esc fecha e o Tab circula
  // dentro dela. Esc que alguém de dentro já usou (a confirmação de excluir)
  // não fecha a folha.
  useEffect(() => {
    if (!modal) return;
    const el = caixa.current;
    const raiz = document.documentElement;
    const overflowAntes = raiz.style.overflow;
    raiz.style.overflow = "hidden";

    const aoTeclar = (e: KeyboardEvent) => {
      if (!el || e.defaultPrevented) return;
      if (e.key === "Escape") {
        e.preventDefault();
        fechar();
        return;
      }
      if (e.key !== "Tab") return;
      const focaveis = Array.from(
        el.querySelectorAll<HTMLElement>(
          'a[href], button:not([disabled]), input:not([disabled]):not([type="hidden"]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])',
        ),
      ).filter((f) => f.getClientRects().length > 0 || f.matches(".sr-only"));
      if (focaveis.length === 0) return;
      const primeiro = focaveis[0];
      const ultimo = focaveis[focaveis.length - 1];
      const ativo = document.activeElement;
      if (!el.contains(ativo)) {
        e.preventDefault();
        primeiro.focus();
      } else if (e.shiftKey && (ativo === primeiro || ativo === el)) {
        e.preventDefault();
        ultimo.focus();
      } else if (!e.shiftKey && ativo === ultimo) {
        e.preventDefault();
        primeiro.focus();
      }
    };
    document.addEventListener("keydown", aoTeclar);
    return () => {
      raiz.style.overflow = overflowAntes;
      document.removeEventListener("keydown", aoTeclar);
    };
  }, [modal, fechar, caixa]);

  const cabecalho = (
    <div className="flex w-full items-center justify-between gap-1 pr-1 pl-2">
      <h2 id={idTitulo} className="tipo-titulo-3 min-w-0 truncate text-tinta">
        {titulo}
      </h2>
      <button
        type="button"
        onClick={fechar}
        aria-label="Fechar"
        className={BOTAO_ICONE}
      >
        <X size={22} strokeWidth={1.75} aria-hidden />
      </button>
    </div>
  );

  if (modal) {
    return (
      // data-sem-abas: enquanto a folha existir, a barra de abas some (a
      // folha cobre o pé e ficaria com duas barras empilhadas).
      <div data-sem-abas="" className="fixed inset-0 z-50 lg:hidden">
        <div
          ref={fundo}
          aria-hidden
          onClick={fechar}
          className="absolute inset-0 touch-none bg-overlay"
        />
        <div
          ref={caixa}
          role="dialog"
          aria-modal="true"
          aria-labelledby={idTitulo}
          tabIndex={-1}
          // O teclado do celular cobre o que é fixo no pé: a folha se apoia
          // em cima dele e cabe na área visível. O arrasto mexe no
          // transform; a entrada e a saída, no translate.
          style={{
            bottom: "var(--teclado, 0px)",
            maxHeight: "calc(var(--vv-altura, 100dvh) - 24px)",
            transform: "translateY(var(--arrasto, 0px))",
          }}
          // No tablet a folha não estica até as bordas: 600px no meio. No
          // escuro, a folha (flutuante, #1A1A1A) fica acima do cartão
          // (#151515), e as listas de dentro afundavam nela: aqui o cartão
          // sobe um tom (#212121, o mesmo passo do cartão sobre o fundo, com
          // o erro a 4,9:1) e o fio das linhas vai para o forte (o normal
          // sumia no cartão novo).
          className="absolute inset-x-0 flex flex-col rounded-t-folha bg-flutuante shadow-flutuante outline-none md:mx-auto md:max-w-[600px] dark:[--color-cartao:var(--color-neutral-100)] dark:[--color-fio:var(--color-fio-forte)]"
        >
          <div
            {...arrasto}
            className="flex shrink-0 touch-none flex-col items-center pt-1 select-none"
          >
            <span
              aria-hidden
              className="h-[5px] w-[36px] rounded-full bg-fio-forte"
            />
            <div className="w-full pt-0.5">{cabecalho}</div>
          </div>
          <div className="min-h-0 flex-1 overflow-x-hidden overflow-y-auto overscroll-contain px-2 pt-1 pb-[max(24px,env(safe-area-inset-bottom))]">
            {children}
          </div>
        </div>
      </div>
    );
  }

  return (
    <section
      ref={caixa}
      aria-labelledby={idTitulo}
      tabIndex={-1}
      onKeyDown={(e) => {
        if (e.key !== "Escape" || e.defaultPrevented) return;
        e.preventDefault();
        fechar();
      }}
      className="hidden max-h-[calc(100dvh_-_var(--casca-topo,0px)_-_48px)] animate-entrada flex-col rounded-painel border border-fio bg-fundo outline-none lg:sticky lg:top-[calc(var(--casca-topo,0px)_+_24px)] lg:flex"
    >
      <div className="shrink-0 pt-1 pb-0.5">{cabecalho}</div>
      <div className="min-h-0 flex-1 overflow-x-hidden overflow-y-auto overscroll-contain px-2 pt-1 pb-2.5">
        {children}
      </div>
    </section>
  );
}

/**
 * Folha que desce com o dedo, como a do iOS (o mesmo gesto da folha do
 * "Mais" da casca): segue o dedo para baixo, resiste para cima, fecha
 * passando de 120px ou soltando rápido. Só no toque. Se o fechar desistir
 * (algo a perder e a pessoa ficou), a folha volta para o lugar.
 */
function useArrastarParaFechar(fechar: () => boolean) {
  // A folha é do próprio gancho: quem usa põe o `folha` no elemento.
  const folha = useRef<HTMLDivElement>(null);
  const gesto = useRef<{
    id: number;
    inicio: number;
    arrastando: boolean;
    amostras: { y: number; t: number }[];
  } | null>(null);

  const mover = (y: number, comTransicao: boolean) => {
    const el = folha.current;
    if (!el) return;
    el.style.transition = comTransicao
      ? "transform 280ms cubic-bezier(0.32, 0.72, 0, 1)"
      : "none";
    el.style.setProperty("--arrasto", `${y}px`);
  };

  const soltar = (e: React.PointerEvent<HTMLElement>) => {
    const g = gesto.current;
    gesto.current = null;
    if (!g?.arrastando) return;
    const distancia = e.clientY - g.inicio;
    const a = g.amostras[0];
    const b = g.amostras[g.amostras.length - 1];
    const velocidade = (b.y - a.y) / Math.max(1, b.t - a.t);
    if (
      (distancia > ARRASTO_FECHA_PX ||
        (distancia > 24 && velocidade > ARRASTO_VELOCIDADE)) &&
      fechar()
    ) {
      return;
    }
    mover(0, true);
  };

  const arrasto = {
    onPointerDown(e: React.PointerEvent<HTMLElement>) {
      if (e.pointerType === "mouse") return;
      // O X fica dentro da faixa de arrasto e precisa do toque dele.
      if ((e.target as HTMLElement).closest("button")) return;
      gesto.current = {
        id: e.pointerId,
        inicio: e.clientY,
        arrastando: false,
        amostras: [{ y: e.clientY, t: e.timeStamp }],
      };
    },
    onPointerMove(e: React.PointerEvent<HTMLElement>) {
      const g = gesto.current;
      if (!g || g.id !== e.pointerId) return;
      const distancia = e.clientY - g.inicio;
      if (!g.arrastando) {
        if (Math.abs(distancia) < 6) return;
        g.arrastando = true;
        try {
          e.currentTarget.setPointerCapture(e.pointerId);
        } catch {
          // Ponteiro que o navegador já soltou: segue sem captura.
        }
      }
      mover(distancia > 0 ? distancia : distancia / 5, false);
      g.amostras = [...g.amostras.slice(-2), { y: e.clientY, t: e.timeStamp }];
    },
    onPointerUp: soltar,
    onPointerCancel: soltar,
  };
  return { folha, arrasto };
}

/* ── Formulário que grava sem sair da tela ───────────────────────────── */

const ContextoForm = createContext<{ pendente: boolean }>({ pendente: false });

/** Gravando? Para o que mora dentro do FormAcao (a chave liga/desliga). */
export function useGravando() {
  return useContext(ContextoForm).pendente;
}

/**
 * Formulário de server action que devolve { ok, erro }. Deu certo: aviso
 * curto e, com `fechar`, o editor fecha (ou volta à origem, se veio pelo
 * endereço com ?voltar=). Deu errado: o erro aparece acima do botão (ou no
 * aviso, com `erroNoAviso`, para a chave que mora na linha) e o que foi
 * digitado continua lá.
 */
export function FormAcao({
  acao,
  children,
  fechar = false,
  botao,
  botaoGravando,
  erroNoAviso = false,
  desfazerNoErro = false,
  className,
  "aria-label": rotulo,
}: {
  acao: (estado: ResultadoAcao, formData: FormData) => Promise<ResultadoAcao>;
  children?: React.ReactNode;
  fechar?: boolean;
  /** Rótulo do botão principal ("Salvar"); sem ele, o botão vem de dentro. */
  botao?: string;
  /** Rótulo enquanto grava ("Salvando…"). */
  botaoGravando?: string;
  erroNoAviso?: boolean;
  /** Deu errado: os campos voltam ao que estava salvo (a escolha que grava
   *  no toque, como a cor da etiqueta, não fica mostrando o que não gravou). */
  desfazerNoErro?: boolean;
  className?: string;
  "aria-label"?: string;
}) {
  const contexto = useContext(Contexto);
  const formulario = useRef<HTMLFormElement>(null);
  const [estado, despachar, pendente] = useActionState(
    async (anterior: ResultadoAcao, dados: FormData) => {
      const resultado = await acao(anterior, dados);
      if (resultado.ok) {
        avisar(resultado.ok);
        contexto?.gravou(formulario.current);
        if (fechar) contexto?.concluir();
      } else if (resultado.erro) {
        if (erroNoAviso) avisar(resultado.erro, "erro");
        if (desfazerNoErro) {
          formulario.current?.reset();
          contexto?.gravou(formulario.current);
        }
      }
      return resultado;
    },
    {},
  );

  return (
    <ContextoForm.Provider value={{ pendente }}>
      <form
        ref={formulario}
        aria-label={rotulo}
        onSubmit={(e) => {
          e.preventDefault();
          // Um envio por vez: o duplo toque na chave não liga e desliga.
          if (pendente) return;
          const form = e.currentTarget;
          const quem = (e.nativeEvent as SubmitEvent).submitter;
          let dados: FormData;
          try {
            dados = new FormData(form, quem);
          } catch {
            dados = new FormData(form);
          }
          startTransition(() => despachar(dados));
        }}
        className={className}
      >
        {children}
        {estado.erro && !erroNoAviso && !pendente ? (
          <p role="alert" className="tipo-nota text-erro">
            {estado.erro}
          </p>
        ) : null}
        {botao ? (
          <Button
            type="submit"
            size="lg"
            carregando={pendente}
            className="w-full lg:h-[40px] lg:w-auto lg:self-start lg:px-2 lg:text-sm"
          >
            {pendente ? (botaoGravando ?? botao) : botao}
          </Button>
        ) : null}
      </form>
    </ContextoForm.Provider>
  );
}

/**
 * Chave liga/desliga que grava no toque (dentro de um FormAcao). Enquanto
 * grava, já mostra a posição nova; se der erro, volta. Com `confirmar`, o
 * toque pergunta antes (ligar o que manda mensagem a cliente).
 */
export function Interruptor({
  ligado,
  rotuloId,
  rotulo,
  desativado = false,
  confirmar,
}: {
  ligado: boolean;
  /** Id do texto da linha que dá nome à chave. */
  rotuloId?: string;
  rotulo?: string;
  desativado?: boolean;
  /** A pergunta antes de gravar; desistindo, nada muda. */
  confirmar?: string;
}) {
  const pendente = useGravando();
  const mostrado = pendente ? !ligado : ligado;
  return (
    <button
      type="submit"
      role="switch"
      aria-checked={mostrado}
      aria-labelledby={rotuloId}
      aria-label={rotuloId ? undefined : rotulo}
      aria-busy={pendente || undefined}
      disabled={desativado}
      onClick={(e) => {
        if (confirmar && !pendente && !window.confirm(confirmar)) {
          e.preventDefault();
        }
      }}
      className="-my-1 inline-flex h-[44px] w-[56px] shrink-0 items-center justify-center rounded-full focus-visible:outline-2 focus-visible:outline-offset-0 focus-visible:outline-tinta disabled:cursor-not-allowed"
    >
      <TrilhoInterruptor ligado={mostrado} apagado={desativado} />
    </button>
  );
}
