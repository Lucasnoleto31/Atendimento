/*
 * As ações do Log de acesso em grupos, na ordem do que mais se procura. Os
 * rótulos de cada ação moram em lib/auditoria.ts (ROTULO_ACAO) e chegam à
 * tela pela página; aqui só as chaves. Arquivo puro.
 *
 * "Do sistema antigo" são as ações do CRM que saiu: o sistema não grava mais,
 * mas as linhas antigas continuam na tabela. O grupo só aparece quando há
 * registro delas no período (a página confere).
 */

export type GrupoAcoes = { id: string; titulo: string; acoes: string[] };

export const GRUPOS_ACOES: GrupoAcoes[] = [
  {
    id: "conversas",
    titulo: "Conversas e fichas",
    acoes: ["abriu_conversa", "viu_ficha"],
  },
  {
    id: "exportacoes",
    titulo: "Exportações",
    acoes: ["exportar_leads", "exportar_auditoria"],
  },
  {
    id: "entrada",
    titulo: "Entrada e senha",
    acoes: [
      "login_bloqueado",
      "aparelho_confirmado",
      "codigo_login_bloqueado",
      "recuperacao_pedida",
      "recuperacao_bloqueada",
      "senha_redefinida",
      "trocou_senha",
      "troca_senha_bloqueada",
      "saiu_dos_outros_aparelhos",
      "resetou_senha",
    ],
  },
  {
    id: "equipe",
    titulo: "Equipe",
    acoes: [
      "criou_usuario",
      "mudou_nome_usuario",
      "mudou_email_usuario",
      "mudou_papel_usuario",
      "desativou_usuario",
      "reativou_usuario",
      "pos_no_rodizio",
      "tirou_do_rodizio",
      "removeu_foto_usuario",
      "mudou_proprio_nome",
      "trocou_propria_foto",
    ],
  },
  {
    id: "privacidade",
    titulo: "Privacidade",
    acoes: [
      "privacidade_grupo_criou",
      "privacidade_grupo_mudou",
      "privacidade_grupo_excluiu",
      "privacidade_regra_criou",
      "privacidade_regra_mudou",
      "privacidade_regra_excluiu",
    ],
  },
  {
    id: "mensagens",
    titulo: "Mensagens apagadas",
    acoes: ["apagou_mensagem", "ocultou_mensagem", "restaurou_mensagem"],
  },
  // As ações em massa da lista de contatos (e o "Trocar" do responsável na
  // ficha, que passa pela mesma action).
  {
    id: "contatos",
    titulo: "Contatos",
    acoes: ["etiquetou_contatos", "transferiu_contatos"],
  },
  // As outras subpáginas da Administração, com o nome delas.
  {
    id: "atendimento",
    titulo: "Atendimento",
    acoes: [
      "ligou_distribuicao",
      "desligou_distribuicao",
      "mudou_horario",
      "ligou_resposta_automatica",
      "desligou_resposta_automatica",
      "mudou_resposta_automatica",
      "mudou_teto_envios",
    ],
  },
  {
    id: "whatsapp",
    titulo: "WhatsApp",
    acoes: [
      "criou_numero",
      "mudou_numero",
      "ativou_numero",
      "desativou_numero",
      "excluiu_numero",
    ],
  },
  {
    id: "etiquetas",
    titulo: "Etiquetas",
    acoes: [
      "criou_etiqueta",
      "renomeou_etiqueta",
      "mudou_cor_etiqueta",
      "excluiu_etiqueta",
    ],
  },
  {
    id: "mensagens-padrao",
    titulo: "Mensagens prontas",
    acoes: [
      "criou_mensagem_padrao",
      "mudou_mensagem_padrao",
      "excluiu_mensagem_padrao",
    ],
  },
  {
    id: "importacao",
    titulo: "Importar contatos",
    acoes: ["importou_contatos", "excluiu_importacao"],
  },
  {
    id: "captura",
    titulo: "Formulário de captura",
    acoes: ["captura_bloqueada"],
  },
];

/** As ações do CRM que saiu (só em linhas antigas). */
export const ACOES_ANTIGAS = [
  "viu_cliente",
  "revelou_documento",
  "exportar_carteira",
  "exportar_vendas",
  "resumo_gestor",
  "resumo_gestor_falha",
  "resetou_2fa",
];

export const GRUPO_ANTIGO: GrupoAcoes = {
  id: "antigo",
  titulo: "Do sistema antigo",
  acoes: ACOES_ANTIGAS,
};
