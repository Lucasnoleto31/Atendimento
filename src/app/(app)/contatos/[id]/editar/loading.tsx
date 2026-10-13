import { cn } from "@/lib/utils";

/** Os cinco campos do formulário, na ordem da tela. */
const CAMPOS = [
  { id: "nome", rotulo: "w-[48px]" },
  // O telefone tem a ajuda embaixo.
  { id: "telefone", rotulo: "w-[136px]", ajuda: true },
  { id: "email", rotulo: "w-[48px]" },
  { id: "responsavel", rotulo: "w-[88px]" },
  // A observação é texto longo: a caixa é mais alta.
  { id: "observacao", rotulo: "w-[80px]", alto: true },
];

/**
 * Esqueleto da edição enquanto o servidor responde, no formato do
 * formulário: voltar, título com o nome embaixo, os cinco campos e os dois
 * botões. Sem ele valia o da ficha, com avatar e grupos que esta tela não
 * tem, e o formulário pulava no lugar.
 */
export default function CarregandoEdicao() {
  return (
    <div
      aria-busy="true"
      aria-label="Carregando o contato"
      className="@container px-2 pt-2 pb-4 md:px-3 md:pt-3"
    >
      <div className="motion-safe:animate-pulse">
        <div className="h-[24px] w-[128px] rounded-chip bg-cartao" />

        <div className="mt-2">
          <div className="my-[3px] h-[24px] w-full max-w-[240px] rounded-chip bg-cartao md:h-[28px]" />
          <div className="mt-0.5 h-[16px] w-full max-w-[160px] rounded-chip bg-cartao" />
        </div>

        <div className="mt-3 flex max-w-[560px] flex-col gap-2">
          {CAMPOS.map((c) => (
            <div key={c.id} className="flex flex-col gap-1">
              <div className={cn("my-[2px] h-[16px] rounded-chip bg-cartao", c.rotulo)} />
              <div
                className={cn(
                  "rounded-controle bg-cartao",
                  c.alto ? "h-[96px]" : "h-[40px] pointer-coarse:h-[44px]",
                )}
              />
              {c.ajuda ? (
                <div className="my-[2px] h-[12px] w-full max-w-[280px] rounded-chip bg-cartao" />
              ) : null}
            </div>
          ))}

          <div className="mt-1 grid grid-cols-2 gap-1.5 @md:flex">
            <div className="h-[48px] rounded-controle bg-cartao @md:w-[104px]" />
            <div className="h-[48px] rounded-controle bg-cartao @md:w-[120px]" />
          </div>
        </div>
      </div>
    </div>
  );
}
