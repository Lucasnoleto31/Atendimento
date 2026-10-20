import type { Metadata, Viewport } from "next";
import { cookies } from "next/headers";
import { Poppins } from "next/font/google";
import "./globals.css";
import { ARQUIVOS_DO_TEMA, NOME_DA_EMPRESA, NOME_DO_PRODUTO } from "@/lib/marca";

// A família única da ficha padrão do kit: 400 no corpo, 600 em destaque e
// título, 700 no título grande e no número de destaque. Código e ID usam o
// monoespaçado do sistema (font-codigo), sem baixar fonte.
const poppins = Poppins({
  variable: "--font-poppins",
  subsets: ["latin"],
  weight: ["400", "600", "700"],
  display: "swap",
});

export const metadata: Metadata = {
  title: NOME_DO_PRODUTO,
  description: `Caixa de entrada da equipe da ${NOME_DA_EMPRESA} para as conversas do WhatsApp e do Instagram Direct.`,
  applicationName: NOME_DO_PRODUTO,
};

async function temaEscuro(): Promise<boolean> {
  return (await cookies()).get("tema")?.value === "escuro";
}

/*
 * A cor da barra do navegador acompanha o tema do cookie (o fundo da ficha).
 * viewport-fit=cover faz o env(safe-area-inset-*) valer no iPhone: é dele
 * que a barra de abas tira o recuo do indicador de início.
 */
export async function generateViewport(): Promise<Viewport> {
  const escuro = await temaEscuro();
  return {
    themeColor: escuro ? "#0B0B0B" : "#FFFFFF",
    colorScheme: escuro ? "dark" : "light",
    viewportFit: "cover",
  };
}

export default async function RootLayout({ children }: LayoutProps<"/">) {
  // O cookie é a fonte da verdade do tema: lido aqui no SSR, o <html> já
  // chega com data-theme certo, sem flash e sem script inline no <head>.
  // Sem cookie (ou "claro"), nenhum atributo: o tema claro é o padrão.
  const escuro = await temaEscuro();

  return (
    // data-scroll-behavior: o Next 16 só desliga o scroll-behavior: smooth do
    // globals.css na troca de rota com este atributo. Sem ele, quem sai de
    // uma página rolada via a página nova subir animada (kit, bloco 6: tela
    // nova abre no topo, sem deslizar). O "sobe ao topo" da aba continua
    // suave, porque vai por window.scrollTo.
    <html
      lang="pt-BR"
      data-scroll-behavior="smooth"
      data-theme={escuro ? "dark" : undefined}
      className={`${poppins.variable} h-full antialiased`}
    >
      {ARQUIVOS_DO_TEMA ? (
        <head>
          {/* Os tokens do tema do cliente, por cima dos de globals.css
              (src/lib/marca.ts; docs/NOVO-CLIENTE.md). */}
          <link rel="stylesheet" href={ARQUIVOS_DO_TEMA.css} />
        </head>
      ) : null}
      {/* suppressHydrationWarning: extensões de navegador injetam atributos
          no body antes do React hidratar (ex.: inject_newsvd) e disparavam
          aviso falso. Vale só para atributos deste elemento, nada além. */}
      <body suppressHydrationWarning className="flex min-h-full flex-col">
        {children}
      </body>
    </html>
  );
}
