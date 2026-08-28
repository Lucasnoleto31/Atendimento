"use client";

import { useState, useTransition } from "react";
import Link from "next/link";
import {
  Check,
  CheckSquare,
  Clock,
  AtSign,
  Mail,
  Square,
  X,
} from "lucide-react";
import { cn } from "@/lib/utils";
import {
  adiarConversasEmMassa,
  atribuirEmMassa,
  etiquetarEmMassa,
  marcarLidasEmMassa,
  marcarNaoLidasEmMassa,
  resolverConversasEmMassa,
  type PrazoAdiar,
} from "./actions";
import { OPCOES_ADIAR } from "./ferramentas";

export type ItemConversa = {
  id: string;
  nome: string;
  /** Nome de quem está no atendimento — aparece em cima do nome do lead. */
  atendente: string | null;
  href: string;
  hora: string;
  /** Canal de origem, quando não é o WhatsApp padrão da mesa. */
  origem: { canal: "instagram"; identificador: string } | null;
  previa: string;
  /** Direção da última mensagem — a onda 2 usa para mostrar de quem é a vez. */
  previaTipo?: string | null;
  pendente: boolean;
  aberta: boolean;
  espera: string | null;
  /** Na aba Adiadas: até quando está adiada, já formatado. */
  adiadaAte: string | null;
  faixa: string;
  etiquetas: { id: string; nome: string; chip: string }[];
  etiquetasExtras: number;
};

const BOTAO_MASSA =
  "inline-flex h-[32px] items-center gap-0.5 rounded-md px-1.5 text-sm font-medium text-neutral-800 transition-colors duration-[120ms] hover:bg-neutral-100 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-primary-500 disabled:cursor-not-allowed disabled:text-neutral-400";

/**
 * Lista de conversas com seleção múltipla. A caixa de seleção fica fora do
 * link — clicar nela marca, clicar no resto abre a conversa. Com algo
 * marcado, aparece a barra de ações que trata todas de uma vez.
 */
export function ListaConversas({
  itens,
  equipe,
  etiquetas,
}: {
  itens: ItemConversa[];
  equipe: { id: string; nome: string }[];
  etiquetas: { id: string; nome: string }[];
}) {
  const [marcados, setMarcados] = useState<Set<string>>(new Set());
  const [pendente, iniciar] = useTransition();
  const [erro, setErro] = useState<string | null>(null);

  const alternar = (id: string) => {
    setMarcados((atual) => {
      const novo = new Set(atual);
      if (novo.has(id)) novo.delete(id);
      else novo.add(id);
      return novo;
    });
  };

  const executar = (acao: () => Promise<{ erro?: string }>) => {
    setErro(null);
    iniciar(async () => {
      const resultado = await acao();
      if (resultado.erro) setErro(resultado.erro);
      else setMarcados(new Set());
    });
  };

  const ids = [...marcados];
  const todosMarcados = itens.length > 0 && marcados.size === itens.length;

  return (
    <div className="flex min-h-0 flex-1 flex-col">
      {marcados.size > 0 ? (
        <div className="border-b border-neutral-200 bg-primary-50 px-1.5 py-1">
          <div className="flex flex-wrap items-center gap-1">
            <button
              type="button"
              onClick={() =>
                setMarcados(
                  todosMarcados ? new Set() : new Set(itens.map((i) => i.id)),
                )
              }
              className="inline-flex h-[32px] items-center gap-0.5 rounded-md px-1 text-sm font-medium text-primary-900 transition-colors duration-[120ms] hover:bg-primary-100 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-primary-500"
            >
              {todosMarcados ? (
                <CheckSquare size={14} strokeWidth={1.5} aria-hidden />
              ) : (
                <Square size={14} strokeWidth={1.5} aria-hidden />
              )}
              {marcados.size} selecionada(s)
            </button>

            <span aria-hidden className="text-neutral-300">
              ·
            </span>

            <label htmlFor="adiar-massa" className="sr-only">
              Adiar as conversas selecionadas
            </label>
            <select
              id="adiar-massa"
              defaultValue=""
              disabled={pendente}
              title="Somem da caixa e voltam quando o prazo vencer (ou o lead responder)"
              onChange={(e) => {
                const valor = e.target.value as PrazoAdiar | "";
                e.target.value = "";
                if (valor) {
                  executar(() => adiarConversasEmMassa(ids, valor));
                }
              }}
              className="h-[32px] rounded-md border border-neutral-300 bg-neutral-0 px-1 text-sm text-neutral-800 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-primary-500 disabled:cursor-not-allowed"
            >
              <option value="" disabled>
                Adiar até…
              </option>
              {OPCOES_ADIAR.map((opcao) => (
                <option key={opcao.prazo} value={opcao.prazo}>
                  {opcao.rotulo}
                </option>
              ))}
            </select>

            <button
              type="button"
              disabled={pendente}
              onClick={() => executar(() => resolverConversasEmMassa(ids))}
              className={BOTAO_MASSA}
            >
              <Check size={14} strokeWidth={1.5} aria-hidden />
              Resolver
            </button>

            <button
              type="button"
              disabled={pendente}
              onClick={() => executar(() => marcarLidasEmMassa(ids))}
              className={BOTAO_MASSA}
            >
              Marcar lidas
            </button>

            <button
              type="button"
              disabled={pendente}
              onClick={() => executar(() => marcarNaoLidasEmMassa(ids))}
              className={BOTAO_MASSA}
            >
              <Mail size={14} strokeWidth={1.5} aria-hidden />
              Não lidas
            </button>

            <label htmlFor="atribuir-massa" className="sr-only">
              Atribuir as conversas selecionadas
            </label>
            <select
              id="atribuir-massa"
              defaultValue=""
              disabled={pendente}
              onChange={(e) => {
                const valor = e.target.value;
                e.target.value = "";
                if (valor) {
                  executar(() =>
                    atribuirEmMassa(ids, valor === "sem" ? null : valor),
                  );
                }
              }}
              className="h-[32px] rounded-md border border-neutral-300 bg-neutral-0 px-1 text-sm text-neutral-800 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-primary-500 disabled:cursor-not-allowed"
            >
              <option value="" disabled>
                Atribuir a…
              </option>
              <option value="sem">Sem atendente</option>
              {equipe.map((pessoa) => (
                <option key={pessoa.id} value={pessoa.id}>
                  {pessoa.nome}
                </option>
              ))}
            </select>

            {etiquetas.length > 0 ? (
              <>
                <label htmlFor="etiquetar-massa" className="sr-only">
                  Etiquetar as conversas selecionadas
                </label>
                <select
                  id="etiquetar-massa"
                  defaultValue=""
                  disabled={pendente}
                  onChange={(e) => {
                    const valor = e.target.value;
                    e.target.value = "";
                    if (valor) {
                      executar(() => etiquetarEmMassa(ids, valor, true));
                    }
                  }}
                  className="h-[32px] rounded-md border border-neutral-300 bg-neutral-0 px-1 text-sm text-neutral-800 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-primary-500 disabled:cursor-not-allowed"
                >
                  <option value="" disabled>
                    Etiquetar…
                  </option>
                  {etiquetas.map((etiqueta) => (
                    <option key={etiqueta.id} value={etiqueta.id}>
                      {etiqueta.nome}
                    </option>
                  ))}
                </select>
              </>
            ) : null}

            <button
              type="button"
              aria-label="Limpar seleção"
              onClick={() => setMarcados(new Set())}
              className="ml-auto inline-flex h-[32px] w-[32px] items-center justify-center rounded-md text-neutral-600 transition-colors duration-[120ms] hover:bg-primary-100 hover:text-neutral-800 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-primary-500"
            >
              <X size={16} strokeWidth={1.5} aria-hidden />
            </button>
          </div>

          {erro ? (
            <p role="alert" className="mt-0.5 text-xs text-danger">
              {erro}
            </p>
          ) : null}
        </div>
      ) : null}

      <ul className="relative min-h-0 flex-1 divide-y divide-neutral-200 overflow-y-auto">
        {itens.length === 0 ? (
          <li className="p-2 text-sm text-neutral-600">Nenhuma conversa aqui.</li>
        ) : (
          itens.map((item) => {
            const marcado = marcados.has(item.id);
            return (
              <li
                key={item.id}
                className={cn(
                  "flex items-center border-l-4 transition-colors duration-[120ms]",
                  item.faixa,
                  marcado
                    ? "bg-primary-50"
                    : item.aberta
                      ? "bg-primary-50"
                      : "hover:bg-neutral-50",
                )}
              >
                {/* aria-label direto no input, sem span sr-only: sr-only é
                    position:absolute e, sem ancestral posicionado dentro da
                    lista, ancorava na coluna do shell — cada conversa abaixo
                    da dobra esticava o DOCUMENTO (rolagem para o vazio). */}
                <label className="flex h-[40px] w-[32px] shrink-0 cursor-pointer items-center justify-center">
                  <input
                    type="checkbox"
                    checked={marcado}
                    onChange={() => alternar(item.id)}
                    aria-label={`Selecionar conversa de ${item.nome}`}
                    className="h-[16px] w-[16px] accent-primary-600"
                  />
                </label>

                <Link
                  href={item.href}
                  aria-current={item.aberta ? "true" : undefined}
                  className="flex min-w-0 flex-1 items-center gap-1 py-1 pr-1.5 focus-visible:outline-2 focus-visible:-outline-offset-2 focus-visible:outline-primary-500"
                >
                  <span
                    aria-hidden
                    className="flex h-[40px] w-[40px] shrink-0 items-center justify-center rounded-md bg-neutral-100 font-mono text-sm text-neutral-600"
                  >
                    {item.nome.slice(0, 2).toUpperCase()}
                  </span>
                  <span className="min-w-0 flex-1">
                    {item.atendente ? (
                      <span className="block truncate text-xs text-neutral-600">
                        {item.atendente}
                      </span>
                    ) : null}
                    <span className="flex items-baseline justify-between gap-1">
                      <span
                        className={cn(
                          "truncate text-sm text-neutral-800",
                          item.pendente ? "font-semibold" : "font-medium",
                        )}
                      >
                        {item.nome}
                      </span>
                      <span className="shrink-0 font-mono text-xs text-neutral-400 tabular-nums">
                        {item.hora}
                      </span>
                    </span>
                    {item.origem ? (
                      <span className="flex items-center gap-0.5 text-xs text-accent-700">
                        <AtSign size={12} strokeWidth={1.5} aria-hidden />
                        <span className="truncate">
                          {item.origem.identificador}
                        </span>
                      </span>
                    ) : null}
                    <span className="flex items-center justify-between gap-1">
                      {/* De quem é a vez: ↩ = o lead falou por último (a vez
                          é nossa, prévia escura); "Você:" = já respondemos. */}
                      <span
                        className={cn(
                          "truncate text-xs",
                          item.pendente && "font-medium",
                          item.previaTipo === "mensagem_recebida"
                            ? "text-neutral-800"
                            : item.previaTipo === "mensagem_enviada"
                              ? "text-neutral-600"
                              : item.pendente
                                ? "text-neutral-800"
                                : "text-neutral-600",
                        )}
                      >
                        {item.previaTipo === "mensagem_recebida"
                          ? "↩ "
                          : item.previaTipo === "mensagem_enviada"
                            ? "Você: "
                            : ""}
                        {item.previa}
                      </span>
                      {item.espera ? (
                        <span className="inline-flex h-[20px] shrink-0 items-center rounded-sm bg-warning-bg px-0.5 font-mono text-xs font-medium text-warning tabular-nums">
                          {item.espera}
                        </span>
                      ) : item.adiadaAte ? (
                        <span
                          title="Volta à caixa quando o prazo vencer"
                          className="inline-flex h-[20px] shrink-0 items-center gap-0.5 rounded-sm bg-neutral-100 px-0.5 font-mono text-xs font-medium text-neutral-600 tabular-nums"
                        >
                          <Clock size={12} strokeWidth={1.5} aria-hidden />
                          até {item.adiadaAte}
                        </span>
                      ) : item.pendente ? (
                        <span
                          aria-label="Mensagens não lidas"
                          className="h-1 w-1 shrink-0 rounded-full bg-primary-600"
                        />
                      ) : null}
                    </span>

                    {item.etiquetas.length > 0 ? (
                      <span className="mt-0.5 flex flex-wrap items-center gap-0.5">
                        {item.etiquetas.map((etiqueta) => (
                          <span
                            key={etiqueta.id}
                            className={cn(
                              "inline-flex h-[20px] items-center rounded-sm px-1 text-xs font-medium",
                              etiqueta.chip,
                            )}
                          >
                            {etiqueta.nome}
                          </span>
                        ))}
                        {item.etiquetasExtras > 0 ? (
                          <span className="text-xs text-neutral-400">
                            +{item.etiquetasExtras}
                          </span>
                        ) : null}
                      </span>
                    ) : null}
                  </span>
                </Link>
              </li>
            );
          })
        )}
      </ul>
    </div>
  );
}
