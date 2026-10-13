"use client";

import { useEffect, useRef, useState, useTransition } from "react";
import Link from "next/link";
import {
  CalendarClock,
  ChevronDown,
  ChevronLeft,
  ChevronRight,
  Clock,
  FileText,
  Mail,
  MoreHorizontal,
  RotateCcw,
  Undo2,
  UserRound,
} from "lucide-react";
import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import { Chip } from "@/components/ui/etiqueta";
import { BOTAO_ICONE } from "@/components/app/form-styles";
import { pontoDaEtiqueta } from "@/app/(app)/contatos/cor-etiqueta";
import {
  alternarEtiquetaChat,
  alterarStatusConversaChat,
  definirResponsavelChat,
  marcarChatNaoLido,
  type PrazoAdiar,
} from "@/app/(app)/chat/actions";
import { IconeDaPessoa } from "@/app/(app)/chat/fotos";
import type {
  EtiquetaCatalogo,
  FerramentasDaConversa,
  MembroEquipe,
} from "@/app/(app)/chat/mensagem";
import {
  Folha,
  Grupo,
  ItemAcao,
  ItemSecao,
  ItensSecao,
  LinhaGrupo,
  MenuSuspenso,
  RotuloGrupo,
  TituloSecao,
} from "./folha";
import {
  CampoBuscaMenu,
  filtrarPorNome,
  ITENS_SEM_BUSCA,
  MensagemMenu,
} from "./barra-filtros";
import { hrefContatoDoChat } from "./links";

/*
 * Os menus da conversa aberta. No desktop, "Adiar ▾" e "⋯" abrem menus
 * suspensos ao lado do botão; no celular o "⋯" abre uma folha presa no pé,
 * com o adiar com prazo no alto (o cabeçalho do celular só tem ✓ e ⋯). O
 * compliance (só leitura) vê no ⋯ só o Resumo e a ficha.
 *
 * Cada mudança confirmada pelo servidor avisa o pai, que acerta a conversa
 * e a linha da fila no próprio estado: nada é recarregado por causa do menu.
 */

/** Os prazos que o servidor calcula; "data" é o "Escolher data e hora". */
export type PrazoRapido = Exclude<PrazoAdiar, "data">;

/**
 * Os prazos do adiar, do mais curto ao mais longo, com o "até responder"
 * no alto: é o stand-by de quem espera o retorno do cliente. H é o atalho
 * do "Até amanhã". `frase` entra na confirmação e no aviso da massa
 * ("Adiar 3 conversas por 1 hora?"). Depois deles, nos menus, vem o
 * "Escolher data e hora…".
 */
export const PRAZOS_ADIAR: {
  prazo: PrazoRapido;
  rotulo: string;
  frase: string;
  aviso: string;
}[] = [
  {
    prazo: "responder",
    rotulo: "Até a pessoa responder",
    frase: "até a pessoa responder",
    aviso: "Adiada até a pessoa responder",
  },
  {
    prazo: "1hora",
    rotulo: "Por 1 hora",
    frase: "por 1 hora",
    aviso: "Adiada por 1 hora",
  },
  {
    prazo: "amanha",
    rotulo: "Até amanhã",
    frase: "até amanhã",
    aviso: "Adiada até amanhã",
  },
  {
    prazo: "3dias",
    rotulo: "Por 3 dias",
    frase: "por 3 dias",
    aviso: "Adiada por 3 dias",
  },
  {
    prazo: "1semana",
    rotulo: "Por 1 semana",
    frase: "por 1 semana",
    aviso: "Adiada por 1 semana",
  },
];

/** O item que abre o diálogo de data e hora do adiar. */
export const ROTULO_ESCOLHER_DATA = "Escolher data e hora…";

/* ── Adiar ▾ (desktop) ────────────────────────────────────────────────── */

export function MenuAdiar({
  desativado,
  aoAdiar,
  aoEscolherData,
}: {
  desativado: boolean;
  aoAdiar: (prazo: PrazoRapido) => void;
  /** "Escolher data e hora…": o menu fecha e o diálogo abre. */
  aoEscolherData: () => void;
}) {
  const [aberto, setAberto] = useState(false);
  const gatilho = useRef<HTMLButtonElement>(null);
  return (
    <div className="relative">
      <Button
        ref={gatilho}
        variant="secondary"
        size="md"
        disabled={desativado}
        aria-haspopup="menu"
        aria-expanded={aberto}
        onClick={() => setAberto((v) => !v)}
        title="Adiar e ir para a próxima (H adia até amanhã)"
        icone={<Clock size={18} strokeWidth={1.75} aria-hidden />}
        aria-label="Adiar"
        className="px-1.5"
      >
        <span className="hidden @3xl:inline">Adiar</span>
        <ChevronDown size={16} strokeWidth={1.75} aria-hidden />
      </Button>
      <MenuSuspenso
        aberto={aberto}
        aoFechar={() => setAberto(false)}
        gatilho={gatilho}
        rotulo="Adiar até quando"
        className="w-[260px]"
      >
        {PRAZOS_ADIAR.map((p) => (
          <ItemAcao
            key={p.prazo}
            variante="menu"
            detalhe={p.prazo === "amanha" ? "H" : undefined}
            onClick={() => {
              setAberto(false);
              aoAdiar(p.prazo);
            }}
          >
            {p.rotulo}
          </ItemAcao>
        ))}
        <div role="separator" className="my-0.5 border-t border-fio" />
        <ItemAcao
          variante="menu"
          aria-haspopup="dialog"
          onClick={() => {
            setAberto(false);
            aoEscolherData();
          }}
        >
          {ROTULO_ESCOLHER_DATA}
        </ItemAcao>
      </MenuSuspenso>
    </div>
  );
}

/* ── ⋯ da conversa ────────────────────────────────────────────────────── */

/** Quem pede o ⋯ aberto numa seção: o painel dos dados do contato (as
 *  linhas Atendente e Etiquetas) e a paleta (Transferir para…, Etiquetas…).
 *  Cada pedido novo leva um `n` maior. */
export type PedidoMenuConversa = {
  qual: "atendente" | "etiquetas";
  n: number;
};

type Props = {
  leadId: string;
  nome: string;
  ferramentas: FerramentasDaConversa;
  equipe: MembroEquipe[] | null;
  etiquetas: EtiquetaCatalogo[] | null;
  /** Conversas abertas por pessoa, para a gestão atribuir vendo a carga.
   *  null = não é gestão ou ainda não leu. */
  carga: Map<string, number> | null;
  /** O endereço desta conversa com a fila em uso: a ficha volta para cá. */
  voltar: string;
  /** "folha" no celular (com o adiar), "menu" no desktop. */
  variante: "menu" | "folha";
  /** A conversa está adiada no prazo: oferece trazer de volta à Caixa. */
  adiada: boolean;
  /** O compliance só lê: o ⋯ fica com o Resumo e a ficha. */
  somenteLeitura?: boolean;
  /** Abrir o ⋯ já na seção pedida (o painel do contato, a paleta). */
  pedido?: PedidoMenuConversa | null;
  aoAdiar: (prazo: PrazoRapido) => void;
  /** "Escolher data e hora…" do adiar (só na folha do celular; no desktop
   *  ele mora no Adiar ▾). */
  aoEscolherData: () => void;
  /** "Agendar recontato…": o ⋯ fecha e o diálogo abre. */
  aoAgendarRecontato: () => void;
  aoReativar: () => void;
  aoResumir: () => void;
  /** O servidor gravou o novo dono. `antes` é quem atendia até aqui: o
   *  Desfazer do aviso devolve a conversa a essa pessoa. */
  aoAtribuir: (
    responsavelId: string | null,
    antes: { id: string; nome: string } | null,
  ) => void;
  aoEtiquetar: (tagId: string, marcar: boolean) => void;
  /** A lista pinta a linha de volta como não lida. */
  aoMarcarNaoLida: () => void;
  /** No clique, antes de a action sair: a marca de lida agendada não pode
   *  entrar na fila atrás dela e desfazê-la. */
  aoAntesDeMarcarNaoLida?: (leadId: string) => void;
  /** A action falhou: a marca de lida suspensa no clique volta. */
  aoFalharMarcarNaoLida?: (leadId: string) => void;
  /** A conversa voltou para a Caixa. */
  aoReabrir: () => void;
  /** A folha abriu ou fechou: o pai pede a carga da equipe ao abrir. */
  aoAbrir?: () => void;
};

/**
 * O ⋯ da conversa. Tocar numa etiqueta só liga ou desliga, e o ⋯ fica
 * aberto para marcar a seguinte (como no filtro de Etiquetas); só Atendente
 * e Adiar fecham, porque tiram a conversa do lugar. Com a equipe maior que
 * ITENS_SEM_BUSCA, a seção Atendente ganha a busca no topo (a mesma da
 * transferência em massa); Enter com uma pessoa só na busca transfere.
 *
 * No celular a folha vem na ordem do uso: Adiar, Etiquetas, a linha
 * "Atendente: Ana ›" (que abre a lista da equipe na própria folha, com
 * "‹ Voltar") e Conversa. Antes, a equipe inteira (uma linha de 48px por
 * pessoa) empurrava as etiquetas para mais de uma tela abaixo.
 */
export function MenuConversa(props: Props) {
  const {
    leadId,
    nome,
    ferramentas,
    equipe,
    etiquetas,
    carga,
    voltar,
    variante,
    adiada,
    somenteLeitura = false,
    pedido = null,
    aoAdiar,
    aoEscolherData,
    aoAgendarRecontato,
    aoReativar,
    aoResumir,
    aoAtribuir,
    aoEtiquetar,
    aoMarcarNaoLida,
    aoAntesDeMarcarNaoLida,
    aoFalharMarcarNaoLida,
    aoReabrir,
    aoAbrir,
  } = props;
  const [aberto, setAberto] = useState(false);
  const [pendente, iniciar] = useTransition();
  const [erro, setErro] = useState<string | null>(null);
  // As etiquetas que estão gravando agora: cada uma trava só a si mesma, e
  // o toque na seguinte não espera a anterior voltar.
  const [etiquetasGravando, setEtiquetasGravando] = useState<
    ReadonlySet<string>
  >(() => new Set());
  // Na folha do celular: o começo ou a lista da equipe ("Atendente: Ana ›").
  const [vista, setVista] = useState<"inicio" | "atendente">("inicio");
  const [termo, setTermo] = useState("");
  const gatilho = useRef<HTMLButtonElement>(null);
  const secaoAtendenteRef = useRef<HTMLDivElement>(null);
  const secaoEtiquetasRef = useRef<HTMLDivElement>(null);
  const linhaAtendenteRef = useRef<HTMLButtonElement>(null);
  const voltarAtendenteRef = useRef<HTMLButtonElement>(null);
  // A seção que o pedido quer em foco, depois de o menu abrir, e o último
  // pedido já atendido (o efeito não foca duas vezes o mesmo).
  const [secaoPedida, setSecaoPedida] = useState<PedidoMenuConversa | null>(
    null,
  );
  const secaoAtendidaRef = useRef(pedido?.n ?? 0);

  // Trocar de forma (girar o tablet, alargar a janela) com o menu aberto o
  // fecharia num lugar e o abriria no outro: fecha.
  const [varianteAntes, setVarianteAntes] = useState(variante);
  if (variante !== varianteAntes) {
    setVarianteAntes(variante);
    setAberto(false);
  }

  // Cada abertura começa do começo: a folha no início e a busca vazia
  // (ajuste durante o render).
  const [abertoAntes, setAbertoAntes] = useState(aberto);
  if (aberto !== abertoAntes) {
    setAbertoAntes(aberto);
    if (aberto) {
      setVista("inicio");
      setTermo("");
    }
  }

  // O painel do contato ou a paleta pediram uma seção: abre nela (ajuste
  // durante o render). No celular, "atendente" já abre a lista da equipe.
  const [pedidoVisto, setPedidoVisto] = useState(pedido?.n ?? 0);
  if (pedido && pedido.n !== pedidoVisto) {
    setPedidoVisto(pedido.n);
    setErro(null);
    setAberto(true);
    setAbertoAntes(true);
    setTermo("");
    setVista(
      variante === "folha" && pedido.qual === "atendente"
        ? "atendente"
        : "inicio",
    );
    setSecaoPedida(pedido);
  }

  const aoAbrirRef = useRef(aoAbrir);
  useEffect(() => {
    aoAbrirRef.current = aoAbrir;
  });
  useEffect(() => {
    if (aberto) aoAbrirRef.current?.();
  }, [aberto]);

  // O foco na seção pedida. Roda depois do menu (filho), que pôs o foco no
  // primeiro item. Na folha o foco fica nela (um campo abriria o teclado),
  // salvo a lista da equipe, que leva o foco ao "‹ Voltar".
  useEffect(() => {
    if (!aberto || !secaoPedida) return;
    if (secaoAtendidaRef.current === secaoPedida.n) return;
    secaoAtendidaRef.current = secaoPedida.n;
    if (variante === "folha") return;
    const secao =
      secaoPedida.qual === "atendente"
        ? secaoAtendenteRef.current
        : secaoEtiquetasRef.current;
    secao
      ?.querySelector<HTMLElement>("[data-item]:not([disabled])")
      ?.focus({ preventScroll: false });
  }, [aberto, secaoPedida, variante]);

  // A folha trocou de vista com ela aberta: o botão que tinha o foco saiu
  // junto. Vai ao "‹ Voltar" (entrando na equipe) ou à linha "Atendente"
  // (voltando). Na abertura, quem cuida do foco é a folha.
  const anteriorRef = useRef({ vista, aberto });
  useEffect(() => {
    const antes = anteriorRef.current;
    anteriorRef.current = { vista, aberto };
    if (!aberto || !antes.aberto || antes.vista === vista) return;
    (vista === "atendente"
      ? voltarAtendenteRef.current
      : linhaAtendenteRef.current
    )?.focus({ preventScroll: true });
  }, [vista, aberto]);

  const fechar = () => setAberto(false);

  /**
   * Roda a ação e, confirmada, avisa o pai. O menu fica ABERTO até saber o
   * desfecho: fechado antes, o erro não teria onde aparecer. `fechar`:
   * confirmada, fecha (Atendente); sem ele, fica aberto.
   */
  const executar = (
    acao: () => Promise<{ ok?: boolean; erro?: string }>,
    aoConcluir: () => void,
    aoFalhar?: () => void,
    { fecharAoConcluir = true }: { fecharAoConcluir?: boolean } = {},
  ) => {
    setErro(null);
    iniciar(async () => {
      let r: { ok?: boolean; erro?: string };
      try {
        r = await acao();
      } catch {
        r = { erro: "Sem resposta do servidor. Tente de novo." };
      }
      if (r.erro) {
        aoFalhar?.();
        setErro(r.erro);
        return;
      }
      aoConcluir();
      if (fecharAoConcluir) setAberto(false);
    });
  };

  /** Liga ou desliga uma etiqueta. O ⋯ fica aberto: marcar VIP e Retorno
   *  é um toque em cada, sem abrir o menu de novo. */
  const alternarEtiqueta = async (tagId: string, marcar: boolean) => {
    if (etiquetasGravando.has(tagId)) return;
    setErro(null);
    setEtiquetasGravando((atual) => new Set(atual).add(tagId));
    let r: { ok?: boolean; erro?: string };
    try {
      r = await alternarEtiquetaChat(leadId, tagId, marcar);
    } catch {
      r = { erro: "Sem resposta do servidor. Tente de novo." };
    }
    setEtiquetasGravando((atual) => {
      const novo = new Set(atual);
      novo.delete(tagId);
      return novo;
    });
    if (r.erro) {
      setErro(r.erro);
      return;
    }
    aoEtiquetar(tagId, marcar);
  };

  // E então fecha e roda: o pai pode trocar de conversa (adiar segue para a
  // próxima), e o menu não pode ficar aberto sobre a conversa seguinte.
  const fecharE = (acao: () => void) => {
    setAberto(false);
    acao();
  };

  const marcadas = new Set(ferramentas.etiquetasLead ?? []);
  // Arquivada some da escolha, mas segue à vista no contato que a tem:
  // senão não haveria como tirá-la.
  const etiquetasVisiveis =
    etiquetas && ferramentas.etiquetasLead
      ? etiquetas.filter((t) => t.ativo || marcadas.has(t.id))
      : null;
  // Quem atende pode ter saído da equipe ativa: entra na lista para ela não
  // fingir que a conversa está sem dono.
  const pessoas: MembroEquipe[] = equipe
    ? ferramentas.responsavelId &&
      !equipe.some((p) => p.id === ferramentas.responsavelId)
      ? [
          {
            id: ferramentas.responsavelId,
            nome: ferramentas.responsavelNome ?? "Atendente inativo",
          },
          ...equipe,
        ]
      : equipe
    : [];
  const destinos: MembroEquipe[] = [{ id: "", nome: "Sem dono" }, ...pessoas];
  const comBusca = destinos.length > ITENS_SEM_BUSCA;
  const destinosVisiveis = filtrarPorNome(destinos, termo);
  const donoAntes = ferramentas.responsavelId
    ? {
        id: ferramentas.responsavelId,
        nome: ferramentas.responsavelNome ?? "Atendente",
      }
    : null;

  const menu = variante === "menu";
  const fichaHref = hrefContatoDoChat(leadId, voltar);

  const itemCarga = (id: string) => {
    const n = carga?.get(id);
    if (n === undefined) return undefined;
    return (
      <>
        <span aria-hidden>{n.toLocaleString("pt-BR")}</span>
        <span className="sr-only">
          , {n === 1 ? "1 conversa aberta" : `${n.toLocaleString("pt-BR")} conversas abertas`}
        </span>
      </>
    );
  };

  const transferir = (p: MembroEquipe) => {
    const atual = (ferramentas.responsavelId ?? "") === p.id;
    if (atual || pendente) return;
    const novo = p.id || null;
    executar(
      () => definirResponsavelChat(leadId, novo),
      () => aoAtribuir(novo, donoAntes),
    );
  };

  // Com a equipe grande, a busca: Enter com uma pessoa só na lista
  // transfere para ela; com mais, vai à primeira.
  const buscaEquipe = comBusca ? (
    <CampoBuscaMenu
      valor={termo}
      aoMudar={setTermo}
      rotulo="Buscar pessoa"
      placeholder="Buscar pessoa"
      aoEnter={() => {
        if (destinosVisiveis.length !== 1) return false;
        transferir(destinosVisiveis[0]);
        return true;
      }}
    />
  ) : null;

  const listaEquipe =
    destinosVisiveis.length === 0 ? (
      <MensagemMenu menu={menu}>Ninguém com “{termo.trim()}”.</MensagemMenu>
    ) : (
      <ItensSecao menu={menu}>
        {destinosVisiveis.map((p) => {
          const atual = (ferramentas.responsavelId ?? "") === p.id;
          return (
            <ItemSecao key={p.id || "ninguem"} menu={menu}>
              <ItemAcao
                variante={variante}
                papel="menuitemradio"
                marcado={atual}
                disabled={pendente}
                icone={<IconeDaPessoa id={p.id || null} nome={p.nome} />}
                detalhe={p.id ? itemCarga(p.id) : undefined}
                onClick={() => transferir(p)}
              >
                {p.nome}
              </ItemAcao>
            </ItemSecao>
          );
        })}
      </ItensSecao>
    );

  // Desktop: a seção inteira no menu, com a busca no topo dela.
  const secaoAtendente =
    equipe && !somenteLeitura ? (
      <div ref={secaoAtendenteRef}>
        <TituloSecao menu={menu}>Atendente</TituloSecao>
        {buscaEquipe ? <div className="pb-0.5">{buscaEquipe}</div> : null}
        {listaEquipe}
      </div>
    ) : null;

  // Celular: uma linha com quem atende, que abre a lista na própria folha.
  const linhaAtendente =
    equipe && !somenteLeitura ? (
      <>
        <RotuloGrupo>Atendente</RotuloGrupo>
        <Grupo>
          <LinhaGrupo>
            <button
              ref={linhaAtendenteRef}
              type="button"
              onClick={() => {
                setTermo("");
                setVista("atendente");
              }}
              className="flex min-h-[48px] w-full items-center gap-1.5 pl-1.5 text-left text-tinta transition-colors duration-[120ms] outline-none hover:bg-realce active:bg-pressionado focus-visible:outline-2 focus-visible:-outline-offset-2 focus-visible:outline-tinta"
            >
              <span className="flex min-w-0 flex-1 items-center gap-1 self-stretch py-1 pr-1.5">
                <span className="tipo-corpo shrink-0">Atendente</span>
                <span
                  className={cn(
                    "tipo-corpo min-w-0 flex-1 truncate text-right",
                    ferramentas.responsavelId ? "text-texto-2" : "text-atencao",
                  )}
                >
                  <span className="sr-only">: </span>
                  {ferramentas.responsavelId
                    ? (ferramentas.responsavelNome ?? "Atendente")
                    : "Sem dono"}
                </span>
                <ChevronRight
                  size={18}
                  strokeWidth={1.75}
                  aria-hidden
                  className="shrink-0 text-texto-3"
                />
              </span>
            </button>
          </LinhaGrupo>
        </Grupo>
      </>
    ) : null;

  const secaoEtiquetas =
    !somenteLeitura && etiquetasVisiveis && etiquetasVisiveis.length > 0 ? (
      <div ref={secaoEtiquetasRef}>
        <TituloSecao menu={menu}>Etiquetas</TituloSecao>
        {/* p-0.5: a caixa rolável recorta nos quatro lados, e sem esta
            folga o anel de foco do chip saía cortado. */}
        <div
          role="group"
          aria-label="Etiquetas"
          className={cn(
            "flex flex-wrap gap-1 p-0.5 pointer-coarse:gap-1.5",
            menu ? "px-1 pb-1" : "pt-0.5 pb-1",
          )}
        >
          {etiquetasVisiveis.map((t) => {
            const ativa = marcadas.has(t.id);
            const gravando = etiquetasGravando.has(t.id);
            return (
              // Gravando, o chip não se desativa: desativado, largava o foco
              // no body com o ⋯ aberto (as setas e o Esc paravam, e a
              // próxima letra virava atalho do chat). O toque repetido é
              // ignorado em alternarEtiqueta.
              <Chip
                key={t.id}
                data-item=""
                ativo={ativa}
                cor={pontoDaEtiqueta(t.cor)}
                aria-disabled={gravando || undefined}
                aria-busy={gravando || undefined}
                className={gravando ? "opacity-60" : undefined}
                onClick={() => void alternarEtiqueta(t.id, !ativa)}
              >
                {t.nome}
              </Chip>
            );
          })}
        </div>
      </div>
    ) : null;

  const linkFicha = (
    <Link
      href={fichaHref}
      data-item=""
      role={menu ? "menuitem" : undefined}
      className={cn(
        "flex w-full items-center text-left text-tinta transition-colors duration-[120ms] outline-none hover:bg-realce focus-visible:outline-2 focus-visible:-outline-offset-2 focus-visible:outline-tinta",
        menu
          ? "min-h-[40px] gap-1 rounded-controle px-1 focus:bg-realce"
          : "min-h-[48px] gap-1.5 pl-1.5",
      )}
    >
      <span aria-hidden className="flex w-[20px] shrink-0 justify-center text-texto-2">
        <UserRound size={18} strokeWidth={1.75} />
      </span>
      <span
        className={cn(
          "tipo-corpo flex min-w-0 flex-1 items-center self-stretch",
          menu ? "py-0.5" : "border-t border-fio py-1 pr-1.5 group-first/linha:border-t-0",
        )}
      >
        Ver ficha do contato
      </span>
    </Link>
  );

  const secaoAcoes = (
    <>
      {menu ? (
        // Só leitura, o ⋯ começa aqui: sem separador no alto.
        somenteLeitura ? null : (
          <div role="separator" className="my-0.5 border-t border-fio" />
        )
      ) : (
        <TituloSecao menu={false}>Conversa</TituloSecao>
      )}
      <ItensSecao menu={menu}>
        {!somenteLeitura ? (
          <ItemSecao menu={menu}>
            <ItemAcao
              variante={variante}
              icone={<CalendarClock size={18} strokeWidth={1.75} />}
              aria-haspopup="dialog"
              onClick={() => fecharE(aoAgendarRecontato)}
            >
              Agendar recontato…
            </ItemAcao>
          </ItemSecao>
        ) : null}
        <ItemSecao menu={menu}>
          <ItemAcao
            variante={variante}
            icone={<FileText size={18} strokeWidth={1.75} />}
            onClick={() => fecharE(aoResumir)}
          >
            Resumo da conversa
          </ItemAcao>
        </ItemSecao>
        {!somenteLeitura ? (
          <ItemSecao menu={menu}>
            <ItemAcao
              variante={variante}
              icone={<Mail size={18} strokeWidth={1.75} />}
              disabled={pendente}
              onClick={() => {
                aoAntesDeMarcarNaoLida?.(leadId);
                executar(
                  () => marcarChatNaoLido(leadId),
                  aoMarcarNaoLida,
                  () => aoFalharMarcarNaoLida?.(leadId),
                );
              }}
            >
              Marcar como não lida
            </ItemAcao>
          </ItemSecao>
        ) : null}
        {adiada && !somenteLeitura ? (
          <ItemSecao menu={menu}>
            <ItemAcao
              variante={variante}
              icone={<RotateCcw size={18} strokeWidth={1.75} />}
              onClick={() => fecharE(aoReativar)}
            >
              Voltar para a Caixa agora
            </ItemAcao>
          </ItemSecao>
        ) : null}
        {ferramentas.conversaResolvida && !somenteLeitura ? (
          <ItemSecao menu={menu}>
            <ItemAcao
              variante={variante}
              icone={<Undo2 size={18} strokeWidth={1.75} />}
              disabled={pendente}
              onClick={() =>
                executar(
                  () => alterarStatusConversaChat(leadId, "open"),
                  aoReabrir,
                )
              }
            >
              Reabrir conversa
            </ItemAcao>
          </ItemSecao>
        ) : null}
        <ItemSecao menu={menu}>{linkFicha}</ItemSecao>
      </ItensSecao>
    </>
  );

  const avisoErro = erro ? (
    <p role="alert" className={cn("tipo-nota text-erro", menu ? "px-1 py-0.5" : "pt-1.5")}>
      {erro}
    </p>
  ) : null;

  const rotuloGatilho = somenteLeitura
    ? "Resumo e ficha do contato"
    : "Atendente, etiquetas e mais";

  // Na lista da equipe (folha), o Esc volta ao começo em vez de fechar. Na
  // captura, antes da folha; a busca com texto limpa antes.
  const aoTeclarAntes = (e: React.KeyboardEvent<HTMLDivElement>) => {
    if (e.key !== "Escape" || menu || vista !== "atendente") return;
    const alvo = e.target;
    if (
      alvo instanceof HTMLInputElement &&
      alvo.type === "search" &&
      alvo.value !== ""
    ) {
      return;
    }
    e.preventDefault();
    e.stopPropagation();
    setVista("inicio");
  };

  return (
    <div className="relative" onKeyDownCapture={aoTeclarAntes}>
      <button
        ref={gatilho}
        type="button"
        aria-label={rotuloGatilho}
        title={rotuloGatilho}
        aria-haspopup={menu ? "menu" : "dialog"}
        aria-expanded={aberto}
        onClick={() => {
          setErro(null);
          setAberto((v) => !v);
        }}
        className={cn(BOTAO_ICONE, aberto && "bg-realce text-tinta")}
      >
        <MoreHorizontal size={20} strokeWidth={1.75} aria-hidden />
      </button>

      {menu ? (
        <MenuSuspenso
          aberto={aberto}
          aoFechar={fechar}
          gatilho={gatilho}
          rotulo={rotuloGatilho}
          papel="dialog"
          className="w-[300px]"
        >
          {avisoErro}
          {secaoAtendente}
          {secaoEtiquetas}
          {secaoAcoes}
        </MenuSuspenso>
      ) : (
        <Folha
          aberta={aberto}
          aoFechar={fechar}
          titulo={vista === "atendente" ? "Atendente" : nome}
          retorno={gatilho}
        >
          {avisoErro}
          {vista === "atendente" ? (
            <>
              <div className="pb-1">
                <button
                  ref={voltarAtendenteRef}
                  type="button"
                  onClick={() => setVista("inicio")}
                  aria-label={`Voltar: ${nome}`}
                  title="Voltar (Esc)"
                  className="tipo-corpo -ml-1 inline-flex h-[44px] items-center gap-0.5 rounded-controle pr-1 text-tinta transition-[background-color,color] duration-[120ms] hover:bg-realce active:bg-pressionado focus-visible:outline-2 focus-visible:-outline-offset-2 focus-visible:outline-tinta"
                >
                  <ChevronLeft size={20} strokeWidth={1.75} aria-hidden />
                  Voltar
                </button>
              </div>
              {buscaEquipe ? <div className="pt-1 pb-1">{buscaEquipe}</div> : null}
              {listaEquipe}
            </>
          ) : (
            <>
              {/* Resolvida não se adia, como no desktop (lá o Adiar ▾ some). */}
              {!ferramentas.conversaResolvida && !somenteLeitura ? (
                <>
                  <RotuloGrupo>Adiar e ir para a próxima</RotuloGrupo>
                  <Grupo>
                    {PRAZOS_ADIAR.map((p) => (
                      <LinhaGrupo key={p.prazo}>
                        <ItemAcao
                          variante="folha"
                          onClick={() => fecharE(() => aoAdiar(p.prazo))}
                        >
                          {p.rotulo}
                        </ItemAcao>
                      </LinhaGrupo>
                    ))}
                    <LinhaGrupo>
                      <ItemAcao
                        variante="folha"
                        aria-haspopup="dialog"
                        onClick={() => fecharE(aoEscolherData)}
                      >
                        {ROTULO_ESCOLHER_DATA}
                      </ItemAcao>
                    </LinhaGrupo>
                  </Grupo>
                </>
              ) : null}
              {secaoEtiquetas}
              {linhaAtendente}
              {secaoAcoes}
            </>
          )}
        </Folha>
      )}
    </div>
  );
}
