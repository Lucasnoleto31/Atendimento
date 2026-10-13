"use client";

import {
  useEffect,
  useId,
  useRef,
  useState,
  useSyncExternalStore,
} from "react";
import { usePathname, useRouter } from "next/navigation";
import { Moon, Search, Sun, X } from "lucide-react";
import { cn } from "@/lib/utils";
import { formatarDataCurta, formatarTelefone } from "@/lib/format";
import {
  buscarPessoas,
  type PessoaEncontrada,
} from "@/app/(app)/busca/actions";
import { comVoltar } from "@/app/(app)/contatos/voltar";
import { hrefConversa, lerFiltrosFila } from "@/app/(app)/chat/mensagem";
import { AvatarContato } from "./avatar-contato";
import { alternarTema } from "./alternador-tema";
import { BOTAO_ICONE } from "./form-styles";
import {
  AVISO_ENVIO_EM_VOO,
  SEM_COMANDOS,
  assinarComandos,
  comandoAtual,
  fecharPaleta,
  fecharPaletaE,
  haEnvioEmVoo,
  lerComandos,
  lerRetorno,
  tomarAcaoPendente,
  useEhMac,
  type AreaPaleta,
  type ComandoPaleta,
  type DestinoPaleta,
} from "./paleta-global";

/*
 * O diálogo da paleta global, num arquivo à parte para ir num pedaço de JS
 * próprio: a paleta-global.tsx (atalho, registro de comandos, abrir e
 * fechar) vai em toda tela; este só depois que o navegador fica ocioso. O
 * contrato de teclado e de navegação está descrito lá.
 */

type Item =
  | { tipo: "pessoa"; chave: string; pessoa: PessoaEncontrada }
  | { tipo: "comando"; chave: string; comando: ComandoPaleta }
  | { tipo: "destino"; chave: string; destino: DestinoPaleta }
  | { tipo: "area"; chave: string; area: AreaPaleta }
  | { tipo: "tema"; chave: string; rotulo: string };

type Grupo = { titulo: string; itens: Item[]; aviso?: React.ReactNode };

type ResultadoPessoas =
  | { termo: string; resultados: PessoaEncontrada[] }
  | { termo: string; erro: string };

/** Minúsculas e sem acento: "relatorio" acha "Relatório". */
function normalizar(texto: string): string {
  return texto
    .normalize("NFD")
    .replace(/\p{Diacritic}/gu, "")
    .toLowerCase();
}

const MINIMO_PESSOAS = 2;
const RESPIRO_MS = 220;

const ROTULO_ESTADO: Record<PessoaEncontrada["estado"], string> = {
  aberta: "Em aberto",
  adiada: "Adiada",
  resolvida: "Resolvida",
  sem_conversa: "Sem conversa",
};

function linhaDaPessoa(p: PessoaEncontrada): string {
  const contato = p.telefone
    ? formatarTelefone(p.telefone)
    : p.instagram
      ? `@${p.instagram}`
      : null;
  const estado =
    p.estado === "adiada" && p.adiadaAte
      ? `Adiada até ${formatarDataCurta(p.adiadaAte)}`
      : ROTULO_ESTADO[p.estado];
  const dono = p.responsavelNome ?? "Sem dono";
  return [contato, estado, dono].filter(Boolean).join(" · ");
}

/**
 * A conversa da pessoa no chat. Estando no /chat, a fila fica como está: os
 * filtros da URL atual vão junto, lidos e escritos pelas funções do próprio
 * chat (lerFiltrosFila e hrefConversa). Uma lista de nomes à parte envelhecia
 * a cada filtro novo: desde a quinta rodada, escolher alguém pela paleta
 * perdia etiquetas, atendentes, período, canal, campanha e "só não lidas".
 */
function hrefDaConversa(leadId: string, pathname: string): string {
  if (pathname !== "/chat") return hrefConversa(leadId, lerFiltrosFila({}));
  const atual = new URLSearchParams(window.location.search);
  const params: Record<string, string[]> = {};
  for (const [nome, valor] of atual) (params[nome] ??= []).push(valor);
  return hrefConversa(leadId, lerFiltrosFila(params));
}

export function DialogoPaleta({
  areas,
  destinos,
}: {
  areas: AreaPaleta[];
  destinos: DestinoPaleta[];
}) {
  const router = useRouter();
  const pathname = usePathname();
  const mac = useEhMac();
  const comandos = useSyncExternalStore(
    assinarComandos,
    lerComandos,
    () => SEM_COMANDOS,
  );

  const [termo, setTermo] = useState("");
  // A linha destacada é guardada pela chave, não pela posição: as pessoas
  // chegam depois e entram acima das áreas, e a posição guardada passaria a
  // apontar outra linha (o Enter com "Contatos" à vista abriria a conversa
  // de alguém). null: a primeira linha, até ela ser fixada abaixo.
  const [chaveAtiva, setChaveAtiva] = useState<string | null>(null);
  const [pessoas, setPessoas] = useState<ResultadoPessoas | null>(null);
  // Escolheu um destino com envio no ar: a paleta fica aberta e avisa.
  const [esperaEnvio, setEsperaEnvio] = useState(false);
  const campo = useRef<HTMLInputElement>(null);
  const lista = useRef<HTMLDivElement>(null);
  const idBase = useId();

  // Foco no campo ao abrir, página de trás parada; ao fechar, o foco volta.
  useEffect(() => {
    const origem = lerRetorno();
    campo.current?.focus();
    const raiz = document.documentElement;
    const overflowAntes = raiz.style.overflow;
    raiz.style.overflow = "hidden";
    return () => {
      raiz.style.overflow = overflowAntes;
      // Elemento que saiu da tela ou ficou inerte (a folha que fechou) não
      // recebe foco: sem isso o foco cairia no body e a próxima letra
      // viraria atalho do chat.
      if (origem?.isConnected && !origem.closest("[inert]")) {
        origem.focus({ preventScroll: true });
      }
      tomarAcaoPendente()?.();
    };
  }, []);

  const termoLimpo = termo.trim();
  const buscaPessoas = termoLimpo.length >= MINIMO_PESSOAS;

  // A busca de pessoas espera um respiro do teclado; resposta de um termo
  // que já mudou é descartada.
  useEffect(() => {
    if (!buscaPessoas) return;
    let viva = true;
    const id = window.setTimeout(() => {
      buscarPessoas(termoLimpo)
        .catch(() => ({ erro: "A busca não respondeu. Tente de novo." }))
        .then((r) => {
          if (viva) setPessoas({ termo: termoLimpo, ...r });
        });
    }, RESPIRO_MS);
    return () => {
      viva = false;
      window.clearTimeout(id);
    };
  }, [buscaPessoas, termoLimpo]);

  const filtro = normalizar(termoLimpo);
  const casa = (...textos: (string | undefined)[]) =>
    !filtro || textos.some((t) => t && normalizar(t).includes(filtro));

  // Os grupos, na ordem da tela: pessoas (com termo), os comandos da tela,
  // as áreas e o tema.
  const grupos: Grupo[] = [];
  if (buscaPessoas) {
    const pronto = pessoas !== null;
    const atrasado = pronto && pessoas.termo !== termoLimpo;
    const itens: Item[] =
      pronto && "resultados" in pessoas
        ? pessoas.resultados.map((p) => ({
            tipo: "pessoa" as const,
            chave: `p-${p.leadId}`,
            pessoa: p,
          }))
        : [];
    let aviso: React.ReactNode = null;
    if (!pronto) aviso = "Buscando…";
    else if ("erro" in pessoas && !atrasado) {
      aviso = <span className="text-erro">{pessoas.erro}</span>;
    } else if (itens.length === 0 && !atrasado) {
      aviso = `Ninguém com “${termoLimpo}”.`;
    }
    grupos.push({
      titulo: atrasado ? "Pessoas · buscando…" : "Pessoas",
      itens,
      aviso,
    });
  }

  const porGrupo = new Map<string, Item[]>();
  for (const c of comandos) {
    const titulo = c.grupo ?? "Nesta tela";
    if (!casa(c.rotulo, c.grupo)) continue;
    const itens = porGrupo.get(titulo) ?? [];
    itens.push({ tipo: "comando", chave: `c-${c.id}`, comando: c });
    porGrupo.set(titulo, itens);
  }

  // Os destinos fixos (os editores da Administração e de Minha conta), só
  // com algo digitado: a paleta vazia continua curta. O que a tela aberta
  // já oferece como comando dela não aparece duas vezes, e o destino que é
  // a própria tela (o Log, estando no Log) não leva a lugar nenhum. Nem o
  // editor que a própria tela não tem: em WhatsApp com os 10 números, o
  // "Novo número de WhatsApp" abriria a mesma tela sem editor nenhum.
  const editoresDaTela = new Set(
    comandos
      .filter((c) => c.id.startsWith("editor-"))
      .map((c) => c.id.slice("editor-".length)),
  );
  const destinosConta: Item[] = [];
  if (filtro) {
    for (const d of destinos) {
      if (d.editor && editoresDaTela.has(d.editor)) continue;
      if (d.href.split("?")[0] === pathname) continue;
      if (!casa(d.rotulo, d.grupo, d.sinonimos)) continue;
      const item: Item = { tipo: "destino", chave: `d-${d.id}`, destino: d };
      if (d.grupo === "Conta") {
        destinosConta.push(item);
        continue;
      }
      const itens = porGrupo.get(d.grupo) ?? [];
      itens.push(item);
      porGrupo.set(d.grupo, itens);
    }
  }
  for (const [titulo, itens] of porGrupo) grupos.push({ titulo, itens });

  const areasVisiveis = areas.filter((a) =>
    casa(a.rotulo, "ir para", a.sinonimos),
  );
  if (areasVisiveis.length > 0) {
    grupos.push({
      titulo: "Ir para",
      itens: areasVisiveis.map((a) => ({
        tipo: "area" as const,
        chave: `a-${a.href}`,
        area: a,
      })),
    });
  }

  // O tema diz para onde vai, como o botão do menu. A paleta só monta no
  // cliente, depois de um gesto: ler o <html> aqui não diverge do servidor.
  const escuro =
    typeof document !== "undefined" &&
    document.documentElement.dataset.theme === "dark";
  const rotuloTema = escuro ? "Usar tema claro" : "Usar tema escuro";
  const itensConta: Item[] = [...destinosConta];
  if (casa(rotuloTema, "tema")) {
    itensConta.push({ tipo: "tema", chave: "tema", rotulo: rotuloTema });
  }
  if (itensConta.length > 0) grupos.push({ titulo: "Conta", itens: itensConta });

  const itens = grupos.flatMap((g) => g.itens);
  let ativo = itens.findIndex((item) => item.chave === chaveAtiva);
  if (ativo === -1 && itens.length > 0) {
    // Sem linha guardada (a paleta abriu, o termo mudou) ou com a guardada
    // fora da lista: vale a primeira, e ela fica guardada daqui em diante,
    // para o que chegar depois não tomar o lugar dela.
    ativo = 0;
    setChaveAtiva(itens[0].chave);
  }
  // O id segue a linha, não a posição: o aria-activedescendant não muda de
  // dono quando a lista cresce acima dela.
  const idItem = (item: Item) => `${idBase}-item-${item.chave}`;

  // A linha escolhida fica à vista: o foco nunca sai do campo, então o
  // navegador não rola nada sozinho.
  useEffect(() => {
    lista.current
      ?.querySelector('[data-ativo="1"]')
      ?.scrollIntoView({ block: "nearest" });
  }, [ativo, termo]);

  const fecharE = fecharPaletaE;

  // O aviso sai sozinho quando o envio termina: a paleta não segue para o
  // destino (a pessoa escolhe de novo), mas também não fica dizendo que
  // espera algo que já acabou.
  useEffect(() => {
    if (!esperaEnvio) return;
    const raiz = document.documentElement;
    const observador = new MutationObserver(() => {
      if (!haEnvioEmVoo()) setEsperaEnvio(false);
    });
    observador.observe(raiz, { attributeFilter: ["data-envio-em-voo"] });
    return () => observador.disconnect();
  }, [esperaEnvio]);

  // Cada tentativa barrada esvazia a região de status e a preenche 100 ms
  // depois, para o leitor de tela repetir o aviso (como o atalho de área).
  const [tentativasBarradas, setTentativasBarradas] = useState(0);
  useEffect(() => {
    if (tentativasBarradas === 0) return;
    const t = window.setTimeout(() => {
      if (haEnvioEmVoo()) setEsperaEnvio(true);
    }, 100);
    return () => window.clearTimeout(t);
  }, [tentativasBarradas]);

  /** Leva a outra tela, salvo com envio no ar: aí não fecha e avisa. */
  const navegar = (destino: string) => {
    if (haEnvioEmVoo()) {
      setEsperaEnvio(false);
      setTentativasBarradas((n) => n + 1);
      return;
    }
    fecharE(() => router.push(destino));
  };

  const escolher = (item: Item, ficha = false) => {
    switch (item.tipo) {
      case "pessoa": {
        // Fora do chat, quem abre uma conversa ou uma ficha pela paleta
        // ganha o caminho de volta para a tela em que estava.
        const voltar =
          pathname === "/chat" || pathname.startsWith("/chat/")
            ? null
            : pathname + window.location.search;
        navegar(
          ficha
            ? comVoltar(`/contatos/${item.pessoa.leadId}`, voltar)
            : comVoltar(hrefDaConversa(item.pessoa.leadId, pathname), voltar),
        );
        return;
      }
      case "comando": {
        const id = item.comando.id;
        fecharE(() => comandoAtual(id)?.executar());
        return;
      }
      case "destino":
        navegar(item.destino.href);
        return;
      case "area":
        navegar(item.area.href);
        return;
      case "tema":
        fecharE(alternarTema);
        return;
    }
  };

  const aoTeclarNoCampo = (e: React.KeyboardEvent<HTMLInputElement>) => {
    if (e.key === "ArrowDown" || e.key === "ArrowUp") {
      e.preventDefault();
      if (itens.length === 0) return;
      const passo = e.key === "ArrowDown" ? 1 : -1;
      const proximo = (ativo + passo + itens.length) % itens.length;
      setChaveAtiva(itens[proximo].chave);
      return;
    }
    if (e.key === "Enter") {
      e.preventDefault();
      const item = itens[ativo];
      if (item) escolher(item, e.shiftKey);
    }
  };

  const teclaPaleta = mac ? "⌘K" : "Ctrl+K";
  // Onde cada grupo começa na lista corrida (o índice das setas).
  const inicios = grupos.map((_, gi) =>
    grupos.slice(0, gi).reduce((soma, g) => soma + g.itens.length, 0),
  );

  return (
    <div
      className="fixed inset-0 z-[60] flex justify-center px-1.5 pt-[max(12px,env(safe-area-inset-top))] md:pt-[12vh]"
      onKeyDown={(e) => {
        if (e.key === "Escape") {
          e.preventDefault();
          e.stopPropagation();
          fecharPaleta();
          return;
        }
        // O foco mora no campo; o Tab não leva para a tela de trás.
        if (e.key === "Tab") {
          e.preventDefault();
          campo.current?.focus();
        }
      }}
    >
      {/* Fundo: clique fora fecha. */}
      <div
        aria-hidden
        onMouseDown={fecharPaleta}
        className="absolute inset-0 animate-entrada bg-overlay"
      />
      <div
        role="dialog"
        aria-modal="true"
        aria-label="Buscar pessoa, área ou comando"
        className="relative flex max-h-[calc(var(--vv-altura,100dvh)-24px)] w-full max-w-[560px] animate-entrada flex-col self-start overflow-hidden rounded-folha border border-fio bg-flutuante shadow-lg md:max-h-[min(560px,calc(var(--vv-altura,100dvh)-24vh))]"
      >
        <div className="flex h-[56px] shrink-0 items-center gap-1 border-b border-fio pr-0.5 pl-2">
          <Search
            size={18}
            strokeWidth={1.75}
            aria-hidden
            className="shrink-0 text-texto-3"
          />
          {/* Sem anel de foco: o campo é o único lugar do foco enquanto a
              paleta está aberta, e o cursor piscando já marca isso. */}
          <input
            ref={campo}
            role="combobox"
            aria-expanded="true"
            aria-controls={`${idBase}-lista`}
            aria-autocomplete="list"
            aria-activedescendant={
              ativo >= 0 ? idItem(itens[ativo]) : undefined
            }
            aria-label="Buscar pessoa, área ou comando"
            autoComplete="off"
            autoCorrect="off"
            spellCheck={false}
            enterKeyHint="go"
            value={termo}
            onChange={(e) => {
              setTermo(e.target.value);
              setChaveAtiva(null);
              setEsperaEnvio(false);
            }}
            onKeyDown={aoTeclarNoCampo}
            placeholder="Nome, telefone, @ ou área"
            className="tipo-corpo h-full min-w-0 flex-1 bg-transparent text-tinta placeholder:text-texto-3 focus:outline-none"
          />
          <button
            type="button"
            onClick={fecharPaleta}
            aria-label="Fechar"
            title="Fechar (Esc)"
            className={BOTAO_ICONE}
          >
            <X size={20} strokeWidth={1.75} aria-hidden />
          </button>
        </div>

        {/* A região fica montada, vazia, desde a abertura: o leitor de tela
            só anuncia o texto que entra numa região que já existia. */}
        <div role="status" className="shrink-0">
          {esperaEnvio ? (
            <p className="tipo-nota border-b border-fio px-2 py-1 text-texto-2">
              {AVISO_ENVIO_EM_VOO}
            </p>
          ) : null}
        </div>

        <div
          ref={lista}
          id={`${idBase}-lista`}
          role="listbox"
          aria-label="Resultados"
          className="min-h-0 flex-1 overflow-y-auto overscroll-contain p-0.5"
        >
          {grupos.length === 0 ? (
            <p className="tipo-corpo px-1.5 py-2 text-texto-2">
              Nada com “{termoLimpo}”. Pessoas aparecem a partir de duas letras
              ou quatro números do telefone.
            </p>
          ) : (
            grupos.map((g, gi) => {
              const idTitulo = `${idBase}-grupo-${gi}`;
              return (
                <div
                  key={`${gi}-${g.titulo}`}
                  role="group"
                  aria-labelledby={idTitulo}
                  className="pb-0.5"
                >
                  <p
                    id={idTitulo}
                    className="tipo-nota px-1.5 pt-1 pb-0.5 text-texto-2"
                  >
                    {g.titulo}
                  </p>
                  {g.itens.map((item, ii) => {
                    const i = inicios[gi] + ii;
                    return (
                      <LinhaPaleta
                        key={item.chave}
                        id={idItem(item)}
                        item={item}
                        ativo={i === ativo}
                        aoApontar={() => setChaveAtiva(item.chave)}
                        aoEscolher={() => escolher(item)}
                        aoAbrirFicha={() => escolher(item, true)}
                      />
                    );
                  })}
                  {g.aviso ? (
                    <p
                      role="status"
                      className="tipo-nota px-1.5 py-1 text-texto-2"
                    >
                      {g.aviso}
                    </p>
                  ) : null}
                </div>
              );
            })
          )}
        </div>

        {/* As teclas, só para quem tem teclado de verdade. */}
        <p className="hidden h-[40px] shrink-0 items-center gap-2 border-t border-fio px-2 text-texto-2 md:pointer-fine:flex">
          <Dica tecla="↑↓">escolher</Dica>
          <Dica tecla="Enter">abrir</Dica>
          <Dica tecla="Shift+Enter">ficha da pessoa</Dica>
          <Dica tecla="Esc">fechar</Dica>
          <span className="tipo-nota ml-auto">{teclaPaleta}</span>
        </p>
      </div>
    </div>
  );
}

function Dica({ tecla, children }: { tecla: string; children: string }) {
  return (
    <span className="tipo-nota inline-flex items-center gap-0.5">
      <Tecla>{tecla}</Tecla>
      {children}
    </span>
  );
}

/** A tecla de um atalho. Some no toque: no telefone não há Alt nem Esc. */
function Tecla({ children }: { children: string }) {
  return (
    <kbd className="inline-flex h-[20px] min-w-[20px] items-center justify-center rounded-celula bg-cartao px-0.5 text-xs text-texto-2 pointer-coarse:hidden">
      {children}
    </kbd>
  );
}

function LinhaPaleta({
  id,
  item,
  ativo,
  aoApontar,
  aoEscolher,
  aoAbrirFicha,
}: {
  id: string;
  item: Item;
  ativo: boolean;
  aoApontar: () => void;
  aoEscolher: () => void;
  aoAbrirFicha: () => void;
}) {
  const classe = cn(
    "flex w-full cursor-pointer items-center gap-1.5 rounded-controle px-1.5 text-left text-tinta select-none",
    item.tipo === "pessoa"
      ? "min-h-[56px] py-1"
      : "min-h-[40px] pointer-coarse:min-h-[48px]",
    ativo && "bg-selecao",
  );
  const comum = {
    id,
    role: "option" as const,
    "aria-selected": ativo,
    "data-ativo": ativo ? "1" : undefined,
    // onMouseMove, não onMouseEnter: a lista que rola por baixo de um mouse
    // parado não pode trocar a escolha do teclado.
    onMouseMove: ativo ? undefined : aoApontar,
    // O mouse não tira o foco do campo.
    onMouseDown: (e: React.MouseEvent) => e.preventDefault(),
    onClick: aoEscolher,
    className: classe,
  };

  if (item.tipo === "pessoa") {
    const p = item.pessoa;
    return (
      <div {...comum}>
        <AvatarContato
          nome={p.nome}
          leadId={p.leadId}
          instagram={Boolean(p.instagram)}
          className="h-[32px] w-[32px] text-xs"
        />
        <span className="min-w-0 flex-1">
          <span className="tipo-destaque block truncate">{p.nome}</span>
          <span className="tipo-nota block truncate text-texto-2 tabular-nums">
            {linhaDaPessoa(p)}
          </span>
        </span>
        {/* Atalho do mouse e do toque para a ficha; no teclado é o
            Shift+Enter. Fora da ordem do Tab, como o resto da lista. */}
        <button
          type="button"
          tabIndex={-1}
          aria-hidden
          onClick={(e) => {
            e.stopPropagation();
            aoAbrirFicha();
          }}
          className="relative inline-flex h-[32px] shrink-0 items-center rounded-controle px-1 text-sm text-texto-2 transition-colors duration-[120ms] hover:bg-realce hover:text-tinta pointer-coarse:after:absolute pointer-coarse:after:inset-x-0 pointer-coarse:after:-inset-y-[6px]"
        >
          Ficha
        </button>
      </div>
    );
  }

  if (item.tipo === "area") {
    const Icone = item.area.icone;
    return (
      <div {...comum}>
        <Icone
          size={18}
          strokeWidth={1.75}
          aria-hidden
          className="shrink-0 text-texto-2"
        />
        <span className="tipo-corpo min-w-0 flex-1 truncate">
          {item.area.rotulo}
        </span>
        {item.area.atalho ? <Tecla>{item.area.atalho}</Tecla> : null}
      </div>
    );
  }

  if (item.tipo === "tema") {
    return (
      <div {...comum}>
        <Moon
          size={18}
          strokeWidth={1.75}
          aria-hidden
          className="shrink-0 text-texto-2 dark:hidden"
        />
        <Sun
          size={18}
          strokeWidth={1.75}
          aria-hidden
          className="hidden shrink-0 text-texto-2 dark:block"
        />
        <span className="tipo-corpo min-w-0 flex-1 truncate">
          {item.rotulo}
        </span>
      </div>
    );
  }

  if (item.tipo === "destino") {
    return (
      <div {...comum}>
        <span className="tipo-corpo min-w-0 flex-1 truncate">
          {item.destino.rotulo}
        </span>
      </div>
    );
  }

  return (
    <div {...comum}>
      <span className="tipo-corpo min-w-0 flex-1 truncate">
        {item.comando.rotulo}
      </span>
      {item.comando.atalho ? <Tecla>{item.comando.atalho}</Tecla> : null}
    </div>
  );
}
