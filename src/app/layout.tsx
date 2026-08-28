import type { Metadata } from "next";
import { cookies } from "next/headers";
import { Geist, Geist_Mono } from "next/font/google";
import "./globals.css";

const geistSans = Geist({
  variable: "--font-geist-sans",
  subsets: ["latin"],
  display: "swap",
});

const geistMono = Geist_Mono({
  variable: "--font-geist-mono",
  subsets: ["latin"],
  display: "swap",
});

export const metadata: Metadata = {
  title: "Zeve CRM — o CRM da mesa de vendas",
  description:
    "Identifique se o lead já é cliente pelo telefone, rastreie a origem do contato, atenda por kanban e calcule a comissão de cada vendedor por produto.",
};

export default async function RootLayout({ children }: LayoutProps<"/">) {
  // O cookie é a fonte da verdade do tema: lido aqui no SSR, o <html> já
  // chega com data-theme certo — sem flash e sem script inline no <head>.
  // Sem cookie (ou "claro"), nenhum atributo: o tema claro é o padrão.
  const temaEscuro = (await cookies()).get("tema")?.value === "escuro";

  return (
    <html
      lang="pt-BR"
      data-theme={temaEscuro ? "dark" : undefined}
      className={`${geistSans.variable} ${geistMono.variable} h-full antialiased`}
    >
      {/* suppressHydrationWarning: extensões de navegador injetam atributos
          no body antes do React hidratar (ex.: inject_newsvd) e disparavam
          aviso falso. Vale só para atributos deste elemento, nada além. */}
      <body suppressHydrationWarning className="flex min-h-full flex-col">
        {children}
      </body>
    </html>
  );
}
