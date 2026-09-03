"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { createClient } from "@/lib/supabase/client";
import { Button } from "@/components/ui/button";
import { sair } from "../actions";

type Fator = { id: string; qr: string; segredo: string };

export function Cadastrar2fa({ proximo }: { proximo: string }) {
  const router = useRouter();
  const [fator, setFator] = useState<Fator | null>(null);
  const [codigo, setCodigo] = useState("");
  const [erro, setErro] = useState<string | null>(null);
  const [enviando, setEnviando] = useState(false);

  // Gera o segredo ao abrir. Fator antigo não verificado (aba fechada no
  // meio) é apagado antes — senão o Supabase acumula lixo e recusa o novo.
  useEffect(() => {
    let vivo = true;
    void (async () => {
      const supabase = createClient();
      const { data: lista } = await supabase.auth.mfa.listFactors();
      for (const f of lista?.all ?? []) {
        if (f.status === "unverified") {
          await supabase.auth.mfa.unenroll({ factorId: f.id });
        }
      }
      // Nome único por tentativa: o GoTrue recusa dois fatores com o mesmo
      // friendly name (422 mfa_factor_name_conflict), e era exatamente isso
      // que travava quem voltava ao cadastro com um "Zeve CRM" já gravado —
      // reset incompleto, aba repetida, sessão antiga. O nome é rótulo
      // interno (a lista da administração), não o que aparece no app
      // autenticador, então o carimbo de data não incomoda ninguém.
      const quando = new Date().toISOString().replace("T", " ").slice(0, 19);
      const { data, error } = await supabase.auth.mfa.enroll({
        factorType: "totp",
        friendlyName: `Zeve CRM · ${quando}`,
      });
      if (!vivo) return;
      if (error || !data) {
        // A mensagem crua decide o conserto — a tela antiga a engolia e
        // culpava uma configuração do Supabase que estava certa.
        const cru = error?.message ?? "resposta vazia";
        setErro(
          /bearer token|session/i.test(cru)
            ? "Sua sessão expirou no meio do caminho. Volte e entre de novo."
            : `Não deu para gerar o código (${cru}). Tente recarregar a página; se persistir, mande esse texto para a administração.`,
        );
        return;
      }
      setFator({
        id: data.id,
        qr: data.totp.qr_code,
        segredo: data.totp.secret,
      });
    })();
    return () => {
      vivo = false;
    };
  }, []);

  const confirmar = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!fator || enviando) return;
    setEnviando(true);
    setErro(null);
    const supabase = createClient();
    const { error } = await supabase.auth.mfa.challengeAndVerify({
      factorId: fator.id,
      code: codigo.replace(/\D/g, ""),
    });
    setEnviando(false);
    if (error) {
      setErro(
        "Código não confere. Confira o relógio do celular e tente de novo.",
      );
      return;
    }
    router.replace(proximo);
    router.refresh();
  };

  return (
    <form onSubmit={confirmar} className="flex flex-col gap-2">
      {fator ? (
        <div className="flex flex-col items-center gap-1 rounded-md border border-neutral-200 bg-neutral-50 p-2">
          {/* eslint-disable-next-line @next/next/no-img-element -- SVG gerado pelo Supabase, data: URL */}
          <img
            src={fator.qr}
            alt="QR code para o app autenticador"
            width={176}
            height={176}
            className="rounded-md bg-neutral-0 p-1"
          />
          <p className="text-xs text-neutral-600">
            Não consegue ler o QR? Digite este código no app:
          </p>
          <code className="font-mono text-sm break-all text-neutral-800 select-all">
            {fator.segredo}
          </code>
        </div>
      ) : erro ? null : (
        <p className="text-sm text-neutral-600">Gerando o código…</p>
      )}

      <label
        htmlFor="codigo-2fa"
        className="text-sm font-medium text-neutral-800"
      >
        Código de 6 dígitos do app
      </label>
      <input
        id="codigo-2fa"
        inputMode="numeric"
        autoComplete="one-time-code"
        pattern="[0-9]{6}"
        maxLength={6}
        required
        value={codigo}
        onChange={(e) => setCodigo(e.target.value)}
        className="h-[48px] rounded-md border border-neutral-300 bg-neutral-0 px-1.5 text-center font-mono text-h3 tracking-[0.3em] text-neutral-900 tabular-nums focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-primary-500"
      />

      {erro ? (
        <p
          role="alert"
          className="rounded-md border border-danger bg-danger-bg px-1.5 py-1 text-sm text-danger"
        >
          {erro}
        </p>
      ) : null}

      <Button
        type="submit"
        size="lg"
        disabled={!fator || enviando}
        className="w-full"
      >
        {enviando ? "Confirmando…" : "Ativar e entrar"}
      </Button>
      <button
        type="button"
        onClick={() => void sair()}
        className="self-start text-sm text-neutral-600 underline-offset-2 hover:underline"
      >
        Sair e voltar ao login
      </button>
    </form>
  );
}
