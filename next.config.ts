import path from "node:path";
import type { NextConfig } from "next";

/** Endereços de telas que ficaram fora do sistema: favorito antigo cai no chat. */
const TELAS_PARA_O_CHAT = [
  "/hoje",
  "/atendimento",
  "/carteira",
  "/carteira/:id",
  "/pagamentos",
  "/agenda",
];

const nextConfig: NextConfig = {
  // Existe um package-lock.json solto em C:\Users\PICHAU; sem isto o Turbopack
  // sobe a árvore procurando a raiz do workspace e avisa a cada boot.
  turbopack: {
    root: path.resolve(__dirname),
  },
  experimental: {
    serverActions: {
      // Anexos do chat sobem pela server action; o padrão de 1MB não basta.
      bodySizeLimit: "25mb",
    },
  },
  // Links e favoritos com os endereços antigos. Permanentes (308): o
  // navegador grava o desvio e nem pergunta de novo. A ficha do contato mora
  // em /contatos com o mesmo id, então /leads/<id> abre a mesma ficha. A
  // query string segue junto (/hoje?lead=<id> vira /chat?lead=<id>).
  async redirects() {
    return [
      { source: "/leads", destination: "/contatos", permanent: true },
      { source: "/leads/novo", destination: "/contatos/novo", permanent: true },
      { source: "/leads/:id", destination: "/contatos/:id", permanent: true },
      {
        source: "/leads/:id/editar",
        destination: "/contatos/:id/editar",
        permanent: true,
      },
      ...TELAS_PARA_O_CHAT.map((source) => ({
        source,
        destination: "/chat",
        permanent: true,
      })),
      // A tela de cadastro do app autenticador saiu; o segundo passo do
      // login agora é o código por e-mail. Favorito e aba antiga caem nele
      // (o ?proximo= vai junto).
      {
        source: "/entrar/2fa",
        destination: "/entrar/codigo",
        permanent: true,
      },
      // Configurações virou parte da Administração (09/10/2026: uma entrada
      // só no menu). A query vai junto: /configuracoes?abrir=etiqueta:nova
      // abre o editor na subpágina certa. Temporário (307) de propósito: a
      // organização da Administração ainda pode mudar, e um 308 ficaria
      // gravado no navegador de cada um.
      {
        source: "/configuracoes",
        destination: "/admin",
        permanent: false,
      },
    ];
  },
};

export default nextConfig;
