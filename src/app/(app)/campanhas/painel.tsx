import Link from "next/link";
import { ChevronDown } from "lucide-react";
import { cn } from "@/lib/utils";
import { formatarData, formatarDataHora } from "@/lib/format";
import { Button } from "@/components/ui/button";
import { FILTROS_FILA_PADRAO, hrefConversa } from "../chat/mensagem";
import { FILTROS_VAZIOS, urlContatos } from "../contatos/filtros";
import { pontoDaEtiqueta } from "../contatos/cor-etiqueta";
import { alterarStatusCampanha } from "./actions";
import {
  BotaoParecida,
  NovaCampanha,
  type BaseParecida,
  type TemplateOpcao,
} from "./nova-campanha";
import { EditarCampanha, type TextoDaCampanha } from "./editar-campanha";
import { BotaoEstado } from "./botao-estado";
import { BotaoRecusas } from "./recusas";
import { PausarTodas } from "./pausar-todas";
import { RetornoDaAcao } from "./retorno";
import type { CampanhaExcluivel } from "./excluir";
import {
  frasePrevisao,
  frasePrimeiroEnvio,
  numero,
  partesDoPublico,
  previsaoTermino,
  primeiroEnvio,
  rotuloRitmo,
  type PublicoEtiqueta,
  type Relogio,
  type Ritmo,
} from "./regras";

/*
 * A tela de Disparos, só desenho: a página lê o banco e a Meta e entrega os
 * números prontos aqui. Ficha padrão: cartão chapado, a tinta no destaque, a
 * semântica só na palavra de estado; número antes do texto; grupo de seção
 * como o iOS (rótulo fora do cartão). A largura vem do contêiner, não da
 * janela: no desktop o menu lateral come parte dela.
 */

export type CampanhaVista = {
  id: string;
  nome: string;
  status: "ativa" | "pausada" | "concluida";
  templateNome: string;
  templateIdioma: string;
  etiquetaId: string | null;
  etiqueta: { nome: string; cor: string | null } | null;
  /** As variáveis gravadas (sem a chave do "sem nome") e o "para quem não
   *  tem nome" gravado: o molde do "Criar parecida". */
  valores: Record<string, string>;
  semNome: string | null;
  ritmo: Ritmo;
  criadaEm: string;
  concluidaEm: string | null;
  /** Tentativas gravadas (sucesso e recusa). */
  enviados: number;
  falhas: number;
  hoje: number;
  /** Do público elegível agora, quem ainda não recebeu. */
  faltam: number;
  /** Por que o motor pula esta campanha (sem etiqueta, template fora da
   *  lista, variável em branco), ou null. */
  bloqueio: string | null;
  /** A etiqueta do público foi excluída (etiqueta_id nulo). */
  semPublico: boolean;
  publico: PublicoEtiqueta | null;
  /** Do público elegível de hoje, quantos já tiveram envio desta. */
  jaTiveramEnvio: number;
  /** Está entre as campanhas que o filtro Campanha do chat oferece. */
  noFiltroDoChat: boolean;
  /** O texto que sai, para o editor. */
  texto: TextoDaCampanha;
};

export type DadosDisparos = {
  campanhas: CampanhaVista[];
  /** Etiquetas ativas, para o público da nova campanha. */
  publicos: PublicoEtiqueta[];
  templates: TemplateOpcao[];
  /** Por que não dá para criar campanha agora (sem template), ou null. */
  bloqueioNova: string | null;
  relogio: Relogio;
  teto: number;
  enviadosHoje: number;
  qualidade: {
    rating: string | null;
    desde: string | null;
    limite: string | null;
  } | null;
  erros7d: number;
  errosPorCampanha: { nome: string; erros: number }[];
  errosRecentes: { quando: string; campanha: string; erro: string }[];
  retorno: {
    ok?: string;
    aviso?: string;
    t?: string;
    /** A campanha parada de onde saiu a recém-criada ("Criar parecida"). */
    antiga: CampanhaExcluivel | null;
  };
  semMigracao: boolean;
  /** Os nomes de todas as campanhas: o nome sugerido não repete nenhum. */
  nomesUsados: string[];
};

/** Rótulo de grupo do iOS: fora do cartão, alinhado ao texto de dentro. */
const GRUPO = "px-2.5 tipo-nota uppercase tracking-[0.04em] text-texto-2";

const QUALIDADE: Record<string, { rotulo: string; cor: string; nota: string }> =
  {
    GREEN: { rotulo: "Verde", cor: "text-bom", nota: "" },
    YELLOW: {
      rotulo: "Amarela",
      cor: "text-atencao",
      nota: "A Meta pode baixar o limite de conversas.",
    },
    RED: {
      rotulo: "Vermelha",
      cor: "text-erro",
      nota: "Risco de bloqueio do número.",
    },
  };

/** TIER_1K → "até 1.000 conversas por dia". */
function rotuloLimite(limite: string | null): string | null {
  if (!limite) return null;
  const tier = /^TIER_(\d+)(K)?$/i.exec(limite.trim());
  if (tier) {
    const n = Number(tier[1]) * (tier[2] ? 1000 : 1);
    return `até ${numero(n)} conversas por dia`;
  }
  if (/UNLIMITED/i.test(limite)) return "sem limite de conversas";
  return limite;
}

/** Trilho de 4px com a parte feita na tinta (kit, bloco 5) e, quando há,
 *  a parte recusada na tinta mais clara logo depois (cor por intensidade). */
function Barra({
  fracao,
  recusada = 0,
  rotulo,
}: {
  fracao: number;
  /** Fração do trilho que foi tentada e recusada. */
  recusada?: number;
  rotulo: string;
}) {
  const feita = Math.max(0, Math.min(1, fracao)) * 100;
  const recusas = Math.max(0, Math.min(1 - feita / 100, recusada)) * 100;
  return (
    <div
      role="img"
      aria-label={rotulo}
      className="mt-1 flex h-[4px] overflow-hidden rounded-full bg-realce"
    >
      <div className="h-full bg-tinta" style={{ width: `${feita}%` }} />
      {recusas > 0 ? (
        <div className="h-full bg-tinta/35" style={{ width: `${recusas}%` }} />
      ) : null}
    </div>
  );
}

export function PainelDisparos({ dados }: { dados: DadosDisparos }) {
  const restanteTeto = Math.max(dados.teto - dados.enviadosHoje, 0);
  // Só as que de fato enviam entram na soma contra o teto.
  const somaAtivas = dados.campanhas
    .filter((c) => c.status === "ativa" && !c.bloqueio)
    .reduce((soma, c) => soma + c.ritmo.porDia, 0);

  // O grupo Enviando é o status ativa, Paradas inclusive (o motor as pula
  // até o bloqueio sair). "Pausar todas" pausa o grupo inteiro, mas a frase
  // e a pergunta separam as que enviam de fato das Paradas.
  const enviando = dados.campanhas.filter((c) => c.status === "ativa");
  const enviamDeFato = enviando.filter((c) => !c.bloqueio).length;
  const paradas = enviando.length - enviamDeFato;
  // O comando da paleta mora numa cópia só: a do grupo, quando ela aparece
  // (2 ou mais); senão a do bloco do número, quando ele mostra o botão.
  const pausarNoGrupo = enviando.length > 1;
  const pausadas = dados.campanhas.filter((c) => c.status === "pausada");
  const concluidas = dados.campanhas.filter((c) => c.status === "concluida");

  const cartao = (c: CampanhaVista) => (
    <CartaoCampanha
      key={c.id}
      campanha={c}
      relogio={dados.relogio}
      teto={dados.teto}
      restanteTeto={restanteTeto}
      somaAtivas={somaAtivas}
      podeCriar={!dados.bloqueioNova}
    />
  );

  return (
    <div className="@container mx-auto w-full max-w-[1120px] px-2 pt-2 pb-4 md:px-3 md:pt-3">
      <header className="flex min-h-[48px] items-center justify-between gap-2">
        <h1 className="tipo-titulo-grande text-tinta">Disparos</h1>
        <NovaCampanha
          templates={dados.templates}
          publicos={dados.publicos}
          relogio={dados.relogio}
          teto={dados.teto}
          restanteTeto={restanteTeto}
          somaAtivas={somaAtivas}
          bloqueio={dados.bloqueioNova}
          nomesUsados={dados.nomesUsados}
        />
      </header>

      {/* Montada sempre, para o leitor de tela anunciar o retorno novo. */}
      <div aria-live="polite">
        <RetornoDaAcao
          key={dados.retorno.t ?? "0"}
          ok={dados.retorno.ok}
          aviso={dados.retorno.aviso}
          antiga={dados.retorno.antiga}
        />
      </div>

      {dados.semMigracao ? (
        <p
          role="alert"
          className="mt-2 rounded-painel bg-cartao px-2 py-1.5 tipo-corpo text-erro"
        >
          A tabela de campanhas não respondeu. Confira se a migração 0021 rodou
          no Supabase.
        </p>
      ) : null}

      {dados.bloqueioNova ? (
        <p className="mt-1 tipo-nota text-texto-2">
          {dados.bloqueioNova}
        </p>
      ) : null}

      <Saude
        dados={dados}
        enviando={enviamDeFato}
        paradas={paradas}
        comPaleta={!pausarNoGrupo}
      />

      {dados.campanhas.length === 0 && !dados.semMigracao ? (
        <section aria-labelledby="campanhas-vazio" className="mt-4">
          <h2 id="campanhas-vazio" className={GRUPO}>
            Campanhas
          </h2>
          <div className="mt-1 rounded-painel bg-cartao px-2.5 py-2">
            <p className="tipo-corpo text-tinta">Nenhuma campanha.</p>
            <p className="mt-0.5 tipo-nota text-texto-2">
              O público de uma campanha é uma etiqueta.
            </p>
          </div>
        </section>
      ) : null}

      {enviando.length > 0 ? (
        <Grupo
          id="grupo-enviando"
          titulo="Enviando"
          total={enviando.length}
          // Com uma campanha só, o Pausar do cartão já é um toque.
          acao={
            pausarNoGrupo ? (
              <PausarTodas
                enviando={enviamDeFato}
                paradas={paradas}
                comPaleta
                recuo="px-2.5"
              />
            ) : null
          }
        >
          {enviando.map(cartao)}
        </Grupo>
      ) : null}

      {pausadas.length > 0 ? (
        <Grupo id="grupo-pausadas" titulo="Pausadas" total={pausadas.length}>
          {pausadas.map(cartao)}
        </Grupo>
      ) : null}

      {concluidas.length > 0 ? (
        enviando.length + pausadas.length > 0 ? (
          // Com campanha em andamento, as concluídas ficam recolhidas: são
          // histórico, não fila.
          <details className="group/concluidas mt-4">
            <summary className="flex min-h-[44px] cursor-pointer list-none items-center gap-0.5 rounded-controle pr-1 transition-colors duration-[120ms] select-none hover:bg-realce focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-tinta [&::-webkit-details-marker]:hidden">
              <h2 className={GRUPO}>
                Concluídas{" "}
                <span className="tabular-nums">· {numero(concluidas.length)}</span>
              </h2>
              <ChevronDown
                size={16}
                strokeWidth={1.75}
                aria-hidden
                className="text-texto-2 transition-transform duration-[150ms] group-open/concluidas:rotate-180"
              />
            </summary>
            <ul className="mt-1 grid items-start gap-1.5 @4xl:grid-cols-2">
              {concluidas.map(cartao)}
            </ul>
          </details>
        ) : (
          <Grupo
            id="grupo-concluidas"
            titulo="Concluídas"
            total={concluidas.length}
          >
            {concluidas.map(cartao)}
          </Grupo>
        )
      ) : null}
    </div>
  );
}

function Grupo({
  id,
  titulo,
  total,
  acao,
  children,
}: {
  id: string;
  titulo: string;
  total: number;
  /** Ação do grupo inteiro, à direita do título ("Pausar todas"). */
  acao?: React.ReactNode;
  children: React.ReactNode;
}) {
  return (
    <section aria-labelledby={id} className="mt-4">
      <div className="flex min-h-[32px] flex-wrap items-center justify-between gap-x-1.5 gap-y-1">
        <h2 id={id} className={GRUPO}>
          {titulo} <span className="tabular-nums">· {numero(total)}</span>
        </h2>
        {acao}
      </div>
      <ul className="mt-1 grid items-start gap-1.5 @4xl:grid-cols-2">
        {children}
      </ul>
    </section>
  );
}

/* ── Saúde do número ──────────────────────────────────────────────────── */

function Saude({
  dados,
  enviando,
  paradas,
  comPaleta,
}: {
  dados: DadosDisparos;
  /** Campanhas que enviam de fato (ativa e sem bloqueio): a frase e o
   *  "Pausar todas" da qualidade ruim. */
  enviando: number;
  /** Ativas que o motor pula (Paradas): o "Pausar todas" leva junto. */
  paradas: number;
  /** Esta cópia do "Pausar todas" registra o comando da paleta. */
  comPaleta: boolean;
}) {
  const { teto, enviadosHoje, qualidade, erros7d } = dados;
  const fracao = teto > 0 ? enviadosHoje / teto : 0;
  const nota = QUALIDADE[(qualidade?.rating ?? "").toUpperCase()];
  const limite = rotuloLimite(qualidade?.limite ?? null);
  const temRecusa =
    dados.errosPorCampanha.length > 0 || dados.errosRecentes.length > 0;

  // Telefone: o teto na largura toda e, embaixo, qualidade e recusas lado a
  // lado (o cartão não empurra as campanhas para fora da primeira tela).
  // Contêiner largo: as três lado a lado. O detalhe das recusas abre numa
  // faixa da largura do cartão.
  return (
    <section aria-labelledby="saude-titulo" className="mt-3">
      <h2 id="saude-titulo" className={GRUPO}>
        Número do WhatsApp
      </h2>
      <div className="mt-1 grid grid-cols-2 overflow-hidden rounded-painel bg-cartao @2xl:grid-cols-3">
        <div className="col-span-2 min-w-0 border-b border-fio px-2.5 py-2 @2xl:col-span-1 @2xl:border-b-0">
          <p className="flex items-baseline gap-0.5 tabular-nums">
            <span className="tipo-titulo-2 text-tinta">
              {numero(enviadosHoje)}
            </span>
            <span className="tipo-subtitulo text-texto-2">
              de {numero(teto)}
            </span>
          </p>
          <p className="tipo-nota text-texto-2">
            envios automáticos hoje
            {fracao >= 1 ? (
              <span className="text-atencao"> · teto usado</span>
            ) : fracao >= 0.8 ? (
              <span className="text-atencao"> · perto do teto</span>
            ) : null}
          </p>
          <Barra
            fracao={fracao}
            rotulo={`${numero(enviadosHoje)} de ${numero(teto)} envios automáticos usados hoje`}
          />
        </div>

        <div className="min-w-0 border-r border-fio px-2.5 py-2 @2xl:border-r-0 @2xl:border-l">
          <p
            className={cn(
              "tipo-titulo-2",
              nota?.cor ?? (qualidade?.rating ? "text-tinta" : "text-texto-2"),
            )}
          >
            {nota?.rotulo ?? qualidade?.rating ?? "Sem dado"}
          </p>
          <p className="tipo-nota text-texto-2">qualidade do número</p>
          <p className="tipo-nota text-texto-2 tabular-nums">
            {qualidade?.rating
              ? [
                  qualidade.desde
                    ? `desde ${formatarDataHora(qualidade.desde)}`
                    : null,
                  limite,
                ]
                  .filter(Boolean)
                  .join(" · ")
              : "A Meta não informou agora."}
          </p>
          {nota?.nota ? (
            <p className={cn("tipo-nota", nota.cor)}>{nota.nota}</p>
          ) : null}
        </div>

        <div className="min-w-0 px-2.5 py-2 @2xl:border-l @2xl:border-fio">
          <p className="tipo-titulo-2 text-tinta tabular-nums">
            {numero(erros7d)}
          </p>
          <p className="tipo-nota text-texto-2">
            {erros7d === 1 ? "recusa" : "recusas"} da Meta em 7 dias
          </p>
        </div>

        {/* Qualidade Amarela ou Vermelha com campanha enviando: parar tudo
            fica aqui, ao lado do aviso, sem caçar cartão por cartão. */}
        {nota?.nota && enviando > 0 ? (
          <div className="col-span-2 flex flex-wrap items-center justify-between gap-x-1.5 gap-y-1 border-t border-fio px-2.5 py-1.5 @2xl:col-span-3">
            <p className={cn("tipo-nota tabular-nums", nota.cor)}>
              {enviando === 1
                ? "1 campanha enviando com a qualidade "
                : `${numero(enviando)} campanhas enviando com a qualidade `}
              {nota.rotulo.toLowerCase()}.
            </p>
            <PausarTodas
              enviando={enviando}
              paradas={paradas}
              comPaleta={comPaleta}
            />
          </div>
        ) : null}

        {temRecusa ? (
          <details className="group/erros col-span-2 border-t border-fio px-2.5 @2xl:col-span-3">
            <summary className="-ml-1 inline-flex min-h-[44px] cursor-pointer list-none items-center gap-0.5 rounded-controle px-1 tipo-nota text-tinta transition-colors duration-[120ms] select-none hover:bg-realce focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-tinta [&::-webkit-details-marker]:hidden">
              Ver as recusas
              <ChevronDown
                size={14}
                strokeWidth={1.75}
                aria-hidden
                className="transition-transform duration-[150ms] group-open/erros:rotate-180"
              />
            </summary>
            <div className="grid gap-2 pb-2 @2xl:grid-cols-[minmax(0,1fr)_minmax(0,2fr)] @2xl:gap-3">
              {dados.errosPorCampanha.length > 0 ? (
                <ul className="flex flex-col gap-0.5">
                  {dados.errosPorCampanha.map((c) => (
                    <li
                      key={c.nome}
                      className="flex items-baseline gap-1 tipo-nota tabular-nums"
                    >
                      <span className="w-[32px] shrink-0 text-right font-semibold text-tinta">
                        {numero(c.erros)}
                      </span>
                      <span className="min-w-0 break-words text-texto-2">
                        {c.nome}
                      </span>
                    </li>
                  ))}
                </ul>
              ) : null}
              {dados.errosRecentes.length > 0 ? (
                <ul className="flex flex-col gap-1">
                  {dados.errosRecentes.map((e, i) => (
                    <li key={`${e.quando}-${i}`} className="tipo-nota">
                      <span className="text-texto-2 tabular-nums">
                        {formatarDataHora(e.quando)} · {e.campanha}
                      </span>
                      <span className="block break-words text-tinta">
                        {e.erro}
                      </span>
                    </li>
                  ))}
                </ul>
              ) : null}
            </div>
          </details>
        ) : null}
      </div>
    </section>
  );
}

/* ── Cartão da campanha ───────────────────────────────────────────────── */

/** Link no meio de uma linha de texto: a área de toque cresce por cima e
 *  por baixo até 44px sem mudar o desenho (kit, bloco 7). */
const LINK_NO_TEXTO =
  "relative rounded-celula text-tinta underline decoration-fio-forte underline-offset-4 transition-colors duration-[120ms] hover:decoration-tinta focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-tinta pointer-coarse:after:absolute pointer-coarse:after:-inset-x-0.5 pointer-coarse:after:-inset-y-[13px]";

function CartaoCampanha({
  campanha: c,
  relogio,
  teto,
  restanteTeto,
  somaAtivas,
  podeCriar,
}: {
  campanha: CampanhaVista;
  relogio: Relogio;
  teto: number;
  restanteTeto: number;
  somaAtivas: number;
  /** Dá para criar campanha agora (há template aprovado): "Criar parecida"
   *  só aparece com isso. */
  podeCriar: boolean;
}) {
  const concluida = c.status === "concluida";
  const parada = c.status === "ativa" && Boolean(c.bloqueio);
  // Sem etiqueta não há o que começar nem retomar: o selo diz o porquê
  // (a concluída segue concluída, o histórico dela vale).
  const estado = concluida
    ? "Concluída"
    : c.semPublico
      ? "Sem público"
      : c.status === "pausada"
        ? "Pausada"
        : parada
          ? "Parada"
          : "Enviando";
  const corEstado =
    estado === "Enviando"
      ? "text-bom"
      : estado === "Parada" || estado === "Sem público"
        ? "text-atencao"
        : "text-texto-2";

  // Enviados conta as tentativas (sucesso e recusa); quem recebeu é o que
  // passou sem erro, a mesma conta do filtro Campanha do chat e de Contatos.
  const recebidos = Math.max(c.enviados - c.falhas, 0);
  const alvo = c.enviados + c.faltam;
  const fracao = alvo > 0 ? recebidos / alvo : 0;
  const fracaoRecusada = alvo > 0 ? c.falhas / alvo : 0;
  const percentual = alvo > 0 ? Math.round((c.enviados / alvo) * 100) : 0;
  const previsao =
    c.status === "ativa" && !c.bloqueio
      ? frasePrevisao(
          previsaoTermino(
            { ...c.ritmo, faltam: c.faltam, jaHoje: c.hoje },
            relogio,
          ),
        )
      : null;
  const fraseComecar = frasePrimeiroEnvio(
    primeiroEnvio(
      { ...c.ritmo, jaHoje: c.hoje, restanteTeto, faltam: c.faltam },
      relogio,
    ),
    c.faltam,
  );
  const fora = c.publico ? partesDoPublico(c.publico) : [];
  const ponto = pontoDaEtiqueta(c.etiqueta?.cor);
  const podeComecar = !c.bloqueio && c.faltam > 0;
  const enviaDeFato = c.status === "ativa" && !c.bloqueio;

  // Daqui para as pessoas, com os filtros que o chat e Contatos já têm.
  // Respostas: quem recebeu e está esperando a equipe (visão Aguardando).
  // O filtro do chat só conhece as 50 campanhas mais recentes; fora delas,
  // fica só o "Quem recebeu", que Contatos acha em qualquer campanha.
  const hrefRespostas = hrefConversa(null, {
    ...FILTROS_FILA_PADRAO,
    visao: "aguardando",
    campanhaId: c.id,
  });
  const hrefQuemRecebeu = urlContatos({ ...FILTROS_VAZIOS, campanha: c.id });
  const hrefEtiqueta = c.etiquetaId
    ? urlContatos({ ...FILTROS_VAZIOS, etiquetas: [c.etiquetaId] })
    : null;

  // O molde do "Criar parecida": tudo desta, para a nova abrir na Revisão.
  const parecida: BaseParecida | null = podeCriar
    ? {
        id: c.id,
        nome: c.nome,
        etiquetaId: c.etiquetaId,
        etiquetaNome: c.etiqueta?.nome ?? null,
        templateNome: c.templateNome,
        templateIdioma: c.templateIdioma,
        valores: c.valores,
        semNome: c.semNome,
        ritmo: c.ritmo,
        jaTiveramEnvio: c.jaTiveramEnvio,
        // A que não envia fica na lista à toa: o retorno oferece excluí-la.
        oferecerExcluir: Boolean(c.bloqueio) && !concluida,
      }
    : null;

  const recusas =
    c.falhas > 0 ? (
      <span className="tipo-subtitulo text-texto-2">
        ·{" "}
        <BotaoRecusas
          campanhaId={c.id}
          campanhaNome={c.nome}
          total={c.falhas}
        />
      </span>
    ) : null;

  return (
    <li className="flex min-w-0 flex-col rounded-painel bg-cartao p-2.5">
      <div className="flex items-start justify-between gap-1.5">
        <div className="min-w-0">
          <h3 className="tipo-destaque break-words text-tinta">{c.nome}</h3>
          <p className="flex min-w-0 items-center gap-0.5 tipo-nota text-texto-2">
            {ponto ? (
              <span
                aria-hidden
                className="h-[8px] w-[8px] shrink-0 rounded-full"
                style={{ backgroundColor: ponto }}
              />
            ) : null}
            <span className="min-w-0 truncate">
              {c.etiqueta?.nome ?? "sem público"} · {c.templateNome}
            </span>
          </p>
        </div>
        <span
          className={cn("shrink-0 tipo-nota font-semibold", corEstado)}
        >
          {estado}
        </span>
      </div>

      {/* div, não p: o botão das recusas leva a folha (um <dialog>) junto,
          e <dialog> dentro de <p> quebra o HTML. */}
      {concluida ? (
        <div className="mt-2 flex flex-wrap items-baseline gap-x-0.5 tabular-nums">
          <span className="tipo-titulo-2 text-tinta">{numero(recebidos)}</span>
          <span className="tipo-subtitulo text-texto-2">
            {recebidos === 1 ? "recebeu" : "receberam"}
          </span>
          {recusas}
          {c.concluidaEm ? (
            <span className="tipo-subtitulo text-texto-2">
              · concluída em {formatarData(c.concluidaEm)}
            </span>
          ) : null}
        </div>
      ) : alvo === 0 ? (
        <p className="mt-2 tipo-corpo text-texto-2">
          Ninguém no público para receber.
        </p>
      ) : (
        <div className="mt-2">
          <div className="flex flex-wrap items-baseline gap-x-0.5 tabular-nums">
            <span className="tipo-titulo-2 text-tinta">
              {numero(recebidos)}
            </span>
            <span className="tipo-subtitulo text-texto-2">
              de {numero(alvo)}
            </span>
            {recusas}
            {/* Com recusa, o percentual (tentativas) não bate com a fração
                ao lado (quem recebeu): o rótulo diz o que ele conta. */}
            <span className="ml-auto tipo-nota text-texto-2">
              {percentual}%{c.falhas > 0 ? " tentado" : null}
            </span>
          </div>
          <Barra
            fracao={fracao}
            recusada={fracaoRecusada}
            rotulo={`${percentual}% do público tentado: ${numero(recebidos)} ${recebidos === 1 ? "recebeu" : "receberam"}${c.falhas > 0 ? ` e ${numero(c.falhas)} ${c.falhas === 1 ? "foi recusado" : "foram recusados"}` : ""}`}
          />
        </div>
      )}

      <div className="mt-1 flex flex-col gap-0.5 tipo-nota text-texto-2 tabular-nums">
        {concluida ? null : (
          <p>
            {enviaDeFato
              ? `${numero(c.hoje)} hoje · faltam ${numero(c.faltam)}${previsao ? ` · ${previsao}` : ""}`
              : `faltam ${numero(c.faltam)}`}
          </p>
        )}
        {concluida ? null : <p>{rotuloRitmo(c.ritmo)}</p>}
        {fora.length > 0 && !concluida ? (
          <p>
            Fora do público
            {hrefEtiqueta && c.etiqueta ? (
              <>
                {" "}
                de{" "}
                <Link
                  href={hrefEtiqueta}
                  aria-label={`Contatos da etiqueta ${c.etiqueta.nome}`}
                  className={LINK_NO_TEXTO}
                >
                  {c.etiqueta.nome}
                </Link>
              </>
            ) : null}
            : {fora.join(" · ")}
          </p>
        ) : null}
        {concluida && c.faltam > 0 && !c.bloqueio ? (
          <p className="text-tinta">
            {numero(c.faltam)} no público ainda não{" "}
            {c.faltam === 1 ? "recebeu" : "receberam"}.
          </p>
        ) : null}
        {c.bloqueio ? <p className="text-atencao">{c.bloqueio}</p> : null}
      </div>

      <div className="mt-2 flex flex-wrap items-center gap-1.5">
        {c.status === "ativa" ? (
          <form action={alterarStatusCampanha}>
            <input type="hidden" name="id" value={c.id} />
            <input type="hidden" name="status" value="pausada" />
            <BotaoEstado acao="pausar" rotulo="Pausar" />
          </form>
        ) : podeComecar ? (
          // contents: a confirmação (w-full) ocupa a linha inteira do pé.
          <form action={alterarStatusCampanha} className="contents">
            <input type="hidden" name="id" value={c.id} />
            <input type="hidden" name="status" value="ativa" />
            <BotaoEstado
              acao={concluida ? "retomar" : "comecar"}
              rotulo={
                concluida
                  ? `Retomar para ${c.faltam === 1 ? "o que falta" : `os ${numero(c.faltam)}`}`
                  : "Começar"
              }
              frase={fraseComecar}
            />
          </form>
        ) : null}
        {/* A que não envia tem a saída à vista: a parecida, com o que
            falta marcado na revisão. */}
        {c.bloqueio && !concluida && parecida ? (
          <BotaoParecida base={parecida} />
        ) : null}
        <EditarCampanha
          campanha={{
            id: c.id,
            nome: c.nome,
            estado,
            concluida,
            publico: c.etiqueta
              ? c.publico
                ? `${c.etiqueta.nome} · ${numero(c.publico.recebem)} recebem`
                : c.etiqueta.nome
              : "Sem público: a etiqueta foi excluída",
            template: c.templateNome,
            criadaEm: formatarData(c.criadaEm),
            ritmo: c.ritmo,
            faltam: c.faltam,
            jaHoje: c.hoje,
            recebidos,
            recusadas: c.falhas,
            texto: c.texto,
          }}
          relogio={relogio}
          teto={teto}
          somaOutras={somaAtivas - (enviaDeFato ? c.ritmo.porDia : 0)}
          parecida={parecida}
        />
        {recebidos > 0 && c.noFiltroDoChat ? (
          <Button
            href={hrefRespostas}
            variant="ghost"
            aria-label={`Respostas de ${c.nome} esperando a equipe, no chat`}
            className="pointer-coarse:h-[44px]"
          >
            Respostas
          </Button>
        ) : null}
        {recebidos > 0 ? (
          <Button
            href={hrefQuemRecebeu}
            variant="ghost"
            aria-label={`Quem recebeu ${c.nome}, em Contatos`}
            className="pointer-coarse:h-[44px]"
          >
            Quem recebeu
          </Button>
        ) : null}
      </div>
    </li>
  );
}
