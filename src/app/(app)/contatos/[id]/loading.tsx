/**
 * Esqueleto da ficha enquanto o servidor responde: o toque na linha da
 * lista mostra a tela nova na hora, no formato dela (voltar, avatar, nome,
 * botões e os grupos), sem spinner no meio do conteúdo. A edição tem o
 * dela, no formato do formulário (editar/loading.tsx).
 */
export default function CarregandoContato() {
  return (
    <div
      aria-busy="true"
      aria-label="Carregando o contato"
      className="@container px-2 pt-2 pb-4 md:px-3 md:pt-3"
    >
      <div className="max-w-[1120px] motion-safe:animate-pulse">
        <div className="h-[24px] w-[96px] rounded-chip bg-cartao" />
        <div className="mt-2 flex items-center gap-1.5 @3xl:gap-2">
          <div className="h-[56px] w-[56px] shrink-0 rounded-full bg-cartao @3xl:h-[64px] @3xl:w-[64px]" />
          <div className="flex min-w-0 flex-1 flex-col gap-1">
            <div className="h-[24px] w-full max-w-[240px] rounded-chip bg-cartao" />
            <div className="h-[16px] w-full max-w-[160px] rounded-chip bg-cartao" />
          </div>
        </div>
        <div className="mt-2 grid grid-cols-[1fr_auto] gap-1.5 @3xl:w-[256px]">
          <div className="h-[48px] rounded-controle bg-cartao @3xl:h-[40px] pointer-coarse:@3xl:h-[44px]" />
          <div className="h-[48px] w-[104px] rounded-controle bg-cartao @3xl:h-[40px] pointer-coarse:@3xl:h-[44px]" />
        </div>
        <div className="mt-4 grid gap-4 @4xl:grid-cols-2 @4xl:gap-3">
          <div className="h-[280px] rounded-painel bg-cartao" />
          <div className="h-[160px] rounded-painel bg-cartao" />
        </div>
      </div>
    </div>
  );
}
