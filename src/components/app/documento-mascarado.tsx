"use client";

import { useState } from "react";
import { Eye } from "lucide-react";
import { revelarDocumento } from "@/app/(app)/carteira/documento-actions";

/**
 * CPF/CNPJ sempre mascarado; "Revelar" traz o inteiro e deixa rastro no
 * log de acesso (quem, quando, qual cliente). Volta a mascarar ao sair da
 * página — não há como "deixar aberto".
 */
export function DocumentoMascarado({
  customerId,
  mascara,
}: {
  customerId: string;
  mascara: string;
}) {
  const [inteiro, setInteiro] = useState<string | null>(null);
  const [aviso, setAviso] = useState<string | null>(null);
  const [carregando, setCarregando] = useState(false);

  const revelar = () => {
    if (carregando) return;
    setCarregando(true);
    setAviso(null);
    void revelarDocumento(customerId)
      .catch(() => ({ erro: "Sem resposta do servidor — tente de novo." }))
      .then((r) => {
        setCarregando(false);
        if ("documento" in r && r.documento) setInteiro(r.documento);
        else if (r.erro) setAviso(r.erro);
      });
  };

  if (mascara === "—") {
    return <span className="font-mono tabular-nums">—</span>;
  }

  return (
    <span className="inline-flex flex-wrap items-center gap-1">
      <span className="font-mono tabular-nums">{inteiro ?? mascara}</span>
      {inteiro ? null : (
        <button
          type="button"
          onClick={revelar}
          aria-busy={carregando}
          title="Revelar o documento inteiro — fica registrado no log de acesso"
          className="inline-flex h-[32px] items-center gap-0.5 rounded-md border border-neutral-300 bg-neutral-0 px-1.5 text-xs font-medium text-neutral-800 transition-colors duration-[120ms] hover:bg-neutral-100 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-primary-500"
        >
          <Eye size={14} strokeWidth={1.5} aria-hidden />
          {carregando ? "Revelando…" : "Revelar"}
        </button>
      )}
      {aviso ? (
        <span role="alert" className="text-xs text-danger">
          {aviso}
        </span>
      ) : null}
    </span>
  );
}
