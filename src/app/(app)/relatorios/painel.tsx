import Link from "next/link";
import { ChevronDown, ChevronRight } from "lucide-react";
import { formatarData } from "@/lib/format";
import { cn } from "@/lib/utils";
import {
  DIAS,
  SEMANAS_MAPA,
  TETO_RECEBIDAS,
  type CargaPessoa,
  type DadosRelatorio,
} from "./dados";
import { GraficoDias } from "./grafico-dias";
import { MapaCalor } from "./mapa-calor";
import { ComandosRelatorio } from "./comandos";
import { SecaoPeriodo } from "./periodo-escolha";
import {
  noPeriodo,
  rotuloPeriodo,
  tituloPeriodo,
  type Periodo,
} from "./periodo";

/*
 * O Relatório, só desenho: dados.ts lê o banco e entrega os números
 * prontos. Ficha padrão (kit, bloco 5): número antes do texto e no máximo
 * um gráfico por painel (a espera em faixas, o volume por dia, o mapa de
 * calor e as barras dos dois rankings), o resto em linha de texto com o
 * número. A largura vem do contêiner, não da janela: no desktop o menu
 * lateral come parte dela.
 */

/** Rótulo de grupo do iOS: fora do cartão, alinhado ao texto de dentro. */
const GRUPO = "px-2.5 tipo-nota uppercase tracking-[0.04em] text-texto-2";

/** Linha que leva à fila (kit, bloco 2): 48px, foco por dentro do cartão
 *  (o overflow do grupo cortaria o anel de fora). */
const LINHA_LINK =
  "flex min-h-[48px] w-full items-stretch text-left text-tinta transition-colors duration-[120ms] hover:bg-realce active:bg-pressionado focus-visible:outline-2 focus-visible:-outline-offset-2 focus-visible:outline-tinta";

/** As faixas de espera, da mais curta para a mais longa. A intensidade da
 *  tinta cresce com a espera (cor por intensidade, kit bloco 5). */
const FAIXAS = [
  { rotulo: "até 15 min", tom: "bg-tinta/20" },
  { rotulo: "15 min a 1 h", tom: "bg-tinta/45" },
  { rotulo: "1 h a 4 h", tom: "bg-tinta/70" },
  { rotulo: "mais de 4 h", tom: "bg-tinta" },
] as const;

function numero(n: number) {
  return n.toLocaleString("pt-BR");
}

/** 9,4 → "9 min"; 130 → "2 h 10 min"; 0,4 → "menos de 1 min". Arredonda
 *  antes de comparar: 59,6 sai "1 h", não "60 min". */
function duracao(minutos: number) {
  if (minutos < 1) return "menos de 1 min";
  const total = Math.round(minutos);
  if (total < 60) return `${total} min`;
  const horas = Math.floor(total / 60);
  const resto = total % 60;
  return resto ? `${horas} h ${resto} min` : `${horas} h`;
}

/** A espera mais longa: em minutos e horas até um dia, depois em dias. */
function esperaEmTexto(horas: number) {
  if (horas < 24) return duracao(horas * 60);
  const dias = Math.floor(horas / 24);
  return dias === 1 ? "1 dia" : `${numero(dias)} dias`;
}

export function PainelRelatorio({ dados }: { dados: DadosRelatorio }) {
  const {
    periodo,
    inicio,
    agora,
    agoraHora,
    fila,
    recebidas,
    recebidasAcimaDoTeto,
    recebidas30d,
    atividade,
    porDia,
    mapa,
    resolvidas,
    falhas,
  } = dados;
  // null: os nomes da equipe não carregaram (o aviso do topo diz).
  const equipe = atividade ? atividade.equipe : [];
  const automaticas = atividade?.automaticas ?? { total: 0, hoje: 0 };
  const daEquipe = atividade?.daEquipe ?? 0;
  const mediana = atividade?.mediana ?? null;
  // Acima do teto o gráfico por dia e o mapa ficam de fora de propósito; o
  // cartão diz o motivo no lugar de "não carregou". O corte é da leitura
  // dos 30 dias, não do período escolhido: o número é o dos 30 dias.
  const corte =
    recebidasAcimaDoTeto && recebidas30d !== null
      ? `só é desenhado até ${numero(TETO_RECEBIDAS)} recebidas nos 30 dias; foram ${numero(recebidas30d)}.`
      : null;

  return (
    <div className="@container mx-auto w-full max-w-[1120px] px-2 pt-2 pb-4 md:px-3 md:pt-3">
      <ComandosRelatorio
        esperando={fila.hrefEsperando}
        semDono={fila.hrefSemDono}
      />
      <header className="flex min-h-[48px] flex-col justify-center">
        <h1 className="tipo-titulo-grande text-tinta">Relatório</h1>
      </header>

      {falhas.length > 0 ? (
        <p
          role="alert"
          className="mt-2 rounded-painel bg-cartao px-2.5 py-1.5 tipo-corpo text-erro"
        >
          Não carregou: {falhas.join(", ")}. Os números com &quot;—&quot;
          ficaram de fora; recarregue a página para tentar de novo.
        </p>
      ) : null}

      {/* ───────────────────────────── Agora ───────────────────────────── */}
      <section aria-labelledby="agora-titulo" className="mt-3">
        <div className="flex items-baseline gap-1">
          <h2 id="agora-titulo" className="tipo-titulo-3 text-tinta">
            Agora
          </h2>
          <p className="tipo-nota text-texto-2 tabular-nums">
            às {agoraHora}
          </p>
        </div>

        <div className="mt-1.5 grid grid-cols-[minmax(0,1fr)] gap-3 @3xl:grid-cols-2 @3xl:items-start">
          <Espera
            espera={fila.espera}
            href={fila.hrefEsperando}
          />
          <Abertas
            semDono={fila.semDono}
            hrefSemDono={fila.hrefSemDono}
            comCarga={fila.comCarga}
            carga={fila.carga}
          />
        </div>
      </section>

      {/* ─────────────────── O período (padrão: 30 dias) ─────────────────── */}
      {/* A seção é do cliente (as pílulas e o "carregando" da troca); o
          título e os números seguem do servidor, como filhos. */}
      <SecaoPeriodo
        periodo={periodo}
        titulo={
          <div className="flex min-w-0 flex-wrap items-baseline gap-x-1">
            <h2 id="mes-titulo" className="tipo-titulo-3 text-tinta">
              {tituloPeriodo(periodo)}
            </h2>
            <p className="tipo-nota text-texto-2 tabular-nums">
              {periodo === "hoje"
                ? `${formatarData(agora)}, até ${agoraHora}`
                : `de ${formatarData(inicio)} a ${formatarData(agora)}`}
            </p>
          </div>
        }
      >
        <section aria-labelledby="volume-titulo" className="mt-1.5">
          <h3 id="volume-titulo" className={GRUPO}>
            Mensagens
          </h3>
          <dl className="mt-1 grid overflow-hidden rounded-painel bg-cartao @2xl:grid-cols-3">
            <Numero
              valor={recebidas === null ? "—" : numero(recebidas)}
              rotulo="recebidas"
              apoio="de contatos, no WhatsApp e no Instagram"
            />
            <Numero
              valor={atividade ? numero(atividade.enviadas) : "—"}
              rotulo="enviadas"
              apoio={
                atividade
                  ? `${numero(daEquipe)} pela equipe · ${numero(automaticas.total)} automáticas`
                  : undefined
              }
            />
            <Numero
              valor={mediana === null ? "—" : duracao(mediana)}
              rotulo="mediana da primeira resposta"
              apoio={
                atividade && atividade.respostas > 0
                  ? `${numero(atividade.respostas)} ${
                      atividade.respostas === 1
                        ? "resposta medida"
                        : "respostas medidas"
                    }`
                  : "sem resposta medida no período"
              }
              ajuda="Conta a primeira mensagem da equipe depois que o contato escreve; espera acima de 7 dias fica de fora (é conversa retomada, não resposta)."
            />
          </dl>
        </section>

        <section aria-labelledby="dia-titulo" className="mt-4">
          {/* O gráfico fica nos 30 dias qualquer que seja o período: o
              rótulo diz isso, como o do horário de pico. */}
          <div className="flex flex-wrap items-baseline justify-between gap-x-2 px-2.5">
            <h3
              id="dia-titulo"
              className="tipo-nota tracking-[0.04em] text-texto-2 uppercase"
            >
              Por dia
            </h3>
            {porDia && porDia.length > 0 ? (
              <p className="tipo-nota text-texto-2 tabular-nums">
                {DIAS} dias, de {porDia[0].rotulo} a{" "}
                {porDia[porDia.length - 1].rotulo}
              </p>
            ) : null}
          </div>
          <div className="mt-1 rounded-painel bg-cartao px-2.5 py-2">
            {porDia ? (
              <GraficoDias dias={porDia} agoraHora={agoraHora} />
            ) : (
              <p className="tipo-corpo text-texto-2">
                {corte
                  ? `O volume por dia ${corte}`
                  : "O volume por dia não carregou."}
              </p>
            )}
          </div>
        </section>

        <section aria-labelledby="pico-titulo" className="mt-4">
          <div className="flex flex-wrap items-baseline justify-between gap-x-2 px-2.5">
            <h3 id="pico-titulo" className="tipo-nota tracking-[0.04em] text-texto-2 uppercase">
              Horário de pico
            </h3>
            {mapa ? (
              <p className="tipo-nota text-texto-2 tabular-nums">
                {SEMANAS_MAPA} semanas, de {mapa.de} a {mapa.ate}
              </p>
            ) : null}
          </div>
          <div className="mt-1 rounded-painel bg-cartao px-2.5 py-2">
            {mapa ? (
              <MapaCalor celulas={mapa.celulas} de={mapa.de} ate={mapa.ate} />
            ) : (
              <p className="tipo-corpo text-texto-2">
                {corte
                  ? `O horário de pico ${corte}`
                  : "O horário de pico não carregou."}
              </p>
            )}
          </div>
        </section>

        <div className="mt-4 grid grid-cols-[minmax(0,1fr)] gap-4 @4xl:grid-cols-2 @4xl:items-start">
          <section aria-labelledby="equipe-titulo">
            <h3 id="equipe-titulo" className={GRUPO}>
              Equipe
            </h3>
            {equipe === null ? (
              // Sem os nomes o ranking juntaria todos em "Outro usuário": fica
              // de fora, e o aviso do topo diz o que faltou.
              <p className="mt-1 rounded-painel bg-cartao px-2.5 py-2 tipo-corpo text-texto-2">
                O ranking por pessoa não carregou.
              </p>
            ) : equipe.length === 0 ? (
              // Sem atividade carregada o aviso de erro lá em cima já explica.
              atividade ? (
                <p className="mt-1 rounded-painel bg-cartao px-2.5 py-2 tipo-corpo text-texto-2">
                  Nenhuma mensagem da equipe {noPeriodo(periodo)}.
                </p>
              ) : null
            ) : (
              <Ranking
                legenda={
                  periodo === "hoje"
                    ? "Mensagens enviadas por pessoa hoje"
                    : `Mensagens enviadas por pessoa ${noPeriodo(periodo)} e hoje`
                }
                colunaNome="Pessoa"
                periodo={periodo}
                linhas={equipe.map((p) => ({
                  nome: p.nome,
                  total: p.total,
                  // Com o período de hoje, a coluna Hoje repetiria o total.
                  hoje: periodo === "hoje" ? undefined : p.hoje,
                }))}
              />
            )}
            {automaticas.total > 0 ? (
              <p className="mt-1 px-2.5 tipo-nota text-texto-2 tabular-nums">
                <span className="font-semibold text-tinta">
                  {numero(automaticas.total)}
                </span>{" "}
                {automaticas.total === 1
                  ? "mensagem automática"
                  : "mensagens automáticas"}
                {periodo === "hoje"
                  ? null
                  : ` · ${numero(automaticas.hoje)} hoje`}
              </p>
            ) : null}
          </section>

          <section aria-labelledby="resolvidas-titulo">
            <div className="flex items-baseline justify-between gap-2 px-2.5">
              <h3
                id="resolvidas-titulo"
                className="tipo-nota tracking-[0.04em] text-texto-2 uppercase"
              >
                Resolvidas
              </h3>
              {resolvidas ? (
                <p className="tipo-nota text-texto-2 tabular-nums">
                  {numero(resolvidas.total)}{" "}
                  {resolvidas.total === 1 ? "conversa" : "conversas"}
                </p>
              ) : null}
            </div>
            {resolvidas === null ? null : resolvidas.porPessoa === null ? (
              <p className="mt-1 rounded-painel bg-cartao px-2.5 py-2 tipo-corpo text-texto-2">
                O ranking por pessoa não carregou.
              </p>
            ) : resolvidas.porPessoa.length === 0 ? (
              <p className="mt-1 rounded-painel bg-cartao px-2.5 py-2 tipo-corpo text-texto-2">
                Nenhuma conversa resolvida {noPeriodo(periodo)}.
              </p>
            ) : (
              <Ranking
                legenda={`Conversas resolvidas ${noPeriodo(periodo)}, por responsável`}
                colunaNome="Responsável"
                periodo={periodo}
                linhas={resolvidas.porPessoa.map((p) => ({
                  nome: p.nome,
                  total: p.total,
                }))}
              />
            )}
            {resolvidas && resolvidas.semDono > 0 ? (
              <p className="mt-1 px-2.5 tipo-nota text-texto-2 tabular-nums">
                <span className="font-semibold text-tinta">
                  {numero(resolvidas.semDono)}
                </span>{" "}
                {resolvidas.semDono === 1
                  ? "resolvida sem dono"
                  : "resolvidas sem dono"}
              </p>
            ) : null}
            {resolvidas ? (
              <div className="px-2.5">
                <ComoConta texto="Conta a conversa resolvida no período que continua resolvida, pelo responsável de hoje; se o contato voltou a escrever, ela reabriu e saiu da conta." />
              </div>
            ) : null}
          </section>
        </div>
      </SecaoPeriodo>
    </div>
  );
}

// ─────────────────────────────── Agora ───────────────────────────────

function Espera({
  espera,
  href,
}: {
  espera: DadosRelatorio["fila"]["espera"];
  href: string;
}) {
  const total = espera?.total ?? 0;
  return (
    <section aria-labelledby="espera-titulo">
      <h3 id="espera-titulo" className={GRUPO}>
        Esperando resposta
      </h3>
      <div className="mt-1 overflow-hidden rounded-painel bg-cartao">
        <Link href={href} className={LINHA_LINK}>
          <span className="flex min-w-0 flex-1 items-center gap-1.5 px-2.5 py-2">
            <span className="flex min-w-0 flex-1 flex-col">
              <span className="tipo-titulo-1 text-tinta tabular-nums">
                {espera ? numero(total) : "—"}
              </span>
              <span className="tipo-nota text-texto-2">
                {total === 1 ? "conversa esperando" : "conversas esperando"}
                {espera && espera.maisAntiga !== null
                  ? ` · a mais antiga há ${esperaEmTexto(espera.maisAntiga)}`
                  : ""}
              </span>
            </span>
            <Seta />
          </span>
        </Link>

        {espera && total > 0 ? (
          <div className="border-t border-fio px-2.5 pt-1.5 pb-1">
            {/* A barra repete as linhas de baixo em proporção: decorativa
                para o leitor de tela, que lê os números da lista. */}
            <div aria-hidden className="flex h-[12px] gap-[2px]">
              {espera.contagens.map((n, i) =>
                n > 0 ? (
                  <span
                    key={i}
                    className={cn(
                      "h-full min-w-[4px] first:rounded-l-[2px] last:rounded-r-[2px]",
                      FAIXAS[i].tom,
                    )}
                    style={{ flexGrow: n, flexBasis: 0 }}
                  />
                ) : null,
              )}
            </div>
            <ul className="mt-1">
              {FAIXAS.map((f, i) => {
                const n = espera.contagens[i];
                const longa = i === FAIXAS.length - 1 && n > 0;
                return (
                  <li
                    key={f.rotulo}
                    className="flex min-h-[32px] items-center gap-1 tipo-corpo"
                  >
                    <span
                      aria-hidden
                      className={cn(
                        "h-[8px] w-[8px] shrink-0 rounded-[2px]",
                        f.tom,
                      )}
                    />
                    <span className="min-w-0 flex-1 text-texto-2">
                      {f.rotulo}
                    </span>
                    <span
                      className={cn(
                        "tabular-nums",
                        longa ? "font-semibold text-atencao" : "text-tinta",
                      )}
                    >
                      {numero(n)}
                    </span>
                  </li>
                );
              })}
            </ul>
          </div>
        ) : null}
      </div>
      <div className="px-2.5">
        <ComoConta texto="Conta a conversa em que o contato mandou a última mensagem e ninguém respondeu; a espera vale desde essa mensagem." />
      </div>
    </section>
  );
}

/** Sem dono para os dois papéis; a carga por pessoa só para a gestão (a
 *  regra do chat), e aí o "Como conta?" explica as duas contas. */
function Abertas({
  semDono,
  hrefSemDono,
  comCarga,
  carga,
}: {
  semDono: number | null;
  hrefSemDono: string;
  comCarga: boolean;
  carga: DadosRelatorio["fila"]["carga"];
}) {
  return (
    <section aria-labelledby="abertas-titulo">
      <h3 id="abertas-titulo" className={GRUPO}>
        Conversas abertas
      </h3>
      <ul className="mt-1 overflow-hidden rounded-painel bg-cartao">
        <LinhaFila
          href={hrefSemDono}
          nome="Sem dono"
          valor={semDono}
          forte
          atencao={(semDono ?? 0) > 0}
        />
        {(carga ?? []).map((p) => (
          <LinhaPessoa key={p.id} pessoa={p} />
        ))}
      </ul>
      <div className="px-2.5">
        <ComoConta
          texto={
            comCarga
              ? "Por pessoa vale a conta do rodízio (não resolvida, com mensagem trocada, adiada inclusive). Embaixo do nome, a mesma carga dividida nas duas filas do chat: a Caixa, que não mostra a adiada no prazo, e as Adiadas. Sem dono é o número da Caixa do chat."
              : "Sem dono é o número da Caixa do chat: conversa aberta sem responsável."
          }
        />
      </div>
    </section>
  );
}

/**
 * Uma pessoa da equipe: o número é a carga do rodízio (o critério da
 * distribuição) e, embaixo do nome, a divisão dela nas filas do chat, cada
 * parte um link que abre a fila com o mesmo número ("9 na Caixa · 3
 * adiadas"). A linha não é link: os dois destinos ficam nos botões.
 */
function LinhaPessoa({ pessoa: p }: { pessoa: CargaPessoa }) {
  const botao =
    "relative inline-flex h-[32px] items-center rounded-controle px-1 tipo-nota text-tinta underline decoration-fio-forte underline-offset-4 transition-colors duration-[120ms] hover:bg-realce hover:decoration-tinta active:bg-pressionado focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-tinta tabular-nums pointer-coarse:after:absolute pointer-coarse:after:inset-x-0 pointer-coarse:after:-inset-y-[6px]";
  return (
    <li className="group/linha">
      <div className="ml-2.5 flex min-h-[48px] items-center gap-1.5 border-t border-fio py-1 pr-2.5 group-first/linha:border-t-0">
        <div className="flex min-w-0 flex-1 flex-col">
          <p className="flex min-w-0 items-baseline gap-0.5">
            <span className="truncate tipo-corpo text-tinta">{p.nome}</span>
            {p.noRodizio ? null : (
              <span className="shrink-0 tipo-nota text-texto-2">
                · fora do rodízio
              </span>
            )}
          </p>
          {/* -ml-1: o texto do primeiro botão alinha com o nome. */}
          <div className="-ml-1 flex flex-wrap items-center gap-x-1.5">
            <Link
              href={p.href}
              aria-label={
                p.caixa === null
                  ? `Caixa de ${p.nome} no chat`
                  : `${numero(p.caixa)} na Caixa de ${p.nome}, no chat`
              }
              className={botao}
            >
              {p.caixa === null ? "Caixa" : `${numero(p.caixa)} na Caixa`}
            </Link>
            {p.adiadas === null || p.adiadas > 0 ? (
              <Link
                href={p.hrefAdiadas}
                aria-label={
                  p.adiadas === null
                    ? `Adiadas de ${p.nome} no chat`
                    : `${numero(p.adiadas)} ${p.adiadas === 1 ? "adiada" : "adiadas"} de ${p.nome}, no chat`
                }
                className={botao}
              >
                {p.adiadas === null
                  ? "Adiadas"
                  : `${numero(p.adiadas)} ${p.adiadas === 1 ? "adiada" : "adiadas"}`}
              </Link>
            ) : null}
          </div>
        </div>
        <span className="shrink-0 text-right tipo-destaque text-tinta tabular-nums">
          {numero(p.abertas)}
          <span className="sr-only"> na carga do rodízio</span>
        </span>
      </div>
    </li>
  );
}

function LinhaFila({
  href,
  nome,
  apoio,
  valor,
  forte = false,
  atencao = false,
}: {
  href: string;
  nome: string;
  apoio?: string;
  valor: number | null;
  forte?: boolean;
  atencao?: boolean;
}) {
  return (
    <li className="group/linha">
      <Link href={href} className={LINHA_LINK}>
        <span className="ml-2.5 flex min-w-0 flex-1 items-center gap-1.5 border-t border-fio py-1 pr-1.5 group-first/linha:border-t-0">
          <span className="flex min-w-0 flex-1 flex-col">
            <span
              className={cn(
                "truncate tipo-corpo text-tinta",
                forte && "font-semibold",
              )}
            >
              {nome}
            </span>
            {apoio ? (
              <span className="truncate tipo-nota text-texto-2">{apoio}</span>
            ) : null}
          </span>
          <span
            className={cn(
              "shrink-0 text-right tipo-destaque tabular-nums",
              atencao ? "text-atencao" : "text-tinta",
            )}
          >
            {valor === null ? "—" : numero(valor)}
          </span>
          <Seta />
        </span>
      </Link>
    </li>
  );
}

function Seta() {
  return (
    <ChevronRight
      size={18}
      strokeWidth={1.75}
      aria-hidden
      className="-mr-0.5 shrink-0 text-texto-3"
    />
  );
}

// ───────────────────────────── peças comuns ─────────────────────────────

/** Ranking de pessoas em tabela, com a barra do total embaixo do nome. A
 *  coluna "Hoje" só aparece quando as linhas a trazem. */
function Ranking({
  legenda,
  colunaNome,
  periodo,
  linhas,
}: {
  legenda: string;
  colunaNome: string;
  /** O rótulo da coluna do total ("Hoje", "7 dias", "30 dias"). */
  periodo: Periodo;
  linhas: { nome: string; total: number; hoje?: number }[];
}) {
  const maior = linhas[0]?.total ?? 0;
  const comHoje = linhas.some((l) => l.hoje !== undefined);
  return (
    <div className="mt-1 rounded-painel bg-cartao px-2.5 pt-1 pb-1.5">
      {/* table-fixed: a coluna do nome fica com o que sobra e trunca, em
          vez de empurrar os números para fora do cartão no celular. */}
      <table className="w-full table-fixed border-collapse text-left">
        <caption className="sr-only">{legenda}</caption>
        <thead>
          <tr className="tipo-nota text-texto-2">
            <th scope="col" className="py-1 pr-2 font-normal">
              {colunaNome}
            </th>
            <th
              scope="col"
              className="w-[72px] py-1 text-right font-normal @md:w-[96px]"
            >
              {rotuloPeriodo(periodo)}
            </th>
            {comHoje ? (
              <th
                scope="col"
                className="w-[56px] py-1 text-right font-normal @md:w-[80px]"
              >
                Hoje
              </th>
            ) : null}
          </tr>
        </thead>
        <tbody>
          {linhas.map((p) => (
            <tr key={p.nome} className="border-t border-fio">
              <td className="py-1.5 pr-2">
                <span className="block truncate tipo-corpo text-tinta">
                  {p.nome}
                </span>
                {/* A barra só repete o número da coluna ao lado, em
                    tamanho: decorativa para o leitor de tela. */}
                <span
                  aria-hidden
                  className="mt-0.5 block h-[4px] overflow-hidden rounded-full bg-realce"
                >
                  <span
                    className="block h-full rounded-full bg-tinta"
                    style={{
                      width: `${maior > 0 ? (p.total / maior) * 100 : 0}%`,
                    }}
                  />
                </span>
              </td>
              <td className="py-1.5 text-right align-top tipo-destaque text-tinta tabular-nums">
                {numero(p.total)}
              </td>
              {comHoje ? (
                <td
                  className={cn(
                    "py-1.5 text-right align-top tipo-corpo tabular-nums",
                    (p.hoje ?? 0) > 0 ? "text-tinta" : "text-texto-2",
                  )}
                >
                  {numero(p.hoje ?? 0)}
                </td>
              ) : null}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

/** Uma frase para o que não é óbvio, atrás de "Como conta?". */
function ComoConta({ texto }: { texto: string }) {
  return (
    <details className="group/ajuda">
      <summary className="-ml-1 inline-flex min-h-[44px] cursor-pointer list-none items-center gap-0.5 rounded-controle px-1 tipo-nota text-tinta transition-colors duration-[120ms] select-none hover:bg-realce focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-tinta [&::-webkit-details-marker]:hidden">
        Como conta?
        <ChevronDown
          size={14}
          strokeWidth={1.75}
          aria-hidden
          className="transition-transform duration-[150ms] group-open/ajuda:rotate-180"
        />
      </summary>
      <p className="max-w-[60ch] tipo-nota text-texto-2">{texto}</p>
    </details>
  );
}

/** Número antes do texto: o valor em destaque, o rótulo e o apoio embaixo.
 *  No HTML o rótulo (dt) vem antes, como pede a lista de definição. */
function Numero({
  valor,
  rotulo,
  apoio,
  ajuda,
}: {
  valor: string;
  rotulo: string;
  apoio?: string;
  /** Uma frase para o que não é óbvio, atrás de um "?". */
  ajuda?: string;
}) {
  return (
    <div className="flex min-w-0 flex-col border-t border-fio px-2.5 py-2 first:border-t-0 @2xl:border-t-0 @2xl:border-l @2xl:first:border-l-0">
      <dt className="order-2 tipo-nota text-texto-2">{rotulo}</dt>
      <dd className="order-1 tipo-titulo-1 text-tinta tabular-nums">{valor}</dd>
      {apoio ? (
        <dd className="order-3 tipo-nota text-texto-2 tabular-nums">{apoio}</dd>
      ) : null}
      {ajuda ? (
        <dd className="order-4">
          <ComoConta texto={ajuda} />
        </dd>
      ) : null}
    </div>
  );
}
