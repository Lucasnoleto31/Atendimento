"use client";

import {
  useComandosDaTela,
  type ComandoPaleta,
} from "@/components/app/paleta-global";
import type { PrazoRapido } from "./ferramentas-palco";
import type { VisaoConversas } from "./lista";

/*
 * Os comandos do chat na paleta global (⌘K, Ctrl+K). A paleta própria do
 * chat saiu: a casca monta uma só, com a busca de pessoas e as áreas, e o
 * chat registra aqui o que vale na tela dele (useComandosDaTela). O que
 * depende da conversa aberta só entra com ela aberta. O compliance (só
 * leitura) não recebe comando que grava: só andar, ler, buscar e filtrar.
 */

export type ContextoComandos = {
  /** Há conversa em cena. */
  conversa: boolean;
  /** Ela está sem dono e o papel assume (assessor, gestor, admin). */
  podeAssumir: boolean;
  /** Adiada no prazo: trazer de volta à Caixa. */
  adiada: boolean;
  /** Resolvida: reabrir. */
  resolvida: boolean;
  /** O compositor está na tela (conversa carregada, com mensagens). */
  compositor: boolean;
  /** O papel só lê (compliance): nada que grave entra na lista. */
  somenteLeitura: boolean;
  /** O ⋯ da conversa está na tela com a equipe: "Transferir para…". */
  podeTransferir: boolean;
  /** O ⋯ da conversa está na tela com etiquetas: "Etiquetas…". */
  podeEtiquetar: boolean;
  visao: VisaoConversas;
  /** O papel age em massa (todos, menos o compliance). */
  podeSelecionar: boolean;
  /** A seleção em massa está ligada. */
  selecionando: boolean;
  /** Quantas linhas a fila mostra (o "Selecionar todas"). */
  linhasNaFila: number;
  /** "Só não lidas" está ligado. */
  naoLidas: boolean;
  /** Quantos filtros finos estão ligados. */
  filtrosAtivos: number;
  /** A conversa tem recontato pendente (a faixa no topo). */
  recontato: boolean;
  /** E o recontato leva um template que dá para enviar daqui. */
  recontatoComTemplate: boolean;
  acoes: {
    resolver: () => void;
    adiar: (prazo: PrazoRapido) => void;
    /** "Escolher data e hora" do adiar: abre o diálogo. */
    adiarData: () => void;
    agendarRecontato: () => void;
    enviarTemplateRecontato: () => void;
    recontatoFeito: () => void;
    reagendarRecontato: () => void;
    cancelarRecontato: () => void;
    assumir: () => void;
    reativar: () => void;
    reabrir: () => void;
    resumir: () => void;
    marcarNaoLida: () => void;
    /** Abre o ⋯ da conversa na seção Atendente. */
    transferir: () => void;
    /** Abre o ⋯ da conversa na seção Etiquetas. */
    etiquetar: () => void;
    dadosContato: () => void;
    verFicha: () => void;
    inserirPronta: () => void;
    irPara: (visao: VisaoConversas) => void;
    proxima: () => void;
    anterior: () => void;
    selecionar: () => void;
    selecionarTodas: () => void;
    sairDaSelecao: () => void;
    buscarNaFila: () => void;
    abrirFiltros: () => void;
    alternarNaoLidas: () => void;
    limparFiltros: () => void;
  };
};

const NOMES_VISOES: { visao: VisaoConversas; rotulo: string; atalho?: string }[] =
  [
    { visao: "caixa", rotulo: "Caixa", atalho: "G C" },
    { visao: "aguardando", rotulo: "Aguardando", atalho: "G A" },
    { visao: "adiadas", rotulo: "Adiadas" },
    { visao: "recontatos", rotulo: "Recontatos" },
    { visao: "resolvidas", rotulo: "Resolvidas" },
    { visao: "tudo", rotulo: "Tudo" },
  ];

const GRUPO_CONVERSA = "Esta conversa";
const GRUPO_FILA = "Fila";

/** A lista de comandos do momento. Os ids são estáveis: a paleta só se
 *  redesenha quando entra ou sai um comando. */
export function comandosDoChat(ctx: ContextoComandos): ComandoPaleta[] {
  const { acoes } = ctx;
  const lista: ComandoPaleta[] = [];
  const conversa = (c: Omit<ComandoPaleta, "grupo">) =>
    lista.push({ ...c, grupo: GRUPO_CONVERSA });
  const fila = (c: Omit<ComandoPaleta, "grupo">) =>
    lista.push({ ...c, grupo: GRUPO_FILA });

  if (ctx.conversa) {
    const grava = !ctx.somenteLeitura;
    if (ctx.podeAssumir && grava) {
      conversa({
        id: "chat-assumir",
        rotulo: "Assumir a conversa",
        atalho: "A",
        executar: acoes.assumir,
      });
    }
    if (!ctx.resolvida && grava) {
      conversa({
        id: "chat-resolver",
        rotulo: "Resolver e ir para a próxima",
        atalho: "E",
        executar: acoes.resolver,
      });
      conversa({
        id: "chat-adiar-responder",
        rotulo: "Adiar até a pessoa responder",
        executar: () => acoes.adiar("responder"),
      });
      conversa({
        id: "chat-adiar-1hora",
        rotulo: "Adiar por 1 hora",
        executar: () => acoes.adiar("1hora"),
      });
      conversa({
        id: "chat-adiar-amanha",
        rotulo: "Adiar até amanhã",
        atalho: "H",
        executar: () => acoes.adiar("amanha"),
      });
      conversa({
        id: "chat-adiar-3dias",
        rotulo: "Adiar por 3 dias",
        executar: () => acoes.adiar("3dias"),
      });
      conversa({
        id: "chat-adiar-semana",
        rotulo: "Adiar por 1 semana",
        executar: () => acoes.adiar("1semana"),
      });
      conversa({
        id: "chat-adiar-data",
        rotulo: "Adiar: escolher data e hora…",
        executar: acoes.adiarData,
      });
    }
    if (grava) {
      conversa({
        id: "chat-recontato-agendar",
        rotulo: "Agendar recontato…",
        executar: acoes.agendarRecontato,
      });
    }
    if (ctx.recontato && grava) {
      if (ctx.recontatoComTemplate) {
        conversa({
          id: "chat-recontato-template",
          rotulo: "Recontato: enviar o template…",
          executar: acoes.enviarTemplateRecontato,
        });
      }
      conversa({
        id: "chat-recontato-feito",
        rotulo: "Recontato: marcar como feito",
        executar: acoes.recontatoFeito,
      });
      conversa({
        id: "chat-recontato-reagendar",
        rotulo: "Recontato: reagendar…",
        executar: acoes.reagendarRecontato,
      });
      conversa({
        id: "chat-recontato-cancelar",
        rotulo: "Recontato: cancelar",
        executar: acoes.cancelarRecontato,
      });
    }
    if (ctx.adiada && grava) {
      conversa({
        id: "chat-reativar",
        rotulo: "Voltar para a Caixa agora",
        executar: acoes.reativar,
      });
    }
    if (ctx.resolvida && grava) {
      conversa({
        id: "chat-reabrir",
        rotulo: "Reabrir a conversa",
        executar: acoes.reabrir,
      });
    }
    if (ctx.podeTransferir && grava) {
      conversa({
        id: "chat-transferir",
        rotulo: "Transferir para…",
        executar: acoes.transferir,
      });
    }
    if (ctx.podeEtiquetar && grava) {
      conversa({
        id: "chat-etiquetas",
        rotulo: "Etiquetas…",
        executar: acoes.etiquetar,
      });
    }
    if (ctx.compositor && grava) {
      conversa({
        id: "chat-pronta",
        rotulo: "Inserir mensagem pronta",
        atalho: "/",
        executar: acoes.inserirPronta,
      });
    }
    conversa({
      id: "chat-resumo",
      rotulo: "Resumo da conversa",
      executar: acoes.resumir,
    });
    if (grava) {
      conversa({
        id: "chat-nao-lida",
        rotulo: "Marcar como não lida",
        executar: acoes.marcarNaoLida,
      });
    }
    conversa({
      id: "chat-dados",
      rotulo: "Dados do contato",
      executar: acoes.dadosContato,
    });
    conversa({
      id: "chat-ficha",
      rotulo: "Abrir a ficha do contato",
      executar: acoes.verFicha,
    });
  }

  fila({
    id: "chat-proxima",
    rotulo: "Próxima conversa da fila",
    atalho: "J",
    executar: acoes.proxima,
  });
  fila({
    id: "chat-anterior",
    rotulo: "Conversa anterior da fila",
    atalho: "K",
    executar: acoes.anterior,
  });
  fila({
    id: "chat-buscar-fila",
    rotulo: "Buscar na fila",
    executar: acoes.buscarNaFila,
  });
  fila({
    id: "chat-filtros",
    rotulo: "Filtros da fila",
    executar: acoes.abrirFiltros,
  });
  fila({
    id: "chat-nao-lidas",
    rotulo: ctx.naoLidas ? "Mostrar lidas e não lidas" : "Só não lidas",
    executar: acoes.alternarNaoLidas,
  });
  if (ctx.filtrosAtivos > 0) {
    fila({
      id: "chat-limpar-filtros",
      rotulo: "Limpar filtros da fila",
      executar: acoes.limparFiltros,
    });
  }
  for (const v of NOMES_VISOES) {
    if (v.visao === ctx.visao) continue;
    fila({
      id: `chat-visao-${v.visao}`,
      rotulo: `Ver ${v.rotulo}`,
      atalho: v.atalho,
      executar: () => acoes.irPara(v.visao),
    });
  }
  if (ctx.podeSelecionar && !ctx.selecionando) {
    fila({
      id: "chat-selecionar",
      rotulo: "Selecionar conversas",
      executar: acoes.selecionar,
    });
  }
  if (ctx.selecionando) {
    if (ctx.linhasNaFila > 0) {
      fila({
        id: "chat-selecionar-todas",
        rotulo: `Selecionar todas (${ctx.linhasNaFila.toLocaleString("pt-BR")})`,
        executar: acoes.selecionarTodas,
      });
    }
    fila({
      id: "chat-sair-selecao",
      rotulo: "Sair da seleção",
      atalho: "Esc",
      executar: acoes.sairDaSelecao,
    });
  }
  return lista;
}

/**
 * Registra os comandos do chat enquanto a tela está montada. É um
 * componente (e não uma chamada no meio do render do chat) porque as ações
 * são funções do chat que só rodam quando alguém escolhe o comando.
 */
export function ComandosDoChat(props: ContextoComandos) {
  useComandosDaTela(comandosDoChat(props));
  return null;
}
