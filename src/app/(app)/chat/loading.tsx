import { cn } from "@/lib/utils";

/**
 * Esqueleto do /chat enquanto o servidor monta a fila e os catálogos: sem
 * isto, o clique no menu ficava mudo até a página inteira chegar. A forma
 * espelha a tela: no alto da fila o título, a busca, as visões e o escopo;
 * as linhas com avatar e três linhas de texto; ao lado (de 768px para cima)
 * a conversa. A casca dá a altura (o filho direto do main estica até a
 * altura útil); o pulso só corre com o movimento liberado.
 *
 * O raio sai à parte do bloco: célula nas linhas de texto, painel nas
 * bolhas. Junto no mesmo className, os dois raios brigavam e quem vencia era
 * a ordem do CSS, não a da string (o cn não conhece os raios do tema).
 */
const BLOCO = "bg-cartao motion-safe:animate-pulse";

export default function CarregandoChat() {
  return (
    <div
      role="status"
      aria-busy="true"
      aria-label="Carregando as conversas"
      className="flex h-full min-h-0 bg-fundo"
    >
      <div className="flex w-full min-w-0 flex-col border-fio md:w-[360px] md:shrink-0 md:border-r">
        <div className="shrink-0 px-2 pt-[max(8px,env(safe-area-inset-top))] pb-1 md:pt-1.5">
          <div className="flex h-[48px] items-center gap-1">
            <div className={cn("h-[32px] w-[96px] rounded-celula", BLOCO)} />
            <div className={cn("ml-auto h-[40px] w-[88px] rounded-celula", BLOCO)} />
          </div>
          <div className={cn("mt-1 h-[44px] md:h-[40px] rounded-celula", BLOCO)} />
          <div className={cn("mt-1 h-[36px] rounded-celula", BLOCO)} />
          <div className={cn("mt-1 h-[32px] w-[200px] rounded-celula", BLOCO)} />
        </div>
        <div className="min-h-0 flex-1 overflow-hidden">
          {[0, 1, 2, 3, 4, 5, 6].map((i) => (
            <div key={i} className="group flex gap-1.5 pl-2">
              <div
                className="mt-1 h-[44px] w-[44px] shrink-0 rounded-full bg-cartao motion-safe:animate-pulse md:h-[40px] md:w-[40px]"
              />
              <div className="min-w-0 flex-1 border-t border-fio py-1 pr-2 group-first:border-t-0">
                <div className="flex gap-1">
                  <div className={cn("h-[16px] w-[45%] rounded-celula", BLOCO)} />
                  <div className={cn("ml-auto h-[12px] w-[40px] rounded-celula", BLOCO)} />
                </div>
                <div className={cn("mt-1 h-[14px] w-[85%] rounded-celula", BLOCO)} />
                <div className={cn("mt-1 h-[12px] w-[50%] rounded-celula", BLOCO)} />
              </div>
            </div>
          ))}
        </div>
      </div>

      <div className="hidden min-w-0 flex-1 flex-col md:flex">
        <div className="flex h-[64px] shrink-0 items-center gap-1.5 border-b border-fio px-3">
          <div className="h-[40px] w-[40px] rounded-full bg-cartao motion-safe:animate-pulse" />
          <div className={cn("h-[16px] w-[160px] rounded-celula", BLOCO)} />
        </div>
        <div className="flex min-h-0 flex-1 flex-col justify-end gap-1 px-3 pb-2">
          <div className={cn("h-[44px] w-[42%] self-start rounded-painel", BLOCO)} />
          <div className={cn("h-[64px] w-[52%] self-end rounded-painel", BLOCO)} />
          <div className={cn("h-[44px] w-[36%] self-start rounded-painel", BLOCO)} />
        </div>
        <div className="h-[136px] shrink-0 border-t border-fio" />
      </div>
    </div>
  );
}
