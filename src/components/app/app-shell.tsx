"use client";

import { useEffect, useRef, useState, type RefObject } from "react";
import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import {
  ChartColumn,
  ChevronRight,
  CircleUserRound,
  Ellipsis,
  Eye,
  LogOut,
  Megaphone,
  MessageSquare,
  PanelLeftClose,
  PanelLeftOpen,
  Search,
  Settings,
  Users,
  X,
  type LucideIcon,
} from "lucide-react";
import { cn } from "@/lib/utils";
import {
  entradaDaAdministracao,
  rotuloPapel,
  type Papel,
} from "@/lib/papeis";
import { Marca, MarcaZ } from "@/components/ui/marca";
import { AlternadorTema } from "./alternador-tema";
import { AvatarPessoa } from "./avatar-pessoa";
import { BOTAO_ICONE } from "./form-styles";
import { destinosDoPapel } from "./destinos";
import { ContadorNaoLidas, NaoLidasParaLeitor } from "./nao-lidas";
import {
  abrirPaleta,
  AVISO_ENVIO_EM_VOO,
  ehMac,
  haEnvioEmVoo,
  PaletaGlobal,
  useEhMac,
  type AreaPaleta,
} from "./paleta-global";
import { NOME_DO_PRODUTO } from "@/lib/marca";

/*
 * A casca do app.
 *
 * - Desktop (de lg para cima): menu na lateral, como era antes da cápsula
 *   (pedido do Artur depois de ver a cápsula no topo). Marca no alto, a
 *   busca (⌘K), as áreas em lista com ícone e rótulo, e no pé a conta (que
 *   leva a Minha conta), o tema e o Sair. No /chat o menu recolhe para um
 *   trilho de ícones, e a pessoa pode abri-lo; a escolha fica no cookie
 *   "menu-chat", lido no SSR. Alt+1 a Alt+4 (⌘1 a ⌘4 no Mac) trocam de área;
 *   a dica do item mostra a tecla.
 * - Celular e tablet (abaixo de lg): sem menu nem cabeçalho. Barra de abas
 *   de vidro flutuando no pé, com no máximo cinco itens; o "Mais" abre uma
 *   folha presa no pé com a busca, a Administração, Minha conta, o tema e o
 *   Sair. A folha entra no histórico: o voltar do sistema a fecha, em vez de
 *   sair da tela. A barra some com o teclado aberto e com diálogo aberto, e
 *   respeita a área segura do iPhone.
 *
 * Administração é uma entrada só desde 09/10/2026 (no lugar de Log de
 * acesso, Administração e Configurações): a gestão abre o índice (/admin) e
 * o compliance vai direto ao Log de acesso, que é o que ele vê ali.
 *
 * O que a casca ocupa vai em variáveis no elemento [data-casca] (globals.css):
 * --casca-topo e --casca-pe. Uma tela pede a tela inteira (a conversa aberta
 * no celular) pondo o atributo data-sem-abas em qualquer elemento dela, ou
 * renderizando <EsconderAbas />: enquanto ele existir, a barra some e o recuo
 * dela zera. Puro CSS (:has), sem efeito nem piscada na hidratação.
 */

type Modulo = {
  href: string;
  label: string;
  icon: LucideIcon;
  /** Sem lista = todo mundo vê. */
  papeis?: Papel[];
  /** Área principal: abre o menu, vai na barra de abas e tem atalho de
   *  teclado. O resto mora abaixo, no menu, e no "Mais" do celular. */
  principal: boolean;
};

export const MODULOS: Modulo[] = [
  { href: "/chat", label: "Chat", icon: MessageSquare, principal: true },
  { href: "/contatos", label: "Contatos", icon: Users, principal: true },
  {
    href: "/campanhas",
    label: "Disparos",
    icon: Megaphone,
    papeis: ["admin", "gestor"],
    principal: true,
  },
  {
    href: "/relatorios",
    label: "Relatório",
    icon: ChartColumn,
    papeis: ["admin", "gestor", "compliance"],
    principal: true,
  },
  {
    // O endereço muda com o papel (entradaDaAdministracao): o compliance
    // entra direto no Log de acesso. Ativo em qualquer /admin/*.
    href: "/admin",
    label: "Administração",
    icon: Settings,
    papeis: ["admin", "gestor", "compliance"],
    principal: false,
  },
];

/**
 * Palavras que acham a área na busca ⌘K, além do nome. A Administração
 * depende do papel: a busca só promete o que a pessoa vê lá. O compliance
 * entra direto no Log de acesso; Equipe e Privacidade são só do admin.
 */
function sinonimosDaArea(href: string, papel: Papel): string | undefined {
  if (!href.startsWith("/admin")) return undefined;
  if (papel === "compliance") return "log de acesso auditoria acessos";
  const comuns =
    "configuracoes ajustes admin log de acesso auditoria etiquetas mensagens prontas padrao respostas rapidas whatsapp instagram direct importar";
  return papel === "admin" ? `${comuns} equipe usuarios privacidade` : comuns;
}

export type Perfil = {
  nome: string;
  email: string;
  papel: Papel;
  /** A foto que a pessoa pôs em Minha conta (fotosDaEquipe); sem ela, as
   *  iniciais. */
  foto?: string | null;
};

/** Minha conta: vale para todo papel e não é área do menu (mora no pé do
 *  menu lateral, na folha do "Mais" e no "Ir para" da paleta). */
const CAMINHO_CONTA = "/conta";

/** A rota está dentro da área? A Administração vale para qualquer
 *  /admin/* (o Log de acesso é uma subpágina dela). */
function estaEm(href: string, pathname: string): boolean {
  const raiz = href.startsWith("/admin") ? "/admin" : href;
  return pathname === raiz || pathname.startsWith(`${raiz}/`);
}

/** Rotas de altura travada: a casca dá ao filho a altura útil inteira. */
function ehTelaCheia(pathname: string): boolean {
  return pathname === "/chat" || pathname.startsWith("/chat/");
}

/**
 * Pede a tela inteira no celular: enquanto este marcador estiver montado, a
 * barra de abas some e o conteúdo perde o recuo dela. É o que a conversa
 * aberta do /chat usa (ela ocupa a tela, com o "← Caixa" no topo). Pode ser
 * renderizado em componente de servidor.
 */
export function EsconderAbas() {
  return <span hidden data-sem-abas="" />;
}

const UM_ANO_EM_SEGUNDOS = 60 * 60 * 24 * 365;

export function AppShell({
  perfil,
  menuChatExpandido = false,
  children,
}: {
  perfil: Perfil;
  /** Cookie "menu-chat" lido no SSR: o primeiro quadro do /chat já vem com
   *  o menu na largura escolhida, sem pular depois da hidratação. */
  menuChatExpandido?: boolean;
  children: React.ReactNode;
}) {
  const pathname = usePathname();
  const itens = MODULOS.filter(
    (m) => !m.papeis || m.papeis.includes(perfil.papel),
  ).map((m) =>
    m.href === "/admin"
      ? { ...m, href: entradaDaAdministracao(perfil.papel) ?? m.href }
      : m,
  );
  const principais = itens.filter((m) => m.principal);
  const extras = itens.filter((m) => !m.principal);
  const compliance = perfil.papel === "compliance";
  const telaCheia = ehTelaCheia(pathname);
  const mac = useEhMac();
  const tecla = mac
    ? { rotulo: "⌘", aria: "Meta" }
    : { rotulo: "Alt+", aria: "Alt" };

  useTecladoMedido();
  const avisoAtalho = useAtalhosDeArea(
    principais.map((m) => m.href).join("|"),
  );

  // No chat a conversa é quem precisa do espaço: o menu recolhe sozinho para
  // o trilho de ícones, e quem preferir o menu cheio abre pelo botão. A
  // escolha vale só para o chat e fica no cookie (o estado em memória faz o
  // botão funcionar mesmo sem cookie).
  const [expandidoNoChat, setExpandidoNoChat] = useState(menuChatExpandido);
  const recolhido = telaCheia && !expandidoNoChat;
  const alternarLargura = () => {
    const novo = !expandidoNoChat;
    setExpandidoNoChat(novo);
    document.cookie = `menu-chat=${novo ? "expandido" : "recolhido"}; path=/; max-age=${UM_ANO_EM_SEGUNDOS}; samesite=lax`;
  };

  // A folha do "Mais" guarda a rota em que abriu: trocou de rota (um link da
  // folha, o voltar do navegador), ela fecha sozinha. A rota velha é zerada
  // ainda na renderização, sem efeito, para a folha não reabrir quando a
  // pessoa voltar àquela rota.
  const [folhaEm, setFolhaEm] = useState<string | null>(null);
  if (folhaEm !== null && folhaEm !== pathname) setFolhaEm(null);
  const folhaAberta = folhaEm === pathname;
  const botaoMais = useRef<HTMLButtonElement>(null);
  const folha = useFolhaNaHistoria(pathname, setFolhaEm);

  const areas: AreaPaleta[] = [
    ...itens.map((m) => {
      const posicao = principais.indexOf(m);
      return {
        href: m.href,
        rotulo: m.label,
        icone: m.icon,
        atalho: posicao >= 0 ? `${tecla.rotulo}${posicao + 1}` : undefined,
        sinonimos: sinonimosDaArea(m.href, perfil.papel),
      };
    }),
    {
      href: CAMINHO_CONTA,
      rotulo: "Minha conta",
      icone: CircleUserRound,
      // "senha" e "nome" ficam para os destinos da Conta (Trocar minha
      // senha, Mudar meu nome): o Enter cai direto no formulário.
      sinonimos: "conta perfil",
    },
  ];

  return (
    <div
      data-casca=""
      data-compliance={compliance ? "" : undefined}
      // Com viewport-fit=cover, o iPhone deitado põe o entalhe sobre a
      // lateral: o conteúdo recua a área segura dos lados.
      className="flex min-h-full flex-1 pr-[env(safe-area-inset-right)] pl-[env(safe-area-inset-left)]"
    >
      <a
        href="#conteudo"
        className="sr-only rounded-controle bg-tinta px-2 py-1 text-sm font-semibold text-fundo focus:not-sr-only focus:fixed focus:top-1 focus:left-1 focus:z-[80]"
      >
        Pular para o conteúdo
      </a>

      <MenuLateral
        perfil={perfil}
        principais={principais}
        extras={extras}
        pathname={pathname}
        recolhido={recolhido}
        noChat={telaCheia}
        alternarLargura={alternarLargura}
        tecla={tecla}
        teclaPaleta={mac ? "⌘K" : "Ctrl+K"}
      />

      <div className="flex min-w-0 flex-1 flex-col">
        {compliance ? <FaixaSomenteLeitura /> : null}

        <main
          id="conteudo"
          tabIndex={-1}
          className={cn(
            "min-w-0 outline-none",
            // O /chat tem altura travada: o main fica com a altura útil (a
            // janela menos a casca) e o filho estica até ela, seja qual for a
            // altura que ele mesmo pede. As outras telas rolam o documento e
            // ganham o recuo da barra de abas no pé.
            telaCheia
              ? "h-util flex-none overflow-hidden [&>*]:h-full! [&>*]:min-h-0"
              : "flex-1 pb-[var(--casca-pe)]",
          )}
        >
          {children}
        </main>
      </div>

      <BarraDeAbas
        principais={principais}
        extras={extras}
        pathname={pathname}
        folhaAberta={folhaAberta}
        botaoMais={botaoMais}
        alternarFolha={() => (folhaAberta ? folha.fechar() : folha.abrir())}
      />

      <FolhaMais
        aberta={folhaAberta}
        fechar={folha.fechar}
        sairPorLink={folha.sairPorLink}
        botaoMais={botaoMais}
        perfil={perfil}
        extras={extras}
        pathname={pathname}
      />

      <PaletaGlobal areas={areas} destinos={destinosDoPapel(perfil.papel)} />

      {/* O atalho de área que o envio no ar segurou, só para o leitor de
          tela: na tela, ficar onde está já é a resposta. */}
      <p role="status" className="sr-only">
        {avisoAtalho}
      </p>
    </div>
  );
}

/* ── Menu lateral do desktop ──────────────────────────────────────────── */

function MenuLateral({
  perfil,
  principais,
  extras,
  pathname,
  recolhido,
  noChat,
  alternarLargura,
  tecla,
  teclaPaleta,
}: {
  perfil: Perfil;
  principais: Modulo[];
  extras: Modulo[];
  pathname: string;
  recolhido: boolean;
  noChat: boolean;
  alternarLargura: () => void;
  /** Como a dica e o aria-keyshortcuts escrevem a tecla das áreas. */
  tecla: { rotulo: string; aria: string };
  teclaPaleta: string;
}) {
  const papel = rotuloPapel(perfil.papel);
  const naConta = estaEm(CAMINHO_CONTA, pathname);

  return (
    // No tom do cartão e sem fio: a separação do conteúdo é o tom (ficha,
    // material chapado). Fica parado no alto enquanto a página rola.
    <aside
      className={cn(
        "sticky top-0 hidden h-dvh shrink-0 flex-col overflow-hidden bg-cartao lg:flex",
        "motion-safe:transition-[width] motion-safe:duration-[180ms] motion-safe:ease-padrao",
        recolhido ? "w-[64px]" : "w-[240px]",
      )}
    >
      <div
        className={cn(
          "flex h-[64px] shrink-0 items-center",
          recolhido ? "justify-center" : "px-1.5",
        )}
      >
        <Link
          href="/chat"
          title={recolhido ? NOME_DO_PRODUTO : undefined}
          className={cn(
            "flex h-[40px] items-center rounded-controle transition-colors duration-[120ms] hover:bg-realce focus-visible:outline-2 focus-visible:-outline-offset-2 focus-visible:outline-tinta pointer-coarse:h-[44px]",
            recolhido ? "w-[48px] justify-center" : "px-1",
          )}
        >
          {recolhido ? (
            <>
              <MarcaZ className="h-[20px] text-tinta" />
              <span className="sr-only">{NOME_DO_PRODUTO}</span>
            </>
          ) : (
            <Marca />
          )}
        </Link>
      </div>

      <div
        className={cn("shrink-0", recolhido ? "flex justify-center" : "px-1")}
      >
        <button
          type="button"
          onClick={() => abrirPaleta()}
          aria-keyshortcuts="Meta+K Control+K"
          aria-label={recolhido ? "Buscar" : undefined}
          title={`Buscar pessoa, área ou comando (${teclaPaleta})`}
          className={cn(
            "flex h-[40px] items-center rounded-controle bg-fundo text-texto-2 transition-colors duration-[120ms] hover:text-tinta focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-tinta pointer-coarse:h-[44px]",
            recolhido ? "w-[48px] justify-center" : "w-full gap-1 pr-1 pl-1.5",
          )}
        >
          <Search
            size={18}
            strokeWidth={1.75}
            aria-hidden
            className="shrink-0"
          />
          {recolhido ? null : (
            <>
              <span className="tipo-corpo min-w-0 flex-1 truncate text-left">
                Buscar
              </span>
              <kbd className="inline-flex h-[24px] items-center rounded-celula bg-cartao px-0.5 text-xs text-texto-2">
                {teclaPaleta}
              </kbd>
            </>
          )}
        </button>
      </div>

      <nav
        aria-label="Áreas"
        className="min-h-0 flex-1 overflow-x-hidden overflow-y-auto px-1 pt-2 pb-1"
      >
        <ul className="flex flex-col gap-0.5">
          {principais.map((m, i) => (
            <li key={m.href}>
              <ItemMenu
                modulo={m}
                pathname={pathname}
                recolhido={recolhido}
                atalho={`${tecla.rotulo}${i + 1}`}
                atalhoAria={`${tecla.aria}+${i + 1}`}
              />
            </li>
          ))}
        </ul>
        {extras.length > 0 ? (
          <ul className="mt-3 flex flex-col gap-0.5">
            {extras.map((m) => (
              <li key={m.href}>
                <ItemMenu
                  modulo={m}
                  pathname={pathname}
                  recolhido={recolhido}
                />
              </li>
            ))}
          </ul>
        ) : null}
      </nav>

      {noChat ? (
        <div className="shrink-0 px-1 pb-0.5">
          <button
            type="button"
            onClick={alternarLargura}
            title={recolhido ? "Expandir o menu" : "Recolher o menu"}
            className={cn(
              LINHA_MENU,
              "w-full text-texto-2 hover:bg-realce hover:text-tinta",
              recolhido ? "justify-center" : "gap-1.5 px-1.5",
            )}
          >
            {recolhido ? (
              <PanelLeftOpen size={18} strokeWidth={1.75} aria-hidden />
            ) : (
              <PanelLeftClose size={18} strokeWidth={1.75} aria-hidden />
            )}
            <span className={cn("tipo-corpo", recolhido && "sr-only")}>
              {recolhido ? "Expandir menu" : "Recolher menu"}
            </span>
          </button>
        </div>
      ) : null}

      {/* A conta (que leva a Minha conta), o tema e o Sair no pé. Na conta,
          a pílula de item ativo, como as áreas. */}
      <div
        className={cn(
          "flex shrink-0 flex-col gap-0.5 px-1 pt-1 pb-1.5",
          recolhido && "items-center",
        )}
      >
        {recolhido ? (
          <>
            <Link
              href={CAMINHO_CONTA}
              aria-current={naConta ? "page" : undefined}
              title={`Minha conta: ${perfil.nome}, ${papel}`}
              onClick={(e) => subirSeJaEsta(e, CAMINHO_CONTA, pathname)}
              className={cn(
                LINHA_MENU,
                "w-[48px] justify-center",
                naConta ? "bg-selecao" : "hover:bg-realce",
              )}
            >
              <AvatarPessoa
                nome={perfil.nome}
                foto={perfil.foto}
                tamanho={32}
                superficie="fundo"
              />
              <span className="sr-only">
                Minha conta: {perfil.nome}, {papel}
              </span>
            </Link>
            <AlternadorTema />
          </>
        ) : (
          <div className="flex items-center gap-0.5">
            <Link
              href={CAMINHO_CONTA}
              aria-current={naConta ? "page" : undefined}
              title={`Minha conta (${perfil.email})`}
              onClick={(e) => subirSeJaEsta(e, CAMINHO_CONTA, pathname)}
              className={cn(
                "flex min-h-[48px] min-w-0 flex-1 items-center gap-1 rounded-controle py-0.5 pr-0.5 pl-1 transition-colors duration-[120ms] focus-visible:outline-2 focus-visible:-outline-offset-2 focus-visible:outline-tinta",
                naConta ? "bg-selecao" : "hover:bg-realce",
              )}
            >
              <AvatarPessoa
                nome={perfil.nome}
                foto={perfil.foto}
                tamanho={32}
                superficie="fundo"
              />
              <span className="min-w-0 flex-1">
                <span className="sr-only">Minha conta: </span>
                <span className="tipo-destaque block truncate text-tinta">
                  {perfil.nome}
                </span>
                <span className="tipo-nota block truncate text-texto-2">
                  {papel}
                </span>
              </span>
            </Link>
            <AlternadorTema />
          </div>
        )}
        {/* Formulário comum para a rota /entrar/sair, sem server action:
            funciona antes da hidratação e com a conta desativada (o
            middleware barra toda action de quem foi desativado). */}
        <form
          action="/entrar/sair"
          method="post"
          className={recolhido ? undefined : "w-full"}
        >
          <button
            type="submit"
            aria-label={recolhido ? "Sair" : undefined}
            title={recolhido ? "Sair" : undefined}
            className={cn(
              LINHA_MENU,
              "text-texto-2 hover:bg-realce hover:text-tinta",
              recolhido ? "w-[48px] justify-center" : "w-full gap-1.5 px-1.5",
            )}
          >
            <LogOut
              size={18}
              strokeWidth={1.75}
              aria-hidden
              className="shrink-0"
            />
            {recolhido ? null : <span className="tipo-corpo">Sair</span>}
          </button>
        </form>
      </div>
    </aside>
  );
}

/** Linha do menu: 40px no mouse, 44px no toque (o iPad deitado já mostra o
 *  menu lateral). */
const LINHA_MENU =
  "relative flex h-[40px] items-center rounded-controle transition-colors duration-[120ms] focus-visible:outline-2 focus-visible:-outline-offset-2 focus-visible:outline-tinta pointer-coarse:h-[44px]";

function ItemMenu({
  modulo,
  pathname,
  recolhido,
  atalho,
  atalhoAria,
}: {
  modulo: Modulo;
  pathname: string;
  recolhido: boolean;
  /** Como a dica mostra a tecla: "Alt+1" ou "⌘1". Só nas principais. */
  atalho?: string;
  /** Como o aria-keyshortcuts escreve: "Alt+1" ou "Meta+1". */
  atalhoAria?: string;
}) {
  const Icon = modulo.icon;
  const ativo = estaEm(modulo.href, pathname);
  const dica = atalho
    ? `${modulo.label} (${atalho})`
    : recolhido
      ? modulo.label
      : undefined;

  return (
    <Link
      href={modulo.href}
      aria-current={ativo ? "page" : undefined}
      aria-keyshortcuts={atalhoAria}
      title={dica}
      onClick={(e) => subirSeJaEsta(e, modulo.href, pathname)}
      className={cn(
        LINHA_MENU,
        recolhido ? "justify-center" : "gap-1.5 px-1.5",
        // A área em que se está: pílula na tinta a 8%, rótulo em 600 e
        // ícone de traço mais grosso (a lucide não tem versão preenchida).
        ativo
          ? "bg-selecao text-tinta"
          : "text-texto-2 hover:bg-realce hover:text-tinta",
      )}
    >
      <Icon
        size={18}
        strokeWidth={ativo ? 2.25 : 1.75}
        aria-hidden
        className="shrink-0"
      />
      {/* O peso vai no próprio rótulo: o tipo-corpo lê o --tw-font-weight,
          que o Tailwind 4 registra sem herança, então o font-semibold do
          link não chegaria aqui. */}
      <span
        className={cn(
          "tipo-corpo min-w-0 truncate",
          ativo && "font-semibold",
          recolhido && "sr-only",
        )}
      >
        {modulo.label}
      </span>
      {modulo.href === "/chat" ? (
        // O invólucro NUNCA muda de tipo entre o menu cheio e o trilho:
        // trocar a árvore remontaria o contador, que religa o canal de tempo
        // real. No trilho, o badge sobe para o canto do ícone, com um aro na
        // cor do menu para não colar no traço.
        <span
          className={
            recolhido
              ? "pointer-events-none absolute top-[2px] right-[4px]"
              : "ml-auto"
          }
        >
          <ContadorNaoLidas
            className={recolhido ? "ring-2 ring-cartao" : undefined}
          />
        </span>
      ) : null}
    </Link>
  );
}

/** Tocar na área em que já se está sobe ao topo, como no iPhone (kit, bloco
 *  6). Só sem query: no /chat?lead=, o Chat volta para a Caixa. */
function subirSeJaEsta(
  e: React.MouseEvent<HTMLAnchorElement>,
  href: string,
  pathname: string,
) {
  if (pathname !== href || window.location.search !== "") return;
  if (e.metaKey || e.ctrlKey || e.shiftKey || e.altKey) return;
  e.preventDefault();
  window.scrollTo({ top: 0 });
}

/** A faixa do compliance: o sistema inteiro é só leitura para esse papel.
 *  No topo da coluna do conteúdo, em qualquer largura (o --casca-topo conta
 *  os 40px dela). */
function FaixaSomenteLeitura() {
  return (
    <p
      role="status"
      className="flex h-[40px] shrink-0 items-center gap-1 border-b border-fio bg-cartao px-2 text-sm text-tinta lg:px-3"
    >
      <Eye
        size={16}
        strokeWidth={1.75}
        aria-hidden
        className="shrink-0 text-texto-2"
      />
      <span className="truncate lg:hidden">
        Modo somente leitura: nada é gravado.
      </span>
      <span className="hidden truncate lg:inline">
        Modo somente leitura: você vê tudo e pode exportar, mas nada do que
        mudar é gravado.
      </span>
    </p>
  );
}

/* ── Barra de abas e folha do "Mais" (celular e tablet) ─────────────────── */

function BarraDeAbas({
  principais,
  extras,
  pathname,
  folhaAberta,
  botaoMais,
  alternarFolha,
}: {
  principais: Modulo[];
  extras: Modulo[];
  pathname: string;
  folhaAberta: boolean;
  botaoMais: RefObject<HTMLButtonElement | null>;
  alternarFolha: () => void;
}) {
  // O "Mais" fica com a pílula quando a folha está aberta ou quando a tela
  // atual é uma das que moram nele, Minha conta inclusive (senão nenhuma aba
  // diria onde se está).
  const noMais =
    extras.some((m) => estaEm(m.href, pathname)) ||
    estaEm(CAMINHO_CONTA, pathname);

  return (
    <nav
      aria-label="Áreas"
      // data-barra-abas: o globals.css esconde a barra com o teclado aberto,
      // com diálogo aberto e quando a tela pede a tela inteira
      // (data-sem-abas).
      data-barra-abas=""
      className="pointer-events-none fixed inset-x-0 bottom-0 z-40 flex justify-center px-1.5 pb-[max(12px,env(safe-area-inset-bottom))] lg:hidden"
    >
      <div className="vidro pointer-events-auto flex w-full max-w-[480px] items-center gap-0.5 rounded-full p-[5px] backdrop-blur-[16px] backdrop-saturate-150">
        {principais.map((m) => {
          const Icon = m.icon;
          const ativo = estaEm(m.href, pathname) && !folhaAberta;
          return (
            <Link
              key={m.href}
              href={m.href}
              aria-current={ativo ? "page" : undefined}
              onClick={(e) => subirSeJaEsta(e, m.href, pathname)}
              className={cn(
                ITEM_ABA,
                ativo ? ITEM_ABA_ATIVO : ITEM_ABA_INATIVO,
              )}
            >
              <span className="relative flex">
                <Icon size={22} strokeWidth={ativo ? 2.25 : 1.75} aria-hidden />
                {m.href === "/chat" ? (
                  // O badge sobre o canto do ícone, com um aro na cor da
                  // barra para não colar no traço. Só visual: ele vem antes
                  // do rótulo, e o nome do link sairia ", 3 conversas não
                  // lidas Chat". A contagem falada vai depois do rótulo.
                  <span className="pointer-events-none absolute -top-[7px] left-[13px]">
                    <ContadorNaoLidas
                      soVisual
                      className="ring-2 ring-flutuante"
                    />
                  </span>
                ) : null}
              </span>
              <span className="tipo-rotulo-aba max-w-full overflow-x-clip px-0.5 text-ellipsis whitespace-nowrap">
                {m.label}
              </span>
              {m.href === "/chat" ? <NaoLidasParaLeitor /> : null}
            </Link>
          );
        })}
        <button
          ref={botaoMais}
          type="button"
          aria-expanded={folhaAberta}
          aria-controls="folha-mais"
          aria-haspopup="dialog"
          onClick={alternarFolha}
          className={cn(
            ITEM_ABA,
            folhaAberta || noMais ? ITEM_ABA_ATIVO : ITEM_ABA_INATIVO,
          )}
        >
          <Ellipsis
            size={22}
            strokeWidth={folhaAberta || noMais ? 2.25 : 1.75}
            aria-hidden
          />
          <span className="tipo-rotulo-aba">Mais</span>
        </button>
      </div>
    </nav>
  );
}

const ITEM_ABA =
  "relative flex h-[52px] min-w-0 flex-1 flex-col items-center justify-center gap-[3px] rounded-full transition-[background-color,color,scale] duration-[120ms] select-none motion-safe:active:scale-[.88] focus-visible:outline-2 focus-visible:-outline-offset-2 focus-visible:outline-tinta";
const ITEM_ABA_ATIVO = "bg-selecao text-tinta";
const ITEM_ABA_INATIVO = "text-texto-2 active:text-tinta";

/** Quanto o arrasto precisa descer para fechar, e a velocidade que basta
 *  (kit, bloco 6: folha arrastável). */
const ARRASTO_FECHA_PX = 120;
const ARRASTO_VELOCIDADE = 0.5;
/** Soltou e fecha em 0,24s; soltou e volta em 0,34s (kit, bloco 6, ainda
 *  não medido no aparelho). Abrir e fechar pelo X ficam nos 280ms da classe. */
const ARRASTO_FECHA_MS = 240;
const ARRASTO_VOLTA_MS = 340;

function FolhaMais({
  aberta,
  fechar,
  sairPorLink,
  botaoMais,
  perfil,
  extras,
  pathname,
}: {
  aberta: boolean;
  fechar: () => void;
  /** Um link da folha foi tocado: ela fecha sem voltar no histórico (o
   *  link troca a entrada dela pela da tela nova). */
  sairPorLink: () => void;
  botaoMais: RefObject<HTMLButtonElement | null>;
  perfil: Perfil;
  extras: Modulo[];
  pathname: string;
}) {
  const fecharRef = useRef(fechar);
  useEffect(() => {
    fecharRef.current = fechar;
  });
  // O arrasto fecha e devolve o foco ao "Mais", como o X e o Esc: o foco
  // ficava dentro da folha, que vira inerte, e caía no body.
  const { folha, arrasto } = useArrastarParaFechar(() => {
    fecharRef.current();
    botaoMais.current?.focus();
  });

  // Aberta: o foco vai para a folha (não para um campo: no toque, abriria o
  // teclado), a página de trás não rola, Esc fecha e devolve o foco ao
  // "Mais", e o Tab circula dentro dela.
  useEffect(() => {
    if (!aberta) return;
    const el = folha.current;
    // Direto, sem esperar quadro: a folha já está visível neste commit, e
    // requestAnimationFrame não roda em aba escondida.
    el?.focus({ preventScroll: true });
    const raiz = document.documentElement;
    const overflowAntes = raiz.style.overflow;
    raiz.style.overflow = "hidden";

    const aoTeclar = (e: KeyboardEvent) => {
      if (!el) return;
      if (e.key === "Escape") {
        if (e.defaultPrevented) return;
        e.preventDefault();
        fecharRef.current();
        botaoMais.current?.focus();
        return;
      }
      if (e.key !== "Tab") return;
      const focaveis = Array.from(
        el.querySelectorAll<HTMLElement>(
          'a[href], button:not([disabled]), [tabindex]:not([tabindex="-1"])',
        ),
      );
      if (focaveis.length === 0) return;
      const primeiro = focaveis[0];
      const ultimo = focaveis[focaveis.length - 1];
      const ativo = document.activeElement;
      if (e.shiftKey && (ativo === primeiro || ativo === el)) {
        e.preventDefault();
        ultimo.focus();
      } else if (!e.shiftKey && ativo === ultimo) {
        e.preventDefault();
        primeiro.focus();
      } else if (!el.contains(ativo)) {
        e.preventDefault();
        primeiro.focus();
      }
    };
    // Na captura: a folha está por cima, e o Esc não pode fechar nada
    // atrás dela.
    document.addEventListener("keydown", aoTeclar, true);

    // A janela passou de lg com a folha aberta (o iPad girado): o lg:hidden
    // some com ela, mas ela seguiria aberta, com a página travada, o Tab
    // preso e o role="dialog" desligando os atalhos. Fecha junto. O "Mais"
    // também sumiu, então o foco não tem para onde voltar.
    const largo = window.matchMedia("(min-width: 64rem)");
    const aoMudarLargura = () => {
      if (largo.matches) fecharRef.current();
    };
    largo.addEventListener("change", aoMudarLargura);
    return () => {
      raiz.style.overflow = overflowAntes;
      document.removeEventListener("keydown", aoTeclar, true);
      largo.removeEventListener("change", aoMudarLargura);
    };
  }, [aberta, botaoMais, folha]);

  const fecharPeloBotao = () => {
    fechar();
    botaoMais.current?.focus();
  };
  const buscar = () => {
    fechar();
    // A folha fecha junto: o foco volta ao "Mais" quando a paleta fechar.
    abrirPaleta(botaoMais.current);
  };
  const papel = rotuloPapel(perfil.papel);
  const naConta = estaEm(CAMINHO_CONTA, pathname);

  return (
    <div
      inert={!aberta}
      // A visibilidade só espera na saída (para a folha descer à vista); na
      // entrada ela vale na hora, senão o foco do primeiro quadro cairia num
      // elemento ainda invisível e se perderia.
      className={cn(
        "fixed inset-0 z-50 lg:hidden",
        aberta
          ? "visible"
          : "invisible transition-[visibility] duration-[280ms]",
      )}
    >
      {/* Fundo: toque fora fecha e devolve o foco ao "Mais", como o X.
          touch-none: arrastar nele não rola a página de trás. */}
      <div
        aria-hidden
        onClick={fecharPeloBotao}
        className={cn(
          "absolute inset-0 touch-none bg-overlay transition-opacity duration-[180ms]",
          aberta ? "opacity-100" : "opacity-0",
        )}
      />
      <div
        ref={folha}
        id="folha-mais"
        // Diálogo só enquanto aberta. Fechada, ela continua no DOM para a
        // saída animar, e um role="dialog" parado ali fazia o chat achar
        // que havia diálogo aberto e desligar o J, o E, o H e o ⌘K.
        role={aberta ? "dialog" : undefined}
        aria-modal={aberta ? true : undefined}
        aria-labelledby={aberta ? "titulo-folha-mais" : undefined}
        tabIndex={-1}
        // O arrasto mexe no transform (--arrasto); a entrada e a saída, no
        // translate do Tailwind. São propriedades separadas e se somam.
        style={{ transform: "translateY(var(--arrasto, 0px))" }}
        className={cn(
          "absolute inset-x-0 bottom-0 flex max-h-[calc(100dvh-24px)] flex-col rounded-t-folha bg-flutuante shadow-flutuante outline-none",
          "transition-[translate,transform] duration-[280ms] ease-padrao",
          aberta ? "translate-y-0" : "translate-y-full",
        )}
      >
        <div
          {...arrasto}
          className="flex shrink-0 touch-none flex-col items-center pt-1 select-none"
        >
          <span
            aria-hidden
            className="h-[5px] w-[36px] rounded-full bg-fio-forte"
          />
          <div className="flex w-full items-center justify-between pt-0.5 pr-1 pl-2">
            <h2 id="titulo-folha-mais" className="tipo-titulo-3 text-tinta">
              Mais
            </h2>
            <button
              type="button"
              onClick={fecharPeloBotao}
              aria-label="Fechar"
              className={BOTAO_ICONE}
            >
              <X size={22} strokeWidth={1.75} aria-hidden />
            </button>
          </div>
        </div>

        <div className="min-h-0 flex-1 overflow-y-auto overscroll-contain px-2 pb-[max(16px,env(safe-area-inset-bottom))]">
          <div className="flex items-center gap-1.5 py-1.5">
            <AvatarPessoa
              nome={perfil.nome}
              foto={perfil.foto}
              tamanho={44}
              superficie="cartao"
            />
            <div className="min-w-0">
              <p className="tipo-destaque truncate text-tinta">{perfil.nome}</p>
              <p className="tipo-nota truncate text-texto-2">
                {papel} · {perfil.email}
              </p>
            </div>
          </div>

          <div className="overflow-hidden rounded-painel bg-cartao">
            <button type="button" onClick={buscar} className={LINHA_FOLHA}>
              <Search
                size={20}
                strokeWidth={1.75}
                aria-hidden
                className="shrink-0 text-texto-2"
              />
              <span className="tipo-corpo flex h-full min-w-0 flex-1 items-center truncate">
                Buscar pessoa ou área
              </span>
            </button>
          </div>

          {extras.length > 0 ? (
            <ul className="mt-1.5 overflow-hidden rounded-painel bg-cartao">
              {extras.map((m) => {
                const Icon = m.icon;
                const aqui = estaEm(m.href, pathname);
                return (
                  <li key={m.href} className="group">
                    {/* replace: a entrada da folha no histórico vira a
                        da tela nova, e o voltar de lá não reabre a folha. */}
                    <Link
                      href={m.href}
                      replace
                      aria-current={aqui ? "page" : undefined}
                      onClick={sairPorLink}
                      className={cn(LINHA_FOLHA, aqui && "bg-selecao")}
                    >
                      <Icon
                        size={20}
                        strokeWidth={aqui ? 2.25 : 1.75}
                        aria-hidden
                        className="shrink-0 text-texto-2"
                      />
                      {/* Separador encaixado: começa onde o texto começa. */}
                      <span className="flex h-full min-w-0 flex-1 items-center gap-1 border-t border-fio group-first:border-t-0">
                        <span
                          className={cn(
                            "tipo-corpo min-w-0 flex-1 truncate",
                            aqui && "font-semibold",
                          )}
                        >
                          {m.label}
                        </span>
                        <ChevronRight
                          size={18}
                          strokeWidth={1.75}
                          aria-hidden
                          className="shrink-0 text-texto-3"
                        />
                      </span>
                    </Link>
                  </li>
                );
              })}
            </ul>
          ) : null}

          {/* O grupo da conta: Minha conta, o tema e o Sair. */}
          <div className="mt-1.5 overflow-hidden rounded-painel bg-cartao">
            <Link
              href={CAMINHO_CONTA}
              replace
              aria-current={naConta ? "page" : undefined}
              onClick={sairPorLink}
              className={cn(LINHA_FOLHA, naConta && "bg-selecao")}
            >
              <CircleUserRound
                size={20}
                strokeWidth={naConta ? 2.25 : 1.75}
                aria-hidden
                className="shrink-0 text-texto-2"
              />
              <span className="flex h-full min-w-0 flex-1 items-center gap-1">
                <span
                  className={cn(
                    "tipo-corpo min-w-0 flex-1 truncate",
                    naConta && "font-semibold",
                  )}
                >
                  Minha conta
                </span>
                <ChevronRight
                  size={18}
                  strokeWidth={1.75}
                  aria-hidden
                  className="shrink-0 text-texto-3"
                />
              </span>
            </Link>
            {/* O separador do tema é encaixado como o das outras linhas:
                começa no texto, depois dos 12px de recuo, do ícone de 20 e
                dos 12 de vão. O AlternadorTema não tem onde pôr o fio por
                dentro, então ele vem por cima. */}
            <div className="relative">
              <span
                aria-hidden
                className="pointer-events-none absolute top-0 right-0 left-[44px] border-t border-fio"
              />
              <AlternadorTema variante="linha" className="tipo-corpo" />
            </div>
            {/* Pela rota, como no menu lateral: vale antes da hidratação e
                com a conta desativada. */}
            <form action="/entrar/sair" method="post">
              <button type="submit" className={LINHA_FOLHA}>
                <LogOut
                  size={20}
                  strokeWidth={1.75}
                  aria-hidden
                  className="shrink-0 text-texto-2"
                />
                <span className="tipo-corpo flex h-full flex-1 items-center border-t border-fio">
                  Sair
                </span>
              </button>
            </form>
          </div>
        </div>
      </div>
    </div>
  );
}

const LINHA_FOLHA =
  "flex h-[48px] w-full items-center gap-1.5 pl-1.5 pr-1 text-left text-tinta transition-colors duration-[120ms] hover:bg-realce active:bg-pressionado focus-visible:outline-2 focus-visible:-outline-offset-2 focus-visible:outline-tinta";

/* ── Ganchos da casca ─────────────────────────────────────────────────── */

/**
 * A folha do "Mais" no histórico, como a conversa do chat: abrir empurra uma
 * entrada (o mesmo endereço) e o voltar do sistema (a borda do iPhone, o
 * botão do Android) fecha a folha em vez de sair da tela. Fechar pelo X, Esc,
 * fundo ou arrasto volta a entrada; o link da folha a troca pela tela nova
 * (Link com replace) e não volta nada.
 */
function useFolhaNaHistoria(
  pathname: string,
  setFolhaEm: (rota: string | null) => void,
) {
  // A entrada de agora é a da folha (empurrada por ela e ainda não voltada)?
  const naHistoria = useRef(false);

  // Trocou de rota (link da folha, atalho de área): a entrada da folha já
  // não é a de agora.
  useEffect(() => {
    naHistoria.current = false;
  }, [pathname]);

  useEffect(() => {
    const aoAndar = () => {
      if (!naHistoria.current) return;
      naHistoria.current = false;
      setFolhaEm(null);
    };
    window.addEventListener("popstate", aoAndar);
    return () => window.removeEventListener("popstate", aoAndar);
  }, [setFolhaEm]);

  return {
    abrir() {
      setFolhaEm(pathname);
      const aqui =
        window.location.pathname +
        window.location.search +
        window.location.hash;
      window.history.pushState({ folhaMais: true }, "", aqui);
      naHistoria.current = true;
    },
    fechar() {
      setFolhaEm(null);
      if (!naHistoria.current) return;
      naHistoria.current = false;
      window.history.back();
    },
    sairPorLink() {
      naHistoria.current = false;
      setFolhaEm(null);
    },
  };
}

/**
 * Folha que desce com o dedo, como a do iOS: segue o dedo para baixo, resiste
 * para cima (um quinto do arrasto), fecha passando de 120px ou soltando
 * rápido. Só no toque; com mouse a folha fecha no X, no fundo ou no Esc.
 */
function useArrastarParaFechar(fechar: () => void) {
  // A folha é do próprio gancho: quem usa põe o `folha` no elemento.
  const folha = useRef<HTMLDivElement>(null);
  const gesto = useRef<{
    id: number;
    inicio: number;
    arrastando: boolean;
    amostras: { y: number; t: number }[];
  } | null>(null);

  const mover = (y: number) => {
    const el = folha.current;
    if (!el) return;
    el.style.transition = "none";
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
    const el = folha.current;
    if (!el) return;
    if (
      distancia > ARRASTO_FECHA_PX ||
      (distancia > 24 && velocidade > ARRASTO_VELOCIDADE)
    ) {
      // Sai de onde está: o translate vai a 100% com o --arrasto ainda
      // aplicado. Depois de sair, o --arrasto zera sem transição.
      el.style.transition = "";
      el.style.transitionDuration = `${ARRASTO_FECHA_MS}ms`;
      fechar();
      window.setTimeout(() => {
        el.style.transition = "none";
        el.style.setProperty("--arrasto", "0px");
        requestAnimationFrame(() => {
          el.style.transition = "";
        });
      }, ARRASTO_FECHA_MS + 40);
      return;
    }
    // Volta para o lugar, um pouco mais devagar que a saída.
    el.style.transition = "";
    el.style.transitionDuration = `${ARRASTO_VOLTA_MS}ms`;
    el.style.setProperty("--arrasto", "0px");
    window.setTimeout(() => {
      el.style.transitionDuration = "";
    }, ARRASTO_VOLTA_MS + 40);
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
      mover(distancia > 0 ? distancia : distancia / 5);
      g.amostras = [...g.amostras.slice(-2), { y: e.clientY, t: e.timeStamp }];
    },
    onPointerUp: soltar,
    onPointerCancel: soltar,
  };
  return { folha, arrasto };
}

/**
 * Alt+1 a Alt+4 (⌘1 a ⌘4 no Mac) trocam de área, na ordem do menu (kit,
 * bloco 7). Com folha ou diálogo aberto, o teclado é deles. Com envio no
 * ar no chat, não navega e devolve o aviso para a região do leitor de tela.
 * `hrefs` vem como texto ("/chat|/contatos") para o efeito não se refazer a
 * cada renderização.
 */
function useAtalhosDeArea(hrefs: string): string {
  const router = useRouter();
  const [aviso, setAviso] = useState("");
  useEffect(() => {
    const destinos = hrefs.split("|");
    let escrever = 0;
    let apagar = 0;
    // Apaga e escreve de novo um instante depois: o leitor de tela não
    // repete um texto que não mudou, e o segundo atalho ficaria mudo.
    const avisar = () => {
      window.clearTimeout(escrever);
      window.clearTimeout(apagar);
      setAviso("");
      escrever = window.setTimeout(() => setAviso(AVISO_ENVIO_EM_VOO), 100);
      apagar = window.setTimeout(() => setAviso(""), 5000);
    };
    const aoTeclar = (e: KeyboardEvent) => {
      if (e.defaultPrevented || e.repeat) return;
      // e.code e não e.key: no Mac, Option+1 escreve "¡".
      const digito = /^Digit([1-4])$/.exec(e.code);
      if (!digito) return;
      const combinou = ehMac()
        ? e.metaKey && !e.ctrlKey && !e.altKey && !e.shiftKey
        : e.altKey && !e.ctrlKey && !e.metaKey && !e.shiftKey;
      if (!combinou) return;
      const destino = destinos[Number(digito[1]) - 1];
      if (!destino) return;
      if (document.querySelector('[aria-modal="true"], dialog[open]')) return;
      e.preventDefault();
      if (haEnvioEmVoo()) {
        avisar();
        return;
      }
      router.push(destino);
    };
    document.addEventListener("keydown", aoTeclar);
    return () => {
      document.removeEventListener("keydown", aoTeclar);
      window.clearTimeout(escrever);
      window.clearTimeout(apagar);
    };
  }, [hrefs, router]);
  return aviso;
}

/** Abaixo disto não é teclado: é a barra do Safari entrando e saindo. */
const MINIMO_TECLADO_PX = 80;
const TIPOS_SEM_TECLADO = new Set([
  "button",
  "checkbox",
  "color",
  "file",
  "hidden",
  "image",
  "radio",
  "range",
  "reset",
  "submit",
]);

function abreTeclado(el: Element | null): boolean {
  if (!(el instanceof HTMLElement)) return false;
  if (el.isContentEditable || el instanceof HTMLTextAreaElement) return true;
  return el instanceof HTMLInputElement && !TIPOS_SEM_TECLADO.has(el.type);
}

/**
 * O teclado do telefone cobre tudo que é fixo no pé (kit, bloco 8). A medida
 * vai para o <html>: --teclado (quanto ele cobre, em px; zero fechado),
 * --vv-altura e --vv-topo (a área visível) e data-teclado="aberto". A barra
 * de abas some com ele aberto (globals.css) e o h-util desconta o que ele
 * cobre.
 *
 * No Safari e no Chrome do Android o teclado encolhe só a área visível, e o
 * visualViewport mede. O Firefox do Android encolhe a janela inteira e a
 * diferença zera: aí vale o campo com foco numa janela que encolheu.
 */
function useTecladoMedido() {
  useEffect(() => {
    const raiz = document.documentElement;
    const vv = window.visualViewport;
    let alturaCheia = window.innerHeight;

    const medir = () => {
      alturaCheia = Math.max(alturaCheia, window.innerHeight);
      let cobre = 0;
      let aberto = false;
      if (vv) {
        cobre = Math.max(
          0,
          Math.round(window.innerHeight - vv.height - vv.offsetTop),
        );
        // Com zoom de pinça a área visível também encolhe, e não é teclado.
        aberto = cobre >= MINIMO_TECLADO_PX && vv.scale <= 1.01;
        raiz.style.setProperty("--vv-altura", `${Math.round(vv.height)}px`);
        raiz.style.setProperty(
          "--vv-topo",
          `${Math.max(0, Math.round(vv.offsetTop))}px`,
        );
      }
      const janelaEncolheu =
        alturaCheia - window.innerHeight >= MINIMO_TECLADO_PX;
      const porFoco = janelaEncolheu && abreTeclado(document.activeElement);
      raiz.style.setProperty("--teclado", `${aberto ? cobre : 0}px`);
      if (aberto || porFoco) raiz.dataset.teclado = "aberto";
      else delete raiz.dataset.teclado;
    };
    // O foco troca de campo em dois eventos (sai de um, entra no outro):
    // mede no quadro seguinte, para a barra não piscar entre os dois.
    let quadro = 0;
    const medirDepois = () => {
      cancelAnimationFrame(quadro);
      quadro = requestAnimationFrame(medir);
    };
    // Girar o aparelho muda a altura cheia de verdade.
    const aoGirar = () => {
      alturaCheia = window.innerHeight;
      medirDepois();
    };

    medir();
    vv?.addEventListener("resize", medir);
    vv?.addEventListener("scroll", medir);
    window.addEventListener("resize", medir);
    window.addEventListener("orientationchange", aoGirar);
    document.addEventListener("focusin", medirDepois);
    document.addEventListener("focusout", medirDepois);
    return () => {
      cancelAnimationFrame(quadro);
      vv?.removeEventListener("resize", medir);
      vv?.removeEventListener("scroll", medir);
      window.removeEventListener("resize", medir);
      window.removeEventListener("orientationchange", aoGirar);
      document.removeEventListener("focusin", medirDepois);
      document.removeEventListener("focusout", medirDepois);
      raiz.style.removeProperty("--teclado");
      raiz.style.removeProperty("--vv-altura");
      raiz.style.removeProperty("--vv-topo");
      delete raiz.dataset.teclado;
    };
  }, []);
}
