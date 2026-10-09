"use client";

import { useEffect } from "react";
import { useRouter } from "next/navigation";
import { AlertCircle, Check } from "lucide-react";
import { ConfirmacaoExclusao, type CampanhaExcluivel } from "./excluir";

/**
 * O retorno da última ação ("VIP · out/2026 criada, pausada.", "Ritmo de VIP
 * salvo.") ou o erro dela. Chega pela URL (?ok= ou ?aviso=) e sai dela assim
 * que aparece: recarregar a página não repete um aviso velho. O status vai em
 * tom de status; só o erro é alerta.
 *
 * Com `antiga` (?antiga=, a campanha parada de onde saiu a nova pelo "Criar
 * parecida"), o retorno oferece excluí-la ali mesmo, com a mesma confirmação
 * do editor: a parada continua na lista e não envia.
 *
 * Mora dentro de uma região aria-live que a página mantém montada, para o
 * leitor de tela anunciar o texto novo.
 */
export function RetornoDaAcao({
  ok,
  aviso,
  antiga,
}: {
  ok?: string;
  aviso?: string;
  antiga?: CampanhaExcluivel | null;
}) {
  const router = useRouter();

  useEffect(() => {
    if (!ok && !aviso) return;
    const url = new URL(window.location.href);
    url.searchParams.delete("ok");
    url.searchParams.delete("aviso");
    url.searchParams.delete("antiga");
    url.searchParams.delete("t");
    window.history.replaceState(null, "", `${url.pathname}${url.search}`);
  }, [ok, aviso]);

  if (aviso) {
    return (
      <p
        role="alert"
        className="mt-2 flex items-start gap-1 rounded-painel bg-cartao px-2 py-1.5 tipo-corpo text-erro"
      >
        <AlertCircle
          size={18}
          strokeWidth={1.75}
          aria-hidden
          className="mt-[2px] shrink-0"
        />
        {aviso}
      </p>
    );
  }
  if (ok) {
    return (
      <div className="mt-2 rounded-painel bg-cartao px-2 py-1.5">
        <p className="flex items-start gap-1 tipo-corpo text-tinta">
          <Check
            size={18}
            strokeWidth={2.25}
            aria-hidden
            className="mt-[2px] shrink-0 text-bom"
          />
          {ok}
        </p>
        {antiga ? (
          <div className="mt-1 flex flex-col items-start gap-0.5 border-t border-fio pt-1 pl-3">
            <p className="tipo-nota text-texto-2">
              A antiga, {antiga.nome}, continua na lista e não envia.
            </p>
            <ConfirmacaoExclusao
              campanha={antiga}
              rotulo="Excluir a antiga"
              aoExcluir={(retorno) =>
                router.replace(
                  `/campanhas?ok=${encodeURIComponent(retorno)}&t=${Date.now()}`,
                  { scroll: false },
                )
              }
            />
          </div>
        ) : null}
      </div>
    );
  }
  return null;
}
