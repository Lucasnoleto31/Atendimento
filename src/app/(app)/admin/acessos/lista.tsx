"use client";

import { useEffect, useRef, useState, useTransition } from "react";
import Link from "next/link";
import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import { comVoltar } from "@/app/(app)/contatos/voltar";
import { contagem } from "../../configuracoes/resultado";
import { LINHA_ACAO, MIOLO_LINHA, Seta } from "../../configuracoes/ui";
import { carregarMaisLog } from "./actions";
import type { LinhaLog } from "./consulta";

/*
 * Os registros do Log de acesso, agrupados por dia, cada um como uma frase
 * ("Ana abriu a conversa"), com a hora à esquerda e o papel e o objeto
 * embaixo. Lista e não tabela: lê igual no celular e no desktop. O registro
 * que tem contato abre a ficha dele, com "← Log de acesso" para voltar.
 * "Carregar mais" traz os próximos, com os mesmos filtros, no lugar do corte
 * em 300 de antes. O foco não se perde no caminho: o botão desativa enquanto
 * carrega (e some na última leva), então quem o acionou com o foco nele
 * segue para a primeira linha nova, ou para a contagem quando não veio
 * nenhuma.
 */

const TOM: Record<LinhaLog["tom"], string> = {
  tinta: "text-tinta",
  atencao: "text-atencao",
  erro: "text-erro",
};

function Frase({ l }: { l: LinhaLog }) {
  return (
    <div className="min-w-0 flex-1">
      <p className="tipo-corpo text-tinta [overflow-wrap:anywhere]">
        {l.nome ? (
          <>
            <span className="font-semibold">{l.nome}</span>{" "}
            <span className={TOM[l.tom]}>{l.acao}</span>
          </>
        ) : (
          <span className={TOM[l.tom]}>{l.acao}</span>
        )}
      </p>
      {l.apoio ? (
        <p
          className="tipo-nota line-clamp-3 text-texto-2 [overflow-wrap:anywhere]"
          title={l.apoio}
        >
          {l.apoio}
        </p>
      ) : null}
    </div>
  );
}

export function ListaLog({
  inicial,
  temMaisInicial,
  query,
  periodo,
  hoje,
  ontem,
  aqui,
  comFiltros,
}: {
  inicial: LinhaLog[];
  temMaisInicial: boolean;
  /** Os filtros da tela, para o "Carregar mais" pedir os mesmos. */
  query: string;
  /** "Últimos 7 dias", "01/10 a 07/10". */
  periodo: string;
  /** O dia de hoje e o de ontem (dd/mm/aaaa), para o nome do grupo. */
  hoje: string;
  ontem: string;
  /** O endereço do log agora, que a ficha usa para voltar. */
  aqui: string;
  /** Pessoa, ação ou contato filtrados (muda a frase da lista vazia). */
  comFiltros: boolean;
}) {
  const [linhas, setLinhas] = useState(inicial);
  const [temMais, setTemMais] = useState(temMaisInicial);
  const [erro, setErro] = useState<string | null>(null);
  const [carregando, iniciar] = useTransition();
  const botaoMais = useRef<HTMLButtonElement>(null);
  const contagemRef = useRef<HTMLParagraphElement>(null);
  const lista = useRef<HTMLDivElement>(null);
  // Para onde o foco vai depois da leva: o id da primeira linha nova, a
  // contagem, o botão de novo (deu erro) ou nada (o foco não estava nele).
  const focarDepois = useRef<string | null>(null);

  const carregarMais = () => {
    const ultima = linhas[linhas.length - 1];
    if (!ultima) return;
    setErro(null);
    // Lido antes do carregando desativar o botão (que derruba o foco).
    const comFoco = document.activeElement === botaoMais.current;
    const vistos = new Set(linhas.map((l) => l.id));
    iniciar(async () => {
      const r = await carregarMaisLog(query, ultima.criadoEm).catch(() => ({
        erro: "O log não respondeu. Tente de novo.",
      }));
      if ("erro" in r) {
        if (comFoco) focarDepois.current = "botao";
        setErro(r.erro);
        return;
      }
      const novas = r.linhas.filter((l) => !vistos.has(l.id));
      if (comFoco) focarDepois.current = novas[0]?.id ?? "contagem";
      setLinhas((atuais) => {
        const jaTem = new Set(atuais.map((l) => l.id));
        return [...atuais, ...r.linhas.filter((l) => !jaTem.has(l.id))];
      });
      setTemMais(r.temMais);
    });
  };

  useEffect(() => {
    const alvo = focarDepois.current;
    if (!alvo || carregando) return;
    focarDepois.current = null;
    if (alvo === "botao") {
      botaoMais.current?.focus();
      return;
    }
    if (alvo !== "contagem") {
      const linha = lista.current?.querySelector(
        `[data-linha-log="${CSS.escape(alvo)}"]`,
      );
      const focavel = linha?.querySelector<HTMLElement>("a[href], [tabindex]");
      if (focavel) {
        focavel.focus({ preventScroll: true });
        return;
      }
    }
    contagemRef.current?.focus({ preventScroll: true });
  }, [linhas, temMais, erro, carregando]);

  // Um grupo por dia, do mais novo para o mais antigo (a consulta já vem
  // nessa ordem).
  const porDia = new Map<string, LinhaLog[]>();
  for (const l of linhas) {
    const lista = porDia.get(l.dia);
    if (lista) lista.push(l);
    else porDia.set(l.dia, [l]);
  }
  const nomeDoDia = (dia: string) =>
    dia === hoje ? "Hoje" : dia === ontem ? "Ontem" : dia;

  if (linhas.length === 0) {
    return (
      <p className="tipo-corpo mt-3 text-texto-2">
        {comFiltros
          ? "Nenhum registro com esses filtros nesse período."
          : "Nenhum acesso registrado nesse período."}
      </p>
    );
  }

  return (
    <>
      <p
        ref={contagemRef}
        tabIndex={-1}
        className="tipo-nota mt-2 rounded-controle px-2 text-texto-2 outline-none focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-tinta"
        aria-live="polite"
      >
        {periodo} ·{" "}
        {temMais
          ? `os ${linhas.length.toLocaleString("pt-BR")} mais recentes`
          : contagem(linhas.length, "registro", "registros")}
      </p>
      <div ref={lista} className="mt-2 flex flex-col gap-3">
        {[...porDia.entries()].map(([dia, doDia], i) => (
          <section key={dia} aria-labelledby={`dia-${i}`}>
            <h2
              id={`dia-${i}`}
              className="tipo-nota px-2 pb-1 tracking-[0.04em] text-texto-2 uppercase"
            >
              {nomeDoDia(dia)}
            </h2>
            <ul className="overflow-hidden rounded-painel bg-cartao">
              {doDia.map((l) => {
                const miolo = (
                  <>
                    <time
                      dateTime={l.criadoEm}
                      className="tipo-nota w-[44px] shrink-0 text-texto-2 tabular-nums"
                    >
                      {l.hora}
                    </time>
                    <Frase l={l} />
                  </>
                );
                return (
                  <li key={l.id} data-linha-log={l.id} className="group/linha">
                    {l.leadId ? (
                      <Link
                        href={comVoltar(`/contatos/${l.leadId}`, aqui)}
                        prefetch={false}
                        className={cn(LINHA_ACAO, "min-h-[56px]")}
                      >
                        <span className={cn(MIOLO_LINHA, "items-baseline")}>
                          {miolo}
                          <span className="self-center">
                            <Seta />
                          </span>
                        </span>
                      </Link>
                    ) : (
                      // Sem link, a linha só recebe foco pelo código (a
                      // primeira nova depois do "Carregar mais").
                      <div
                        tabIndex={-1}
                        className="flex min-h-[56px] outline-none focus-visible:outline-2 focus-visible:-outline-offset-2 focus-visible:outline-tinta"
                      >
                        <div className={cn(MIOLO_LINHA, "items-baseline")}>
                          {miolo}
                        </div>
                      </div>
                    )}
                  </li>
                );
              })}
            </ul>
          </section>
        ))}
      </div>

      {erro ? (
        <p role="alert" className="tipo-nota mt-2 px-2 text-erro">
          {erro}
        </p>
      ) : null}
      {temMais ? (
        <div className="mt-3 flex justify-center">
          <Button
            ref={botaoMais}
            type="button"
            variant="secondary"
            carregando={carregando}
            onClick={carregarMais}
            className="w-full md:w-auto pointer-coarse:h-[44px]"
          >
            {carregando ? "Carregando…" : "Carregar mais"}
          </Button>
        </div>
      ) : null}
    </>
  );
}
