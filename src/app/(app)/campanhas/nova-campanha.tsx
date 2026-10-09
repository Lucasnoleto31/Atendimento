"use client";

import { useEffect, useRef, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import {
  Check,
  ChevronLeft,
  ChevronRight,
  Plus,
  Search,
  Users,
} from "lucide-react";
import { cn } from "@/lib/utils";
import { Button, classesDoBotao } from "@/components/ui/button";
import {
  AJUDA,
  CAMPO,
  CAMPO_BASE,
  ERRO_CAMPO,
  ROTULO,
} from "@/components/app/form-styles";
import { useComandosDaTela } from "@/components/app/paleta-global";
import { pontoDaEtiqueta } from "../contatos/cor-etiqueta";
import { Folha } from "./folha";
import { CamposRitmo, ritmoDe, type RitmoEditavel } from "./campos-ritmo";
import { criarCampanha, exemploDoPublico } from "./actions";
import {
  SEM_NOME_PADRAO,
  erroDoRitmo,
  frasePrimeiroEnvio,
  montarPrevia,
  nomeLivre,
  nomeSugerido,
  numero,
  partesDoPublico,
  primeiroEnvio,
  rotuloRitmo,
  usaNome,
  valorBruto,
  type PublicoEtiqueta,
  type Relogio,
  type Ritmo,
} from "./regras";

export type TemplateOpcao = {
  nome: string;
  idioma: string;
  categoria: string;
  corpo: string;
  parametros: string[];
};

/**
 * Uma campanha que serve de molde para outra ("Criar parecida", no editor e
 * no cartão da parada): o público, o template, as variáveis, o "para quem
 * não tem nome" e o ritmo dela abrem a nova campanha já na Revisão.
 */
export type BaseParecida = {
  /** A campanha de origem. */
  id: string;
  nome: string;
  etiquetaId: string | null;
  etiquetaNome: string | null;
  templateNome: string;
  templateIdioma: string;
  /** As variáveis gravadas, sem a chave do "sem nome". */
  valores: Record<string, string>;
  /** O "para quem não tem nome" gravado, ou null (campanha antiga). */
  semNome: string | null;
  ritmo: Ritmo;
  /** Do público elegível de hoje, quantos já tiveram envio da origem (o
   *  jaEnviadosElegiveis da página): na nova, recebem de novo. */
  jaTiveramEnvio: number;
  /** A origem não envia (parada, sem público): depois de criar, o retorno
   *  oferece excluí-la. */
  oferecerExcluir: boolean;
};

const PASSOS = ["Público", "Mensagem", "Ritmo", "Revisão"] as const;
/** Escolha única avança sozinha depois de 160ms, para a opção aparecer
 *  marcada (kit, bloco 8). */
const AVANCO_MS = 160;
/** Acima de tantos itens, a lista ganha a busca no topo (o mesmo
 *  ITENS_SEM_BUSCA dos filtros do chat e de Contatos, em
 *  conversas/barra-filtros.tsx; copiado para não trazer aquele módulo
 *  inteiro para esta tela). */
const ITENS_SEM_BUSCA = 8;

const CATEGORIA: Record<string, string> = {
  MARKETING: "Marketing",
  UTILITY: "Utilidade",
  AUTHENTICATION: "Autenticação",
};

const RITMO_PADRAO: RitmoEditavel = {
  porDia: "30",
  horaInicio: 9,
  horaFim: 18,
  diasUteis: true,
};

/** O pedido de "Criar parecida" chega à folha por um evento da janela: o
 *  botão mora no cartão e no editor, longe dela. */
const EVENTO_PARECIDA = "campanhas:criar-parecida";

/** Abre a nova campanha com tudo da `base` preenchido, na Revisão. */
export function abrirCampanhaParecida(base: BaseParecida) {
  window.dispatchEvent(
    new CustomEvent<BaseParecida>(EVENTO_PARECIDA, { detail: base }),
  );
}

/** "Criar parecida" no cartão de uma campanha que não envia. */
export function BotaoParecida({ base }: { base: BaseParecida }) {
  return (
    <Button
      type="button"
      variant="secondary"
      onClick={() => abrirCampanhaParecida(base)}
      aria-haspopup="dialog"
      aria-label={`Criar campanha parecida com ${base.nome}`}
      className="pointer-coarse:h-[44px]"
    >
      Criar parecida
    </Button>
  );
}

/**
 * O rascunho que sobrevive à ida a Contatos ("Montar público em Contatos"):
 * guardado no sessionStorage desta aba e lido ao voltar a Disparos, se for
 * de até uma hora atrás. Falhou a leitura ou a escrita (aba anônima, cota),
 * a tela segue sem ele. Ler não apaga: o rascunho só sai do armazenamento
 * depois de restaurado (sem a lista de templates ele espera a próxima
 * abertura de Disparos, em vez de voltar sem a mensagem).
 */
const CHAVE_RASCUNHO = "zeve:nova-campanha:rascunho";
const RASCUNHO_VALE_MS = 60 * 60 * 1000;

type Rascunho = {
  v: 1;
  salvoEm: number;
  passo: number;
  etiquetaId: string | null;
  templateChave: string | null;
  escolhendoTemplate: boolean;
  valores: Record<string, string>;
  semNome: string;
  ritmo: RitmoEditavel;
  nome: string;
  nomeMexido: boolean;
  origem: BaseParecida | null;
};

function lerRascunho(): Rascunho | null {
  try {
    const bruto = window.sessionStorage.getItem(CHAVE_RASCUNHO);
    if (!bruto) return null;
    let r: Partial<Rascunho> | null = null;
    try {
      r = JSON.parse(bruto) as Partial<Rascunho> | null;
    } catch {
      r = null;
    }
    if (
      !r ||
      r.v !== 1 ||
      typeof r.salvoEm !== "number" ||
      Date.now() - r.salvoEm > RASCUNHO_VALE_MS ||
      typeof r.passo !== "number" ||
      !r.ritmo ||
      typeof r.valores !== "object"
    ) {
      // Vencido ou ilegível: não serve mais, sai já.
      apagarRascunho();
      return null;
    }
    return r as Rascunho;
  } catch {
    return null;
  }
}

function apagarRascunho() {
  try {
    window.sessionStorage.removeItem(CHAVE_RASCUNHO);
  } catch {
    // Sem acesso ao armazenamento: não há o que apagar.
  }
}

function guardarRascunho(r: Rascunho): boolean {
  try {
    window.sessionStorage.setItem(CHAVE_RASCUNHO, JSON.stringify(r));
    return true;
  } catch {
    return false;
  }
}

/** Minúsculas e sem acento: "promocao" acha "Promoção". */
function normalizar(texto: string): string {
  return texto
    .normalize("NFD")
    .replace(/\p{Diacritic}/gu, "")
    .toLocaleLowerCase("pt-BR")
    .trim();
}

/** Corpo com as variáveis e o {nome} trocado por `nome`. */
function previa(
  template: TemplateOpcao,
  valores: Record<string, string>,
  nome: string,
): string {
  return montarPrevia(template.corpo, template.parametros, valores, nome);
}

/**
 * A busca no topo de uma lista comprida da folha. Esc com texto limpa antes
 * de fechar; Enter não segue o passo (o pé tem o botão para isso).
 */
function CampoBusca({
  valor,
  aoMudar,
  rotulo,
}: {
  valor: string;
  aoMudar: (valor: string) => void;
  rotulo: string;
}) {
  return (
    <label className="relative mt-1.5 block">
      <span className="sr-only">{rotulo}</span>
      <Search
        size={16}
        strokeWidth={1.75}
        aria-hidden
        className="pointer-events-none absolute top-1/2 left-1 -translate-y-1/2 text-texto-3"
      />
      <input
        type="search"
        value={valor}
        onChange={(e) => aoMudar(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === "Escape" && valor) {
            e.preventDefault();
            e.stopPropagation();
            aoMudar("");
          }
        }}
        placeholder={rotulo}
        autoComplete="off"
        autoCorrect="off"
        spellCheck={false}
        enterKeyHint="search"
        className={cn(
          CAMPO_BASE,
          "tipo-corpo w-full pr-1 pl-3.5 [&::-webkit-search-cancel-button]:hidden",
        )}
      />
    </label>
  );
}

/**
 * Nova campanha em quatro passos (kit, bloco 8): Público, Mensagem, Ritmo e
 * Revisão. Folha presa no pé no celular, janela de 560px do tablet para cima,
 * aberta pelo botão redondo do cabeçalho. Escolha única avança sozinha; o
 * "← passo anterior" fica sempre à vista; da revisão, cada linha volta ao
 * passo dela e o botão do passo devolve à revisão.
 *
 * O rascunho sobrevive a fechar sem querer (toque fora, arrasto): reabrir
 * volta onde estava. Só depois de criar ele começa do zero. Também
 * sobrevive à ida a Contatos para montar o público (sessionStorage): ao
 * voltar a Disparos, a folha reabre no ponto em que estava.
 *
 * "Criar parecida" (abrirCampanhaParecida) abre a folha já na Revisão, com
 * tudo de outra campanha copiado e a linha com problema marcada.
 */
export function NovaCampanha({
  templates,
  publicos,
  relogio,
  teto,
  restanteTeto,
  somaAtivas,
  bloqueio,
  nomesUsados,
}: {
  templates: TemplateOpcao[];
  publicos: PublicoEtiqueta[];
  relogio: Relogio;
  teto: number;
  /** O que ainda cabe hoje no teto do número. */
  restanteTeto: number;
  /** Envios por dia das campanhas ativas que de fato enviam. */
  somaAtivas: number;
  /** Motivo de não dar para criar agora (sem template aprovado). */
  bloqueio: string | null;
  /** Os nomes das campanhas que existem: o nome sugerido não repete
   *  nenhum. */
  nomesUsados: string[];
}) {
  const router = useRouter();
  const [aberta, setAberta] = useState(false);
  const [passo, setPasso] = useState(0);
  const [direcao, setDirecao] = useState<1 | -1>(1);
  /** Veio de uma linha da revisão: o botão do passo devolve para ela. */
  const [daRevisao, setDaRevisao] = useState(false);
  const [tentou, setTentou] = useState<Record<number, boolean>>({});

  const [etiquetaId, setEtiquetaId] = useState<string | null>(null);
  const [templateChave, setTemplateChave] = useState<string | null>(null);
  const [escolhendoTemplate, setEscolhendoTemplate] = useState(true);
  const [valores, setValores] = useState<Record<string, string>>({});
  const [semNome, setSemNome] = useState(SEM_NOME_PADRAO);
  const [ritmo, setRitmo] = useState<RitmoEditavel>(RITMO_PADRAO);
  const [nome, setNome] = useState("");
  const [nomeMexido, setNomeMexido] = useState(false);
  const [exemplos, setExemplos] = useState<Record<string, string | null>>({});
  /** A campanha de onde veio o rascunho ("Criar parecida"), ou null. */
  const [origem, setOrigem] = useState<BaseParecida | null>(null);
  const [buscaPublico, setBuscaPublico] = useState("");
  const [buscaTemplate, setBuscaTemplate] = useState("");

  const [erro, setErro] = useState<string | null>(null);
  const [pendente, iniciarTransicao] = useTransition();
  const [acao, setAcao] = useState<"comecar" | "pausada" | null>(null);
  const [limparAoAbrir, setLimparAoAbrir] = useState(false);

  const avanco = useRef<number | null>(null);
  const tituloPasso = useRef<HTMLHeadingElement>(null);
  // O que está na tela: o passo e, no da mensagem, a lista ou o template
  // escolhido. Trocar qualquer um dos dois leva o foco ao título novo.
  const chaveConteudo = `${passo}-${passo === 1 && escolhendoTemplate ? "lista" : "detalhe"}`;
  const conteudoAnterior = useRef(chaveConteudo);
  const campos = useRef<Record<string, HTMLInputElement | null>>({});

  const publico = publicos.find((p) => p.id === etiquetaId) ?? null;
  const template =
    templates.find((t) => `${t.nome}|${t.idioma}` === templateChave) ?? null;
  const exemplo = etiquetaId ? (exemplos[etiquetaId] ?? null) : null;
  const tokens = template?.parametros ?? [];
  // Na tela toda variável pede valor, inclusive a única (que nasce com o
  // {nome}); o motor e a action aceitam a única vazia caindo no {nome}.
  const emBranco = tokens.filter((t) => !(valores[t] ?? "").trim());
  const comNome = template ? usaNome(tokens, valores) : false;
  const ritmoValido = ritmoDe(ritmo);
  const erroRitmo = erroDoRitmo(ritmoValido);

  // As listas como a folha mostra: a busca (a partir de 8 itens) e, no
  // público, quem não alcança ninguém no fim (a ordem alfabética fica
  // dentro de cada parte).
  const termoPublico = normalizar(buscaPublico);
  const publicosVisiveis = publicos
    .filter((p) => !termoPublico || normalizar(p.nome).includes(termoPublico))
    .sort((a, b) => Number(a.recebem === 0) - Number(b.recebem === 0));
  const termoTemplate = normalizar(buscaTemplate);
  const templatesVisiveis = termoTemplate
    ? templates.filter(
        (t) =>
          normalizar(t.nome).includes(termoTemplate) ||
          normalizar(t.corpo).includes(termoTemplate),
      )
    : templates;

  // Troca de passo leva o foco ao título do passo novo (o leitor de tela
  // anuncia onde se está; o teclado segue dali, e o botão que sumiu não
  // deixa o foco cair no body). Não roda ao abrir: aí o foco é da folha.
  useEffect(() => {
    if (conteudoAnterior.current === chaveConteudo) return;
    conteudoAnterior.current = chaveConteudo;
    tituloPasso.current?.focus({ preventScroll: true });
  }, [chaveConteudo]);

  useEffect(
    () => () => {
      if (avanco.current) window.clearTimeout(avanco.current);
    },
    [],
  );

  function limpar() {
    setPasso(0);
    setDirecao(1);
    setDaRevisao(false);
    setTentou({});
    setEtiquetaId(null);
    setTemplateChave(null);
    setEscolhendoTemplate(true);
    setValores({});
    setSemNome(SEM_NOME_PADRAO);
    setRitmo(RITMO_PADRAO);
    setNome("");
    setNomeMexido(false);
    setErro(null);
    setAcao(null);
    setOrigem(null);
    setBuscaPublico("");
    setBuscaTemplate("");
  }

  function abrir() {
    if (limparAoAbrir) {
      limpar();
      setLimparAoAbrir(false);
    }
    setAberta(true);
  }

  /** Um primeiro nome real do público para a prévia; sem ele, a prévia
   *  mostra o marcador do nome. */
  function buscarExemplo(etiqueta: string) {
    if (etiqueta in exemplos) return;
    exemploDoPublico(etiqueta)
      .then((n) => setExemplos((m) => ({ ...m, [etiqueta]: n })))
      .catch(() => setExemplos((m) => ({ ...m, [etiqueta]: null })));
  }

  /**
   * "Criar parecida": copia público, template, variáveis, "para quem não tem
   * nome" e ritmo da `base` e abre na Revisão. O que não existe mais (a
   * etiqueta desativada, o template fora dos aprovados) fica em branco, e a
   * linha da Revisão diz o que escolher. O nome é o do mês, diferente de
   * todas as campanhas (a trava de repetição trataria a cópia idêntica com
   * o mesmo nome como a própria original).
   */
  function abrirParecida(base: BaseParecida) {
    if (pendente) return;
    if (avanco.current) window.clearTimeout(avanco.current);
    const p = publicos.find((x) => x.id === base.etiquetaId) ?? null;
    const t =
      templates.find(
        (x) => x.nome === base.templateNome && x.idioma === base.templateIdioma,
      ) ?? null;
    // Template de uma variável só sem valor gravado já usava o {nome}: a
    // cópia o escreve, como a nova campanha faz ao escolher o template.
    const novosValores: Record<string, string> = {};
    if (t) {
      for (const token of t.parametros) {
        novosValores[token] = valorBruto(token, t.parametros, base.valores);
      }
    }
    setPasso(3);
    setDirecao(1);
    setDaRevisao(false);
    // A variável que falta já aparece marcada no campo quando a pessoa abre
    // a linha Mensagem (é o motivo de ter vindo até aqui).
    setTentou({ 1: true });
    setEtiquetaId(p?.id ?? null);
    setTemplateChave(t ? `${t.nome}|${t.idioma}` : null);
    setEscolhendoTemplate(!t);
    setValores(novosValores);
    setSemNome(base.semNome?.trim() || SEM_NOME_PADRAO);
    setRitmo({
      porDia: String(base.ritmo.porDia),
      horaInicio: base.ritmo.horaInicio,
      horaFim: base.ritmo.horaFim,
      diasUteis: base.ritmo.diasUteis,
    });
    setNome(
      nomeLivre(
        p ? nomeSugerido(p.nome, relogio.dia) : base.nome,
        nomesUsados,
      ),
    );
    setNomeMexido(false);
    setErro(null);
    setAcao(null);
    setOrigem(base);
    setBuscaPublico("");
    setBuscaTemplate("");
    setLimparAoAbrir(false);
    if (p) buscarExemplo(p.id);
    setAberta(true);
  }

  /**
   * O rascunho de volta depois da ida a Contatos. Sem a lista de templates
   * (o bloqueio da nova campanha) não restaura: a folha abriria sem a
   * mensagem, com as variáveis perdidas e o botão de criar desligado. Volta
   * false e o rascunho fica guardado para a próxima abertura.
   */
  function restaurar(r: Rascunho): boolean {
    if (bloqueio) return false;
    const p = publicos.find((x) => x.id === r.etiquetaId) ?? null;
    const t =
      templates.find((x) => `${x.nome}|${x.idioma}` === r.templateChave) ??
      null;
    setPasso(Math.min(Math.max(Math.trunc(r.passo), 0), PASSOS.length - 1));
    setDirecao(1);
    setDaRevisao(false);
    setTentou({});
    setEtiquetaId(p?.id ?? null);
    setTemplateChave(t ? r.templateChave : null);
    setEscolhendoTemplate(!t || r.escolhendoTemplate);
    setValores(t ? r.valores : {});
    setSemNome(r.semNome || SEM_NOME_PADRAO);
    setRitmo(r.ritmo);
    setNome(r.nome);
    setNomeMexido(r.nomeMexido);
    setOrigem(r.origem);
    setErro(null);
    setAcao(null);
    setLimparAoAbrir(false);
    if (p) buscarExemplo(p.id);
    setAberta(true);
    return true;
  }

  // O pedido de "Criar parecida" e o rascunho guardado chegam por fora do
  // React (evento da janela, sessionStorage): as funções vão por ref, para o
  // ouvinte montado uma vez usar sempre as listas mais novas da página.
  const pedidos = useRef({ abrirParecida, restaurar });
  useEffect(() => {
    pedidos.current = { abrirParecida, restaurar };
  });
  useEffect(() => {
    const ouvir = (e: Event) => {
      const base = (e as CustomEvent<BaseParecida>).detail;
      if (base) pedidos.current.abrirParecida(base);
    };
    window.addEventListener(EVENTO_PARECIDA, ouvir);
    // Voltando de Contatos com um rascunho guardado: a folha reabre nele,
    // e só então ele sai do armazenamento.
    const guardado = lerRascunho();
    if (guardado && pedidos.current.restaurar(guardado)) apagarRascunho();
    return () => window.removeEventListener(EVENTO_PARECIDA, ouvir);
  }, []);

  /** "Montar público em Contatos": guarda o rascunho e vai para lá. */
  function montarPublico() {
    guardarRascunho({
      v: 1,
      salvoEm: Date.now(),
      passo,
      etiquetaId,
      templateChave,
      escolhendoTemplate,
      valores,
      semNome,
      ritmo,
      nome,
      nomeMexido,
      origem,
    });
    router.push("/contatos");
  }

  // Na paleta (⌘K / Ctrl+K), enquanto a tela de Disparos estiver aberta.
  useComandosDaTela(
    bloqueio
      ? []
      : [
          {
            id: "disparos-nova-campanha",
            rotulo: "Nova campanha",
            grupo: "Disparos",
            executar: abrir,
          },
        ],
  );

  function irPara(alvo: number, vindoDaRevisao = false) {
    if (avanco.current) window.clearTimeout(avanco.current);
    setDirecao(alvo > passo ? 1 : -1);
    setDaRevisao(vindoDaRevisao);
    setErro(null);
    setPasso(alvo);
  }

  /** Depois do passo: a revisão, se veio dela; senão o seguinte. */
  function seguir() {
    irPara(daRevisao ? 3 : passo + 1);
  }

  function avancarSozinho() {
    if (avanco.current) window.clearTimeout(avanco.current);
    avanco.current = window.setTimeout(seguir, AVANCO_MS);
  }

  function escolherPublico(p: PublicoEtiqueta) {
    setEtiquetaId(p.id);
    buscarExemplo(p.id);
    // O nome sugerido acompanha o público até a pessoa mexer nele, e não
    // repete o de outra campanha.
    if (!nomeMexido) {
      setNome(nomeLivre(nomeSugerido(p.nome, relogio.dia), nomesUsados));
    }
    avancarSozinho();
  }

  function escolherTemplate(t: TemplateOpcao) {
    const chave = `${t.nome}|${t.idioma}`;
    if (chave !== templateChave) {
      setTemplateChave(chave);
      // Template de uma variável só nasce com o {nome}, como sempre foi.
      setValores(t.parametros.length === 1 ? { [t.parametros[0]]: "{nome}" } : {});
      setTentou((m) => ({ ...m, 1: false }));
    }
    setEscolhendoTemplate(false);
    // Sem variável não há o que preencher: segue sozinho.
    if (t.parametros.length === 0) avancarSozinho();
  }

  function seguirDaMensagem() {
    setTentou((m) => ({ ...m, 1: true }));
    if (!template || emBranco.length > 0) return;
    if (comNome && !semNome.trim()) return;
    seguir();
  }

  function seguirDoRitmo() {
    setTentou((m) => ({ ...m, 2: true }));
    if (erroRitmo) return;
    seguir();
  }

  function inserirNome(token: string) {
    const campo = campos.current[token];
    const atual = valores[token] ?? "";
    const inicio = campo?.selectionStart ?? atual.length;
    const fim = campo?.selectionEnd ?? atual.length;
    const novo = `${atual.slice(0, inicio)}{nome}${atual.slice(fim)}`;
    setValores((v) => ({ ...v, [token]: novo }));
    requestAnimationFrame(() => {
      campo?.focus();
      const pos = inicio + "{nome}".length;
      campo?.setSelectionRange(pos, pos);
    });
  }

  function criar(iniciar: boolean) {
    setTentou((m) => ({ ...m, 3: true }));
    // O que ficou inválido depois do passo (a etiqueta ou o template saíram
    // da lista ao recarregar) diz qual linha da revisão abrir, em vez de o
    // botão não fazer nada.
    const falta = !publico
      ? "Falta o público: abra a linha Público e escolha uma etiqueta."
      : publico.recebem === 0
        ? "Ninguém desta etiqueta recebe: abra a linha Público e escolha outra."
        : !template
          ? "Falta a mensagem: abra a linha Mensagem e escolha um template."
          : emBranco.length > 0 || (comNome && !semNome.trim())
            ? "Falta preencher a mensagem: abra a linha Mensagem e complete as variáveis."
            : erroRitmo
              ? "O ritmo precisa de ajuste: abra a linha Ritmo."
              : null;
    setErro(falta);
    if (!publico || !template || falta || !nome.trim()) return;
    setAcao(iniciar ? "comecar" : "pausada");
    iniciarTransicao(async () => {
      // Rede que cai no meio vira erro acima do botão, com o rascunho
      // inteiro na folha, em vez da página de erro. A campanha pode ter sido
      // gravada mesmo assim (só a resposta se perdeu): o segundo toque não
      // cria outra, porque a action reconhece a repetição e devolve o ok, e
      // aí a lista recarrega. Nada de recarregar aqui: com a rede fora, o
      // refresh que falha vira recarga da página inteira e leva o rascunho.
      let resultado: Awaited<ReturnType<typeof criarCampanha>>;
      try {
        resultado = await criarCampanha({
          nome,
          etiquetaId: publico.id,
          templateNome: template.nome,
          templateIdioma: template.idioma,
          valores,
          semNome,
          ...ritmoValido,
          iniciar,
        });
      } catch {
        resultado = {
          erro: "A conexão não respondeu. Confira a internet e tente de novo.",
        };
      }
      if ("erro" in resultado) {
        setErro(resultado.erro);
        setAcao(null);
        return;
      }
      setAberta(false);
      setLimparAoAbrir(true);
      // A parecida de uma campanha que não envia: o retorno oferece
      // excluir a antiga, com a mesma confirmação do editor.
      const antiga = origem?.oferecerExcluir
        ? `&antiga=${encodeURIComponent(origem.id)}`
        : "";
      router.replace(
        `/campanhas?ok=${encodeURIComponent(resultado.ok)}${antiga}&t=${Date.now()}`,
        { scroll: false },
      );
    });
  }

  /* ── Passos ─────────────────────────────────────────────────────── */

  const titulo = (texto: string) => (
    <h3
      ref={tituloPasso}
      tabIndex={-1}
      className="tipo-titulo-2 text-tinta outline-none"
    >
      {texto}
    </h3>
  );

  const passoPublico = (
    <>
      {titulo("Público")}
      <p className="mt-0.5 tipo-nota text-texto-2">
        Quem não tem telefone, bloqueou marketing ou está como perdido fica de
        fora.
      </p>
      {publicos.length === 0 ? (
        <div className="mt-2 rounded-painel bg-cartao px-2.5 py-2">
          <p className="tipo-corpo text-tinta">Nenhuma etiqueta ativa.</p>
          <p className="mt-0.5 tipo-nota text-texto-2">
            O público de uma campanha é uma etiqueta. Crie uma em Configurações
            e marque os contatos nela.
          </p>
          <Button
            href="/configuracoes"
            variant="secondary"
            size="md"
            className="mt-1.5"
          >
            Abrir Configurações
          </Button>
        </div>
      ) : (
        <>
          {publicos.length > ITENS_SEM_BUSCA ? (
            <CampoBusca
              valor={buscaPublico}
              aoMudar={setBuscaPublico}
              rotulo="Buscar etiqueta"
            />
          ) : null}
          {publicosVisiveis.length === 0 ? (
            <p className="mt-1.5 rounded-painel bg-cartao px-2.5 py-2 tipo-corpo text-texto-2">
              Nenhuma etiqueta com “{buscaPublico.trim()}”.
            </p>
          ) : (
            <ul className="mt-1.5 overflow-hidden rounded-painel bg-cartao">
              {publicosVisiveis.map((p) => {
                const escolhido = p.id === etiquetaId;
                const partes = partesDoPublico(p);
                const ninguem = p.recebem === 0;
                return (
                  <li key={p.id} className="group">
                    <button
                      type="button"
                      aria-pressed={escolhido}
                      disabled={ninguem}
                      onClick={() => escolherPublico(p)}
                      className={cn(
                        "flex w-full items-stretch pl-2 text-left transition-colors duration-[120ms] focus-visible:outline-2 focus-visible:-outline-offset-2 focus-visible:outline-tinta",
                        escolhido
                          ? "bg-selecao"
                          : "hover:bg-realce active:bg-pressionado",
                        "disabled:cursor-not-allowed disabled:hover:bg-transparent",
                      )}
                    >
                      {/* Separador encaixado: começa onde o texto começa. */}
                      <span className="flex min-h-[64px] min-w-0 flex-1 items-center gap-1 border-t border-fio py-1 pr-1.5 group-first:border-t-0">
                        <span className="min-w-0 flex-1">
                          <span className="flex items-center gap-0.5">
                            {pontoDaEtiqueta(p.cor) ? (
                              <span
                                aria-hidden
                                className="h-[8px] w-[8px] shrink-0 rounded-full"
                                style={{ backgroundColor: pontoDaEtiqueta(p.cor)! }}
                              />
                            ) : null}
                            <span
                              className={cn(
                                "tipo-destaque min-w-0 truncate",
                                ninguem ? "text-texto-2" : "text-tinta",
                              )}
                            >
                              {p.nome}
                            </span>
                          </span>
                          <span className="mt-0.5 block tipo-nota text-texto-2 tabular-nums">
                            {ninguem ? (
                              "Ninguém recebe"
                            ) : (
                              <span className="font-semibold text-tinta">
                                {numero(p.recebem)} recebem
                              </span>
                            )}
                            {partes.length > 0 ? ` · ${partes.join(" · ")}` : null}
                          </span>
                        </span>
                        {escolhido ? (
                          <Check
                            size={20}
                            strokeWidth={2.25}
                            aria-hidden
                            className="shrink-0 text-tinta"
                          />
                        ) : ninguem ? null : (
                          <ChevronRight
                            size={18}
                            strokeWidth={1.75}
                            aria-hidden
                            className="shrink-0 text-texto-3"
                          />
                        )}
                      </span>
                    </button>
                  </li>
                );
              })}
            </ul>
          )}

          {/* Fora da busca e sempre por último: o público que ainda não é
              etiqueta se monta em Contatos, e a campanha espera aqui. */}
          <div className="mt-1.5 overflow-hidden rounded-painel bg-cartao">
            <button
              type="button"
              onClick={montarPublico}
              className="flex w-full items-center gap-1 py-1 pr-1.5 pl-2 text-left transition-colors duration-[120ms] hover:bg-realce active:bg-pressionado focus-visible:outline-2 focus-visible:-outline-offset-2 focus-visible:outline-tinta"
            >
              <Users
                size={20}
                strokeWidth={1.75}
                aria-hidden
                className="shrink-0 text-texto-2"
              />
              <span className="flex min-h-[48px] min-w-0 flex-1 flex-col justify-center">
                <span className="tipo-corpo text-tinta">
                  Montar público em Contatos
                </span>
                <span className="tipo-nota text-texto-2">
                  Marque os contatos com uma etiqueta e volte a Disparos: a
                  campanha continua daqui.
                </span>
              </span>
              <ChevronRight
                size={18}
                strokeWidth={1.75}
                aria-hidden
                className="shrink-0 text-texto-3"
              />
            </button>
          </div>
        </>
      )}
    </>
  );

  const listaTemplates = (
    <>
      {titulo("Mensagem")}
      {templates.length > ITENS_SEM_BUSCA ? (
        <CampoBusca
          valor={buscaTemplate}
          aoMudar={setBuscaTemplate}
          rotulo="Buscar template"
        />
      ) : null}
      {templatesVisiveis.length === 0 ? (
        <p className="mt-1.5 rounded-painel bg-cartao px-2.5 py-2 tipo-corpo text-texto-2">
          Nenhum template com “{buscaTemplate.trim()}”.
        </p>
      ) : null}
      <ul
        className={cn(
          "mt-1.5 overflow-hidden rounded-painel bg-cartao",
          templatesVisiveis.length === 0 && "hidden",
        )}
      >
        {templatesVisiveis.map((t) => {
          const chave = `${t.nome}|${t.idioma}`;
          const escolhido = chave === templateChave;
          const variaveis = t.parametros.length;
          return (
            <li key={chave} className="group">
              <button
                type="button"
                aria-pressed={escolhido}
                onClick={() => escolherTemplate(t)}
                className={cn(
                  "flex w-full items-stretch pl-2 text-left transition-colors duration-[120ms] focus-visible:outline-2 focus-visible:-outline-offset-2 focus-visible:outline-tinta",
                  escolhido
                    ? "bg-selecao"
                    : "hover:bg-realce active:bg-pressionado",
                )}
              >
                <span className="flex min-h-[64px] min-w-0 flex-1 items-center gap-1 border-t border-fio py-1 pr-1.5 group-first:border-t-0">
                  <span className="min-w-0 flex-1">
                    <span className="block tipo-destaque break-words text-tinta">
                      {t.nome}
                    </span>
                    <span className="block tipo-nota text-texto-2">
                      {CATEGORIA[t.categoria.toUpperCase()] ?? t.categoria} ·{" "}
                      {variaveis === 0
                        ? "sem variável"
                        : variaveis === 1
                          ? "1 variável"
                          : `${variaveis} variáveis`}
                    </span>
                    <span className="mt-0.5 line-clamp-2 block tipo-nota break-words text-texto-2">
                      {t.corpo}
                    </span>
                  </span>
                  {escolhido ? (
                    <Check
                      size={20}
                      strokeWidth={2.25}
                      aria-hidden
                      className="shrink-0 text-tinta"
                    />
                  ) : (
                    <ChevronRight
                      size={18}
                      strokeWidth={1.75}
                      aria-hidden
                      className="shrink-0 text-texto-3"
                    />
                  )}
                </span>
              </button>
            </li>
          );
        })}
      </ul>
    </>
  );

  const mostrarErroMensagem = Boolean(tentou[1]);
  const detalheTemplate = template ? (
    <>
      {titulo("Mensagem")}
      <div className="mt-1 flex items-center justify-between gap-1 rounded-painel bg-cartao py-1 pr-1 pl-2">
        <p className="min-w-0 tipo-destaque break-words text-tinta">
          {template.nome}
        </p>
        <Button
          type="button"
          variant="ghost"
          size="sm"
          onClick={() => setEscolhendoTemplate(true)}
        >
          Trocar
        </Button>
      </div>

      {tokens.length > 0 ? (
        <div className="mt-2 flex flex-col gap-2">
          {tokens.map((token) => {
            const falta = mostrarErroMensagem && emBranco.includes(token);
            const campoId = `nova-campanha-var-${token}`;
            return (
              <div key={token} className="flex min-w-0 flex-col gap-1">
                <label htmlFor={campoId} className={ROTULO}>
                  Variável <span className="font-codigo">{`{{${token}}}`}</span>
                </label>
                <div className="flex gap-1.5">
                  <input
                    id={campoId}
                    ref={(el) => {
                      campos.current[token] = el;
                    }}
                    type="text"
                    value={valores[token] ?? ""}
                    onChange={(e) =>
                      setValores((v) => ({ ...v, [token]: e.target.value }))
                    }
                    aria-invalid={falta ? true : undefined}
                    aria-describedby={falta ? `${campoId}-erro` : undefined}
                    className={cn(CAMPO, "min-w-0 flex-1")}
                  />
                  <button
                    type="button"
                    onClick={() => inserirNome(token)}
                    title="Inserir {nome}: vira o primeiro nome do contato"
                    aria-label={`Inserir {nome} na variável ${token}: vira o primeiro nome do contato`}
                    className={cn(
                      classesDoBotao({ variant: "secondary", size: "md" }),
                      "shrink-0 px-1.5 font-codigo font-normal pointer-coarse:h-[44px]",
                    )}
                  >
                    {"{nome}"}
                  </button>
                </div>
                {falta ? (
                  <p id={`${campoId}-erro`} className={ERRO_CAMPO}>
                    Preencha: a Meta recusa variável vazia.
                  </p>
                ) : null}
              </div>
            );
          })}

          {comNome ? (
            <div className="flex min-w-0 flex-col gap-1">
              <label htmlFor="nova-campanha-sem-nome" className={ROTULO}>
                Para quem não tem nome
              </label>
              <input
                id="nova-campanha-sem-nome"
                type="text"
                value={semNome}
                onChange={(e) => setSemNome(e.target.value)}
                aria-invalid={
                  mostrarErroMensagem && !semNome.trim() ? true : undefined
                }
                aria-describedby="nova-campanha-sem-nome-ajuda"
                className={CAMPO}
              />
              <p
                id="nova-campanha-sem-nome-ajuda"
                className={
                  mostrarErroMensagem && !semNome.trim() ? ERRO_CAMPO : AJUDA
                }
              >
                {mostrarErroMensagem && !semNome.trim()
                  ? "Escreva o que vai no lugar do nome."
                  : "Vai no lugar do {nome} de quem entrou como Lead 1234 ou WhatsApp 1234."}
              </p>
            </div>
          ) : null}
        </div>
      ) : null}

      <div className="mt-2 flex flex-col gap-1">
        <p className="tipo-nota text-texto-2">
          {comNome
            ? exemplo
              ? `Prévia para ${exemplo}`
              : "Prévia"
            : "Prévia"}
        </p>
        <p className="rounded-painel bg-cartao px-2 py-1.5 tipo-corpo break-words whitespace-pre-wrap text-tinta">
          {previa(template, valores, exemplo ?? "‹nome›")}
        </p>
        {comNome ? (
          <>
            <p className="mt-0.5 tipo-nota text-texto-2">
              Prévia para quem não tem nome
            </p>
            <p className="rounded-painel bg-cartao px-2 py-1.5 tipo-corpo break-words whitespace-pre-wrap text-tinta">
              {previa(template, valores, semNome.trim() || "‹nome›")}
            </p>
          </>
        ) : null}
      </div>
    </>
  ) : null;

  const passoMensagem =
    templates.length === 0 ? (
      <>
        {titulo("Mensagem")}
        <div className="mt-2 rounded-painel bg-cartao px-2.5 py-2">
          <p className="tipo-corpo text-tinta">
            Nenhum template aprovado na Meta.
          </p>
          <p className="mt-0.5 tipo-nota text-texto-2">
            Aprove um no Gerenciador do WhatsApp da Meta.
          </p>
        </div>
      </>
    ) : escolhendoTemplate || !template ? (
      listaTemplates
    ) : (
      detalheTemplate
    );

  const passoRitmo = (
    <>
      {titulo("Ritmo")}
      <div className="mt-1.5">
        <CamposRitmo
          id="nova-campanha"
          valor={ritmo}
          aoMudar={setRitmo}
          mostrarErro={Boolean(tentou[2])}
          faltam={publico?.recebem ?? 0}
          jaHoje={0}
          relogio={relogio}
          teto={teto}
          somaOutras={somaAtivas}
        />
      </div>
    </>
  );

  const envioHoje =
    publico && !erroRitmo
      ? frasePrimeiroEnvio(
          primeiroEnvio(
            {
              ...ritmoValido,
              jaHoje: 0,
              restanteTeto,
              faltam: publico.recebem,
            },
            relogio,
          ),
          publico.recebem,
        )
      : null;
  const nomeEmBranco = Boolean(tentou[3]) && !nome.trim();

  // O que impede criar, escrito na linha da Revisão que resolve: na parecida
  // a folha abre direto aqui, e a linha com problema é o próximo toque.
  const problemaPublico = publico
    ? publico.recebem === 0
      ? "Ninguém desta etiqueta recebe: escolha outra."
      : null
    : origem
      ? origem.etiquetaId
        ? `A etiqueta ${origem.etiquetaNome ?? "da original"} não está ativa: escolha outra.`
        : "A etiqueta da original foi excluída: escolha outra."
      : null;
  const problemaMensagem = template
    ? emBranco.length > 0
      ? `Falta ${emBranco.length === 1 ? "a variável" : "as variáveis"} ${emBranco
          .map((t) => `{{${t}}}`)
          .join(", ")}.`
      : comNome && !semNome.trim()
        ? "Falta o texto para quem não tem nome."
        : null
    : origem
      ? `O template ${origem.templateNome} não está entre os aprovados: escolha outro.`
      : null;

  const linhasRevisao: {
    rotulo: string;
    valor: string;
    problema: string | null;
    passo: number;
  }[] = [
    {
      rotulo: "Público",
      valor: publico
        ? `${publico.nome} · ${numero(publico.recebem)} recebem`
        : "Escolher",
      problema: problemaPublico,
      passo: 0,
    },
    {
      rotulo: "Mensagem",
      valor: template?.nome ?? "Escolher",
      problema: problemaMensagem,
      passo: 1,
    },
    {
      rotulo: "Ritmo",
      valor: erroRitmo ? "Ajustar" : rotuloRitmo(ritmoValido),
      problema: erroRitmo,
      passo: 2,
    },
  ];
  // Quem já teve envio da original e continua no público: na nova, recebe
  // de novo. Só vale com o mesmo público da original.
  const repetidos =
    origem && publico && publico.id === origem.etiquetaId
      ? origem.jaTiveramEnvio
      : 0;

  const passoRevisao = (
    <>
      {titulo("Revisão")}
      <div className="mt-1.5 flex flex-col gap-1">
        <label htmlFor="nova-campanha-nome" className={ROTULO}>
          Nome da campanha
        </label>
        <input
          id="nova-campanha-nome"
          type="text"
          value={nome}
          maxLength={120}
          onChange={(e) => {
            setNome(e.target.value);
            setNomeMexido(true);
          }}
          aria-invalid={nomeEmBranco ? true : undefined}
          aria-describedby={nomeEmBranco ? "nova-campanha-nome-erro" : undefined}
          className={CAMPO}
        />
        {nomeEmBranco ? (
          <p id="nova-campanha-nome-erro" className={ERRO_CAMPO}>
            Dê um nome à campanha.
          </p>
        ) : null}
      </div>

      <ul className="mt-2 overflow-hidden rounded-painel bg-cartao">
        {linhasRevisao.map((linha) => (
          <li key={linha.rotulo} className="group">
            <button
              type="button"
              onClick={() => irPara(linha.passo, true)}
              className="flex w-full items-stretch pl-2 text-left transition-colors duration-[120ms] hover:bg-realce active:bg-pressionado focus-visible:outline-2 focus-visible:-outline-offset-2 focus-visible:outline-tinta"
            >
              <span className="flex min-h-[48px] min-w-0 flex-1 items-center gap-1 border-t border-fio py-1 pr-1.5 group-first:border-t-0">
                <span className="w-[104px] shrink-0 tipo-corpo text-texto-2 md:w-[96px]">
                  {linha.rotulo}
                </span>
                <span className="min-w-0 flex-1">
                  <span className="block tipo-corpo break-words text-tinta tabular-nums">
                    {linha.valor}
                  </span>
                  {linha.problema ? (
                    <span className="block tipo-nota break-words text-atencao">
                      {linha.problema}
                    </span>
                  ) : null}
                </span>
                <ChevronRight
                  size={18}
                  strokeWidth={1.75}
                  aria-hidden
                  className="shrink-0 text-texto-3"
                />
              </span>
            </button>
          </li>
        ))}
      </ul>

      {template ? (
        <p className="mt-2 rounded-painel bg-cartao px-2 py-1.5 tipo-corpo break-words whitespace-pre-wrap text-tinta">
          {previa(template, valores, exemplo ?? "‹nome›")}
        </p>
      ) : null}

      {repetidos > 0 && origem ? (
        <p className="mt-2 tipo-corpo text-tinta tabular-nums">
          {repetidos === 1
            ? `1 pessoa deste público já teve envio de ${origem.nome} e recebe esta também.`
            : `${numero(repetidos)} deste público já tiveram envio de ${origem.nome} e recebem esta também.`}
        </p>
      ) : null}

      {envioHoje ? (
        <p className="mt-2 tipo-corpo text-tinta tabular-nums">
          Começando agora: {envioHoje.charAt(0).toLowerCase()}
          {envioHoje.slice(1)}
        </p>
      ) : null}
    </>
  );

  /* ── Pé de cada passo ───────────────────────────────────────────── */

  const rotuloSeguir = daRevisao ? "Voltar à revisão" : "Continuar";
  let rodape: React.ReactNode = null;
  if (passo === 0 && etiquetaId) {
    rodape = (
      <Button type="button" size="lg" className="w-full" onClick={seguir}>
        {rotuloSeguir}
      </Button>
    );
  } else if (passo === 1 && template && !escolhendoTemplate) {
    rodape = (
      <Button
        type="button"
        size="lg"
        className="w-full"
        onClick={seguirDaMensagem}
      >
        {rotuloSeguir}
      </Button>
    );
  } else if (passo === 2) {
    rodape = (
      <Button
        type="button"
        size="lg"
        className="w-full"
        onClick={seguirDoRitmo}
      >
        {rotuloSeguir}
      </Button>
    );
  } else if (passo === 3) {
    rodape = (
      <div className="flex flex-col gap-1">
        {erro ? (
          <p role="alert" className="tipo-nota text-erro">
            {erro}
          </p>
        ) : null}
        <div className="flex flex-col gap-1.5 md:flex-row-reverse">
          <Button
            type="button"
            size="lg"
            className="w-full md:flex-1"
            onClick={() => criar(true)}
            carregando={pendente && acao === "comecar"}
            disabled={pendente}
          >
            {pendente && acao === "comecar" ? "Criando…" : "Criar e começar"}
          </Button>
          <Button
            type="button"
            variant="secondary"
            size="lg"
            className="w-full md:flex-1"
            onClick={() => criar(false)}
            carregando={pendente && acao === "pausada"}
            disabled={pendente}
          >
            {pendente && acao === "pausada" ? "Criando…" : "Criar pausada"}
          </Button>
        </div>
      </div>
    );
  }

  const topo = (
    <div className="shrink-0 px-2 pt-1 md:px-3">
      <div
        role="progressbar"
        aria-label="Progresso da nova campanha"
        aria-valuemin={1}
        aria-valuemax={PASSOS.length}
        aria-valuenow={passo + 1}
        aria-valuetext={`Passo ${passo + 1} de ${PASSOS.length}: ${PASSOS[passo]}`}
        className="h-[4px] overflow-hidden rounded-full bg-realce"
      >
        <div
          className="h-full rounded-full bg-tinta transition-[width] duration-[280ms] ease-padrao"
          style={{ width: `${((passo + 1) / PASSOS.length) * 100}%` }}
        />
      </div>
      {/* O voltar só existe do segundo passo em diante; no primeiro, a
          faixa encolhe e o título sobe. */}
      <div className={cn("flex items-center", passo > 0 ? "h-[44px]" : "h-1")}>
        {passo > 0 ? (
          <button
            type="button"
            onClick={() => irPara(passo - 1)}
            className="-ml-1 inline-flex h-[44px] items-center gap-0.5 rounded-controle pr-1.5 pl-0.5 tipo-corpo text-tinta transition-colors duration-[120ms] hover:bg-realce focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-tinta"
          >
            <ChevronLeft size={20} strokeWidth={1.75} aria-hidden />
            {PASSOS[passo - 1]}
          </button>
        ) : null}
      </div>
    </div>
  );

  const conteudo =
    passo === 0
      ? passoPublico
      : passo === 1
        ? passoMensagem
        : passo === 2
          ? passoRitmo
          : passoRevisao;

  return (
    <>
      <button
        type="button"
        onClick={abrir}
        disabled={Boolean(bloqueio)}
        title={bloqueio ?? "Nova campanha"}
        aria-label="Nova campanha"
        aria-haspopup="dialog"
        className={cn(
          classesDoBotao({ variant: "primary", size: "md" }),
          // Telefone: o botão redondo tintado do cabeçalho (kit, bloco 7).
          "h-[44px] w-[44px] shrink-0 rounded-full px-0 md:h-[40px] md:w-auto md:rounded-controle md:px-2",
        )}
      >
        <Plus size={22} strokeWidth={2} aria-hidden className="md:hidden" />
        <span className="hidden md:inline">Nova campanha</span>
      </button>

      <Folha
        aberta={aberta}
        aoFechar={() => setAberta(false)}
        titulo="Nova campanha"
        apoio={
          origem
            ? `Parecida com ${origem.nome} · passo ${passo + 1} de ${PASSOS.length}`
            : `Passo ${passo + 1} de ${PASSOS.length}`
        }
        topo={topo}
        rodape={rodape}
      >
        <div
          key={chaveConteudo}
          // Enter num campo de texto segue o passo, como o botão do pé (o
          // teclado numérico do celular não tem Enter: o botão fica acima
          // dele). Na revisão não: ali são dois botões e criar não é atalho.
          onKeyDown={(e) => {
            const alvo = e.target;
            if (
              e.key !== "Enter" ||
              e.nativeEvent.isComposing ||
              !(alvo instanceof HTMLInputElement) ||
              alvo.type === "checkbox" ||
              // A busca da lista não segue o passo.
              alvo.type === "search"
            ) {
              return;
            }
            if (passo === 1) {
              e.preventDefault();
              seguirDaMensagem();
            } else if (passo === 2) {
              e.preventDefault();
              seguirDoRitmo();
            }
          }}
          className={cn(
            "transition-[translate,opacity] duration-[180ms] ease-padrao starting:opacity-0",
            direcao > 0
              ? "starting:translate-x-[16px]"
              : "starting:-translate-x-[16px]",
          )}
        >
          {conteudo}
        </div>
      </Folha>
    </>
  );
}
