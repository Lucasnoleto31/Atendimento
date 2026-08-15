import { Navbar } from "@/components/site/navbar";
import { Hero } from "@/components/site/hero";
import { Features } from "@/components/site/features";
import { Metrics } from "@/components/site/metrics";
import { Modules } from "@/components/site/modules";
import { Footer } from "@/components/site/footer";

export default function Home() {
  return (
    <>
      <a
        href="#conteudo"
        className="sr-only focus:not-sr-only focus:fixed focus:top-1 focus:left-1 focus:z-[60] focus:rounded-md focus:bg-neutral-0 focus:px-2 focus:py-1 focus:text-sm focus:outline-2 focus:outline-primary-500"
      >
        Pular para o conteúdo
      </a>
      <Navbar />
      <main id="conteudo" className="flex-1 pt-[64px]">
        <Hero />
        <Features />
        <Metrics />
        <Modules />
      </main>
      <Footer />
    </>
  );
}
