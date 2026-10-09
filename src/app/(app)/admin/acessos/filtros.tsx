"use client";

import {
  useEffect,
  useId,
  useRef,
  useState,
  useTransition,
} from "react";
import { useRouter } from "next/navigation";
import { Funnel, Search, X } from "lucide-react";
import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import { Segmentado } from "@/components/ui/segmentado";
import { CAMPO, ROTULO } from "@/components/app/form-styles";
import { comVoltar } from "@/app/(app)/contatos/voltar";
import { Folha } from "@/app/(app)/conversas/folha";
import {
  contarFiltrosLog,
  FILTROS_LOG_PADRAO,
  JANELAS_LOG,
  periodoPadrao,
  urlDoLog,
  type FiltrosLog,
} from "./url";

/*
 * Os filtros do Log de acesso no padrão da fila do chat: o funil com o
 * número de filtros ligados e, embaixo, só os ligados, como pílulas com o X
 * que tira o filtro ali mesmo. O funil abre a folha "Filtrar o log" (presa no
 * pé no celular, janela no meio do tablet para cima): período por atalho ou
 * por datas, o contato, várias pessoas e várias ações, em grupos (marcar o
 * grupo marca todas dele). "Mostrar registros" aplica tudo de uma vez.
 *
 * A folha entra no histórico: o voltar do sistema a fecha. Aplicar troca a
 * entrada dela pela do log filtrado, e o voltar seguinte volta aos filtros
 * de antes.
 */

export type GrupoDoFiltro = {
  id: string;
  titulo: string;
  acoes: { chave: string; rotulo: string }[];
};

/** Acima de tantas pessoas, a lista ganha a busca no topo. */
const PESSOAS_SEM_BUSCA = 8;

function normalizar(texto: string) {
  return texto
    .normalize("NFD")
    .replace(/\p{Diacritic}/gu, "")
    .toLocaleLowerCase("pt-BR")
    .trim();
}

/** Caixa de marcar em linha de 44px, com o rótulo inteiro clicável. */
function LinhaMarcavel({
  marcado,
  misto = false,
  aoMudar,
  children,
  forte = false,
}: {
  marcado: boolean;
  /** Parte marcada (o grupo com algumas ações). */
  misto?: boolean;
  aoMudar: (marcado: boolean) => void;
  children: React.ReactNode;
  forte?: boolean;
}) {
  const caixa = useRef<HTMLInputElement>(null);
  useEffect(() => {
    if (caixa.current) caixa.current.indeterminate = misto;
  }, [misto]);
  return (
    <label className="flex min-h-[44px] cursor-pointer items-center gap-1.5 rounded-controle px-1 transition-colors duration-[120ms] hover:bg-realce has-[:focus-visible]:outline-2 has-[:focus-visible]:-outline-offset-2 has-[:focus-visible]:outline-tinta">
      <input
        ref={caixa}
        type="checkbox"
        checked={marcado}
        onChange={(e) => aoMudar(e.target.checked)}
        className="h-[18px] w-[18px] shrink-0 cursor-pointer focus-visible:outline-none"
      />
      <span
        className={cn(
          "tipo-corpo min-w-0 flex-1 text-tinta",
          forte && "font-semibold",
        )}
      >
        {children}
      </span>
    </label>
  );
}

/** O título de cada parte da folha. */
function TituloParte({ id, children }: { id: string; children: string }) {
  return (
    <h3
      id={id}
      className="tipo-nota px-1 pt-2 pb-0.5 tracking-[0.04em] text-texto-2 uppercase"
    >
      {children}
    </h3>
  );
}

/** A pílula de um filtro ligado: o valor na tinta, que abre a folha, e o X
 *  que tira o filtro (o foco passa à vizinha, ou ao funil). */
function Pilula({
  nome,
  valor,
  aoAbrir,
  aoTirar,
}: {
  nome: string;
  valor: string;
  aoAbrir: () => void;
  aoTirar: (botao: HTMLButtonElement) => void;
}) {
  return (
    <span className="flex h-[32px] max-w-full items-stretch rounded-chip border border-tinta bg-tinta text-fundo">
      <button
        type="button"
        onClick={aoAbrir}
        aria-haspopup="dialog"
        title={`${nome}: ${valor}`}
        aria-label={`${nome}: ${valor}`}
        className="relative inline-flex min-w-0 items-center rounded-chip pr-0.5 pl-1 text-sm whitespace-nowrap transition-colors duration-[120ms] select-none hover:bg-tinta-hover focus-visible:outline-2 focus-visible:-outline-offset-2 focus-visible:outline-fundo pointer-coarse:after:absolute pointer-coarse:after:inset-x-0 pointer-coarse:after:-inset-y-[7px]"
      >
        <span className="max-w-[200px] truncate">{valor}</span>
      </button>
      <button
        type="button"
        onClick={(e) => aoTirar(e.currentTarget)}
        aria-label={`Tirar o filtro: ${nome}`}
        title={`Tirar o filtro: ${nome}`}
        // O mesmo X da fila do chat: no toque, 32px de desenho e 6px de área
        // estendida para cada lado, 44×44.
        className="relative inline-flex w-[28px] shrink-0 items-center justify-center rounded-chip transition-colors duration-[120ms] hover:bg-tinta-hover focus-visible:outline-2 focus-visible:-outline-offset-2 focus-visible:outline-fundo pointer-coarse:w-[32px] pointer-coarse:after:absolute pointer-coarse:after:-inset-x-[6px] pointer-coarse:after:-inset-y-[7px]"
      >
        <X size={14} strokeWidth={2.25} aria-hidden />
      </button>
    </span>
  );
}

export function FiltrosLog({
  filtros,
  rotuloPeriodo,
  pessoas,
  grupos,
  nomeDoLead,
  voltar,
}: {
  filtros: FiltrosLog;
  /** "Últimos 7 dias", "01/10 a 07/10" (da página: o relógio é dela). */
  rotuloPeriodo: string;
  pessoas: { id: string; nome: string }[];
  /** As ações em grupos, com os rótulos. */
  grupos: GrupoDoFiltro[];
  /** O nome do contato do ?lead= (o "Quem viu este contato" da ficha). */
  nomeDoLead: string | null;
  /** O ?voltar= da tela, que segue junto quando os filtros mudam. */
  voltar: string | null;
}) {
  const router = useRouter();
  const [filtrando, iniciar] = useTransition();
  const [aberta, setAberta] = useState(false);
  const [rascunho, setRascunho] = useState<FiltrosLog>(filtros);
  const [buscaPessoa, setBuscaPessoa] = useState("");
  const [usaDatas, setUsaDatas] = useState(Boolean(filtros.de || filtros.ate));
  // "Datas" escolhido com as duas vazias: a folha não aplica e diz o que
  // falta (antes valiam os 7 dias, calados).
  const [faltaData, setFaltaData] = useState(false);
  const campoDe = useRef<HTMLInputElement>(null);
  const funil = useRef<HTMLButtonElement>(null);
  const linha = useRef<HTMLDivElement>(null);
  const naHistoria = useRef(false);
  const id = useId();

  const ligados = contarFiltrosLog(filtros);
  const nomeDe = new Map(pessoas.map((p) => [p.id, p.nome]));
  const rotuloDe = new Map(
    grupos.flatMap((g) => g.acoes.map((a) => [a.chave, a.rotulo] as const)),
  );

  /** Vai ao log com estes filtros, trocando a entrada de agora (a da folha,
   *  quando ela está aberta). */
  const aplicar = (f: FiltrosLog, trocar = false) => {
    const destino = comVoltar(urlDoLog(f), voltar);
    iniciar(() => {
      if (trocar) router.replace(destino, { scroll: false });
      else router.push(destino, { scroll: false });
    });
  };

  const abrir = () => {
    setRascunho(filtros);
    setUsaDatas(Boolean(filtros.de || filtros.ate));
    setFaltaData(false);
    setBuscaPessoa("");
    setAberta(true);
    const aqui =
      window.location.pathname + window.location.search + window.location.hash;
    window.history.pushState({ filtrosLog: true }, "", aqui);
    naHistoria.current = true;
  };

  const fechar = () => {
    setAberta(false);
    if (!naHistoria.current) return;
    naHistoria.current = false;
    window.history.back();
  };

  // O voltar do sistema com a folha aberta: ela fecha e a tela fica.
  useEffect(() => {
    const aoAndar = () => {
      if (!naHistoria.current) return;
      naHistoria.current = false;
      setAberta(false);
    };
    window.addEventListener("popstate", aoAndar);
    return () => window.removeEventListener("popstate", aoAndar);
  }, []);

  const mostrar = () => {
    if (usaDatas && !rascunho.de && !rascunho.ate) {
      setFaltaData(true);
      campoDe.current?.focus();
      return;
    }
    // Com data, o atalho não vale (nem vai na URL): fica o que estava, e
    // tirar o período pela pílula volta ao padrão.
    const f: FiltrosLog = usaDatas ? rascunho : { ...rascunho, de: "", ate: "" };
    // A entrada da folha vira a do log filtrado.
    const trocar = naHistoria.current;
    naHistoria.current = false;
    setAberta(false);
    aplicar({ ...f, contato: f.contato.trim() }, trocar);
  };

  /** Tira um filtro pela pílula; o foco vai à pílula vizinha, ou ao funil. */
  const tirar = (botao: HTMLButtonElement, f: FiltrosLog) => {
    const pilulas = Array.from(
      linha.current?.querySelectorAll<HTMLButtonElement>("[data-pilula] button") ??
        [],
    ).filter((b) => b.getAttribute("aria-haspopup") === "dialog");
    const minha = botao.parentElement?.querySelector("button");
    const i = pilulas.findIndex((b) => b === minha);
    const vizinha = pilulas[i + 1] ?? pilulas[i - 1] ?? null;
    (vizinha ?? funil.current)?.focus();
    aplicar(f);
  };

  /* As pílulas dos filtros ligados. */
  const pilulas: { nome: string; valor: string; sem: FiltrosLog }[] = [];
  if (!periodoPadrao(filtros)) {
    pilulas.push({
      nome: "Período",
      valor: rotuloPeriodo,
      sem: { ...filtros, dias: FILTROS_LOG_PADRAO.dias, de: "", ate: "" },
    });
  }
  if (filtros.quem.length > 0) {
    const primeiro = nomeDe.get(filtros.quem[0]) ?? "Pessoa removida";
    pilulas.push({
      nome: "Pessoas",
      valor:
        filtros.quem.length === 1
          ? primeiro
          : `${primeiro} +${(filtros.quem.length - 1).toLocaleString("pt-BR")}`,
      sem: { ...filtros, quem: [] },
    });
  }
  if (filtros.acoes.length > 0) {
    const grupoInteiro = grupos.find(
      (g) =>
        g.acoes.length === filtros.acoes.length &&
        g.acoes.every((a) => filtros.acoes.includes(a.chave)),
    );
    const primeira = rotuloDe.get(filtros.acoes[0]) ?? filtros.acoes[0];
    pilulas.push({
      nome: "Ações",
      valor: grupoInteiro
        ? grupoInteiro.titulo
        : filtros.acoes.length === 1
          ? primeira
          : `${primeira} +${(filtros.acoes.length - 1).toLocaleString("pt-BR")}`,
      sem: { ...filtros, acoes: [] },
    });
  }
  if (filtros.lead) {
    pilulas.push({
      nome: "Registros do contato",
      valor: nomeDoLead ?? "Um contato",
      sem: { ...filtros, lead: "" },
    });
  }
  if (filtros.contato) {
    pilulas.push({
      nome: "Contato",
      valor: filtros.contato,
      sem: { ...filtros, contato: "" },
    });
  }

  /* A folha. */
  const marcarPessoa = (pessoa: string, sim: boolean) =>
    setRascunho((r) => ({
      ...r,
      quem: sim
        ? [...new Set([...r.quem, pessoa])].sort()
        : r.quem.filter((q) => q !== pessoa),
    }));
  const marcarAcoes = (chaves: string[], sim: boolean) =>
    setRascunho((r) => ({
      ...r,
      acoes: sim
        ? [...new Set([...r.acoes, ...chaves])].sort()
        : r.acoes.filter((a) => !chaves.includes(a)),
    }));

  const termo = normalizar(buscaPessoa);
  const pessoasVisiveis = termo
    ? pessoas.filter((p) => normalizar(p.nome).includes(termo))
    : pessoas;
  const periodoEscolhido = usaDatas ? "datas" : String(rascunho.dias);

  return (
    <div aria-busy={filtrando || undefined}>
      <div ref={linha} className="flex flex-wrap items-center gap-1.5">
        <button
          ref={funil}
          type="button"
          onClick={abrir}
          aria-haspopup="dialog"
          aria-expanded={aberta}
          aria-label={
            ligados > 0
              ? `Filtros, ${ligados.toLocaleString("pt-BR")} ${ligados === 1 ? "ativo" : "ativos"}`
              : "Filtros"
          }
          className={cn(
            "relative inline-flex h-[40px] items-center gap-0.5 rounded-controle border border-fio-forte pr-1.5 pl-1 text-sm font-semibold text-tinta transition-colors duration-[120ms] hover:bg-realce focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-tinta pointer-coarse:h-[44px]",
            aberta && "bg-selecao",
          )}
        >
          <span className="relative inline-flex">
            <Funnel size={18} strokeWidth={1.75} aria-hidden />
            {ligados > 0 ? (
              <span
                aria-hidden
                className="tipo-legenda-2 absolute -top-[8px] -right-[11px] flex h-[16px] min-w-[16px] items-center justify-center rounded-full bg-tinta px-0.5 leading-none font-semibold text-fundo tabular-nums ring-2 ring-fundo"
              >
                {ligados}
              </span>
            ) : null}
          </span>
          <span className="ml-1">Filtros</span>
        </button>

        {pilulas.map((p) => (
          <span key={p.nome} data-pilula="" className="min-w-0 max-w-full">
            <Pilula
              nome={p.nome}
              valor={p.valor}
              aoAbrir={abrir}
              aoTirar={(b) => tirar(b, p.sem)}
            />
          </span>
        ))}

        {pilulas.length >= 2 ? (
          <button
            type="button"
            onClick={() => {
              funil.current?.focus();
              aplicar(FILTROS_LOG_PADRAO);
            }}
            className="tipo-corpo relative inline-flex h-[32px] items-center rounded-controle px-1 text-texto-2 underline-offset-2 transition-colors duration-[120ms] hover:text-tinta hover:underline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-tinta pointer-coarse:after:absolute pointer-coarse:after:inset-x-0 pointer-coarse:after:-inset-y-[6px]"
          >
            Limpar filtros
          </button>
        ) : null}
      </div>

      <Folha
        aberta={aberta}
        aoFechar={fechar}
        titulo="Filtrar o log"
        forma="centro"
        retorno={funil}
        rodape={
          <div className="flex gap-1.5">
            <Button
              type="button"
              variant="secondary"
              size="lg"
              className="flex-1 md:h-[40px] md:flex-none"
              onClick={() => {
                setRascunho(FILTROS_LOG_PADRAO);
                setUsaDatas(false);
                setFaltaData(false);
                setBuscaPessoa("");
              }}
            >
              Limpar
            </Button>
            <Button
              type="button"
              size="lg"
              className="flex-1 md:ml-auto md:h-[40px] md:flex-none"
              onClick={mostrar}
            >
              Mostrar registros
            </Button>
          </div>
        }
      >
        <section aria-labelledby={`${id}-periodo`}>
          <TituloParte id={`${id}-periodo`}>Período</TituloParte>
          <Segmentado
            rotulo="Período"
            valor={periodoEscolhido}
            onMudar={(v) => {
              if (v === "datas") {
                setUsaDatas(true);
                return;
              }
              setUsaDatas(false);
              setFaltaData(false);
              setRascunho((r) => ({ ...r, dias: Number(v) }));
            }}
            opcoes={[
              ...JANELAS_LOG.map((j) => ({
                valor: String(j.dias),
                rotulo: j.rotulo,
              })),
              { valor: "datas", rotulo: "Datas" },
            ]}
            larguraTotal
          />
          {usaDatas ? (
            <div className="mt-1.5 grid grid-cols-2 gap-1.5">
              <label className="flex min-w-0 flex-col gap-0.5">
                <span className={ROTULO}>De</span>
                <input
                  ref={campoDe}
                  type="date"
                  value={rascunho.de}
                  max={rascunho.ate || undefined}
                  aria-invalid={faltaData || undefined}
                  aria-describedby={faltaData ? `${id}-falta-data` : undefined}
                  onChange={(e) => {
                    setFaltaData(false);
                    setRascunho((r) => ({ ...r, de: e.target.value }));
                  }}
                  className={cn(CAMPO, "w-full min-w-0 tabular-nums")}
                />
              </label>
              <label className="flex min-w-0 flex-col gap-0.5">
                <span className={ROTULO}>Até</span>
                <input
                  type="date"
                  value={rascunho.ate}
                  min={rascunho.de || undefined}
                  aria-invalid={faltaData || undefined}
                  aria-describedby={faltaData ? `${id}-falta-data` : undefined}
                  onChange={(e) => {
                    setFaltaData(false);
                    setRascunho((r) => ({ ...r, ate: e.target.value }));
                  }}
                  className={cn(CAMPO, "w-full min-w-0 tabular-nums")}
                />
              </label>
            </div>
          ) : null}
          {usaDatas && faltaData ? (
            <p
              id={`${id}-falta-data`}
              role="alert"
              className="tipo-nota mt-1 px-1 text-erro"
            >
              Escolha ao menos uma data.
            </p>
          ) : null}
        </section>

        <section aria-labelledby={`${id}-contato`}>
          <TituloParte id={`${id}-contato`}>Contato</TituloParte>
          {filtros.lead ? (
            <LinhaMarcavel
              marcado={Boolean(rascunho.lead)}
              aoMudar={(sim) =>
                setRascunho((r) => ({ ...r, lead: sim ? filtros.lead : "" }))
              }
            >
              Só os registros de {nomeDoLead ?? "um contato"}
            </LinhaMarcavel>
          ) : null}
          <label className="relative block">
            <span className="sr-only">Nome ou telefone do contato</span>
            <Search
              size={16}
              strokeWidth={1.75}
              aria-hidden
              className="pointer-events-none absolute top-1/2 left-1 -translate-y-1/2 text-texto-3"
            />
            <input
              type="search"
              value={rascunho.contato}
              onChange={(e) =>
                setRascunho((r) => ({ ...r, contato: e.target.value }))
              }
              onKeyDown={(e) => {
                if (e.key === "Enter") {
                  e.preventDefault();
                  mostrar();
                }
              }}
              placeholder="Nome ou telefone"
              maxLength={80}
              autoComplete="off"
              enterKeyHint="search"
              className={cn(CAMPO, "w-full pl-3.5")}
            />
          </label>
        </section>

        <section aria-labelledby={`${id}-pessoas`}>
          <TituloParte id={`${id}-pessoas`}>
            {rascunho.quem.length > 0
              ? `Pessoas (${rascunho.quem.length.toLocaleString("pt-BR")})`
              : "Pessoas"}
          </TituloParte>
          {pessoas.length > PESSOAS_SEM_BUSCA ? (
            <label className="relative mb-0.5 block">
              <span className="sr-only">Buscar pessoa</span>
              <Search
                size={16}
                strokeWidth={1.75}
                aria-hidden
                className="pointer-events-none absolute top-1/2 left-1 -translate-y-1/2 text-texto-3"
              />
              <input
                type="search"
                value={buscaPessoa}
                onChange={(e) => setBuscaPessoa(e.target.value)}
                placeholder="Buscar pessoa"
                autoComplete="off"
                className={cn(CAMPO, "w-full pl-3.5")}
              />
            </label>
          ) : null}
          {pessoasVisiveis.length === 0 ? (
            <p className="tipo-nota px-1 py-1 text-texto-2">
              {pessoas.length === 0
                ? "Ninguém na equipe."
                : `Ninguém com “${buscaPessoa.trim()}”.`}
            </p>
          ) : (
            pessoasVisiveis.map((p) => (
              <LinhaMarcavel
                key={p.id}
                marcado={rascunho.quem.includes(p.id)}
                aoMudar={(sim) => marcarPessoa(p.id, sim)}
              >
                {p.nome}
              </LinhaMarcavel>
            ))
          )}
        </section>

        <section aria-labelledby={`${id}-acoes`}>
          <TituloParte id={`${id}-acoes`}>
            {rascunho.acoes.length > 0
              ? `Ações (${rascunho.acoes.length.toLocaleString("pt-BR")})`
              : "Ações"}
          </TituloParte>
          {grupos.map((g) => {
            const chaves = g.acoes.map((a) => a.chave);
            const marcadas = chaves.filter((c) => rascunho.acoes.includes(c));
            return (
              <div
                key={g.id}
                role="group"
                aria-label={g.titulo}
                className="border-t border-fio pt-0.5 first-of-type:border-t-0"
              >
                <LinhaMarcavel
                  forte
                  marcado={marcadas.length === chaves.length}
                  misto={marcadas.length > 0 && marcadas.length < chaves.length}
                  aoMudar={(sim) => marcarAcoes(chaves, sim)}
                >
                  {g.titulo}
                </LinhaMarcavel>
                <div className="pl-2.5">
                  {g.acoes.map((a) => (
                    <LinhaMarcavel
                      key={a.chave}
                      marcado={rascunho.acoes.includes(a.chave)}
                      aoMudar={(sim) => marcarAcoes([a.chave], sim)}
                    >
                      {a.rotulo.charAt(0).toLocaleUpperCase("pt-BR") +
                        a.rotulo.slice(1)}
                    </LinhaMarcavel>
                  ))}
                </div>
              </div>
            );
          })}
        </section>
      </Folha>
    </div>
  );
}
