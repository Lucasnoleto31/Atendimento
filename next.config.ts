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
  // Links e favoritos com os endereços antigos. A ficha do contato mora em
  // /contatos com o mesmo id, então /leads/<id> abre a mesma ficha. A query
  // string segue junto (/hoje?lead=<id> vira /chat?lead=<id>). Temporários
  // (307) enquanto a versão anterior puder voltar pelo "Promote" da Vercel:
  // um 308 fica gravado no navegador, e com a versão antiga de volta /leads/<id>
  // cairia no /contatos (404 lá). Depois de a versão nova se firmar, dá para
  // virar 308.
  async redirects() {
    return [
      { source: "/leads", destination: "/contatos", permanent: false },
      { source: "/leads/novo", destination: "/contatos/novo", permanent: false },
      { source: "/leads/:id", destination: "/contatos/:id", permanent: false },
      {
        source: "/leads/:id/editar",
        destination: "/contatos/:id/editar",
        permanent: false,
      },
      ...TELAS_PARA_O_CHAT.map((source) => ({
        source,
        destination: "/chat",
        permanent: false,
      })),
      // Segundos passos que já existiram no login (app autenticador, depois
      // código por e-mail) e saíram: hoje a entrada é só e-mail e senha.
      // Favorito e aba antiga caem no login (o ?proximo= vai junto); quem já
      // está dentro, o middleware leva ao destino.
      ...["/entrar/2fa", "/entrar/codigo"].map((source) => ({
        source,
        destination: "/entrar",
        permanent: false,
      })),
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
